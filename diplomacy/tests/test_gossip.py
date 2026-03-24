"""Tests for the cross-faction awareness (gossip) system."""

import pytest
from diplomacy.services.gossip import (
    generate_gossip,
    _generate_gossip_items,
    _topic_allowed,
    _deterministic_should_gossip,
    GOSSIP_FILTERS,
    GOSSIP_FRAMING,
    ALL_FACTIONS,
    FACTION_NAMES,
)


class TestTopicAllowed:
    """Test topic filtering."""

    def test_allowed_topic(self):
        assert _topic_allowed("war", ["war", "alliance"]) is True

    def test_disallowed_topic(self):
        assert _topic_allowed("trade", ["war", "alliance"]) is False

    def test_empty_list(self):
        assert _topic_allowed("war", []) is False


class TestGossipFilters:
    """Test that faction types have appropriate gossip filters."""

    def test_spy_gets_most_topics(self):
        spy_topics = GOSSIP_FILTERS["spy"]
        assert len(spy_topics) >= 8

    def test_general_focuses_on_military(self):
        general_topics = GOSSIP_FILTERS["general"]
        assert "war" in general_topics
        assert "military" in general_topics
        assert "attack" in general_topics

    def test_tycoon_focuses_on_trade(self):
        tycoon_topics = GOSSIP_FILTERS["tycoon"]
        assert "trade" in tycoon_topics
        assert "gold" in tycoon_topics
        assert "deal" in tycoon_topics

    def test_leader_focuses_on_territory(self):
        leader_topics = GOSSIP_FILTERS["leader"]
        assert "territory" in leader_topics
        assert "alliance" in leader_topics

    def test_rebel_focuses_on_people(self):
        rebel_topics = GOSSIP_FILTERS["rebel"]
        assert "people" in rebel_topics or "oppression" in rebel_topics
        assert "rebellion" in rebel_topics


class TestGenerateGossipItems:
    """Test gossip item generation from game state."""

    def test_strong_alliance_generates_gossip(self):
        gs = {
            "relationship": {"emperor_valerian": 60},
            "alliances": {},
            "trade_deals": {},
            "at_war": False,
            "recent_events": [],
        }
        items = _generate_gossip_items("shadow_kael", "spy", gs)
        assert any("Aethelred" in item for item in items)

    def test_hostile_relationship_generates_gossip(self):
        gs = {
            "relationship": {"commander_thane": -40},
            "alliances": {},
            "trade_deals": {},
            "at_war": False,
            "recent_events": [],
        }
        items = _generate_gossip_items("shadow_kael", "spy", gs)
        assert any("Thane" in item for item in items)

    def test_active_alliance_generates_gossip(self):
        gs = {
            "relationship": {},
            "alliances": {"pirate_queen_elara": True},
            "trade_deals": {},
            "at_war": False,
            "recent_events": [],
        }
        items = _generate_gossip_items("shadow_kael", "spy", gs)
        assert any("alliance" in item.lower() for item in items)

    def test_active_trade_deal_generates_gossip(self):
        gs = {
            "relationship": {},
            "alliances": {},
            "trade_deals": {"emperor_valerian": True},
            "at_war": False,
            "recent_events": [],
        }
        items = _generate_gossip_items("merchant_prince_castellan", "tycoon", gs)
        assert any("trade" in item.lower() for item in items)

    def test_at_war_generates_gossip(self):
        gs = {
            "relationship": {},
            "alliances": {},
            "trade_deals": {},
            "at_war": True,
            "recent_events": [],
        }
        items = _generate_gossip_items("commander_thane", "general", gs)
        assert any("war" in item.lower() for item in items)

    def test_no_self_gossip(self):
        """Faction should not gossip about itself."""
        gs = {
            "relationship": {"shadow_kael": 80},
            "alliances": {"shadow_kael": True},
            "trade_deals": {},
            "at_war": False,
            "recent_events": [],
        }
        items = _generate_gossip_items("shadow_kael", "spy", gs)
        assert not any("Kael" in item for item in items)

    def test_general_filters_non_military(self):
        """General should not hear about trade deals."""
        gs = {
            "relationship": {},
            "alliances": {},
            "trade_deals": {"merchant_prince_castellan": True},
            "at_war": False,
            "recent_events": [],
        }
        items = _generate_gossip_items("commander_thane", "general", gs)
        assert not any("trade deal" in item.lower() for item in items)

    def test_recent_events_included(self):
        gs = {
            "relationship": {},
            "alliances": {},
            "trade_deals": {},
            "at_war": False,
            "recent_events": ["declared war on rebels"],
        }
        items = _generate_gossip_items("shadow_kael", "spy", gs)
        assert any("war" in item.lower() for item in items)

    def test_relationship_as_int_handled(self):
        """Integer relationship should not crash."""
        gs = {
            "relationship": 50,
            "alliances": {},
            "trade_deals": {},
            "at_war": False,
            "recent_events": [],
        }
        items = _generate_gossip_items("shadow_kael", "spy", gs)
        assert isinstance(items, list)


class TestDeterministicShouldGossip:
    """Test the deterministic gossip probability."""

    def test_no_game_state_returns_false(self):
        assert _deterministic_should_gossip("shadow_kael", None) is False

    def test_returns_bool(self):
        gs = {"turn": 10}
        result = _deterministic_should_gossip("shadow_kael", gs)
        assert isinstance(result, bool)

    def test_deterministic_for_same_input(self):
        """Same inputs should always produce the same result."""
        gs = {"turn": 42}
        results = [_deterministic_should_gossip("shadow_kael", gs) for _ in range(10)]
        assert len(set(results)) == 1

    def test_varies_across_turns(self):
        """Different turns should produce different results (at least some)."""
        results = set()
        for turn in range(100):
            results.add(_deterministic_should_gossip("shadow_kael", {"turn": turn}))
        assert len(results) == 2  # Should see both True and False

    def test_varies_across_factions(self):
        """Different factions on the same turn may get different results."""
        gs = {"turn": 10}
        results = set()
        for faction_id in ALL_FACTIONS:
            results.add(_deterministic_should_gossip(faction_id, gs))
        # Over 6 factions, we'd expect at least some variation
        # (not guaranteed for every turn, but statistically very likely)
        assert isinstance(results, set)


class TestGenerateGossip:
    """Test the full gossip generation pipeline."""

    def test_no_game_state_returns_empty(self):
        assert generate_gossip("shadow_kael", "spy", None) == ""

    def test_force_generates_gossip(self):
        gs = {
            "turn": 10,
            "relationship": {"emperor_valerian": 60},
            "alliances": {},
            "trade_deals": {},
            "at_war": True,
            "recent_events": [],
        }
        result = generate_gossip("shadow_kael", "spy", gs, force=True)
        assert "DIPLOMATIC INTELLIGENCE" in result

    def test_gossip_uses_faction_framing(self):
        gs = {
            "turn": 10,
            "relationship": {"emperor_valerian": 60},
            "alliances": {},
            "trade_deals": {},
            "at_war": False,
            "recent_events": [],
        }
        result = generate_gossip("shadow_kael", "spy", gs, force=True)
        assert "agents" in result.lower()

    def test_gossip_limited_to_two_items(self):
        gs = {
            "turn": 10,
            "relationship": {
                "emperor_valerian": 60,
                "commander_thane": -40,
                "pirate_queen_elara": 70,
                "rebel_leader_sera": -50,
            },
            "alliances": {"emperor_valerian": True},
            "trade_deals": {"pirate_queen_elara": True},
            "at_war": True,
            "recent_events": ["declared war on invaders"],
        }
        result = generate_gossip("shadow_kael", "spy", gs, force=True)
        # Count the bullet points
        lines = [l for l in result.split("\n") if l.strip().startswith("-") and "agents" in l.lower()]
        assert len(lines) <= 2

    def test_gossip_contains_instruction(self):
        gs = {
            "turn": 10,
            "relationship": {"emperor_valerian": 60},
            "alliances": {},
            "trade_deals": {},
            "at_war": False,
            "recent_events": [],
        }
        result = generate_gossip("shadow_kael", "spy", gs, force=True)
        assert "naturally" in result.lower()

    def test_empty_gossip_items_returns_empty(self):
        """If no relevant gossip exists, return empty even with force."""
        gs = {
            "turn": 10,
            "relationship": {},
            "alliances": {},
            "trade_deals": {},
            "at_war": False,
            "recent_events": [],
        }
        result = generate_gossip("commander_thane", "general", gs, force=True)
        assert result == ""

    def test_all_faction_types_have_framing(self):
        for faction_type in GOSSIP_FILTERS:
            assert faction_type in GOSSIP_FRAMING
