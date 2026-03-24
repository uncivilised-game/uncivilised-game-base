"""Tests for the A/B Testing Framework."""

import json
import pytest
from diplomacy.services.ab_testing import (
    Experiment,
    ABTestingStore,
    get_player_group,
    _mean,
    _std_dev,
    _t_test,
    ab_store,
)


# ── Player group assignment ─────────────────────────────────────


class TestPlayerGroupAssignment:
    """Test deterministic group assignment."""

    def test_returns_control_or_variant(self):
        group = get_player_group("player1", "exp1")
        assert group in ("control", "variant")

    def test_deterministic(self):
        """Same player + experiment → same group, every time."""
        results = [get_player_group("player1", "exp1") for _ in range(100)]
        assert len(set(results)) == 1

    def test_different_experiments_can_differ(self):
        """Same player may be in different groups for different experiments."""
        groups = set()
        for i in range(50):
            groups.add(get_player_group("player_fixed", f"exp_{i}"))
        # Over 50 experiments, should see both groups
        assert len(groups) == 2

    def test_different_players_can_differ(self):
        """Different players may be in different groups for the same experiment."""
        groups = set()
        for i in range(50):
            groups.add(get_player_group(f"player_{i}", "exp_fixed"))
        assert len(groups) == 2

    def test_roughly_50_50_split(self):
        """Assignment should be roughly 50/50 over many players."""
        control = sum(
            1
            for i in range(1000)
            if get_player_group(f"player_{i}", "split_test") == "control"
        )
        # Should be between 40% and 60% (very generous margin)
        assert 400 <= control <= 600

    def test_empty_player_id(self):
        group = get_player_group("", "exp1")
        assert group in ("control", "variant")

    def test_special_characters(self):
        group = get_player_group("player@#$%^&*()", "exp!@#")
        assert group in ("control", "variant")


# ── Statistical functions ───────────────────────────────────────


class TestStatisticalFunctions:
    """Test mean, std_dev, and t-test helpers."""

    def test_mean_empty(self):
        assert _mean([]) == 0.0

    def test_mean_single(self):
        assert _mean([5.0]) == 5.0

    def test_mean_multiple(self):
        assert _mean([1.0, 2.0, 3.0]) == 2.0

    def test_std_dev_empty(self):
        assert _std_dev([]) == 0.0

    def test_std_dev_single(self):
        assert _std_dev([5.0]) == 0.0

    def test_std_dev_identical(self):
        assert _std_dev([3.0, 3.0, 3.0]) == 0.0

    def test_std_dev_known_value(self):
        # stdev of [1,2,3] with Bessel correction = 1.0
        assert abs(_std_dev([1.0, 2.0, 3.0]) - 1.0) < 0.001

    def test_t_test_insufficient_data(self):
        result = _t_test([1.0], [2.0])
        assert result["significant"] is False
        assert result["reason"] == "insufficient_data"

    def test_t_test_identical_groups(self):
        result = _t_test([5.0, 5.0, 5.0], [5.0, 5.0, 5.0])
        assert result["significant"] is False
        assert result["t_statistic"] == 0.0

    def test_t_test_clearly_different(self):
        """Very different groups should be significant."""
        control = [1.0, 1.1, 1.0, 0.9, 1.0, 1.1, 0.9, 1.0, 1.1, 1.0]
        variant = [5.0, 5.1, 5.0, 4.9, 5.0, 5.1, 4.9, 5.0, 5.1, 5.0]
        result = _t_test(control, variant)
        assert result["significant"] is True
        assert result["control_mean"] < result["variant_mean"]

    def test_t_test_returns_correct_keys(self):
        result = _t_test([1.0, 2.0, 3.0], [4.0, 5.0, 6.0])
        assert "t_statistic" in result
        assert "degrees_of_freedom" in result
        assert "significant" in result
        assert "control_mean" in result
        assert "variant_mean" in result

    def test_t_test_zero_variance(self):
        result = _t_test([3.0, 3.0], [3.0, 3.0])
        assert result["significant"] is False


# ── Experiment management ───────────────────────────────────────


class TestExperimentManagement:
    """Test experiment CRUD operations."""

    @pytest.fixture(autouse=True)
    def clean_store(self):
        store = ABTestingStore()
        yield store
        store.clear()

    def test_create_experiment(self, clean_store):
        exp = clean_store.create_experiment(
            experiment_id="exp1",
            name="Test Personality Length",
            description="Testing longer personality prompts",
            parameter="personality_length",
            control_value=100,
            variant_value=200,
        )
        assert exp.experiment_id == "exp1"
        assert exp.active is True

    def test_get_experiment(self, clean_store):
        clean_store.create_experiment(
            "exp1", "Test", "Test desc", "param"
        )
        exp = clean_store.get_experiment("exp1")
        assert exp is not None
        assert exp.name == "Test"

    def test_get_nonexistent_experiment(self, clean_store):
        assert clean_store.get_experiment("nonexistent") is None

    def test_list_experiments_active_only(self, clean_store):
        clean_store.create_experiment("exp1", "Active", "d", "p")
        exp2 = clean_store.create_experiment("exp2", "Inactive", "d", "p")
        clean_store.deactivate_experiment("exp2")

        active = clean_store.list_experiments(active_only=True)
        assert len(active) == 1
        assert active[0].experiment_id == "exp1"

    def test_list_all_experiments(self, clean_store):
        clean_store.create_experiment("exp1", "A", "d", "p")
        clean_store.create_experiment("exp2", "B", "d", "p")
        clean_store.deactivate_experiment("exp2")

        all_exps = clean_store.list_experiments(active_only=False)
        assert len(all_exps) == 2

    def test_deactivate_experiment(self, clean_store):
        clean_store.create_experiment("exp1", "Test", "d", "p")
        result = clean_store.deactivate_experiment("exp1")
        assert result is True
        exp = clean_store.get_experiment("exp1")
        assert exp.active is False

    def test_deactivate_nonexistent(self, clean_store):
        assert clean_store.deactivate_experiment("nope") is False

    def test_experiment_to_dict(self, clean_store):
        exp = clean_store.create_experiment(
            "exp1", "Test", "Description", "param",
            control_value=1, variant_value=2, start_turn=5,
        )
        d = exp.to_dict()
        assert d["experiment_id"] == "exp1"
        assert d["parameter"] == "param"
        assert d["control_value"] == 1
        assert d["variant_value"] == 2
        assert d["start_turn"] == 5
        assert d["active"] is True


# ── Experiment configuration ────────────────────────────────────


class TestExperimentConfig:
    """Test experiment configuration for players."""

    @pytest.fixture(autouse=True)
    def store(self):
        store = ABTestingStore()
        store.create_experiment(
            "exp1", "Test", "d", "param",
            control_value="control_config",
            variant_value="variant_config",
        )
        yield store
        store.clear()

    def test_get_config_returns_value(self, store):
        config = store.get_experiment_config("player1", "exp1")
        assert config in ("control_config", "variant_config")

    def test_get_config_matches_group(self, store):
        group = store.get_player_group("player1", "exp1")
        config = store.get_experiment_config("player1", "exp1")
        expected = "control_config" if group == "control" else "variant_config"
        assert config == expected

    def test_get_config_inactive_experiment(self, store):
        store.deactivate_experiment("exp1")
        config = store.get_experiment_config("player1", "exp1")
        assert config is None

    def test_get_config_nonexistent_experiment(self, store):
        config = store.get_experiment_config("player1", "nope")
        assert config is None


# ── Metric recording ────────────────────────────────────────────


class TestMetricRecording:
    """Test metric recording and retrieval."""

    @pytest.fixture(autouse=True)
    def store(self):
        store = ABTestingStore()
        store.create_experiment("exp1", "Test", "d", "param")
        yield store
        store.clear()

    def test_record_metric(self, store):
        result = store.record_metric("exp1", "control", "conversation_length", 5.0)
        assert result is True

    def test_record_metric_invalid_experiment(self, store):
        result = store.record_metric("nope", "control", "metric", 1.0)
        assert result is False

    def test_record_metric_invalid_group(self, store):
        result = store.record_metric("exp1", "invalid_group", "metric", 1.0)
        assert result is False

    def test_record_multiple_metrics(self, store):
        store.record_metric("exp1", "control", "conv_length", 5.0)
        store.record_metric("exp1", "control", "conv_length", 7.0)
        store.record_metric("exp1", "control", "deal_rate", 0.6)

        results = store.get_experiment_results("exp1")
        assert results["control"]["conv_length"]["count"] == 2
        assert results["control"]["deal_rate"]["count"] == 1

    def test_record_to_both_groups(self, store):
        store.record_metric("exp1", "control", "engagement", 0.5)
        store.record_metric("exp1", "variant", "engagement", 0.8)

        results = store.get_experiment_results("exp1")
        assert results["control"]["engagement"]["count"] == 1
        assert results["variant"]["engagement"]["count"] == 1


# ── Experiment results ──────────────────────────────────────────


class TestExperimentResults:
    """Test experiment results aggregation and significance."""

    @pytest.fixture
    def store_with_data(self):
        store = ABTestingStore()
        store.create_experiment(
            "exp1", "Conv Length Test", "Testing effect on conversation length",
            "personality_length", 100, 200,
        )
        # Record control data
        for v in [3.0, 4.0, 5.0, 3.5, 4.5, 3.0, 4.0, 5.0, 3.5, 4.5]:
            store.record_metric("exp1", "control", "conversation_length", v)
        # Record variant data (slightly higher)
        for v in [5.0, 6.0, 7.0, 5.5, 6.5, 5.0, 6.0, 7.0, 5.5, 6.5]:
            store.record_metric("exp1", "variant", "conversation_length", v)
        yield store
        store.clear()

    def test_results_structure(self, store_with_data):
        results = store_with_data.get_experiment_results("exp1")
        assert results is not None
        assert "control" in results
        assert "variant" in results
        assert "significance" in results
        assert results["experiment_id"] == "exp1"

    def test_results_contain_metric_stats(self, store_with_data):
        results = store_with_data.get_experiment_results("exp1")
        ctrl = results["control"]["conversation_length"]
        assert "mean" in ctrl
        assert "std" in ctrl
        assert "count" in ctrl
        assert ctrl["count"] == 10

    def test_significance_testing(self, store_with_data):
        results = store_with_data.get_experiment_results("exp1")
        sig = results["significance"]["conversation_length"]
        assert "t_statistic" in sig
        assert "significant" in sig
        # These groups should be significantly different
        assert sig["significant"] is True

    def test_results_nonexistent_experiment(self):
        store = ABTestingStore()
        assert store.get_experiment_results("nope") is None

    def test_results_no_data(self):
        store = ABTestingStore()
        store.create_experiment("exp1", "Empty", "d", "p")
        results = store.get_experiment_results("exp1")
        assert results is not None
        assert results["control"] == {}
        assert results["variant"] == {}

    def test_results_asymmetric_data(self):
        """One group has data, the other doesn't."""
        store = ABTestingStore()
        store.create_experiment("exp1", "Asym", "d", "p")
        store.record_metric("exp1", "control", "metric", 5.0)
        store.record_metric("exp1", "control", "metric", 6.0)
        store.record_metric("exp1", "control", "metric", 7.0)

        results = store.get_experiment_results("exp1")
        assert results["control"]["metric"]["count"] == 3
        sig = results["significance"]["metric"]
        assert sig["significant"] is False


# ── JSON serialization ──────────────────────────────────────────


class TestABTestingSerialization:
    """Test JSON serialization and deserialization."""

    @pytest.fixture
    def populated_store(self):
        store = ABTestingStore()
        store.create_experiment(
            "exp1", "Test 1", "Description 1", "param1",
            control_value="a", variant_value="b",
        )
        store.record_metric("exp1", "control", "metric1", 5.0)
        store.record_metric("exp1", "variant", "metric1", 8.0)
        yield store
        store.clear()

    def test_to_json_valid(self, populated_store):
        j = populated_store.to_json()
        data = json.loads(j)
        assert "experiments" in data
        assert "metrics" in data
        assert "exp1" in data["experiments"]

    def test_roundtrip(self, populated_store):
        j = populated_store.to_json()

        new_store = ABTestingStore()
        new_store.from_json(j)

        exp = new_store.get_experiment("exp1")
        assert exp is not None
        assert exp.name == "Test 1"
        assert exp.control_value == "a"

    def test_roundtrip_preserves_metrics(self, populated_store):
        j = populated_store.to_json()

        new_store = ABTestingStore()
        new_store.from_json(j)

        results = new_store.get_experiment_results("exp1")
        assert results["control"]["metric1"]["count"] == 1
        assert results["variant"]["metric1"]["count"] == 1

    def test_clear(self, populated_store):
        populated_store.clear()
        assert populated_store.list_experiments(active_only=False) == []
        assert populated_store.get_experiment_results("exp1") is None


# ── Module-level singleton ──────────────────────────────────────


class TestModuleSingleton:
    """Test the module-level ab_store singleton."""

    def test_singleton_exists(self):
        assert ab_store is not None
        assert isinstance(ab_store, ABTestingStore)

    def test_singleton_is_functional(self):
        ab_store.clear()
        ab_store.create_experiment("test_exp", "Test", "d", "p")
        assert ab_store.get_experiment("test_exp") is not None
        ab_store.clear()


# ── Engagement metrics integration ──────────────────────────────


class TestEngagementMetrics:
    """Test all engagement metric types the framework should support."""

    @pytest.fixture(autouse=True)
    def store(self):
        store = ABTestingStore()
        store.create_experiment("eng_test", "Engagement", "d", "p")
        yield store
        store.clear()

    def test_conversation_length_metric(self, store):
        store.record_metric("eng_test", "control", "conversation_length", 4.0)
        results = store.get_experiment_results("eng_test")
        assert "conversation_length" in results["control"]

    def test_engagement_rate_metric(self, store):
        store.record_metric("eng_test", "control", "engagement_rate", 0.75)
        results = store.get_experiment_results("eng_test")
        assert results["control"]["engagement_rate"]["mean"] == 0.75

    def test_deal_completion_rate_metric(self, store):
        store.record_metric("eng_test", "variant", "deal_completion_rate", 0.6)
        results = store.get_experiment_results("eng_test")
        assert results["variant"]["deal_completion_rate"]["count"] == 1

    def test_relationship_change_metric(self, store):
        store.record_metric("eng_test", "control", "avg_relationship_change", 5.2)
        results = store.get_experiment_results("eng_test")
        assert results["control"]["avg_relationship_change"]["mean"] == 5.2

    def test_session_duration_metric(self, store):
        store.record_metric("eng_test", "variant", "session_duration", 25.0)
        results = store.get_experiment_results("eng_test")
        assert results["variant"]["session_duration"]["mean"] == 25.0
