"""Diplomacy API routes.

POST /api/diplomacy/chat   — Main diplomacy conversation endpoint
POST /api/diplomacy/session — Create a new session token
GET  /api/diplomacy/stats  — Cache hit rate statistics
GET  /api/diplomacy/factions — List available factions
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Request

from diplomacy.models import DiplomacyChatRequest, CacheStatsResponse
from diplomacy.personalities import CHARACTER_PROFILES, INTERACTION_RULES
from diplomacy.services import cache, variation
from diplomacy.services.claude import generate_response
from diplomacy.services.context import compress_game_state
from diplomacy.services.deception import build_deception_section
from diplomacy.services.gossip import generate_gossip
from diplomacy.services.logging_service import log_interaction
from diplomacy.services.memory import build_memory_section
from diplomacy.services.mood import build_mood_section
from diplomacy.services.router import route_model, detect_first_contact
from diplomacy.services.threading import get_thread_for_prompt, append_to_thread
from diplomacy.middleware.auth import create_session_token

router = APIRouter(prefix="/api/diplomacy", tags=["diplomacy"])


def build_enhanced_system_prompt(
    faction_id: str,
    game_state: dict | None,
    conversation_thread: list[dict] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Build an enhanced system prompt composing all Phase 4 systems.

    Pipeline:
    Personality → Mood → Gossip → Memory → Deception → Game State → Rules

    Returns:
        Tuple of (system_prompt, metadata_dict).
        metadata_dict contains deception info and mood for logging.
    """
    profile = CHARACTER_PROFILES.get(faction_id)
    if not profile:
        return "", {}

    metadata: dict[str, Any] = {}

    # 1. Base personality (~100 lines)
    personality = profile["personality"]

    # 2. Mood directive
    mood_section = build_mood_section(faction_id, game_state)
    if mood_section:
        metadata["mood"] = mood_section.split("—")[1].split(":")[0].strip().lower() if "—" in mood_section else "unknown"

    # 3. Gossip / diplomatic intelligence
    gossip_section = generate_gossip(
        faction_id=faction_id,
        faction_type=profile["type"],
        game_state=game_state,
    )

    # 4. Memory from conversation thread
    memory_section = build_memory_section(conversation_thread or [])

    # 5. Deception check
    deception_section, deception_meta = build_deception_section(faction_id, game_state)
    metadata["deception"] = {
        "is_deceptive": deception_meta.get("is_deceptive", False),
        "deception_type": deception_meta.get("deception_type"),
    }

    # 6. Compressed game state
    game_context = ""
    if game_state:
        compressed = compress_game_state(game_state, faction_id)
        game_context = f"\n\nCURRENT SITUATION:\n{compressed}"

    # 7. Compose full prompt
    sections = [personality]
    if mood_section:
        sections.append(mood_section)
    if gossip_section:
        sections.append(gossip_section)
    if memory_section:
        sections.append(memory_section)
    if deception_section:
        sections.append(deception_section)
    if game_context:
        sections.append(game_context)
    sections.append(f"\n{INTERACTION_RULES}")

    return "\n".join(sections), metadata


@router.post("/chat")
async def diplomacy_chat(msg: DiplomacyChatRequest, request: Request):
    """Handle a diplomacy conversation message.

    Full request flow (Phase 4):
    Auth → Rate Limit → Thread Retrieval → Memory Extraction →
    Mood Computation → Gossip Generation → Deception Check →
    Build Enhanced System Prompt → Cache Lookup → Model Routing →
    Claude API → Response Variation → Thread Update → Log → Return
    """
    start_time = time.perf_counter()

    profile = CHARACTER_PROFILES.get(msg.faction_id)
    if not profile:
        return {"error": "Unknown faction", "valid_factions": list(CHARACTER_PROFILES.keys())}

    player_id = getattr(request.state, "player_id", "anonymous")
    session_id = getattr(request.state, "session_id", msg.session_id or "unknown")

    # Extract relationship value and turn from game state
    rel_value = 0
    turn = 0
    game_state_dict = None

    if msg.game_state:
        if isinstance(msg.game_state, dict):
            game_state_dict = msg.game_state
        else:
            game_state_dict = msg.game_state.model_dump()

        rel = game_state_dict.get("relationship", 0)
        if isinstance(rel, dict):
            rel_value = rel.get(msg.faction_id, 0)
        elif isinstance(rel, (int, float)):
            rel_value = int(rel)
        turn = game_state_dict.get("turn", 0)

    # ── Retrieve conversation thread ────────────────────────
    thread = await get_thread_for_prompt(player_id, msg.faction_id)

    # Merge with any client-supplied history (thread takes priority)
    conversation_history = thread if thread else (msg.conversation_history or [])

    # ── Build enhanced system prompt (Phase 4) ──────────────
    enhanced_prompt, phase4_meta = build_enhanced_system_prompt(
        faction_id=msg.faction_id,
        game_state=game_state_dict,
        conversation_thread=conversation_history,
    )

    # ── Try cache tiers ─────────────────────────────────────
    cached = await cache.cache_lookup(
        faction_id=msg.faction_id,
        message=msg.message,
        rel_value=rel_value,
        turn=turn,
        game_state=game_state_dict,
        player_id=player_id,
    )

    if cached:
        reply_text = variation.apply_variation(cached["reply"], game_state_dict)
        latency_ms = int((time.perf_counter() - start_time) * 1000)

        # Update conversation thread even for cache hits
        await append_to_thread(player_id, msg.faction_id, msg.message, reply_text)

        action = cached.get("action")
        action_type = action.get("type") if isinstance(action, dict) else None
        interaction_id = await log_interaction(
            player_id=player_id,
            faction_id=msg.faction_id,
            player_message=msg.message,
            ai_response=reply_text,
            game_state=game_state_dict,
            relationship_value=rel_value,
            model_used="cache",
            cache_tier=cached["cache_tier"],
            latency_ms=latency_ms,
            action_type=action_type,
            action_data=action if isinstance(action, dict) else None,
            session_id=session_id,
        )

        return {
            "response": reply_text,
            "reply": reply_text,
            "action": action,
            "interaction_id": interaction_id,
            "model": "cache",
            "cache_hit": True,
            "cache_tier": cached["cache_tier"],
            "character": profile["name"],
            "character_type": profile["type"],
        }

    # ── No cache hit — route to appropriate model ───────────
    is_first = detect_first_contact(
        msg.faction_id, game_state_dict, conversation_history
    )
    model, complexity, route_reason = route_model(
        message=msg.message,
        faction_id=msg.faction_id,
        game_state=game_state_dict,
        conversation_history=conversation_history,
        is_first_contact=is_first,
    )

    # Generate response with routed model, threaded history, and enhanced prompt
    result = await generate_response(
        faction_id=msg.faction_id,
        message=msg.message,
        game_state=game_state_dict,
        conversation_history=conversation_history,
        model=model,
        system_prompt=enhanced_prompt if enhanced_prompt else None,
    )

    latency_ms = int((time.perf_counter() - start_time) * 1000)
    reply_text = result.get("reply", "")
    action = result.get("action")
    action_type = action.get("type") if isinstance(action, dict) else None

    # Update conversation thread
    await append_to_thread(player_id, msg.faction_id, msg.message, reply_text)

    # Store in cache for future hits
    await cache.cache_store(
        faction_id=msg.faction_id,
        message=msg.message,
        rel_value=rel_value,
        turn=turn,
        response_text=reply_text,
        action=action,
    )

    # Log the interaction (include deception flag in metadata)
    is_deceptive = phase4_meta.get("deception", {}).get("is_deceptive", False)
    interaction_id = await log_interaction(
        player_id=player_id,
        faction_id=msg.faction_id,
        player_message=msg.message,
        ai_response=reply_text,
        game_state=game_state_dict,
        relationship_value=rel_value,
        model_used=model.split("-")[1] if "-" in model else model,
        cache_tier=None,
        latency_ms=latency_ms,
        action_type=action_type,
        action_data=action if isinstance(action, dict) else None,
        session_id=session_id,
    )

    return {
        "response": reply_text,
        "reply": reply_text,
        "action": action,
        "interaction_id": interaction_id,
        "model": model.split("-")[1] if "-" in model else model,
        "cache_hit": False,
        "cache_tier": None,
        "character": profile["name"],
        "character_type": profile["type"],
        "complexity": complexity,
        "route_reason": route_reason,
        "is_deceptive": is_deceptive,
    }


@router.post("/session")
async def create_session(request: Request):
    """Create a new session token for a player."""
    try:
        body = await request.json()
    except Exception:
        body = {}

    player_id = body.get("player_id") or request.headers.get("x-visitor-id", "anonymous")
    game_id = body.get("game_id")
    token = create_session_token(player_id, game_id)
    return {"token": token, "player_id": player_id, "expires_in": 7200}


@router.get("/stats")
async def cache_stats():
    """Return cache hit rate statistics."""
    return cache.get_stats()


@router.get("/factions")
async def list_factions():
    """List all available factions (diplomacy-aware version)."""
    return {
        fid: {"name": p["name"], "type": p["type"], "title": p["title"]}
        for fid, p in CHARACTER_PROFILES.items()
    }
