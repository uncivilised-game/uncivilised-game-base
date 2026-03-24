"""Conversation threading — maintains last N messages per faction per player.

Per briefing: maintain last 5 messages per faction per player.
Uses Redis when available, falls back to in-memory storage.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from typing import Any

from diplomacy.db.redis import redis_client

logger = logging.getLogger("diplomacy.threading")

# In-memory fallback for conversation threads
# Structure: { "player_id:faction_id": [{"role": "user", "content": "..."}, ...] }
_threads: dict[str, list[dict]] = defaultdict(list)

MAX_THREAD_LENGTH = 5  # Last 5 messages per faction per player


def _thread_key(player_id: str, faction_id: str) -> str:
    return f"diplomacy:thread:{player_id}:{faction_id}"


async def get_thread(player_id: str, faction_id: str) -> list[dict]:
    """Retrieve the conversation thread for a player-faction pair.

    Returns up to MAX_THREAD_LENGTH most recent messages.
    """
    key = _thread_key(player_id, faction_id)

    # Try Redis first
    if redis_client.is_connected:
        data = await redis_client.get_json(key)
        if data and isinstance(data, list):
            return data[-MAX_THREAD_LENGTH:]

    # In-memory fallback
    return _threads.get(key, [])[-MAX_THREAD_LENGTH:]


async def append_to_thread(
    player_id: str,
    faction_id: str,
    player_message: str,
    ai_response: str,
) -> list[dict]:
    """Add a player message and AI response to the conversation thread.

    Keeps only the last MAX_THREAD_LENGTH exchanges.
    Returns the updated thread.
    """
    key = _thread_key(player_id, faction_id)

    # Get existing thread
    thread = await get_thread(player_id, faction_id)

    # Append new exchange
    thread.append({"role": "user", "content": player_message})
    thread.append({"role": "assistant", "content": ai_response})

    # Trim to last N messages (N = MAX_THREAD_LENGTH * 2, since each exchange = 2 messages)
    max_messages = MAX_THREAD_LENGTH * 2
    thread = thread[-max_messages:]

    # Store
    if redis_client.is_connected:
        await redis_client.set_json(key, thread, ttl=7200)  # 2h session TTL

    # Always keep in-memory copy as fallback
    _threads[key] = thread

    return thread


async def clear_thread(player_id: str, faction_id: str) -> None:
    """Clear the conversation thread for a player-faction pair."""
    key = _thread_key(player_id, faction_id)

    if redis_client.is_connected:
        await redis_client.delete(key)

    _threads.pop(key, None)


async def get_thread_for_prompt(player_id: str, faction_id: str) -> list[dict]:
    """Get the conversation thread formatted for the Claude API messages array.

    This is what gets passed as conversation_history to the model.
    """
    return await get_thread(player_id, faction_id)
