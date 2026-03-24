"""Tests for the context window management."""

import pytest
from diplomacy.services.context import (
    compress_game_state,
    _power_descriptor,
    _relationship_word,
    _phase_descriptor,
)


class TestPowerDescriptor:
    def test_negligible(self):
        assert _power_descriptor(10) == "negligible"

    def test_modest(self):
        assert _power_descriptor(30) == "modest"

    def test_considerable(self):
        assert _power_descriptor(50) == "considerable"

    def test_formidable(self):
        assert _power_descriptor(70) == "formidable"

    def test_overwhelming(self):
        assert _power_descriptor(90) == "overwhelming"


class TestRelationshipWord:
    def test_sworn_enemies(self):
        assert _relationship_word(-80) == "sworn enemies"

    def test_hostile(self):
        assert _relationship_word(-40) == "hostile"

    def test_neutral(self):
        assert _relationship_word(0) == "neutral strangers"

    def test_friendly(self):
        assert _relationship_word(20) == "cautiously friendly"

    def test_allied(self):
        assert _relationship_word(50) == "trusted allies"

    def test_devoted(self):
        assert _relationship_word(80) == "devoted partners"


class TestPhaseDescriptor:
    def test_opening(self):
        assert "opening" in _phase_descriptor(5)

    def test_expansion(self):
        assert "expansion" in _phase_descriptor(20)

    def test_middle(self):
        assert "middle" in _phase_descriptor(40)

    def test_endgame(self):
        assert "endgame" in _phase_descriptor(90)


class TestCompressGameState:
    def test_no_state(self):
        result = compress_game_state(None, "shadow_kael")
        assert "No game state" in result

    def test_basic_compression(self):
        gs = {
            "turn": 25,
            "gold": 150,
            "military": 45,
            "cities": 2,
            "units": 8,
            "relationship": {"shadow_kael": 15},
            "at_war": False,
            "techs": ["writing", "archery"],
        }
        result = compress_game_state(gs, "shadow_kael")

        # Should mention key facts
        assert "turn 25" in result
        assert "150 gold" in result
        assert "2 cit" in result
        assert "cautiously friendly" in result
        assert "2 technologies" in result

    def test_at_war_mentioned(self):
        gs = {"turn": 50, "gold": 100, "military": 60, "cities": 3, "at_war": True}
        result = compress_game_state(gs, "shadow_kael")
        assert "at war" in result.lower()

    def test_alliance_mentioned(self):
        gs = {
            "turn": 30, "gold": 100, "military": 50, "cities": 2,
            "alliances": {"shadow_kael": True},
        }
        result = compress_game_state(gs, "shadow_kael")
        assert "alliance" in result.lower()

    def test_under_800_chars(self):
        """Compressed state should be under ~200 tokens (~800 chars)."""
        gs = {
            "turn": 75, "gold": 500, "military": 90, "cities": 5,
            "units": 20, "population": 800, "territory": 50,
            "at_war": True,
            "techs": ["a", "b", "c", "d", "e", "f", "g", "h"],
            "relationship": {"shadow_kael": -60},
            "alliances": {"shadow_kael": True},
            "trade_deals": {"shadow_kael": True},
            "defense_pacts": {"shadow_kael": True},
            "recent_events": ["battle won", "city founded", "tech discovered"],
        }
        result = compress_game_state(gs, "shadow_kael")
        assert len(result) <= 800
