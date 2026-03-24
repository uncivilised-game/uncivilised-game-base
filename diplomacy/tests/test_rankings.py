"""Tests for the Tournament Rankings system."""

import json
import pytest
from diplomacy.services.rankings import (
    RankingEntry,
    RankingsStore,
    compute_tournament_score,
    rankings_store,
    STRATEGIC_WEIGHT,
    DIPLOMACY_WEIGHT,
)


# ── Tournament score formula ────────────────────────────────────


class TestTournamentScoreFormula:
    """Test the core scoring formula."""

    def test_formula_weights(self):
        assert STRATEGIC_WEIGHT == 0.4
        assert DIPLOMACY_WEIGHT == 0.6

    def test_weights_sum_to_1(self):
        assert STRATEGIC_WEIGHT + DIPLOMACY_WEIGHT == 1.0

    def test_equal_scores(self):
        score = compute_tournament_score(100, 100)
        assert score == 100.0

    def test_zero_scores(self):
        score = compute_tournament_score(0, 0)
        assert score == 0.0

    def test_diplomacy_weighted_higher(self):
        """Diplomacy score should contribute more than strategic score."""
        score_high_diplo = compute_tournament_score(50, 100)
        score_high_strat = compute_tournament_score(100, 50)
        assert score_high_diplo > score_high_strat

    def test_formula_correctness(self):
        # strategic=200, diplomacy=80 → 200*0.4 + 80*0.6 = 80 + 48 = 128
        score = compute_tournament_score(200, 80)
        assert score == 128.0

    def test_formula_with_decimals(self):
        score = compute_tournament_score(75.5, 82.3)
        expected = round(75.5 * 0.4 + 82.3 * 0.6, 1)
        assert score == expected

    def test_negative_strategic_score(self):
        score = compute_tournament_score(-10, 50)
        assert score == round(-10 * 0.4 + 50 * 0.6, 1)


# ── Rankings store ──────────────────────────────────────────────


class TestRankingsStore:
    """Test the in-memory rankings store."""

    @pytest.fixture(autouse=True)
    def clean_store(self):
        store = RankingsStore()
        yield store
        store.clear()

    def test_submit_creates_entry(self, clean_store):
        entry = clean_store.submit("player1", "game1", 100, 80)
        assert entry.player_id == "player1"
        assert entry.game_id == "game1"
        assert entry.strategic_score == 100
        assert entry.diplomacy_score == 80
        assert entry.tournament_score == compute_tournament_score(100, 80)

    def test_submit_with_dimension_breakdown(self, clean_store):
        breakdown = {"honesty": 16.0, "creativity": 14.0}
        entry = clean_store.submit("p1", "g1", 100, 80, dimension_breakdown=breakdown)
        assert entry.dimension_breakdown == breakdown

    def test_get_rankings_sorted(self, clean_store):
        clean_store.submit("p1", "g1", 100, 100)  # 100
        clean_store.submit("p2", "g2", 50, 50)  # 50
        clean_store.submit("p3", "g3", 200, 90)  # 80+54=134

        rankings = clean_store.get_rankings()
        assert rankings[0].player_id == "p3"  # highest
        assert rankings[-1].player_id == "p2"  # lowest

    def test_get_rankings_limit(self, clean_store):
        for i in range(10):
            clean_store.submit(f"p{i}", f"g{i}", i * 10, i * 5)

        rankings = clean_store.get_rankings(limit=3)
        assert len(rankings) == 3

    def test_get_rankings_default_limit_50(self, clean_store):
        for i in range(60):
            clean_store.submit(f"p{i}", f"g{i}", i, i)

        rankings = clean_store.get_rankings()
        assert len(rankings) == 50

    def test_get_player_rankings(self, clean_store):
        clean_store.submit("player1", "g1", 100, 80)
        clean_store.submit("player1", "g2", 150, 90)
        clean_store.submit("player2", "g3", 200, 70)

        player1_rankings = clean_store.get_player_rankings("player1")
        assert len(player1_rankings) == 2
        assert all(e.player_id == "player1" for e in player1_rankings)

    def test_get_player_best(self, clean_store):
        clean_store.submit("player1", "g1", 100, 80)
        clean_store.submit("player1", "g2", 150, 90)

        best = clean_store.get_player_best("player1")
        assert best is not None
        assert best.game_id == "g2"

    def test_get_player_best_no_entries(self, clean_store):
        assert clean_store.get_player_best("nonexistent") is None

    def test_get_rank(self, clean_store):
        clean_store.submit("p1", "g1", 100, 100)  # score=100
        clean_store.submit("p2", "g2", 200, 90)  # score=134
        clean_store.submit("p3", "g3", 50, 50)  # score=50

        assert clean_store.get_rank("p2", "g2") == 1
        assert clean_store.get_rank("p1", "g1") == 2
        assert clean_store.get_rank("p3", "g3") == 3

    def test_get_rank_not_found(self, clean_store):
        assert clean_store.get_rank("nobody", "nothing") is None

    def test_count(self, clean_store):
        assert clean_store.count() == 0
        clean_store.submit("p1", "g1", 100, 80)
        assert clean_store.count() == 1
        clean_store.submit("p2", "g2", 90, 70)
        assert clean_store.count() == 2

    def test_clear(self, clean_store):
        clean_store.submit("p1", "g1", 100, 80)
        clean_store.clear()
        assert clean_store.count() == 0

    def test_entry_to_dict(self, clean_store):
        entry = clean_store.submit("p1", "g1", 100, 80)
        d = entry.to_dict()
        assert d["player_id"] == "p1"
        assert d["game_id"] == "g1"
        assert "tournament_score" in d
        assert "timestamp" in d


# ── JSON serialization ──────────────────────────────────────────


class TestRankingsSerialisation:
    """Test JSON serialization/deserialization."""

    @pytest.fixture
    def store_with_data(self):
        store = RankingsStore()
        store.submit("p1", "g1", 100, 80, {"honesty": 16.0})
        store.submit("p2", "g2", 200, 90)
        yield store
        store.clear()

    def test_to_json_valid(self, store_with_data):
        j = store_with_data.to_json()
        data = json.loads(j)
        assert isinstance(data, list)
        assert len(data) == 2

    def test_roundtrip(self, store_with_data):
        j = store_with_data.to_json()

        new_store = RankingsStore()
        new_store.from_json(j)

        assert new_store.count() == 2
        rankings = new_store.get_rankings()
        assert rankings[0].player_id in ("p1", "p2")

    def test_from_json_preserves_scores(self, store_with_data):
        j = store_with_data.to_json()
        new_store = RankingsStore()
        new_store.from_json(j)

        p1 = new_store.get_player_rankings("p1")
        assert len(p1) == 1
        assert p1[0].strategic_score == 100
        assert p1[0].diplomacy_score == 80

    def test_from_json_preserves_breakdown(self, store_with_data):
        j = store_with_data.to_json()
        new_store = RankingsStore()
        new_store.from_json(j)

        p1 = new_store.get_player_rankings("p1")
        assert p1[0].dimension_breakdown.get("honesty") == 16.0


# ── Module-level singleton ──────────────────────────────────────


class TestModuleSingleton:
    """Test the module-level rankings_store singleton."""

    def test_singleton_exists(self):
        assert rankings_store is not None
        assert isinstance(rankings_store, RankingsStore)

    def test_singleton_is_functional(self):
        rankings_store.clear()
        rankings_store.submit("test_player", "test_game", 50, 50)
        assert rankings_store.count() == 1
        rankings_store.clear()
