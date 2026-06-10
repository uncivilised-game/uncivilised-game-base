#!/usr/bin/env python3
"""
Daily Feedback Digest — queries the last 24h of player feedback, categorises,
prioritises, and emails a summary.

Runs on a cron schedule (GitHub Actions) or manually.
Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
Optional: DIGEST_EMAIL (defaults to ADMIN_EMAIL), HOURS (defaults to 24), DRY_RUN
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
DIGEST_EMAIL = os.environ.get("DIGEST_EMAIL", "jamie247@gmail.com")
HOURS = int(os.environ.get("HOURS", "24"))
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
PRIORITY_EMOJI = {"critical": "&#x1F534;", "high": "&#x1F7E0;", "medium": "&#x1F7E1;", "low": "&#x1F7E2;"}
CATEGORY_LABELS = {
    "bug_report": ("Bug Reports", "&#x1F41B;"),
    "feature_request": ("Feature Requests", "&#x1F4A1;"),
    "gameplay_feedback": ("Gameplay Feedback", "&#x1F3AE;"),
    "question": ("Questions", "&#x2753;"),
    "other": ("Other", "&#x1F4AC;"),
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


# ── Fetch recent feedback ──────────────────────────────────────────
def fetch_feedback(hours):
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    params = (
        f"select=id,player_name,message,category,priority,ai_summary,status,created_at"
        f"&created_at=gte.{cutoff}"
        f"&order=created_at.desc"
        f"&limit=500"
    )
    return sb_get("feedback", params)


# ── Build digest ────────────────────────────────────────────────────
def build_digest(feedback, hours):
    if not feedback:
        return None, None

    by_category = defaultdict(list)
    for item in feedback:
        cat = item.get("category", "other") or "other"
        by_category[cat].append(item)

    total = len(feedback)
    unique_players = len({f.get("player_name") or f.get("visitor_id", "anon") for f in feedback})

    priority_counts = defaultdict(int)
    for f in feedback:
        priority_counts[f.get("priority", "low")] += 1

    # ── Plain text summary (for console/logs) ───────────────────────
    lines = [f"Feedback Digest — last {hours}h", f"{total} items from {unique_players} players", ""]

    for priority in ["critical", "high", "medium", "low"]:
        if priority_counts[priority]:
            lines.append(f"  {priority.upper()}: {priority_counts[priority]}")
    lines.append("")

    category_order = ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]
    for cat in category_order:
        items = by_category.get(cat, [])
        if not items:
            continue
        label, _ = CATEGORY_LABELS.get(cat, (cat, ""))
        lines.append(f"── {label} ({len(items)}) ──")
        sorted_items = sorted(items, key=lambda x: PRIORITY_ORDER.get(x.get("priority", "low"), 3))
        for item in sorted_items:
            player = item.get("player_name") or "anonymous"
            summary = item.get("ai_summary") or item.get("message", "")[:80]
            pri = item.get("priority", "low")
            lines.append(f"  [{pri.upper()}] {summary} — {player}")
        lines.append("")

    text_summary = "\n".join(lines)

    # ── HTML email ──────────────────────────────────────────────────
    html_parts = []
    html_parts.append(_email_header(total, unique_players, hours, priority_counts))

    for cat in category_order:
        items = by_category.get(cat, [])
        if not items:
            continue
        label, emoji = CATEGORY_LABELS.get(cat, (cat, ""))
        sorted_items = sorted(items, key=lambda x: PRIORITY_ORDER.get(x.get("priority", "low"), 3))
        html_parts.append(_category_section(label, emoji, sorted_items))

    html_parts.append(_email_footer())
    html_body = "\n".join(html_parts)

    return text_summary, html_body


def _email_header(total, unique_players, hours, priority_counts):
    now = datetime.now(timezone.utc).strftime("%B %d, %Y")
    priority_pills = ""
    for pri in ["critical", "high", "medium", "low"]:
        count = priority_counts.get(pri, 0)
        if count == 0:
            continue
        colors = {
            "critical": ("#ff4444", "#1a0000"),
            "high": ("#ff8c00", "#1a0e00"),
            "medium": ("#e6c200", "#1a1600"),
            "low": ("#44bb44", "#001a00"),
        }
        bg, _ = colors[pri]
        priority_pills += (
            f'<span style="display:inline-block;background:{bg}20;color:{bg};'
            f'font-size:12px;font-weight:600;padding:3px 10px;border-radius:12px;'
            f'margin-right:6px;border:1px solid {bg}40">'
            f'{count} {pri}</span>'
        )

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#0d0f0e;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0f0e;padding:40px 20px"><tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%">

<tr><td style="color:#c9a84c;font-family:'Cormorant Garamond',Georgia,serif;font-size:26px;font-weight:700;padding:0 0 6px">
  Player Feedback Digest
</td></tr>
<tr><td style="color:#8a8578;font-size:13px;padding:0 0 20px">
  {now} &nbsp;&bull;&nbsp; Last {hours}h &nbsp;&bull;&nbsp; {total} items from {unique_players} player{"s" if unique_players != 1 else ""}
</td></tr>

<tr><td style="padding:0 0 24px">{priority_pills}</td></tr>

<tr><td style="padding:0 0 20px"><div style="height:1px;background:linear-gradient(to right,#c9a84c50,transparent)"></div></td></tr>
"""


def _category_section(label, emoji, items):
    rows = ""
    for item in items:
        player = html.escape(item.get("player_name") or "anonymous")
        summary = html.escape(item.get("ai_summary") or item.get("message", "")[:80])
        message = html.escape((item.get("message") or "")[:200])
        pri = item.get("priority", "low")
        pri_emoji = PRIORITY_EMOJI.get(pri, "")
        created = item.get("created_at", "")[:16].replace("T", " ")
        status = item.get("status", "new")
        status_badge = ""
        if status == "processed":
            status_badge = '<span style="color:#44bb44;font-size:10px;font-weight:600;margin-left:6px">TRACKED</span>'

        rows += f"""<tr><td style="padding:8px 0;border-bottom:1px solid #1a1a18">
  <div style="color:#e8e0d0;font-size:14px;line-height:20px">{pri_emoji} {summary}{status_badge}</div>
  <div style="color:#6a6558;font-size:12px;line-height:18px;padding-top:3px">
    {message}
  </div>
  <div style="color:#5a5548;font-size:11px;padding-top:4px">
    {player} &nbsp;&bull;&nbsp; {created} UTC
  </div>
</td></tr>
"""

    return f"""<tr><td style="padding:0 0 24px">
  <div style="color:#c9a84c;font-family:'Cormorant Garamond',Georgia,serif;font-size:19px;font-weight:600;padding:0 0 12px">
    {emoji} {label} ({len(items)})
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#111310;border:1px solid #222220;border-radius:8px;padding:4px 16px">
    {rows}
  </table>
</td></tr>
"""


def _email_footer():
    return """<tr><td style="padding:24px 0 0"><div style="height:1px;background:linear-gradient(to right,transparent,#c9a84c15,transparent)"></div></td></tr>
<tr><td style="color:#5a5548;font-size:11px;padding:12px 0 0;text-align:center">
  Uncivilised Feedback Digest &mdash; <a href="https://uncivilized.fun" style="color:#8a8578;text-decoration:none">uncivilized.fun</a>
</td></tr>
</table></td></tr></table></body></html>"""


# ── Send email via Resend ──────────────────────────────────────────
def send_email(to, subject, html_body):
    return _req("POST", "https://api.resend.com/emails", data={
        "from": FROM_EMAIL,
        "to": [to],
        "subject": subject,
        "html": html_body,
    }, headers={
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json",
    })


# ── Main ────────────────────────────────────────────────────────────
def main():
    print(f"Fetching feedback from last {HOURS}h...")
    feedback = fetch_feedback(HOURS)
    print(f"Found {len(feedback)} feedback items")

    if not feedback:
        print("No feedback in this period — skipping digest.")
        return

    text_summary, html_body = build_digest(feedback, HOURS)
    print(text_summary)

    if DRY_RUN:
        print("\n[DRY RUN] Would send digest email to:", DIGEST_EMAIL)
        return

    now = datetime.now(timezone.utc).strftime("%b %d")
    subject = f"Feedback Digest — {now} — {len(feedback)} items"
    print(f"\nSending digest to {DIGEST_EMAIL}...")
    result = send_email(DIGEST_EMAIL, subject, html_body)
    print(f"Sent: {result.get('id', 'ok')}")


if __name__ == "__main__":
    main()
