#!/usr/bin/env python3
"""
Feedback Digest — daily morning summary of player feedback, categorised and prioritised.

Queries the last 24 hours of feedback from Supabase, groups by category and priority,
asks Claude for a brief executive summary, and emails the digest via Resend.

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, ANTHROPIC_API_KEY
Optional: DIGEST_EMAIL (default: hello@uncivilized.fun), HOURS=24, DRY_RUN=true
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

DIGEST_EMAIL = os.environ.get("DIGEST_EMAIL", "hello@uncivilized.fun")
HOURS = int(os.environ.get("HOURS", "24"))
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

CATEGORY_NAMES = {
    "bug_report": "Bug Reports",
    "feature_request": "Feature Requests",
    "gameplay_feedback": "Gameplay Feedback",
    "question": "Questions",
    "other": "Other",
}

CATEGORY_ORDER = ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]

PRIORITY_ORDER = ["critical", "high", "medium", "low"]
PRIORITY_LABELS = {"critical": "CRITICAL", "high": "High", "medium": "Medium", "low": "Low"}

CATEGORY_COLORS = {
    "bug_report": "#d9534f",
    "feature_request": "#5b8dd9",
    "gameplay_feedback": "#c9a84c",
    "question": "#8a8578",
    "other": "#6a6560",
}

PRIORITY_COLORS = {
    "critical": "#ff4444",
    "high": "#ff8844",
    "medium": "#c9a84c",
    "low": "#8a8578",
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
def fetch_recent_feedback(hours):
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    params = (
        f"select=id,message,category,priority,ai_summary,player_name,created_at"
        f"&created_at=gte.{since}"
        f"&order=created_at.desc"
    )
    return sb_get("feedback", params)


# ── Claude summary ──────────────────────────────────────────────────
def generate_executive_summary(feedback_items):
    if not feedback_items:
        return "No feedback received in this period."

    items_text = ""
    for item in feedback_items:
        cat = item.get("category", "other")
        pri = item.get("priority", "medium")
        summary = item.get("ai_summary") or item.get("message", "")[:100]
        player = item.get("player_name") or "anonymous"
        items_text += f"- [{cat}/{pri}] {summary} (from: {player})\n"

    prompt = (
        "You are summarising player feedback for a 4X strategy game called Uncivilised. "
        "Write a brief executive summary (3-5 sentences) of the feedback below. "
        "Highlight the most urgent issues, common themes, and notable feature requests. "
        "Be concise and actionable — this is a morning briefing for the developer.\n\n"
        f"Feedback ({len(feedback_items)} items from the last {HOURS} hours):\n{items_text}"
    )

    try:
        resp = _req("POST", "https://api.anthropic.com/v1/messages", data={
            "model": "claude-sonnet-4-6",
            "max_tokens": 300,
            "messages": [{"role": "user", "content": prompt}],
        }, headers={
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        })
        return resp.get("content", [{}])[0].get("text", "Summary generation failed.")
    except Exception as e:
        print(f"  [WARN] Claude summary failed: {e}", file=sys.stderr)
        return "Could not generate summary — see itemised feedback below."


# ── Build email ─────────────────────────────────────────────────────
def build_digest_html(feedback_items, summary):
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%A %d %B %Y")

    by_category = defaultdict(list)
    for item in feedback_items:
        by_category[item.get("category", "other")].append(item)

    by_priority = defaultdict(int)
    for item in feedback_items:
        by_priority[item.get("priority", "medium")] += 1

    # Stats row
    stats_html = ""
    for pri in PRIORITY_ORDER:
        count = by_priority.get(pri, 0)
        if count > 0:
            color = PRIORITY_COLORS[pri]
            label = PRIORITY_LABELS[pri]
            stats_html += (
                f'<td style="text-align:center;padding:8px 12px">'
                f'<div style="font-size:24px;font-weight:700;color:{color}">{count}</div>'
                f'<div style="font-size:11px;color:#8a8578;text-transform:uppercase;letter-spacing:1px">{label}</div>'
                f'</td>'
            )

    # Category sections
    sections_html = ""
    for cat in CATEGORY_ORDER:
        items = by_category.get(cat, [])
        if not items:
            continue

        cat_name = CATEGORY_NAMES[cat]
        cat_color = CATEGORY_COLORS[cat]
        sorted_items = sorted(items, key=lambda x: PRIORITY_ORDER.index(x.get("priority", "medium")))

        items_html = ""
        for item in sorted_items:
            pri = item.get("priority", "medium")
            pri_color = PRIORITY_COLORS[pri]
            pri_label = PRIORITY_LABELS[pri]
            summary_text = html.escape(item.get("ai_summary") or item.get("message", "")[:120])
            player = html.escape(item.get("player_name") or "anonymous")
            created = item.get("created_at", "")[:16].replace("T", " ")

            items_html += (
                f'<tr>'
                f'<td style="padding:8px 12px;border-bottom:1px solid #222220">'
                f'<span style="display:inline-block;background:{pri_color}22;color:{pri_color};'
                f'font-size:10px;font-weight:600;padding:2px 6px;border-radius:3px;'
                f'text-transform:uppercase;letter-spacing:0.5px;margin-right:8px">{pri_label}</span>'
                f'<span style="color:#e8e0d0;font-size:14px">{summary_text}</span>'
                f'<div style="color:#6a6560;font-size:12px;margin-top:4px">'
                f'{player} &middot; {created} UTC</div>'
                f'</td>'
                f'</tr>\n'
            )

        sections_html += (
            f'<tr><td style="padding:20px 0 8px">'
            f'<span style="color:{cat_color};font-family:\'Cormorant Garamond\',Georgia,serif;'
            f'font-size:18px;font-weight:600">{cat_name}</span>'
            f'<span style="color:#6a6560;font-size:13px;margin-left:8px">({len(items)})</span>'
            f'</td></tr>\n'
            f'<tr><td>'
            f'<table width="100%" cellpadding="0" cellspacing="0" '
            f'style="background:#151715;border:1px solid #222220;border-radius:8px;overflow:hidden">'
            f'{items_html}'
            f'</table>'
            f'</td></tr>\n'
        )

    safe_summary = html.escape(summary).replace("\n", "<br>")

    template_path = os.path.join(SCRIPT_DIR, "feedback-digest.html")
    with open(template_path, "r") as f:
        email_html = f.read()

    email_html = email_html.replace("{{date}}", date_str)
    email_html = email_html.replace("{{total_count}}", str(len(feedback_items)))
    email_html = email_html.replace("{{hours}}", str(HOURS))
    email_html = email_html.replace("{{stats_row}}", stats_html)
    email_html = email_html.replace("{{executive_summary}}", safe_summary)
    email_html = email_html.replace("{{category_sections}}", sections_html)

    return email_html


def build_digest_text(feedback_items, summary):
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%A %d %B %Y")

    lines = [
        f"UNCIVILISED — Feedback Digest",
        f"{date_str}",
        f"{len(feedback_items)} items in the last {HOURS} hours",
        "",
        "SUMMARY",
        summary,
        "",
    ]

    by_category = defaultdict(list)
    for item in feedback_items:
        by_category[item.get("category", "other")].append(item)

    for cat in CATEGORY_ORDER:
        items = by_category.get(cat, [])
        if not items:
            continue
        cat_name = CATEGORY_NAMES[cat]
        lines.append(f"--- {cat_name} ({len(items)}) ---")
        sorted_items = sorted(items, key=lambda x: PRIORITY_ORDER.index(x.get("priority", "medium")))
        for item in sorted_items:
            pri = PRIORITY_LABELS.get(item.get("priority", "medium"), "Medium")
            summary_text = item.get("ai_summary") or item.get("message", "")[:120]
            player = item.get("player_name") or "anonymous"
            lines.append(f"  [{pri}] {summary_text} — {player}")
        lines.append("")

    return "\n".join(lines)


# ── Send email ──────────────────────────────────────────────────────
def send_digest(to_email, email_html, email_text, item_count):
    now = datetime.now(timezone.utc)
    subject = f"Feedback Digest — {now.strftime('%d %b')} — {item_count} item{'s' if item_count != 1 else ''}"

    try:
        body = json.dumps({
            "from": FROM_EMAIL,
            "to": [to_email],
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
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status < 300:
                print(f"  [EMAIL] Digest sent to {to_email} ({item_count} items)")
                return True
            print(f"  [EMAIL] Failed: {resp.status}")
            return False
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        print(f"  [EMAIL] Error: {e} — {err_body}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"  [EMAIL] Error: {e}", file=sys.stderr)
        return False


# ── Main ────────────────────────────────────────────────────────────
def run():
    print("=== Feedback Digest ===")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")
    print(f"Period: last {HOURS} hours")
    print(f"Recipient: {DIGEST_EMAIL}")
    if DRY_RUN:
        print("** DRY RUN — no email will be sent **")

    feedback = fetch_recent_feedback(HOURS)
    print(f"  Found {len(feedback)} feedback items")

    if not feedback:
        print("  No feedback to report — skipping digest.")
        return

    by_cat = defaultdict(int)
    by_pri = defaultdict(int)
    for item in feedback:
        by_cat[item.get("category", "other")] += 1
        by_pri[item.get("priority", "medium")] += 1

    print(f"  By category: {dict(by_cat)}")
    print(f"  By priority: {dict(by_pri)}")

    print("  Generating executive summary...")
    summary = generate_executive_summary(feedback)
    print(f"  Summary: {summary[:100]}...")

    email_html = build_digest_html(feedback, summary)
    email_text = build_digest_text(feedback, summary)

    if DRY_RUN:
        print("\n--- DRY RUN OUTPUT ---")
        print(email_text)
        print("--- END DRY RUN ---")
    else:
        send_digest(DIGEST_EMAIL, email_html, email_text, len(feedback))

    print("Done.")


if __name__ == "__main__":
    run()
