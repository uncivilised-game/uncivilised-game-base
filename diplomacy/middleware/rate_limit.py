"""Rate limiting middleware for diplomacy endpoints.

Enforces two limits per the briefing:
  - 5 messages per minute per player
  - 200 messages per game session

Uses Redis when available, falls back to in-memory tracking.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from typing import Any

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from diplomacy.config import settings
from diplomacy.db.redis import redis_client

logger = logging.getLogger("diplomacy.rate_limit")

# In-memory fallback rate limit tracking
_minute_buckets: dict[str, list[float]] = defaultdict(list)
_game_counters: dict[str, int] = defaultdict(int)


async def _check_redis_rate_limit(player_id: str, session_id: str) -> tuple[bool, str]:
    """Check rate limits using Redis. Returns (allowed, reason)."""
    now = int(time.time())
    minute_key = f"diplomacy:rl:min:{player_id}:{now // 60}"
    game_key = f"diplomacy:rl:game:{session_id}"

    # Check per-minute limit
    count = await redis_client.incr(minute_key)
    if count == 1:
        await redis_client.expire(minute_key, 60)
    if count > settings.rate_limit_per_minute:
        return False, f"Rate limit exceeded: {settings.rate_limit_per_minute} messages per minute"

    # Check per-game limit
    game_count = await redis_client.incr(game_key)
    if game_count == 1:
        await redis_client.expire(game_key, 7200)  # 2h game session
    if game_count > settings.rate_limit_per_game:
        return False, f"Game message limit exceeded: {settings.rate_limit_per_game} messages per game"

    return True, ""


def _check_memory_rate_limit(player_id: str, session_id: str) -> tuple[bool, str]:
    """Check rate limits using in-memory tracking. Returns (allowed, reason)."""
    now = time.time()

    # Clean old entries from minute bucket
    cutoff = now - 60
    _minute_buckets[player_id] = [
        t for t in _minute_buckets[player_id] if t > cutoff
    ]

    # Per-minute check
    if len(_minute_buckets[player_id]) >= settings.rate_limit_per_minute:
        return False, f"Rate limit exceeded: {settings.rate_limit_per_minute} messages per minute"

    # Per-game check
    if _game_counters[session_id] >= settings.rate_limit_per_game:
        return False, f"Game message limit exceeded: {settings.rate_limit_per_game} messages per game"

    # Record this request
    _minute_buckets[player_id].append(now)
    _game_counters[session_id] += 1

    return True, ""


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Enforce rate limits on /api/diplomacy/chat."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Only rate-limit the chat endpoint
        if request.url.path != "/api/diplomacy/chat":
            return await call_next(request)
        if request.method != "POST":
            return await call_next(request)

        player_id = getattr(request.state, "player_id", "anonymous")
        session_id = getattr(request.state, "session_id", "no-session")

        # Use Redis if available, else in-memory
        if redis_client.is_connected:
            allowed, reason = await _check_redis_rate_limit(player_id, session_id)
        else:
            allowed, reason = _check_memory_rate_limit(player_id, session_id)

        if not allowed:
            logger.info(f"Rate limited: player={player_id} reason={reason}")
            return JSONResponse(
                status_code=429,
                content={
                    "error": "rate_limit_exceeded",
                    "message": reason,
                    "retry_after": 60,
                },
            )

        return await call_next(request)
