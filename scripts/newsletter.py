#!/usr/bin/env python3
"""
Newsletter — sends update emails to all players with verified emails.

If a player reported bugs that have since been fixed, the email includes a
thank-you section listing those issues (with green ticks). Otherwise they
just get the newsletter content.

Manual trigger only (workflow_dispatch).

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, GITHUB_TOKEN, CUSTOM_MESSAGE
Optional: EMAIL_SUBJECT, DRY_RUN=true, TEST_EMAIL=you@example.com
"""

import os
import sys
import json
import re
import time
import html
import hashlib
import hmac
import urllib.request
import urllib.error
from datetime import datetime, timezone
from urllib.parse import quote
from collections import defaultdict

# ── Config ──────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
RESEND_API_KEY = os.environ["RESEND_API_KEY"]
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GITHUB_REPO = os.environ.get("GITHUB_REPO", "uncivilised-game/uncivilised-game-base")
CUSTOM_MESSAGE = os.environ.get("CUSTOM_MESSAGE", "")
EMAIL_SUBJECT = os.environ.get("EMAIL_SUBJECT", "News from Uncivilized")
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"
TEST_EMAIL = os.environ.get("TEST_EMAIL", "")
TEMPLATE = os.environ.get("TEMPLATE", "newsletter")  # "newsletter" or "launch"

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"
REPLY_TO_EMAIL = "hello@uncivilized.fun"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_URL = os.environ.get("BASE_URL", "https://uncivilized.fun")


def make_unsubscribe_url(username):
    """Generate a signed unsubscribe URL for a player."""
    token = hmac.new(SUPABASE_KEY.encode(), username.encode(), hashlib.sha256).hexdigest()[:16]
    return f"{BASE_URL}/api/unsubscribe?u={quote(username)}&t={token}"


def load_template():
    """Load the HTML email template."""
    filename = "newsletter-launch.html" if TEMPLATE == "launch" else "newsletter.html"
    path = os.path.join(SCRIPT_DIR, filename)
    with open(path, "r") as f:
        return f.read()


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


# ── Fetch all mailable players ────────────────────────────────────
def fetch_mailable_players():
    """Fetch all players with verified emails who haven't opted out."""
    rows = sb_get(
        "players",
        "email_verified=eq.true&email=not.is.null&email_opt_out=not.eq.true"
        "&status=eq.active&select=username,email"
    )
    return {row["username"]: row["email"] for row in rows if row.get("username") and row.get("email")}


# ── Find fixed issues with unthanked reporters ────────────────────
def find_unthanked_feedback():
    """
    Returns:
        reporter_issues: {username: [{"title": ..., "number": ...}, ...]}
        reporter_feedback_ids: {username: [feedback_id, ...]}
        anon_feedback_ids: [feedback_id, ...]
    """
    unthanked = sb_get(
        "feedback",
        "status=eq.processed&thanked_at=is.null&github_issue_number=not.is.null"
        "&select=id,player_name,github_issue_number"
    )
    if not unthanked:
        return {}, {}, []

    # Group by issue number first
    issue_numbers = list(set(row["github_issue_number"] for row in unthanked))
    print(f"  Found {len(unthanked)} unthanked feedback rows across {len(issue_numbers)} issues")

    # Validate issues on GitHub — only closed + actually fixed
    valid_issues = {}
    for num in issue_numbers:
        issue = gh_get(f"/repos/{GITHUB_REPO}/issues/{num}")
        if issue.get("state") != "closed":
            continue
        if issue.get("state_reason") == "not_planned":
            continue
        valid_issues[num] = {"title": issue.get("title", f"Issue #{num}"), "number": num}

    print(f"  {len(valid_issues)} issues are closed as completed (fixed)")

    # Group valid feedback by reporter
    reporter_issues = defaultdict(set)
    reporter_feedback_ids = defaultdict(list)
    anon_feedback_ids = []

    for row in unthanked:
        num = row["github_issue_number"]
        if num not in valid_issues:
            continue
        name = row.get("player_name")
        if not name or name == "anon":
            anon_feedback_ids.append(row["id"])
            continue
        reporter_issues[name].add(num)
        reporter_feedback_ids[name].append(row["id"])

    # Convert sets to sorted issue lists
    resolved = {}
    for name, nums in reporter_issues.items():
        resolved[name] = [valid_issues[n] for n in sorted(nums)]

    return resolved, dict(reporter_feedback_ids), anon_feedback_ids


# ── Email building ─────────────────────────────────────────────────
def build_thank_section_html(issues):
    """Build the conditional thank-you HTML block for reporters."""
    items = ""
    for issue in issues:
        title = html.escape(issue["title"])
        items += (
            f'<tr><td style="color:#b8b0a0;font-size:14px;line-height:22px;padding:4px 0">'
            f'&#x2705; {title}</td></tr>\n'
        )
    return (
        '<tr><td style="color:#e8e0d0;font-size:15px;line-height:25px;padding:0 0 8px;font-weight:600">'
        'Issues you reported that we fixed:</td></tr>\n'
        '<tr><td><table width="100%" cellpadding="0" cellspacing="0" style="padding:0 0 20px 8px">\n'
        f'{items}'
        '</table></td></tr>\n'
        '<tr><td style="color:#b8b0a0;font-size:15px;line-height:25px;padding:0 0 24px">'
        'Thank you for helping make the game better for everyone.</td></tr>'
    )


def build_thank_section_text(issues):
    """Build plain text thank-you block for reporters."""
    lines = "Issues you reported that we fixed:\n"
    lines += "\n".join(f"  [done] {issue['title']}" for issue in issues)
    lines += "\n\nThanks for helping make the game better!\n"
    return lines


def send_email(to_email, username, custom_message, subject, issues=None):
    """Send a newsletter email. If issues is provided, include the thank-you section."""
    safe_username = html.escape(username)
    unsubscribe_url = make_unsubscribe_url(username)

    email_html = load_template()
    email_html = email_html.replace("{{unsubscribe_url}}", html.escape(unsubscribe_url))
    email_html = email_html.replace("{{username_raw}}", safe_username)
    email_html = email_html.replace("{{username}}", safe_username)

    if TEMPLATE == "launch":
        # Launch template has baked-in content, no dynamic sections
        pass
    else:
        safe_message = html.escape(custom_message).replace("\n", "<br>")
        thank_html = build_thank_section_html(issues) if issues else ""
        greeting = f"Your reports made a difference, {safe_username}." if issues else f"Hey {safe_username},"
        email_html = email_html.replace("{{greeting}}", greeting)
        email_html = email_html.replace("{{custom_message}}", safe_message)
        email_html = email_html.replace("{{thank_section}}", thank_html)

    thank_text = build_thank_section_text(issues) if issues else ""
    text = (
        f"Hey {username},\n\n"
        f"{custom_message}\n\n"
        f"{thank_text}"
        f"Play now: https://uncivilized.fun\n"
        f"Discord: https://discord.gg/m8BzGbwmvM\n"
        f"GitHub: https://github.com/uncivilised-game/uncivilised-game-base\n\n"
        f"Unsubscribe: {unsubscribe_url}\n"
        f"Data requests: hello@uncivilized.fun"
    )

    try:
        body = json.dumps({
            "from": FROM_EMAIL,
            "to": [to_email],
            "reply_to": REPLY_TO_EMAIL,
            "subject": subject,
            "html": email_html,
            "text": text,
            "headers": {
                "List-Unsubscribe": f"<{unsubscribe_url}>, <mailto:{REPLY_TO_EMAIL}?subject=unsubscribe>",
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
        }).encode()
        req = urllib.request.Request(
            "https://api.resend.com/emails",
            data=body,
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
                "User-Agent": "uncivilized-newsletter/1.0",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status < 300:
                tag = f" + {len(issues)} fixed issues" if issues else ""
                print(f"  [EMAIL] Sent to {to_email} ({username}){tag}")
                return True
            print(f"  [EMAIL] Failed for {to_email}: {resp.status}")
            return False
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        print(f"  [EMAIL] Error sending to {to_email}: {e} — {err_body}")
        return False
    except Exception as e:
        print(f"  [EMAIL] Error sending to {to_email}: {e}")
        return False


# ── Main ───────────────────────────────────────────────────────────
def run():
    print("=== Newsletter ===")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")
    if DRY_RUN:
        print("** DRY RUN — no emails will be sent, no rows updated **")

    is_launch = TEMPLATE == "launch"

    if not is_launch and not CUSTOM_MESSAGE:
        print("ERROR: CUSTOM_MESSAGE is required (unless TEMPLATE=launch).", file=sys.stderr)
        sys.exit(1)

    print(f"Template: {TEMPLATE}")
    print(f"Subject: {EMAIL_SUBJECT}")
    if not is_launch:
        print(f"Message: {CUSTOM_MESSAGE}")
    print()

    # Test mode — send preview to a single address and exit
    if TEST_EMAIL:
        print(f"** TEST MODE — sending preview to {TEST_EMAIL} **\n")
        if is_launch:
            ok = send_email(TEST_EMAIL, "TestPlayer", "", f"[TEST] {EMAIL_SUBJECT}")
            status = "OK" if ok else "FAILED"
            print(f"\n=== Test done ({status}). Check {TEST_EMAIL}. ===")
        else:
            fake_issues = [
                {"title": "Units disappear after loading a save", "number": 42},
                {"title": "Research panel shows wrong cost", "number": 57},
            ]
            ok1 = send_email(TEST_EMAIL, "TestPlayer", CUSTOM_MESSAGE, f"[TEST] {EMAIL_SUBJECT}")
            ok2 = send_email(TEST_EMAIL, "TestReporter", CUSTOM_MESSAGE, f"[TEST+thanks] {EMAIL_SUBJECT}", issues=fake_issues)
            status = "OK" if (ok1 and ok2) else "SOME FAILED"
            print(f"\n=== Test done ({status}). Check {TEST_EMAIL} for two emails. ===")
        return

    # 1. Fetch all mailable players
    print("1. Fetching mailable players (active only, not waitlisted)...")
    players = fetch_mailable_players()
    print(f"   {len(players)} players with verified emails")

    if not players:
        print("\n   No mailable players found. Done.")
        return

    # 2. Find unthanked feedback (skip for launch template)
    reporter_issues = {}
    reporter_feedback_ids = {}
    anon_feedback_ids = []
    if not is_launch:
        print("\n2. Checking for unthanked bug reports...")
        reporter_issues, reporter_feedback_ids, anon_feedback_ids = find_unthanked_feedback()
        reporters_count = sum(1 for name in reporter_issues if name in players)
        print(f"   {reporters_count} mailable reporters with fixed issues")

    # 3. Send emails
    step = "2" if is_launch else "3"
    print(f"\n{step}. {'Previewing' if DRY_RUN else 'Sending'} emails...")
    sent = 0
    failed = 0
    thanked_ids = []

    for username, email in sorted(players.items()):
        issues = reporter_issues.get(username)

        if DRY_RUN:
            tag = f" + {len(issues)} fixed issues" if issues else ""
            print(f"   {username} -> {email}{tag}")
            continue

        if send_email(email, username, CUSTOM_MESSAGE, EMAIL_SUBJECT, issues):
            sent += 1
            if issues and username in reporter_feedback_ids:
                thanked_ids.extend(reporter_feedback_ids[username])
        else:
            failed += 1

    # Also mark anonymous feedback as thanked (no email possible)
    thanked_ids.extend(anon_feedback_ids)

    # 4. Mark thanked feedback
    if not DRY_RUN and thanked_ids:
        print(f"\nMarking {len(thanked_ids)} feedback rows as thanked...")
        now = datetime.now(timezone.utc).isoformat()
        for fid in thanked_ids:
            sb_patch("feedback", {"thanked_at": now}, f"id=eq.{fid}")

    print(f"\n=== Done. Sent {sent}, failed {failed}, total players {len(players)}. ===")


if __name__ == "__main__":
    run()
