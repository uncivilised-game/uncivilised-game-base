#!/usr/bin/env python3
"""
Feedback Digest — daily summary of player feedback, categorised and prioritised.

Runs every morning via GitHub Actions. Fetches the last 24h of feedback from
Supabase, groups by category/priority, asks Claude for an executive summary,
and emails the digest via Resend.

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, RESEND_API_KEY
Optional: DIGEST_EMAIL (defaults to REPLY_TO_EMAIL), HOURS=24, DRY_RUN=true
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
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
RESEND_API_KEY = os.environ["RESEND_API_KEY"]

DIGEST_EMAIL = os.environ.get("DIGEST_EMAIL", "jamie247@gmail.com")
HOURS = int(os.environ.get("HOURS", "24"))
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"
REPLY_TO_EMAIL = "hello@uncivilized.fun"

CATEGORY_LABELS = {
    "bug_report": "Bug Reports",
    "feature_request": "Feature Requests",
    "gameplay_feedback": "Gameplay Feedback",
    "question": "Questions",
    "other": "Other",
}
CATEGORY_EMOJI = {
    "bug_report": "&#128027;",
    "feature_request": "&#128161;",
    "gameplay_feedback": "&#127918;",
    "question": "&#10067;",
    "other": "&#128172;",
}
PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
PRIORITY_COLORS = {
    "critical": "#dc2626",
    "high": "#ea580c",
    "medium": "#ca8a04",
    "low": "#65a30d",
}


# ── HTTP helpers (same pattern as other scripts) ───────────────────
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


def claude(prompt, max_tokens=2048):
    return _req("POST", "https://api.anthropic.com/v1/messages", data={
        "model": "claude-sonnet-4-20250514",
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }, headers={
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    })


# ── Fetch feedback ─────────────────────────────────────────────────
def fetch_recent_feedback(hours):
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    cutoff_encoded = cutoff.replace("+", "%2B")
    params = (
        f"select=id,message,category,priority,ai_summary,player_name,game_state_snapshot,status,created_at"
        f"&created_at=gte.{cutoff_encoded}"
        f"&order=created_at.desc"
    )
    rows = sb_get("feedback", params)
    if not isinstance(rows, list):
        print(f"Unexpected response: {rows}", file=sys.stderr)
        return []
    return rows


# ── Group and sort ─────────────────────────────────────────────────
def group_feedback(rows):
    by_category = defaultdict(list)
    for row in rows:
        cat = row.get("category", "other") or "other"
        by_category[cat].append(row)

    for cat in by_category:
        by_category[cat].sort(
            key=lambda r: PRIORITY_ORDER.get(r.get("priority", "medium"), 2)
        )

    sorted_cats = sorted(
        by_category.items(),
        key=lambda kv: min(PRIORITY_ORDER.get(r.get("priority", "medium"), 2) for r in kv[1])
    )
    return sorted_cats


# ── Claude summary ─────────────────────────────────────────────────
def generate_summary(grouped):
    feedback_text = ""
    for cat, items in grouped:
        label = CATEGORY_LABELS.get(cat, cat)
        feedback_text += f"\n## {label} ({len(items)})\n"
        for item in items:
            priority = item.get("priority", "medium")
            summary = item.get("ai_summary") or item.get("message", "")[:100]
            player = item.get("player_name") or "anonymous"
            feedback_text += f"- [{priority}] {summary} (from: {player})\n"

    prompt = f"""You are the product manager for Uncivilised, a browser-based 4X strategy game.

Here is the player feedback received in the last {HOURS} hours:
{feedback_text}

Write a concise executive digest for the dev team. Include:

1. **Top-line summary** — one paragraph with the key takeaway (volume, sentiment, any critical issues)
2. **Critical / urgent items** — anything that needs immediate attention (crashes, data loss, blockers)
3. **Themes** — recurring patterns across multiple pieces of feedback, grouped naturally
4. **Quick wins** — small improvements that multiple players would appreciate
5. **Feature appetite** — what players are asking for, ranked by frequency/intensity

Keep it actionable and direct. Use bullet points. No fluff. If there are no critical items, say so.
Plain text only, no markdown formatting — this will be rendered in an HTML email."""

    resp = claude(prompt)
    if resp and "content" in resp:
        for block in resp["content"]:
            if block.get("type") == "text":
                return block["text"]
    return None


# ── Build email HTML ───────────────────────────────────────────────
def build_email_html(grouped, summary_text, total_count, period_hours):
    now = datetime.now(timezone.utc).strftime("%A %d %B %Y")

    stats_html = ""
    for cat, items in grouped:
        label = CATEGORY_LABELS.get(cat, cat)
        emoji = CATEGORY_EMOJI.get(cat, "")
        stats_html += f'<div style="display:inline-block;margin:0 16px 8px 0;">{emoji} <strong>{len(items)}</strong> {label}</div>'

    items_html = ""
    for cat, items in grouped:
        label = CATEGORY_LABELS.get(cat, cat)
        emoji = CATEGORY_EMOJI.get(cat, "")
        items_html += f'<h3 style="color:#1a1a2e;margin:24px 0 12px 0;font-size:16px;">{emoji} {label} ({len(items)})</h3>'
        items_html += '<table style="width:100%;border-collapse:collapse;font-size:14px;">'
        for item in items:
            priority = item.get("priority", "medium")
            p_color = PRIORITY_COLORS.get(priority, "#ca8a04")
            summary = item.get("ai_summary") or item.get("message", "")[:120]
            player = item.get("player_name") or "anonymous"
            created = item.get("created_at", "")[:16].replace("T", " ")
            items_html += f'''<tr style="border-bottom:1px solid #eee;">
<td style="padding:8px 8px 8px 0;vertical-align:top;width:70px;">
  <span style="background:{p_color};color:white;padding:2px 8px;border-radius:3px;font-size:11px;text-transform:uppercase;">{priority}</span>
</td>
<td style="padding:8px 4px;vertical-align:top;">{summary}</td>
<td style="padding:8px 0 8px 4px;vertical-align:top;color:#888;white-space:nowrap;font-size:12px;">{player}<br>{created}</td>
</tr>'''
        items_html += '</table>'

    summary_html = summary_text.replace("\n", "<br>") if summary_text else "<em>No summary generated.</em>"

    return f'''<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:640px;margin:0 auto;padding:20px;">

<div style="background:#1a1a2e;color:white;padding:24px;border-radius:8px 8px 0 0;">
  <h1 style="margin:0 0 4px 0;font-size:22px;">Uncivilised — Feedback Digest</h1>
  <p style="margin:0;opacity:0.8;font-size:14px;">{now} &middot; Last {period_hours}h &middot; {total_count} items</p>
</div>

<div style="background:white;padding:24px;border-bottom:1px solid #eee;">
  <h2 style="color:#1a1a2e;margin:0 0 12px 0;font-size:16px;">Overview</h2>
  <div style="margin-bottom:16px;">{stats_html}</div>
</div>

<div style="background:white;padding:24px;border-bottom:1px solid #eee;">
  <h2 style="color:#1a1a2e;margin:0 0 12px 0;font-size:16px;">Executive Summary</h2>
  <div style="color:#333;line-height:1.6;font-size:14px;">{summary_html}</div>
</div>

<div style="background:white;padding:24px;border-radius:0 0 8px 8px;">
  <h2 style="color:#1a1a2e;margin:0 0 4px 0;font-size:16px;">All Feedback</h2>
  {items_html}
</div>

<div style="text-align:center;padding:16px;color:#999;font-size:12px;">
  Feedback Digest &middot; Uncivilized &middot; <a href="https://uncivilized.fun" style="color:#999;">uncivilized.fun</a>
</div>

</div>
</body></html>'''


def build_email_text(grouped, summary_text, total_count, period_hours):
    now = datetime.now(timezone.utc).strftime("%A %d %B %Y")
    lines = [
        f"UNCIVILISED — FEEDBACK DIGEST",
        f"{now} | Last {period_hours}h | {total_count} items",
        "",
    ]
    if summary_text:
        lines.append("== EXECUTIVE SUMMARY ==")
        lines.append(summary_text)
        lines.append("")

    for cat, items in grouped:
        label = CATEGORY_LABELS.get(cat, cat).upper()
        lines.append(f"== {label} ({len(items)}) ==")
        for item in items:
            priority = item.get("priority", "medium").upper()
            summary = item.get("ai_summary") or item.get("message", "")[:120]
            player = item.get("player_name") or "anonymous"
            lines.append(f"  [{priority}] {summary} — {player}")
        lines.append("")

    return "\n".join(lines)


# ── Send email ─────────────────────────────────────────────────────
def send_email(subject, html_body, text_body):
    body = json.dumps({
        "from": FROM_EMAIL,
        "to": [DIGEST_EMAIL],
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
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status < 300:
            print(f"  [EMAIL] Digest sent to {DIGEST_EMAIL}")
            return True
        print(f"  [EMAIL] Failed: {resp.status}")
        return False


# ── Main ───────────────────────────────────────────────────────────
def run():
    print("=== Feedback Digest ===")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")
    print(f"Period: last {HOURS}h")
    if DRY_RUN:
        print("** DRY RUN — no email will be sent **")

    rows = fetch_recent_feedback(HOURS)
    print(f"Fetched {len(rows)} feedback items")

    if not rows:
        print("No feedback in this period. Skipping digest.")
        return

    grouped = group_feedback(rows)

    for cat, items in grouped:
        label = CATEGORY_LABELS.get(cat, cat)
        priorities = defaultdict(int)
        for item in items:
            priorities[item.get("priority", "medium")] += 1
        p_str = ", ".join(f"{k}={v}" for k, v in sorted(priorities.items(), key=lambda kv: PRIORITY_ORDER.get(kv[0], 2)))
        print(f"  {label}: {len(items)} ({p_str})")

    print("Generating executive summary...")
    summary_text = generate_summary(grouped)
    if summary_text:
        print("  Summary generated.")
    else:
        print("  [WARN] No summary generated — sending without it.")

    subject = f"Feedback Digest — {len(rows)} items ({datetime.now(timezone.utc).strftime('%d %b')})"
    html_body = build_email_html(grouped, summary_text, len(rows), HOURS)
    text_body = build_email_text(grouped, summary_text, len(rows), HOURS)

    if DRY_RUN:
        print(f"\n--- DRY RUN: would send to {DIGEST_EMAIL} ---")
        print(f"Subject: {subject}")
        print(text_body)
        return

    try:
        send_email(subject, html_body, text_body)
    except Exception as e:
        print(f"  [EMAIL] Error: {e}", file=sys.stderr)
        sys.exit(1)

    print("Done.")


if __name__ == "__main__":
    run()
