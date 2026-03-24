"""Pydantic request/response models for the diplomacy module."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


# ── Request models ──────────────────────────────────────────────


class GameState(BaseModel):
    turn: int = 0
    gold: int = 0
    military: int = 0
    relationship: int | dict = 0
    at_war: bool = False
    techs: list[str] = Field(default_factory=list)
    cities: int = 1
    units: int = 0
    population: int | None = None
    territory: int | None = None
    alliances: dict[str, Any] | None = None
    trade_deals: dict[str, Any] | None = None
    marriages: dict[str, Any] | None = None
    defense_pacts: dict[str, Any] | None = None
    recent_events: list[str] = Field(default_factory=list)


class DiplomacyChatRequest(BaseModel):
    faction_id: str
    message: str
    game_state: GameState | dict | None = None
    conversation_history: list[dict] | None = None
    session_id: str | None = None


# ── Response models ─────────────────────────────────────────────


class DiplomacyAction(BaseModel):
    type: str
    give: str | None = None
    receive: str | None = None
    target: str | None = None
    target_faction: str | None = None
    duration: int | None = None
    amount: int | None = None
    mod: dict | None = None
    # Allow extra fields for extensibility
    model_config = {"extra": "allow"}


class DiplomacyChatResponse(BaseModel):
    response: str
    action: DiplomacyAction | dict | None = None
    interaction_id: str | None = None
    model: str = "sonnet"
    cache_hit: bool = False
    cache_tier: str | None = None
    character: str | None = None
    character_type: str | None = None
    # Legacy compatibility
    reply: str | None = None


class CacheStatsResponse(BaseModel):
    total_requests: int = 0
    l1_hits: int = 0
    l2_hits: int = 0
    l3_hits: int = 0
    misses: int = 0
    l1_rate: float = 0.0
    l2_rate: float = 0.0
    l3_rate: float = 0.0
    miss_rate: float = 0.0


# ── Database / logging models ───────────────────────────────────


class InteractionLog(BaseModel):
    id: str | None = None
    player_id: str
    faction_id: str
    player_message: str
    ai_response: str
    game_state: dict | None = None
    faction_state: dict | None = None
    relationship_value: int = 0
    model_used: str = "sonnet"
    cache_tier: str | None = None
    latency_ms: int = 0
    action_type: str | None = None
    action_data: dict | None = None
    outcome_data: dict | None = None
    session_id: str | None = None
    created_at: str | None = None
