"""Supabase PostgreSQL client and schema management.

Uses asyncpg for async database operations. Falls back gracefully
when no database connection is available (dev/testing).
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("diplomacy.db")

# Optional asyncpg — graceful fallback if not installed or not configured
try:
    import asyncpg

    HAS_ASYNCPG = True
except ImportError:
    HAS_ASYNCPG = False


# ── SQL Schema ──────────────────────────────────────────────────

SCHEMA_SQL = """
-- Main interaction log
CREATE TABLE IF NOT EXISTS diplomacy_interactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id       TEXT NOT NULL,
    faction_id      TEXT NOT NULL,
    player_message  TEXT NOT NULL,
    ai_response     TEXT NOT NULL,
    game_state      JSONB,
    faction_state   JSONB,
    relationship_value INTEGER DEFAULT 0,
    model_used      TEXT DEFAULT 'sonnet',
    cache_tier      TEXT,              -- 'L1', 'L2', 'L3', or NULL (miss)
    latency_ms      INTEGER DEFAULT 0,
    action_type     TEXT,
    action_data     JSONB,
    outcome_data    JSONB,             -- retroactively populated
    session_id      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interactions_player
    ON diplomacy_interactions (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_faction
    ON diplomacy_interactions (faction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_session
    ON diplomacy_interactions (session_id);

-- L1 exact match cache entries (managed by Redis, logged here for analytics)
CREATE TABLE IF NOT EXISTS diplomacy_cache (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key       TEXT UNIQUE NOT NULL,
    faction_id      TEXT NOT NULL,
    response_variants JSONB NOT NULL,   -- array of response strings
    relationship_bucket TEXT NOT NULL,
    game_phase      TEXT NOT NULL,
    hit_count       INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cache_key ON diplomacy_cache (cache_key);

-- L3 pre-generated templates
CREATE TABLE IF NOT EXISTS diplomacy_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    faction_id      TEXT NOT NULL,
    category        TEXT NOT NULL,      -- 'first_contact', 'trade', 'war_peace', etc.
    template_text   TEXT NOT NULL,
    variables       JSONB,              -- list of placeholder variable names
    mood            TEXT DEFAULT 'neutral',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_templates_faction
    ON diplomacy_templates (faction_id, category);

-- Per-player per-faction conversation memory (session-scoped)
CREATE TABLE IF NOT EXISTS faction_memory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id       TEXT NOT NULL,
    faction_id      TEXT NOT NULL,
    session_id      TEXT NOT NULL,
    messages        JSONB NOT NULL DEFAULT '[]',
    summary         TEXT,
    relationship_value INTEGER DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (player_id, faction_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_player_faction
    ON faction_memory (player_id, faction_id, session_id);
"""


class SupabaseClient:
    """Async PostgreSQL client for the diplomacy module."""

    def __init__(self, db_url: str = ""):
        self._db_url = db_url
        self._pool: asyncpg.Pool | None = None
        self._connected = False

    async def connect(self) -> bool:
        """Establish connection pool. Returns False if unavailable."""
        if not HAS_ASYNCPG or not self._db_url:
            logger.warning("Database not configured — running without persistence")
            return False
        try:
            self._pool = await asyncpg.create_pool(self._db_url, min_size=1, max_size=5)
            self._connected = True
            logger.info("Connected to Supabase PostgreSQL")
            return True
        except Exception as e:
            logger.warning(f"Database connection failed: {e} — running without persistence")
            return False

    async def init_schema(self) -> None:
        """Create tables if they don't exist."""
        if not self._connected or not self._pool:
            return
        async with self._pool.acquire() as conn:
            await conn.execute(SCHEMA_SQL)
        logger.info("Database schema initialised")

    async def disconnect(self) -> None:
        if self._pool:
            await self._pool.close()
            self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    # ── Interaction logging ─────────────────────────────────────

    async def log_interaction(
        self,
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
        """Log a diplomacy interaction. Returns interaction_id or None."""
        if not self._connected or not self._pool:
            return None
        interaction_id = str(uuid.uuid4())
        try:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO diplomacy_interactions
                        (id, player_id, faction_id, player_message, ai_response,
                         game_state, faction_state, relationship_value, model_used,
                         cache_tier, latency_ms, action_type, action_data, session_id)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                    """,
                    uuid.UUID(interaction_id),
                    player_id,
                    faction_id,
                    player_message,
                    ai_response,
                    json.dumps(game_state) if game_state else None,
                    json.dumps(faction_state) if faction_state else None,
                    relationship_value,
                    model_used,
                    cache_tier,
                    latency_ms,
                    action_type,
                    json.dumps(action_data) if action_data else None,
                    session_id,
                )
            return interaction_id
        except Exception as e:
            logger.error(f"Failed to log interaction: {e}")
            return None

    # ── Faction memory ──────────────────────────────────────────

    async def get_faction_memory(
        self, player_id: str, faction_id: str, session_id: str
    ) -> list[dict]:
        """Retrieve conversation history for a player-faction-session combo."""
        if not self._connected or not self._pool:
            return []
        try:
            async with self._pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    SELECT messages FROM faction_memory
                    WHERE player_id=$1 AND faction_id=$2 AND session_id=$3
                    """,
                    player_id,
                    faction_id,
                    session_id,
                )
            if row:
                return json.loads(row["messages"])
            return []
        except Exception as e:
            logger.error(f"Failed to get faction memory: {e}")
            return []

    async def update_faction_memory(
        self,
        player_id: str,
        faction_id: str,
        session_id: str,
        messages: list[dict],
        relationship_value: int = 0,
    ) -> None:
        """Upsert conversation history."""
        if not self._connected or not self._pool:
            return
        try:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO faction_memory (player_id, faction_id, session_id, messages, relationship_value, updated_at)
                    VALUES ($1, $2, $3, $4, $5, NOW())
                    ON CONFLICT (player_id, faction_id, session_id)
                    DO UPDATE SET messages=$4, relationship_value=$5, updated_at=NOW()
                    """,
                    player_id,
                    faction_id,
                    session_id,
                    json.dumps(messages),
                    relationship_value,
                )
        except Exception as e:
            logger.error(f"Failed to update faction memory: {e}")


# Singleton
db = SupabaseClient()
