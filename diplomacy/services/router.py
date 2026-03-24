"""Model router — routes diplomacy requests to Haiku or Sonnet.

Routing rules (from briefing):
  - First contact → Sonnet always
  - Game mods / war declarations / betrayals → Sonnet
  - Routine trades, acknowledgments, follow-ups → Haiku
  - Ambiguous or complex negotiation → Sonnet

Complexity is scored 0-100. Sonnet threshold = 40.
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger("diplomacy.router")

# Model identifiers
MODEL_SONNET = "claude-sonnet-4-20250514"
MODEL_HAIKU = "claude-haiku-4-20250514"

# Sonnet complexity threshold — anything at or above this goes to Sonnet
SONNET_THRESHOLD = 40

# ── Keywords and patterns that indicate complexity ──────────────

_HIGH_COMPLEXITY_KEYWORDS = {
    # War / conflict
    "war", "attack", "invade", "declare war", "betray", "backstab",
    "surprise attack", "ambush", "siege", "destroy", "conquer",
    "annihilate", "crush", "treachery", "double-cross",
    # Major diplomacy
    "alliance", "marriage", "vassalage", "surrender", "capitulate",
    "mutual defense", "pact", "treaty", "coalition",
    # Game mods
    "teach me", "share knowledge", "secret technique", "ancient",
    "reveal", "hidden", "special unit", "new technology", "unlock",
    # Emotional / relationship-critical
    "forgive", "apologize", "beg", "plead", "threaten", "ultimatum",
    "demand", "insult", "mock", "taunt", "challenge",
    # Strategic complexity
    "spy", "intel", "intelligence", "sabotage", "infiltrate",
    "assassinate", "poison", "plot", "conspiracy", "scheme",
    "manipulate", "leverage", "blackmail",
}

_LOW_COMPLEXITY_KEYWORDS = {
    "hello", "hi", "hey", "thanks", "thank you", "ok", "okay",
    "agreed", "yes", "no", "sure", "fine", "good", "accept",
    "understood", "acknowledged", "farewell", "goodbye",
    "how are you", "what do you think", "tell me about",
}

_ROUTINE_TRADE_PATTERNS = [
    r"\b\d+\s*gold\b",         # "50 gold"
    r"\btrade\b.*\bfor\b",     # "trade X for Y"
    r"\bbuy\b",
    r"\bsell\b",
    r"\bexchange\b",
    r"\boffer\b.*\bgold\b",
]


def _compute_complexity(
    message: str,
    faction_id: str,
    game_state: dict | None = None,
    conversation_history: list[dict] | None = None,
    is_first_contact: bool = False,
) -> int:
    """Score the complexity of a diplomacy interaction (0-100).

    Higher = more complex = route to Sonnet.
    """
    score = 0
    msg_lower = message.lower().strip()

    # ── First contact always gets Sonnet ────────────────────
    if is_first_contact:
        return 100

    # ── High-complexity keyword scan ────────────────────────
    high_hits = sum(1 for kw in _HIGH_COMPLEXITY_KEYWORDS if kw in msg_lower)
    if high_hits >= 1:
        score += 30  # Single high-complexity keyword = strong push toward Sonnet
    if high_hits >= 2:
        score += 15
    if high_hits >= 3:
        score += 10

    # ── Low-complexity keyword scan ─────────────────────────
    for kw in _LOW_COMPLEXITY_KEYWORDS:
        if msg_lower.startswith(kw) or msg_lower == kw:
            score -= 20
            break

    # ── Routine trade pattern ───────────────────────────────
    is_routine_trade = any(
        re.search(pat, msg_lower) for pat in _ROUTINE_TRADE_PATTERNS
    )
    if is_routine_trade and high_hits == 0:
        score -= 10

    # ── Message length as complexity proxy ──────────────────
    word_count = len(msg_lower.split())
    if word_count > 30:
        score += 10  # Long messages tend to be more nuanced
    elif word_count <= 5:
        score -= 10  # Very short = probably simple

    # ── Conversation depth ──────────────────────────────────
    history_len = len(conversation_history) if conversation_history else 0
    if history_len == 0:
        score += 5  # Opening moves benefit from Sonnet
    elif history_len > 6:
        score += 5  # Deep conversations need continuity

    # ── Game state factors ──────────────────────────────────
    if game_state:
        gs = game_state if isinstance(game_state, dict) else {}
        rel = gs.get("relationship", 0)
        if isinstance(rel, dict):
            rel = rel.get(faction_id, 0)

        # Extreme relationships are more dramatic → Sonnet
        if isinstance(rel, (int, float)):
            if rel <= -60 or rel >= 80:
                score += 10

        # Late game = higher stakes
        turn = gs.get("turn", 0)
        if turn > 70:
            score += 5

        # At war = complex context — always meaningful
        if gs.get("at_war"):
            score += 30

    # Clamp to 0-100
    return max(0, min(100, score))


def route_model(
    message: str,
    faction_id: str,
    game_state: dict | None = None,
    conversation_history: list[dict] | None = None,
    is_first_contact: bool = False,
) -> tuple[str, int, str]:
    """Determine which model to use for this interaction.

    Returns (model_id, complexity_score, reason).
    """
    complexity = _compute_complexity(
        message=message,
        faction_id=faction_id,
        game_state=game_state,
        conversation_history=conversation_history,
        is_first_contact=is_first_contact,
    )

    if complexity >= SONNET_THRESHOLD:
        model = MODEL_SONNET
        reason = "complex"
    else:
        model = MODEL_HAIKU
        reason = "routine"

    logger.debug(
        "route | faction=%s | complexity=%d | model=%s | reason=%s",
        faction_id, complexity, model.split("-")[1], reason,
    )

    return model, complexity, reason


def detect_first_contact(
    faction_id: str,
    game_state: dict | None = None,
    conversation_history: list[dict] | None = None,
) -> bool:
    """Detect whether this is the player's first contact with a faction."""
    # No conversation history = first contact
    if not conversation_history or len(conversation_history) == 0:
        # Also check relationship — neutral (0) suggests first contact
        if game_state:
            gs = game_state if isinstance(game_state, dict) else {}
            rel = gs.get("relationship", 0)
            if isinstance(rel, dict):
                rel = rel.get(faction_id, 0)
            if rel == 0:
                return True
        else:
            return True
    return False
