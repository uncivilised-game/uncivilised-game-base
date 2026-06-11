#!/usr/bin/env python3
"""
Feedback Summary — daily email digest of player feedback, categorised and prioritised.

Queries Supabase for feedback from the last 24 hours (configurable), groups by
category and priority, and sends a formatted HTML email via Resend.

Runs on a daily schedule (GitHub Actions) or manually.
Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
Optional: SUMMARY_EMAIL, HOURS=24, DRY_RUN=true, TEST_EMAIL=you@example.com
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

SUMMARY_EMAIL = os.environ.get("SUMMARY_EMAIL", "jamie247@gmail.com")
HOURS = int(os.environ.get("HOURS", "24"))
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"
TEST_EMAIL = os.environ.get("TEST_EMAIL", "")

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"
REPLY_TO_EMAIL = "hello@uncivilized.fun"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

CATEGORY_ORDER = ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]
CATEGORY_LABELS = {
    "bug_report": "Bug Reports",
    "feature_request": "Feature Requests",
    "gameplay_feedback": "Gameplay Feedback",
    "question": "Questions",
    "other": "Other",
}
CATEGORY_ICONS = {
    "bug_report": "&#x1F41B;",
    "feature_request": "&#x2728;",
    "gameplay_feedback": "&#x1F3AE;",
    "question": "&#x2753;",
    "other": "&#x1F4AC;",
}
CATEGORY_COLORS = {
    "bug_report": "#d9534f",
    "feature_request": "#5b8dd9",
    "gameplay_feedback": "#c9a84c",
    "question": "#8a8578",
    "other": "#6a6560",
}
PRIORITY_ORDER = ["critical", "high", "medium", "low"]
PRIORITY_COLORS = {
    "critical": "#ff4444",
    "high": "#e8963a",
    "medium": "#c9a84c",
    "low": "#8a8578",
}


# ── HTTP helpers (same pattern as other scripts) ────────────────────
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
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=HOURS)).isoformat()
    params = (
        f"created_at=gte.{cutoff}"
        f"&select=id,message,category,priority,ai_summary,player_name,visitor_id,status,github_issue_number,created_at"
        f"&order=created_at.desc"
    )
    return sb_get("feedback", params)


# ── Group and sort ──────────────────────────────────────────────────
def organise_feedback(rows):
    by_category = defaultdict(list)
    for row in rows:
        cat = row.get("category", "other") or "other"
        by_category[cat].append(row)

    for cat in by_category:
        by_category[cat].sort(
            key=lambda r: PRIORITY_ORDER.index(r.get("priority", "low"))
            if r.get("priority") in PRIORITY_ORDER else 99
        )

    return by_category


def count_by_priority(rows):
    counts = defaultdict(int)
    for row in rows:
        counts[row.get("priority", "low")] += 1
    return counts


# ── Build HTML email ────────────────────────────────────────────────
def build_email_html(by_category, total, period_label):
    template_path = os.path.join(SCRIPT_DIR, "feedback-summary.html")
    with open(template_path, "r") as f:
        template = f.read()

    all_priority_counts = count_by_priority(
        [row for rows in by_category.values() for row in rows]
    )

    stats_html = ""
    for pri in PRIORITY_ORDER:
        count = all_priority_counts.get(pri, 0)
        if count == 0:
            continue
        color = PRIORITY_COLORS[pri]
        stats_html += (
            f'<span style="display:inline-block;background:{color}20;color:{color};'
            f'font-size:13px;font-weight:600;padding:4px 12px;border-radius:4px;'
            f'margin-right:8px;margin-bottom:4px">'
            f'{pri.upper()}: {count}</span>'
        )

    sections_html = ""
    for cat in CATEGORY_ORDER:
        items = by_category.get(cat, [])
        if not items:
            continue

        icon = CATEGORY_ICONS.get(cat, "")
        label = CATEGORY_LABELS.get(cat, cat)
        color = CATEGORY_COLORS.get(cat, "#c9a84c")

        items_html = ""
        for item in items:
            pri = item.get("priority", "low")
            pri_color = PRIORITY_COLORS.get(pri, "#8a8578")
            summary = html.escape(item.get("ai_summary") or item.get("message", "")[:120])
            player = html.escape(item.get("player_name") or "anonymous")
            created = item.get("created_at", "")[:16].replace("T", " ")

            issue_badge = ""
            if item.get("github_issue_number"):
                issue_badge = (
                    f' <a href="https://github.com/uncivilised-game/uncivilised-game-base/issues/{item["github_issue_number"]}"'
                    f' style="color:#8a8578;font-size:11px;text-decoration:none">'
                    f'#{item["github_issue_number"]}</a>'
                )

            items_html += (
                f'<tr><td style="padding:8px 0;border-bottom:1px solid #1a1a18">'
                f'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
                f'<span style="display:inline-block;background:{pri_color}20;color:{pri_color};'
                f'font-size:11px;font-weight:600;padding:2px 8px;border-radius:3px;text-transform:uppercase">{pri}</span>'
                f'<span style="color:#5a5548;font-size:12px">{player} &middot; {created}</span>'
                f'{issue_badge}'
                f'</div>'
                f'<div style="color:#b8b0a0;font-size:14px;line-height:20px">{summary}</div>'
                f'</td></tr>'
            )

        sections_html += (
            f'<tr><td style="padding:20px 0 8px">'
            f'<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">'
            f'<span style="font-size:20px">{icon}</span>'
            f'<span style="color:{color};font-family:\'Cormorant Garamond\',Georgia,serif;'
            f'font-size:20px;font-weight:600">{label}</span>'
            f'<span style="color:#5a5548;font-size:14px">({len(items)})</span>'
            f'</div>'
            f'<table width="100%" cellpadding="0" cellspacing="0">{items_html}</table>'
            f'</td></tr>'
        )

    if not sections_html:
        sections_html = (
            '<tr><td style="padding:40px 0;text-align:center;color:#5a5548;font-size:15px">'
            'No feedback received in this period.'
            '</td></tr>'
        )

    email_html = template.replace("{{period_label}}", html.escape(period_label))
    email_html = email_html.replace("{{total}}", str(total))
    email_html = email_html.replace("{{stats}}", stats_html)
    email_html = email_html.replace("{{sections}}", sections_html)
    email_html = email_html.replace("{{generated_at}}", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))

    return email_html


def build_email_text(by_category, total, period_label):
    lines = [
        f"Uncivilised — Feedback Summary",
        f"{period_label} | {total} items",
        "",
    ]

    for cat in CATEGORY_ORDER:
        items = by_category.get(cat, [])
        if not items:
            continue
        label = CATEGORY_LABELS.get(cat, cat)
        lines.append(f"== {label} ({len(items)}) ==")
        for item in items:
            pri = item.get("priority", "low").upper()
            summary = item.get("ai_summary") or item.get("message", "")[:120]
            player = item.get("player_name") or "anonymous"
            lines.append(f"  [{pri}] {summary} — {player}")
        lines.append("")

    if total == 0:
        lines.append("No feedback received in this period.")

    return "\n".join(lines)


# ── Send email ──────────────────────────────────────────────────────
def send_summary(to_email, subject, html_body, text_body):
    body = json.dumps({
        "from": FROM_EMAIL,
        "to": [to_email],
        "reply_to": REPLY_TO_EMAIL,
        "subject": subject,
        "html": html_body,
        "text": text_body,
    }).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=body,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
            "User-Agent": "uncivilized-feedback-summary/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status < 300:
            print(f"  [EMAIL] Sent summary to {to_email}")
            return True
    return False


# ── Main ────────────────────────────────────────────────────────────
def main():
    print(f"=== Feedback Summary ({HOURS}h window) ===")
    print(f"  Dry run: {DRY_RUN}")

    rows = fetch_recent_feedback()
    total = len(rows)
    print(f"  Found {total} feedback items in the last {HOURS} hours")

    by_category = organise_feedback(rows)
    for cat in CATEGORY_ORDER:
        items = by_category.get(cat, [])
        if items:
            pri_counts = count_by_priority(items)
            pri_str = ", ".join(f"{p}={c}" for p, c in sorted(pri_counts.items()))
            print(f"    {CATEGORY_LABELS.get(cat, cat)}: {len(items)} ({pri_str})")

    period_label = f"Last {HOURS} hours" if HOURS != 24 else "Last 24 hours"
    today = datetime.now(timezone.utc).strftime("%d %b %Y")
    subject = f"Feedback Digest — {today} ({total} items)"

    html_body = build_email_html(by_category, total, period_label)
    text_body = build_email_text(by_category, total, period_label)

    to = TEST_EMAIL or SUMMARY_EMAIL

    if DRY_RUN:
        print(f"\n  [DRY RUN] Would send to: {to}")
        print(f"  Subject: {subject}")
        print(f"\n{text_body}")
        return

    try:
        send_summary(to, subject, html_body, text_body)
    except Exception as e:
        print(f"  [ERROR] Failed to send: {e}", file=sys.stderr)
        sys.exit(1)

    print("  Done.")


if __name__ == "__main__":
    main()
