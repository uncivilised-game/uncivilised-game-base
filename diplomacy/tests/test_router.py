"""Tests for the model router."""

import pytest
from diplomacy.services.router import (
    route_model,
    detect_first_contact,
    _compute_complexity,
    MODEL_SONNET,
    MODEL_HAIKU,
    SONNET_THRESHOLD,
)


class TestComputeComplexity:
    def test_first_contact_always_high(self):
        score = _compute_complexity("hello", "shadow_kael", is_first_contact=True)
        assert score == 100

    def test_war_declaration_high(self):
        score = _compute_complexity("I declare war on you!", "shadow_kael")
        assert score >= SONNET_THRESHOLD

    def test_simple_greeting_low(self):
        score = _compute_complexity("hi", "shadow_kael")
        assert score < SONNET_THRESHOLD

    def test_complex_negotiation_high(self):
        score = _compute_complexity(
            "I demand you betray your alliance and attack the emperor, or I will declare war",
            "shadow_kael",
        )
        assert score >= SONNET_THRESHOLD

    def test_routine_trade_low(self):
        score = _compute_complexity("trade 50 gold for science", "shadow_kael")
        assert score < SONNET_THRESHOLD

    def test_simple_yes_low(self):
        score = _compute_complexity("yes", "shadow_kael")
        assert score < SONNET_THRESHOLD

    def test_at_war_increases_complexity(self):
        score_peace = _compute_complexity("hello there", "shadow_kael", game_state={"at_war": False})
        score_war = _compute_complexity("hello there", "shadow_kael", game_state={"at_war": True})
        assert score_war > score_peace

    def test_extreme_relationship_increases_complexity(self):
        score_neutral = _compute_complexity(
            "let's talk", "shadow_kael",
            game_state={"relationship": {"shadow_kael": 0}},
        )
        score_hostile = _compute_complexity(
            "let's talk", "shadow_kael",
            game_state={"relationship": {"shadow_kael": -80}},
        )
        assert score_hostile > score_neutral


class TestRouteModel:
    def test_first_contact_routes_to_sonnet(self):
        model, score, reason = route_model(
            "hello", "shadow_kael", is_first_contact=True
        )
        assert model == MODEL_SONNET
        assert reason == "complex"

    def test_simple_message_routes_to_haiku(self):
        model, score, reason = route_model("ok thanks", "shadow_kael")
        assert model == MODEL_HAIKU
        assert reason == "routine"

    def test_war_routes_to_sonnet(self):
        model, score, reason = route_model("I declare war!", "shadow_kael")
        assert model == MODEL_SONNET

    def test_returns_three_values(self):
        result = route_model("test", "shadow_kael")
        assert len(result) == 3
        model, score, reason = result
        assert isinstance(model, str)
        assert isinstance(score, int)
        assert reason in ("routine", "complex")


class TestDetectFirstContact:
    def test_no_history_neutral_is_first_contact(self):
        assert detect_first_contact(
            "shadow_kael",
            game_state={"relationship": {"shadow_kael": 0}},
            conversation_history=[],
        ) is True

    def test_has_history_is_not_first_contact(self):
        assert detect_first_contact(
            "shadow_kael",
            game_state={"relationship": {"shadow_kael": 20}},
            conversation_history=[{"role": "user", "content": "hello"}],
        ) is False

    def test_no_game_state_no_history(self):
        assert detect_first_contact("shadow_kael") is True
