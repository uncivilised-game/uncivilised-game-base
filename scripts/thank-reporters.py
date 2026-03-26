#!/usr/bin/env python3
"""
Thank Reporters — sends batched thank-you emails to players who reported fixed issues.

Manual trigger only (workflow_dispatch). Collects all unthanked fixed conviction issues,
groups them by reporter, and sends one email per player listing all their fixed issues
along with a custom admin-defined message.

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, GITHUB_TOKEN, CUSTOM_MESSAGE
Optional: DRY_RUN=true to preview without sending
"""

import os
import sys
import json
import time
import html
import urllib.request
import urllib.error
from datetime import datetime, timezone
from collections import defaultdict

# ── Config ──────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
RESEND_API_KEY = os.environ["RESEND_API_KEY"]
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GITHUB_REPO = os.environ.get("GITHUB_REPO", "uncivilised-game/uncivilised-game-base")
CUSTOM_MESSAGE = os.environ.get("CUSTOM_MESSAGE", "")
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"
REPLY_TO_EMAIL = "hello@uncivilized.fun"


# ── HTTP helpers (same pattern as conviction-triage.py) ────────────
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


# ── Resolve reporter emails ───────────────────────────────────────
def resolve_reporter_emails(player_names):
    """Look up emails for player_names via the players table. Returns {name: email}."""
    if not player_names:
        return {}
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


# ── Email ──────────────────────────────────────────────────────────
def build_issues_html(issues):
    """Build HTML list of fixed issues."""
    items = ""
    for issue in issues:
        title = html.escape(issue["title"])
        items += (
            f'<tr><td style="color:#b8b0a0;font-size:14px;line-height:22px;padding:4px 0">'
            f'&bull; {title}</td></tr>\n'
        )
    return items


def build_issues_text(issues):
    """Build plain text list of fixed issues."""
    return "\n".join(f"  - {issue['title']}" for issue in issues)


def send_batched_email(to_email, username, issues, custom_message):
    """Send a single thank-you email listing all fixed issues for this reporter."""
    safe_username = html.escape(username)
    safe_message = html.escape(custom_message)
    issues_html = build_issues_html(issues)
    issues_text = build_issues_text(issues)

    issue_word = "issue" if len(issues) == 1 else "issues"
    subject = f"We fixed {len(issues)} {issue_word} you reported — thanks, {username}!"

    email_html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0d0f0e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0f0e;padding:40px 20px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
<tr><td style="text-align:center;padding:0 0 8px"><span style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;color:#c9a84c;letter-spacing:3px">UNCIVILIZED</span></td></tr>
<tr><td style="padding:0 0 32px"><div style="height:1px;background:linear-gradient(to right,transparent,#c9a84c40,transparent)"></div></td></tr>
<tr><td style="color:#e8e0d0;font-size:20px;line-height:30px;padding:0 0 16px;font-weight:600">Your reports made a difference, {safe_username}.</td></tr>
<tr><td style="color:#b8b0a0;font-size:15px;line-height:25px;padding:0 0 20px">{safe_message}</td></tr>
<tr><td style="color:#e8e0d0;font-size:15px;line-height:25px;padding:0 0 8px;font-weight:600">Issues you reported that we fixed:</td></tr>
<table width="100%" cellpadding="0" cellspacing="0" style="padding:0 0 20px 8px">
{issues_html}</table>
<tr><td style="color:#b8b0a0;font-size:15px;line-height:25px;padding:0 0 24px">Thank you for helping make the game better for everyone.</td></tr>
<tr><td style="text-align:center;padding:0 0 24px"><a href="https://uncivilized.fun" style="display:inline-block;background:linear-gradient(135deg,#c9a84c,#a08030);color:#1a1a0e;font-size:16px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:6px;letter-spacing:0.5px">Play Now</a></td></tr>
<tr><td style="color:#b8b0a0;font-size:14px;line-height:22px;padding:0 0 8px;text-align:center">Keep the reports coming &mdash; detailed bug reports and feature requests are eligible for our <strong style="color:#c9a84c">bounty program</strong>.</td></tr>
<tr><td style="padding:32px 0 0"><div style="height:1px;background:linear-gradient(to right,transparent,#c9a84c20,transparent)"></div></td></tr>
<tr><td style="color:#5a5548;font-size:12px;line-height:18px;padding:16px 0 0;text-align:center">Uncivilized &mdash; The Ancient Era<br><a href="https://uncivilized.fun" style="color:#8a8578;text-decoration:none">uncivilized.fun</a></td></tr>
</table></td></tr></table></body></html>"""

    text = (
        f"Hey {username},\n\n"
        f"{custom_message}\n\n"
        f"Issues you reported that we fixed:\n{issues_text}\n\n"
        f"Thanks for helping make the game better!\n"
        f"Play now at https://uncivilized.fun"
    )

    try:
        body = json.dumps({
            "from": FROM_EMAIL,
            "to": [to_email],
            "reply_to": REPLY_TO_EMAIL,
            "subject": subject,
            "html": email_html,
            "text": text,
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
                print(f"  [EMAIL] Sent to {to_email} ({username}) — {len(issues)} issues")
                return True
            print(f"  [EMAIL] Failed for {to_email}: {resp.status}")
            return False
    except Exception as e:
        print(f"  [EMAIL] Error sending to {to_email}: {e}")
        return False


# ── Find fixed conviction issues with unthanked reporters ──────────
def find_fixed_unthanked_issues():
    """
    Fetch conviction-labeled issues closed as 'completed' (not 'not_planned')
    that have at least one unthanked feedback row.
    """
    # 1. Get all feedback rows that are processed but not yet thanked
    unthanked = sb_get(
        "feedback",
        "status=eq.processed&thanked_at=is.null&github_issue_number=not.is.null"
        "&select=id,player_name,github_issue_number"
    )
    if not unthanked:
        return [], []

    # 2. Get unique issue numbers
    issue_numbers = list(set(row["github_issue_number"] for row in unthanked))
    print(f"  Found {len(unthanked)} unthanked feedback rows across {len(issue_numbers)} issues")

    # 3. Fetch those issues from GitHub and filter
    valid_issues = {}
    for num in issue_numbers:
        issue = gh_get(f"/repos/{GITHUB_REPO}/issues/{num}")
        if issue.get("state") != "closed":
            continue
        if issue.get("state_reason") == "not_planned":
            continue
        valid_issues[num] = {"title": issue.get("title", f"Issue #{num}"), "number": num}

    print(f"  {len(valid_issues)} issues are closed as completed (fixed)")

    # 4. Filter feedback to only valid issues
    valid_feedback = [row for row in unthanked if row["github_issue_number"] in valid_issues]

    return valid_feedback, valid_issues


# ── Main ───────────────────────────────────────────────────────────
def run():
    print("=== Thank Reporters ===")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")
    if DRY_RUN:
        print("** DRY RUN — no emails will be sent, no rows updated **")

    if not CUSTOM_MESSAGE:
        print("ERROR: CUSTOM_MESSAGE is required.", file=sys.stderr)
        sys.exit(1)

    print(f"Message: {CUSTOM_MESSAGE}\n")

    # 1. Find unthanked feedback linked to fixed issues
    print("1. Finding unthanked feedback for fixed issues...")
    feedback_rows, valid_issues = find_fixed_unthanked_issues()

    if not feedback_rows:
        print("\n   No unthanked reporters found. Done.")
        return

    # 2. Group by reporter
    print("\n2. Grouping by reporter...")
    reporter_issues = defaultdict(set)  # player_name -> set of issue numbers
    reporter_feedback_ids = defaultdict(list)  # player_name -> [feedback ids]

    for row in feedback_rows:
        name = row.get("player_name")
        if not name or name == "anon":
            reporter_feedback_ids["__anon__"].append(row["id"])
            continue
        reporter_issues[name].add(row["github_issue_number"])
        reporter_feedback_ids[name].append(row["id"])

    print(f"   {len(reporter_issues)} named reporters, "
          f"{len(reporter_feedback_ids.get('__anon__', []))} anonymous entries")

    # 3. Resolve emails
    print("\n3. Resolving emails...")
    email_map = resolve_reporter_emails(list(reporter_issues.keys()))
    print(f"   Resolved {len(email_map)} emails out of {len(reporter_issues)} reporters")

    # 4. Preview / send
    print(f"\n4. {'Previewing' if DRY_RUN else 'Sending'} emails...")
    sent = 0
    skipped = 0
    all_thanked_ids = []

    for name, issue_nums in sorted(reporter_issues.items()):
        issues = [valid_issues[n] for n in sorted(issue_nums)]
        email = email_map.get(name)

        if DRY_RUN:
            status = f"-> {email}" if email else "(no email)"
            issue_titles = ", ".join(f"#{i['number']}" for i in issues)
            print(f"   {name} {status} — {len(issues)} issues: {issue_titles}")
            continue

        if not email:
            skipped += 1
            all_thanked_ids.extend(reporter_feedback_ids[name])
            continue

        if send_batched_email(email, name, issues, CUSTOM_MESSAGE):
            sent += 1
        else:
            skipped += 1
        all_thanked_ids.extend(reporter_feedback_ids[name])

    # Also collect anonymous feedback IDs
    all_thanked_ids.extend(reporter_feedback_ids.get("__anon__", []))

    # 5. Mark as thanked
    if not DRY_RUN and all_thanked_ids:
        print(f"\n5. Marking {len(all_thanked_ids)} feedback rows as thanked...")
        now = datetime.now(timezone.utc).isoformat()
        for fid in all_thanked_ids:
            sb_patch("feedback", {"thanked_at": now}, f"id=eq.{fid}")

    print(f"\n=== Done. Sent {sent} emails, skipped {skipped}. ===")


if __name__ == "__main__":
    run()
