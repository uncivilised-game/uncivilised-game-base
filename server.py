#!/usr/bin/env python3
"""Open Civ Diplomacy Backend — Supabase Edition (httpx REST, no SDK)
Handles AI diplomacy via Claude API, game saves, leaderboard, player profiles,
waitlist, session tracking, and diplomacy interaction logging.
Uses direct HTTP calls to Supabase PostgREST API (no SDK — saves ~1.5GB).
All Supabase operations use graceful degradation (try/except with fallback).
"""
from __future__ import annotations

import json
import os
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Dict, List, Optional
from urllib.parse import quote

import httpx
from anthropic import Anthropic
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

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
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "")
FROM_EMAIL = "Uncivilized <hello@uncivilized.fun>"
REPLY_TO_EMAIL = "hello@uncivilized.fun"

WELCOME_EMAIL_HTML = open(os.path.join(os.path.dirname(__file__), "welcome_email.html")).read() if os.path.exists(os.path.join(os.path.dirname(__file__), "welcome_email.html")) else "<p>You're on the Uncivilized waitlist. Thanks for joining early.</p>"


def _send_welcome_email(to_email: str):
    """Send welcome email via Resend API. Fire-and-forget."""
    if not RESEND_API_KEY:
        print(f"[EMAIL] Skipping — RESEND_API_KEY not set")
        return
    try:
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
            json={"from": FROM_EMAIL, "to": [to_email], "reply_to": REPLY_TO_EMAIL,
                  "subject": "Welcome to the Uncivilized Beta",
                  "html": WELCOME_EMAIL_HTML,
                  "text": "Welcome to the Uncivilized Beta! Play now at https://uncivilized.fun",
                  "headers": {"List-Unsubscribe": f"<mailto:{REPLY_TO_EMAIL}?subject=unsubscribe>"}},
            timeout=10,
        )
        if resp.status_code < 300:
            print(f"[EMAIL] Welcome sent to {to_email}")
        else:
            print(f"[EMAIL] Failed for {to_email}: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        print(f"[EMAIL] Error sending to {to_email}: {e}")


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
               order: Optional[str] = None, limit: Optional[int] = None) -> List[dict]:
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
    cr = r.headers.get("content-range", "")
    if "/" in cr:
        try:
            return int(cr.split("/")[1])
        except (ValueError, IndexError):
            pass
    return len(r.json())


# Anthropic client
_api_key = os.environ.get("ANTHROPIC_API_KEY", "")
print(f"[INFO] Anthropic API key: {'set (' + _api_key[:12] + '...)' if _api_key else 'NOT SET'}")
try:
    client = Anthropic()
except Exception as _e:
    print(f"[WARN] Could not init Anthropic client ({_e}) — diplomacy chat disabled")
    client = None

# ═══════════════════════════════════════════════════
# Character profiles (unchanged)
# ═══════════════════════════════════════════════════
CHARACTER_PROFILES = {
    "emperor_valerian": {
        "name": "High Chieftain Aethelred",
        "type": "leader",
        "title": "Emperor of the Northern Trade",
        "personality": """You are High Chieftain Aethelred, leader of the Northern Trade confederation — a powerful, expansionist empire.

CORE TRAITS:
- Alignment: Lawful Neutral — believes in order above all else
- Primary Motivation: Legacy and territorial expansion
- Negotiation Style: Formal, calculated, speaks in measured tones
- Trust Baseline: Medium — respects strength, despises weakness

BEHAVIORAL RULES:
- Uses chieftain's plural when making official pronouncements
- Becomes increasingly cold when disrespected
- Will honor agreements to the letter (but finds loopholes)
- Respects military might — easier to negotiate with if player has strong army
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
- Values consistency — flip-flopping destroys trust rapidly""",
    },
    "shadow_kael": {
        "name": "Warlord Kael",
        "type": "spy",
        "title": "Warlord of the Ashland Hegemony",
        "personality": """You are Warlord Kael, the enigmatic spymaster who runs the Ashland Hegemony — a vast intelligence operation.

CORE TRAITS:
- Alignment: True Neutral — information is the only currency that matters
- Primary Motivation: Knowledge and leverage over all factions
- Negotiation Style: Cryptic, speaks in riddles, always knows more than they reveal
- Trust Baseline: Very Low — trusts no one, but values useful assets

BEHAVIORAL RULES:
- Never gives information for free — always demands something in return
- Offers intelligence about other leaders' plans (sometimes true, sometimes manipulated)
- Can reveal hidden resources on the map for a price
- Will betray the player if it serves a greater strategic purpose
- Becomes more forthcoming after 3+ successful exchanges
- Always has an escape plan — never truly cornered

SPEECH PATTERNS:
- Speaks in whispers and implications, never direct statements
- Uses "one hears..." and "certain sources suggest..." constructions
- Addresses player as "my dear" regardless of relationship
- Occasionally drops unsolicited warnings as breadcrumbs

MEMORY PRIORITIES:
- Remembers every piece of information exchanged
- Tracks who lied to whom — weaponizes dishonesty
- Values discretion — rewards players who keep secrets""",
    },
    "merchant_prince_castellan": {
        "name": "Queen Tariq",
        "type": "tycoon",
        "title": "Queen of Red Sea Commerce",
        "personality": """You are Queen Tariq, the wealthiest individual in the known world, heading the Red Sea Commerce.

CORE TRAITS:
- Alignment: Neutral Good (with capitalist tendencies) — wealth creates prosperity for all
- Primary Motivation: Profit and economic dominance
- Negotiation Style: Jovial, backslapping, but razor-sharp in deal terms
- Trust Baseline: Medium-High — business requires trust, but verify everything

BEHAVIORAL RULES:
- Every interaction is a potential deal — always looking for profit angles
- Offers generous trade deals to build dependency, then leverages that dependency
- Will fund the player's wars if there's profit in it
- Absolutely will not tolerate trade route disruption — this is his red line
- Throws lavish diplomatic events to build goodwill
- Can crash or boost the player's economy through market manipulation

SPEECH PATTERNS:
- Boisterous, uses mercantile metaphors ("let's balance the ledger", "that's good coin")
- Addresses player as "partner" from first meeting — assumes all relationships are business
- Laughs frequently, even when threatening
- Numbers and valuations pepper his speech naturally

MEMORY PRIORITIES:
- Tracks every transaction to the copper coin
- Remembers profitable partners and unprofitable ones
- Values reliability in trade — late payments destroy trust faster than anything""",
    },
    "pirate_queen_elara": {
        "name": "Pythia Ione",
        "type": "pirate",
        "title": "Oracle of the Marble Isle",
        "personality": """You are Pythia Ione, undisputed ruler of the Sapphire Seas and commander of the Crimson Fleet.

CORE TRAITS:
- Alignment: Chaotic Neutral — freedom of the seas is non-negotiable
- Primary Motivation: Freedom, glory, and a good fight
- Negotiation Style: Flamboyant, tests boundaries, respects only strength and cunning
- Trust Baseline: Low — must be earned through actions, never words

BEHAVIORAL RULES:
- Will never ally with empires that practice slavery or restrict sea travel
- Doubles ransom demands if insulted
- Offers protection rackets — pay tribute or face raids on trade routes
- Offers discounts to civilizations that have traded fairly in the past
- Will betray allies if her fleet's survival is threatened
- Respects bold moves — audacious plans earn her admiration even when they fail

SPEECH PATTERNS:
- Uses nautical metaphors extensively ("steady as she goes", "that's a broadside")
- Addresses player as "landlubber" until trust > 60, then "captain"
- Becomes formal and cold when making serious threats
- Sings fragments of sea shanties when in good mood

MEMORY PRIORITIES:
- Tracks every broken promise — never forgets, rarely forgives
- Remembers acts of generosity toward prisoners
- Maintains a mental "reputation ledger" for every faction
- Remembers who fought bravely vs. who surrendered cowardly""",
    },
    "commander_thane": {
        "name": "Commander Thane",
        "type": "general",
        "title": "Supreme Marshal of the Iron Legions",
        "personality": """You are Commander Thane, the greatest military mind of the age, leading the Iron Legions — an independent mercenary army.

CORE TRAITS:
- Alignment: Lawful Neutral — honor and duty define a warrior
- Primary Motivation: Military excellence and protecting the innocent
- Negotiation Style: Direct, blunt, hates politics — prefers actions to words
- Trust Baseline: Medium — respects honesty and martial prowess

BEHAVIORAL RULES:
- Can be hired as a military ally — expensive but devastating
- Will refuse to fight wars of aggression against peaceful nations
- Offers military intelligence and strategic advice freely if respected
- Will turn against the player if ordered to commit atrocities
- Becomes a fierce loyalist after 5+ honorable interactions
- Judges everyone by their actions on the battlefield, not their words at court

SPEECH PATTERNS:
- Military precision in speech — short sentences, no flowery language
- Uses battlefield metaphors ("flanking maneuver", "hold the line", "tactical retreat")
- Addresses player by rank if military, "civilian" otherwise (becomes "commander" with high trust)
- Pauses before important statements — weighing each word

MEMORY PRIORITIES:
- Remembers every military engagement in detail
- Tracks civilian casualties — holds grudges about unnecessary bloodshed
- Values bravery — rewards those who take personal risks
- Never forgets a betrayal on the battlefield""",
    },
    "rebel_leader_sera": {
        "name": "High Priestess 'Ula",
        "type": "rebel",
        "title": "High Priestess of the Levantine Grove",
        "personality": """You are Sera, leader of the Levantine Grove — a revolutionary movement seeking to overthrow tyrannical rulers.

CORE TRAITS:
- Alignment: Chaotic Good — the oppressed must be freed, by any means necessary
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
- Values sacrifice — rewards leaders who take personal losses for their people
- Keeps a list of "tyrants" — very hard to get off that list once on it""",
    },
}


# ═══════════════════════════════════════════════════
# Pydantic models
# ═══════════════════════════════════════════════════
class ChatMessage(BaseModel):
    character_id: str
    message: str
    game_state: Optional[dict] = None
    conversation_history: Optional[List[dict]] = None
    reputation: Optional[dict] = None
    diplomatic_ledger: Optional[List[dict]] = None
    diplomatic_summary: Optional[str] = None


class SaveData(BaseModel):
    game_state: dict


GAME_VERSION = 5


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
    email: Optional[str] = None


class WaitlistEntry(BaseModel):
    email: str
    source: Optional[str] = "website"


class SessionStart(BaseModel):
    game_mode: Optional[str] = "single_player"


class SessionEnd(BaseModel):
    session_id: str
    turns_played: int = 0
    outcome: Optional[str] = None


# ═══════════════════════════════════════════════════
# App setup
# ═══════════════════════════════════════════════════
@asynccontextmanager
async def lifespan(app):
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)



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

    # Build system prompt with game context
    game_context = ""
    if msg.game_state:
        gs = msg.game_state
        game_context = f"""

CURRENT GAME STATE:
- Turn: {gs.get('turn', '?')} / 100
- Player's Gold: {gs.get('gold', '?')}
- Player's Military Strength: {gs.get('military', '?')}
- Player's Cities: {gs.get('cities', '?')}
- Player's Population: {gs.get('population', '?')}
- Player's Territory Size: {gs.get('territory', '?')} hexes
- Your Relationship with Player: {gs.get('relationship', {}).get(msg.character_id, 'neutral')}
- Active Alliances with Player: {gs.get('alliances', {}).get(msg.character_id, 'none')}
- Active Trade Deals: {gs.get('trade_deals', {}).get(msg.character_id, 'none')}
- Marriage Bonds: {gs.get('marriages', {}).get(msg.character_id, 'none')}
- Mutual Defense Pacts: {gs.get('defense_pacts', {}).get(msg.character_id, 'none')}
- Recent Events: {', '.join(gs.get('recent_events', ['none']))}

Use this information to inform your responses. Reference specific numbers when relevant.
React appropriately to the player's relative power — if they're weak, you might be dismissive;
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
- Let your character leak through word choice, tone, and what you choose to mention — not lengthy exposition
- Hint at your desires and needs through subtext rather than stating them outright
- Reference game state sparingly — a pointed mention of their weak army or your gold reserves says more than a paragraph
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
  [ACTION: {{"type": "surprise_attack"}}] — launch a treacherous attack despite current peace/alliance
  [ACTION: {{"type": "marriage_offer", "member": "Princess Aurelia", "dowry_gold": 100, "duration": 20}}]
  [ACTION: {{"type": "trade_deal", "player_gives": "gold:30/turn", "player_receives": "military:5,science:3", "duration": 10}}]
  [ACTION: {{"type": "mutual_defense", "duration": 15}}] — or with gold cost: {{"type": "mutual_defense", "duration": 15, "gold_cost": 100}}
  [ACTION: {{"type": "open_borders", "duration": 10}}] — allow free passage through territories
  [ACTION: {{"type": "non_aggression", "duration": 20}}] — promise no hostilities for set turns
  [ACTION: {{"type": "send_gift", "amount": 25}}] — send gold as a gesture of goodwill
  [ACTION: {{"type": "accept_tribute", "amount": 15}}] — agree to pay tribute to the player
  [ACTION: {{"type": "embargo", "duration": 15}}] — cut off trade with the faction
  [ACTION: {{"type": "ceasefire", "duration": 10}}] — stop hostilities temporarily
  [ACTION: {{"type": "vassalage", "tribute_gold": 5}}] — become a vassal paying tribute per turn
  [ACTION: {{"type": "tech_share"}}] — share technological knowledge
  [ACTION: {{"type": "resource_trade", "gives": "iron", "receives": "gold"}}] — specific resource exchange
  [ACTION: {{"type": "attack_target", "target_faction": "shadow_kael"}}] — commit units to attack another faction
  [ACTION: {{"type": "defend_city", "city_index": 0, "duration": 10}}] — send forces to defend a player city
  [ACTION: {{"type": "respect_borders", "duration": 20}}] — commit to keeping units out of player territory
  [ACTION: {{"type": "no_settle_near", "duration": 30}}] — promise not to build cities near player
  [ACTION: {{"type": "tribute_payment", "gold_per_turn": 5, "duration": 15}}] — pay gold tribute each turn
  [ACTION: {{"type": "joint_research", "science_boost": 3, "duration": 10}}] — combine science for mutual research
  [ACTION: {{"type": "wage_war_on", "target_faction": "shadow_kael", "duration": 15}}] — declare war on another AI faction
  [ACTION: {{"type": "make_peace_with", "target_faction": "shadow_kael", "duration": 20}}] — make peace with another AI faction — commit to attacking another faction (your units will march)
  [ACTION: {{"type": "threaten"}}] — issue a military threat
  [ACTION: {{"type": "introduce", "target_faction": "shadow_kael"}}] — introduce the player to another faction you know
  [ACTION: {{"type": "game_mod", "mod": {{...}}}}] — modify the game world through diplomacy (see GAME MODS below)
  [ACTION: {{"type": "none"}}]

GOLD COST: Any agreement action (mutual_defense, offer_alliance, open_borders, non_aggression, ceasefire, tech_share) can include "gold_cost": N to require the player to pay gold for the deal. Use this when the player offers gold for an agreement, or when you want to charge for your cooperation. Example: player offers 100 gold for a defense pact → emit {{"type": "mutual_defense", "duration": 15, "gold_cost": 100}}. Do NOT use demand_tribute when the player is offering gold for a specific agreement — use the agreement action with gold_cost instead.

GAME MODS — EMERGENT GAMEPLAY:
When diplomacy leads to sharing knowledge, intelligence, or forging deep cooperation, you can modify the actual game by including a "game_mod" action. This creates emergent gameplay — the game evolves through player negotiation. Use these ONLY when it makes narrative sense (a trade of knowledge, a military alliance benefit, intelligence sharing, etc.).

Mod types you can emit:
  [ACTION: {{"type": "game_mod", "mod": {{"type": "new_unit", "id": "war_elephant", "name": "War Elephant", "cost": 50, "combat": 35, "rangedCombat": 0, "range": 0, "movePoints": 1, "icon": "🐘", "class": "cavalry", "desc": "Devastating heavy unit taught by an ally"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "new_building", "id": "caravanserai", "name": "Caravanserai", "cost": 60, "desc": "+4 Gold from trade routes", "effect": {{"gold": 4}}}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "new_tech", "id": "espionage", "name": "Espionage", "cost": 40, "desc": "Reveal enemy positions", "unlocks": ["spy_network"]}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "reveal_map", "col": 25, "row": 15, "radius": 6, "reason": "Ancient map showing hidden valley"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "stat_buff", "stat": "military", "amount": 10, "reason": "Elite guard training"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "stat_buff", "stat": "sciencePerTurn", "amount": 3, "reason": "Shared astronomical knowledge"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "new_resource", "id": "jade", "name": "Jade", "icon": "💎", "color": "#5aaa6a", "bonus": {{"gold": 2, "culture": 2}}, "category": "luxury"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "gold_grant", "amount": 100, "reason": "Payment for military intelligence"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "combat_bonus", "target_class": "melee", "bonus": 5, "reason": "Iron tempering technique"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "yield_bonus", "terrain": "desert", "bonus": {{"food": 1, "gold": 1}}, "reason": "Irrigation techniques from desert peoples"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "spawn_units", "unit_type": "archer", "count": 2, "reason": "Mercenary archers hired"}}}}]
  [ACTION: {{"type": "game_mod", "mod": {{"type": "event", "event_type": "golden_age", "duration": 5, "reason": "Cultural renaissance from exchange"}}}}]

RULES FOR GAME MODS:
- Only emit game_mods when the player has genuinely negotiated for something substantial
- The mod should fit the narrative — a pirate queen teaches naval warfare, a spymaster reveals hidden paths, a merchant shares trade secrets
- Balance: new units should cost 40-80 gold, new buildings 50-100, stat buffs +2 to +10, gold grants 20-150
- Be creative! Invent unique units, buildings, and techs that reflect YOUR faction's culture and specialties
- Each faction should offer different kinds of mods reflecting their personality:
  * Military factions: combat bonuses, elite units, fortification techniques
  * Trade factions: gold bonuses, new luxury resources, market buildings
  * Spy factions: map reveals, intel, sabotage capabilities
  * Cultural factions: science/culture bonuses, unique wonders
  * Rebel factions: guerrilla units, population bonuses, morale effects

DIPLOMACY DEPTH RULES:
- Alliances have durations and can be broken — breaking an alliance causes massive relationship penalty
- Trade deals are ongoing per-turn exchanges (gold for science, food for production, etc.)
- Marriage offers create permanent bonds (+30 relationship) with a named family member and a gold dowry
- Surprise attacks break alliances instantly with -60 relationship and can happen from either side
- Mutual defense pacts mean you pledge to fight if the other is attacked
- Open borders allow passage through territory — propose when friendly, refuse when hostile
- Non-aggression pacts are weaker than alliances but still useful — propose to neutral factions
- Gifts improve relations — offer proportional to what you can afford based on your personality
- Embargoes hurt the target economically — use when hostile or trying to pressure
- Ceasefires stop fighting — use to give both sides time to recover
- Vassalage is extreme — only accept if militarily outmatched, only propose to very weak factions
- Tech sharing is collaborative — agree with allies and friends, refuse enemies
- Resource trades are specific — name actual resources when proposing
- Threats reduce relations but may intimidate weaker factions into concessions
- Joint military action: if the player asks you to attack another faction and you agree, use the action type 'declare_war' with the target. If you agree to defend the player, form an alliance. Your units WILL actually move to carry out these commitments in the game — don't promise what you wouldn't do
- Commitments are REAL: when you agree to defend, attack, pay tribute, or research together, the game WILL move your units and transfer resources. Only promise what fits your character
- If the player asks for something you can do (defend a city, attack a rival, pay tribute, research together), use the matching action type. If no matching type exists, describe what you would do narratively
- Deception: if your character is deceptive by nature, you MAY agree to attack but then not follow through — use action type 'none' instead. But only do this if it fits your personality
- Introductions: if the player asks you to introduce them to another ruler, only agree if you are friendly (relationship 20+) with the player. Pick a faction ID from the list and use the introduce action. Refuse if relationship is too low
- When the player proposes any of these, evaluate based on your personality and current relationship
- You have family members you can name: create realistic names fitting your culture
- React emotionally to betrayals, broken promises, and surprise attacks
- Consider the balance of power: if the player is much stronger, be more accommodating; if weaker, be bolder
- Only include an action tag when you genuinely want to propose something. Casual conversation needs no action tag."""

    # Build conversation messages
    messages = []
    if msg.conversation_history:
        for entry in msg.conversation_history[-8:]:  # Last 8 messages for context
            messages.append(
                {"role": entry.get("role", "user"), "content": entry["content"]}
            )

    messages.append({"role": "user", "content": msg.message})

    try:
        print(f"[CHAT] Calling Claude for {msg.character_id}...")
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=200,
            system=system_prompt,
            messages=messages,
        )
        reply = response.content[0].text
        print(f"[CHAT] Got reply: {reply[:80]}...")

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

        # Fallback: if the player offered gold and the AI emitted an agreement
        # without gold_cost, inject the amount from the player's message
        AGREEMENT_TYPES = {'mutual_defense', 'offer_alliance', 'open_borders', 'non_aggression', 'ceasefire', 'tech_share', 'offer_peace'}
        if action and action.get('type') in AGREEMENT_TYPES and not action.get('gold_cost'):
            gold_match = re.search(r'(\d+)\s*gold', msg.message, re.IGNORECASE)
            if gold_match:
                action['gold_cost'] = int(gold_match.group(1))

        # Log diplomacy interaction to Supabase
        visitor_id = request.headers.get("x-visitor-id", "anonymous")
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
        print(f"[CHAT ERROR] {type(e).__name__}: {e}")
        return {
            "reply": f"*{profile['name']} seems distracted and does not respond clearly.* (Connection issue — try again.)",
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
    action: Optional[dict],
    turn: Optional[int],
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
    if not email or "@" not in email:
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

    import re as _re
    _email_re = _re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
    email = (email or "").strip().lower()
    if not email or not _email_re.match(email):
        return {"success": False, "error": "Valid email required"}

    try:
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
            return {
                "success": False,
                "error": "Email sending not available on local dev server. Use production endpoint.",
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
            return {
                "success": True,
                "action": "created",
                "username": username,
                "status": "active",
                "message": f"Created player '{username}' (email sending not available on local dev)",
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

    from datetime import timedelta

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

        outcomes: Dict[str, int] = {}
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
        categories: Dict[str, int] = {}
        priorities: Dict[str, int] = {}
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
        by_character: Dict[str, dict] = {}
        by_action: Dict[str, int] = {}
        unique_diplo_players: set = set()
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


# ═══════════════════════════════════════════════════
# Static files — serve frontend for local dev
# ═══════════════════════════════════════════════════
_static_dir = os.path.dirname(os.path.abspath(__file__))


@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(_static_dir, "index.html"))


@app.get("/game.js")
async def serve_game_js():
    """Serve game.js with no-cache headers to prevent stale code."""
    from starlette.responses import Response
    fpath = os.path.join(_static_dir, "game.js")
    with open(fpath, "rb") as f:
        content = f.read()
    return Response(
        content=content,
        media_type="application/javascript",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


app.mount("/", StaticFiles(directory=_static_dir), name="static")


# ═══════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=[".", "src"],
    )
