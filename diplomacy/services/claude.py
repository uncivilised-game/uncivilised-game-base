"""Claude API client wrapper for diplomacy responses.

Handles calling the Anthropic API, parsing action tags from responses,
and providing fallback responses when the API is unavailable.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from diplomacy.config import settings
from diplomacy.personalities import CHARACTER_PROFILES, build_system_prompt

logger = logging.getLogger("diplomacy.claude")

# Lazy init — created on first call
_client = None


def _get_client():
    global _client
    if _client is None:
        from anthropic import Anthropic

        _client = Anthropic(api_key=settings.anthropic_api_key or None)
    return _client


ACTION_PATTERN = re.compile(r"\[ACTION:\s*(\{.*?\})\s*\]", re.DOTALL)


def parse_action(response_text: str) -> tuple[str, dict | None]:
    """Parse and strip [ACTION: {...}] from a response.

    Returns (clean_text, action_dict_or_none).
    """
    match = ACTION_PATTERN.search(response_text)
    action = None
    clean = response_text

    if match:
        try:
            action = json.loads(match.group(1))
            clean = response_text[: match.start()].strip()
        except json.JSONDecodeError:
            action = None

    # Strip partial ACTION tags that didn't close
    if "[ACTION:" in clean:
        clean = clean[: clean.index("[ACTION:")].strip()

    return clean, action


async def generate_response(
    faction_id: str,
    message: str,
    game_state: dict | None = None,
    conversation_history: list[dict] | None = None,
    model: str = "claude-sonnet-4-20250514",
    system_prompt: str | None = None,
) -> dict[str, Any]:
    """Generate a diplomacy response via Claude API.

    Args:
        system_prompt: If provided, overrides the default prompt built from
            faction personality + game state. Used by the enhanced prompt
            builder in Phase 4.

    Returns a dict with keys: reply, action, character, character_type, model, error (optional).
    """
    profile = CHARACTER_PROFILES.get(faction_id)
    if not profile:
        return {"reply": "Unknown faction.", "action": None, "error": "unknown_faction"}

    if system_prompt is None:
        system_prompt = build_system_prompt(faction_id, game_state)

    # Build message history
    messages = []
    if conversation_history:
        for entry in conversation_history[-settings.max_conversation_history :]:
            messages.append(
                {"role": entry.get("role", "user"), "content": entry["content"]}
            )
    messages.append({"role": "user", "content": message})

    try:
        client = _get_client()
        response = client.messages.create(
            model=model,
            max_tokens=settings.max_tokens_response,
            system=system_prompt,
            messages=messages,
        )
        raw_reply = response.content[0].text
        clean_reply, action = parse_action(raw_reply)

        return {
            "reply": clean_reply,
            "action": action,
            "character": profile["name"],
            "character_type": profile["type"],
            "model": model,
        }
    except Exception as e:
        logger.error(f"Claude API error for {faction_id}: {e}")
        # Graceful degradation
        return {
            "reply": f"*{profile['name']} seems distracted and does not respond clearly.* (Connection issue — try again.)",
            "action": None,
            "character": profile["name"],
            "character_type": profile["type"],
            "model": model,
            "error": str(e),
        }
