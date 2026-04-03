#!/usr/bin/env python3
"""
Daily Feedback Digest — summarises player feedback from the last 24 hours.

Posts a categorised, prioritised GitHub issue each morning.
Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

# ── Config ──────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GITHUB_REPO = os.environ.get("GITHUB_REPO", "uncivilised-game/uncivilised-game-base")
HOURS = int(os.environ.get("DIGEST_HOURS", "24"))

CATEGORY_EMOJI = {
    "bug_report": "🐛",
    "feature_request": "✨",
    "gameplay_feedback": "🎮",
    "question": "❓",
    "other": "💬",
}

PRIORITY_ORDER = ["critical", "high", "medium", "low"]


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


# ── Fetch feedback ─────────────────────────────────────────────────
def fetch_recent_feedback(hours):
    """Fetch feedback from the last N hours."""
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    params = (
        f"select=id,visitor_id,player_name,message,category,priority,ai_summary,game_state_snapshot,created_at"
        f"&created_at=gte.{since}"
        f"&order=created_at.desc"
    )
    return sb_get("feedback", params)


# ── Categorise & group ──────────────────────────────────────────────
def group_feedback(items):
    """Group feedback by category, then sort by priority within each."""
    groups = {}
    for item in items:
        cat = item.get("category") or "other"
        groups.setdefault(cat, []).append(item)

    # Sort each group by priority
    for cat in groups:
        groups[cat].sort(key=lambda x: PRIORITY_ORDER.index(x.get("priority", "low"))
                         if x.get("priority") in PRIORITY_ORDER else 99)
    return groups


def build_stats(items):
    """Build summary statistics."""
    by_category = {}
    by_priority = {}
    unique_players = set()

    for item in items:
        cat = item.get("category") or "other"
        pri = item.get("priority") or "unknown"
        by_category[cat] = by_category.get(cat, 0) + 1
        by_priority[pri] = by_priority.get(pri, 0) + 1
        unique_players.add(item.get("visitor_id", ""))

    return {
        "total": len(items),
        "unique_players": len(unique_players),
        "by_category": by_category,
        "by_priority": by_priority,
    }


# ── AI summary ──────────────────────────────────────────────────────
def generate_ai_summary(items, stats):
    """Use Claude to generate a concise executive summary of the feedback."""
    # Build a condensed view for the prompt
    feedback_lines = []
    for item in items:
        summary = item.get("ai_summary") or (item.get("message") or "")[:120]
        player = item.get("player_name") or "anonymous"
        feedback_lines.append(
            f"- [{item.get('priority','?')}] [{item.get('category','?')}] {summary} (player: {player})"
        )

    prompt = f"""You are summarising player feedback for a 4X strategy browser game called Uncivilised.

Here are {stats['total']} feedback items from the last {HOURS} hours from {stats['unique_players']} unique players:

{chr(10).join(feedback_lines)}

Write a concise executive summary (3-6 sentences) highlighting:
1. The most critical/urgent issues players are facing
2. The most requested features
3. Any patterns or recurring themes
4. An overall sentiment read

Then list the top 3-5 actionable items, ordered by priority. Be specific and direct."""

    result = _req("POST", "https://api.anthropic.com/v1/messages", data={
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 800,
        "messages": [{"role": "user", "content": prompt}],
    }, headers={
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    })

    return result["content"][0]["text"]


# ── Build issue body ────────────────────────────────────────────────
def build_issue_body(items, stats, ai_summary):
    """Build the GitHub issue markdown body."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=HOURS)

    lines = []
    lines.append(f"**Period:** {since.strftime('%Y-%m-%d %H:%M')} → {now.strftime('%Y-%m-%d %H:%M')} UTC")
    lines.append(f"**Total feedback:** {stats['total']} from {stats['unique_players']} unique players")
    lines.append("")

    # Priority breakdown
    pri_parts = []
    for pri in PRIORITY_ORDER:
        count = stats["by_priority"].get(pri, 0)
        if count:
            pri_parts.append(f"**{pri}:** {count}")
    if pri_parts:
        lines.append("**By priority:** " + " · ".join(pri_parts))

    # Category breakdown
    cat_parts = []
    for cat, count in sorted(stats["by_category"].items(), key=lambda x: -x[1]):
        emoji = CATEGORY_EMOJI.get(cat, "📝")
        lines.append(f"  {emoji} {cat.replace('_', ' ')}: {count}")
    lines.append("")

    # AI summary
    lines.append("## Summary")
    lines.append("")
    lines.append(ai_summary)
    lines.append("")

    # Detailed breakdown by category
    grouped = group_feedback(items)
    category_order = ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]

    for cat in category_order:
        cat_items = grouped.get(cat)
        if not cat_items:
            continue

        emoji = CATEGORY_EMOJI.get(cat, "📝")
        lines.append(f"## {emoji} {cat.replace('_', ' ').title()} ({len(cat_items)})")
        lines.append("")

        for item in cat_items:
            pri = item.get("priority", "?")
            summary = item.get("ai_summary") or (item.get("message") or "")[:120]
            player = item.get("player_name") or "anonymous"
            pri_badge = f"`{pri}`"

            lines.append(f"- {pri_badge} {summary}")
            if item.get("player_name"):
                lines.append(f"  — *{player}*")

        lines.append("")

    return "\n".join(lines)


# ── Post GitHub issue ───────────────────────────────────────────────
def post_github_issue(title, body, labels=None):
    """Create a GitHub issue."""
    url = f"https://api.github.com/repos/{GITHUB_REPO}/issues"
    data = {"title": title, "body": body}
    if labels:
        data["labels"] = labels
    result = _req("POST", url, data=data, headers={
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    return result


# ── Main ────────────────────────────────────────────────────────────
def main():
    print(f"Fetching feedback from the last {HOURS} hours...")
    items = fetch_recent_feedback(HOURS)

    if not items:
        print("No feedback in the last 24 hours. Skipping digest.")
        return

    stats = build_stats(items)
    print(f"Found {stats['total']} items from {stats['unique_players']} players")
    print(f"  Categories: {stats['by_category']}")
    print(f"  Priorities: {stats['by_priority']}")

    # Generate AI summary
    print("Generating AI summary...")
    ai_summary = generate_ai_summary(items, stats)
    print(f"Summary:\n{ai_summary}\n")

    # Build and post issue
    now = datetime.now(timezone.utc)
    title = f"📋 Feedback Digest — {now.strftime('%a %d %b %Y')}"
    body = build_issue_body(items, stats, ai_summary)

    print("Posting GitHub issue...")
    result = post_github_issue(title, body, labels=["feedback-digest"])
    issue_url = result.get("html_url", "unknown")
    print(f"Posted: {issue_url}")


if __name__ == "__main__":
    main()
