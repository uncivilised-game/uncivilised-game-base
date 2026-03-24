"""Interaction logging service.

Logs every diplomacy interaction to the database (when available)
and maintains in-memory stats for the current session.
"""

from __future__ import annotations

import logging
from typing import Any

from diplomacy.db.supabase import db
from diplomacy.middleware.auth import hash_player_id

logger = logging.getLogger("diplomacy.logging")

# In-memory log buffer for when DB is unavailable
_log_buffer: list[dict] = []
MAX_BUFFER = 1000


async def log_interaction(
    player_id: str,
    faction_id: str,
    player_message: str,
    ai_response: str,
    game_state: dict | None = None,
    faction_state: dict | None = None,
    relationship_value: int = 0,
    model_used: str = "sonnet",
    cache_tier: str | None = None,
    latency_ms: int = 0,
    action_type: str | None = None,
    action_data: dict | None = None,
    session_id: str | None = None,
) -> str | None:
    """Log a diplomacy interaction. Returns interaction_id or None.

    Hashes the player_id for anonymisation before storing.
    Falls back to in-memory buffer if DB is unavailable.
    """
    hashed_pid = hash_player_id(player_id)

    # Try database
    interaction_id = await db.log_interaction(
        player_id=hashed_pid,
        faction_id=faction_id,
        player_message=player_message,
        ai_response=ai_response,
        game_state=game_state,
        faction_state=faction_state,
        relationship_value=relationship_value,
        model_used=model_used,
        cache_tier=cache_tier,
        latency_ms=latency_ms,
        action_type=action_type,
        action_data=action_data,
        session_id=session_id,
    )

    if interaction_id:
        return interaction_id

    # Fallback: buffer in memory
    import uuid
    fallback_id = str(uuid.uuid4())
    entry = {
        "id": fallback_id,
        "player_id": hashed_pid,
        "faction_id": faction_id,
        "player_message": player_message,
        "ai_response": ai_response,
        "model_used": model_used,
        "cache_tier": cache_tier,
        "latency_ms": latency_ms,
        "action_type": action_type,
        "session_id": session_id,
    }
    _log_buffer.append(entry)
    if len(_log_buffer) > MAX_BUFFER:
        _log_buffer.pop(0)

    logger.debug(f"Interaction buffered in memory: {fallback_id}")
    return fallback_id


def get_buffered_logs() -> list[dict]:
    """Return the in-memory log buffer (for debugging/export)."""
    return list(_log_buffer)
