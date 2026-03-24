"""Context window management — compress game state to <200 tokens.

Per briefing: summarise game state to <200 tokens for the context window.
This keeps the model's attention on the conversation, not raw data.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("diplomacy.context")


def _power_descriptor(value: int, thresholds: tuple = (20, 40, 60, 80)) -> str:
    """Map a numeric power value to a natural language descriptor."""
    if value <= thresholds[0]:
        return "negligible"
    elif value <= thresholds[1]:
        return "modest"
    elif value <= thresholds[2]:
        return "considerable"
    elif value <= thresholds[3]:
        return "formidable"
    else:
        return "overwhelming"


def _relationship_word(value: int) -> str:
    """Convert relationship value to evocative language."""
    if value <= -60:
        return "sworn enemies"
    elif value <= -30:
        return "hostile"
    elif value <= -10:
        return "distrustful"
    elif value <= 10:
        return "neutral strangers"
    elif value <= 30:
        return "cautiously friendly"
    elif value <= 60:
        return "trusted allies"
    else:
        return "devoted partners"


def _phase_descriptor(turn: int) -> str:
    """Convert turn number to game phase description."""
    if turn <= 10:
        return "the opening moves"
    elif turn <= 25:
        return "the early expansion"
    elif turn <= 50:
        return "the middle game"
    elif turn <= 75:
        return "the late game"
    else:
        return "the endgame — every turn counts"


def compress_game_state(
    game_state: dict | None,
    faction_id: str,
) -> str:
    """Compress a full game state dict into a <200 token narrative summary.

    This summary replaces the raw game state in the system prompt,
    giving the model a natural-language understanding of the situation
    rather than a data dump.
    """
    if not game_state:
        return "No game state information available."

    gs = game_state if isinstance(game_state, dict) else {}

    turn = gs.get("turn", 0)
    gold = gs.get("gold", 0)
    military = gs.get("military", 0)
    cities = gs.get("cities", 1)
    units = gs.get("units", 0)
    population = gs.get("population", 0)
    territory = gs.get("territory", 0)
    at_war = gs.get("at_war", False)
    techs = gs.get("techs", [])

    # Extract relationship for this specific faction
    rel = gs.get("relationship", 0)
    if isinstance(rel, dict):
        rel = rel.get(faction_id, 0)

    # Extract faction-specific diplomacy state
    alliances = gs.get("alliances", {})
    trade_deals = gs.get("trade_deals", {})
    marriages = gs.get("marriages", {})
    defense_pacts = gs.get("defense_pacts", {})
    recent_events = gs.get("recent_events", [])

    faction_alliance = alliances.get(faction_id, None) if isinstance(alliances, dict) else None
    faction_trade = trade_deals.get(faction_id, None) if isinstance(trade_deals, dict) else None
    faction_marriage = marriages.get(faction_id, None) if isinstance(marriages, dict) else None
    faction_defense = defense_pacts.get(faction_id, None) if isinstance(defense_pacts, dict) else None

    # Build compressed summary
    lines = []

    # Phase & power
    lines.append(f"It is {_phase_descriptor(turn)} (turn {turn}/100).")
    lines.append(
        f"The player commands {cities} cit{'y' if cities == 1 else 'ies'}, "
        f"{_power_descriptor(military)} military ({military}), "
        f"and {gold} gold."
    )

    # Relationship
    lines.append(f"Your relationship: {_relationship_word(rel)} ({rel:+d}).")

    # Active diplomatic ties with this faction
    ties = []
    if faction_alliance:
        ties.append(f"active alliance")
    if faction_trade:
        ties.append(f"ongoing trade deal")
    if faction_marriage:
        ties.append(f"marriage bond")
    if faction_defense:
        ties.append(f"mutual defense pact")
    if ties:
        lines.append(f"Active bonds: {', '.join(ties)}.")

    # War status
    if at_war:
        lines.append("The player is currently at war.")

    # Recent events (max 3, condensed)
    if recent_events:
        events_str = "; ".join(recent_events[:3])
        lines.append(f"Recent: {events_str}.")

    # Tech level hint (just count, not full list)
    if techs:
        lines.append(f"The player has researched {len(techs)} technologies.")

    summary = " ".join(lines)

    # Safety check: if somehow too long, truncate
    if len(summary) > 800:  # ~200 tokens ≈ ~800 chars
        summary = summary[:797] + "..."

    return summary


def build_compressed_system_prompt(
    faction_personality: str,
    game_state: dict | None,
    faction_id: str,
    interaction_rules: str,
) -> str:
    """Build a system prompt with compressed game state.

    Replaces the verbose game state dump with a narrative summary,
    keeping total context window usage efficient.
    """
    context = compress_game_state(game_state, faction_id)

    return f"""{faction_personality}

CURRENT SITUATION:
{context}

{interaction_rules}"""
