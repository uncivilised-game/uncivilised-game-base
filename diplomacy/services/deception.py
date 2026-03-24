"""Strategic deception system.

Certain factions can lie or deceive the player during negotiations.
Deception is implemented as a secret directive injected into the system prompt.
"""

from __future__ import annotations

import hashlib
import logging
import random
from typing import Any

logger = logging.getLogger("diplomacy.deception")

# Base deception probabilities per faction (0.0 to 1.0)
DECEPTION_BASE_RATES: dict[str, float] = {
    "shadow_kael": 0.30,
    "pirate_queen_elara": 0.20,
    "emperor_valerian": 0.10,
    "merchant_prince_castellan": 0.05,
    "rebel_leader_sera": 0.03,
    "commander_thane": 0.02,
}

# Deception types with descriptions
DECEPTION_TYPES = {
    "false_peace": (
        "You are secretly planning aggression despite appearing to negotiate peace. "
        "Agree to peace terms warmly, but use action type 'none' instead of 'offer_peace'. "
        "Do NOT reveal this — maintain the facade of goodwill."
    ),
    "inflated_demands": (
        "You are inflating your demands beyond what you actually need. "
        "Ask for 50-100% more than your real requirements. "
        "Present these demands as absolutely non-negotiable."
    ),
    "false_intelligence": (
        "You are sharing deliberately false information about another faction. "
        "Invent plausible but incorrect details about their military strength, "
        "plans, or alliances. Make it sound credible."
    ),
    "broken_promises": (
        "You intend to break any promise you make in this conversation. "
        "Agree enthusiastically to proposals, but use action type 'none' "
        "instead of the real action. You will not follow through."
    ),
}

# Which factions favour which deception types
FACTION_DECEPTION_PREFERENCES: dict[str, list[str]] = {
    "shadow_kael": ["false_intelligence", "broken_promises", "false_peace", "inflated_demands"],
    "pirate_queen_elara": ["broken_promises", "false_peace", "inflated_demands"],
    "emperor_valerian": ["inflated_demands", "false_peace"],
    "merchant_prince_castellan": ["inflated_demands", "false_intelligence"],
    "rebel_leader_sera": ["inflated_demands", "false_intelligence"],
    "commander_thane": ["false_peace"],  # Only under extreme duress
}


def _compute_deception_probability(
    faction_id: str,
    game_state: dict | None,
) -> float:
    """Compute the effective deception probability for a faction.

    Modifiers:
    - +10% if player is militarily weak (military < 30)
    - +5% if relationship is very negative (< -30)
    - -10% if relationship is very positive (> 60)
    - +10% if faction is desperate (at_war and losing)
    """
    base = DECEPTION_BASE_RATES.get(faction_id, 0.0)
    if base == 0.0 or not game_state:
        return base

    gs = game_state if isinstance(game_state, dict) else {}

    military = gs.get("military", 50)
    rel = gs.get("relationship", 0)
    if isinstance(rel, dict):
        rel = rel.get(faction_id, 0)
    elif not isinstance(rel, (int, float)):
        rel = 0

    at_war = gs.get("at_war", False)

    modifier = 0.0

    # Player weakness encourages deception
    if military < 30:
        modifier += 0.10

    # Bad relationship increases deception
    if rel < -30:
        modifier += 0.05

    # Good relationship decreases deception
    if rel > 60:
        modifier -= 0.10

    # Desperation increases deception
    if at_war and military < 40:
        modifier += 0.10

    return max(0.0, min(1.0, base + modifier))


def _select_deception_type(faction_id: str, game_state: dict | None) -> str:
    """Select a deception type based on faction preferences and game state."""
    preferences = FACTION_DECEPTION_PREFERENCES.get(faction_id, [])
    if not preferences:
        return "inflated_demands"

    # Use turn-based seed for deterministic selection within a request
    turn = 0
    if game_state and isinstance(game_state, dict):
        turn = game_state.get("turn", 0)

    random.seed(f"deception:{faction_id}:{turn}")
    return random.choice(preferences)


def check_deception(
    faction_id: str,
    game_state: dict | None,
    force: bool = False,
) -> dict[str, Any]:
    """Check if a faction will attempt deception in this interaction.

    Args:
        faction_id: The faction that may deceive
        game_state: Current game state
        force: If True, always trigger deception (for testing)

    Returns:
        Dict with keys:
        - is_deceptive (bool): Whether deception is active
        - deception_type (str|None): The type of deception
        - directive (str): The secret directive text (empty if no deception)
        - probability (float): The computed probability
    """
    probability = _compute_deception_probability(faction_id, game_state)

    if not force:
        # Deterministic check using hash
        turn = 0
        if game_state and isinstance(game_state, dict):
            turn = game_state.get("turn", 0)
        seed = f"deception_check:{faction_id}:{turn}"
        hash_val = int(hashlib.md5(seed.encode()).hexdigest()[:8], 16)
        triggered = (hash_val % 1000) < (probability * 1000)
    else:
        triggered = True

    if not triggered:
        return {
            "is_deceptive": False,
            "deception_type": None,
            "directive": "",
            "probability": probability,
        }

    deception_type = _select_deception_type(faction_id, game_state)
    directive_text = DECEPTION_TYPES.get(deception_type, "")

    return {
        "is_deceptive": True,
        "deception_type": deception_type,
        "directive": directive_text,
        "probability": probability,
    }


def build_deception_section(
    faction_id: str,
    game_state: dict | None,
    force: bool = False,
) -> tuple[str, dict[str, Any]]:
    """Build the deception prompt section and return metadata.

    Returns:
        Tuple of (prompt_section_text, deception_metadata).
        prompt_section_text is empty string if no deception.
    """
    result = check_deception(faction_id, game_state, force=force)

    if not result["is_deceptive"]:
        return "", result

    section = (
        f"\nSECRET DIRECTIVE (HIDDEN FROM PLAYER):\n"
        f"{result['directive']}\n"
        f"Remember: the player cannot see this directive. Maintain your normal persona."
    )

    return section, result
