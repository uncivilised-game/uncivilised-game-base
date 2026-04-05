#!/usr/bin/env python3
"""
Feedback Digest — generates a daily categorised summary of player feedback.

Runs every morning via GitHub Actions. Queries the last 24 hours of feedback
from Supabase, groups by category and priority, and posts a summary issue.

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

LOOKBACK_HOURS = int(os.environ.get("LOOKBACK_HOURS", "24"))

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
CATEGORY_EMOJI = {
    "bug_report": "🐛",
    "feature_request": "💡",
    "gameplay_feedback": "🎮",
    "question": "❓",
    "other": "📝",
}
CATEGORY_LABEL = {
    "bug_report": "Bug Reports",
    "feature_request": "Feature Requests",
    "gameplay_feedback": "Gameplay Feedback",
    "question": "Questions",
    "other": "Other",
}


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


def sb_get(path, params=""):
    url = f"{SUPABASE_URL}/rest/v1/{path}?{params}" if params else f"{SUPABASE_URL}/rest/v1/{path}"
    return _req("GET", url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })


def claude_message(system, user_text, max_tokens=2000):
    return _req("POST", "https://api.anthropic.com/v1/messages", data={
        "model": "claude-sonnet-4-20250514",
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user_text}],
    }, headers={
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
    })


def gh_create_issue(title, body, labels):
    return _req("POST", f"https://api.github.com/repos/{GITHUB_REPO}/issues", data={
        "title": title,
        "body": body,
        "labels": labels,
    }, headers={
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
    })


# ── Main logic ──────────────────────────────────────────────────────
def fetch_recent_feedback():
    """Fetch all feedback from the last LOOKBACK_HOURS."""
    since = (datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)).isoformat()
    params = (
        f"select=id,message,category,priority,ai_summary,player_name,status,game_state_snapshot,created_at"
        f"&created_at=gte.{since}"
        f"&order=created_at.desc"
    )
    return sb_get("feedback", params)


def fetch_totals():
    """Fetch total unresolved feedback counts by status."""
    params = "select=id,status,category&status=in.(new,pending)"
    rows = sb_get("feedback", params)
    totals = {"new": 0, "pending": 0}
    by_category = {}
    for r in rows:
        totals[r.get("status", "new")] = totals.get(r.get("status", "new"), 0) + 1
        cat = r.get("category", "other")
        by_category[cat] = by_category.get(cat, 0) + 1
    return totals, by_category


def group_feedback(feedback):
    """Group feedback by category, sorted by priority within each group."""
    groups = {}
    for item in feedback:
        cat = item.get("category") or "other"
        groups.setdefault(cat, []).append(item)

    # Sort each group by priority
    for cat in groups:
        groups[cat].sort(key=lambda x: PRIORITY_ORDER.get(x.get("priority", "medium"), 2))

    return groups


def build_markdown(feedback, groups, totals, backlog_by_category):
    """Build the GitHub issue markdown body."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    total_new, total_pending = totals.get("new", 0), totals.get("pending", 0)

    lines = []
    lines.append(f"Daily feedback digest for **{today}** — "
                 f"**{len(feedback)}** new items in the last {LOOKBACK_HOURS}h.\n")

    # Backlog summary
    lines.append(f"**Backlog:** {total_new} new + {total_pending} pending = "
                 f"{total_new + total_pending} unresolved total\n")

    if not feedback:
        lines.append("No new feedback in this period. 🎉")
        return "\n".join(lines)

    # Quick stats
    priority_counts = {}
    for item in feedback:
        p = item.get("priority", "medium")
        priority_counts[p] = priority_counts.get(p, 0) + 1

    stats_parts = []
    for p in ["critical", "high", "medium", "low"]:
        if priority_counts.get(p, 0) > 0:
            stats_parts.append(f"**{p}:** {priority_counts[p]}")
    lines.append("| " + " | ".join(stats_parts) + " |\n")

    # Category sections, ordered: bugs first, then features, gameplay, questions, other
    cat_order = ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]
    for cat in cat_order:
        items = groups.get(cat, [])
        if not items:
            continue

        emoji = CATEGORY_EMOJI.get(cat, "📝")
        label = CATEGORY_LABEL.get(cat, cat)
        backlog = backlog_by_category.get(cat, 0)
        lines.append(f"## {emoji} {label} ({len(items)} new, {backlog} backlog)\n")

        for item in items:
            priority = item.get("priority", "medium")
            badge = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}.get(priority, "⚪")
            summary = item.get("ai_summary") or item.get("message", "")[:80]
            player = item.get("player_name") or "anonymous"
            status = item.get("status", "new")
            lines.append(f"- {badge} **[{priority}]** {summary}")
            lines.append(f"  — *{player}* · status: `{status}`")

            # Include game context if available
            gs = item.get("game_state_snapshot")
            if gs and isinstance(gs, dict):
                ctx_parts = []
                if gs.get("turn"):
                    ctx_parts.append(f"turn {gs['turn']}")
                if gs.get("score"):
                    ctx_parts.append(f"score {gs['score']}")
                if ctx_parts:
                    lines.append(f"  — game context: {', '.join(ctx_parts)}")

            lines.append("")

    return "\n".join(lines)


def generate_ai_insights(feedback, groups):
    """Use Claude to generate a brief insights summary."""
    if not feedback:
        return ""

    # Build a compact representation for Claude
    items_text = []
    for item in feedback:
        items_text.append(
            f"[{item.get('category','other')}|{item.get('priority','medium')}] "
            f"{item.get('ai_summary') or item.get('message','')[:100]}"
        )

    prompt = "\n".join(items_text)

    resp = claude_message(
        system=(
            "You are a game product analyst. Given today's player feedback for a 4X strategy game, "
            "write a brief analysis (3-5 bullet points). Focus on:\n"
            "- Recurring themes or patterns\n"
            "- Anything urgent that needs immediate attention\n"
            "- Sentiment trends (are players happy, frustrated?)\n"
            "- Actionable recommendations\n"
            "Keep it concise. Use markdown bullet points. No preamble."
        ),
        user_text=f"Today's feedback ({len(feedback)} items):\n\n{prompt}",
        max_tokens=500,
    )

    if resp and resp.get("content"):
        return resp["content"][0].get("text", "")
    return ""


def main():
    print(f"Fetching feedback from the last {LOOKBACK_HOURS} hours...")
    feedback = fetch_recent_feedback()
    print(f"Found {len(feedback)} feedback items.")

    totals, backlog_by_category = fetch_totals()
    groups = group_feedback(feedback)

    # Build the markdown report
    body = build_markdown(feedback, groups, totals, backlog_by_category)

    # Add AI insights if we have feedback
    if feedback:
        print("Generating AI insights...")
        insights = generate_ai_insights(feedback, groups)
        if insights:
            body += f"\n---\n\n## 🔍 AI Insights\n\n{insights}\n"

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    title = f"📋 Feedback Digest — {today}"

    # Check if we have any feedback worth posting
    if not feedback and totals.get("new", 0) == 0 and totals.get("pending", 0) == 0:
        print("No feedback to report. Skipping issue creation.")
        return

    print(f"Creating GitHub issue: {title}")
    result = gh_create_issue(title, body, ["feedback-digest"])
    print(f"Created issue #{result.get('number')}: {result.get('html_url')}")


if __name__ == "__main__":
    main()
