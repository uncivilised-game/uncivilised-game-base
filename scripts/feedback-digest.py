#!/usr/bin/env python3
"""
Feedback Digest — daily summary of in-game player feedback.

Queries the last 24 hours of feedback from Supabase, groups by category
and priority, and sends a formatted digest email via Resend.

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, DIGEST_EMAIL
Optional: DRY_RUN=true, HOURS=48 (lookback window, default 24)
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

# ── Config ──────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
RESEND_API_KEY = os.environ["RESEND_API_KEY"]
DIGEST_EMAIL = os.environ["DIGEST_EMAIL"]
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"
HOURS = int(os.environ.get("HOURS", "24"))

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
CATEGORY_LABELS = {
    "bug_report": "Bug Reports",
    "feature_request": "Feature Requests",
    "gameplay_feedback": "Gameplay Feedback",
    "question": "Questions",
    "other": "Other",
}
CATEGORY_ORDER = list(CATEGORY_LABELS.keys())


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
def fetch_recent_feedback(hours):
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    since_encoded = since.replace("+", "%2B")
    rows = sb_get(
        "feedback",
        f"select=id,visitor_id,player_name,message,category,priority,ai_summary,game_state_snapshot,status,created_at"
        f"&created_at=gte.{since_encoded}"
        f"&order=created_at.desc"
    )
    if isinstance(rows, dict) and "error" in rows:
        print(f"Supabase error: {rows}", file=sys.stderr)
        return []
    return rows or []


# ── Group and sort ──────────────────────────────────────────────────
def build_digest(rows):
    by_category = defaultdict(list)
    for row in rows:
        cat = row.get("category") or "other"
        by_category[cat].append(row)

    for cat in by_category:
        by_category[cat].sort(
            key=lambda r: PRIORITY_ORDER.get(r.get("priority", "medium"), 2)
        )

    priority_counts = defaultdict(int)
    category_counts = defaultdict(int)
    for row in rows:
        priority_counts[row.get("priority") or "unknown"] += 1
        category_counts[row.get("category") or "other"] += 1

    return by_category, priority_counts, category_counts


# ── HTML rendering ──────────────────────────────────────────────────
PRIORITY_COLORS = {
    "critical": "#e74c3c",
    "high": "#e67e22",
    "medium": "#f1c40f",
    "low": "#95a5a6",
}

CATEGORY_COLORS = {
    "bug_report": "#d9534f",
    "feature_request": "#5b8dd9",
    "gameplay_feedback": "#c9a84c",
    "question": "#8a8578",
    "other": "#555555",
}


def render_priority_badge(priority):
    color = PRIORITY_COLORS.get(priority, "#888")
    return f'<span style="display:inline-block;background:{color};color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:3px;text-transform:uppercase;letter-spacing:0.5px">{priority}</span>'


def render_category_badge(category):
    color = CATEGORY_COLORS.get(category, "#888")
    label = CATEGORY_LABELS.get(category, category)
    return f'<span style="display:inline-block;background:{color}22;color:{color};font-size:11px;font-weight:600;padding:2px 8px;border-radius:3px;border:1px solid {color}44">{label}</span>'


def escape(text):
    if not text:
        return ""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render_item_html(row):
    summary = escape(row.get("ai_summary") or "")
    message = escape((row.get("message") or "")[:200])
    priority = row.get("priority") or "medium"
    player = escape(row.get("player_name") or "Anonymous")
    created = row.get("created_at", "")[:16].replace("T", " ")

    display_text = summary or message
    if not display_text:
        display_text = "(empty)"

    return f"""<tr><td style="padding:8px 12px;border-bottom:1px solid #222220">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        {render_priority_badge(priority)}
        <span style="color:#8a8578;font-size:12px">{player} &middot; {created} UTC</span>
      </div>
      <div style="color:#e8e0d0;font-size:14px;line-height:20px">{display_text}</div>
    </td></tr>"""


def render_email(rows, by_category, priority_counts, category_counts, hours):
    date_str = datetime.now(timezone.utc).strftime("%B %d, %Y")
    total = len(rows)

    if total == 0:
        summary_html = f"""<tr><td style="color:#b8b0a0;font-size:15px;line-height:26px;padding:0 0 24px">
          No new feedback in the last {hours} hours. All quiet on the frontier.
        </td></tr>"""
        sections_html = ""
    else:
        stat_pills = []
        for pri in ["critical", "high", "medium", "low"]:
            count = priority_counts.get(pri, 0)
            if count > 0:
                color = PRIORITY_COLORS[pri]
                stat_pills.append(
                    f'<span style="display:inline-block;background:{color}22;color:{color};border:1px solid {color}44;'
                    f'font-size:13px;font-weight:600;padding:4px 12px;border-radius:4px;margin:0 4px 4px 0">'
                    f'{count} {pri}</span>'
                )

        summary_html = f"""<tr><td style="padding:0 0 24px">
          <div style="color:#e8e0d0;font-size:18px;font-weight:600;margin-bottom:8px">{total} feedback items in the last {hours}h</div>
          <div>{''.join(stat_pills)}</div>
        </td></tr>"""

        sections = []
        for cat in CATEGORY_ORDER:
            items = by_category.get(cat, [])
            if not items:
                continue
            color = CATEGORY_COLORS.get(cat, "#888")
            label = CATEGORY_LABELS.get(cat, cat)
            items_html = "".join(render_item_html(r) for r in items)
            sections.append(f"""<tr><td style="padding:0 0 20px">
              <div style="color:{color};font-size:16px;font-weight:600;padding:0 0 8px;border-bottom:2px solid {color}44;margin-bottom:0">
                {label} ({len(items)})
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#151715;border:1px solid #222220;border-radius:8px;border-top:none">
                {items_html}
              </table>
            </td></tr>""")
        sections_html = "".join(sections)

    template_path = os.path.join(SCRIPT_DIR, "feedback-digest.html")
    with open(template_path, "r") as f:
        template = f.read()

    return template.replace("{{date}}", date_str) \
                    .replace("{{summary}}", summary_html) \
                    .replace("{{sections}}", sections_html)


# ── Send email ──────────────────────────────────────────────────────
def send_email(subject, html_body):
    payload = {
        "from": FROM_EMAIL,
        "to": [DIGEST_EMAIL],
        "subject": subject,
        "html": html_body,
    }
    return _req("POST", "https://api.resend.com/emails", data=payload, headers={
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json",
    })


# ── Main ────────────────────────────────────────────────────────────
def main():
    print(f"Fetching feedback from last {HOURS} hours...")
    rows = fetch_recent_feedback(HOURS)
    print(f"Found {len(rows)} feedback items")

    by_category, priority_counts, category_counts = build_digest(rows)

    for cat in CATEGORY_ORDER:
        items = by_category.get(cat, [])
        if items:
            label = CATEGORY_LABELS.get(cat, cat)
            print(f"\n  {label}: {len(items)}")
            for r in items:
                pri = r.get("priority", "?")
                summary = r.get("ai_summary") or (r.get("message") or "")[:80]
                print(f"    [{pri}] {summary}")

    for pri in ["critical", "high", "medium", "low"]:
        count = priority_counts.get(pri, 0)
        if count:
            print(f"  {pri}: {count}")

    date_str = datetime.now(timezone.utc).strftime("%b %d")
    subject = f"Feedback Digest — {date_str} — {len(rows)} items"
    html_body = render_email(rows, by_category, priority_counts, category_counts, HOURS)

    if DRY_RUN:
        print(f"\n[DRY RUN] Would send to: {DIGEST_EMAIL}")
        print(f"[DRY RUN] Subject: {subject}")
        preview_path = os.path.join(SCRIPT_DIR, "feedback-digest-preview.html")
        with open(preview_path, "w") as f:
            f.write(html_body)
        print(f"[DRY RUN] Preview saved to {preview_path}")
    else:
        print(f"\nSending digest to {DIGEST_EMAIL}...")
        result = send_email(subject, html_body)
        print(f"Sent: {result}")


if __name__ == "__main__":
    main()
