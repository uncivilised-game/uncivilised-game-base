#!/usr/bin/env python3
"""
Conviction Triage — scores player feedback, clusters by similarity, opens GitHub issues.

Runs on a schedule (GitHub Actions) or manually.
Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_API_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

# ── Config ──────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
GOOGLE_API_KEY = os.environ["GOOGLE_API_KEY"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GITHUB_REPO = os.environ.get("GITHUB_REPO", "uncivilised-game/uncivilised-game-base")

EMBEDDING_MODEL = "models/gemini-embedding-001"  # 768 dims, swap later if needed
SIMILARITY_THRESHOLD = 0.75
MIN_CONVICTION_SCORE = 6  # minimum score to open an issue (single report can't reach this unless critical)

MIN_MESSAGE_LENGTH = 10  # skip very short/empty messages
ACTIONABLE_CATEGORIES = {"bug_report", "feature_request", "gameplay_feedback"}

PRIORITY_WEIGHTS = {"critical": 5, "high": 3, "medium": 2, "low": 1}
CATEGORY_LABELS = {
    "bug_report": "bug",
    "feature_request": "enhancement",
    "gameplay_feedback": "gameplay",
    "question": "question",
    "other": "feedback",
}


# ── HTTP helpers (no deps) ──────────────────────────────────────────
def _req(method, url, data=None, headers=None, retries=2):
    """Simple HTTP request with retry."""
    headers = headers or {}
    body = json.dumps(data).encode() if data is not None else None
    if body and "Content-Type" not in headers:
        headers["Content-Type"] = "application/json"
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if e.fp else ""
            if attempt == retries:
                print(f"HTTP {e.code} {method} {url}: {err_body}", file=sys.stderr)
                raise
            time.sleep(2 ** attempt)
        except Exception:
            if attempt == retries:
                raise
            time.sleep(2 ** attempt)


def sb_get(path, params=""):
    """GET from Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{path}?{params}" if params else f"{SUPABASE_URL}/rest/v1/{path}"
    return _req("GET", url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })


def sb_patch(path, data, params=""):
    """PATCH to Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{path}?{params}" if params else f"{SUPABASE_URL}/rest/v1/{path}"
    return _req("PATCH", url, data=data, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    })


def sb_rpc(fn_name, data):
    """Call a Supabase RPC function."""
    url = f"{SUPABASE_URL}/rest/v1/rpc/{fn_name}"
    return _req("POST", url, data=data, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    })


# ── Gemini embeddings ──────────────────────────────────────────────
def embed_texts(texts):
    """Generate embeddings via Gemini API. Batches for efficiency."""
    url = f"https://generativelanguage.googleapis.com/v1beta/{EMBEDDING_MODEL}:batchEmbedContents"
    # Gemini batch limit is 100 per request
    all_embeddings = []
    for i in range(0, len(texts), 100):
        batch = texts[i:i + 100]
        requests_body = {
            "requests": [
                {"model": EMBEDDING_MODEL, "content": {"parts": [{"text": t}]}}
                for t in batch
            ]
        }
        result = _req("POST", url, data=requests_body, headers={"x-goog-api-key": GOOGLE_API_KEY})
        for emb in result["embeddings"]:
            all_embeddings.append(emb["values"])
    return all_embeddings


def embed_single(text):
    """Generate a single embedding."""
    return embed_texts([text])[0]


# ── Store embeddings in Supabase ───────────────────────────────────
def store_embedding(feedback_id, embedding):
    """Store embedding vector on a feedback row."""
    # pgvector expects the format [1.0, 2.0, ...]
    vec_str = "[" + ",".join(str(v) for v in embedding) + "]"
    sb_patch("feedback", {"embedding": vec_str}, f"id=eq.{feedback_id}")


# ── Clustering ─────────────────────────────────────────────────────
def cosine_sim(a, b):
    """Cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def cluster_feedback(items):
    """
    Simple greedy clustering by cosine similarity.
    Each item: {"id": int, "embedding": list, ...metadata}
    Returns list of clusters, each a list of items.
    """
    clusters = []
    for item in items:
        placed = False
        for cluster in clusters:
            # Compare against centroid of cluster
            centroid = [
                sum(c["embedding"][d] for c in cluster) / len(cluster)
                for d in range(len(item["embedding"]))
            ]
            if cosine_sim(item["embedding"], centroid) >= SIMILARITY_THRESHOLD:
                cluster.append(item)
                placed = True
                break
        if not placed:
            clusters.append([item])
    return clusters


# ── Conviction scoring ─────────────────────────────────────────────
def score_cluster(cluster):
    """
    Score a cluster by conviction signals. Designed so that:
    - 1 person, 1 medium report     = 2+2 = 4  (below threshold, no issue)
    - 1 person, 1 critical report   = 5+2 = 7  (above threshold)
    - 2 people, same medium bug     = 4+4 = 8  (above threshold — real signal)
    - 3 people, mixed priority      = ~9+6 = 15 (strong conviction)
    - 1 person spamming 3 reports   = 6+2 = 8  (barely passes — unique reporters matter)

    Formula:
      priority_sum + (unique_reporters * 2) + recency_bonus

    Unique reporters are weighted 2x because independent confirmation
    is the strongest conviction signal.
    """
    priority_score = sum(PRIORITY_WEIGHTS.get(item.get("priority", "medium"), 2) for item in cluster)
    unique_reporters = len(set(item.get("player_name", "") for item in cluster if item.get("player_name")))

    # Recency bonus: reports from last 48h get +1 each
    now = datetime.now(timezone.utc)
    recency_bonus = 0
    for item in cluster:
        created = item.get("created_at", "")
        if created:
            try:
                dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                if (now - dt).total_seconds() < 172800:
                    recency_bonus += 1
            except (ValueError, TypeError):
                pass

    return priority_score + (unique_reporters * 2) + recency_bonus


# ── GitHub issues ──────────────────────────────────────────────────
def gh_get(path):
    return _req("GET", f"https://api.github.com{path}", headers={
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })


def gh_post(path, data):
    return _req("POST", f"https://api.github.com{path}", data=data, headers={
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })


def gh_patch(path, data):
    return _req("PATCH", f"https://api.github.com{path}", data=data, headers={
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })


def get_existing_conviction_issues():
    """Fetch all open GitHub issues with the 'conviction' label."""
    issues = []
    page = 1
    while True:
        batch = gh_get(f"/repos/{GITHUB_REPO}/issues?labels=conviction&state=open&per_page=100&page={page}")
        if not batch:
            break
        issues.extend(item for item in batch if "pull_request" not in item)
        if len(batch) < 100:
            break
        page += 1
    return issues


def create_github_issue(title, body, labels):
    """Create a GitHub issue."""
    return gh_post(f"/repos/{GITHUB_REPO}/issues", {
        "title": title,
        "body": body,
        "labels": labels,
    })


def update_github_issue(issue_number, body):
    """Update a GitHub issue body."""
    return gh_patch(f"/repos/{GITHUB_REPO}/issues/{issue_number}", {
        "body": body,
    })


# ── Claude summarization ──────────────────────────────────────────
def summarize_cluster(cluster, conviction_score):
    """Use Claude to generate an issue title and description from a cluster of feedback."""
    reports_text = "\n".join(
        f"- [{item.get('category', 'other')}][{item.get('priority', 'medium')}] "
        f"**{item.get('player_name', 'anon')}** (turn {item.get('game_turn', '?')}): "
        f"\"{item.get('message', '')}\""
        for item in cluster
    )

    # Determine dominant category
    categories = [item.get("category", "other") for item in cluster]
    dominant = max(set(categories), key=categories.count)

    result = _req("POST", "https://api.anthropic.com/v1/messages", data={
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 400,
        "messages": [{
            "role": "user",
            "content": f"""You are triaging player feedback for Uncivilised, a browser 4X strategy game.

Below are {len(cluster)} player reports that are semantically similar. They likely describe the same issue or request.

Reports:
{reports_text}

Dominant category: {dominant}
Conviction score: {conviction_score}

Respond with EXACTLY this JSON (no other text):
{{
  "title": "<concise issue title, max 80 chars, no category prefix>",
  "description": "<2-3 sentence description synthesizing all reports into one clear issue/request>"
}}"""
        }],
    }, headers={
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    })

    text = result["content"][0]["text"].strip()
    # Handle possible markdown code blocks
    if text.startswith("```"):
        text = "\n".join(text.split("\n")[1:-1])
    return json.loads(text)


# ── Issue body formatting ──────────────────────────────────────────
def format_issue_body(cluster, conviction_score, description):
    """Format the GitHub issue body."""
    unique_reporters = sorted(set(item.get("player_name", "anon") for item in cluster if item.get("player_name")))
    categories = [item.get("category", "other") for item in cluster]
    dominant = max(set(categories), key=categories.count)

    dates = []
    for item in cluster:
        if item.get("created_at"):
            dates.append(item["created_at"][:10])

    reports_section = "\n".join(
        f"- **{item.get('player_name', 'anon')}** "
        f"({item.get('created_at', '?')[:10]}): "
        f"\"{item.get('message', '')}\""
        for item in sorted(cluster, key=lambda x: x.get("created_at", ""))
    )

    return f"""## Conviction Score: {conviction_score}

{description}

### Reports ({len(cluster)})
{reports_section}

### Metadata
- **Category**: {dominant}
- **Unique reporters**: {len(unique_reporters)} ({', '.join(unique_reporters)})
- **First reported**: {min(dates) if dates else 'unknown'}
- **Last reported**: {max(dates) if dates else 'unknown'}

---
*Auto-triaged by conviction pipeline. Score updates on each run.*
*Feedback IDs: {', '.join(str(item['id']) for item in cluster)}*"""


# ── Main pipeline ──────────────────────────────────────────────────
def run():
    print("=== Conviction Triage ===")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")

    # 1. Fetch new (unprocessed) feedback
    print("\n1. Fetching new feedback...")
    new_feedback = sb_get("feedback", "status=eq.new&select=id,message,category,priority,ai_summary,player_name,game_state_snapshot,created_at&order=created_at.asc")
    print(f"   Found {len(new_feedback)} new feedback entries")

    # 1b. Filter out non-actionable feedback (questions, other, spam, too short)
    actionable = []
    skipped = []
    for fb in new_feedback:
        cat = fb.get("category", "other")
        msg = fb.get("message", "")
        if cat not in ACTIONABLE_CATEGORIES:
            skipped.append((fb, f"category:{cat}"))
        elif len(msg.strip()) < MIN_MESSAGE_LENGTH:
            skipped.append((fb, "too_short"))
        else:
            actionable.append(fb)

    # Mark skipped feedback so it doesn't get re-processed
    for fb, reason in skipped:
        sb_patch("feedback", {"status": "skipped"}, f"id=eq.{fb['id']}")

    if skipped:
        print(f"   Skipped {len(skipped)} ({', '.join(r for _, r in skipped[:5])}{'...' if len(skipped) > 5 else ''})")

    # 1c. Also fetch 'pending' feedback from previous runs (below threshold, waiting for more signal)
    pending_feedback = sb_get("feedback", "status=eq.pending&select=id,message,category,priority,ai_summary,player_name,game_state_snapshot,created_at,embedding&order=created_at.asc")
    print(f"   Actionable: {len(actionable)} new + {len(pending_feedback)} pending")

    if not actionable and not pending_feedback:
        print("   Nothing to process. Done.")
        return

    new_feedback = actionable

    # 2. Generate embeddings for new feedback
    if new_feedback:
        print("\n2. Generating embeddings...")
        texts = [
            f"[{f.get('category', 'other')}] {f.get('message', '')}"
            for f in new_feedback
        ]
        embeddings = embed_texts(texts)
        print(f"   Generated {len(embeddings)} embeddings ({len(embeddings[0])} dims)")

        # 3. Store embeddings in Supabase
        print("\n3. Storing embeddings...")
        for i, fb in enumerate(new_feedback):
            store_embedding(fb["id"], embeddings[i])
            fb["embedding"] = embeddings[i]
            snapshot = fb.get("game_state_snapshot") or {}
            fb["game_turn"] = snapshot.get("turn", "?")
        print(f"   Stored {len(new_feedback)} embeddings")
    else:
        print("\n2. No new feedback to embed, using pending pool only.")

    # 4. Fetch existing conviction issues from GitHub
    print("\n4. Checking existing GitHub issues...")
    existing_issues = get_existing_conviction_issues()
    print(f"   Found {len(existing_issues)} open conviction issues")

    # 5. For existing issues, compute centroids from their linked feedback
    issue_centroids = {}
    if existing_issues:
        for issue in existing_issues:
            issue_num = issue["number"]
            # Find feedback already linked to this issue
            linked = sb_get("feedback", f"github_issue_number=eq.{issue_num}&select=id,embedding&embedding=not.is.null")
            if linked:
                # Compute centroid in Python (embeddings come back as strings from Supabase)
                vecs = []
                for row in linked:
                    if row.get("embedding"):
                        vec = row["embedding"]
                        if isinstance(vec, str):
                            vec = json.loads(vec.replace("(", "[").replace(")", "]") if "(" in vec else vec)
                        vecs.append(vec)
                if vecs:
                    dim = len(vecs[0])
                    centroid = [sum(v[d] for v in vecs) / len(vecs) for d in range(dim)]
                    issue_centroids[issue_num] = {"centroid": centroid, "issue": issue}

    # 5b. Merge pending feedback (already has embeddings from previous runs)
    for fb in pending_feedback:
        if fb.get("embedding"):
            vec = fb["embedding"]
            if isinstance(vec, str):
                vec = json.loads(vec.replace("(", "[").replace(")", "]") if "(" in vec else vec)
            fb["embedding"] = vec
            snapshot = fb.get("game_state_snapshot") or {}
            fb["game_turn"] = snapshot.get("turn", "?")

    all_feedback = new_feedback + [fb for fb in pending_feedback if isinstance(fb.get("embedding"), list)]
    if len(pending_feedback) > 0:
        print(f"   Merged {len(pending_feedback)} pending entries into pool")

    # 6. Match all feedback against existing issues
    print("\n5. Matching against existing issues...")
    matched = {}  # issue_number -> [feedback items]
    unmatched = []

    for fb in all_feedback:
        best_match = None
        best_sim = 0
        for issue_num, data in issue_centroids.items():
            sim = cosine_sim(fb["embedding"], data["centroid"])
            if sim >= SIMILARITY_THRESHOLD and sim > best_sim:
                best_match = issue_num
                best_sim = sim
        if best_match:
            matched.setdefault(best_match, []).append(fb)
            print(f"   #{fb['id']} -> issue #{best_match} (sim={best_sim:.3f})")
        else:
            unmatched.append(fb)

    print(f"   Matched {sum(len(v) for v in matched.values())} to existing issues, {len(unmatched)} unmatched")

    # 7. Update existing issues with new matches
    print("\n6. Updating existing issues...")
    for issue_num, items in matched.items():
        # Mark feedback rows with the issue number
        for fb in items:
            sb_patch("feedback", {"status": "processed", "github_issue_number": issue_num}, f"id=eq.{fb['id']}")

        # Re-fetch all feedback for this issue to rebuild the body
        all_linked = sb_get("feedback",
            f"github_issue_number=eq.{issue_num}&select=id,message,category,priority,ai_summary,player_name,game_state_snapshot,created_at&order=created_at.asc")
        for item in all_linked:
            snapshot = item.get("game_state_snapshot") or {}
            item["game_turn"] = snapshot.get("turn", "?")

        score = score_cluster(all_linked)
        issue = issue_centroids[issue_num]["issue"]
        # Re-summarize with all reports
        summary = summarize_cluster(all_linked, score)
        body = format_issue_body(all_linked, score, summary["description"])
        update_github_issue(issue_num, body)
        print(f"   Updated issue #{issue_num}: score={score}, reports={len(all_linked)}")

    # 8. Cluster unmatched feedback
    print("\n7. Clustering unmatched feedback...")
    if not unmatched:
        print("   No new clusters to create.")
    else:
        clusters = cluster_feedback(unmatched)
        print(f"   Formed {len(clusters)} clusters")

        # 9. Score and create issues for clusters above threshold
        print("\n8. Creating GitHub issues...")
        created_count = 0
        skipped_count = 0

        for cluster in clusters:
            score = score_cluster(cluster)
            dominant_cat = max(
                set(item.get("category", "other") for item in cluster),
                key=lambda c: sum(1 for item in cluster if item.get("category") == c)
            )

            if score < MIN_CONVICTION_SCORE:
                # Mark as 'pending' — stays in the pool for future runs
                # so it can cluster with new reports and eventually cross threshold
                for fb in cluster:
                    sb_patch("feedback", {"status": "pending"}, f"id=eq.{fb['id']}")
                skipped_count += 1
                print(f"   Cluster below threshold (score={score}, size={len(cluster)}, ids={[fb.get('id') for fb in cluster]})")
                continue

            # Summarize with Claude
            summary = summarize_cluster(cluster, score)
            labels = ["conviction", CATEGORY_LABELS.get(dominant_cat, "feedback")]

            # Add priority label for high/critical
            priorities = [item.get("priority", "medium") for item in cluster]
            if "critical" in priorities:
                labels.append("priority:critical")
            elif "high" in priorities:
                labels.append("priority:high")

            body = format_issue_body(cluster, score, summary["description"])
            issue = create_github_issue(summary["title"], body, labels)
            issue_num = issue["number"]
            created_count += 1

            # Link feedback rows to the new issue
            for fb in cluster:
                sb_patch("feedback", {"status": "processed", "github_issue_number": issue_num}, f"id=eq.{fb['id']}")

            print(f"   Created issue #{issue_num}: \"{summary['title']}\" (score={score}, reports={len(cluster)})")

        print(f"\n   Created {created_count} issues, skipped {skipped_count} (below threshold)")

    # 10. Summary
    total_new = len(actionable)
    total_matched = sum(len(v) for v in matched.values())
    print(f"\n=== Done. {total_new} new entries: {total_matched} matched to existing issues, {len(unmatched)} clustered. ===")


if __name__ == "__main__":
    run()
