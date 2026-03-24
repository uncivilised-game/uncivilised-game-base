"""Tests for the session auth system."""

import pytest
from diplomacy.middleware.auth import (
    create_session_token,
    validate_session_token,
    hash_player_id,
    _sessions,
)


class TestSessionAuth:
    def setup_method(self):
        _sessions.clear()

    def test_create_and_validate(self):
        token = create_session_token("player1", "game1")
        session = validate_session_token(token)
        assert session is not None
        assert session["player_id"] == "player1"
        assert session["game_id"] == "game1"

    def test_invalid_token(self):
        session = validate_session_token("nonexistent-token")
        assert session is None

    def test_unique_tokens(self):
        t1 = create_session_token("player1")
        t2 = create_session_token("player1")
        assert t1 != t2

    def test_message_count_init(self):
        token = create_session_token("player1")
        session = validate_session_token(token)
        assert session["message_count"] == 0


class TestHashPlayerId:
    def test_deterministic(self):
        h1 = hash_player_id("player1")
        h2 = hash_player_id("player1")
        assert h1 == h2

    def test_different_players(self):
        h1 = hash_player_id("player1")
        h2 = hash_player_id("player2")
        assert h1 != h2

    def test_length(self):
        h = hash_player_id("player1")
        assert len(h) == 16

    def test_hex_format(self):
        h = hash_player_id("player1")
        int(h, 16)  # Should not raise
