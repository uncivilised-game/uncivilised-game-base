"""Tests for the strategic deception system."""

import pytest
from diplomacy.services.deception import (
    check_deception,
    build_deception_section,
    _compute_deception_probability,
    _select_deception_type,
    DECEPTION_BASE_RATES,
    DECEPTION_TYPES,
    FACTION_DECEPTION_PREFERENCES,
)


class TestDeceptionProbability:
    """Test deception probability computation."""

    def test_base_rates_exist_for_all_factions(self):
        expected = [
            "shadow_kael",
            "pirate_queen_elara",
            "emperor_valerian",
            "merchant_prince_castellan",
            "rebel_leader_sera",
            "commander_thane",
        ]
        for faction in expected:
            assert faction in DECEPTION_BASE_RATES

    def test_kael_highest_base_rate(self):
        assert DECEPTION_BASE_RATES["shadow_kael"] == 0.30

    def test_thane_lowest_base_rate(self):
        assert DECEPTION_BASE_RATES["commander_thane"] == 0.02

    def test_no_game_state_returns_base(self):
        prob = _compute_deception_probability("shadow_kael", None)
        assert prob == 0.30

    def test_weak_player_increases_probability(self):
        gs = {"military": 20}
        prob = _compute_deception_probability("shadow_kael", gs)
        assert prob > 0.30

    def test_negative_relationship_increases_probability(self):
        gs = {"relationship": {"shadow_kael": -40}}
        prob = _compute_deception_probability("shadow_kael", gs)
        assert prob > 0.30

    def test_positive_relationship_decreases_probability(self):
        gs = {"relationship": {"shadow_kael": 70}}
        prob = _compute_deception_probability("shadow_kael", gs)
        assert prob < 0.30

    def test_desperation_increases_probability(self):
        gs = {"at_war": True, "military": 30}
        prob = _compute_deception_probability("shadow_kael", gs)
        assert prob > 0.30

    def test_multiple_modifiers_stack(self):
        gs = {
            "military": 20,
            "relationship": {"shadow_kael": -40},
            "at_war": True,
        }
        prob = _compute_deception_probability("shadow_kael", gs)
        # base 0.30 + 0.10 (weak) + 0.05 (hostile) + 0.10 (desperate)
        assert prob == pytest.approx(0.55)

    def test_probability_capped_at_1(self):
        gs = {
            "military": 5,
            "relationship": {"shadow_kael": -80},
            "at_war": True,
        }
        prob = _compute_deception_probability("shadow_kael", gs)
        assert prob <= 1.0

    def test_probability_cannot_go_negative(self):
        gs = {"relationship": {"commander_thane": 90}}
        prob = _compute_deception_probability("commander_thane", gs)
        assert prob >= 0.0

    def test_unknown_faction_returns_zero(self):
        prob = _compute_deception_probability("unknown", {"military": 10})
        assert prob == 0.0

    def test_relationship_as_int(self):
        gs = {"relationship": -40}
        prob = _compute_deception_probability("shadow_kael", gs)
        assert prob > 0.30


class TestSelectDeceptionType:
    """Test deception type selection."""

    def test_returns_valid_type(self):
        for faction_id in FACTION_DECEPTION_PREFERENCES:
            dtype = _select_deception_type(faction_id, {"turn": 10})
            assert dtype in DECEPTION_TYPES

    def test_deterministic_for_same_input(self):
        results = [_select_deception_type("shadow_kael", {"turn": 42}) for _ in range(10)]
        assert len(set(results)) == 1

    def test_varies_across_turns(self):
        """Different turns should eventually produce different deception types."""
        types = set()
        for turn in range(100):
            types.add(_select_deception_type("shadow_kael", {"turn": turn}))
        # Kael has 4 types, we should see at least 2 over 100 turns
        assert len(types) >= 2

    def test_faction_preferences_respected(self):
        """Selected type should be in faction's preference list."""
        for faction_id, prefs in FACTION_DECEPTION_PREFERENCES.items():
            for turn in range(20):
                dtype = _select_deception_type(faction_id, {"turn": turn})
                assert dtype in prefs, f"{faction_id} selected {dtype} not in preferences"

    def test_unknown_faction_returns_inflated_demands(self):
        dtype = _select_deception_type("unknown", {"turn": 5})
        assert dtype == "inflated_demands"


class TestCheckDeception:
    """Test the main deception check function."""

    def test_result_structure(self):
        result = check_deception("shadow_kael", {"turn": 10})
        assert "is_deceptive" in result
        assert "deception_type" in result
        assert "directive" in result
        assert "probability" in result

    def test_force_always_triggers(self):
        result = check_deception("shadow_kael", {"turn": 10}, force=True)
        assert result["is_deceptive"] is True
        assert result["deception_type"] is not None
        assert len(result["directive"]) > 0

    def test_force_on_thane_triggers(self):
        """Even Thane (2% base) triggers when forced."""
        result = check_deception("commander_thane", {"turn": 10}, force=True)
        assert result["is_deceptive"] is True

    def test_no_deception_returns_empty_directive(self):
        """When deception doesn't trigger, directive should be empty."""
        result = check_deception("commander_thane", {"turn": 1})
        # Thane at 2% — check structure regardless of trigger
        assert isinstance(result["directive"], str)
        if not result["is_deceptive"]:
            assert result["directive"] == ""
            assert result["deception_type"] is None

    def test_deterministic_for_same_input(self):
        results = [check_deception("shadow_kael", {"turn": 42}) for _ in range(10)]
        assert all(r["is_deceptive"] == results[0]["is_deceptive"] for r in results)

    def test_unknown_faction_never_deceives(self):
        result = check_deception("unknown_faction", {"turn": 10})
        assert result["is_deceptive"] is False
        assert result["probability"] == 0.0


class TestBuildDeceptionSection:
    """Test the deception prompt section builder."""

    def test_forced_returns_section(self):
        section, meta = build_deception_section("shadow_kael", {"turn": 10}, force=True)
        assert "SECRET DIRECTIVE" in section
        assert meta["is_deceptive"] is True

    def test_section_warns_about_hiding(self):
        section, _ = build_deception_section("shadow_kael", {"turn": 10}, force=True)
        assert "player cannot see" in section.lower()

    def test_no_deception_returns_empty_section(self):
        section, meta = build_deception_section("commander_thane", {"turn": 1})
        if not meta["is_deceptive"]:
            assert section == ""

    def test_metadata_includes_deception_type(self):
        _, meta = build_deception_section("shadow_kael", {"turn": 10}, force=True)
        assert meta["deception_type"] in DECEPTION_TYPES

    def test_all_deception_types_have_content(self):
        for dtype, text in DECEPTION_TYPES.items():
            assert len(text) > 20, f"Deception type '{dtype}' has insufficient content"
