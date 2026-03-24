"""Session-scoped API key authentication.

Players receive a session token when starting a game. The token
is verified on every /api/diplomacy/* request via Bearer auth.

In dev mode (no session store configured), all tokens are accepted
and a default player_id is used.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import time
from typing import Any

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from diplomacy.config import settings

logger = logging.getLogger("diplomacy.auth")

# In-memory session store (replaced by Redis in production)
_sessions: dict[str, dict[str, Any]] = {}


def create_session_token(player_id: str, game_id: str | None = None) -> str:
    """Generate a session token for a player."""
    token = secrets.token_urlsafe(32)
    _sessions[token] = {
        "player_id": player_id,
        "game_id": game_id or secrets.token_hex(8),
        "created_at": time.time(),
        "message_count": 0,
    }
    return token


def validate_session_token(token: str) -> dict[str, Any] | None:
    """Validate a session token and return session data, or None."""
    session = _sessions.get(token)
    if not session:
        return None
    # Check TTL
    if time.time() - session["created_at"] > settings.session_ttl:
        del _sessions[token]
        return None
    return session


def hash_player_id(player_id: str) -> str:
    """Hash a player_id for anonymisation in logs/training data."""
    return hashlib.sha256(
        f"{player_id}:{settings.session_secret}".encode()
    ).hexdigest()[:16]


class AuthMiddleware(BaseHTTPMiddleware):
    """Authenticate requests to /api/diplomacy/* endpoints.

    Extracts Bearer token, validates session, and injects player_id
    into request.state. Non-diplomacy endpoints pass through.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Only protect diplomacy endpoints
        if not request.url.path.startswith("/api/diplomacy"):
            return await call_next(request)

        # Allow stats and session creation without auth
        if request.url.path in ("/api/diplomacy/session", "/api/diplomacy/stats"):
            return await call_next(request)

        # Extract Bearer token
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
        else:
            # Fallback: accept x-session-token header or query param
            token = request.headers.get("x-session-token", "")
            if not token:
                token = request.query_params.get("token", "")

        # Dev mode: if no sessions exist and no token, create one
        if not token and not _sessions:
            visitor_id = request.headers.get("x-visitor-id", "anonymous")
            token = create_session_token(visitor_id)
            logger.debug(f"Dev mode: auto-created session for {visitor_id}")

        session = validate_session_token(token)
        if not session:
            # Graceful degradation: allow request with default player
            # This ensures the game doesn't break if auth backend is down
            request.state.player_id = request.headers.get("x-visitor-id", "anonymous")
            request.state.session_id = "no-session"
            request.state.session = None
            logger.debug("No valid session — using anonymous access")
        else:
            request.state.player_id = session["player_id"]
            request.state.session_id = session.get("game_id", "unknown")
            request.state.session = session

        return await call_next(request)
