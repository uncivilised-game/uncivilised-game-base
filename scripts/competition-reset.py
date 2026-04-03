#!/usr/bin/env python3
"""
Weekly Competition Reset — closes current competition, emails top 3 players,
and creates the next 7-day competition.

Runs on a weekly cron (Sunday midnight UTC) via GitHub Actions.

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
Optional: DRY_RUN=true, TEST_EMAIL=you@example.com
"""

import os
import sys
import json
import html
import hashlib
import hmac
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from urllib.parse import quote

# ── Config ──────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
RESEND_API_KEY = os.environ["RESEND_API_KEY"]
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"
TEST_EMAIL = os.environ.get("TEST_EMAIL", "")

FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"
REPLY_TO_EMAIL = "hello@uncivilized.fun"
BASE_URL = os.environ.get("BASE_URL", "https://uncivilized.fun")

MEDAL = {0: "\U0001f947", 1: "\U0001f948", 2: "\U0001f949"}


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


def sb_get(table, params=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}" if params else f"{SUPABASE_URL}/rest/v1/{table}"
    return _req("GET", url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })


def sb_post(table, data):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    return _req("POST", url, data=data, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    })


def sb_patch(table, data, params=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}" if params else f"{SUPABASE_URL}/rest/v1/{table}"
    return _req("PATCH", url, data=data, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    })


def make_unsubscribe_url(username):
    token = hmac.new(SUPABASE_KEY.encode(), username.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{BASE_URL}/api/unsubscribe?u={quote(username)}&t={token}"


# ── Email ───────────────────────────────────────────────────────────
def build_leaderboard_html(winners, comp_name):
    """Build an HTML leaderboard table for the email."""
    rows = ""
    for i, w in enumerate(winners):
        medal = MEDAL.get(i, "")
        rows += f"""
        <tr style="border-bottom:1px solid #2a2a3e">
          <td style="padding:12px 16px;color:#c9a84c;font-size:20px;text-align:center">{medal}</td>
          <td style="padding:12px 16px;color:#e0e0e0;font-weight:600">{html.escape(w['player_name'])}</td>
          <td style="padding:12px 16px;color:#c9a84c;text-align:right;font-weight:700">{w['score']}</td>
          <td style="padding:12px 16px;color:#8a8a9a;text-align:center">{w.get('victory_type', 'none')}</td>
          <td style="padding:12px 16px;color:#8a8a9a;text-align:center">{w.get('turns_played', 0)}</td>
        </tr>"""

    return f"""
    <div style="margin:20px 0;padding:20px;background:#12101a;border:1px solid #2a2a3e;border-radius:12px">
      <h2 style="color:#c9a84c;font-size:18px;margin:0 0 4px 0;text-align:center">\U0001f3c6 {html.escape(comp_name)}</h2>
      <p style="color:#8a8a9a;font-size:12px;margin:0 0 16px 0;text-align:center">Final Standings</p>
      <table style="width:100%;border-collapse:collapse">
        <tr style="border-bottom:2px solid #c9a84c">
          <th style="padding:8px 16px;color:#c9a84c;font-size:11px;text-align:center">RANK</th>
          <th style="padding:8px 16px;color:#c9a84c;font-size:11px;text-align:left">PLAYER</th>
          <th style="padding:8px 16px;color:#c9a84c;font-size:11px;text-align:right">SCORE</th>
          <th style="padding:8px 16px;color:#c9a84c;font-size:11px;text-align:center">VICTORY</th>
          <th style="padding:8px 16px;color:#c9a84c;font-size:11px;text-align:center">TURNS</th>
        </tr>
        {rows}
      </table>
    </div>"""


def build_email_html(username, winners, comp_name, rank):
    medal = MEDAL.get(rank, "")
    leaderboard_table = build_leaderboard_html(winners, comp_name)
    unsubscribe_url = html.escape(make_unsubscribe_url(username))
    safe_username = html.escape(username)

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Congratulations!</title></head>
<body style="margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:24px 16px">
  <div style="text-align:center;padding:24px 0">
    <h1 style="color:#c9a84c;font-size:28px;margin:0">{medal} Congratulations, {safe_username}!</h1>
    <p style="color:#b0b0c0;font-size:15px;margin:12px 0 0 0">
      You placed <strong style="color:#c9a84c">#{rank + 1}</strong> in this week's competition!
    </p>
  </div>

  {leaderboard_table}

  <div style="text-align:center;padding:20px 0">
    <p style="color:#b0b0c0;font-size:14px;margin:0 0 16px 0">
      Thanks for playing and submitting your bug reports. Your feedback makes the game better for everyone.
    </p>
    <a href="https://uncivilized.fun" style="display:inline-block;padding:12px 32px;background:#c9a84c;color:#0a0a14;text-decoration:none;font-weight:700;border-radius:8px;font-size:14px">Play Again</a>
  </div>

  <div style="text-align:center;padding:16px 0;border-top:1px solid #1a1a2e;margin-top:16px">
    <p style="color:#555;font-size:11px;margin:0">
      <a href="{unsubscribe_url}" style="color:#666;text-decoration:underline">Unsubscribe</a>
      &nbsp;\u00b7&nbsp;
      <a href="https://github.com/uncivilised-game/uncivilised-game-base" style="color:#666;text-decoration:underline">GitHub</a>
      &nbsp;\u00b7&nbsp;
      <a href="https://discord.gg/m8BzGbwmvM" style="color:#666;text-decoration:underline">Discord</a>
    </p>
  </div>
</div>
</body></html>"""


def send_email(to_email, username, winners, comp_name, rank):
    email_html = build_email_html(username, winners, comp_name, rank)
    text = (
        f"Congratulations {username}! You placed #{rank + 1} in {comp_name}.\n\n"
        f"Thanks for playing and submitting your bug reports.\n\n"
        f"Play again: https://uncivilized.fun\n"
        f"Unsubscribe: {make_unsubscribe_url(username)}\n"
    )

    subject = f"\U0001f3c6 You placed #{rank + 1} in this week's Uncivilized competition!"

    try:
        body = json.dumps({
            "from": FROM_EMAIL,
            "to": [to_email],
            "reply_to": REPLY_TO_EMAIL,
            "subject": subject,
            "html": email_html,
            "text": text,
            "headers": {
                "List-Unsubscribe": f"<{make_unsubscribe_url(username)}>, <mailto:{REPLY_TO_EMAIL}?subject=unsubscribe>",
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
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
                print(f"  [EMAIL] Sent to {to_email} ({username}) — rank #{rank + 1}")
                return True
            print(f"  [EMAIL] Failed for {to_email}: {resp.status}")
            return False
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        print(f"  [EMAIL] Error sending to {to_email}: {e} — {err_body}")
        return False


# ── Main ────────────────────────────────────────────────────────────
def main():
    now = datetime.now(timezone.utc)
    print(f"Competition reset at {now.isoformat()}")
    print(f"DRY_RUN={DRY_RUN}")

    # 1. Find the current active competition
    competitions = sb_get("competitions", "status=eq.active&order=starts_at.desc&limit=1")
    if not competitions:
        print("No active competition found. Creating first one.")
        comp_name = f"Week of {now.strftime('%b %d, %Y')}"
    else:
        current = competitions[0]
        comp_id = current["id"]
        comp_name = current.get("name", "Weekly Competition")
        print(f"Current competition: {comp_name} (ID: {comp_id})")

        # 2. Get top 3 players for this competition
        top3 = sb_get("leaderboard",
                       f"competition_id=eq.{comp_id}&order=score.desc&limit=3")
        if not top3:
            # Fallback: get top 3 from all entries during the competition period
            top3 = sb_get("leaderboard",
                          f"created_at=gte.{current['starts_at']}&order=score.desc&limit=3")

        if top3:
            print(f"Top 3 players:")
            for i, entry in enumerate(top3):
                print(f"  #{i+1}: {entry['player_name']} — {entry['score']} pts")
        else:
            print("No leaderboard entries for this competition.")

        # 3. Email top 3 players
        for i, entry in enumerate(top3):
            player_name = entry["player_name"]
            # Look up player email
            players = sb_get("players",
                             f"username=eq.{quote(player_name)}&select=email,email_verified,email_opt_out")
            if not players:
                print(f"  No player record for '{player_name}' — skipping email")
                continue
            player = players[0]
            email = player.get("email")
            if not email:
                print(f"  No email for '{player_name}' — skipping")
                continue
            if player.get("email_opt_out"):
                print(f"  '{player_name}' opted out of emails — skipping")
                continue

            if TEST_EMAIL:
                email = TEST_EMAIL

            if DRY_RUN:
                print(f"  [DRY RUN] Would email {email} ({player_name}) — rank #{i+1}")
            else:
                send_email(email, player_name, top3, comp_name, i)

        # 4. Close the current competition
        if not DRY_RUN:
            sb_patch("competitions", {"status": "closed"}, f"id=eq.{comp_id}")
            print(f"Closed competition: {comp_name}")
        else:
            print(f"[DRY RUN] Would close competition: {comp_name}")

    # 5. Create next 7-day competition
    next_start = now
    next_end = now + timedelta(days=7)
    next_name = f"Week of {next_start.strftime('%b %d, %Y')}"

    if DRY_RUN:
        print(f"[DRY RUN] Would create competition: {next_name}")
        print(f"  starts_at: {next_start.isoformat()}")
        print(f"  ends_at:   {next_end.isoformat()}")
    else:
        result = sb_post("competitions", {
            "name": next_name,
            "status": "active",
            "starts_at": next_start.isoformat(),
            "ends_at": next_end.isoformat(),
        })
        print(f"Created competition: {next_name}")
        if isinstance(result, list) and result:
            print(f"  ID: {result[0].get('id', 'unknown')}")

    print("Done.")


if __name__ == "__main__":
    main()
