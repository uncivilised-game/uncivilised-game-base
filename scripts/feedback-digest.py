#!/usr/bin/env python3
"""
Feedback Digest — daily email summarising player feedback.

Queries Supabase for feedback received in the last 24 hours (or since
SINCE_HOURS), groups by category and priority, and sends a digest email
via Resend.

Runs on a daily cron (GitHub Actions) or manually.

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
Optional: DIGEST_EMAIL (default: repo owner), SINCE_HOURS (default: 24),
          DRY_RUN=true
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
SINCE_HOURS = int(os.environ.get("SINCE_HOURS", "24"))
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"

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
    "low": "#6b7280",
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


# ── Fetch recent feedback ─────────────────────────────────────────
def fetch_feedback(since_iso):
    params = (
        f"created_at=gte.{since_iso}"
        f"&select=id,player_name,visitor_id,message,category,priority,ai_summary,status,github_issue_number,created_at"
        f"&order=created_at.desc"
    )
    return sb_get("feedback", params)


# ── Build digest ──────────────────────────────────────────────────
def build_digest(feedback, since_dt):
    now = datetime.now(timezone.utc)
    period = f"{since_dt.strftime('%b %d %H:%M')} – {now.strftime('%b %d %H:%M')} UTC"

    # Group by category
    by_category = defaultdict(list)
    for fb in feedback:
        by_category[fb.get("category", "other")].append(fb)

    # Priority counts
    priority_counts = defaultdict(int)
    for fb in feedback:
        priority_counts[fb.get("priority", "low")] += 1

    # Unique reporters
    reporters = set()
    for fb in feedback:
        name = fb.get("player_name") or fb.get("visitor_id", "anonymous")
        reporters.add(name)

    # Linked to issues
    linked = sum(1 for fb in feedback if fb.get("github_issue_number"))

    # ── HTML ──
    sections = []

    # Summary banner
    sections.append(f"""
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:24px;">
        <h2 style="margin:0 0 12px;color:#1e293b;font-size:20px;">Feedback Digest</h2>
        <p style="margin:0 0 8px;color:#64748b;font-size:14px;">{period}</p>
        <div style="display:flex;gap:24px;flex-wrap:wrap;">
            <div><span style="font-size:28px;font-weight:bold;color:#1e293b;">{len(feedback)}</span>
                <span style="color:#64748b;font-size:13px;"> total</span></div>
            <div><span style="font-size:28px;font-weight:bold;color:#1e293b;">{len(reporters)}</span>
                <span style="color:#64748b;font-size:13px;"> reporters</span></div>
            <div><span style="font-size:28px;font-weight:bold;color:#1e293b;">{linked}</span>
                <span style="color:#64748b;font-size:13px;"> linked to issues</span></div>
        </div>
    </div>
    """)

    # Priority breakdown
    if any(priority_counts.values()):
        pills = []
        for p in ["critical", "high", "medium", "low"]:
            count = priority_counts.get(p, 0)
            if count:
                color = PRIORITY_COLORS[p]
                pills.append(
                    f'<span style="display:inline-block;background:{color};color:#fff;'
                    f'border-radius:12px;padding:2px 10px;font-size:12px;margin-right:6px;">'
                    f'{p}: {count}</span>'
                )
        sections.append(f"""
        <div style="margin-bottom:20px;">
            <strong style="color:#475569;font-size:13px;">By priority:</strong>
            <div style="margin-top:6px;">{"".join(pills)}</div>
        </div>
        """)

    # Category sections (ordered by count)
    ordered_cats = sorted(by_category.keys(), key=lambda c: len(by_category[c]), reverse=True)

    for cat in ordered_cats:
        items = by_category[cat]
        label = CATEGORY_LABELS.get(cat, cat)
        emoji = CATEGORY_EMOJI.get(cat, "")
        # Sort items by priority
        items.sort(key=lambda fb: PRIORITY_ORDER.get(fb.get("priority", "low"), 3))

        rows = []
        for fb in items:
            pri = fb.get("priority", "low")
            pri_color = PRIORITY_COLORS.get(pri, "#6b7280")
            summary = html.escape(fb.get("ai_summary") or fb.get("message", "")[:120])
            player = html.escape(fb.get("player_name") or "anonymous")
            created = fb.get("created_at", "")[:16].replace("T", " ")
            issue_link = ""
            if fb.get("github_issue_number"):
                issue_num = fb["github_issue_number"]
                issue_link = (
                    f' <a href="https://github.com/uncivilised-game/uncivilised-game-base/issues/{issue_num}"'
                    f' style="color:#2563eb;text-decoration:none;font-size:12px;">#{issue_num}</a>'
                )
            status_badge = ""
            if fb.get("status") == "processed":
                status_badge = ' <span style="color:#16a34a;font-size:11px;">&#10003; triaged</span>'
            elif fb.get("status") == "pending":
                status_badge = ' <span style="color:#ca8a04;font-size:11px;">pending</span>'

            rows.append(f"""
            <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:8px 12px;vertical-align:top;">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{pri_color};margin-right:6px;vertical-align:middle;"></span>
                    <span style="font-size:12px;color:{pri_color};">{pri}</span>
                </td>
                <td style="padding:8px 12px;vertical-align:top;">
                    <div style="font-size:14px;color:#1e293b;">{summary}{issue_link}{status_badge}</div>
                    <div style="font-size:12px;color:#94a3b8;margin-top:2px;">{player} &middot; {created}</div>
                </td>
            </tr>
            """)

        sections.append(f"""
        <div style="margin-bottom:28px;">
            <h3 style="margin:0 0 8px;color:#334155;font-size:16px;">{emoji} {label} ({len(items)})</h3>
            <table style="width:100%;border-collapse:collapse;">
                {"".join(rows)}
            </table>
        </div>
        """)

    # Wrap in full email
    body = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#1e293b;">
        {"".join(sections)}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="font-size:12px;color:#94a3b8;text-align:center;">
            Uncivilized Feedback Digest &middot; Auto-generated by GitHub Actions
        </p>
    </body>
    </html>
    """
    return body


def build_empty_digest(since_dt):
    now = datetime.now(timezone.utc)
    period = f"{since_dt.strftime('%b %d %H:%M')} – {now.strftime('%b %d %H:%M')} UTC"
    return f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#1e293b;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;text-align:center;">
            <h2 style="margin:0 0 8px;color:#1e293b;">Feedback Digest</h2>
            <p style="color:#64748b;font-size:14px;">{period}</p>
            <p style="color:#94a3b8;font-size:16px;margin-top:16px;">No new feedback in this period. &#127881;</p>
        </div>
    </body>
    </html>
    """


# ── Main ──────────────────────────────────────────────────────────
def main():
    since_dt = datetime.now(timezone.utc) - timedelta(hours=SINCE_HOURS)
    since_iso = since_dt.strftime("%Y-%m-%dT%H:%M:%S+00:00")

    print(f"Fetching feedback since {since_iso} ...")
    feedback = fetch_feedback(since_iso)
    print(f"Found {len(feedback)} feedback items")

    if feedback:
        subject = f"Feedback Digest: {len(feedback)} items — {datetime.now(timezone.utc).strftime('%b %d')}"
        body = build_digest(feedback, since_dt)
    else:
        subject = f"Feedback Digest: All quiet — {datetime.now(timezone.utc).strftime('%b %d')}"
        body = build_empty_digest(since_dt)

    if DRY_RUN:
        print(f"\n[DRY RUN] Would send to: {DIGEST_EMAIL}")
        print(f"Subject: {subject}")
        print(f"Items: {len(feedback)}")
        if feedback:
            by_cat = defaultdict(int)
            by_pri = defaultdict(int)
            for fb in feedback:
                by_cat[fb.get("category", "other")] += 1
                by_pri[fb.get("priority", "low")] += 1
            print(f"Categories: {dict(by_cat)}")
            print(f"Priorities: {dict(by_pri)}")
        return

    print(f"Sending digest to {DIGEST_EMAIL} ...")
    result = send_email(DIGEST_EMAIL, subject, body)
    print(f"Sent: {result.get('id', 'ok')}")


if __name__ == "__main__":
    main()
