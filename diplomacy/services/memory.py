"""Diplomatic memory — extracts key facts from conversation threads.

Uses the existing conversation threading from Phase 3 as the data source.
Compresses facts into a MEMORY section for the system prompt (<100 tokens).
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger("diplomacy.memory")

# Maximum character length for memory section (~100 tokens ≈ ~400 chars)
MAX_MEMORY_CHARS = 400

# Keywords that indicate memorable content
DEAL_KEYWORDS = [
    "gold", "trade", "offer", "deal", "exchange", "payment",
    "tribute", "alliance", "pact", "treaty", "agreement",
]
PROMISE_KEYWORDS = [
    "promise", "swear", "vow", "pledge", "commit", "guarantee",
    "will do", "agree to", "you have my word",
]
INSULT_KEYWORDS = [
    "fool", "weak", "coward", "traitor", "liar", "barbarian",
    "pathetic", "disgrace", "insult", "threaten",
]
TOPIC_KEYWORDS = [
    "alliance", "war", "peace", "trade", "territory", "army",
    "fleet", "border", "marriage", "spy", "intel", "attack",
    "defense", "reform", "people", "rebellion",
]


def _classify_message(content: str) -> list[str]:
    """Classify a message into memory-worthy categories.

    Returns list of categories: 'deal', 'promise', 'insult', 'topic'.
    """
    content_lower = content.lower()
    categories = []

    if any(kw in content_lower for kw in DEAL_KEYWORDS):
        categories.append("deal")
    if any(kw in content_lower for kw in PROMISE_KEYWORDS):
        categories.append("promise")
    if any(kw in content_lower for kw in INSULT_KEYWORDS):
        categories.append("insult")
    if any(kw in content_lower for kw in TOPIC_KEYWORDS):
        categories.append("topic")

    return categories


def _extract_fact(message: dict) -> str | None:
    """Extract a key fact from a single message.

    Returns a short summary or None if not memorable.
    """
    content = message.get("content", "")
    role = message.get("role", "user")
    categories = _classify_message(content)

    if not categories:
        return None

    # Build a short summary
    prefix = "Player" if role == "user" else "Faction"

    # Truncate content to key fragment
    # Take first sentence or first 80 chars
    text = content.strip()
    first_sentence = text.split(".")[0].split("!")[0].split("?")[0]
    if len(first_sentence) > 80:
        first_sentence = first_sentence[:77] + "..."

    category_label = categories[0]
    if category_label == "deal":
        return f"{prefix} discussed trade/deal: \"{first_sentence}\""
    elif category_label == "promise":
        return f"{prefix} made a promise: \"{first_sentence}\""
    elif category_label == "insult":
        return f"{prefix} hostile exchange: \"{first_sentence}\""
    elif category_label == "topic":
        return f"Discussed: {first_sentence}"

    return None


def extract_memories(conversation_thread: list[dict]) -> list[str]:
    """Extract key facts from a conversation thread.

    Args:
        conversation_thread: List of message dicts with 'role' and 'content'.

    Returns:
        List of short fact strings, most recent last.
    """
    if not conversation_thread:
        return []

    facts = []
    for msg in conversation_thread:
        fact = _extract_fact(msg)
        if fact:
            facts.append(fact)

    return facts


def build_memory_section(conversation_thread: list[dict]) -> str:
    """Build a MEMORY prompt section from conversation thread.

    Extracts key facts and compresses them to <100 tokens (~400 chars).
    Returns empty string if no memorable content found.
    """
    facts = extract_memories(conversation_thread)
    if not facts:
        return ""

    # Build memory section, trimming to fit budget
    header = "\nMEMORY (key facts from previous exchanges):"
    lines = []
    total_len = len(header)

    # Add facts from most recent backward until budget is exhausted
    for fact in reversed(facts):
        line = f"\n- {fact}"
        if total_len + len(line) > MAX_MEMORY_CHARS:
            break
        lines.insert(0, line)
        total_len += len(line)

    if not lines:
        return ""

    return header + "".join(lines)
