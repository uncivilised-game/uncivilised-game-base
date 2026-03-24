"""Tournament Rankings — diplomacy-weighted scoring and leaderboard.

Tournament score formula:
    tournament_score = strategic_score * 0.4 + diplomacy_score * 0.6

Diplomacy is weighted 60% because it's the game's competitive moat.
Rankings are stored in-memory with JSON serialization support.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field, asdict
from typing import Any


# ── Data structures ─────────────────────────────────────────────


@dataclass
class RankingEntry:
    """A single tournament ranking entry."""

    player_id: str
    game_id: str
    strategic_score: float
    diplomacy_score: float
    tournament_score: float
    dimension_breakdown: dict[str, float] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "player_id": self.player_id,
            "game_id": self.game_id,
            "strategic_score": round(self.strategic_score, 1),
            "diplomacy_score": round(self.diplomacy_score, 1),
            "tournament_score": round(self.tournament_score, 1),
            "dimension_breakdown": {
                k: round(v, 1) for k, v in self.dimension_breakdown.items()
            },
            "timestamp": self.timestamp,
        }


# ── Scoring ─────────────────────────────────────────────────────

STRATEGIC_WEIGHT = 0.4
DIPLOMACY_WEIGHT = 0.6


def compute_tournament_score(
    strategic_score: float,
    diplomacy_score: float,
) -> float:
    """Compute weighted tournament score.

    Formula: strategic_score * 0.4 + diplomacy_score * 0.6
    """
    return round(
        strategic_score * STRATEGIC_WEIGHT + diplomacy_score * DIPLOMACY_WEIGHT,
        1,
    )


# ── In-memory rankings store ───────────────────────────────────


class RankingsStore:
    """In-memory tournament rankings with submission and retrieval.

    Thread-safe for single-process async use (GIL).
    """

    def __init__(self) -> None:
        self._entries: list[RankingEntry] = []

    def submit(
        self,
        player_id: str,
        game_id: str,
        strategic_score: float,
        diplomacy_score: float,
        dimension_breakdown: dict[str, float] | None = None,
    ) -> RankingEntry:
        """Submit a game result to the tournament rankings.

        Returns the created RankingEntry with computed tournament_score.
        """
        tournament_score = compute_tournament_score(strategic_score, diplomacy_score)

        entry = RankingEntry(
            player_id=player_id,
            game_id=game_id,
            strategic_score=strategic_score,
            diplomacy_score=diplomacy_score,
            tournament_score=tournament_score,
            dimension_breakdown=dimension_breakdown or {},
        )

        self._entries.append(entry)
        return entry

    def get_rankings(self, limit: int = 50) -> list[RankingEntry]:
        """Get top tournament rankings sorted by tournament_score descending."""
        sorted_entries = sorted(
            self._entries,
            key=lambda e: e.tournament_score,
            reverse=True,
        )
        return sorted_entries[:limit]

    def get_player_rankings(self, player_id: str) -> list[RankingEntry]:
        """Get all rankings for a specific player."""
        return [e for e in self._entries if e.player_id == player_id]

    def get_player_best(self, player_id: str) -> RankingEntry | None:
        """Get the best tournament score for a player."""
        player_entries = self.get_player_rankings(player_id)
        if not player_entries:
            return None
        return max(player_entries, key=lambda e: e.tournament_score)

    def get_rank(self, player_id: str, game_id: str) -> int | None:
        """Get the rank of a specific game submission (1-indexed).

        Returns None if the submission is not found.
        """
        rankings = self.get_rankings(limit=len(self._entries))
        for i, entry in enumerate(rankings, 1):
            if entry.player_id == player_id and entry.game_id == game_id:
                return i
        return None

    def count(self) -> int:
        """Total number of ranking entries."""
        return len(self._entries)

    def clear(self) -> None:
        """Clear all rankings (useful for testing)."""
        self._entries.clear()

    def to_json(self) -> str:
        """Serialize rankings to JSON string."""
        return json.dumps(
            [e.to_dict() for e in self._entries],
            indent=2,
        )

    def from_json(self, data: str) -> None:
        """Load rankings from a JSON string (replaces current data)."""
        entries = json.loads(data)
        self._entries = [
            RankingEntry(
                player_id=e["player_id"],
                game_id=e["game_id"],
                strategic_score=e["strategic_score"],
                diplomacy_score=e["diplomacy_score"],
                tournament_score=e["tournament_score"],
                dimension_breakdown=e.get("dimension_breakdown", {}),
                timestamp=e.get("timestamp", time.time()),
            )
            for e in entries
        ]


# ── Module-level singleton ──────────────────────────────────────

rankings_store = RankingsStore()
