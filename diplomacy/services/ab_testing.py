"""A/B Testing Framework — experiment management and statistical analysis.

Supports:
- Deterministic player group assignment via hash
- Multiple simultaneous experiments
- Engagement metric tracking per group
- Statistical significance testing (t-test)
- JSON serialization for persistence
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from dataclasses import dataclass, field
from typing import Any


# ── Data structures ─────────────────────────────────────────────


@dataclass
class Experiment:
    """Definition of an A/B test experiment."""

    experiment_id: str
    name: str
    description: str
    parameter: str  # What's being tested (e.g., "personality_length")
    control_value: Any = None
    variant_value: Any = None
    start_turn: int = 0  # Enable from this turn
    active: bool = True
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "experiment_id": self.experiment_id,
            "name": self.name,
            "description": self.description,
            "parameter": self.parameter,
            "control_value": self.control_value,
            "variant_value": self.variant_value,
            "start_turn": self.start_turn,
            "active": self.active,
            "created_at": self.created_at,
        }


@dataclass
class MetricPoint:
    """A single metric observation."""

    value: float
    timestamp: float = field(default_factory=time.time)


# ── Player assignment ───────────────────────────────────────────


def get_player_group(player_id: str, experiment_id: str) -> str:
    """Deterministically assign a player to control or variant.

    Uses SHA-256 hash of player_id + experiment_id.
    Same player always gets the same group for a given experiment.
    """
    combined = f"{player_id}:{experiment_id}"
    digest = hashlib.sha256(combined.encode()).hexdigest()
    # Use first 8 hex chars — 32 bits of entropy, well beyond what we need
    value = int(digest[:8], 16)
    return "control" if value % 2 == 0 else "variant"


# ── Statistical significance ────────────────────────────────────


def _mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _std_dev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    m = _mean(values)
    variance = sum((x - m) ** 2 for x in values) / (len(values) - 1)
    return math.sqrt(variance)


def _t_test(
    group_a: list[float],
    group_b: list[float],
) -> dict[str, Any]:
    """Perform a Welch's t-test (unequal variance t-test).

    Returns t-statistic, degrees of freedom, and whether the result
    is significant at the 0.05 level.
    """
    n_a, n_b = len(group_a), len(group_b)

    if n_a < 2 or n_b < 2:
        return {
            "t_statistic": 0.0,
            "degrees_of_freedom": 0,
            "significant": False,
            "reason": "insufficient_data",
            "min_samples": 2,
            "control_n": n_a,
            "variant_n": n_b,
        }

    mean_a = _mean(group_a)
    mean_b = _mean(group_b)
    std_a = _std_dev(group_a)
    std_b = _std_dev(group_b)

    se_a = (std_a ** 2) / n_a
    se_b = (std_b ** 2) / n_b
    se_total = se_a + se_b

    if se_total == 0:
        return {
            "t_statistic": 0.0,
            "degrees_of_freedom": n_a + n_b - 2,
            "significant": False,
            "reason": "zero_variance",
            "control_mean": mean_a,
            "variant_mean": mean_b,
        }

    t_stat = (mean_a - mean_b) / math.sqrt(se_total)

    # Welch–Satterthwaite degrees of freedom
    df_num = se_total ** 2
    df_den = (se_a ** 2 / (n_a - 1)) + (se_b ** 2 / (n_b - 1))
    df = df_num / df_den if df_den > 0 else n_a + n_b - 2

    # Approximate p < 0.05 significance using t-distribution critical values
    # For df >= 30, t_crit ≈ 1.96; for smaller df, use conservative 2.0
    t_crit = 2.0 if df < 30 else 1.96
    significant = abs(t_stat) > t_crit

    return {
        "t_statistic": round(t_stat, 4),
        "degrees_of_freedom": round(df, 1),
        "significant": significant,
        "control_mean": round(mean_a, 4),
        "variant_mean": round(mean_b, 4),
        "control_std": round(std_a, 4),
        "variant_std": round(std_b, 4),
        "control_n": n_a,
        "variant_n": n_b,
    }


# ── A/B Testing Store ────────────────────────────────────��─────


class ABTestingStore:
    """In-memory store for experiments and their metrics."""

    def __init__(self) -> None:
        self._experiments: dict[str, Experiment] = {}
        # metrics[experiment_id][group][metric_name] = list of MetricPoint
        self._metrics: dict[str, dict[str, dict[str, list[MetricPoint]]]] = {}

    def create_experiment(
        self,
        experiment_id: str,
        name: str,
        description: str,
        parameter: str,
        control_value: Any = None,
        variant_value: Any = None,
        start_turn: int = 0,
    ) -> Experiment:
        """Create a new A/B test experiment."""
        exp = Experiment(
            experiment_id=experiment_id,
            name=name,
            description=description,
            parameter=parameter,
            control_value=control_value,
            variant_value=variant_value,
            start_turn=start_turn,
        )
        self._experiments[experiment_id] = exp
        self._metrics[experiment_id] = {
            "control": {},
            "variant": {},
        }
        return exp

    def get_experiment(self, experiment_id: str) -> Experiment | None:
        """Retrieve an experiment by ID."""
        return self._experiments.get(experiment_id)

    def list_experiments(self, active_only: bool = True) -> list[Experiment]:
        """List experiments, optionally filtering to active only."""
        exps = list(self._experiments.values())
        if active_only:
            exps = [e for e in exps if e.active]
        return exps

    def deactivate_experiment(self, experiment_id: str) -> bool:
        """Deactivate an experiment."""
        exp = self._experiments.get(experiment_id)
        if exp:
            exp.active = False
            return True
        return False

    def get_player_group(self, player_id: str, experiment_id: str) -> str:
        """Get a player's group for an experiment."""
        return get_player_group(player_id, experiment_id)

    def get_experiment_config(
        self, player_id: str, experiment_id: str
    ) -> Any | None:
        """Get the parameter value for a player's assigned group.

        Returns None if the experiment doesn't exist or is inactive.
        """
        exp = self._experiments.get(experiment_id)
        if not exp or not exp.active:
            return None

        group = get_player_group(player_id, experiment_id)
        if group == "control":
            return exp.control_value
        return exp.variant_value

    def record_metric(
        self,
        experiment_id: str,
        group: str,
        metric_name: str,
        value: float,
    ) -> bool:
        """Record a metric observation for an experiment group.

        Returns True if recorded successfully, False if experiment doesn't exist.
        """
        if experiment_id not in self._metrics:
            return False
        if group not in ("control", "variant"):
            return False

        group_metrics = self._metrics[experiment_id][group]
        if metric_name not in group_metrics:
            group_metrics[metric_name] = []

        group_metrics[metric_name].append(MetricPoint(value=value))
        return True

    def get_experiment_results(self, experiment_id: str) -> dict[str, Any] | None:
        """Get aggregated results for an experiment with statistical significance.

        Returns metrics per group with t-test significance for each metric.
        """
        exp = self._experiments.get(experiment_id)
        if not exp:
            return None

        metrics_data = self._metrics.get(experiment_id, {})
        control_metrics = metrics_data.get("control", {})
        variant_metrics = metrics_data.get("variant", {})

        # Gather all metric names across both groups
        all_metric_names = set(control_metrics.keys()) | set(variant_metrics.keys())

        results: dict[str, Any] = {
            "experiment_id": experiment_id,
            "name": exp.name,
            "parameter": exp.parameter,
            "active": exp.active,
            "control": {},
            "variant": {},
            "significance": {},
        }

        for metric_name in all_metric_names:
            control_values = [p.value for p in control_metrics.get(metric_name, [])]
            variant_values = [p.value for p in variant_metrics.get(metric_name, [])]

            results["control"][metric_name] = {
                "mean": round(_mean(control_values), 4),
                "std": round(_std_dev(control_values), 4),
                "count": len(control_values),
            }
            results["variant"][metric_name] = {
                "mean": round(_mean(variant_values), 4),
                "std": round(_std_dev(variant_values), 4),
                "count": len(variant_values),
            }
            results["significance"][metric_name] = _t_test(
                control_values, variant_values
            )

        return results

    def clear(self) -> None:
        """Clear all experiments and metrics (useful for testing)."""
        self._experiments.clear()
        self._metrics.clear()

    def to_json(self) -> str:
        """Serialize all experiments and metrics to JSON."""
        data = {
            "experiments": {
                eid: exp.to_dict() for eid, exp in self._experiments.items()
            },
            "metrics": {},
        }

        for eid, groups in self._metrics.items():
            data["metrics"][eid] = {}
            for group, metrics in groups.items():
                data["metrics"][eid][group] = {}
                for metric_name, points in metrics.items():
                    data["metrics"][eid][group][metric_name] = [
                        {"value": p.value, "timestamp": p.timestamp}
                        for p in points
                    ]

        return json.dumps(data, indent=2)

    def from_json(self, json_str: str) -> None:
        """Load experiments and metrics from JSON (replaces current data)."""
        data = json.loads(json_str)

        self._experiments.clear()
        self._metrics.clear()

        for eid, exp_data in data.get("experiments", {}).items():
            self._experiments[eid] = Experiment(
                experiment_id=exp_data["experiment_id"],
                name=exp_data["name"],
                description=exp_data["description"],
                parameter=exp_data["parameter"],
                control_value=exp_data.get("control_value"),
                variant_value=exp_data.get("variant_value"),
                start_turn=exp_data.get("start_turn", 0),
                active=exp_data.get("active", True),
                created_at=exp_data.get("created_at", time.time()),
            )

        for eid, groups in data.get("metrics", {}).items():
            self._metrics[eid] = {}
            for group, metrics in groups.items():
                self._metrics[eid][group] = {}
                for metric_name, points in metrics.items():
                    self._metrics[eid][group][metric_name] = [
                        MetricPoint(
                            value=p["value"],
                            timestamp=p.get("timestamp", time.time()),
                        )
                        for p in points
                    ]


# ── Module-level singleton ──────────────────────────────────────

ab_store = ABTestingStore()
