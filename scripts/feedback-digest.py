#!/usr/bin/env python3
"""
Feedback Digest — daily summary of player feedback, categorised and prioritised.

Queries Supabase for feedback from the last 24 hours (or custom window),
groups by category and priority, uses Claude to synthesise themes,
and creates a GitHub Issue as the daily digest.

Runs on a schedule (GitHub Actions) or manually.
Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN
Optional: DIGEST_HOURS=24, DRY_RUN=true
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from collections import Counter

# ── Config ──────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GITHUB_REPO = os.environ.get("GITHUB_REPO", "uncivilised-game/uncivilised-game-base")

DIGEST_HOURS = int(os.environ.get("DIGEST_HOURS", "24"))
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

CATEGORY_EMOJI = {
    "bug_report": "🐛",
    "feature_request": "✨",
    "gameplay_feedback": "🎮",
    "question": "❓",
    "other": "💬",
}

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


# ── HTTP helpers (no deps) ──────────────────────────────────────────
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


def sb_get(path, params=""):
    url = f"{SUPABASE_URL}/rest/v1/{path}?{params}" if params else f"{SUPABASE_URL}/rest/v1/{path}"
    return _req("GET", url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })


def gh_post(path, data):
    return _req("POST", f"https://api.github.com{path}", data=data, headers={
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })


# ── Claude synthesis ────────────────────────────────────────────────
def synthesise_digest(feedback_items):
    """Use Claude to synthesise themes and highlights from the day's feedback."""
    items_text = "\n".join(
        f"- [{fb.get('category', 'other')}][{fb.get('priority', 'medium')}] "
        f"{fb.get('player_name', 'anon')}: \"{fb.get('message', '')[:200]}\""
        for fb in feedback_items
    )

    result = _req("POST", "https://api.anthropic.com/v1/messages", data={
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 800,
        "messages": [{
            "role": "user",
            "content": f"""You are summarising player feedback for Uncivilised, a browser 4X strategy game.

Below are {len(feedback_items)} feedback items from the last {DIGEST_HOURS} hours.

{items_text}

Write a concise digest with these sections. Use markdown. Be direct and actionable.

1. **Key Themes** — 2-4 bullet points on the most common or important themes
2. **Action Items** — 1-3 specific things the dev team should look at today, prioritised by urgency
3. **Notable Quotes** — 1-2 standout player quotes that capture the sentiment well (include player name)

Keep the entire response under 300 words. No preamble."""
        }],
    }, headers={
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    })

    return result["content"][0]["text"].strip()


# ── Digest formatting ───────────────────────────────────────────────
def format_digest_body(feedback_items, synthesis, window_start, window_end):
    """Format the full GitHub Issue body for the digest."""
    total = len(feedback_items)
    by_category = Counter(fb.get("category", "other") for fb in feedback_items)
    by_priority = Counter(fb.get("priority", "medium") for fb in feedback_items)
    unique_reporters = set(fb.get("player_name", "anon") for fb in feedback_items if fb.get("player_name"))

    # Stats bar
    cat_parts = []
    for cat in ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]:
        count = by_category.get(cat, 0)
        if count > 0:
            cat_parts.append(f"{CATEGORY_EMOJI.get(cat, '💬')} {cat.replace('_', ' ').title()}: **{count}**")

    pri_parts = []
    for pri in ["critical", "high", "medium", "low"]:
        count = by_priority.get(pri, 0)
        if count > 0:
            pri_parts.append(f"{pri}: {count}")

    # Build category sections
    category_sections = []
    for cat in ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]:
        items = [fb for fb in feedback_items if fb.get("category", "other") == cat]
        if not items:
            continue
        items.sort(key=lambda fb: PRIORITY_ORDER.get(fb.get("priority", "medium"), 2))
        emoji = CATEGORY_EMOJI.get(cat, "💬")
        label = cat.replace("_", " ").title()
        lines = []
        for fb in items:
            pri = fb.get("priority", "medium")
            name = fb.get("player_name", "anon")
            msg = fb.get("message", "")[:150]
            summary = fb.get("ai_summary", "")
            display = summary if summary else msg
            pri_badge = f" `{pri}`" if pri in ("critical", "high") else ""
            lines.append(f"- **{name}**{pri_badge}: {display}")
        category_sections.append(f"### {emoji} {label} ({len(items)})\n\n" + "\n".join(lines))

    # Top reporters
    reporter_counts = Counter(fb.get("player_name", "anon") for fb in feedback_items if fb.get("player_name"))
    top_reporters = reporter_counts.most_common(5)
    top_reporters_text = ", ".join(f"{name} ({count})" for name, count in top_reporters) if top_reporters else "—"

    return f"""**{total} feedback items** from {len(unique_reporters)} unique players
**Period:** {window_start.strftime('%Y-%m-%d %H:%M')} → {window_end.strftime('%Y-%m-%d %H:%M')} UTC

{' · '.join(cat_parts)}
**Priority breakdown:** {', '.join(pri_parts)}

---

## Synthesis

{synthesis}

---

## All Feedback by Category

{chr(10).join(category_sections)}

---

### Stats
- **Unique reporters:** {len(unique_reporters)}
- **Top reporters:** {top_reporters_text}

---
*Auto-generated by feedback digest pipeline.*"""


# ── Main pipeline ──────────────────────────────────────────────────
def run():
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=DIGEST_HOURS)
    date_label = now.strftime("%Y-%m-%d")

    print(f"=== Feedback Digest — {date_label} ===")
    print(f"Window: last {DIGEST_HOURS}h ({window_start.isoformat()} → {now.isoformat()})")

    # 1. Fetch feedback from the time window
    iso_start = window_start.isoformat()
    feedback = sb_get(
        "feedback",
        f"created_at=gte.{iso_start}"
        f"&select=id,message,category,priority,ai_summary,player_name,game_state_snapshot,created_at,status"
        f"&order=created_at.desc"
    )
    print(f"Found {len(feedback)} feedback items in window")

    if not feedback:
        print("No feedback to digest. Done.")
        return

    # 2. Synthesise with Claude
    print("Synthesising themes with Claude...")
    synthesis = synthesise_digest(feedback)
    print("Synthesis complete.")

    # 3. Format the digest
    body = format_digest_body(feedback, synthesis, window_start, now)
    title = f"Feedback Digest — {date_label}"

    # Count critical/high for labels
    priorities = [fb.get("priority", "medium") for fb in feedback]
    labels = ["feedback-digest"]
    if "critical" in priorities:
        labels.append("priority:critical")
    elif "high" in priorities:
        labels.append("priority:high")

    if DRY_RUN:
        print(f"\n[DRY RUN] Would create issue: {title}")
        print(f"Labels: {labels}")
        print(f"\n{body}")
        return

    # 4. Create GitHub Issue
    print(f"Creating digest issue: {title}")
    issue = gh_post(f"/repos/{GITHUB_REPO}/issues", {
        "title": title,
        "body": body,
        "labels": labels,
    })
    print(f"Created issue #{issue['number']}: {issue['html_url']}")

    print(f"\n=== Done. {len(feedback)} items digested. ===")


if __name__ == "__main__":
    run()
