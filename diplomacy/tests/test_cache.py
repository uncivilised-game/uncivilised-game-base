"""Tests for the cache service — key generation, buckets, template substitution."""

import pytest
from diplomacy.services.cache import (
    _normalize_message,
    _message_hash,
    relationship_bucket,
    game_phase,
    _l1_cache_key,
    _substitute_variables,
    _detect_category,
    _pick_variant,
    get_stats,
    reset_stats,
)


class TestNormalizeMessage:
    def test_basic(self):
        assert _normalize_message("Hello, World!") == "hello world"

    def test_extra_whitespace(self):
        assert _normalize_message("  lots   of   spaces  ") == "lots of spaces"

    def test_punctuation_stripped(self):
        assert _normalize_message("trade? gold! yes.") == "trade gold yes"

    def test_case_insensitive(self):
        assert _normalize_message("TRADE GOLD") == "trade gold"
        assert _normalize_message("Trade Gold") == "trade gold"


class TestMessageHash:
    def test_deterministic(self):
        h1 = _message_hash("I want to trade gold")
        h2 = _message_hash("I want to trade gold")
        assert h1 == h2

    def test_normalized(self):
        h1 = _message_hash("I want to trade gold!")
        h2 = _message_hash("i want to trade gold")
        assert h1 == h2

    def test_different_messages(self):
        h1 = _message_hash("I want to trade gold")
        h2 = _message_hash("I declare war")
        assert h1 != h2

    def test_length(self):
        h = _message_hash("test")
        assert len(h) == 16


class TestRelationshipBucket:
    def test_hostile(self):
        assert relationship_bucket(-100) == "hostile"
        assert relationship_bucket(-50) == "hostile"

    def test_unfriendly(self):
        assert relationship_bucket(-49) == "unfriendly"
        assert relationship_bucket(-10) == "unfriendly"

    def test_neutral(self):
        assert relationship_bucket(-9) == "neutral"
        assert relationship_bucket(0) == "neutral"
        assert relationship_bucket(9) == "neutral"

    def test_friendly(self):
        assert relationship_bucket(10) == "friendly"
        assert relationship_bucket(49) == "friendly"

    def test_allied(self):
        assert relationship_bucket(50) == "allied"
        assert relationship_bucket(100) == "allied"


class TestGamePhase:
    def test_early(self):
        assert game_phase(1) == "early"
        assert game_phase(15) == "early"

    def test_mid(self):
        assert game_phase(16) == "mid"
        assert game_phase(40) == "mid"

    def test_late(self):
        assert game_phase(41) == "late"
        assert game_phase(100) == "late"


class TestL1CacheKey:
    def test_format(self):
        key = _l1_cache_key("shadow_kael", "hello", 0, 10)
        parts = key.split(":")
        assert parts[0] == "diplomacy"
        assert parts[1] == "l1"
        assert parts[2] == "shadow_kael"
        # message hash
        assert len(parts[3]) == 16
        assert parts[4] == "neutral"
        assert parts[5] == "early"

    def test_different_relationship(self):
        k1 = _l1_cache_key("shadow_kael", "hello", -80, 10)
        k2 = _l1_cache_key("shadow_kael", "hello", 80, 10)
        assert k1 != k2
        assert "hostile" in k1
        assert "allied" in k2

    def test_different_phase(self):
        k1 = _l1_cache_key("shadow_kael", "hello", 0, 5)
        k2 = _l1_cache_key("shadow_kael", "hello", 0, 50)
        assert k1 != k2


class TestSubstituteVariables:
    def test_basic_substitution(self):
        result = _substitute_variables(
            "You have {gold_amount} gold and {cities_count} cities.",
            {"gold": 150, "cities": 3},
        )
        assert "150" in result
        assert "3" in result

    def test_no_game_state(self):
        template = "Hello {player_name}"
        result = _substitute_variables(template, None)
        assert result == template

    def test_relationship_descriptor(self):
        result = _substitute_variables(
            "The {relationship_descriptor} visitor.",
            {"relationship": 75},
        )
        assert "allied" in result

    def test_missing_values(self):
        result = _substitute_variables(
            "You have {gold_amount} gold.",
            {"military": 50},  # no gold key
        )
        assert "???" in result


class TestDetectCategory:
    def test_first_contact(self):
        cat = _detect_category("Hello there!", "shadow_kael", {"relationship": 0})
        assert cat == "first_contact"

    def test_trade(self):
        cat = _detect_category("I want to trade gold with you", "shadow_kael", None)
        assert cat == "trade"

    def test_war(self):
        cat = _detect_category("I declare war on you!", "shadow_kael", None)
        assert cat == "war_peace"

    def test_acknowledgment(self):
        cat = _detect_category("Thank you for the deal", "shadow_kael", None)
        assert cat == "acknowledgment"

    def test_unrecognised(self):
        cat = _detect_category("What a lovely day", "shadow_kael", None)
        assert cat is None


class TestPickVariant:
    def test_single_variant(self):
        result = _pick_variant(["only one"], "player1")
        assert result == "only one"

    def test_avoids_repeat(self):
        # Pick once to set last_response
        _pick_variant(["a", "b"], "player_avoid")
        # Next pick should try to avoid the previous one (mostly)
        results = set()
        for _ in range(20):
            results.add(_pick_variant(["a", "b"], "player_avoid"))
        assert len(results) == 2  # Both should appear eventually


class TestStats:
    def test_reset(self):
        reset_stats()
        stats = get_stats()
        assert stats["total_requests"] == 0
        assert stats["l1_rate"] == 0.0
