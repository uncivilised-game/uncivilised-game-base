"""Tests for the response variation system."""

import pytest
from diplomacy.services.variation import apply_variation, _synonym_swap, _inject_game_state


class TestSynonymSwap:
    def test_returns_string(self):
        result = _synonym_swap("I agree to trade gold for peace")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_preserves_length_approximately(self):
        text = "The enemy forces are strong and we must trade for peace"
        result = _synonym_swap(text, swap_probability=0.0)
        assert result == text  # 0% swap = no change

    def test_high_swap_produces_changes(self):
        text = "agree refuse gold war peace ally enemy strong weak trade"
        results = set()
        for _ in range(50):
            results.add(_synonym_swap(text, swap_probability=1.0))
        # With 100% swap probability, we should see variation
        assert len(results) > 1


class TestGameStateInjection:
    def test_gold_injection(self):
        text = "your coffers are impressive"
        result = _inject_game_state(text, {"gold": 500})
        assert "500" in result

    def test_military_injection(self):
        text = "your forces march onward"
        result = _inject_game_state(text, {"military": 75})
        assert "75" in result

    def test_late_game_awareness(self):
        text = "the time has come to decide"
        result = _inject_game_state(text, {"turn": 90})
        assert "waning" in result

    def test_no_game_state(self):
        text = "Hello there"
        result = _inject_game_state(text, None)
        assert result == text


class TestApplyVariation:
    def test_basic(self):
        result = apply_variation("A simple response about trade.", {"gold": 100})
        assert isinstance(result, str)
        assert len(result) > 0

    def test_with_no_state(self):
        result = apply_variation("A simple response.")
        assert isinstance(result, str)
