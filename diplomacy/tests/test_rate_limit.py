"""Tests for the rate limiting system."""

import pytest
from diplomacy.middleware.rate_limit import (
    _check_memory_rate_limit,
    _minute_buckets,
    _game_counters,
)
from diplomacy.config import settings


class TestMemoryRateLimit:
    def setup_method(self):
        """Reset rate limit state before each test."""
        _minute_buckets.clear()
        _game_counters.clear()

    def test_allows_under_limit(self):
        allowed, reason = _check_memory_rate_limit("player1", "game1")
        assert allowed is True
        assert reason == ""

    def test_blocks_after_per_minute_limit(self):
        for i in range(settings.rate_limit_per_minute):
            allowed, _ = _check_memory_rate_limit("player2", "game2")
            assert allowed is True

        # Next one should be blocked
        allowed, reason = _check_memory_rate_limit("player2", "game2")
        assert allowed is False
        assert "per minute" in reason

    def test_per_game_limit(self):
        # Set game counter just under the limit
        _game_counters["game3"] = settings.rate_limit_per_game - 1
        # Use different minute-bucket players to avoid per-minute limit
        allowed, _ = _check_memory_rate_limit("player_a", "game3")
        assert allowed is True

        # Next should be blocked
        allowed, reason = _check_memory_rate_limit("player_b", "game3")
        assert allowed is False
        assert "per game" in reason

    def test_different_players_independent(self):
        # Fill up player1's limit
        for i in range(settings.rate_limit_per_minute):
            _check_memory_rate_limit("player_x", "game4")

        # player2 should still be allowed
        allowed, _ = _check_memory_rate_limit("player_y", "game4")
        assert allowed is True
