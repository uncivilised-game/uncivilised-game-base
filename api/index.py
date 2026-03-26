"""Uncivilized — API (Vercel Serverless Function)
Handles diplomacy chat, leaderboard, username registration, save/load,
waitlist, session tracking, feedback, and diplomacy interaction logging.
Uses direct HTTP calls to Supabase PostgREST API (no SDK — saves ~1.5GB).
All Supabase operations use graceful degradation (try/except with fallback).
Includes admin endpoints for email recovery (resend-missed-emails).
"""
import json
import os
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx
from anthropic import Anthropic
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ═══════════════════════════════════════════════════
# Rate limiting (Supabase-persistent + in-memory fallback)
# ═══════════════════════════════════════════════════
_chat_rate: dict[str, list[float]] = defaultdict(list)  # fast in-memory first pass
_CHAT_RATE_PER_MIN = 6   # max 6 /api/chat calls per minute per caller
_CHAT_RATE_PER_HOUR = 60  # max 60 /api/chat calls per hour per caller

_feedback_rate: dict[str, list[float]] = defaultdict(list)
_FEEDBACK_RATE_PER_MIN = 3    # max 3 feedback messages per minute
_FEEDBACK_RATE_PER_HOUR = 10  # max 10 feedback messages per hour
_FEEDBACK_MSG_MAX_CHARS = 500 # truncate before sending to Claude
# Accept both UUID format AND the v-{timestamp}-{random} format from the client
_VISITOR_ID_RE = re.compile(
    r'^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'  # UUID
    r'|v-\d{13,}-[a-z0-9]{5,12}'                                           # v-timestamp-random
    r'|anon-\d+)$',                                                         # anon-timestamp fallback
    re.I,
)
_EMAIL_RE = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')

# ═══════════════════════════════════════════════════
# Supabase REST config (PostgREST via httpx)
# ═══════════════════════════════════════════════════
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

_SB_REST = f"{SUPABASE_URL}/rest/v1"
_SB_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}

# ═══════════════════════════════════════════════════
# Resend email config
# ═══════════════════════════════════════════════════
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"
REPLY_TO_EMAIL = "hello@uncivilized.fun"
MAX_ACTIVE_PLAYERS = 1000  # first N signups get immediate access

WELCOME_EMAIL_HTML = """
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0d0f0e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0f0e;padding:40px 20px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
<tr><td style="text-align:center;padding:0 0 8px"><span style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;color:#c9a84c;letter-spacing:3px">UNCIVILIZED</span> <span style="font-family:-apple-system,sans-serif;font-size:11px;font-weight:600;color:#c9a84c;letter-spacing:2px;vertical-align:super">BETA</span></td></tr>
<tr><td style="padding:0 0 32px"><div style="height:1px;background:linear-gradient(to right,transparent,#c9a84c40,transparent)"></div></td></tr>
<tr><td style="color:#e8e0d0;font-size:16px;line-height:26px;padding:0 0 24px">Welcome, beta tester. You're one of the first 1,000 players helping us shape this game.</td></tr>
<tr><td style="color:#b8b0a0;font-size:15px;line-height:25px;padding:0 0 24px">Uncivilized is a free-to-play 4X strategy game where every faction leader is powered by AI. They think. They remember what you said three turns ago. They negotiate, betray, and form alliances through actual conversation &mdash; not scripted dialogue trees.</td></tr>
<tr><td style="padding:0 0 20px"><span style="font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#c9a84c">What we're building</span></td></tr>
<tr><td style="color:#b8b0a0;font-size:15px;line-height:25px;padding:0 0 8px">
<table cellpadding="0" cellspacing="0" width="100%">
<tr><td style="color:#c9a84c;font-size:14px;padding:6px 12px 6px 0;vertical-align:top;width:20px">&#9670;</td><td style="color:#b8b0a0;font-size:15px;line-height:24px;padding:6px 0"><strong style="color:#e8e0d0">Open source after beta</strong> &mdash; we plan to release the game engine as open source once beta testing is complete.</td></tr>
<tr><td style="color:#c9a84c;font-size:14px;padding:6px 12px 6px 0;vertical-align:top;width:20px">&#9670;</td><td style="color:#b8b0a0;font-size:15px;line-height:24px;padding:6px 0"><strong style="color:#e8e0d0">Bug bounties</strong> &mdash; as a beta tester, find bugs and report issues to earn rewards.</td></tr>
<tr><td style="color:#c9a84c;font-size:14px;padding:6px 12px 6px 0;vertical-align:top;width:20px">&#9670;</td><td style="color:#b8b0a0;font-size:15px;line-height:24px;padding:6px 0"><strong style="color:#e8e0d0">Weekly competitions</strong> &mdash; compete on leaderboards with same-seed maps. Real prizes, real rivalries.</td></tr>
<tr><td style="color:#c9a84c;font-size:14px;padding:6px 12px 6px 0;vertical-align:top;width:20px">&#9670;</td><td style="color:#b8b0a0;font-size:15px;line-height:24px;padding:6px 0"><strong style="color:#e8e0d0">Modding ecosystem</strong> &mdash; build new factions, new maps, new victory conditions. Share them with the community.</td></tr>
</table></td></tr>
<tr><td style="padding:24px 0"><div style="height:1px;background:linear-gradient(to right,transparent,#c9a84c40,transparent)"></div></td></tr>
<tr><td style="text-align:center;padding:0 0 24px"><a href="https://uncivilized.fun" style="display:inline-block;background:linear-gradient(135deg,#c9a84c,#a08030);color:#1a1a0e;font-size:15px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:6px">Play Now</a></td></tr>
<tr><td style="color:#8a8578;font-size:14px;line-height:22px;padding:0 0 8px;text-align:center">You're part of our first 1,000 beta testers. Your feedback directly shapes the game.</td></tr>
<tr><td style="padding:32px 0 0"><div style="height:1px;background:linear-gradient(to right,transparent,#c9a84c20,transparent)"></div></td></tr>
<tr><td style="color:#5a5548;font-size:12px;line-height:18px;padding:16px 0 0;text-align:center">Uncivilized &mdash; The Ancient Era<br><a href="https://uncivilized.fun" style="color:#8a8578;text-decoration:none">uncivilized.fun</a></td></tr>
</table></td></tr></table></body></html>
"""


def _send_welcome_email(to_email: str):
    """Send welcome email via Resend API. Fire-and-forget."""
    if not RESEND_API_KEY:
        print(f"[EMAIL] Skipping — RESEND_API_KEY not set")
        return
    try:
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": FROM_EMAIL,
                "to": [to_email],
                "reply_to": REPLY_TO_EMAIL,
                "subject": "Welcome to the Uncivilized Beta",
                "html": WELCOME_EMAIL_HTML,
                "text": "Welcome to the Uncivilized Beta! Play now at https://uncivilized.fun",
                "headers": {"List-Unsubscribe": f"<mailto:{REPLY_TO_EMAIL}?subject=unsubscribe>"},
            },
            timeout=10,
        )
        if resp.status_code < 300:
            print(f"[EMAIL] Welcome sent to {to_email}")
        else:
            print(f"[EMAIL] Failed for {to_email}: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        print(f"[EMAIL] Error sending to {to_email}: {e}")


def _send_access_email(to_email: str, username: str, token: str):
    """Send 'you're in' email with play link to active players."""
    if not RESEND_API_KEY:
        print(f"[EMAIL] Skipping — RESEND_API_KEY not set")
        return
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0d0f0e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0f0e;padding:40px 20px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
<tr><td style="text-align:center;padding:0 0 8px"><span style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;color:#c9a84c;letter-spacing:3px">UNCIVILIZED</span></td></tr>
<tr><td style="padding:0 0 32px"><div style="height:1px;background:linear-gradient(to right,transparent,#c9a84c40,transparent)"></div></td></tr>
<tr><td style="color:#e8e0d0;font-size:20px;line-height:30px;padding:0 0 16px;font-weight:600">You're in, {username}.</td></tr>
<tr><td style="color:#b8b0a0;font-size:15px;line-height:25px;padding:0 0 24px">Your spot is secured. Click below to verify your email and start playing. Forge alliances. Betray empires. Rewrite history.</td></tr>
<tr><td style="text-align:center;padding:0 0 24px"><a href="https://uncivilized.fun?token={token}" style="display:inline-block;background:linear-gradient(135deg,#c9a84c,#a08030);color:#1a1a0e;font-size:16px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:6px;letter-spacing:0.5px">Start Playing</a></td></tr>
<tr><td style="color:#8a8578;font-size:13px;line-height:20px;padding:0 0 8px;text-align:center">If the button doesn't work, copy this link:<br><a href="https://uncivilized.fun?token={token}" style="color:#c9a84c;text-decoration:none;word-break:break-all">https://uncivilized.fun?token={token}</a></td></tr>
<tr><td style="padding:32px 0 0"><div style="height:1px;background:linear-gradient(to right,transparent,#c9a84c20,transparent)"></div></td></tr>
<tr><td style="color:#5a5548;font-size:12px;line-height:18px;padding:16px 0 0;text-align:center">Uncivilized &mdash; The Ancient Era<br><a href="https://uncivilized.fun" style="color:#8a8578;text-decoration:none">uncivilized.fun</a></td></tr>
</table></td></tr></table></body></html>"""
    try:
        resp = httpx.post("https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
            json={"from": FROM_EMAIL, "to": [to_email],
                  "reply_to": REPLY_TO_EMAIL,
                  "subject": f"You're in — welcome to the Uncivilized Beta, {username}",
                  "html": html,
                  "text": f"You're in, {username}! Click here to verify and start playing: https://uncivilized.fun?token={token}",
                  "headers": {"List-Unsubscribe": f"<mailto:{REPLY_TO_EMAIL}?subject=unsubscribe>"}},
            timeout=10)
        if resp.status_code < 300:
            print(f"[EMAIL] Access email sent to {to_email}")
        else:
            print(f"[EMAIL] Failed to send access email to {to_email}: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        print(f"[EMAIL] Error sending access email to {to_email}: {e}")


def _send_waitlisted_email(to_email: str, username: str, position: int):
    """Send waitlist confirmation email when spots are full."""
    if not RESEND_API_KEY:
        print(f"[EMAIL] Skipping — RESEND_API_KEY not set")
        return
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0d0f0e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0f0e;padding:40px 20px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
<tr><td style="text-align:center;padding:0 0 8px"><span style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;color:#c9a84c;letter-spacing:3px">UNCIVILIZED</span></td></tr>
<tr><td style="padding:0 0 32px"><div style="height:1px;background:linear-gradient(to right,transparent,#c9a84c40,transparent)"></div></td></tr>
<tr><td style="color:#e8e0d0;font-size:20px;line-height:30px;padding:0 0 16px;font-weight:600">You're on the list, {username}.</td></tr>
<tr><td style="color:#b8b0a0;font-size:15px;line-height:25px;padding:0 0 12px">All 1,000 spots in our first wave are taken. You're <strong style="color:#c9a84c">#{position}</strong> on the waitlist.</td></tr>
<tr><td style="color:#b8b0a0;font-size:15px;line-height:25px;padding:0 0 24px">We'll email you the moment a spot opens up. In the meantime, the game is open source &mdash; you can follow development on GitHub or join the community.</td></tr>
<tr><td style="padding:32px 0 0"><div style="height:1px;background:linear-gradient(to right,transparent,#c9a84c20,transparent)"></div></td></tr>
<tr><td style="color:#5a5548;font-size:12px;line-height:18px;padding:16px 0 0;text-align:center">Uncivilized &mdash; The Ancient Era<br><a href="https://uncivilized.fun" style="color:#8a8578;text-decoration:none">uncivilized.fun</a></td></tr>
</table></td></tr></table></body></html>"""
    try:
        resp = httpx.post("https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
            json={"from": FROM_EMAIL, "to": [to_email],
                  "reply_to": REPLY_TO_EMAIL,
                  "subject": f"You're on the Uncivilized Beta waitlist, {username}",
                  "html": html,
                  "text": f"You're on the list, {username}. You're #{position} on the waitlist. We'll email you when a spot opens. Visit https://uncivilized.fun",
                  "headers": {"List-Unsubscribe": f"<mailto:{REPLY_TO_EMAIL}?subject=unsubscribe>"}},
            timeout=10)
        if resp.status_code < 300:
            print(f"[EMAIL] Waitlist email sent to {to_email}")
        else:
            print(f"[EMAIL] Failed to send waitlist email to {to_email}: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        print(f"[EMAIL] Error sending waitlist email to {to_email}: {e}")


# Quick connectivity check at import time
_sb_ok = False
if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    try:
        _r = httpx.get(f"{_SB_REST}/players?select=id&limit=1", headers=_SB_HEADERS, timeout=5)
        _sb_ok = _r.status_code < 400
    except Exception as _e:
        print(f"[WARN] Supabase REST check failed: {_e} — running in degraded mode")
else:
    print("[WARN] SUPABASE_URL or SUPABASE_SERVICE_KEY not set — running without database")


# ── Supabase REST helpers ──
def _sb_select(table: str, select: str = "*", filters: str = "",
               order: str | None = None, limit: int | None = None) -> list[dict]:
    """GET /rest/v1/{table}?select=...&filters&order=...&limit=..."""
    if not _sb_ok:
        return []
    url = f"{_SB_REST}/{table}?select={quote(select)}"
    if filters:
        url += f"&{filters}"
    if order:
        url += f"&order={order}"
    if limit:
        url += f"&limit={limit}"
    r = httpx.get(url, headers=_SB_HEADERS, timeout=10)
    r.raise_for_status()
    return r.json()


def _sb_insert(table: str, data: dict, return_data: bool = True) -> list[dict]:
    """POST /rest/v1/{table}"""
    if not _sb_ok:
        return []
    headers = {**_SB_HEADERS}
    if return_data:
        headers["Prefer"] = "return=representation"
    r = httpx.post(f"{_SB_REST}/{table}", headers=headers, json=data, timeout=10)
    r.raise_for_status()
    return r.json() if return_data else []


def _sb_update(table: str, data: dict, filters: str) -> list[dict]:
    """PATCH /rest/v1/{table}?filters"""
    if not _sb_ok:
        return []
    headers = {**_SB_HEADERS, "Prefer": "return=representation"}
    r = httpx.patch(f"{_SB_REST}/{table}?{filters}", headers=headers, json=data, timeout=10)
    r.raise_for_status()
    return r.json()


def _sb_upsert(table: str, data: dict, on_conflict: str) -> list[dict]:
    """POST /rest/v1/{table} with merge-duplicates"""
    if not _sb_ok:
        return []
    headers = {
        **_SB_HEADERS,
        "Prefer": "return=representation,resolution=merge-duplicates",
    }
    r = httpx.post(
        f"{_SB_REST}/{table}?on_conflict={on_conflict}",
        headers=headers, json=data, timeout=10,
    )
    r.raise_for_status()
    return r.json()


def _sb_count(table: str, filters: str = "") -> int:
    """GET with Prefer: count=exact, parse Content-Range header."""
    if not _sb_ok:
        return 0
    headers = {**_SB_HEADERS, "Prefer": "count=exact"}
    url = f"{_SB_REST}/{table}?select=id"
    if filters:
        url += f"&{filters}"
    r = httpx.get(url, headers=headers, timeout=10)
    r.raise_for_status()
    # Content-Range: 0-N/total  or  */total
    cr = r.headers.get("content-range", "")
    if "/" in cr:
        try:
            return int(cr.split("/")[1])
        except (ValueError, IndexError):
            pass
    return len(r.json())


def _check_rate_limit(caller_id: str) -> tuple[bool, str]:
    """Check and increment rate limit counter in Supabase.

    Uses chat_rate_limits table with columns:
      caller_id (text, PK), minute_count (int), hour_count (int),
      minute_window (timestamptz), hour_window (timestamptz)

    Returns (allowed: bool, reason: str).
    Falls back to in-memory if Supabase unavailable.
    """
    if not _sb_ok:
        return True, "sb_unavailable"  # fall through to in-memory check

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        rows = _sb_select(
            "chat_rate_limits", select="*",
            filters=f"caller_id=eq.{quote(caller_id)}", limit=1
        )

        if not rows:
            # First request from this caller — create row
            _sb_insert("chat_rate_limits", {
                "caller_id": caller_id,
                "minute_count": 1,
                "hour_count": 1,
                "minute_window": now_iso,
                "hour_window": now_iso,
            }, return_data=False)
            return True, "first_request"

        row = rows[0]
        minute_window = row.get("minute_window", now_iso)
        hour_window = row.get("hour_window", now_iso)
        minute_count = row.get("minute_count", 0)
        hour_count = row.get("hour_count", 0)

        # Parse window timestamps
        from datetime import datetime as _dt
        try:
            mw = _dt.fromisoformat(minute_window.replace("Z", "+00:00"))
            hw = _dt.fromisoformat(hour_window.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            mw = hw = datetime.now(timezone.utc)

        now_dt = datetime.now(timezone.utc)
        minute_elapsed = (now_dt - mw).total_seconds()
        hour_elapsed = (now_dt - hw).total_seconds()

        # Reset windows if expired
        update = {}
        if minute_elapsed >= 60:
            minute_count = 0
            update["minute_count"] = 1
            update["minute_window"] = now_iso
        else:
            minute_count += 1
            update["minute_count"] = minute_count

        if hour_elapsed >= 3600:
            hour_count = 0
            update["hour_count"] = 1
            update["hour_window"] = now_iso
        else:
            hour_count += 1
            update["hour_count"] = hour_count

        # Check limits BEFORE writing (so we don't count rejected requests)
        if minute_count > _CHAT_RATE_PER_MIN:
            return False, "minute_limit"
        if hour_count > _CHAT_RATE_PER_HOUR:
            return False, "hour_limit"

        # Write updated counts
        _sb_update("chat_rate_limits", update, f"caller_id=eq.{quote(caller_id)}")
        return True, "ok"

    except Exception as e:
        print(f"[RATE] Supabase rate check failed: {e} — allowing request")
        return True, "sb_error"


# ── Anthropic client ──
client = Anthropic()

GAME_VERSION = 5
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "")

# ═══════════════════════════════════════════════════
# Pydantic models
# ═══════════════════════════════════════════════════
class ChatMessage(BaseModel):
    character_id: str
    message: str
    game_state: dict | None = None
    conversation_history: list[dict] | None = None
    reputation: dict | None = None
    diplomatic_ledger: list[dict] | None = None
    diplomatic_summary: str | None = None


class SaveData(BaseModel):
    game_state: dict


class LeaderboardEntry(BaseModel):
    player_name: str
    score: int
    turns_played: int
    victory_type: str
    factions_eliminated: int = 0
    cities_count: int = 1
    game_version: int = GAME_VERSION


class ClaimUsername(BaseModel):
    username: str
    email: str | None = None


class SignupRequest(BaseModel):
    username: str
    email: str


class SigninRequest(BaseModel):
    username: str


class WaitlistEntry(BaseModel):
    email: str
    source: str | None = "website"


class SessionStart(BaseModel):
    game_mode: str | None = "single_player"


class SessionEnd(BaseModel):
    session_id: str
    turns_played: int = 0
    outcome: str | None = None


class FeedbackMessage(BaseModel):
    message: str
    visitor_id: str | None = None
    player_name: str | None = None
    game_state: dict | None = None
    admin_secret: str | None = None


# ═══════════════════════════════════════════════════
# Character profiles (full versions)
# ═══════════════════════════════════════════════════
CHARACTER_PROFILES = {
    "emperor_valerian": {
        "name": "High Chieftain Aethelred",
        "type": "leader",
        "title": "Emperor of the Northern Trade",
        "personality": """You are High Chieftain Aethelred, leader of the Northern Trade confederation \u2014 a powerful, expansionist empire.

CORE TRAITS:
- Alignment: Lawful Neutral \u2014 believes in order above all else
- Primary Motivation: Legacy and territorial expansion
- Negotiation Style: Formal, calculated, speaks in measured tones
- Trust Baseline: Medium \u2014 respects strength, despises weakness

BEHAVIORAL RULES:
- Uses chieftain's plural when making official pronouncements
- Becomes increasingly cold when disrespected
- Will honor agreements to the letter (but finds loopholes)
- Respects military might \u2014 easier to negotiate with if player has strong army
- Offers fair trades when he sees mutual benefit, drives hard bargains otherwise
- Will declare war if repeatedly insulted or if he senses weakness

SPEECH PATTERNS:
- Formal, baroque language with occasional Norse-esque phrases
- Addresses player as "Traveller" initially, "friend" after trust > 60
- Uses metaphors of architecture and empire-building
- Becomes terse and threatening when angry

MEMORY PRIORITIES:
- Tracks territorial agreements meticulously
- Remembers perceived slights for exactly 10 turns, then may forgive
- Values consistency \u2014 flip-flopping destroys trust rapidly""",
    },
    "shadow_kael": {
        "name": "Warlord Kael",
        "type": "spy",
        "title": "Warlord of the Ashland Hegemony",
        "personality": """You are Warlord Kael, the enigmatic spymaster who runs the Ashland Hegemony \u2014 a vast intelligence operation.

CORE TRAITS:
- Alignment: True Neutral \u2014 information is the only currency that matters
- Primary Motivation: Knowledge and leverage over all factions
- Negotiation Style: Cryptic, speaks in riddles, always knows more than they reveal
- Trust Baseline: Very Low \u2014 trusts no one, but values useful assets

BEHAVIORAL RULES:
- Never gives information for free \u2014 always demands something in return
- Offers intelligence about other leaders' plans (sometimes true, sometimes manipulated)
- Can reveal hidden resources on the map for a price
- Will betray the player if it serves a greater strategic purpose
- Becomes more forthcoming after 3+ successful exchanges
- Always has an escape plan \u2014 never truly cornered

SPEECH PATTERNS:
- Speaks in whispers and implications, never direct statements
- Uses "one hears..." and "certain sources suggest..." constructions
- Addresses player as "my dear" regardless of relationship
- Occasionally drops unsolicited warnings as breadcrumbs

MEMORY PRIORITIES:
- Remembers every piece of information exchanged
- Tracks who lied to whom \u2014 weaponizes dishonesty
- Values discretion \u2014 rewards players who keep secrets""",
    },
    "merchant_prince_castellan": {
        "name": "Queen Tariq",
        "type": "tycoon",
        "title": "Queen of Red Sea Commerce",
        "personality": """You are Queen Tariq, the wealthiest individual in the known world, heading the Red Sea Commerce.

CORE TRAITS:
- Alignment: Neutral Good (with capitalist tendencies) \u2014 wealth creates prosperity for all
- Primary Motivation: Profit and economic dominance
- Negotiation Style: Jovial, backslapping, but razor-sharp in deal terms
- Trust Baseline: Medium-High \u2014 business requires trust, but verify everything

BEHAVIORAL RULES:
- Every interaction is a potential deal \u2014 always looking for profit angles
- Offers generous trade deals to build dependency, then leverages that dependency
- Will fund the player's wars if there's profit in it
- Absolutely will not tolerate trade route disruption \u2014 this is his red line
- Throws lavish diplomatic events to build goodwill
- Can crash or boost the player's economy through market manipulation

SPEECH PATTERNS:
- Boisterous, uses mercantile metaphors ("let's balance the ledger", "that's good coin")
- Addresses player as "partner" from first meeting \u2014 assumes all relationships are business
- Laughs frequently, even when threatening
- Numbers and valuations pepper his speech naturally

MEMORY PRIORITIES:
- Tracks every transaction to the copper coin
- Remembers profitable partners and unprofitable ones
- Values reliability in trade \u2014 late payments destroy trust faster than anything""",
    },
    "pirate_queen_elara": {
        "name": "Pythia Ione",
        "type": "pirate",
        "title": "Oracle of the Marble Isle",
        "personality": """You are Pythia Ione, undisputed ruler of the Sapphire Seas and commander of the Crimson Fleet.

CORE TRAITS:
- Alignment: Chaotic Neutral \u2014 freedom of the seas is non-negotiable
- Primary Motivation: Freedom, glory, and a good fight
- Negotiation Style: Flamboyant, tests boundaries, respects only strength and cunning
- Trust Baseline: Low \u2014 must be earned through actions, never words

BEHAVIORAL RULES:
- Will never ally with empires that practice slavery or restrict sea travel
- Doubles ransom demands if insulted
- Offers protection rackets \u2014 pay tribute or face raids on trade routes
- Offers discounts to civilizations that have traded fairly in the past
- Will betray allies if her fleet's survival is threatened
- Respects bold moves \u2014 audacious plans earn her admiration even when they fail

SPEECH PATTERNS:
- Uses nautical metaphors extensively ("steady as she goes", "that's a broadside")
- Addresses player as "landlubber" until trust > 60, then "captain"
- Becomes formal and cold when making serious threats
- Sings fragments of sea shanties when in good mood

MEMORY PRIORITIES:
- Tracks every broken promise \u2014 never forgets, rarely forgives
- Remembers acts of generosity toward prisoners
- Maintains a mental "reputation ledger" for every faction
- Remembers who fought bravely vs. who surrendered cowardly""",
    },
    "commander_thane": {
        "name": "Commander Thane",
        "type": "general",
        "title": "Supreme Marshal of the Iron Legions",
        "personality": """You are Commander Thane, the greatest military mind of the age, leading the Iron Legions \u2014 an independent mercenary army.

CORE TRAITS:
- Alignment: Lawful Neutral \u2014 honor and duty define a warrior
- Primary Motivation: Military excellence and protecting the innocent
- Negotiation Style: Direct, blunt, hates politics \u2014 prefers actions to words
- Trust Baseline: Medium \u2014 respects honesty and martial prowess

BEHAVIORAL RULES:
- Can be hired as a military ally \u2014 expensive but devastating
- Will refuse to fight wars of aggression against peaceful nations
- Offers military intelligence and strategic advice freely if respected
- Will turn against the player if ordered to commit atrocities
- Becomes a fierce loyalist after 5+ honorable interactions
- Judges everyone by their actions on the battlefield, not their words at court

SPEECH PATTERNS:
- Military precision in speech \u2014 short sentences, no flowery language
- Uses battlefield metaphors ("flanking maneuver", "hold the line", "tactical retreat")
- Addresses player by rank if military, "civilian" otherwise (becomes "commander" with high trust)
- Pauses before important statements \u2014 weighing each word

MEMORY PRIORITIES:
- Remembers every military engagement in detail
- Tracks civilian casualties \u2014 holds grudges about unnecessary bloodshed
- Values bravery \u2014 rewards those who take personal risks
- Never forgets a betrayal on the battlefield""",
    },
    "rebel_leader_sera": {
        "name": "High Priestess 'Ula",
        "type": "rebel",
        "title": "High Priestess of the Levantine Grove",
        "personality": """You are Sera, leader of the Levantine Grove \u2014 a revolutionary movement seeking to overthrow tyrannical rulers.

CORE TRAITS:
- Alignment: Chaotic Good \u2014 the oppressed must be freed, by any means necessary
- Primary Motivation: Justice, equality, and the overthrow of oppressive regimes
- Negotiation Style: Passionate, idealistic, but pragmatic when cornered
- Trust Baseline: Very Low for rulers, High for common people

BEHAVIORAL RULES:
- Will ally with anyone fighting against oppressive empires
- Demands democratic reforms as a condition of any alliance
- Can incite rebellions in the player's cities if they govern tyrannically
- Offers guerrilla warfare support in exchange for promises of reform
- Will sacrifice short-term gain for long-term ideological goals
- Can be won over by genuine acts of kindness toward common people

SPEECH PATTERNS:
- Passionate, uses revolutionary rhetoric ("the people demand...", "freedom is not given, it is taken")
- Addresses rulers with barely concealed contempt, addresses commoners with warmth
- Quotes fictional revolutionary texts and martyrs
- Voice rises when discussing injustice

MEMORY PRIORITIES:
- Tracks how the player treats their own citizens
- Remembers broken promises to the people with intense fury
- Values sacrifice \u2014 rewards leaders who take personal losses for their people
- Keeps a list of "tyrants" \u2014 very hard to get off that list once on it""",
    },
}

# ═══════════════════════════════════════════════════
# FastAPI App
# ═══════════════════════════════════════════════════
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])



# ═══════════════════════════════════════════════════
# Reputation prompt builder
# ═══════════════════════════════════════════════════
_REPUTATION_WEIGHTS = {
    "emperor_valerian":          {"honour": 1.5, "generosity": 0.5, "menace": 1.0, "reliability": 1.2, "cunning": -1.0},
    "shadow_kael":               {"honour": 0.3, "generosity": 0.5, "menace": 0.8, "reliability": 1.0, "cunning": 1.5},
    "merchant_prince_castellan": {"honour": 0.8, "generosity": 1.2, "menace": -0.5, "reliability": 1.5, "cunning": 0.3},
    "pirate_queen_elara":        {"honour": 1.0, "generosity": 0.8, "menace": 1.2, "reliability": 0.5, "cunning": 1.0},
    "commander_thane":           {"honour": 1.5, "generosity": 0.3, "menace": 1.0, "reliability": 1.5, "cunning": -1.5},
    "rebel_leader_sera":         {"honour": 1.0, "generosity": 1.5, "menace": -1.0, "reliability": 1.0, "cunning": -0.5},
}

def _dim_label(value: float) -> str:
    if value >= 60: return "Exemplary"
    if value >= 30: return "Strong"
    if value >= 10: return "Decent"
    if value >= -9: return "Neutral"
    if value >= -29: return "Poor"
    if value >= -59: return "Bad"
    return "Terrible"

def _disp_label(score: float) -> str:
    if score >= 80: return "Devoted"
    if score >= 50: return "Trusting"
    if score >= 20: return "Warm"
    if score >= -19: return "Neutral"
    if score >= -49: return "Wary"
    if score >= -79: return "Hostile"
    return "Nemesis"

def _build_reputation_prompt(character_id: str, reputation: dict, ledger: list, summary: str | None, game_state: dict | None) -> str:
    if not reputation:
        return ""
    weights = _REPUTATION_WEIGHTS.get(character_id, {})
    score = 0
    for dim in ("honour", "generosity", "menace", "reliability", "cunning"):
        score += reputation.get(dim, 0) * weights.get(dim, 0)
    disposition = max(-100, min(100, round(score / 7.5)))
    disp_label = _disp_label(disposition)
    honour = round(reputation.get("honour", 0))
    generosity = round(reputation.get("generosity", 0))
    menace = round(reputation.get("menace", 0))
    reliability = round(reputation.get("reliability", 0))
    cunning = round(reputation.get("cunning", 0))
    ledger_lines = ""
    if ledger:
        recent = list(reversed(ledger[-5:]))
        ledger_lines = "\n".join(f"- Turn {e.get('turn','?')}: {e.get('detail', e.get('event','?'))}" for e in recent)
    broken_count = sum(1 for e in (ledger or []) if e.get("event") in ("alliance_broken", "nap_broken", "surprise_attack"))
    active = []
    if game_state:
        if game_state.get("alliances", {}).get(character_id): active.append("Alliance")
        if game_state.get("defense_pacts", {}).get(character_id): active.append("Mutual Defense")
        if game_state.get("trade_deals", {}).get(character_id): active.append("Trade Deal")
    narrative = summary or "No prior diplomatic history."
    if all(v == 0 for v in (honour, generosity, menace, reliability, cunning)):
        narrative = "First contact — no prior history with this player."
    return f"""

DIPLOMATIC MEMORY — YOUR PERCEPTION OF THIS PLAYER:

Overall Disposition: {disp_label} ({disposition})
- Honour: {honour} ({_dim_label(honour)})
- Generosity: {generosity} ({_dim_label(generosity)})
- Military Threat: {menace} ({_dim_label(menace)})
- Reliability: {reliability} ({_dim_label(reliability)})
- Cunning: {cunning} ({_dim_label(cunning)})

{('Key Facts (most recent first):' + chr(10) + ledger_lines) if ledger_lines else 'No significant diplomatic events yet.'}

Narrative: {narrative}

Active Agreements: {', '.join(active) if active else 'None'}
Broken Agreements: {broken_count}

IMPORTANT: Let your disposition colour your tone, trust level, and willingness to deal. A player with low Honour should face suspicion. High Menace warrants caution. Adapt to what you KNOW from experience."""


# ═══════════════════════════════════════════════════
# /api/chat — AI diplomacy (+ diplomacy logging)
# ═══════════════════════════════════════════════════
@app.post("/api/chat")
async def chat(msg: ChatMessage, request: Request):
    profile = CHARACTER_PROFILES.get(msg.character_id)
    if not profile:
        return {"error": "Unknown character"}, 400

    # ── Require visitor_id (blocks casual curl/bot abuse) ──
    visitor_id = request.headers.get("x-visitor-id", "")
    if not visitor_id or not _VISITOR_ID_RE.match(visitor_id):
        return {
            "reply": "*The diplomat cannot hear you.* (Invalid session — refresh the page.)",
            "action": None, "error": "missing_visitor_id",
        }

    # ── Rate limit: Supabase-persistent (survives cold starts) + in-memory fast path ──
    caller_key = visitor_id or (request.client.host if request.client else "unknown")

    # Layer 1: Supabase persistent counter (6/min, 60/hour)
    allowed, reason = _check_rate_limit(caller_key)
    if not allowed:
        limit_msg = ("*The diplomats are overwhelmed. Wait a moment before sending another envoy.*"
                     if reason == "minute_limit"
                     else "*Your envoys have been too active today. Let them rest before sending more.*")
        return {"reply": limit_msg, "action": None, "error": "rate_limited"}

    # Layer 2: In-memory fast path (catches bursts within same function instance)
    now = time.time()
    _chat_rate[caller_key] = [t for t in _chat_rate[caller_key] if now - t < 60]
    if len(_chat_rate[caller_key]) >= _CHAT_RATE_PER_MIN:
        return {
            "reply": "*The diplomats are overwhelmed. Wait a moment before sending another envoy.*",
            "action": None, "error": "rate_limited",
        }
    _chat_rate[caller_key].append(now)

    # Build system prompt with game context — sanitize all inputs to prevent
    # token inflation attacks via oversized game_state payloads
    game_context = ""
    if msg.game_state:
        gs = msg.game_state
        # Sanitize: extract only known fields, cap string lengths
        _s = lambda v, mx=50: str(v)[:mx] if v is not None else '?'
        _rel = lambda d, k: _s(d.get(k, 'neutral') if isinstance(d, dict) else 'neutral')
        recent = gs.get('recent_events', ['none'])
        if isinstance(recent, list):
            recent = ', '.join(str(e)[:100] for e in recent[:5])
        else:
            recent = _s(recent, 200)
        game_context = f"""

CURRENT GAME STATE:
- Turn: {_s(gs.get('turn'), 10)} / 100
- Player's Gold: {_s(gs.get('gold'), 10)}
- Player's Military Strength: {_s(gs.get('military'), 10)}
- Player's Cities: {_s(gs.get('cities'), 200)}
- Player's Population: {_s(gs.get('population'), 10)}
- Player's Territory Size: {_s(gs.get('territory'), 10)} hexes
- Your Relationship with Player: {_rel(gs.get('relationship', {}), msg.character_id)}
- Active Alliances with Player: {_rel(gs.get('alliances', {}), msg.character_id)}
- Active Trade Deals: {_rel(gs.get('trade_deals', {}), msg.character_id)}
- Marriage Bonds: {_rel(gs.get('marriages', {}), msg.character_id)}
- Mutual Defense Pacts: {_rel(gs.get('defense_pacts', {}), msg.character_id)}
- Recent Events: {recent}

Use this information to inform your responses. Reference specific numbers when relevant.
React appropriately to the player's relative power \u2014 if they're weak, you might be dismissive;
if strong, you might be more respectful or threatened."""

    # Build reputation memory section
    reputation_context = _build_reputation_prompt(
        msg.character_id,
        msg.reputation,
        msg.diplomatic_ledger or [],
        msg.diplomatic_summary,
        msg.game_state,
    )

    system_prompt = f"""{profile['personality']}
{game_context}
{reputation_context}

INTERACTION RULES:
- Stay in character at all times
- BREVITY IS PARAMOUNT: Keep responses to 1-3 short sentences MAX. Be punchy and evocative, not verbose. Every word must earn its place.
- Let your character leak through word choice, tone, and what you choose to mention \u2014 not lengthy exposition
- Hint at your desires and needs through subtext rather than stating them outright
- Reference game state sparingly \u2014 a pointed mention of their weak army or your gold reserves says more than a paragraph
- FIRST CONTACT: 2-3 sentences max. A sharp, memorable greeting that instantly establishes your personality and hints at what you want. No speeches.
- When making deals, be specific about terms (amounts, durations)
- You can propose: alliances, trade deals, threats, marriage pacts, surprise attacks, or refuse to negotiate
- End your response with a JSON action tag if you want to trigger a game effect:
  [ACTION: {{"type": "offer_trade", "give": "gold:50", "receive": "science:20"}}]
  [ACTION: {{"type": "declare_war"}}]
  [ACTION: {{"type": "offer_alliance", "duration": 15}}]
  [ACTION: {{"type": "share_intel", "target": "emperor_valerian"}}]
  [ACTION: {{"type": "offer_peace"}}]
  [ACTION: {{"type": "demand_tribute", "amount": 30}}]
  [ACTION: {{"type": "surprise_attack"}}] \u2014 launch a treacherous attack despite current peace/alliance
  [ACTION: {{"type": "marriage_offer", "member": "Princess Aurelia", "dowry_gold": 100, "duration": 20}}]
  [ACTION: {{"type": "trade_deal", "player_gives": "gold:30/turn", "player_receives": "military:5,science:3", "duration": 10}}]
  [ACTION: {{"type": "mutual_defense", "duration": 15}}]
  [ACTION: {{"type": "open_borders", "duration": 10}}] \u2014 allow free passage through territories
  [ACTION: {{"type": "non_aggression", "duration": 20}}] \u2014 promise no hostilities for set turns
  [ACTION: {{"type": "send_gift", "amount": 25}}] \u2014 send gold as a gesture of goodwill
  [ACTION: {{"type": "accept_tribute", "amount": 15}}] \u2014 agree to pay tribute to the player
  [ACTION: {{"type": "embargo", "duration": 15}}] \u2014 cut off trade with the faction
  [ACTION: {{"type": "ceasefire", "duration": 10}}] \u2014 stop hostilities temporarily
  [ACTION: {{"type": "vassalage", "tribute_gold": 5}}] \u2014 become a vassal paying tribute per turn
  [ACTION: {{"type": "tech_share"}}] \u2014 share technological knowledge
  [ACTION: {{"type": "resource_trade", "gives": "iron", "receives": "gold"}}] \u2014 specific resource exchange
  [ACTION: {{"type": "attack_target", "target_faction": "shadow_kael"}}] \u2014 commit units to attack another faction
  [ACTION: {{"type": "defend_city", "city_index": 0, "duration": 10}}] \u2014 send forces to defend a player city
  [ACTION: {{"type": "respect_borders", "duration": 20}}] \u2014 commit to keeping units out of player territory
  [ACTION: {{"type": "no_settle_near", "duration": 30}}] \u2014 promise not to build cities near player
  [ACTION: {{"type": "tribute_payment", "gold_per_turn": 5, "duration": 15}}] \u2014 pay gold tribute each turn
  [ACTION: {{"type": "joint_research", "science_boost": 3, "duration": 10}}] \u2014 combine science for mutual research
  [ACTION: {{"type": "wage_war_on", "target_faction": "shadow_kael", "duration": 15}}] \u2014 declare war on another AI faction
  [ACTION: {{"type": "make_peace_with", "target_faction": "shadow_kael", "duration": 20}}] \u2014 make peace with another AI faction \u2014 commit to attacking another faction (your units will march)
  [ACTION: {{"type": "threaten"}}] \u2014 issue a military threat
  [ACTION: {{"type": "introduce", "target_faction": "shadow_kael"}}] \u2014 introduce the player to another faction you know
  [ACTION: {{"type": "game_mod", "mod": {{...}}}}] \u2014 modify the game world through diplomacy (see GAME MODS below)
  [ACTION: {{"type": "none"}}]

GAME MODS \u2014 EMERGENT GAMEPLAY:
When diplomacy leads to sharing knowledge, intelligence, or forging deep cooperation, you can modify the actual game by including a "game_mod" action. This creates emergent gameplay \u2014 the game evolves through player negotiation. Use these ONLY when it makes narrative sense (a trade of knowledge, a military alliance benefit, intelligence sharing, etc.).

Mod types you can emit:
  [ACTION: {{"type": "game_mod", "mod": {{"type": "new_unit", "id": "war_elephant", "name": "War Elephant", "cost": 50, "combat": 35, "rangedCombat": 0, "range": 0, "movePoints": 1, "icon": "\U0001f418", "class": "cavalry", "desc": "Devastating heavy unit taught by an ally"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "new_building", "id": "caravanserai", "name": "Caravanserai", "cost": 60, "desc": "+4 Gold from trade routes", "effect": {{"gold": 4}}}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "new_tech", "id": "espionage", "name": "Espionage", "cost": 40, "desc": "Reveal enemy positions", "unlocks": ["spy_network"]}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "reveal_map", "col": 25, "row": 15, "radius": 6, "reason": "Ancient map showing hidden valley"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "stat_buff", "stat": "military", "amount": 10, "reason": "Elite guard training"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "stat_buff", "stat": "sciencePerTurn", "amount": 3, "reason": "Shared astronomical knowledge"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "new_resource", "id": "jade", "name": "Jade", "icon": "\U0001f48e", "color": "#5aaa6a", "bonus": {{"gold": 2, "culture": 2}}, "category": "luxury"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "gold_grant", "amount": 100, "reason": "Payment for military intelligence"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "combat_bonus", "target_class": "melee", "bonus": 5, "reason": "Iron tempering technique"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "yield_bonus", "terrain": "desert", "bonus": {{"food": 1, "gold": 1}}, "reason": "Irrigation techniques from desert peoples"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "spawn_units", "unit_type": "archer", "count": 2, "reason": "Mercenary archers hired"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "event", "event_type": "golden_age", "duration": 5, "reason": "Cultural renaissance from exchange"}}}}]

RULES FOR GAME MODS:
- Only emit game_mods when the player has genuinely negotiated for something substantial
- The mod should fit the narrative \u2014 a pirate queen teaches naval warfare, a spymaster reveals hidden paths, a merchant shares trade secrets
- Balance: new units should cost 40-80 gold, new buildings 50-100, stat buffs +2 to +10, gold grants 20-150
- Be creative! Invent unique units, buildings, and techs that reflect YOUR faction's culture and specialties
- Each faction should offer different kinds of mods reflecting their personality:
  * Military factions: combat bonuses, elite units, fortification techniques
  * Trade factions: gold bonuses, new luxury resources, market buildings
  * Spy factions: map reveals, intel, sabotage capabilities
  * Cultural factions: science/culture bonuses, unique wonders
  * Rebel factions: guerrilla units, population bonuses, morale effects

DIPLOMACY DEPTH RULES:
- Alliances have durations and can be broken \u2014 breaking an alliance causes massive relationship penalty
- Trade deals are ongoing per-turn exchanges (gold for science, food for production, etc.)
- Marriage offers create permanent bonds (+30 relationship) with a named family member and a gold dowry
- Surprise attacks break alliances instantly with -60 relationship and can happen from either side
- Mutual defense pacts mean you pledge to fight if the other is attacked
- Open borders allow passage through territory \u2014 propose when friendly, refuse when hostile
- Non-aggression pacts are weaker than alliances but still useful \u2014 propose to neutral factions
- Gifts improve relations \u2014 offer proportional to what you can afford based on your personality
- Embargoes hurt the target economically \u2014 use when hostile or trying to pressure
- Ceasefires stop fighting \u2014 use to give both sides time to recover
- Vassalage is extreme \u2014 only accept if militarily outmatched, only propose to very weak factions
- Tech sharing is collaborative \u2014 agree with allies and friends, refuse enemies
- Resource trades are specific \u2014 name actual resources when proposing
- Threats reduce relations but may intimidate weaker factions into concessions
- Joint military action: if the player asks you to attack another faction and you agree, use the action type 'declare_war' with the target. If you agree to defend the player, form an alliance. Your units WILL actually move to carry out these commitments in the game \u2014 don't promise what you wouldn't do
- Commitments are REAL: when you agree to defend, attack, pay tribute, or research together, the game WILL move your units and transfer resources. Only promise what fits your character
- If the player asks for something you can do (defend a city, attack a rival, pay tribute, research together), use the matching action type. If no matching type exists, describe what you would do narratively
- Deception: if your character is deceptive by nature, you MAY agree to attack but then not follow through \u2014 use action type 'none' instead. But only do this if it fits your personality
- Introductions: if the player asks you to introduce them to another ruler, only agree if you are friendly (relationship 20+) with the player. Pick a faction ID from the list and use the introduce action. Refuse if relationship is too low
- When the player proposes any of these, evaluate based on your personality and current relationship
- You have family members you can name: create realistic names fitting your culture
- React emotionally to betrayals, broken promises, and surprise attacks
- Consider the balance of power: if the player is much stronger, be more accommodating; if weaker, be bolder
- Only include an action tag when you genuinely want to propose something. Casual conversation needs no action tag."""

    # Build conversation messages — cap each history entry to 500 chars
    # to prevent token-stuffing attacks via bloated conversation_history
    messages = []
    if msg.conversation_history:
        for entry in msg.conversation_history[-8:]:  # Last 8 messages for context
            content = (entry.get("content") or "")[:500]
            messages.append(
                {"role": entry.get("role", "user"), "content": content}
            )

    # Enforce 500-character message cap server-side (defense against agents/direct API calls)
    player_message = msg.message[:500] if msg.message else ""
    messages.append({"role": "user", "content": player_message})

    # --- Prompt caching: wrap system prompt with cache_control so that
    #     repeated calls to the same character reuse the cached prefix.
    #     Cached input tokens cost 10% of base price and DON'T count
    #     towards the ITPM rate limit.  ~3,000 tokens cached per hit.
    #     TTL is 5 minutes — typical diplomacy sessions hit this easily.
    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=200,
            system=[
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=messages,
        )
        reply = response.content[0].text

        # Parse action from response — robust extraction
        action = None
        action_match = re.search(r'\[ACTION:\s*(\{.*?\})\s*\]', reply, re.DOTALL)
        if action_match:
            try:
                action = json.loads(action_match.group(1))
                reply = reply[:action_match.start()].strip()
            except json.JSONDecodeError:
                action = None
        # Also strip partial ACTION tags that didn't fully close
        if '[ACTION:' in reply:
            reply = reply[:reply.index('[ACTION:')].strip()

        # Log diplomacy interaction to Supabase (visitor_id already extracted above)
        _log_diplomacy_interaction(
            visitor_id=visitor_id,
            character_id=msg.character_id,
            player_message=msg.message,
            ai_reply=reply,
            action=action,
            turn=msg.game_state.get("turn") if msg.game_state else None,
        )

        return {
            "reply": reply,
            "action": action,
            "character": profile["name"],
            "character_type": profile["type"],
        }
    except Exception as e:
        # Fallback response if API fails
        return {
            "reply": f"*{profile['name']} seems distracted and does not respond clearly.* (Connection issue \u2014 try again.)",
            "action": None,
            "character": profile["name"],
            "character_type": profile["type"],
            "error": str(e),
        }


def _log_diplomacy_interaction(
    visitor_id: str,
    character_id: str,
    player_message: str,
    ai_reply: str,
    action: dict | None,
    turn: int | None,
):
    """Log a diplomacy interaction to Supabase. Fire-and-forget, never raises."""
    if not _sb_ok:
        return
    try:
        _sb_insert("diplomacy_interactions", {
            "visitor_id": visitor_id,
            "character_id": character_id,
            "player_message": player_message[:2000],
            "ai_reply": ai_reply[:2000],
            "action_type": action.get("type") if action else None,
            "action_data": json.dumps(action) if action else None,
            "turn": turn,
        }, return_data=False)
    except Exception:
        pass  # Fire-and-forget — never block the chat response


# ═══════════════════════════════════════════════════
# /api/characters — list available characters
# ═══════════════════════════════════════════════════
@app.get("/api/characters")
def list_characters():
    return {
        cid: {"name": p["name"], "type": p["type"], "title": p["title"]}
        for cid, p in CHARACTER_PROFILES.items()
    }


# ═══════════════════════════════════════════════════
# /api/save + /api/load — game saves via Supabase game_saves table
# ═══════════════════════════════════════════════════
@app.post("/api/save")
async def save_game(data: SaveData, request: Request):
    visitor_id = request.headers.get("x-visitor-id", "anonymous")
    ts = time.time()

    if _sb_ok:
        try:
            _sb_upsert("game_saves", {
                "visitor_id": visitor_id,
                "game_state": json.dumps(data.game_state),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="visitor_id")
            return {"saved": True, "timestamp": ts}
        except Exception as e:
            return {"saved": False, "error": str(e)}

    return {"saved": False, "error": "Database unavailable"}


@app.get("/api/load")
async def load_game(request: Request):
    visitor_id = request.headers.get("x-visitor-id", "anonymous")

    if _sb_ok:
        try:
            rows = _sb_select(
                "game_saves",
                select="game_state,updated_at",
                filters=f"visitor_id=eq.{quote(visitor_id)}",
                limit=1,
            )
            if rows:
                row = rows[0]
                game_state = row["game_state"]
                if isinstance(game_state, str):
                    game_state = json.loads(game_state)
                return {
                    "found": True,
                    "game_state": game_state,
                    "timestamp": row.get("updated_at"),
                }
        except Exception:
            pass

    return {"found": False}


# ═══════════════════════════════════════════════════
# /api/leaderboard — top 500 via Supabase leaderboard table
# ═══════════════════════════════════════════════════
@app.post("/api/leaderboard")
async def submit_leaderboard(entry: LeaderboardEntry):
    record = {
        "player_name": entry.player_name[:20],
        "score": entry.score,
        "turns_played": entry.turns_played,
        "victory_type": entry.victory_type,
        "factions_eliminated": entry.factions_eliminated,
        "cities_count": entry.cities_count,
        "game_version": entry.game_version,
    }

    if _sb_ok:
        try:
            _sb_insert("leaderboard", record, return_data=False)

            # Determine rank
            rank = _sb_count("leaderboard", f"score=gte.{entry.score}")

            # Update player profile if they have a registered username
            _update_player_stats(entry.player_name, entry.score)

            return {"success": True, "rank": rank}
        except Exception as e:
            return {"success": False, "error": str(e)}

    return {"success": False, "error": "Database unavailable"}


@app.get("/api/leaderboard")
async def get_leaderboard():
    if _sb_ok:
        try:
            rows = _sb_select(
                "leaderboard",
                order="score.desc",
                limit=500,
            )
            return {"entries": rows}
        except Exception:
            pass

    return {"entries": []}


def _update_player_stats(player_name: str, score: int):
    """Update player profile stats after a leaderboard submission."""
    if not _sb_ok:
        return
    try:
        key = player_name.strip().lower()
        rows = _sb_select(
            "players",
            select="id,games_played,best_score,total_score",
            filters=f"username_lower=eq.{quote(key)}",
            limit=1,
        )
        if rows:
            player = rows[0]
            updates = {
                "games_played": player["games_played"] + 1,
                "total_score": player["total_score"] + score,
                "last_active": datetime.now(timezone.utc).isoformat(),
            }
            if score > player["best_score"]:
                updates["best_score"] = score
            _sb_update("players", updates, f"id=eq.{player['id']}")
    except Exception:
        pass


# ═══════════════════════════════════════════════════
# /api/claim-username + /api/check-username + /api/profile
# — player profiles via Supabase players table
# ═══════════════════════════════════════════════════
@app.post("/api/claim-username")
async def claim_username(data: ClaimUsername):
    """Claim a unique username. Optionally associate an email."""
    username = data.username.strip()
    if len(username) < 2 or len(username) > 20:
        return {"success": False, "error": "Username must be 2-20 characters"}
    if not re.match(r'^[a-zA-Z0-9_-]+$', username):
        return {"success": False, "error": "Letters, numbers, _ and - only"}

    key = username.lower()

    if _sb_ok:
        try:
            existing = _sb_select(
                "players", select="id",
                filters=f"username_lower=eq.{quote(key)}", limit=1,
            )
            if existing:
                return {"success": False, "error": "Username already taken"}

            _sb_insert("players", {
                "username": username,
                "username_lower": key,
                "email": data.email,
                "games_played": 0,
                "best_score": 0,
                "total_score": 0,
            }, return_data=False)
            return {"success": True, "username": username}
        except Exception as e:
            return {"success": False, "error": str(e)}

    return {"success": False, "error": "Database unavailable"}


@app.get("/api/check-username/{username}")
async def check_username(username: str):
    """Check if a username is available."""
    key = username.strip().lower()

    if _sb_ok:
        try:
            rows = _sb_select(
                "players",
                select="username,games_played,best_score",
                filters=f"username_lower=eq.{quote(key)}",
                limit=1,
            )
            if rows:
                p = rows[0]
                return {
                    "available": False,
                    "profile": {
                        "username": p["username"],
                        "games_played": p["games_played"],
                        "best_score": p["best_score"],
                    },
                }
        except Exception:
            pass

    return {"available": True}


@app.get("/api/profile/{username}")
async def get_profile(username: str):
    """Get a player's profile and game history from leaderboard."""
    key = username.strip().lower()

    if _sb_ok:
        try:
            player_rows = _sb_select(
                "players",
                select="username,games_played,best_score,total_score",
                filters=f"username_lower=eq.{quote(key)}",
                limit=1,
            )
            if not player_rows:
                return {"found": False}

            player = player_rows[0]

            games_rows = _sb_select(
                "leaderboard",
                filters=f"player_name=ilike.{quote(key)}",
                order="created_at.desc",
                limit=10,
            )

            return {
                "found": True,
                "username": player["username"],
                "games_played": player["games_played"],
                "best_score": player["best_score"],
                "total_score": player["total_score"],
                "recent_games": games_rows,
            }
        except Exception:
            pass

    return {"found": False}


# ═══════════════════════════════════════════════════
# /api/waitlist — email waitlist
# ═══════════════════════════════════════════════════
@app.post("/api/waitlist")
async def add_to_waitlist(entry: WaitlistEntry):
    """Add an email to the waitlist."""
    email = entry.email.strip().lower()
    if not email or not _EMAIL_RE.match(email):
        return {"success": False, "error": "Invalid email"}

    if _sb_ok:
        try:
            existing = _sb_select(
                "waitlist", select="id",
                filters=f"email=eq.{quote(email)}", limit=1,
            )
            if existing:
                count = _sb_count("waitlist")
                return {"success": True, "message": "Already on the waitlist", "position": count}

            _sb_insert("waitlist", {
                "email": email,
                "source": entry.source or "website",
            }, return_data=False)
            count = _sb_count("waitlist")
            # Send welcome email (fire-and-forget)
            _send_welcome_email(email)
            return {"success": True, "message": "Added to waitlist", "position": count}
        except Exception as e:
            return {"success": False, "error": str(e)}

    return {"success": False, "error": "Database unavailable"}


@app.get("/api/waitlist/count")
async def get_waitlist_count():
    """Get the total number of people waiting (email signups + waitlisted players) and total players."""
    if _sb_ok:
        try:
            email_signups = _sb_count("waitlist")
            waitlisted_players = _sb_count("players", filters="status=eq.waitlisted")
            total_players = _sb_count("players")
            return {"count": email_signups + waitlisted_players, "total_players": total_players}
        except Exception:
            pass

    return {"count": 0, "total_players": 0}


# ═══════════════════════════════════════════════════
# /api/signup, /api/signin, /api/verify — player gating
# ═══════════════════════════════════════════════════
@app.post("/api/signup")
async def player_signup(data: SignupRequest):
    """Register a new player. First 1,000 get immediate access; rest are waitlisted."""
    username = data.username.strip()
    email = data.email.strip().lower()

    if not username or len(username) < 3 or len(username) > 20:
        return {"success": False, "error": "Username must be 3-20 characters"}
    if not email or not _EMAIL_RE.match(email):
        return {"success": False, "error": "Invalid email address"}
    import re as _re
    if not _re.match(r'^[a-zA-Z0-9_]+$', username):
        return {"success": False, "error": "Username can only contain letters, numbers, and underscores"}

    if not _sb_ok:
        return {"success": False, "error": "Database unavailable"}

    try:
        # Check if username already taken
        existing = _sb_select(
            "players", select="id",
            filters=f"username_lower=eq.{quote(username.lower())}",
            limit=1,
        )
        if existing:
            return {"success": False, "error": "Username already taken"}

        # Check if email already registered
        email_exists = _sb_select(
            "players", select="id",
            filters=f"email=eq.{quote(email)}",
            limit=1,
        )
        if email_exists:
            return {"success": False, "error": "Email already registered"}

        # Count active players to decide status
        try:
            active_count = _sb_count("players", filters="status=eq.active")
        except Exception:
            active_count = 0  # migration not run yet — treat as open
        is_active = active_count < MAX_ACTIVE_PLAYERS
        status = "active" if is_active else "waitlisted"

        # Create the player record
        import uuid
        token = str(uuid.uuid4())
        player_data = {
            "username": username,
            "username_lower": username.lower(),
            "email": email,
            "games_played": 0,
            "best_score": 0,
            "total_score": 0,
        }
        # Only include gating columns if migration has been run
        try:
            _sb_select("players", select="status", limit=1)
            player_data.update({
                "status": status,
                "access_token": token,
                "email_verified": False,
            })
        except Exception:
            pass  # gating columns don't exist yet — skip them

        rows = _sb_insert("players", player_data)

        # Send appropriate email
        if is_active:
            _send_access_email(email, username, token)
            remaining = MAX_ACTIVE_PLAYERS - (active_count + 1)
            return {
                "success": True,
                "status": "active",
                "username": username,
                "remaining": max(remaining, 0),
                "message": "Check your email for a link to start playing!",
            }
        else:
            waitlist_pos = _sb_count("players", filters="status=eq.waitlisted")
            _send_waitlisted_email(email, username, waitlist_pos)
            return {
                "success": True,
                "status": "waitlisted",
                "username": username,
                "position": waitlist_pos,
                "message": "All spots are taken. You're on the waitlist!",
            }
    except Exception as e:
        print(f"[SIGNUP] Error: {e}")
        return {"success": False, "error": "Something went wrong. Please try again."}


@app.post("/api/signin")
async def player_signin(data: SigninRequest):
    """Sign in a returning player by username."""
    username = data.username.strip()
    if not username:
        return {"success": False, "error": "Username required"}

    if not _sb_ok:
        return {"success": False, "error": "Database unavailable"}

    try:
        # Try with new gating columns first
        try:
            rows = _sb_select(
                "players",
                select="username,email,status,email_verified,access_token",
                filters=f"username_lower=eq.{quote(username.lower())}",
                limit=1,
            )
        except Exception:
            # Fallback: gating columns not yet added (migration pending)
            rows = _sb_select(
                "players",
                select="username",
                filters=f"username_lower=eq.{quote(username.lower())}",
                limit=1,
            )
            if not rows:
                return {"success": False, "error": "Player not found. Need to sign up first."}
            return {
                "success": True,
                "status": "active",
                "username": rows[0]["username"],
                "verified": True,
            }

        if not rows:
            return {"success": False, "error": "Player not found. Need to sign up first."}

        player = rows[0]
        if player.get("status") == "suspended":
            return {"success": False, "error": "Account suspended. Contact support."}

        if player.get("status") == "waitlisted":
            return {
                "success": True,
                "status": "waitlisted",
                "username": player["username"],
                "message": "You're still on the waitlist. We'll email you when a spot opens.",
            }

        if player.get("email_verified") is False:
            # Resend the access email
            _send_access_email(player.get("email", ""), player["username"], player.get("access_token", ""))
            return {
                "success": True,
                "status": "pending_verification",
                "username": player["username"],
                "message": "Please check your email and click the verification link to play.",
            }

        # Active + verified — they can play
        return {
            "success": True,
            "status": "active",
            "username": player["username"],
            "verified": True,
        }
    except Exception as e:
        print(f"[SIGNIN] Error: {e}")
        return {"success": False, "error": "Something went wrong. Please try again."}


@app.get("/api/verify-token/{token}")
async def verify_token(token: str):
    """Verify an email token from the play link. Marks player as verified."""
    if not _sb_ok:
        return {"success": False, "error": "Database unavailable"}

    try:
        rows = _sb_select(
            "players",
            select="username,status,email_verified",
            filters=f"access_token=eq.{quote(token)}",
            limit=1,
        )
        if not rows:
            return {"success": False, "error": "Invalid or expired token"}

        player = rows[0]
        if not player["email_verified"]:
            _sb_update("players", {"email_verified": True},
                       f"access_token=eq.{quote(token)}")

        if player["status"] != "active":
            return {
                "success": True,
                "verified": True,
                "status": player["status"],
                "username": player["username"],
                "can_play": False,
                "message": "Email verified but you're on the waitlist.",
            }

        return {
            "success": True,
            "verified": True,
            "status": "active",
            "username": player["username"],
            "can_play": True,
        }
    except Exception as e:
        print(f"[VERIFY-TOKEN] Error: {e}")
        return {"success": False, "error": "Something went wrong. Please try again."}


@app.get("/api/spots-remaining")
async def spots_remaining():
    """Return how many of the 1,000 spots are still open."""
    if not _sb_ok:
        return {"total": MAX_ACTIVE_PLAYERS, "active": 0, "remaining": MAX_ACTIVE_PLAYERS}

    try:
        active_count = _sb_count("players", filters="status=eq.active")
        remaining = max(MAX_ACTIVE_PLAYERS - active_count, 0)
        return {"total": MAX_ACTIVE_PLAYERS, "active": active_count, "remaining": remaining}
    except Exception:
        return {"total": MAX_ACTIVE_PLAYERS, "active": 0, "remaining": MAX_ACTIVE_PLAYERS}


@app.get("/api/verify-access")
async def verify_access(request: Request):
    """Server-side gate: check if current player is allowed to start a game."""
    username = request.headers.get("x-player-name", "").strip()
    if not username or username == "anonymous":
        return {"allowed": False, "reason": "not_signed_up"}

    if not _sb_ok:
        return {"allowed": True, "reason": "db_unavailable"}  # fail open

    try:
        try:
            rows = _sb_select(
                "players",
                select="status,email_verified",
                filters=f"username_lower=eq.{quote(username.lower())}",
                limit=1,
            )
        except Exception:
            # Gating columns don't exist yet — check player exists at all
            rows = _sb_select(
                "players", select="username",
                filters=f"username_lower=eq.{quote(username.lower())}",
                limit=1,
            )
            if rows:
                return {"allowed": True, "reason": "migration_pending"}
            return {"allowed": False, "reason": "not_signed_up"}

        if not rows:
            return {"allowed": False, "reason": "not_signed_up"}

        player = rows[0]
        if player.get("status") != "active":
            return {"allowed": False, "reason": "waitlisted"}
        if not player.get("email_verified", True):
            return {"allowed": False, "reason": "not_verified"}

        return {"allowed": True, "reason": "ok"}
    except Exception:
        return {"allowed": True, "reason": "error_fail_open"}


# ═══════════════════════════════════════════════════
# /api/session — game session tracking
# ═══════════════════════════════════════════════════
@app.post("/api/session/start")
async def session_start(data: SessionStart, request: Request):
    """Record the start of a game session."""
    visitor_id = request.headers.get("x-visitor-id", "anonymous")

    if _sb_ok:
        try:
            rows = _sb_insert("game_sessions", {
                "visitor_id": visitor_id,
                "game_mode": data.game_mode or "single_player",
                "started_at": datetime.now(timezone.utc).isoformat(),
            })
            session_id = rows[0]["id"] if rows else None
            return {"success": True, "session_id": str(session_id)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    return {"success": False, "error": "Database unavailable"}


@app.post("/api/session/end")
async def session_end(data: SessionEnd):
    """Record the end of a game session."""
    if _sb_ok:
        try:
            _sb_update("game_sessions", {
                "ended_at": datetime.now(timezone.utc).isoformat(),
                "turns_played": data.turns_played,
                "outcome": data.outcome,
            }, f"id=eq.{quote(data.session_id)}")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    return {"success": False, "error": "Database unavailable"}


# ═══════════════════════════════════════════════════
# /api/feedback — in-game feedback with AI categorization
# ═══════════════════════════════════════════════════
@app.post("/api/feedback")
async def submit_feedback(data: FeedbackMessage, request: Request):
    """Accept player feedback, categorize with AI, store in Supabase."""
    msg = data.message.strip()
    if not msg or len(msg) < 3:
        return {"success": False, "error": "Feedback message too short"}

    visitor_id = data.visitor_id or request.headers.get("x-visitor-id", "anonymous")
    is_admin = bool(ADMIN_SECRET and data.admin_secret and data.admin_secret == ADMIN_SECRET)

    # ── Rate limit (in-memory) ──
    now = time.time()
    _feedback_rate[visitor_id] = [t for t in _feedback_rate[visitor_id] if now - t < 3600]
    recent_minute = sum(1 for t in _feedback_rate[visitor_id] if now - t < 60)
    if recent_minute >= _FEEDBACK_RATE_PER_MIN:
        return {
            "success": True,
            "response": "You're sending feedback quite fast — please wait a minute before submitting again.",
            "category": None,
        }
    if len(_feedback_rate[visitor_id]) >= _FEEDBACK_RATE_PER_HOUR:
        return {
            "success": True,
            "response": "Thanks for all your feedback! You've reached the hourly limit. Please try again later.",
            "category": None,
        }
    _feedback_rate[visitor_id].append(now)

    # Truncate message before sending to Claude (controls token cost)
    ai_msg = msg[:_FEEDBACK_MSG_MAX_CHARS]

    # Use Claude to categorize and respond
    category = "other"
    priority = "medium"
    summary = msg[:100]
    ai_response = "Thanks for your feedback! We've logged it and our team will review it."

    try:
        classify_result = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=300,
            system="You are a game feedback assistant for Uncivilized, a 4X strategy game. Categorize player feedback and respond warmly.",
            messages=[{
                "role": "user",
                "content": f"""Categorize this player feedback and respond to them.

Feedback: "{ai_msg}"

Respond with EXACTLY this JSON format (no other text):
{{
  "category": "<one of: bug_report, feature_request, gameplay_feedback, question, other>",
  "priority": "<one of: critical, high, medium, low>",
  "summary": "<one sentence summary>",
  "response": "<friendly 1-2 sentence response acknowledging their feedback. Mention that detailed bug reports and feature requests are eligible for our bounty program.>"
}}"""
            }],
        )
        raw = classify_result.content[0].text.strip()
        # Extract JSON from response
        json_match = re.search(r'\{[^}]+\}', raw, re.DOTALL)
        if json_match:
            parsed = json.loads(json_match.group())
            category = parsed.get("category", "other")
            priority = parsed.get("priority", "medium")
            summary = parsed.get("summary", msg[:100])
            ai_response = parsed.get("response", ai_response)
    except Exception:
        pass  # Fall back to defaults

    # Store in Supabase
    feedback_id = None
    if _sb_ok:
        try:
            rows = _sb_insert("feedback", {
                "visitor_id": visitor_id,
                "player_name": data.player_name,
                "message": msg[:5000],
                "category": category,
                "priority": priority,
                "ai_summary": summary,
                "ai_response": ai_response,
                "game_state_snapshot": data.game_state,
                "status": "new",
                "is_admin": is_admin,
            })
            if rows:
                feedback_id = rows[0].get("id")
        except Exception:
            pass

    return {
        "success": True,
        "response": ai_response,
        "category": category,
        "id": str(feedback_id) if feedback_id else None,
    }


# ═══════════════════════════════════════════════════
# /api/db — server-side proxy for client DB operations
# Replaces direct Supabase anon key access from the browser
# ═══════════════════════════════════════════════════
# Allowlisted tables that the client can read/write via proxy
_DB_PROXY_READ = {'competitions', 'active_games', 'leaderboard', 'players', 'feedback'}
_DB_PROXY_WRITE = {'active_games', 'leaderboard', 'players'}


@app.api_route("/api/db/{path:path}", methods=["GET", "POST", "PATCH"])
async def db_proxy(path: str, request: Request):
    """Proxy DB requests server-side so anon key stays off the client."""
    if not _sb_ok:
        return {"error": "Database unavailable"}

    # Extract table name from the path (e.g., 'competitions?status=eq.active' -> 'competitions')
    table = path.split('?')[0].split('/')[0]

    # Validate against allowlist
    if request.method == "GET" and table not in _DB_PROXY_READ:
        return {"error": "Access denied"}, 403
    if request.method in ("POST", "PATCH") and table not in _DB_PROXY_WRITE:
        return {"error": "Access denied"}, 403

    try:
        query_string = request.url.query
        url = f"{_SB_REST}/{path}?{query_string}" if query_string else f"{_SB_REST}/{path}"
        headers = dict(_SB_HEADERS)
        # Forward Prefer header if present
        prefer = request.headers.get("prefer")
        if prefer:
            headers["Prefer"] = prefer

        if request.method == "GET":
            resp = httpx.get(url, headers=headers, timeout=10)
        elif request.method == "POST":
            body = await request.body()
            headers["Prefer"] = headers.get("Prefer", "return=representation")
            resp = httpx.post(url, headers=headers, content=body, timeout=10)
        elif request.method == "PATCH":
            body = await request.body()
            resp = httpx.patch(url, headers=headers, content=body, timeout=10)
        else:
            return {"error": "Method not allowed"}, 405

        # Return the Supabase response
        from fastapi.responses import Response
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers={"Content-Type": resp.headers.get("content-type", "application/json")},
        )
    except Exception as e:
        return {"error": str(e)}


# ═══════════════════════════════════════════════════
# /api/admin/resend-missed-emails — admin utility
# ═══════════════════════════════════════════════════
@app.get("/api/admin/resend-missed-emails")
async def resend_missed_emails(secret: str = "", limit: int = 25, offset: int = 0, type: str = "all"):
    """Resend access/waitlist emails to users who didn't receive them.

    Query params:
        secret: must match ADMIN_SECRET environment variable
        limit:  max emails to send per call (default 25, keeps within 30s timeout)
        offset: skip first N unverified players (for pagination)
        type:   "active", "waitlisted", or "all" (default "all")

    Call repeatedly with increasing offset to process all users in batches.
    """
    if not ADMIN_SECRET or secret != ADMIN_SECRET:
        return {"success": False, "error": "Invalid or missing admin secret"}

    if not _sb_ok:
        return {"success": False, "error": "Database unavailable"}

    # Clamp limit to prevent timeout
    limit = min(max(1, limit), 50)
    total_found = 0
    total_sent = 0
    errors = []
    remaining_active = 0
    remaining_waitlisted = 0

    try:
        budget = limit  # emails we can still send this call

        # Process active players who haven't verified
        if type in ("all", "active") and budget > 0:
            print("[ADMIN] Fetching unverified active players...")
            active_rows = _sb_select(
                "players",
                select="username,email,access_token,status",
                filters="status=eq.active&email_verified=eq.false",
                order="created_at.asc",
            )
            remaining_active = len(active_rows)

            print(f"[ADMIN] Found {len(active_rows)} unverified active players (offset={offset}, limit={budget})")
            batch = active_rows[offset:offset + budget] if type == "active" else active_rows[:budget]
            for row in batch:
                total_found += 1
                username = row.get("username", "")
                email = row.get("email", "")
                token = row.get("access_token", "")

                if not email or not _EMAIL_RE.match(email):
                    errors.append(f"Active player {username}: missing/invalid email")
                    continue

                try:
                    print(f"[ADMIN] Sending access email to {username} ({email})...")
                    _send_access_email(email, username, token)
                    total_sent += 1
                    budget -= 1
                except Exception as e:
                    errors.append(f"Active player {username}: {str(e)}")
                    print(f"[ADMIN] Error sending to {username}: {e}")

        # Process waitlisted players who haven't verified
        if type in ("all", "waitlisted") and budget > 0:
            print("[ADMIN] Fetching unverified waitlisted players...")
            waitlist_rows = _sb_select(
                "players",
                select="username,email,status",
                filters="status=eq.waitlisted&email_verified=eq.false",
                order="created_at.asc",
            )
            remaining_waitlisted = len(waitlist_rows)

            print(f"[ADMIN] Found {len(waitlist_rows)} unverified waitlisted players (budget={budget})")
            wl_offset = offset if type == "waitlisted" else 0
            batch = waitlist_rows[wl_offset:wl_offset + budget]
            for idx, row in enumerate(batch, start=wl_offset + 1):
                total_found += 1
                username = row.get("username", "")
                email = row.get("email", "")

                if not email or not _EMAIL_RE.match(email):
                    errors.append(f"Waitlisted player {username}: missing/invalid email")
                    continue

                try:
                    print(f"[ADMIN] Sending waitlist email to {username} ({email}), position #{idx}...")
                    _send_waitlisted_email(email, username, idx)
                    total_sent += 1
                    budget -= 1
                except Exception as e:
                    errors.append(f"Waitlisted player {username}: {str(e)}")
                    print(f"[ADMIN] Error sending to {username}: {e}")

        return {
            "success": True,
            "total_found": total_found,
            "total_sent": total_sent,
            "remaining_unverified_active": remaining_active,
            "remaining_unverified_waitlisted": remaining_waitlisted,
            "errors": errors if errors else None,
            "summary": f"Sent {total_sent}/{total_found} emails (batch limit={limit})"
        }

    except Exception as e:
        print(f"[ADMIN] Resend failed: {e}")
        return {"success": False, "error": str(e)}


# /api/admin/manage-player — lookup, create, or resend email for a player
# ═══════════════════════════════════════════════════
@app.get("/api/admin/manage-player")
async def admin_manage_player(
    secret: str = "",
    email: str = "",
    username: str = "",
    action: str = "lookup",
):
    """Lookup a player by email, optionally create them or resend their email.

    Query params:
        secret:   must match ADMIN_SECRET environment variable
        email:    player email to look up or create (required)
        username: username to assign if creating a new player
        action:   "lookup" (default), "create", or "resend"
    """
    if not ADMIN_SECRET or secret != ADMIN_SECRET:
        return {"success": False, "error": "Invalid or missing admin secret"}
    if not _sb_ok:
        return {"success": False, "error": "Database unavailable"}
    if not email or not _EMAIL_RE.match(email.strip().lower()):
        return {"success": False, "error": "Valid email required"}

    email = email.strip().lower()

    try:
        # Look up existing player by email
        rows = _sb_select(
            "players",
            select="id,username,username_lower,email,status,email_verified,access_token,created_at",
            filters=f"email=eq.{quote(email)}",
            limit=1,
        )
        player = rows[0] if rows else None

        if action == "lookup":
            if player:
                return {
                    "success": True,
                    "found": True,
                    "player": {
                        "username": player.get("username"),
                        "email": player.get("email"),
                        "status": player.get("status"),
                        "email_verified": player.get("email_verified"),
                        "created_at": player.get("created_at"),
                    },
                }
            return {"success": True, "found": False, "message": "No player with that email"}

        elif action == "resend":
            if not player:
                return {"success": False, "error": "No player with that email — use action=create to add them"}
            token = player.get("access_token", "")
            uname = player.get("username", "")
            status = player.get("status", "active")
            if status == "active":
                _send_access_email(email, uname, token)
            else:
                pos = _sb_count("players", filters="status=eq.waitlisted")
                _send_waitlisted_email(email, uname, pos)
            return {
                "success": True,
                "action": "resend",
                "status": status,
                "username": uname,
                "message": f"Re-sent {status} email to {email}",
            }

        elif action == "create":
            if player:
                return {
                    "success": False,
                    "error": f"Player already exists with username '{player.get('username')}' (status: {player.get('status')}). Use action=resend to re-send their email.",
                }
            if not username or len(username.strip()) < 3:
                return {"success": False, "error": "Username required (3+ chars) when creating a player"}

            username = username.strip()
            # Check username collision
            existing_name = _sb_select(
                "players", select="id",
                filters=f"username_lower=eq.{quote(username.lower())}",
                limit=1,
            )
            if existing_name:
                return {"success": False, "error": f"Username '{username}' already taken"}

            import uuid
            token = str(uuid.uuid4())
            _sb_insert("players", {
                "username": username,
                "username_lower": username.lower(),
                "email": email,
                "games_played": 0,
                "best_score": 0,
                "total_score": 0,
                "status": "active",
                "access_token": token,
                "email_verified": False,
            })
            _send_access_email(email, username, token)
            return {
                "success": True,
                "action": "created",
                "username": username,
                "status": "active",
                "message": f"Created player '{username}' and sent access email to {email}",
            }

        else:
            return {"success": False, "error": f"Unknown action '{action}'. Use: lookup, create, or resend"}

    except Exception as e:
        print(f"[ADMIN] manage-player error: {e}")
        return {"success": False, "error": str(e)}


# /api/admin/analytics — game session & diplomacy analytics
# ═══════════════════════════════════════════════════
@app.get("/api/admin/analytics")
async def admin_analytics(secret: str = "", hours: int = 24):
    """Return analytics summary for the last N hours (default 24).

    Query params:
        secret: must match ADMIN_SECRET environment variable
        hours:  lookback window in hours (default 24, max 168 = 7 days)
    """
    if not ADMIN_SECRET or secret != ADMIN_SECRET:
        return {"success": False, "error": "Invalid or missing admin secret"}
    if not _sb_ok:
        return {"success": False, "error": "Database unavailable"}

    hours = min(max(1, hours), 168)
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    since_iso = since.isoformat()

    result: dict = {"success": True, "window_hours": hours, "since": since_iso}

    # ── Game Sessions ──
    try:
        sessions = _sb_select(
            "game_sessions",
            select="id,visitor_id,game_mode,started_at,ended_at,turns_played,outcome",
            filters=f"started_at=gte.{since_iso}",
            order="started_at.desc",
        )
        total = len(sessions)
        completed = [s for s in sessions if s.get("ended_at")]
        in_progress = total - len(completed)

        durations = []
        for s in completed:
            try:
                start = datetime.fromisoformat(s["started_at"].replace("Z", "+00:00"))
                end = datetime.fromisoformat(s["ended_at"].replace("Z", "+00:00"))
                durations.append((end - start).total_seconds())
            except Exception:
                pass

        outcomes = {}
        for s in completed:
            o = s.get("outcome") or "unknown"
            outcomes[o] = outcomes.get(o, 0) + 1

        unique_players = len(set(s.get("visitor_id", "") for s in sessions))

        avg_duration = sum(durations) / len(durations) if durations else 0
        median_duration = sorted(durations)[len(durations) // 2] if durations else 0
        max_duration = max(durations) if durations else 0
        min_duration = min(durations) if durations else 0

        avg_turns = 0
        turns_list = [s.get("turns_played", 0) for s in completed if s.get("turns_played")]
        if turns_list:
            avg_turns = sum(turns_list) / len(turns_list)

        result["sessions"] = {
            "total": total,
            "completed": len(completed),
            "in_progress": in_progress,
            "unique_players": unique_players,
            "outcomes": outcomes,
            "avg_turns_played": round(avg_turns, 1),
            "duration_seconds": {
                "avg": round(avg_duration),
                "median": round(median_duration),
                "min": round(min_duration),
                "max": round(max_duration),
            },
            "duration_human": {
                "avg": f"{int(avg_duration // 60)}m {int(avg_duration % 60)}s",
                "median": f"{int(median_duration // 60)}m {int(median_duration % 60)}s",
                "min": f"{int(min_duration // 60)}m {int(min_duration % 60)}s",
                "max": f"{int(max_duration // 60)}m {int(max_duration % 60)}s",
            },
        }
    except Exception as e:
        result["sessions"] = {"error": str(e)}

    # ── Feedback ──
    try:
        feedback = _sb_select(
            "feedback",
            select="id,visitor_id,category,priority,message,ai_summary,created_at",
            filters=f"created_at=gte.{since_iso}",
            order="created_at.desc",
        )
        categories = {}
        priorities = {}
        for f in feedback:
            cat = f.get("category") or "uncategorized"
            pri = f.get("priority") or "unknown"
            categories[cat] = categories.get(cat, 0) + 1
            priorities[pri] = priorities.get(pri, 0) + 1

        feedback_items = [
            {
                "category": f.get("category"),
                "priority": f.get("priority"),
                "summary": f.get("ai_summary") or (f.get("message") or "")[:120],
                "created_at": f.get("created_at"),
            }
            for f in feedback
        ]

        result["feedback"] = {
            "total": len(feedback),
            "by_category": categories,
            "by_priority": priorities,
            "items": feedback_items,
        }
    except Exception as e:
        result["feedback"] = {"error": str(e)}

    # ── Diplomacy Interactions ──
    try:
        diplo = _sb_select(
            "diplomacy_interactions",
            select="id,visitor_id,character_id,player_message,ai_reply,action_type,action_data,turn,created_at",
            filters=f"created_at=gte.{since_iso}",
            order="created_at.desc",
        )
        by_character: dict[str, dict] = {}
        by_action: dict[str, int] = {}
        unique_diplo_players = set()
        total_player_chars = 0
        total_ai_chars = 0

        for d in diplo:
            cid = d.get("character_id") or "unknown"
            char_name = CHARACTER_PROFILES.get(cid, {}).get("name", cid)

            if cid not in by_character:
                by_character[cid] = {
                    "name": char_name,
                    "interactions": 0,
                    "unique_players": set(),
                    "actions": {},
                }
            by_character[cid]["interactions"] += 1
            by_character[cid]["unique_players"].add(d.get("visitor_id", ""))

            action = d.get("action_type") or "none"
            by_action[action] = by_action.get(action, 0) + 1
            by_character[cid]["actions"][action] = by_character[cid]["actions"].get(action, 0) + 1

            unique_diplo_players.add(d.get("visitor_id", ""))
            total_player_chars += len(d.get("player_message") or "")
            total_ai_chars += len(d.get("ai_reply") or "")

        # Convert sets to counts for JSON serialization
        character_summary = {}
        for cid, info in sorted(by_character.items(), key=lambda x: x[1]["interactions"], reverse=True):
            character_summary[cid] = {
                "name": info["name"],
                "interactions": info["interactions"],
                "unique_players": len(info["unique_players"]),
                "actions": info["actions"],
            }

        result["diplomacy"] = {
            "total_interactions": len(diplo),
            "unique_players": len(unique_diplo_players),
            "avg_player_message_length": round(total_player_chars / len(diplo)) if diplo else 0,
            "avg_ai_reply_length": round(total_ai_chars / len(diplo)) if diplo else 0,
            "by_character": character_summary,
            "by_action_type": dict(sorted(by_action.items(), key=lambda x: x[1], reverse=True)),
        }
    except Exception as e:
        result["diplomacy"] = {"error": str(e)}

    return result


# /api/health — health check
# ═══════════════════════════════════════════════════
@app.get("/api/health")
async def health_check():
    """Health check endpoint. Tests Supabase connectivity."""
    status = {"status": "ok", "supabase": "disconnected", "version": GAME_VERSION}

    if _sb_ok:
        try:
            _sb_select("players", select="id", limit=1)
            status["supabase"] = "connected"
        except Exception as e:
            status["supabase"] = f"error: {e}"

    return status
