#!/usr/bin/env python3
"""
Feedback Digest — daily summary of player feedback, categorised and prioritised.

Posts a GitHub issue each morning with:
- New feedback from the last 24 hours grouped by category and priority
- Overall stats (total feedback, open issues, top themes)

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, GITHUB_TOKEN
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
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GITHUB_REPO = os.environ.get("GITHUB_REPO", "uncivilised-game/uncivilised-game-base")

LOOKBACK_HOURS = int(os.environ.get("LOOKBACK_HOURS", "24"))

CATEGORY_EMOJI = {
    "bug_report": "\U0001f41b",
    "feature_request": "\U0001f4a1",
    "gameplay_feedback": "\U0001f3ae",
    "question": "\u2753",
    "other": "\U0001f4ac",
}

CATEGORY_LABEL = {
    "bug_report": "Bug Reports",
    "feature_request": "Feature Requests",
    "gameplay_feedback": "Gameplay Feedback",
    "question": "Questions",
    "other": "Other",
}

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
PRIORITY_EMOJI = {"critical": "\U0001f534", "high": "\U0001f7e0", "medium": "\U0001f7e1", "low": "\U0001f7e2"}


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


def gh_api(method, endpoint, data=None):
    url = f"https://api.github.com/repos/{GITHUB_REPO}/{endpoint}"
    return _req(method, url, data=data, headers={
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })


# ── Fetch feedback ─────────────────────────────────────────────────
def fetch_recent_feedback(since):
    """Fetch all feedback created since the given datetime."""
    iso = since.strftime("%Y-%m-%dT%H:%M:%S+00:00")
    params = (
        f"select=id,player_name,message,category,priority,ai_summary,status,github_issue_number,created_at"
        f"&created_at=gte.{iso}"
        f"&order=created_at.desc"
    )
    return sb_get("feedback", params)


def fetch_pending_feedback():
    """Fetch feedback still in pending status (below conviction threshold)."""
    params = (
        f"select=id,player_name,message,category,priority,ai_summary,created_at"
        f"&status=eq.pending"
        f"&order=created_at.desc"
    )
    return sb_get("feedback", params)


def fetch_overall_stats():
    """Fetch summary counts by category and status."""
    params = "select=category,status,priority"
    return sb_get("feedback", params)


# ── Build digest ───────────────────────────────────────────────────
def group_by_category(feedback):
    """Group feedback items by category, sorted by priority within each group."""
    groups = {}
    for item in feedback:
        cat = item.get("category") or "other"
        groups.setdefault(cat, []).append(item)
    # Sort each group by priority
    for cat in groups:
        groups[cat].sort(key=lambda x: PRIORITY_ORDER.get(x.get("priority", "medium"), 2))
    return groups


def build_digest(recent, pending, all_feedback):
    """Build the markdown digest body."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=LOOKBACK_HOURS)

    lines = []

    # ── Header stats ───────────────────────────────────────────────
    total_all_time = len(all_feedback)
    total_new = len([f for f in all_feedback if f["status"] == "new"])
    total_pending = len([f for f in all_feedback if f["status"] == "pending"])
    total_processed = len([f for f in all_feedback if f["status"] == "processed"])

    lines.append(f"**Period:** last {LOOKBACK_HOURS} hours (since {since.strftime('%Y-%m-%d %H:%M UTC')})")
    lines.append(f"**New feedback received:** {len(recent)}")
    lines.append("")
    lines.append(f"> **All-time totals** — {total_all_time} total | {total_new} new | {total_pending} pending | {total_processed} processed")
    lines.append("")

    if not recent:
        lines.append("No new feedback in this period. :tada:")
        return "\n".join(lines)

    # ── Priority summary ──────────────────────────────────────────
    priority_counts = {}
    for item in recent:
        p = item.get("priority", "medium")
        priority_counts[p] = priority_counts.get(p, 0) + 1

    priority_parts = []
    for p in ["critical", "high", "medium", "low"]:
        if priority_counts.get(p):
            priority_parts.append(f"{PRIORITY_EMOJI.get(p, '')} {p}: {priority_counts[p]}")
    if priority_parts:
        lines.append("### Priority Breakdown")
        lines.append(" | ".join(priority_parts))
        lines.append("")

    # ── Feedback by category ──────────────────────────────────────
    groups = group_by_category(recent)

    # Order categories: bugs first, then features, gameplay, questions, other
    cat_order = ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]
    for cat in cat_order:
        items = groups.get(cat)
        if not items:
            continue

        emoji = CATEGORY_EMOJI.get(cat, "")
        label = CATEGORY_LABEL.get(cat, cat)
        lines.append(f"### {emoji} {label} ({len(items)})")
        lines.append("")

        for item in items:
            priority = item.get("priority", "medium")
            p_emoji = PRIORITY_EMOJI.get(priority, "")
            summary = item.get("ai_summary") or item.get("message", "")[:100]
            player = item.get("player_name") or "anonymous"
            issue_num = item.get("github_issue_number")

            issue_ref = f" → #{issue_num}" if issue_num else ""
            lines.append(f"- {p_emoji} **[{priority}]** {summary} — *{player}*{issue_ref}")

        lines.append("")

    # ── Pending feedback (awaiting more signal) ───────────────────
    if pending:
        lines.append(f"### \u23f3 Pending Feedback ({len(pending)} items awaiting conviction threshold)")
        lines.append("")
        pending_by_cat = group_by_category(pending)
        for cat in cat_order:
            items = pending_by_cat.get(cat)
            if not items:
                continue
            label = CATEGORY_LABEL.get(cat, cat)
            lines.append(f"**{label}:** {len(items)} pending")
        lines.append("")

    # ── Unique reporters ──────────────────────────────────────────
    reporters = set()
    for item in recent:
        name = item.get("player_name")
        if name:
            reporters.add(name)

    if reporters:
        lines.append(f"### \U0001f465 Unique Reporters ({len(reporters)})")
        lines.append(", ".join(sorted(reporters)))
        lines.append("")

    return "\n".join(lines)


# ── Main ───────────────────────────────────────────────────────────
def main():
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=LOOKBACK_HOURS)

    print(f"Fetching feedback from last {LOOKBACK_HOURS} hours...")
    recent = fetch_recent_feedback(since)
    print(f"  → {len(recent)} new items")

    pending = fetch_pending_feedback()
    print(f"  → {len(pending)} pending items")

    all_feedback = fetch_overall_stats()
    print(f"  → {len(all_feedback)} total items all-time")

    body = build_digest(recent, pending, all_feedback)

    date_str = now.strftime("%Y-%m-%d")
    title = f"Feedback Digest — {date_str}"

    # Check if a digest for today already exists
    existing = gh_api("GET", f"issues?labels=feedback-digest&state=open&per_page=5")
    for issue in existing:
        if date_str in issue.get("title", ""):
            print(f"Digest for {date_str} already exists (#{issue['number']}), updating...")
            gh_api("PATCH", f"issues/{issue['number']}", {"body": body})
            print(f"Updated: {issue['html_url']}")
            return

    # Create new issue
    issue = gh_api("POST", "issues", {
        "title": title,
        "body": body,
        "labels": ["feedback-digest"],
    })
    print(f"Created: {issue.get('html_url', issue)}")

    # Close yesterday's digest
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    for issue in existing:
        if yesterday in issue.get("title", ""):
            gh_api("PATCH", f"issues/{issue['number']}", {"state": "closed"})
            print(f"Closed yesterday's digest #{issue['number']}")


if __name__ == "__main__":
    main()
