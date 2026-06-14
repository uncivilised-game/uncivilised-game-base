#!/usr/bin/env python3
"""
Feedback Digest — daily summary of player feedback, categorised and prioritised.

Queries the last 24 hours of in-game feedback from Supabase, groups by category
and priority, and emails a digest via Resend.

Runs on a daily schedule (GitHub Actions) or manually.
Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
Optional: DIGEST_EMAIL (recipient, defaults to hello@uncivilized.fun),
          HOURS (lookback window, default 24), DRY_RUN=true
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from collections import defaultdict

# ── Config ──────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
RESEND_API_KEY = os.environ["RESEND_API_KEY"]

DIGEST_EMAIL = os.environ.get("DIGEST_EMAIL", "hello@uncivilized.fun")
HOURS = int(os.environ.get("HOURS", "24"))
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "unknown": 4}
PRIORITY_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢", "unknown": "⚪"}
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
CATEGORY_ORDER = ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]


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


# ── Fetch feedback ──────────────────────────────────────────────────
def fetch_feedback(hours):
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    params = (
        f"select=id,visitor_id,player_name,category,priority,message,ai_summary,status,created_at"
        f"&created_at=gte.{since}"
        f"&order=created_at.desc"
    )
    return sb_get("feedback", params)


# ── Build digest ────────────────────────────────────────────────────
def build_digest(feedback, hours):
    if not feedback:
        return None, None

    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=hours)

    by_category = defaultdict(list)
    by_priority = defaultdict(int)
    unique_players = set()

    for f in feedback:
        cat = f.get("category") or "other"
        pri = f.get("priority") or "unknown"
        by_category[cat].append(f)
        by_priority[pri] += 1
        player = f.get("player_name") or f.get("visitor_id") or "anonymous"
        unique_players.add(player)

    for cat in by_category:
        by_category[cat].sort(key=lambda x: PRIORITY_ORDER.get(x.get("priority", "unknown"), 4))

    total = len(feedback)
    date_str = now.strftime("%d %b %Y")

    # ── Plain text version ──
    text = f"Feedback Digest — {date_str}\n"
    text += f"{total} items from {len(unique_players)} players (last {hours}h)\n\n"

    for cat in CATEGORY_ORDER:
        items = by_category.get(cat, [])
        if not items:
            continue
        text += f"── {CATEGORY_LABEL.get(cat, cat)} ({len(items)}) ──\n"
        for f in items:
            pri = f.get("priority", "unknown")
            summary = f.get("ai_summary") or (f.get("message") or "")[:120]
            player = f.get("player_name") or "anon"
            text += f"  [{pri.upper()}] {summary} — {player}\n"
        text += "\n"

    # ── HTML version ──
    html = _build_html(feedback, by_category, by_priority, unique_players, total, hours, date_str)

    subject = f"Feedback Digest: {total} items — {date_str}"
    return subject, html, text


def _build_html(feedback, by_category, by_priority, unique_players, total, hours, date_str):
    critical = by_priority.get("critical", 0)
    high = by_priority.get("high", 0)

    # Header bar color based on severity
    if critical > 0:
        header_bg = "#d9534f"
        header_note = f"{critical} critical"
    elif high > 0:
        header_bg = "#e8924f"
        header_note = f"{high} high priority"
    else:
        header_bg = "#4a7c59"
        header_note = "no urgent items"

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
<div style="max-width:640px;margin:0 auto;background:#242424;border-radius:8px;overflow:hidden;margin-top:20px;margin-bottom:20px;">

  <!-- Header -->
  <div style="background:{header_bg};padding:24px 28px;color:#fff;">
    <h1 style="margin:0;font-size:22px;font-weight:600;">Feedback Digest</h1>
    <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">{date_str} &middot; {total} items from {len(unique_players)} players &middot; {header_note}</p>
  </div>

  <!-- Summary bar -->
  <div style="display:flex;padding:16px 28px;background:#2a2a2a;border-bottom:1px solid #333;gap:20px;flex-wrap:wrap;">
"""

    for pri in ["critical", "high", "medium", "low"]:
        count = by_priority.get(pri, 0)
        if count == 0:
            continue
        emoji = PRIORITY_EMOJI.get(pri, "")
        html += f'    <div style="font-size:13px;color:#ccc;">{emoji} {count} {pri}</div>\n'

    html += "  </div>\n\n"

    # Category sections
    for cat in CATEGORY_ORDER:
        items = by_category.get(cat, [])
        if not items:
            continue

        emoji = CATEGORY_EMOJI.get(cat, "")
        label = CATEGORY_LABEL.get(cat, cat)

        html += f"""  <!-- {label} -->
  <div style="padding:20px 28px;border-bottom:1px solid #333;">
    <h2 style="margin:0 0 14px;font-size:16px;color:#e0d5c1;font-weight:600;">{emoji} {label} ({len(items)})</h2>
"""

        for f in items:
            pri = f.get("priority", "unknown")
            summary = _esc(f.get("ai_summary") or (f.get("message") or "")[:120])
            player = _esc(f.get("player_name") or "anonymous")
            ts = _format_time(f.get("created_at"))
            pri_color = {"critical": "#d9534f", "high": "#e8924f", "medium": "#c9a84c", "low": "#6b8f71"}.get(pri, "#888")

            html += f"""    <div style="margin-bottom:12px;padding:10px 14px;background:#2d2d2d;border-radius:6px;border-left:3px solid {pri_color};">
      <div style="font-size:14px;color:#ddd;line-height:1.4;">{summary}</div>
      <div style="margin-top:6px;font-size:12px;color:#888;">
        <span style="color:{pri_color};font-weight:600;">{pri.upper()}</span>
        &middot; {player} &middot; {ts}
      </div>
    </div>
"""

        html += "  </div>\n\n"

    # Footer
    html += """  <div style="padding:16px 28px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#666;">Uncivilized — daily feedback digest</p>
  </div>

</div>
</body>
</html>"""

    return html


def _esc(text):
    import html as html_mod
    return html_mod.escape(str(text))


def _format_time(iso_str):
    if not iso_str:
        return ""
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%H:%M UTC")
    except Exception:
        return ""


# ── Send email ──────────────────────────────────────────────────────
def send_email(to, subject, html_body, text_body):
    data = {
        "from": FROM_EMAIL,
        "to": [to],
        "subject": subject,
        "html": html_body,
        "text": text_body,
    }
    return _req("POST", "https://api.resend.com/emails", data=data, headers={
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json",
    })


# ── Main ────────────────────────────────────────────────────────────
def main():
    print(f"Fetching feedback from last {HOURS} hours...")
    feedback = fetch_feedback(HOURS)
    print(f"Found {len(feedback)} feedback items")

    if not feedback:
        print("No feedback in this period. Skipping digest.")
        return

    subject, html_body, text_body = build_digest(feedback, HOURS)

    print(f"\nSubject: {subject}")
    print(f"\n{text_body}")

    if DRY_RUN:
        print("\n[DRY RUN] Would send to:", DIGEST_EMAIL)
        return

    print(f"\nSending digest to {DIGEST_EMAIL}...")
    result = send_email(DIGEST_EMAIL, subject, html_body, text_body)
    print(f"Sent: {result.get('id', 'ok')}")


if __name__ == "__main__":
    main()
