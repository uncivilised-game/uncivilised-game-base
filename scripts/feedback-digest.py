#!/usr/bin/env python3
"""
Feedback Digest — daily summary of player feedback, emailed every morning.

Queries the Supabase `feedback` table for entries since the last digest,
groups them by category and priority, generates an executive summary via
Claude, and sends the report via Resend.

Cron-triggered by .github/workflows/feedback-digest.yml.

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, ANTHROPIC_API_KEY
Optional: DIGEST_EMAIL (default: repo owner), HOURS=24, DRY_RUN=true
"""

import os
import sys
import json
import re
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from collections import defaultdict

# ── Config ──────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
DIGEST_EMAIL = os.environ.get("DIGEST_EMAIL", "jamie247@gmail.com")
HOURS = int(os.environ.get("HOURS", "24"))
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

SB_REST = f"{SUPABASE_URL}/rest/v1"
SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"

CATEGORY_LABELS = {
    "bug_report": "Bug Reports",
    "feature_request": "Feature Requests",
    "gameplay_feedback": "Gameplay Feedback",
    "question": "Questions",
    "other": "Other",
}

PRIORITY_ORDER = ["critical", "high", "medium", "low"]

CATEGORY_COLORS = {
    "bug_report": "#d9534f",
    "feature_request": "#5b8dd9",
    "gameplay_feedback": "#c9a84c",
    "question": "#8a8578",
    "other": "#555555",
}

PRIORITY_COLORS = {
    "critical": "#d9534f",
    "high": "#e67e22",
    "medium": "#c9a84c",
    "low": "#8a8578",
}


def sb_get(table, select="*", filters="", order=None, limit=None):
    url = f"{SB_REST}/{table}?select={quote(select)}"
    if filters:
        url += f"&{filters.replace('+', '%2B')}"
    if order:
        url += f"&order={order}"
    if limit:
        url += f"&limit={limit}"
    req = urllib.request.Request(url, headers=SB_HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def generate_summary(items):
    if not ANTHROPIC_API_KEY or not items:
        return None
    feedback_text = "\n".join(
        f"- [{it['category']}][{it['priority']}] {it.get('ai_summary') or it.get('message', '')[:120]}"
        for it in items[:50]
    )
    payload = json.dumps({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 500,
        "messages": [{
            "role": "user",
            "content": f"""You are an analyst for Uncivilized, a 4X strategy game. Below is the last {HOURS}h of player feedback.

Write a brief executive summary (3-5 bullet points) highlighting:
1. The most urgent issues players are reporting
2. The most requested features
3. Overall player sentiment
4. Any patterns or recurring themes

Be specific — cite actual feedback where relevant. Keep it concise and actionable.

Feedback:
{feedback_text}"""
        }]
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            return data["content"][0]["text"]
    except Exception as e:
        print(f"[WARN] Claude summary failed: {e}")
        return None


def build_html(items, summary_text):
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=HOURS)

    by_category = defaultdict(list)
    by_priority = defaultdict(int)
    for it in items:
        cat = it.get("category") or "other"
        pri = it.get("priority") or "medium"
        by_category[cat].append(it)
        by_priority[pri] += 1

    total = len(items)
    stats_html = f"""
    <div style="background:#1a1a2e;padding:20px;border-radius:8px;margin-bottom:24px;">
      <h2 style="color:#c9a84c;margin:0 0 16px 0;font-size:20px;">
        \U0001f4ca {total} feedback item{"s" if total != 1 else ""} in the last {HOURS}h
      </h2>
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
    """
    for pri in PRIORITY_ORDER:
        count = by_priority.get(pri, 0)
        if count:
            color = PRIORITY_COLORS[pri]
            stats_html += f"""
        <div style="background:{color}22;border:1px solid {color};border-radius:6px;padding:8px 16px;">
          <span style="color:{color};font-weight:bold;font-size:18px;">{count}</span>
          <span style="color:#ccc;font-size:13px;margin-left:4px;">{pri}</span>
        </div>"""
    stats_html += "</div></div>"

    summary_html = ""
    if summary_text:
        formatted = summary_text.replace("\n", "<br>")
        summary_html = f"""
    <div style="background:#1a1a2e;padding:20px;border-radius:8px;margin-bottom:24px;border-left:3px solid #5b8dd9;">
      <h2 style="color:#5b8dd9;margin:0 0 12px 0;font-size:18px;">AI Summary</h2>
      <div style="color:#ddd;font-size:14px;line-height:1.6;">{formatted}</div>
    </div>"""

    sections_html = ""
    for cat_key in ["bug_report", "feature_request", "gameplay_feedback", "question", "other"]:
        cat_items = by_category.get(cat_key, [])
        if not cat_items:
            continue
        cat_items.sort(key=lambda x: PRIORITY_ORDER.index(x.get("priority", "medium"))
                       if x.get("priority") in PRIORITY_ORDER else 99)
        color = CATEGORY_COLORS.get(cat_key, "#555")
        label = CATEGORY_LABELS.get(cat_key, cat_key)
        sections_html += f"""
    <div style="margin-bottom:24px;">
      <h2 style="color:{color};font-size:18px;margin:0 0 12px 0;padding-bottom:8px;border-bottom:1px solid #333;">
        {label} ({len(cat_items)})
      </h2>"""
        for it in cat_items:
            pri = it.get("priority", "medium")
            pri_color = PRIORITY_COLORS.get(pri, "#888")
            summary = it.get("ai_summary") or (it.get("message") or "")[:120]
            player = it.get("player_name") or "Anonymous"
            created = it.get("created_at", "")[:16].replace("T", " ")
            msg_preview = (it.get("message") or "")[:200]
            if len(it.get("message") or "") > 200:
                msg_preview += "…"
            sections_html += f"""
      <div style="background:#1a1a2e;padding:12px 16px;border-radius:6px;margin-bottom:8px;border-left:3px solid {pri_color};">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="color:#eee;font-weight:bold;font-size:14px;">{summary}</span>
          <span style="background:{pri_color}33;color:{pri_color};font-size:11px;padding:2px 8px;border-radius:4px;white-space:nowrap;">{pri}</span>
        </div>
        <div style="color:#999;font-size:12px;margin-bottom:4px;">\U0001f464 {player} · {created} UTC</div>
        <div style="color:#aaa;font-size:13px;font-style:italic;">\"{msg_preview}\"</div>
      </div>"""
        sections_html += "</div>"

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0d0d1a;color:#eee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;margin:0;">
  <div style="max-width:640px;margin:0 auto;">
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="color:#c9a84c;font-size:24px;margin:0;">⚔️ Uncivilized — Player Feedback Digest</h1>
      <p style="color:#888;font-size:13px;margin:8px 0 0 0;">
        {since.strftime('%b %d %H:%M')} – {now.strftime('%b %d %H:%M')} UTC
      </p>
    </div>
    {stats_html}
    {summary_html}
    {sections_html}
    <div style="text-align:center;color:#666;font-size:12px;margin-top:32px;padding-top:16px;border-top:1px solid #333;">
      Feedback Digest · Uncivilized · <a href="https://uncivilized.fun" style="color:#5b8dd9;">uncivilized.fun</a>
    </div>
  </div>
</body>
</html>"""


def send_email(subject, html_body):
    if not RESEND_API_KEY:
        print("[ERROR] RESEND_API_KEY not set — cannot send email")
        sys.exit(1)
    payload = json.dumps({
        "from": FROM_EMAIL,
        "to": [DIGEST_EMAIL],
        "subject": subject,
        "html": html_body,
    }).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read())
        print(f"[OK] Email sent: {result.get('id', 'unknown')}")


def main():
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=HOURS)
    since_iso = since.isoformat()

    print(f"Fetching feedback since {since_iso} ({HOURS}h window)")

    items = sb_get(
        "feedback",
        select="id,visitor_id,player_name,message,category,priority,ai_summary,created_at,status",
        filters=f"created_at=gte.{since_iso}",
        order="created_at.desc",
    )

    print(f"Found {len(items)} feedback items")

    if not items:
        print("No feedback in this period — skipping digest.")
        if not DRY_RUN:
            send_email(
                f"Uncivilized Feedback Digest — No new feedback",
                build_html([], None),
            )
        return

    by_cat = defaultdict(int)
    by_pri = defaultdict(int)
    for it in items:
        by_cat[it.get("category", "other")] += 1
        by_pri[it.get("priority", "medium")] += 1

    print(f"Categories: {dict(by_cat)}")
    print(f"Priorities: {dict(by_pri)}")

    summary = generate_summary(items)
    if summary:
        print(f"Generated AI summary ({len(summary)} chars)")

    html = build_html(items, summary)

    critical = by_pri.get("critical", 0)
    high = by_pri.get("high", 0)
    subject_parts = [f"Uncivilized Feedback Digest — {len(items)} item{'s' if len(items) != 1 else ''}"]
    if critical:
        subject_parts.append(f"\U0001f534 {critical} critical")
    if high:
        subject_parts.append(f"\U0001f7e0 {high} high")
    subject = " · ".join(subject_parts)

    if DRY_RUN:
        print(f"\n[DRY RUN] Would send to: {DIGEST_EMAIL}")
        print(f"[DRY RUN] Subject: {subject}")
        print(f"[DRY RUN] HTML length: {len(html)} chars")
        if summary:
            print(f"\nAI Summary:\n{summary}")
        for it in items[:10]:
            print(f"  [{it.get('priority')}] [{it.get('category')}] {it.get('ai_summary', '')[:80]}")
        if len(items) > 10:
            print(f"  ... and {len(items) - 10} more")
    else:
        send_email(subject, html)
        print(f"Digest sent to {DIGEST_EMAIL}")


if __name__ == "__main__":
    main()
