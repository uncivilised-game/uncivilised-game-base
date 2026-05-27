#!/usr/bin/env python3
"""
Feedback Digest — daily summary of player feedback, categorised and prioritised.

Queries the last 24h of feedback from Supabase, groups by category and priority,
uses Claude to generate a digest, and posts it as a GitHub issue.

Runs daily via GitHub Actions (morning UTC) or manually.
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
DRY_RUN = os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes")

CATEGORY_LABELS = {
    "bug_report": "Bug Reports",
    "feature_request": "Feature Requests",
    "gameplay_feedback": "Gameplay Feedback",
    "question": "Questions",
    "other": "Other",
}

PRIORITY_ORDER = ["critical", "high", "medium", "low"]
PRIORITY_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}


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


# ── Fetch recent feedback ──────────────────────────────────────────
def fetch_feedback(since):
    since_iso = since.strftime("%Y-%m-%dT%H:%M:%S+00:00")
    params = (
        f"created_at=gte.{since_iso}"
        f"&select=id,player_name,message,category,priority,ai_summary,created_at"
        f"&order=priority.asc,created_at.desc"
    )
    return sb_get("feedback", params)


# ── Group and format ────────────────────────────────────────────────
def group_feedback(items):
    groups = {}
    for item in items:
        cat = item.get("category", "other")
        pri = item.get("priority", "medium")
        groups.setdefault(cat, {}).setdefault(pri, []).append(item)
    return groups


def format_feedback_for_claude(items, groups):
    lines = []
    lines.append(f"Total feedback items: {len(items)}")
    lines.append("")

    for cat in ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]:
        if cat not in groups:
            continue
        lines.append(f"## {CATEGORY_LABELS[cat]}")
        for pri in PRIORITY_ORDER:
            if pri not in groups[cat]:
                continue
            for item in groups[cat][pri]:
                player = item.get("player_name") or "anonymous"
                summary = item.get("ai_summary") or item.get("message", "")[:100]
                lines.append(f"- [{pri.upper()}] ({player}) {summary}")
        lines.append("")

    return "\n".join(lines)


def generate_digest(feedback_text, item_count, since):
    since_str = since.strftime("%Y-%m-%d %H:%M UTC")
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    result = _req("POST", "https://api.anthropic.com/v1/messages", data={
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 2000,
        "messages": [{"role": "user", "content": f"""You are summarising player feedback for the game Uncivilised (a browser-based 4X strategy game).

Here is the feedback received from {since_str} to {now_str} ({item_count} items):

{feedback_text}

Write a concise daily digest in markdown. Structure it as:

1. **Executive Summary** — 2-3 sentences on overall sentiment and the most important takeaways
2. **Critical/High Priority** — list anything urgent (bugs causing crashes, broken features, etc.)
3. **Top Feature Requests** — the most requested or impactful feature suggestions
4. **Gameplay Feedback Themes** — recurring themes in gameplay feedback
5. **Quick Wins** — small improvements that would have outsized impact

Keep it actionable. Use bullet points. If multiple players report the same thing, note the count. Skip empty sections."""}],
    }, headers={
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
    })

    return result["content"][0]["text"]


# ── GitHub issue ────────────────────────────────────────────────────
def create_github_issue(title, body, labels=None):
    url = f"https://api.github.com/repos/{GITHUB_REPO}/issues"
    data = {"title": title, "body": body}
    if labels:
        data["labels"] = labels
    return _req("POST", url, data=data, headers={
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })


# ── Main ────────────────────────────────────────────────────────────
def main():
    since = datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)
    print(f"Fetching feedback since {since.isoformat()} ({LOOKBACK_HOURS}h lookback)...")

    items = fetch_feedback(since)
    print(f"Found {len(items)} feedback items")

    if not items:
        print("No feedback in this period. Skipping digest.")
        return

    groups = group_feedback(items)
    feedback_text = format_feedback_for_claude(items, groups)

    cat_counts = {CATEGORY_LABELS[cat]: sum(len(pris) for pris in pgroups.values())
                  for cat, pgroups in groups.items()}
    critical_high = sum(
        len(groups.get(cat, {}).get(pri, []))
        for cat in groups for pri in ("critical", "high")
    )

    print("Generating AI digest...")
    digest = generate_digest(feedback_text, len(items), since)

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    title = f"Daily Feedback Digest — {date_str} ({len(items)} items)"

    stats_parts = [f"**{count}** {cat}" for cat, count in cat_counts.items() if count > 0]
    unique_players = len(set(item.get("player_name") or "anon" for item in items))

    body = f"""## Stats
- **Period:** last {LOOKBACK_HOURS}h ({since.strftime('%Y-%m-%d %H:%M')} — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC)
- **Total:** {len(items)} feedback items from {unique_players} unique players
- **Breakdown:** {', '.join(stats_parts)}
- **Critical/High:** {critical_high}

---

{digest}

---

### Raw Feedback

"""
    for cat in ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]:
        if cat not in groups:
            continue
        body += f"\n<details><summary>{CATEGORY_LABELS[cat]} ({sum(len(v) for v in groups[cat].values())})</summary>\n\n"
        for pri in PRIORITY_ORDER:
            for item in groups[cat].get(pri, []):
                emoji = PRIORITY_EMOJI.get(pri, "⚪")
                player = item.get("player_name") or "anonymous"
                msg = item.get("message", "").replace("\n", " ")[:200]
                ts = item.get("created_at", "")[:16]
                body += f"- {emoji} **[{pri.upper()}]** {msg} — *{player}* ({ts})\n"
        body += "\n</details>\n"

    body += "\n---\n*Auto-generated by the feedback digest pipeline.*"

    if DRY_RUN:
        print("\n=== DRY RUN — would create issue ===")
        print(f"Title: {title}")
        print(f"Body:\n{body}")
        return

    labels = ["feedback-digest"]
    if critical_high > 0:
        labels.append("priority:high")

    issue = create_github_issue(title, body, labels)
    print(f"Created issue #{issue['number']}: {issue.get('html_url', '')}")


if __name__ == "__main__":
    main()
