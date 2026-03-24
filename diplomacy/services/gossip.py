"""Cross-faction awareness (gossip) system.

Factions reference what they've "heard" about the player from other factions,
creating the illusion of a connected diplomatic world.
"""

from __future__ import annotations

import hashlib
import logging
import random
from typing import Any

logger = logging.getLogger("diplomacy.gossip")

# Each faction type filters gossip differently
GOSSIP_FILTERS: dict[str, list[str]] = {
    "spy": ["war", "alliance", "betrayal", "trade", "military", "deal", "peace", "attack", "territory", "gift"],
    "general": ["war", "military", "attack", "battle", "defense", "troops", "betrayal"],
    "tycoon": ["trade", "deal", "gold", "embargo", "gift", "tribute", "economy", "debt"],
    "leader": ["territory", "alliance", "war", "expansion", "treaty", "peace", "border"],
    "pirate": ["war", "trade", "betrayal", "attack", "fleet", "sea", "naval", "alliance", "battle"],
    "rebel": ["oppression", "people", "reform", "tyranny", "rebellion", "justice", "alliance", "betrayal"],
}

# Gossip probability — 40% base chance
GOSSIP_PROBABILITY = 0.4

# All faction IDs for cross-referencing
ALL_FACTIONS = [
    "emperor_valerian",
    "shadow_kael",
    "merchant_prince_castellan",
    "pirate_queen_elara",
    "commander_thane",
    "rebel_leader_sera",
]

FACTION_NAMES = {
    "emperor_valerian": "High Chieftain Aethelred",
    "shadow_kael": "Warlord Kael",
    "merchant_prince_castellan": "Queen Tariq",
    "pirate_queen_elara": "Pythia Ione",
    "commander_thane": "Commander Thane",
    "rebel_leader_sera": "High Priestess 'Ula",
}

# How each faction type frames gossip
GOSSIP_FRAMING: dict[str, str] = {
    "spy": "My agents report that",
    "general": "Field intelligence indicates that",
    "tycoon": "My trade contacts tell me that",
    "leader": "Our diplomats have learned that",
    "pirate": "The waves whisper that",
    "rebel": "Word among the people is that",
}


def _generate_gossip_items(
    faction_id: str,
    faction_type: str,
    game_state: dict,
) -> list[str]:
    """Generate potential gossip items from game_state.

    Returns a list of gossip strings relevant to the faction type.
    """
    items: list[str] = []

    relationships = game_state.get("relationship", {})
    if isinstance(relationships, (int, float)):
        relationships = {}

    alliances = game_state.get("alliances", {})
    if not isinstance(alliances, dict):
        alliances = {}

    at_war = game_state.get("at_war", False)
    recent_events = game_state.get("recent_events", [])
    trade_deals = game_state.get("trade_deals", {})
    if not isinstance(trade_deals, dict):
        trade_deals = {}

    allowed_topics = GOSSIP_FILTERS.get(faction_type, [])

    # Check relationships with other factions
    for other_id in ALL_FACTIONS:
        if other_id == faction_id:
            continue
        other_name = FACTION_NAMES.get(other_id, other_id)

        other_rel = relationships.get(other_id, 0)
        if isinstance(other_rel, (int, float)):
            # Strong alliance
            if other_rel >= 50 and _topic_allowed("alliance", allowed_topics):
                items.append(
                    f"the player has forged a strong alliance with {other_name}"
                )
            # Hostile
            elif other_rel <= -30 and _topic_allowed("war", allowed_topics):
                items.append(
                    f"the player is on hostile terms with {other_name}"
                )

        # Active alliance
        if alliances.get(other_id) and _topic_allowed("alliance", allowed_topics):
            items.append(
                f"the player has an active alliance with {other_name}"
            )

        # Active trade deal
        if trade_deals.get(other_id) and _topic_allowed("trade", allowed_topics):
            items.append(
                f"the player has an ongoing trade deal with {other_name}"
            )

    # War status
    if at_war and _topic_allowed("war", allowed_topics):
        items.append("the player is currently waging war")

    # Recent events
    for event in recent_events:
        event_lower = event.lower()
        for topic in allowed_topics:
            if topic in event_lower:
                items.append(f"the player {event_lower}")
                break

    return items


def _topic_allowed(topic: str, allowed: list[str]) -> bool:
    """Check if a topic is in the allowed list for a faction type."""
    return topic in allowed


def _deterministic_should_gossip(faction_id: str, game_state: dict | None) -> bool:
    """Determine if gossip should trigger, using game state for pseudo-randomness.

    Uses a hash-based approach for consistency within a single game state,
    while still achieving ~40% trigger rate.
    """
    if not game_state:
        return False

    turn = game_state.get("turn", 0)
    seed = f"{faction_id}:{turn}"
    hash_val = int(hashlib.md5(seed.encode()).hexdigest()[:8], 16)
    return (hash_val % 100) < (GOSSIP_PROBABILITY * 100)


def generate_gossip(
    faction_id: str,
    faction_type: str,
    game_state: dict | None,
    force: bool = False,
) -> str:
    """Generate gossip section for a faction's system prompt.

    Args:
        faction_id: The faction receiving the gossip
        faction_type: The faction's type (spy, general, tycoon, etc.)
        game_state: Current game state dict
        force: If True, skip probability check (useful for testing)

    Returns:
        A formatted DIPLOMATIC INTELLIGENCE section, or empty string.
    """
    if not game_state:
        return ""

    # Probability gate
    if not force and not _deterministic_should_gossip(faction_id, game_state):
        return ""

    items = _generate_gossip_items(faction_id, faction_type, game_state)
    if not items:
        return ""

    # Select 1-2 items
    random.seed(f"{faction_id}:{game_state.get('turn', 0)}")
    selected = random.sample(items, min(2, len(items)))

    framing = GOSSIP_FRAMING.get(faction_type, "Word has reached you that")

    lines = ["\nDIPLOMATIC INTELLIGENCE:"]
    for item in selected:
        lines.append(f"- {framing} {item}.")
    lines.append("Reference this intelligence naturally in conversation if relevant — do not recite it mechanically.")

    return "\n".join(lines)
