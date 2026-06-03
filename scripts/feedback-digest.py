#!/usr/bin/env python3
"""
Feedback Digest — daily email summarising player feedback.

Fetches the last 24 hours of in-game feedback from Supabase, groups by
category and priority, asks Claude for a short analysis, and emails the
digest to the configured recipient via Resend.

Runs on a cron schedule (daily at 9 AM UTC) or manual workflow_dispatch.

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, ANTHROPIC_API_KEY
Optional: DIGEST_EMAIL (default: repo owner), DRY_RUN=true, HOURS=24
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
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
DIGEST_EMAIL = os.environ.get("DIGEST_EMAIL", "jamie247@gmail.com")
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"
HOURS = int(os.environ.get("HOURS", "24"))

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"
REPLY_TO_EMAIL = "hello@uncivilized.fun"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
CATEGORY_LABELS = {
    "bug_report": "Bug Reports",
    "feature_request": "Feature Requests",
    "gameplay_feedback": "Gameplay Feedback",
    "question": "Questions",
    "other": "Other",
}
CATEGORY_COLORS = {
    "bug_report": "#e74c3c",
    "feature_request": "#3498db",
    "gameplay_feedback": "#c9a84c",
    "question": "#95a5a6",
    "other": "#7f8c8d",
}
PRIORITY_COLORS = {
    "critical": "#e74c3c",
    "high": "#e67e22",
    "medium": "#c9a84c",
    "low": "#95a5a6",
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
def fetch_feedback(since_iso):
    """Fetch all feedback since the given ISO timestamp."""
    params = (
        f"select=id,visitor_id,player_name,message,category,priority,ai_summary,game_state_snapshot,status,created_at"
        f"&created_at=gte.{since_iso}"
        f"&order=created_at.desc"
    )
    return sb_get("feedback", params)


# ── Claude analysis ─────────────────────────────────────────────────
def get_ai_analysis(feedback_items):
    """Ask Claude for a short executive summary of today's feedback."""
    if not feedback_items:
        return "No feedback received in this period."

    summaries = []
    for f in feedback_items:
        summary = f.get("ai_summary") or (f.get("message") or "")[:120]
        cat = f.get("category", "other")
        pri = f.get("priority", "medium")
        player = f.get("player_name") or "anonymous"
        summaries.append(f"[{cat}/{pri}] ({player}) {summary}")

    feedback_text = "\n".join(summaries)

    try:
        result = _req("POST", "https://api.anthropic.com/v1/messages", data={
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 500,
            "messages": [{
                "role": "user",
                "content": f"""You are a game product analyst. Below is the last {HOURS} hours of player feedback for Uncivilized, a browser-based 4X strategy game.

Write a 3-5 sentence executive summary highlighting:
- The most important/urgent issues
- Any patterns or recurring themes
- Actionable next steps

Be direct and concise. No preamble.

Feedback:
{feedback_text}"""
            }],
        }, headers={
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        })
        return result.get("content", [{}])[0].get("text", "Analysis unavailable.")
    except Exception as e:
        print(f"  [WARN] Claude analysis failed: {e}", file=sys.stderr)
        return "AI analysis unavailable — see itemised feedback below."


# ── Build email ─────────────────────────────────────────────────────
def build_digest_html(feedback_items, analysis, since, now):
    """Build the HTML email body."""
    template_path = os.path.join(SCRIPT_DIR, "feedback-digest.html")
    with open(template_path, "r") as f:
        email_html = f.read()

    total = len(feedback_items)
    period = f"{since.strftime('%d %b %H:%M')} — {now.strftime('%d %b %H:%M UTC')}"

    # Count by category and priority
    by_category = defaultdict(list)
    by_priority = defaultdict(int)
    for f_item in feedback_items:
        cat = f_item.get("category") or "other"
        pri = f_item.get("priority") or "medium"
        by_category[cat].append(f_item)
        by_priority[pri] += 1

    # Summary stats row
    stats_html = ""
    for pri in ["critical", "high", "medium", "low"]:
        count = by_priority.get(pri, 0)
        if count:
            color = PRIORITY_COLORS.get(pri, "#95a5a6")
            stats_html += (
                f'<td style="text-align:center;padding:10px 8px">'
                f'<div style="font-size:24px;font-weight:700;color:{color}">{count}</div>'
                f'<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px">{pri}</div>'
                f'</td>'
            )

    # Category sections
    sections_html = ""
    category_order = ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]
    for cat in category_order:
        items = by_category.get(cat, [])
        if not items:
            continue

        label = CATEGORY_LABELS.get(cat, cat)
        color = CATEGORY_COLORS.get(cat, "#7f8c8d")

        items_sorted = sorted(items, key=lambda x: PRIORITY_ORDER.get(x.get("priority", "medium"), 2))
        items_html = ""
        for item in items_sorted:
            pri = item.get("priority") or "medium"
            pri_color = PRIORITY_COLORS.get(pri, "#95a5a6")
            summary = html.escape(item.get("ai_summary") or (item.get("message") or "")[:120])
            player = html.escape(item.get("player_name") or "anonymous")
            created = ""
            if item.get("created_at"):
                try:
                    dt = datetime.fromisoformat(item["created_at"].replace("Z", "+00:00"))
                    created = dt.strftime("%H:%M")
                except Exception:
                    pass

            items_html += f"""<tr>
  <td style="padding:8px 10px;border-bottom:1px solid #1a1a18;vertical-align:top">
    <span style="display:inline-block;background:{pri_color}20;color:{pri_color};font-size:10px;font-weight:600;padding:2px 6px;border-radius:3px;text-transform:uppercase">{pri}</span>
  </td>
  <td style="padding:8px 10px;border-bottom:1px solid #1a1a18;color:#d0c8b8;font-size:14px;line-height:20px">{summary}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #1a1a18;color:#888;font-size:12px;white-space:nowrap;vertical-align:top">{player}<br>{created}</td>
</tr>"""

        sections_html += f"""<tr><td style="padding:20px 0 8px">
  <div style="display:flex;align-items:center;gap:8px;padding-bottom:8px">
    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:{color}"></span>
    <span style="color:#e8e0d0;font-family:'Cormorant Garamond',Georgia,serif;font-size:18px;font-weight:600">{label}</span>
    <span style="color:#666;font-size:13px">({len(items)})</span>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#111310;border:1px solid #222220;border-radius:8px;overflow:hidden">
    {items_html}
  </table>
</td></tr>"""

    # Replace placeholders
    email_html = email_html.replace("{{period}}", period)
    email_html = email_html.replace("{{total}}", str(total))
    email_html = email_html.replace("{{analysis}}", html.escape(analysis).replace("\n", "<br>"))
    email_html = email_html.replace("{{stats_row}}", stats_html)
    email_html = email_html.replace("{{category_sections}}", sections_html)

    return email_html


def build_digest_text(feedback_items, analysis, since, now):
    """Build the plain-text email body."""
    total = len(feedback_items)
    period = f"{since.strftime('%d %b %H:%M')} — {now.strftime('%d %b %H:%M UTC')}"

    lines = [
        f"UNCIVILIZED — FEEDBACK DIGEST",
        f"{period} | {total} items",
        "",
        "── ANALYSIS ──",
        analysis,
        "",
    ]

    by_category = defaultdict(list)
    for f_item in feedback_items:
        cat = f_item.get("category") or "other"
        by_category[cat].append(f_item)

    for cat in ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]:
        items = by_category.get(cat, [])
        if not items:
            continue
        label = CATEGORY_LABELS.get(cat, cat)
        lines.append(f"── {label.upper()} ({len(items)}) ──")
        items_sorted = sorted(items, key=lambda x: PRIORITY_ORDER.get(x.get("priority", "medium"), 2))
        for item in items_sorted:
            pri = (item.get("priority") or "medium").upper()
            summary = item.get("ai_summary") or (item.get("message") or "")[:120]
            player = item.get("player_name") or "anonymous"
            lines.append(f"  [{pri}] {summary} — {player}")
        lines.append("")

    return "\n".join(lines)


# ── Send email ──────────────────────────────────────────────────────
def send_email(to_email, subject, html_body, text_body):
    """Send the digest email via Resend."""
    try:
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
                "User-Agent": "uncivilized-feedback-digest/1.0",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status < 300:
                print(f"  [EMAIL] Sent digest to {to_email}")
                return True
            print(f"  [EMAIL] Failed: {resp.status}")
            return False
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        print(f"  [EMAIL] Error: {e} — {err_body}")
        return False
    except Exception as e:
        print(f"  [EMAIL] Error: {e}")
        return False


# ── Main ────────────────────────────────────────────────────────────
def main():
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=HOURS)
    since_iso = since.isoformat()

    print(f"Feedback digest: {since.strftime('%d %b %H:%M')} — {now.strftime('%d %b %H:%M UTC')}")
    print(f"Recipient: {DIGEST_EMAIL}")
    if DRY_RUN:
        print("DRY RUN — no email will be sent")

    # Fetch feedback
    feedback = fetch_feedback(since_iso)
    print(f"Found {len(feedback)} feedback items")

    if not feedback:
        print("No feedback in this period — skipping digest")
        return

    # Get AI analysis
    print("Generating AI analysis...")
    analysis = get_ai_analysis(feedback)
    print(f"Analysis: {analysis[:100]}...")

    # Build email
    html_body = build_digest_html(feedback, analysis, since, now)
    text_body = build_digest_text(feedback, analysis, since, now)

    # Count by priority for subject line
    by_priority = defaultdict(int)
    for f_item in feedback:
        by_priority[f_item.get("priority") or "medium"] += 1

    critical = by_priority.get("critical", 0)
    high = by_priority.get("high", 0)
    urgent_tag = ""
    if critical:
        urgent_tag = f" [{critical} critical]"
    elif high:
        urgent_tag = f" [{high} high priority]"

    subject = f"Feedback Digest — {len(feedback)} items{urgent_tag} — {now.strftime('%d %b')}"

    if DRY_RUN:
        print(f"\nSubject: {subject}")
        print(f"\n{text_body}")
        # Write HTML to file for preview
        preview_path = os.path.join(SCRIPT_DIR, "_feedback-digest-preview.html")
        with open(preview_path, "w") as f:
            f.write(html_body)
        print(f"\nHTML preview written to {preview_path}")
    else:
        send_email(DIGEST_EMAIL, subject, html_body, text_body)


if __name__ == "__main__":
    main()
