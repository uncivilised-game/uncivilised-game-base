#!/usr/bin/env python3
"""
Feedback Digest — sends a daily categorised summary of player feedback.

Runs on a cron schedule (daily at 8am UTC). Queries all feedback from the
last 24 hours, groups by category and priority, and emails a formatted
digest to the configured recipient.

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, DIGEST_EMAIL
Optional: DRY_RUN=true, HOURS=24 (lookback window)
"""

import os
import sys
import json
import time
import html
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from collections import defaultdict

# ── Config ──────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
RESEND_API_KEY = os.environ["RESEND_API_KEY"]
DIGEST_EMAIL = os.environ["DIGEST_EMAIL"]
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"
HOURS = int(os.environ.get("HOURS", "24"))

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"
REPLY_TO_EMAIL = "hello@uncivilized.fun"

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
CATEGORY_LABELS = {
    "bug_report": "Bug Reports",
    "feature_request": "Feature Requests",
    "gameplay_feedback": "Gameplay Feedback",
    "question": "Questions",
    "other": "Other",
}
PRIORITY_EMOJI = {
    "critical": "🔴",
    "high": "🟠",
    "medium": "🟡",
    "low": "🟢",
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
            with urllib.request.urlopen(req, timeout=30) as resp:
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


# ── Fetch feedback ──────────────────────────────────────────────────
def fetch_recent_feedback():
    since = (datetime.now(timezone.utc) - timedelta(hours=HOURS)).isoformat()
    rows = sb_get(
        "feedback",
        f"select=id,player_name,message,category,priority,ai_summary,game_state_snapshot,created_at"
        f"&created_at=gte.{since}"
        f"&order=created_at.desc"
    )
    return rows if isinstance(rows, list) else []


# ── Build digest ────────────────────────────────────────────────────
def build_digest(feedback):
    by_category = defaultdict(list)
    for item in feedback:
        cat = item.get("category") or "other"
        by_category[cat].append(item)

    for cat_items in by_category.values():
        cat_items.sort(key=lambda x: PRIORITY_ORDER.get(x.get("priority", "low"), 3))

    return by_category


def format_time(iso_str):
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%H:%M UTC")
    except Exception:
        return ""


def build_stats(feedback, by_category):
    total = len(feedback)
    by_priority = defaultdict(int)
    for item in feedback:
        by_priority[item.get("priority", "unknown")] += 1

    lines = [f"**{total} feedback items** in the last {HOURS} hours\n"]
    if by_priority:
        parts = []
        for pri in ["critical", "high", "medium", "low"]:
            count = by_priority.get(pri, 0)
            if count:
                parts.append(f"{PRIORITY_EMOJI.get(pri, '⚪')} {pri.title()}: {count}")
        if parts:
            lines.append(" · ".join(parts))

    cat_parts = []
    for cat_key in ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]:
        count = len(by_category.get(cat_key, []))
        if count:
            cat_parts.append(f"{CATEGORY_LABELS.get(cat_key, cat_key)}: {count}")
    if cat_parts:
        lines.append(" · ".join(cat_parts))

    return "\n".join(lines)


def build_html(feedback, by_category):
    now = datetime.now(timezone.utc).strftime("%A %d %B %Y")
    stats_text = build_stats(feedback, by_category)

    sections = []
    category_order = ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]

    for cat_key in category_order:
        items = by_category.get(cat_key, [])
        if not items:
            continue

        label = CATEGORY_LABELS.get(cat_key, cat_key)
        rows = []
        for item in items:
            pri = item.get("priority", "unknown")
            emoji = PRIORITY_EMOJI.get(pri, "⚪")
            summary = html.escape(item.get("ai_summary") or (item.get("message") or "")[:120])
            player = html.escape(item.get("player_name") or "Anonymous")
            t = format_time(item.get("created_at", ""))
            game_state = item.get("game_state_snapshot") or {}
            turn_info = f" · Turn {game_state['turn']}" if isinstance(game_state, dict) and game_state.get("turn") else ""

            rows.append(
                f'<tr>'
                f'<td style="padding:8px 12px;border-bottom:1px solid #eee;">{emoji} {pri.title()}</td>'
                f'<td style="padding:8px 12px;border-bottom:1px solid #eee;">{summary}</td>'
                f'<td style="padding:8px 12px;border-bottom:1px solid #eee;color:#888;">{player}{turn_info}<br>{t}</td>'
                f'</tr>'
            )

        sections.append(
            f'<h2 style="color:#333;margin:24px 0 8px;font-size:18px;">{label} ({len(items)})</h2>'
            f'<table style="width:100%;border-collapse:collapse;font-size:14px;">'
            f'<tr style="background:#f5f5f5;text-align:left;">'
            f'<th style="padding:8px 12px;width:100px;">Priority</th>'
            f'<th style="padding:8px 12px;">Summary</th>'
            f'<th style="padding:8px 12px;width:140px;">Player</th>'
            f'</tr>'
            f'{"".join(rows)}'
            f'</table>'
        )

    stats_html = stats_text.replace("\n", "<br>").replace("**", "<strong>", 1).replace("**", "</strong>", 1)

    return f"""\
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#333;">
  <h1 style="color:#222;font-size:22px;margin-bottom:4px;">Player Feedback Digest</h1>
  <p style="color:#888;margin-top:0;">{now}</p>
  <div style="background:#f8f9fa;padding:16px;border-radius:8px;margin-bottom:24px;">
    {stats_html}
  </div>
  {"".join(sections)}
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px;">
  <p style="color:#aaa;font-size:12px;">
    Feedback Digest · <a href="https://uncivilized.fun" style="color:#aaa;">uncivilized.fun</a>
  </p>
</body>
</html>"""


def build_text(feedback, by_category):
    now = datetime.now(timezone.utc).strftime("%A %d %B %Y")
    lines = [f"Player Feedback Digest — {now}", "=" * 50, ""]

    stats = build_stats(feedback, by_category)
    lines.append(stats.replace("**", ""))
    lines.append("")

    category_order = ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]
    for cat_key in category_order:
        items = by_category.get(cat_key, [])
        if not items:
            continue
        label = CATEGORY_LABELS.get(cat_key, cat_key)
        lines.append(f"\n--- {label} ({len(items)}) ---")
        for item in items:
            pri = item.get("priority", "unknown")
            summary = item.get("ai_summary") or (item.get("message") or "")[:120]
            player = item.get("player_name") or "Anonymous"
            lines.append(f"  [{pri.upper()}] {summary}")
            lines.append(f"    — {player}")
        lines.append("")

    return "\n".join(lines)


def build_empty_html():
    now = datetime.now(timezone.utc).strftime("%A %d %B %Y")
    return f"""\
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#333;">
  <h1 style="color:#222;font-size:22px;margin-bottom:4px;">Player Feedback Digest</h1>
  <p style="color:#888;margin-top:0;">{now}</p>
  <div style="background:#f8f9fa;padding:16px;border-radius:8px;">
    <p>No new feedback in the last {HOURS} hours.</p>
  </div>
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px;">
  <p style="color:#aaa;font-size:12px;">
    Feedback Digest · <a href="https://uncivilized.fun" style="color:#aaa;">uncivilized.fun</a>
  </p>
</body>
</html>"""


# ── Send email ──────────────────────────────────────────────────────
def send_digest(subject, email_html, email_text):
    if DRY_RUN:
        print(f"\n[DRY RUN] Would send to: {DIGEST_EMAIL}")
        print(f"Subject: {subject}")
        print(f"\n{email_text}")
        return True

    try:
        body = json.dumps({
            "from": FROM_EMAIL,
            "to": [DIGEST_EMAIL],
            "reply_to": REPLY_TO_EMAIL,
            "subject": subject,
            "html": email_html,
            "text": email_text,
        }).encode()
        req = urllib.request.Request(
            "https://api.resend.com/emails",
            data=body,
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
                "User-Agent": "uncivilized-feedback-digest/1.0",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status < 300:
                print(f"Digest sent to {DIGEST_EMAIL}")
                return True
            print(f"Unexpected status {resp.status}", file=sys.stderr)
            return False
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        print(f"Failed to send digest: HTTP {e.code} — {err_body}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Failed to send digest: {e}", file=sys.stderr)
        return False


# ── Main ────────────────────────────────────────────────────────────
def main():
    now = datetime.now(timezone.utc).strftime("%A %d %B")
    print(f"Feedback Digest — {now}")
    print(f"Looking back {HOURS} hours")
    print(f"Recipient: {DIGEST_EMAIL}")
    if DRY_RUN:
        print("Mode: DRY RUN")
    print()

    feedback = fetch_recent_feedback()
    print(f"Found {len(feedback)} feedback items")

    if not feedback:
        subject = f"Feedback Digest — {now} (no new feedback)"
        send_digest(subject, build_empty_html(), f"No new feedback in the last {HOURS} hours.")
        return

    by_category = build_digest(feedback)

    critical_count = sum(1 for f in feedback if f.get("priority") == "critical")
    high_count = sum(1 for f in feedback if f.get("priority") == "high")

    subject_parts = [f"Feedback Digest — {now}"]
    if critical_count:
        subject_parts.append(f"{critical_count} critical")
    if high_count:
        subject_parts.append(f"{high_count} high priority")
    if not critical_count and not high_count:
        subject_parts.append(f"{len(feedback)} items")
    subject = " · ".join(subject_parts)

    email_html = build_html(feedback, by_category)
    email_text = build_text(feedback, by_category)

    send_digest(subject, email_html, email_text)


if __name__ == "__main__":
    main()
