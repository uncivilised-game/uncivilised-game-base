"""Tests for the dynamic mood system."""

import pytest
from diplomacy.services.mood import (
    compute_mood,
    get_mood_directive,
    build_mood_section,
    MOODS,
    MOOD_DIRECTIVES,
)


class TestComputeMood:
    """Test mood computation from game state."""

    def test_no_game_state_returns_wary(self):
        assert compute_mood("shadow_kael", None) == "wary"

    def test_unknown_faction_returns_wary(self):
        assert compute_mood("unknown_faction", {"turn": 10}) == "wary"

    def test_empty_game_state_returns_faction_default(self):
        assert compute_mood("shadow_kael", {}) == "scheming"
        assert compute_mood("merchant_prince_castellan", {}) == "jovial"

    def test_won_battle_event_returns_confident(self):
        gs = {"recent_events": ["Won battle at Iron Pass"]}
        assert compute_mood("commander_thane", gs) == "confident"

    def test_victory_event_returns_confident(self):
        gs = {"recent_events": ["Great victory in the north"]}
        assert compute_mood("emperor_valerian", gs) == "confident"

    def test_lost_territory_returns_desperate(self):
        gs = {"recent_events": ["Lost territory to invaders"]}
        assert compute_mood("emperor_valerian", gs) == "desperate"

    def test_lost_city_returns_desperate(self):
        gs = {"recent_events": ["Lost city to rebels"]}
        assert compute_mood("rebel_leader_sera", gs) == "desperate"

    def test_lost_battle_returns_desperate(self):
        gs = {"recent_events": ["Lost battle at the border"]}
        assert compute_mood("commander_thane", gs) == "desperate"

    def test_broken_deal_returns_furious(self):
        gs = {"recent_events": ["Player broke alliance"]}
        assert compute_mood("emperor_valerian", gs) == "furious"

    def test_betrayed_event_returns_furious(self):
        gs = {"recent_events": ["Betrayed by the player"]}
        assert compute_mood("commander_thane", gs) == "furious"

    def test_gift_event_returns_grateful(self):
        gs = {"recent_events": ["Received gift of gold"]}
        assert compute_mood("merchant_prince_castellan", gs) == "grateful"

    def test_tribute_event_returns_grateful(self):
        gs = {"recent_events": ["Player paid tribute"]}
        assert compute_mood("emperor_valerian", gs) == "grateful"

    def test_very_negative_relationship_returns_furious(self):
        gs = {"relationship": {"shadow_kael": -55}}
        assert compute_mood("shadow_kael", gs) == "furious"

    def test_negative_relationship_returns_cold(self):
        gs = {"relationship": {"shadow_kael": -25}}
        assert compute_mood("shadow_kael", gs) == "cold"

    def test_at_war_strong_military_returns_confident(self):
        gs = {"at_war": True, "military": 80}
        assert compute_mood("commander_thane", gs) == "confident"

    def test_at_war_weak_military_returns_desperate(self):
        gs = {"at_war": True, "military": 20}
        assert compute_mood("commander_thane", gs) == "desperate"

    def test_at_war_moderate_military_returns_wary(self):
        gs = {"at_war": True, "military": 50}
        assert compute_mood("commander_thane", gs) == "wary"

    def test_strong_and_rich_returns_confident(self):
        gs = {"military": 90, "gold": 200}
        assert compute_mood("emperor_valerian", gs) == "confident"

    def test_very_weak_returns_desperate(self):
        gs = {"military": 15, "gold": 50}
        assert compute_mood("emperor_valerian", gs) == "desperate"

    def test_very_poor_returns_desperate(self):
        gs = {"military": 50, "gold": 5}
        assert compute_mood("merchant_prince_castellan", gs) == "desperate"

    def test_high_relationship_returns_jovial(self):
        gs = {"relationship": {"shadow_kael": 65}}
        assert compute_mood("shadow_kael", gs) == "jovial"

    def test_moderate_positive_relationship_returns_grateful(self):
        gs = {"relationship": {"commander_thane": 35}}
        assert compute_mood("commander_thane", gs) == "grateful"

    def test_slightly_negative_returns_wary(self):
        gs = {"relationship": {"rebel_leader_sera": -10}}
        assert compute_mood("rebel_leader_sera", gs) == "wary"

    def test_relationship_as_int(self):
        """Test with relationship as plain integer instead of dict."""
        gs = {"relationship": -55}
        assert compute_mood("shadow_kael", gs) == "furious"

    def test_event_priority_over_relationship(self):
        """Events should take priority over relationship-based mood."""
        gs = {
            "relationship": {"shadow_kael": 80},
            "recent_events": ["Player broke the treaty"],
        }
        assert compute_mood("shadow_kael", gs) == "furious"

    def test_all_factions_have_defaults(self):
        """Every faction should have a default mood when game state is neutral."""
        for faction_id in MOOD_DIRECTIVES:
            mood = compute_mood(faction_id, {})
            assert mood in MOODS, f"{faction_id} returned invalid mood: {mood}"


class TestGetMoodDirective:
    """Test mood directive retrieval."""

    def test_valid_faction_and_mood(self):
        directive = get_mood_directive("shadow_kael", "scheming")
        assert len(directive) > 0
        assert "plot" in directive.lower() or "chess" in directive.lower() or "cryptic" in directive.lower()

    def test_unknown_faction_returns_empty(self):
        assert get_mood_directive("unknown", "confident") == ""

    def test_unknown_mood_returns_empty(self):
        assert get_mood_directive("shadow_kael", "nonexistent") == ""

    def test_all_factions_have_all_moods(self):
        """Every faction should have a directive for every mood."""
        for faction_id, moods in MOOD_DIRECTIVES.items():
            for mood in MOODS:
                directive = get_mood_directive(faction_id, mood)
                assert directive, f"{faction_id} missing directive for mood: {mood}"

    def test_directives_are_substantial(self):
        """Directives should be meaningful, not empty placeholders."""
        for faction_id, moods in MOOD_DIRECTIVES.items():
            for mood, directive in moods.items():
                assert len(directive) > 20, f"{faction_id}/{mood} directive too short"


class TestBuildMoodSection:
    """Test the formatted mood section builder."""

    def test_returns_formatted_section(self):
        gs = {"recent_events": ["Won battle at the ridge"]}
        section = build_mood_section("commander_thane", gs)
        assert "CURRENT MOOD" in section
        assert "CONFIDENT" in section

    def test_no_game_state_returns_section_with_wary(self):
        section = build_mood_section("shadow_kael", None)
        assert "WARY" in section

    def test_unknown_faction_returns_empty(self):
        assert build_mood_section("unknown", {"turn": 10}) == ""

    def test_section_contains_directive_text(self):
        gs = {"relationship": {"shadow_kael": -60}}
        section = build_mood_section("shadow_kael", gs)
        assert len(section) > 30
