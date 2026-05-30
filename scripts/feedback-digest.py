#!/usr/bin/env python3
"""
Feedback Digest — morning summary of new player feedback, posted as a GitHub issue.

Queries all feedback with status="new" from Supabase, groups by category and
priority, asks Claude for a thematic summary, creates a GitHub issue, then
marks the feedback as "digested" so it won't appear in the next run.

Runs daily via GitHub Actions (feedback-digest.yml) or manually.
Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN
Optional: DRY_RUN=true (log output without creating an issue or updating status)
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from collections import defaultdict
from urllib.parse import quote

# ── Config ──────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GITHUB_REPO = os.environ.get("GITHUB_REPO", "uncivilised-game/uncivilised-game-base")
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

SB_REST = f"{SUPABASE_URL}/rest/v1"
SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

CLAUDE_MODEL = "claude-sonnet-4-20250514"

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
PRIORITY_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}
CATEGORY_LABELS = {
    "bug_report": "Bug Reports",
    "feature_request": "Feature Requests",
    "gameplay_feedback": "Gameplay Feedback",
    "question": "Questions",
    "other": "Other",
}
CATEGORY_ORDER = ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]


# ── HTTP helpers ────────────────────────────────────────────────────
def _req(method, url, data=None, headers=None, retries=2):
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


def sb_get(table, select="*", filters="", order=None, limit=None):
    url = f"{SB_REST}/{table}?select={quote(select)}"
    if filters:
        url += f"&{filters}"
    if order:
        url += f"&order={order}"
    if limit:
        url += f"&limit={limit}"
    return _req("GET", url, headers=SB_HEADERS)


def sb_patch(table, data, filters):
    headers = {**SB_HEADERS, "Prefer": "return=representation"}
    url = f"{SB_REST}/{table}?{filters}"
    return _req("PATCH", url, data=data, headers=headers)


GH_HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


def gh_post(path, data):
    url = f"https://api.github.com/repos/{GITHUB_REPO}/{path}"
    return _req("POST", url, data=data, headers=GH_HEADERS)


def gh_get(path, params=""):
    url = f"https://api.github.com/repos/{GITHUB_REPO}/{path}"
    if params:
        url += f"?{params}"
    return _req("GET", url, headers=GH_HEADERS)


# ── Ensure label exists ────────────────────────────────────────────
def ensure_label(name, color, description=""):
    try:
        gh_post("labels", {"name": name, "color": color, "description": description})
    except urllib.error.HTTPError as e:
        if e.code != 422:  # 422 = already exists
            raise


# ── Claude summary ──────────────────────────────────────────────────
def generate_summary(feedback_items):
    if not feedback_items:
        return ""

    items_text = "\n".join(
        f"- [{item['category']}][{item['priority']}] {item.get('ai_summary') or item['message'][:100]}"
        for item in feedback_items
    )

    data = {
        "model": CLAUDE_MODEL,
        "max_tokens": 500,
        "messages": [{
            "role": "user",
            "content": f"""Here is today's player feedback for Uncivilized (a 4X strategy game).
Write a brief executive summary (3-5 sentences) highlighting the main themes,
most urgent issues, and any patterns you notice. Be direct and actionable.

{items_text}"""
        }],
    }

    result = _req("POST", "https://api.anthropic.com/v1/messages", data=data, headers={
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    })
    return result["content"][0]["text"].strip()


# ── Build issue body ───────────────────────────────────────────────
def build_issue_body(feedback_items, summary):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    total = len(feedback_items)

    by_category = defaultdict(list)
    for item in feedback_items:
        by_category[item.get("category", "other")].append(item)

    # Count by priority across all categories
    by_priority = defaultdict(int)
    for item in feedback_items:
        by_priority[item.get("priority", "medium")] += 1

    priority_line = " · ".join(
        f"{PRIORITY_EMOJI.get(p, '⚪')} {by_priority[p]} {p}"
        for p in ["critical", "high", "medium", "low"]
        if by_priority[p] > 0
    )

    lines = [
        f"## Player Feedback Digest — {today}",
        "",
        f"**{total} new feedback items** — {priority_line}",
        "",
    ]

    if summary:
        lines += ["### Summary", "", summary, ""]

    for cat in CATEGORY_ORDER:
        items = by_category.get(cat, [])
        if not items:
            continue
        items.sort(key=lambda x: PRIORITY_ORDER.get(x.get("priority", "medium"), 2))
        label = CATEGORY_LABELS.get(cat, cat)
        lines += [f"### {label} ({len(items)})", ""]

        for item in items:
            pri = item.get("priority", "medium")
            emoji = PRIORITY_EMOJI.get(pri, "⚪")
            summary_text = item.get("ai_summary") or item["message"][:120]
            player = item.get("player_name") or "anonymous"
            created = item.get("created_at", "")[:10]
            lines.append(f"- {emoji} **[{pri}]** {summary_text} — _{player}_ ({created})")

        lines.append("")

    lines += [
        "---",
        f"_Auto-generated by feedback-digest on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}_",
    ]

    return "\n".join(lines)


# ── Main ────────────────────────────────────────────────────────────
def main():
    print("Fetching new feedback from Supabase...")
    feedback = sb_get(
        "feedback",
        select="id,visitor_id,player_name,message,category,priority,ai_summary,status,created_at",
        filters="status=eq.new",
        order="created_at.desc",
        limit=200,
    )

    if not feedback:
        print("No new feedback to digest. Exiting.")
        return

    print(f"Found {len(feedback)} new feedback items.")

    print("Generating AI summary...")
    summary = ""
    try:
        summary = generate_summary(feedback)
    except Exception as e:
        print(f"Warning: Claude summary failed ({e}), continuing without it.")

    body = build_issue_body(feedback, summary)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    title = f"Feedback Digest — {today} ({len(feedback)} items)"

    if DRY_RUN:
        print(f"\n[DRY RUN] Would create issue: {title}")
        print(f"\n{body}")
        return

    print("Creating GitHub issue...")
    ensure_label("feedback-digest", "c5def5", "Daily player feedback digest")
    issue = gh_post("issues", {
        "title": title,
        "body": body,
        "labels": ["feedback-digest"],
    })
    print(f"Created issue #{issue['number']}: {issue['html_url']}")

    print("Marking feedback as digested...")
    feedback_ids = [item["id"] for item in feedback]
    # Batch update via PostgREST IN filter
    id_list = ",".join(f'"{fid}"' for fid in feedback_ids)
    sb_patch("feedback", {"status": "digested"}, f"id=in.({id_list})")
    print(f"Marked {len(feedback_ids)} items as digested.")


if __name__ == "__main__":
    main()
