#!/usr/bin/env python3
"""
Feedback Digest — daily summary of player feedback, categorised and prioritised.

Runs every morning via GitHub Actions. Fetches the last 24h of feedback from
Supabase, groups by category and priority, uses Claude to write a readable
summary, and posts a GitHub issue tagged 'feedback-digest'.

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN
"""

import os
import sys
import json
import time
import re
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

# ── Config ──────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GITHUB_REPO = os.environ.get("GITHUB_REPO", "uncivilised-game/uncivilised-game-base")
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

LOOKBACK_HOURS = int(os.environ.get("LOOKBACK_HOURS", "24"))

CATEGORY_LABELS = {
    "bug_report": "Bug Reports",
    "feature_request": "Feature Requests",
    "gameplay_feedback": "Gameplay Feedback",
    "question": "Questions",
    "other": "Other",
}

CATEGORY_EMOJI = {
    "bug_report": "\U0001f41b",
    "feature_request": "\u2728",
    "gameplay_feedback": "\U0001f3ae",
    "question": "\u2753",
    "other": "\U0001f4ac",
}

PRIORITY_ORDER = ["critical", "high", "medium", "low"]

PRIORITY_EMOJI = {
    "critical": "\U0001f534",
    "high": "\U0001f7e0",
    "medium": "\U0001f7e1",
    "low": "\U0001f7e2",
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


# ── Fetch feedback ──────────────────────────────────────────────────
def fetch_recent_feedback():
    """Fetch feedback from the last LOOKBACK_HOURS hours."""
    since = (datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)).isoformat()
    params = (
        f"created_at=gte.{since}"
        f"&select=id,visitor_id,player_name,message,category,priority,ai_summary,created_at,game_state_snapshot"
        f"&order=created_at.desc"
    )
    rows = sb_get("feedback", params)
    if not isinstance(rows, list):
        print(f"Unexpected response from Supabase: {rows}", file=sys.stderr)
        return []
    return rows


# ── Group and analyse ───────────────────────────────────────────────
def group_feedback(items):
    """Group feedback by category, then sort within each by priority."""
    groups = {}
    for item in items:
        cat = item.get("category") or "other"
        groups.setdefault(cat, []).append(item)

    # Sort each group: critical first, then high, medium, low
    priority_rank = {p: i for i, p in enumerate(PRIORITY_ORDER)}
    for cat in groups:
        groups[cat].sort(key=lambda x: priority_rank.get(x.get("priority", "medium"), 2))

    return groups


def build_stats(items):
    """Build summary statistics."""
    by_category = {}
    by_priority = {}
    unique_players = set()

    for item in items:
        cat = item.get("category") or "other"
        pri = item.get("priority") or "medium"
        by_category[cat] = by_category.get(cat, 0) + 1
        by_priority[pri] = by_priority.get(pri, 0) + 1
        player = item.get("player_name")
        if player:
            unique_players.add(player)

    return {
        "total": len(items),
        "by_category": by_category,
        "by_priority": by_priority,
        "unique_players": len(unique_players),
    }


# ── Claude summary ──────────────────────────────────────────────────
def generate_ai_summary(items, stats, groups):
    """Use Claude to generate a high-level executive summary of the day's feedback."""
    # Build a condensed view of all feedback for Claude
    feedback_lines = []
    for cat in ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]:
        if cat not in groups:
            continue
        feedback_lines.append(f"\n## {CATEGORY_LABELS.get(cat, cat)} ({len(groups[cat])})")
        for item in groups[cat]:
            player = item.get("player_name") or "anon"
            pri = item.get("priority", "medium")
            summary = item.get("ai_summary") or (item.get("message") or "")[:120]
            feedback_lines.append(f"- [{pri}] {player}: {summary}")

    feedback_text = "\n".join(feedback_lines)

    result = _req("POST", "https://api.anthropic.com/v1/messages", data={
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 600,
        "messages": [{
            "role": "user",
            "content": f"""You are summarising player feedback for Uncivilised, a browser-based 4X strategy game.

Here are the last {LOOKBACK_HOURS} hours of player feedback ({stats['total']} items from {stats['unique_players']} unique players):
{feedback_text}

Write a concise executive summary (3-5 bullet points) highlighting:
1. The most urgent/critical issues players are hitting
2. The most requested features or common themes
3. Any patterns worth noting (e.g. multiple players reporting the same thing)
4. Overall sentiment

Keep it brief and actionable. Use plain text, no markdown headers. Start each bullet with a dash."""
        }],
    }, headers={
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    })

    return result["content"][0]["text"].strip()


# ── Format the issue ────────────────────────────────────────────────
def format_issue_body(items, stats, groups, ai_summary):
    """Format the GitHub issue body."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=LOOKBACK_HOURS)

    lines = []
    lines.append(f"**Period:** {since.strftime('%d %b %Y %H:%M')} — {now.strftime('%d %b %Y %H:%M')} UTC")
    lines.append(f"**Total feedback:** {stats['total']} from {stats['unique_players']} unique players")
    lines.append("")

    # Priority breakdown
    pri_parts = []
    for pri in PRIORITY_ORDER:
        count = stats["by_priority"].get(pri, 0)
        if count:
            pri_parts.append(f"{PRIORITY_EMOJI.get(pri, '')} {pri}: {count}")
    if pri_parts:
        lines.append("**Priority breakdown:** " + " | ".join(pri_parts))
        lines.append("")

    # AI summary
    lines.append("## Summary")
    lines.append("")
    lines.append(ai_summary)
    lines.append("")

    # Detailed breakdown by category
    lines.append("## Detailed Breakdown")
    lines.append("")

    for cat in ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]:
        if cat not in groups:
            continue

        emoji = CATEGORY_EMOJI.get(cat, "")
        label = CATEGORY_LABELS.get(cat, cat)
        cat_items = groups[cat]

        lines.append(f"### {emoji} {label} ({len(cat_items)})")
        lines.append("")

        for item in cat_items:
            player = item.get("player_name") or "anonymous"
            pri = item.get("priority", "medium")
            pri_icon = PRIORITY_EMOJI.get(pri, "")
            summary = item.get("ai_summary") or (item.get("message") or "")[:120]
            msg = (item.get("message") or "")[:200]
            created = item.get("created_at", "")
            time_str = ""
            if created:
                try:
                    dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                    time_str = dt.strftime("%H:%M UTC")
                except (ValueError, TypeError):
                    pass

            lines.append(f"- {pri_icon} **{pri}** | {player} | {time_str}")
            lines.append(f"  > {summary}")

            # Show full message in collapsed detail if it differs from summary
            if msg and msg != summary and len(msg) > len(summary):
                lines.append(f"  <details><summary>Full message</summary>{msg}</details>")
            lines.append("")

    # Footer
    lines.append("---")
    lines.append(f"*Auto-generated by feedback-digest at {now.strftime('%Y-%m-%d %H:%M UTC')}*")

    return "\n".join(lines)


# ── Main ────────────────────────────────────────────────────────────
def main():
    print(f"=== Feedback Digest === {datetime.now(timezone.utc).isoformat()}")
    print(f"Looking back {LOOKBACK_HOURS} hours | DRY_RUN={DRY_RUN}")

    # 1. Fetch recent feedback
    items = fetch_recent_feedback()
    print(f"Fetched {len(items)} feedback items")

    if not items:
        print("No feedback in the last 24h — skipping digest.")
        return

    # 2. Group and compute stats
    groups = group_feedback(items)
    stats = build_stats(items)

    print(f"Categories: {stats['by_category']}")
    print(f"Priorities: {stats['by_priority']}")
    print(f"Unique players: {stats['unique_players']}")

    # 3. Generate AI summary
    print("Generating AI summary...")
    ai_summary = generate_ai_summary(items, stats, groups)
    print(f"Summary:\n{ai_summary}\n")

    # 4. Format the issue
    now = datetime.now(timezone.utc)
    title = f"Feedback Digest — {now.strftime('%d %b %Y')}"
    body = format_issue_body(items, stats, groups, ai_summary)

    if DRY_RUN:
        print(f"\n[DRY RUN] Would create issue: {title}")
        print(f"\n{body}")
        return

    # 5. Check for existing digest today (avoid duplicates)
    today_str = now.strftime("%d %b %Y")
    existing = gh_get(
        f"/repos/{GITHUB_REPO}/issues?labels=feedback-digest&state=open&per_page=10"
    )
    for issue in (existing if isinstance(existing, list) else []):
        if today_str in issue.get("title", ""):
            print(f"Digest already exists for today: #{issue['number']} — skipping.")
            return

    # 6. Create the issue
    print(f"Creating issue: {title}")
    result = gh_post(f"/repos/{GITHUB_REPO}/issues", {
        "title": title,
        "body": body,
        "labels": ["feedback-digest"],
    })
    issue_num = result.get("number", "?")
    print(f"Created issue #{issue_num}: {result.get('html_url', '')}")


if __name__ == "__main__":
    main()
