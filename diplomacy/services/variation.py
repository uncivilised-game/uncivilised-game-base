"""Response variation system.

Provides synonym swapping and game-state variable injection so cached
responses feel fresh on repeat encounters.
"""

from __future__ import annotations

import random
import re
from typing import Any

# Synonym groups for flavour-text variation
_SYNONYM_GROUPS = [
    ["agree", "accept", "consent", "concur"],
    ["refuse", "decline", "reject", "deny"],
    ["gold", "coin", "wealth", "treasure"],
    ["war", "conflict", "battle", "hostilities"],
    ["peace", "truce", "harmony", "ceasefire"],
    ["ally", "friend", "partner", "comrade"],
    ["enemy", "foe", "adversary", "rival"],
    ["strong", "powerful", "mighty", "formidable"],
    ["weak", "feeble", "vulnerable", "frail"],
    ["trade", "deal", "exchange", "bargain"],
    ["army", "forces", "legions", "troops"],
    ["offer", "propose", "suggest", "present"],
    ["betray", "deceive", "double-cross", "backstab"],
    ["trust", "faith", "confidence", "reliance"],
    ["threat", "warning", "menace", "ultimatum"],
    ["kingdom", "realm", "domain", "territory"],
    ["perhaps", "maybe", "possibly", "perchance"],
    ["indeed", "certainly", "absolutely", "without doubt"],
    ["consider", "ponder", "contemplate", "weigh"],
]

# Build lookup: word → synonym group
_SYNONYMS: dict[str, list[str]] = {}
for group in _SYNONYM_GROUPS:
    for word in group:
        _SYNONYMS[word] = group


def _synonym_swap(text: str, swap_probability: float = 0.3) -> str:
    """Randomly replace words with synonyms for variation."""
    words = text.split()
    result = []
    for word in words:
        lower = word.lower().strip(".,!?;:'\"")
        if lower in _SYNONYMS and random.random() < swap_probability:
            # Preserve original casing/punctuation
            prefix = ""
            suffix = ""
            for ch in word:
                if ch.isalpha():
                    break
                prefix += ch
            for ch in reversed(word):
                if ch.isalpha():
                    break
                suffix = ch + suffix

            replacement = random.choice(
                [s for s in _SYNONYMS[lower] if s != lower]
            )
            # Match casing
            if word[len(prefix) : len(prefix) + 1].isupper():
                replacement = replacement.capitalize()
            result.append(f"{prefix}{replacement}{suffix}")
        else:
            result.append(word)
    return " ".join(result)


def _inject_game_state(text: str, game_state: dict | None) -> str:
    """Inject current game state values into response text.

    Replaces generic references with specific numbers where appropriate.
    """
    if not game_state:
        return text

    gs = game_state if isinstance(game_state, dict) else {}

    # Replace gold references with actual amounts
    gold = gs.get("gold")
    if gold is not None:
        text = re.sub(
            r"\byour coffers\b",
            f"your {gold} gold",
            text,
            count=1,
            flags=re.IGNORECASE,
        )

    # Replace military references
    mil = gs.get("military")
    if mil is not None:
        text = re.sub(
            r"\byour forces\b",
            f"your {mil}-strong forces",
            text,
            count=1,
            flags=re.IGNORECASE,
        )

    # Add turn awareness
    turn = gs.get("turn")
    if turn and turn > 80:
        text = re.sub(
            r"\bthe time\b",
            "the waning turns",
            text,
            count=1,
            flags=re.IGNORECASE,
        )

    return text


def apply_variation(
    text: str,
    game_state: dict | None = None,
    swap_probability: float = 0.25,
) -> str:
    """Apply synonym swapping and game-state injection to a response."""
    text = _synonym_swap(text, swap_probability)
    text = _inject_game_state(text, game_state)
    return text
