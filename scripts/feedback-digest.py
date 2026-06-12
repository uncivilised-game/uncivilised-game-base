#!/usr/bin/env python3
"""
Feedback Digest — daily morning summary of player feedback, categorised and prioritised.

Queries feedback from the last 24 hours (or all undigested feedback), groups by category
and priority, uses Claude to generate an executive summary, and emails the result.

Runs on a schedule (GitHub Actions) or manually.
Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, RESEND_API_KEY
Optional: DIGEST_EMAIL (recipient), LOOKBACK_HOURS (default 24), DRY_RUN
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
LOOKBACK_HOURS = int(os.environ.get("LOOKBACK_HOURS", "24"))
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"

CATEGORY_LABELS = {
    "bug_report": "Bug Reports",
    "feature_request": "Feature Requests",
    "gameplay_feedback": "Gameplay Feedback",
    "question": "Questions",
    "other": "Other",
}

CATEGORY_ORDER = ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}

PRIORITY_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}


# ── HTTP helpers (same pattern as other scripts) ───────────────────
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


# ── Fetch feedback ────────────────────────────────────────────────
def fetch_recent_feedback(since):
    """Fetch all feedback since a given timestamp."""
    since_iso = since.strftime("%Y-%m-%dT%H:%M:%S%z")
    params = (
        f"created_at=gte.{since_iso}"
        "&select=id,message,category,priority,ai_summary,player_name,visitor_id,created_at,status"
        "&order=created_at.desc"
    )
    return sb_get("feedback", params)


def fetch_all_time_stats():
    """Fetch counts by category for all-time context."""
    rows = sb_get("feedback", "select=category")
    counts = defaultdict(int)
    for row in rows:
        counts[row.get("category", "other")] += 1
    return dict(counts)


# ── Claude summary ────────────────────────────────────────────────
def generate_summary(feedback_items, period_label):
    """Ask Claude to write a concise executive summary of the feedback."""
    if not feedback_items:
        return "No new feedback in this period."

    items_text = []
    for fb in feedback_items:
        cat = fb.get("category", "other")
        pri = fb.get("priority", "medium")
        player = fb.get("player_name") or "anonymous"
        summary = fb.get("ai_summary") or fb.get("message", "")[:120]
        items_text.append(f"- [{cat}/{pri}] {player}: {summary}")

    prompt = f"""You are summarising player feedback for Uncivilized, a browser-based 4X strategy game.

Here are {len(feedback_items)} feedback items from {period_label}:

{chr(10).join(items_text)}

Write a brief executive summary (3-5 sentences) highlighting:
1. The most important/urgent issues players are reporting
2. The most requested features
3. Any emerging patterns or recurring themes
4. Overall sentiment

Be direct and actionable. This is for the game developer's morning briefing."""

    result = _req("POST", "https://api.anthropic.com/v1/messages", data={
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 500,
        "messages": [{"role": "user", "content": prompt}],
    }, headers={
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    })

    blocks = result.get("content", [])
    for block in blocks:
        if block.get("type") == "text":
            return block["text"]
    return "Could not generate summary."


# ── Format HTML email ─────────────────────────────────────────────
def format_digest_email(feedback_items, summary, since, all_time_stats):
    """Build the HTML email body."""
    now = datetime.now(timezone.utc)
    period = f"{since.strftime('%b %d %H:%M')} – {now.strftime('%b %d %H:%M UTC')}"

    # Group by category
    by_category = defaultdict(list)
    for fb in feedback_items:
        by_category[fb.get("category", "other")].append(fb)

    # Count by priority
    by_priority = defaultdict(int)
    for fb in feedback_items:
        by_priority[fb.get("priority", "medium")] += 1

    # Priority bar
    priority_bar = " · ".join(
        f"{PRIORITY_EMOJI.get(p, '⚪')} {by_priority[p]} {p}"
        for p in ["critical", "high", "medium", "low"]
        if by_priority[p] > 0
    )

    # Build category sections
    sections_html = ""
    for cat in CATEGORY_ORDER:
        items = by_category.get(cat, [])
        if not items:
            continue
        items.sort(key=lambda x: PRIORITY_ORDER.get(x.get("priority", "medium"), 2))
        label = CATEGORY_LABELS.get(cat, cat)

        rows_html = ""
        for fb in items:
            pri = fb.get("priority", "medium")
            emoji = PRIORITY_EMOJI.get(pri, "⚪")
            player = fb.get("player_name") or "anonymous"
            summary_text = fb.get("ai_summary") or fb.get("message", "")[:100]
            created = fb.get("created_at", "")[:16].replace("T", " ")
            rows_html += f"""<tr>
  <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;white-space:nowrap">{emoji} {pri}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#b8a88a">{player}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a">{summary_text}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#666;white-space:nowrap">{created}</td>
</tr>"""

        sections_html += f"""
<h3 style="color:#c9a84c;margin:24px 0 8px;font-size:16px">{label} ({len(items)})</h3>
<table style="width:100%;border-collapse:collapse;font-size:13px">
<tr style="color:#888;text-align:left">
  <th style="padding:6px 10px;border-bottom:2px solid #333">Priority</th>
  <th style="padding:6px 10px;border-bottom:2px solid #333">Player</th>
  <th style="padding:6px 10px;border-bottom:2px solid #333">Summary</th>
  <th style="padding:6px 10px;border-bottom:2px solid #333">Time</th>
</tr>
{rows_html}
</table>"""

    # All-time totals
    total_all_time = sum(all_time_stats.values())
    all_time_html = " · ".join(
        f"{CATEGORY_LABELS.get(c, c)}: {all_time_stats.get(c, 0)}"
        for c in CATEGORY_ORDER
        if all_time_stats.get(c, 0) > 0
    )

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#1a1a1a;color:#e0d6c2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:720px;margin:0 auto;padding:24px">

<h1 style="color:#c9a84c;font-size:22px;margin-bottom:4px">Feedback Digest</h1>
<p style="color:#888;margin:0 0 20px;font-size:13px">{period} · {len(feedback_items)} items</p>

<div style="background:#222;border:1px solid #333;border-radius:8px;padding:16px;margin-bottom:20px">
<h2 style="color:#e0d6c2;font-size:15px;margin:0 0 8px">Summary</h2>
<p style="color:#b8a88a;font-size:14px;line-height:1.5;margin:0">{summary}</p>
</div>

<div style="margin-bottom:16px;font-size:14px">{priority_bar}</div>

{sections_html}

<div style="margin-top:32px;padding-top:16px;border-top:1px solid #333;color:#666;font-size:12px">
<p>All-time: {total_all_time} total feedback · {all_time_html}</p>
</div>

</div>
</body>
</html>"""


def format_empty_email(since):
    """Short email when there's no feedback."""
    now = datetime.now(timezone.utc)
    period = f"{since.strftime('%b %d %H:%M')} – {now.strftime('%b %d %H:%M UTC')}"
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#1a1a1a;color:#e0d6c2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:720px;margin:0 auto;padding:24px">
<h1 style="color:#c9a84c;font-size:22px;margin-bottom:4px">Feedback Digest</h1>
<p style="color:#888;margin:0 0 20px;font-size:13px">{period}</p>
<p style="color:#b8a88a;font-size:14px">No new feedback in this period. Quiet day! 🏖️</p>
</div>
</body>
</html>"""


# ── Send email ────────────────────────────────────────────────────
def send_email(to, subject, html_body):
    """Send an email via Resend API."""
    return _req("POST", "https://api.resend.com/emails", data={
        "from": FROM_EMAIL,
        "to": [to],
        "subject": subject,
        "html": html_body,
    }, headers={
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json",
    })


# ── Main ──────────────────────────────────────────────────────────
def run():
    print("=== Feedback Digest ===")
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=LOOKBACK_HOURS)
    print(f"Time: {now.isoformat()}")
    print(f"Lookback: {LOOKBACK_HOURS}h (since {since.isoformat()})")
    print(f"Recipient: {DIGEST_EMAIL}")
    print(f"Dry run: {DRY_RUN}")

    # Fetch recent feedback
    print("\n1. Fetching recent feedback...")
    feedback = fetch_recent_feedback(since)
    print(f"   Found {len(feedback)} items in the last {LOOKBACK_HOURS}h")

    if not feedback:
        if DRY_RUN:
            print("\n   [DRY RUN] Would send empty digest email")
            return
        print("\n   Sending empty digest...")
        html_body = format_empty_email(since)
        send_email(DIGEST_EMAIL, "Feedback Digest — No new feedback", html_body)
        print("   Sent.")
        return

    # Stats breakdown
    by_cat = defaultdict(int)
    by_pri = defaultdict(int)
    for fb in feedback:
        by_cat[fb.get("category", "other")] += 1
        by_pri[fb.get("priority", "medium")] += 1
    print(f"   By category: {dict(by_cat)}")
    print(f"   By priority: {dict(by_pri)}")

    # Unique reporters
    reporters = set()
    for fb in feedback:
        reporters.add(fb.get("player_name") or fb.get("visitor_id") or "anon")
    print(f"   Unique reporters: {len(reporters)}")

    # All-time stats for context
    print("\n2. Fetching all-time stats...")
    all_time_stats = fetch_all_time_stats()
    print(f"   All-time: {sum(all_time_stats.values())} total")

    # Generate Claude summary
    print("\n3. Generating summary...")
    period_label = f"the last {LOOKBACK_HOURS} hours"
    summary = generate_summary(feedback, period_label)
    print(f"   Summary: {summary[:100]}...")

    # Build and send email
    print("\n4. Building email...")
    subject = f"Feedback Digest — {len(feedback)} items"
    if by_pri.get("critical"):
        subject = f"⚠️ Feedback Digest — {by_pri['critical']} critical, {len(feedback)} total"

    html_body = format_digest_email(feedback, summary, since, all_time_stats)

    if DRY_RUN:
        print(f"\n   [DRY RUN] Would send to {DIGEST_EMAIL}")
        print(f"   Subject: {subject}")
        print(f"   Summary: {summary}")
        return

    print(f"\n   Sending to {DIGEST_EMAIL}...")
    send_email(DIGEST_EMAIL, subject, html_body)
    print("   Sent!")


if __name__ == "__main__":
    run()
