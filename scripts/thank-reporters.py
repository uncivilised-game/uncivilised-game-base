#!/usr/bin/env python3
"""
Thank Reporters — sends thank-you emails to players who reported issues that got fixed.

Triggered by GitHub Actions when a conviction issue is closed, or manually via workflow_dispatch.
Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, GITHUB_TOKEN
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

# ── Config ──────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
RESEND_API_KEY = os.environ["RESEND_API_KEY"]
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GITHUB_REPO = os.environ.get("GITHUB_REPO", "uncivilised-game/uncivilised-game-base")

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"
REPLY_TO_EMAIL = "hello@uncivilized.fun"


# ── HTTP helpers (same pattern as conviction-triage.py) ────────────
def _req(method, url, data=None, headers=None, retries=2):
    """Simple HTTP request with retry."""
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


def sb_patch(path, data, params=""):
    url = f"{SUPABASE_URL}/rest/v1/{path}?{params}" if params else f"{SUPABASE_URL}/rest/v1/{path}"
    return _req("PATCH", url, data=data, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    })


def gh_get(path):
    return _req("GET", f"https://api.github.com{path}", headers={
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })


# ── Email ──────────────────────────────────────────────────────────
THANK_YOU_HTML = """<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0d0f0e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0f0e;padding:40px 20px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
<tr><td style="text-align:center;padding:0 0 8px"><span style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;color:#c9a84c;letter-spacing:3px">UNCIVILIZED</span></td></tr>
<tr><td style="padding:0 0 32px"><div style="height:1px;background:linear-gradient(to right,transparent,#c9a84c40,transparent)"></div></td></tr>
<tr><td style="color:#e8e0d0;font-size:20px;line-height:30px;padding:0 0 16px;font-weight:600">Your report made a difference, {username}.</td></tr>
<tr><td style="color:#b8b0a0;font-size:15px;line-height:25px;padding:0 0 12px">Remember when you reported this?</td></tr>
<tr><td style="color:#8a8578;font-size:14px;line-height:22px;padding:0 0 20px;border-left:3px solid #c9a84c40;padding-left:16px"><em>&ldquo;{issue_title}&rdquo;</em></td></tr>
<tr><td style="color:#b8b0a0;font-size:15px;line-height:25px;padding:0 0 24px">We just shipped a fix. Your feedback helped us find and prioritize this issue &mdash; thank you for making the game better for everyone.</td></tr>
<tr><td style="text-align:center;padding:0 0 24px"><a href="https://uncivilized.fun" style="display:inline-block;background:linear-gradient(135deg,#c9a84c,#a08030);color:#1a1a0e;font-size:16px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:6px;letter-spacing:0.5px">Play Now</a></td></tr>
<tr><td style="color:#b8b0a0;font-size:14px;line-height:22px;padding:0 0 8px;text-align:center">Keep the reports coming &mdash; detailed bug reports and feature requests are eligible for our <strong style="color:#c9a84c">bounty program</strong>.</td></tr>
<tr><td style="padding:32px 0 0"><div style="height:1px;background:linear-gradient(to right,transparent,#c9a84c20,transparent)"></div></td></tr>
<tr><td style="color:#5a5548;font-size:12px;line-height:18px;padding:16px 0 0;text-align:center">Uncivilized &mdash; The Ancient Era<br><a href="https://uncivilized.fun" style="color:#8a8578;text-decoration:none">uncivilized.fun</a></td></tr>
</table></td></tr></table></body></html>"""


def send_thank_you_email(to_email, username, issue_title):
    """Send a thank-you email to a reporter. Returns True on success."""
    html = THANK_YOU_HTML.replace("{username}", username).replace("{issue_title}", issue_title)
    try:
        body = json.dumps({
            "from": FROM_EMAIL,
            "to": [to_email],
            "reply_to": REPLY_TO_EMAIL,
            "subject": f"Your bug report was fixed — thanks, {username}!",
            "html": html,
            "text": (
                f"Hey {username}, remember reporting \"{issue_title}\"? "
                f"We just shipped a fix. Thanks for helping make the game better! "
                f"Play now at https://uncivilized.fun"
            ),
            "headers": {"List-Unsubscribe": f"<mailto:{REPLY_TO_EMAIL}?subject=unsubscribe>"},
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
                print(f"  [EMAIL] Thank-you sent to {to_email} ({username})")
                return True
            print(f"  [EMAIL] Failed for {to_email}: {resp.status}")
            return False
    except Exception as e:
        print(f"  [EMAIL] Error sending to {to_email}: {e}")
        return False


# ── Resolve reporter emails ───────────────────────────────────────
def resolve_reporter_emails(player_names):
    """
    Look up emails for a list of player_names via the players table.
    Returns {player_name: email} for players with verified emails.
    """
    if not player_names:
        return {}

    # Supabase REST API: filter by username in list
    names_csv = ",".join(player_names)
    rows = sb_get("players", f"username=in.({names_csv})&select=username,email,email_verified")

    result = {}
    for row in rows:
        username = row.get("username", "")
        email = row.get("email", "")
        verified = row.get("email_verified", False)
        if email and verified:
            result[username] = email
        elif email and not verified:
            print(f"  Skipping {username} — email not verified")
        else:
            print(f"  Skipping {username} — no email on file")
    return result


# ── Process a single issue ─────────────────────────────────────────
def thank_reporters_for_issue(issue_number, issue_title):
    """Find reporters for a closed issue, send thank-you emails, mark as thanked."""
    print(f"\nProcessing issue #{issue_number}: {issue_title}")

    # Fetch feedback linked to this issue that hasn't been thanked yet
    feedback_rows = sb_get(
        "feedback",
        f"github_issue_number=eq.{issue_number}&thanked_at=is.null"
        f"&select=id,player_name,visitor_id,message"
    )

    if not feedback_rows:
        print("  No unthanked feedback found for this issue.")
        return {"sent": 0, "skipped": 0}

    # Collect unique player names (skip anonymous)
    player_names = list(set(
        row["player_name"] for row in feedback_rows
        if row.get("player_name") and row["player_name"] != "anon"
    ))

    if not player_names:
        print(f"  {len(feedback_rows)} feedback entries but all anonymous — marking as thanked.")
        now = datetime.now(timezone.utc).isoformat()
        for row in feedback_rows:
            sb_patch("feedback", {"thanked_at": now}, f"id=eq.{row['id']}")
        return {"sent": 0, "skipped": len(feedback_rows)}

    print(f"  Found {len(feedback_rows)} feedback entries from {len(player_names)} named reporters")

    # Resolve emails
    email_map = resolve_reporter_emails(player_names)
    print(f"  Resolved {len(email_map)} emails out of {len(player_names)} reporters")

    sent = 0
    skipped = 0
    now = datetime.now(timezone.utc).isoformat()

    # Send one email per unique reporter (not per feedback entry)
    thanked_names = set()
    for name in player_names:
        email = email_map.get(name)
        if email and name not in thanked_names:
            if send_thank_you_email(email, name, issue_title):
                sent += 1
                thanked_names.add(name)
            else:
                skipped += 1
        else:
            skipped += 1

    # Mark all feedback rows as thanked (even for reporters without emails,
    # so they don't get re-processed)
    for row in feedback_rows:
        sb_patch("feedback", {"thanked_at": now}, f"id=eq.{row['id']}")

    return {"sent": sent, "skipped": skipped}


# ── Find closed conviction issues that were actually fixed ─────────
def find_fixed_conviction_issues():
    """Fetch conviction-labeled issues closed as 'completed' (not 'not_planned')."""
    issues = []
    page = 1
    while True:
        batch = gh_get(
            f"/repos/{GITHUB_REPO}/issues?"
            f"labels=conviction&state=closed&sort=updated&direction=desc"
            f"&per_page=50&page={page}"
        )
        if not batch:
            break
        for item in batch:
            if "pull_request" in item:
                continue
            # Skip issues closed as "not planned" — only thank for actual fixes
            if item.get("state_reason") == "not_planned":
                continue
            issues.append(item)
        if len(batch) < 50:
            break
        page += 1
    return issues


# ── Main ───────────────────────────────────────────────────────────
def run():
    print("=== Thank Reporters ===")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")

    # Check for a specific issue number (from workflow_dispatch or CLI)
    issue_number = os.environ.get("ISSUE_NUMBER", "")

    if issue_number:
        # Single issue mode
        issue_number = int(issue_number)
        issue = gh_get(f"/repos/{GITHUB_REPO}/issues/{issue_number}")
        if issue.get("state_reason") == "not_planned":
            print(f"\nIssue #{issue_number} was closed as not planned — skipping.")
            return
        result = thank_reporters_for_issue(issue_number, issue.get("title", "Unknown"))
        print(f"\nDone. Sent {result['sent']} emails, skipped {result['skipped']}.")
    else:
        # Scan mode: find all fixed conviction issues with unthanked reporters
        print("\nScanning for fixed conviction issues with unthanked reporters...")
        issues = find_fixed_conviction_issues()
        print(f"Found {len(issues)} closed conviction issues")

        total_sent = 0
        total_skipped = 0

        for issue in issues:
            result = thank_reporters_for_issue(issue["number"], issue.get("title", "Unknown"))
            total_sent += result["sent"]
            total_skipped += result["skipped"]

        print(f"\n=== Done. Sent {total_sent} thank-you emails, skipped {total_skipped}. ===")


if __name__ == "__main__":
    run()
