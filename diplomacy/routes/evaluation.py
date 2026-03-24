"""Evaluation, Rankings, and A/B Testing API routes.

POST /api/diplomacy/evaluate              — Evaluate a game session
GET  /api/diplomacy/rankings              — Get tournament rankings
POST /api/diplomacy/rankings/submit       — Submit a game for ranking
GET  /api/diplomacy/experiments           — List active experiments
GET  /api/diplomacy/experiments/{id}/results — Get experiment results
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from diplomacy.services.evaluation import (
    InteractionRecord,
    evaluate_session,
)
from diplomacy.services.rankings import rankings_store
from diplomacy.services.ab_testing import ab_store

router = APIRouter(prefix="/api/diplomacy", tags=["evaluation"])


# ── Request / Response models ───────────────────────────────────


class InteractionInput(BaseModel):
    """API-facing interaction record (mirrors InteractionRecord)."""

    player_message: str
    ai_response: str
    faction_id: str
    action_type: str | None = None
    action_data: dict | None = None
    game_state: dict = Field(default_factory=dict)
    relationship_before: int = 0
    relationship_after: int = 0
    turn: int = 0
    model_used: str = "sonnet"
    is_deceptive: bool = False
    cache_hit: bool = False


class EvaluateRequest(BaseModel):
    player_id: str
    session_id: str
    interactions: list[InteractionInput]


class RankingSubmitRequest(BaseModel):
    player_id: str
    game_id: str
    strategic_score: float
    interactions: list[InteractionInput]


# ── Evaluation endpoint ─────────────────────────────────────────


@router.post("/evaluate")
async def evaluate_game(req: EvaluateRequest):
    """Evaluate a completed game session across 5 diplomacy dimensions."""
    records = [
        InteractionRecord(
            player_message=i.player_message,
            ai_response=i.ai_response,
            faction_id=i.faction_id,
            action_type=i.action_type,
            action_data=i.action_data,
            game_state=i.game_state,
            relationship_before=i.relationship_before,
            relationship_after=i.relationship_after,
            turn=i.turn,
            model_used=i.model_used,
            is_deceptive=i.is_deceptive,
            cache_hit=i.cache_hit,
        )
        for i in req.interactions
    ]

    result = evaluate_session(records)
    return result.to_dict()


# ── Rankings endpoints ──────────────────────────────────────────


@router.get("/rankings")
async def get_rankings():
    """Get top 50 tournament rankings."""
    rankings = rankings_store.get_rankings(limit=50)
    return {"rankings": [r.to_dict() for r in rankings]}


@router.post("/rankings/submit")
async def submit_ranking(req: RankingSubmitRequest):
    """Submit a game for tournament ranking.

    Evaluates the interactions to produce a diplomacy score, then
    combines with the strategic score using the tournament formula.
    """
    records = [
        InteractionRecord(
            player_message=i.player_message,
            ai_response=i.ai_response,
            faction_id=i.faction_id,
            action_type=i.action_type,
            action_data=i.action_data,
            game_state=i.game_state,
            relationship_before=i.relationship_before,
            relationship_after=i.relationship_after,
            turn=i.turn,
            model_used=i.model_used,
            is_deceptive=i.is_deceptive,
            cache_hit=i.cache_hit,
        )
        for i in req.interactions
    ]

    eval_result = evaluate_session(records)

    # Build dimension breakdown
    dimension_breakdown = {
        k: v.score for k, v in eval_result.dimensions.items()
    }

    entry = rankings_store.submit(
        player_id=req.player_id,
        game_id=req.game_id,
        strategic_score=req.strategic_score,
        diplomacy_score=eval_result.diplomacy_score,
        dimension_breakdown=dimension_breakdown,
    )

    rank = rankings_store.get_rank(req.player_id, req.game_id)

    return {
        "tournament_score": entry.tournament_score,
        "rank": rank,
        "diplomacy_score": eval_result.diplomacy_score,
        "strategic_score": req.strategic_score,
        "dimension_breakdown": dimension_breakdown,
    }


# ── Experiment endpoints ────────────────────────────────────────


@router.get("/experiments")
async def list_experiments():
    """List all active A/B test experiments."""
    experiments = ab_store.list_experiments(active_only=True)
    return {"experiments": [e.to_dict() for e in experiments]}


@router.get("/experiments/{experiment_id}/results")
async def get_experiment_results(experiment_id: str):
    """Get aggregated results for an experiment with statistical significance."""
    results = ab_store.get_experiment_results(experiment_id)
    if results is None:
        return {"error": "Experiment not found", "experiment_id": experiment_id}
    return results
