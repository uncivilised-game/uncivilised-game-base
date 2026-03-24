"""Tests for the Diplomatic Evaluation Engine."""

import pytest
from diplomacy.services.evaluation import (
    InteractionRecord,
    EvaluationResult,
    DimensionScore,
    evaluate_session,
    _score_honesty,
    _score_creativity,
    _score_adaptability,
    _score_strategic_thinking,
    _score_personality_matching,
    FACTION_VOCABULARY,
)


# ── Helpers ─────────────────────────────────────────────────────


def _rec(
    faction_id: str = "shadow_kael",
    player_message: str = "I propose an alliance.",
    ai_response: str = "Interesting proposal.",
    action_type: str | None = None,
    action_data: dict | None = None,
    game_state: dict | None = None,
    relationship_before: int = 0,
    relationship_after: int = 0,
    turn: int = 1,
    is_deceptive: bool = False,
) -> InteractionRecord:
    return InteractionRecord(
        player_message=player_message,
        ai_response=ai_response,
        faction_id=faction_id,
        action_type=action_type,
        action_data=action_data,
        game_state=game_state or {},
        relationship_before=relationship_before,
        relationship_after=relationship_after,
        turn=turn,
        is_deceptive=is_deceptive,
    )


# ── evaluate_session ────────────────────────────────────────────


class TestEvaluateSession:
    """Test the top-level evaluation function."""

    def test_empty_interactions_returns_neutral(self):
        result = evaluate_session([])
        assert result.diplomacy_score == 50.0
        assert result.interaction_count == 0
        assert result.factions_engaged == 0
        assert result.turns_played == 0
        assert len(result.dimensions) == 5

    def test_single_interaction(self):
        result = evaluate_session([_rec()])
        assert 0 <= result.diplomacy_score <= 100
        assert result.interaction_count == 1
        assert result.factions_engaged == 1

    def test_score_range_0_100(self):
        recs = [_rec(turn=i) for i in range(20)]
        result = evaluate_session(recs)
        assert 0 <= result.diplomacy_score <= 100

    def test_all_five_dimensions_present(self):
        result = evaluate_session([_rec()])
        expected_dims = {
            "honesty",
            "creativity",
            "adaptability",
            "strategic_thinking",
            "personality_matching",
        }
        assert set(result.dimensions.keys()) == expected_dims

    def test_each_dimension_max_20(self):
        result = evaluate_session([_rec()])
        for dim in result.dimensions.values():
            assert 0 <= dim.score <= 20

    def test_to_dict_serialization(self):
        result = evaluate_session([_rec()])
        d = result.to_dict()
        assert "diplomacy_score" in d
        assert "dimensions" in d
        assert "interaction_count" in d
        for dim_data in d["dimensions"].values():
            assert "name" in dim_data
            assert "score" in dim_data
            assert "max_score" in dim_data

    def test_multi_faction_engagement(self):
        recs = [
            _rec(faction_id="shadow_kael", turn=1),
            _rec(faction_id="commander_thane", turn=2),
            _rec(faction_id="merchant_prince_castellan", turn=3),
        ]
        result = evaluate_session(recs)
        assert result.factions_engaged == 3

    def test_turns_played_counts_unique_turns(self):
        recs = [
            _rec(turn=1),
            _rec(turn=1),
            _rec(turn=2),
            _rec(turn=3),
        ]
        result = evaluate_session(recs)
        assert result.turns_played == 3

    def test_max_complexity_game(self):
        """A complex game with many interactions across all factions."""
        factions = [
            "shadow_kael",
            "commander_thane",
            "merchant_prince_castellan",
            "pirate_queen_elara",
            "emperor_valerian",
            "rebel_leader_sera",
        ]
        recs = []
        for turn in range(50):
            faction = factions[turn % len(factions)]
            recs.append(
                _rec(
                    faction_id=faction,
                    turn=turn,
                    player_message=f"Turn {turn}: Let us negotiate terms of {faction}.",
                    action_type="offer_alliance" if turn % 3 == 0 else "trade_deal",
                    relationship_before=turn,
                    relationship_after=turn + 2,
                )
            )
        result = evaluate_session(recs)
        assert 0 <= result.diplomacy_score <= 100
        assert result.interaction_count == 50
        assert result.factions_engaged == 6


# ── Honesty scoring ─────────────────────────────────────────────


class TestHonestyScoring:
    """Test the honesty scoring dimension."""

    def test_empty_interactions(self):
        score = _score_honesty([])
        assert score.score == 10.0
        assert score.name == "Honesty"

    def test_no_commitments_neutral(self):
        recs = [_rec(player_message="Hello there.")]
        score = _score_honesty(recs)
        assert score.details["commitments_made"] == 0
        assert score.score == 10.0

    def test_honored_commitment_scores_well(self):
        recs = [
            _rec(
                player_message="I will help you.",
                action_type="offer_alliance",
                relationship_before=10,
                relationship_after=15,
            ),
        ]
        score = _score_honesty(recs)
        assert score.details["commitments_honored"] >= 1
        assert score.score > 10.0

    def test_betrayal_after_commitment_penalizes(self):
        recs = [
            _rec(
                player_message="I promise peace.",
                action_type="non_aggression",
                faction_id="commander_thane",
                relationship_before=10,
                relationship_after=15,
                turn=1,
            ),
            _rec(
                player_message="Surprise!",
                action_type="declare_war",
                faction_id="commander_thane",
                relationship_before=15,
                relationship_after=-10,
                turn=5,
            ),
        ]
        score = _score_honesty(recs)
        assert score.details["betrayals"] >= 1

    def test_promise_patterns_detected(self):
        messages = [
            "I will send gold.",
            "You have my word.",
            "Let's form an alliance.",
            "I agree to your terms.",
            "Deal! I accept.",
        ]
        for msg in messages:
            recs = [_rec(player_message=msg)]
            score = _score_honesty(recs)
            assert score.details["commitments_made"] >= 1, f"Not detected: {msg}"


# ── Creativity scoring ──────────────────────────────────────────


class TestCreativityScoring:
    """Test the creativity scoring dimension."""

    def test_empty_interactions(self):
        score = _score_creativity([])
        assert score.score == 10.0

    def test_diverse_vocabulary_scores_higher(self):
        recs_diverse = [
            _rec(player_message="The emperor should consider our maritime trade alliance."),
            _rec(player_message="Shadow operatives infiltrate the northern borders."),
            _rec(player_message="Rebels challenge authority through guerrilla tactics."),
        ]
        recs_repetitive = [
            _rec(player_message="hello hello hello hello"),
            _rec(player_message="hello hello hello hello"),
            _rec(player_message="hello hello hello hello"),
        ]
        diverse = _score_creativity(recs_diverse)
        repetitive = _score_creativity(recs_repetitive)
        assert diverse.score > repetitive.score

    def test_action_type_diversity_counted(self):
        recs = [
            _rec(action_type="offer_alliance"),
            _rec(action_type="trade_deal"),
            _rec(action_type="share_intel"),
            _rec(action_type="ceasefire"),
        ]
        score = _score_creativity(recs)
        assert score.details["action_types_used"] == 4

    def test_message_uniqueness_tracked(self):
        recs = [
            _rec(player_message="Unique message one"),
            _rec(player_message="Unique message two"),
            _rec(player_message="Unique message three"),
        ]
        score = _score_creativity(recs)
        assert score.details["message_uniqueness"] == 1.0

    def test_lexical_diversity_in_details(self):
        recs = [_rec(player_message="the quick brown fox jumps over the lazy dog")]
        score = _score_creativity(recs)
        assert "lexical_diversity" in score.details
        assert 0 <= score.details["lexical_diversity"] <= 1


# ── Adaptability scoring ───────────────────────────────────────


class TestAdaptabilityScoring:
    """Test the adaptability scoring dimension."""

    def test_empty_interactions(self):
        score = _score_adaptability([])
        assert score.score == 10.0

    def test_multi_faction_play_scores_higher(self):
        recs_multi = [
            _rec(faction_id="shadow_kael", action_type="share_intel"),
            _rec(faction_id="commander_thane", action_type="mutual_defense"),
            _rec(faction_id="merchant_prince_castellan", action_type="trade_deal"),
        ]
        recs_single = [
            _rec(faction_id="shadow_kael", action_type="share_intel"),
            _rec(faction_id="shadow_kael", action_type="share_intel"),
            _rec(faction_id="shadow_kael", action_type="share_intel"),
        ]
        multi = _score_adaptability(recs_multi)
        single = _score_adaptability(recs_single)
        assert multi.details["factions_engaged"] > single.details["factions_engaged"]

    def test_pivot_after_failure_detected(self):
        recs = [
            _rec(
                faction_id="shadow_kael",
                relationship_before=10,
                relationship_after=0,
                turn=1,
            ),
            _rec(
                faction_id="shadow_kael",
                relationship_before=0,
                relationship_after=5,
                turn=2,
            ),
        ]
        score = _score_adaptability(recs)
        assert score.details["pivot_opportunities"] >= 1
        assert score.details["pivots_made"] >= 1

    def test_approach_variance_in_details(self):
        recs = [
            _rec(faction_id="shadow_kael", action_type="share_intel"),
            _rec(faction_id="commander_thane", action_type="declare_war"),
        ]
        score = _score_adaptability(recs)
        assert "approach_variance" in score.details


# ── Strategic Thinking scoring ──────────────────────────────────


class TestStrategicThinkingScoring:
    """Test the strategic thinking scoring dimension."""

    def test_empty_interactions(self):
        score = _score_strategic_thinking([])
        assert score.score == 10.0

    def test_positive_relationship_gains(self):
        recs = [
            _rec(relationship_before=0, relationship_after=10),
            _rec(relationship_before=10, relationship_after=20),
            _rec(relationship_before=20, relationship_after=30),
        ]
        score = _score_strategic_thinking(recs)
        assert score.details["net_relationship_change"] == 30

    def test_deals_completed_tracked(self):
        recs = [
            _rec(action_type="offer_alliance"),
            _rec(action_type="trade_deal"),
            _rec(action_type="share_intel"),
            _rec(action_type="none"),
        ]
        score = _score_strategic_thinking(recs)
        assert score.details["deals_completed"] == 3

    def test_early_alliances_boost_timing(self):
        recs = [
            _rec(action_type="offer_alliance", turn=1),
            _rec(action_type="mutual_defense", turn=2),
            _rec(turn=10),
        ]
        score = _score_strategic_thinking(recs)
        assert score.details["timing_score"] > 0

    def test_multi_faction_deals_tracked(self):
        recs = [
            _rec(faction_id="shadow_kael", action_type="share_intel"),
            _rec(faction_id="commander_thane", action_type="mutual_defense"),
            _rec(faction_id="merchant_prince_castellan", action_type="trade_deal"),
        ]
        score = _score_strategic_thinking(recs)
        assert score.details["factions_with_deals"] == 3

    def test_negative_relationships_lower_score(self):
        recs = [
            _rec(relationship_before=0, relationship_after=-20),
            _rec(relationship_before=-20, relationship_after=-40),
        ]
        score_neg = _score_strategic_thinking(recs)

        recs_pos = [
            _rec(relationship_before=0, relationship_after=20),
            _rec(relationship_before=20, relationship_after=40),
        ]
        score_pos = _score_strategic_thinking(recs_pos)
        assert score_pos.score > score_neg.score


# ── Personality Matching scoring ────────────────────────────────


class TestPersonalityMatchingScoring:
    """Test the personality matching scoring dimension."""

    def test_empty_interactions(self):
        score = _score_personality_matching([])
        assert score.score == 10.0

    def test_faction_vocab_overlap_boosts_score(self):
        recs_matching = [
            _rec(
                faction_id="commander_thane",
                player_message="Our army will march to battle with strong military strategy and valor.",
            ),
        ]
        recs_mismatched = [
            _rec(
                faction_id="commander_thane",
                player_message="Hello there nice day.",
            ),
        ]
        matching = _score_personality_matching(recs_matching)
        mismatched = _score_personality_matching(recs_mismatched)
        assert matching.score >= mismatched.score

    def test_all_factions_have_vocabulary(self):
        expected = [
            "emperor_valerian",
            "shadow_kael",
            "merchant_prince_castellan",
            "pirate_queen_elara",
            "commander_thane",
            "rebel_leader_sera",
        ]
        for faction in expected:
            assert faction in FACTION_VOCABULARY
            assert len(FACTION_VOCABULARY[faction]) > 0

    def test_multi_faction_matching_bonus(self):
        recs = [
            _rec(
                faction_id="shadow_kael",
                player_message="Shadow intelligence covert spy network.",
            ),
            _rec(
                faction_id="commander_thane",
                player_message="Army battle strategy military defense.",
            ),
        ]
        score = _score_personality_matching(recs)
        assert score.details["factions_analyzed"] == 2

    def test_relationship_trajectory_matters(self):
        recs_improve = [
            _rec(
                faction_id="shadow_kael",
                relationship_before=0,
                relationship_after=10,
                turn=1,
            ),
            _rec(
                faction_id="shadow_kael",
                relationship_before=10,
                relationship_after=30,
                turn=2,
            ),
        ]
        recs_decline = [
            _rec(
                faction_id="shadow_kael",
                relationship_before=30,
                relationship_after=20,
                turn=1,
            ),
            _rec(
                faction_id="shadow_kael",
                relationship_before=20,
                relationship_after=0,
                turn=2,
            ),
        ]
        improve = _score_personality_matching(recs_improve)
        decline = _score_personality_matching(recs_decline)
        assert improve.score >= decline.score

    def test_unknown_faction_handled(self):
        recs = [_rec(faction_id="unknown_faction")]
        score = _score_personality_matching(recs)
        # Should not crash, returns neutral
        assert 0 <= score.score <= 20


# ── Edge cases ──────────────────────────────────────────────────


class TestEvaluationEdgeCases:
    """Test edge cases and robustness."""

    def test_single_message_game(self):
        result = evaluate_session([_rec()])
        assert 0 <= result.diplomacy_score <= 100

    def test_very_long_messages(self):
        long_msg = "word " * 1000
        result = evaluate_session([_rec(player_message=long_msg)])
        assert 0 <= result.diplomacy_score <= 100

    def test_empty_messages(self):
        result = evaluate_session([_rec(player_message="", ai_response="")])
        assert 0 <= result.diplomacy_score <= 100

    def test_all_same_faction(self):
        recs = [_rec(faction_id="shadow_kael", turn=i) for i in range(10)]
        result = evaluate_session(recs)
        assert result.factions_engaged == 1

    def test_all_factions_in_one_game(self):
        factions = list(FACTION_VOCABULARY.keys())
        recs = [_rec(faction_id=f, turn=i) for i, f in enumerate(factions)]
        result = evaluate_session(recs)
        assert result.factions_engaged == len(factions)

    def test_dimension_scores_sum_to_total(self):
        recs = [
            _rec(
                faction_id="shadow_kael",
                action_type="offer_alliance",
                player_message="I will form a shadow intelligence spy alliance with your network.",
                relationship_before=0,
                relationship_after=10,
                turn=1,
            ),
        ]
        result = evaluate_session(recs)
        dim_sum = sum(d.score for d in result.dimensions.values())
        assert abs(result.diplomacy_score - dim_sum) < 0.2  # rounding tolerance
