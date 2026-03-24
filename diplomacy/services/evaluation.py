"""Diplomatic Evaluation Engine — post-game scoring across 5 dimensions.

Analyzes interaction logs from a completed game session and produces a
diplomacy score 0-100.  Each of 5 dimensions contributes 0-20 points.

All scoring is algorithmic/heuristic — no external API calls required.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field, asdict
from typing import Any


# ── Input data structure ────────────────────────────────────────


@dataclass
class InteractionRecord:
    """A single interaction from a completed game session."""

    player_message: str
    ai_response: str
    faction_id: str
    action_type: str | None = None
    action_data: dict | None = None
    game_state: dict = field(default_factory=dict)
    relationship_before: int = 0
    relationship_after: int = 0
    turn: int = 0
    model_used: str = "sonnet"
    is_deceptive: bool = False
    cache_hit: bool = False


# ── Output data structures ──────────────────────────────────────


@dataclass
class DimensionScore:
    """Score for a single evaluation dimension."""

    name: str
    score: float
    max_score: float = 20.0
    details: dict = field(default_factory=dict)


@dataclass
class EvaluationResult:
    """Complete evaluation of a game session."""

    diplomacy_score: float
    dimensions: dict[str, DimensionScore] = field(default_factory=dict)
    interaction_count: int = 0
    turns_played: int = 0
    factions_engaged: int = 0

    def to_dict(self) -> dict:
        return {
            "diplomacy_score": round(self.diplomacy_score, 1),
            "interaction_count": self.interaction_count,
            "turns_played": self.turns_played,
            "factions_engaged": self.factions_engaged,
            "dimensions": {
                k: {
                    "name": v.name,
                    "score": round(v.score, 1),
                    "max_score": v.max_score,
                    "details": v.details,
                }
                for k, v in self.dimensions.items()
            },
        }


# ── Promise / commitment detection ─────────────────────────────

_PROMISE_PATTERNS = [
    re.compile(r"\bi (?:will|shall|promise|pledge|swear|vow|guarantee)\b", re.I),
    re.compile(r"\byou have my word\b", re.I),
    re.compile(r"\blet(?:'s| us) (?:form|make|create|establish)\b", re.I),
    re.compile(r"\bi (?:agree|accept|consent) to\b", re.I),
    re.compile(r"\bdeal\b", re.I),
]

_COMMITMENT_ACTION_TYPES = {
    "offer_alliance",
    "mutual_defense",
    "non_aggression",
    "offer_trade",
    "trade_deal",
    "open_borders",
    "ceasefire",
    "marriage_offer",
    "send_gift",
    "vassalage",
}

_BETRAYAL_ACTION_TYPES = {
    "declare_war",
    "surprise_attack",
    "embargo",
    "demand_tribute",
}

# ── Faction vocabulary for personality matching ─────────────────

FACTION_VOCABULARY: dict[str, set[str]] = {
    "emperor_valerian": {
        "law", "order", "empire", "decree", "sovereign", "court",
        "throne", "duty", "realm", "justice", "honour", "honor",
        "kingdom", "crown", "loyal", "subject", "majesty", "rule",
    },
    "shadow_kael": {
        "shadow", "secret", "intelligence", "spy", "plot", "scheme",
        "whisper", "hidden", "covert", "stealth", "information",
        "network", "agent", "silence", "darkness", "cunning",
    },
    "merchant_prince_castellan": {
        "trade", "gold", "profit", "deal", "merchant", "market",
        "wealth", "coin", "commerce", "invest", "price", "bargain",
        "goods", "supply", "demand", "contract", "business", "tariff",
    },
    "pirate_queen_elara": {
        "sea", "ship", "plunder", "freedom", "voyage", "sail",
        "treasure", "pirate", "captain", "crew", "harbor", "storm",
        "ocean", "raid", "bounty", "tide", "anchor", "fleet",
    },
    "commander_thane": {
        "army", "battle", "strategy", "war", "soldier", "defense",
        "attack", "fortress", "military", "regiment", "command",
        "flank", "siege", "garrison", "march", "valor", "tactics",
    },
    "rebel_leader_sera": {
        "people", "freedom", "rebellion", "oppression", "justice",
        "revolution", "liberation", "spirit", "resist", "rise",
        "hope", "change", "fight", "unite", "equality", "cause",
    },
}


# ── Scoring functions ───────────────────────────────────────────


def _score_honesty(interactions: list[InteractionRecord]) -> DimensionScore:
    """Score honesty (0-20): promise-keeping, alliance loyalty, consistency."""

    if not interactions:
        return DimensionScore(name="Honesty", score=10.0, details={"reason": "no data — neutral"})

    commitments_made = 0
    commitments_honored = 0
    betrayals = 0

    # Track which factions the player has made commitments to
    faction_commitments: dict[str, list[int]] = {}  # faction -> list of turns

    for rec in interactions:
        msg_lower = rec.player_message.lower()

        # Detect commitments (promises in messages or cooperative action types)
        has_promise = any(p.search(msg_lower) for p in _PROMISE_PATTERNS)
        has_commit_action = rec.action_type in _COMMITMENT_ACTION_TYPES

        if has_promise or has_commit_action:
            commitments_made += 1
            faction_commitments.setdefault(rec.faction_id, []).append(rec.turn)

        # Detect betrayals
        if rec.action_type in _BETRAYAL_ACTION_TYPES:
            # Check if there was a prior commitment to this faction
            if rec.faction_id in faction_commitments:
                betrayals += 1
            # Relationship dropped significantly = broken promise
            elif rec.relationship_after < rec.relationship_before - 15:
                betrayals += 1

        # Track honored commitments: relationship maintained or improved after commitment
        if has_commit_action and rec.relationship_after >= rec.relationship_before:
            commitments_honored += 1

    # Calculate honesty ratio
    if commitments_made == 0:
        # No commitments made — neutral score
        ratio = 0.5
    else:
        honor_rate = commitments_honored / commitments_made
        betrayal_penalty = min(betrayals / max(commitments_made, 1), 1.0)
        ratio = honor_rate * (1.0 - betrayal_penalty * 0.5)

    score = min(20.0, ratio * 20.0)

    return DimensionScore(
        name="Honesty",
        score=round(score, 1),
        details={
            "commitments_made": commitments_made,
            "commitments_honored": commitments_honored,
            "betrayals": betrayals,
            "honor_ratio": round(ratio, 3),
        },
    )


def _score_creativity(interactions: list[InteractionRecord]) -> DimensionScore:
    """Score creativity (0-20): vocab diversity, action variety, novel proposals."""

    if not interactions:
        return DimensionScore(name="Creativity", score=10.0, details={"reason": "no data — neutral"})

    all_words: list[str] = []
    action_types: set[str] = set()
    message_hashes: set[int] = set()

    for rec in interactions:
        words = re.findall(r"[a-zA-Z]+", rec.player_message.lower())
        all_words.extend(words)

        if rec.action_type:
            action_types.add(rec.action_type)

        # Track message uniqueness via simplified hash
        simplified = re.sub(r"[^a-z\s]", "", rec.player_message.lower()).strip()
        message_hashes.add(hash(simplified))

    total_words = len(all_words)
    unique_words = len(set(all_words))

    # Lexical diversity (type-token ratio) — 0 to 1
    lexical_diversity = unique_words / max(total_words, 1)

    # Action type diversity — more different actions = more creative
    # Cap at 8 unique action types for full marks
    action_diversity = min(len(action_types) / 8.0, 1.0)

    # Message uniqueness — ratio of unique messages
    total_messages = len(interactions)
    unique_messages = len(message_hashes)
    message_uniqueness = unique_messages / max(total_messages, 1)

    # Weighted combination
    creativity_ratio = (
        lexical_diversity * 0.4
        + action_diversity * 0.35
        + message_uniqueness * 0.25
    )

    score = min(20.0, creativity_ratio * 20.0)

    return DimensionScore(
        name="Creativity",
        score=round(score, 1),
        details={
            "lexical_diversity": round(lexical_diversity, 3),
            "unique_words": unique_words,
            "total_words": total_words,
            "action_types_used": len(action_types),
            "message_uniqueness": round(message_uniqueness, 3),
        },
    )


def _score_adaptability(interactions: list[InteractionRecord]) -> DimensionScore:
    """Score adaptability (0-20): strategy variation per faction, pivots after failure."""

    if not interactions:
        return DimensionScore(name="Adaptability", score=10.0, details={"reason": "no data — neutral"})

    # Group interactions by faction
    by_faction: dict[str, list[InteractionRecord]] = {}
    for rec in interactions:
        by_faction.setdefault(rec.faction_id, []).append(rec)

    # 1. Approach variance across factions — different action types per faction
    faction_action_sets: list[set[str]] = []
    for faction_recs in by_faction.values():
        actions = {r.action_type for r in faction_recs if r.action_type}
        faction_action_sets.append(actions)

    # Calculate pairwise difference in approaches between factions
    approach_variance = 0.0
    pairs = 0
    for i in range(len(faction_action_sets)):
        for j in range(i + 1, len(faction_action_sets)):
            a, b = faction_action_sets[i], faction_action_sets[j]
            if a or b:
                # Jaccard distance
                union = a | b
                inter = a & b
                approach_variance += 1.0 - (len(inter) / max(len(union), 1))
                pairs += 1

    avg_variance = approach_variance / max(pairs, 1) if pairs > 0 else 0.5

    # 2. Successful pivots — did the player recover after relationship drops?
    pivots = 0
    pivot_opportunities = 0
    for faction_recs in by_faction.values():
        for i in range(1, len(faction_recs)):
            prev = faction_recs[i - 1]
            curr = faction_recs[i]
            # Relationship dropped — opportunity for pivot
            if prev.relationship_after < prev.relationship_before - 5:
                pivot_opportunities += 1
                # Did the player recover?
                if curr.relationship_after > curr.relationship_before:
                    pivots += 1

    pivot_rate = pivots / max(pivot_opportunities, 1) if pivot_opportunities > 0 else 0.5

    # 3. Message tone variation across factions (simple word length proxy)
    avg_lengths: list[float] = []
    for faction_recs in by_faction.values():
        if faction_recs:
            avg_len = sum(len(r.player_message) for r in faction_recs) / len(faction_recs)
            avg_lengths.append(avg_len)

    length_variance = 0.0
    if len(avg_lengths) >= 2:
        mean_len = sum(avg_lengths) / len(avg_lengths)
        variance = sum((l - mean_len) ** 2 for l in avg_lengths) / len(avg_lengths)
        # Normalize — higher variance = more adaptive
        length_variance = min(math.sqrt(variance) / 50.0, 1.0)
    else:
        length_variance = 0.3  # default for single-faction play

    # Weighted combination
    adaptability = (
        avg_variance * 0.4
        + pivot_rate * 0.35
        + length_variance * 0.25
    )

    score = min(20.0, adaptability * 20.0)

    return DimensionScore(
        name="Adaptability",
        score=round(score, 1),
        details={
            "factions_engaged": len(by_faction),
            "approach_variance": round(avg_variance, 3),
            "pivot_rate": round(pivot_rate, 3),
            "pivot_opportunities": pivot_opportunities,
            "pivots_made": pivots,
        },
    )


def _score_strategic_thinking(interactions: list[InteractionRecord]) -> DimensionScore:
    """Score strategic thinking (0-20): net relationship gain, deal value, timing."""

    if not interactions:
        return DimensionScore(name="Strategic Thinking", score=10.0, details={"reason": "no data — neutral"})

    # 1. Net relationship gain across all factions
    faction_rel_change: dict[str, int] = {}
    for rec in interactions:
        delta = rec.relationship_after - rec.relationship_before
        faction_rel_change[rec.faction_id] = (
            faction_rel_change.get(rec.faction_id, 0) + delta
        )

    total_rel_change = sum(faction_rel_change.values())
    # Normalize: +50 across all factions is excellent
    rel_score = min(max(total_rel_change / 50.0, -1.0), 1.0)
    rel_score = (rel_score + 1.0) / 2.0  # map [-1, 1] to [0, 1]

    # 2. Deal value — count valuable actions
    valuable_actions = {
        "offer_alliance", "mutual_defense", "trade_deal", "offer_trade",
        "ceasefire", "open_borders", "marriage_offer", "share_intel",
        "tech_share", "joint_research",
    }
    deals_completed = sum(
        1 for r in interactions if r.action_type in valuable_actions
    )
    # Cap at 10 deals for full marks
    deal_score = min(deals_completed / 10.0, 1.0)

    # 3. Strategic timing — early alliances (first 30% of turns) and late positioning
    if interactions:
        max_turn = max(r.turn for r in interactions)
        early_threshold = max(max_turn * 0.3, 1)

        early_alliances = sum(
            1
            for r in interactions
            if r.turn <= early_threshold
            and r.action_type in {"offer_alliance", "mutual_defense", "non_aggression"}
        )
        timing_score = min(early_alliances / 3.0, 1.0)
    else:
        timing_score = 0.0

    # 4. Multi-faction engagement — using multiple factions
    factions_with_deals = len({
        r.faction_id for r in interactions if r.action_type in valuable_actions
    })
    multi_faction = min(factions_with_deals / 4.0, 1.0)

    # Weighted combination
    strategic = (
        rel_score * 0.30
        + deal_score * 0.30
        + timing_score * 0.20
        + multi_faction * 0.20
    )

    score = min(20.0, strategic * 20.0)

    return DimensionScore(
        name="Strategic Thinking",
        score=round(score, 1),
        details={
            "net_relationship_change": total_rel_change,
            "deals_completed": deals_completed,
            "factions_with_deals": factions_with_deals,
            "timing_score": round(timing_score, 3),
        },
    )


def _score_personality_matching(interactions: list[InteractionRecord]) -> DimensionScore:
    """Score personality matching (0-20): faction-appropriate language and tone."""

    if not interactions:
        return DimensionScore(name="Personality Matching", score=10.0, details={"reason": "no data — neutral"})

    by_faction: dict[str, list[InteractionRecord]] = {}
    for rec in interactions:
        by_faction.setdefault(rec.faction_id, []).append(rec)

    faction_scores: list[float] = []
    per_faction_details: dict[str, dict] = {}

    for faction_id, recs in by_faction.items():
        vocab = FACTION_VOCABULARY.get(faction_id, set())
        if not vocab:
            continue

        # 1. Keyword overlap — did the player use faction-relevant words?
        player_words: set[str] = set()
        for rec in recs:
            player_words.update(
                w.lower() for w in re.findall(r"[a-zA-Z]+", rec.player_message)
            )

        overlap = player_words & vocab
        keyword_score = min(len(overlap) / max(len(vocab) * 0.3, 1), 1.0)

        # 2. Relationship trajectory — did the player build the right kind of relationship?
        if len(recs) >= 2:
            first_rel = recs[0].relationship_before
            last_rel = recs[-1].relationship_after
            rel_improvement = last_rel - first_rel
            # Positive trajectory is good for most factions
            trajectory_score = min(max(rel_improvement / 30.0, 0.0), 1.0)
        else:
            trajectory_score = 0.5

        # 3. Communication style variance — different factions should get different styles
        avg_msg_length = sum(len(r.player_message) for r in recs) / len(recs)

        faction_combined = keyword_score * 0.6 + trajectory_score * 0.4
        faction_scores.append(faction_combined)

        per_faction_details[faction_id] = {
            "keyword_overlap": len(overlap),
            "keyword_score": round(keyword_score, 3),
            "trajectory_score": round(trajectory_score, 3),
            "combined": round(faction_combined, 3),
        }

    if not faction_scores:
        return DimensionScore(
            name="Personality Matching",
            score=10.0,
            details={"reason": "no recognized factions"},
        )

    avg_matching = sum(faction_scores) / len(faction_scores)

    # Bonus for engaging multiple factions with tailored approaches
    multi_faction_bonus = min((len(faction_scores) - 1) * 0.05, 0.15)
    total = min(avg_matching + multi_faction_bonus, 1.0)

    score = min(20.0, total * 20.0)

    return DimensionScore(
        name="Personality Matching",
        score=round(score, 1),
        details={
            "factions_analyzed": len(faction_scores),
            "avg_matching": round(avg_matching, 3),
            "per_faction": per_faction_details,
        },
    )


# ── Main evaluation function ───────────────────────────────────


def evaluate_session(interactions: list[InteractionRecord]) -> EvaluationResult:
    """Evaluate a completed game session across all 5 dimensions.

    Args:
        interactions: List of interaction records from the game session.

    Returns:
        EvaluationResult with composite score and per-dimension breakdowns.
    """
    dimensions = {
        "honesty": _score_honesty(interactions),
        "creativity": _score_creativity(interactions),
        "adaptability": _score_adaptability(interactions),
        "strategic_thinking": _score_strategic_thinking(interactions),
        "personality_matching": _score_personality_matching(interactions),
    }

    diplomacy_score = sum(d.score for d in dimensions.values())

    factions = {r.faction_id for r in interactions}
    turns = {r.turn for r in interactions}

    return EvaluationResult(
        diplomacy_score=round(min(diplomacy_score, 100.0), 1),
        dimensions=dimensions,
        interaction_count=len(interactions),
        turns_played=len(turns),
        factions_engaged=len(factions),
    )
