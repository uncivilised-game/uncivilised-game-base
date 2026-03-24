"""Training data exporter — converts interaction logs to fine-tuning datasets.

Exports interaction logs from simulation runs (or production) into formats
suitable for model fine-tuning:
  - JSONL for SFT (supervised fine-tuning)
  - Conversation pairs for RLHF
  - Anonymised — player_id hashed, email stripped

Per briefing Phase 6: "Export interaction data for analysis (anonymised)"
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("diplomacy.simulation.exporter")


def _anonymise_player_id(player_id: str, salt: str = "uncivilised") -> str:
    """Hash player_id for anonymisation."""
    return hashlib.sha256(f"{player_id}:{salt}".encode()).hexdigest()[:16]


def export_sft_dataset(
    interactions_file: str,
    output_file: str,
    min_response_length: int = 20,
    exclude_cache_hits: bool = True,
) -> int:
    """Export interactions as SFT training data.

    Format: {"messages": [{"role": "system", ...}, {"role": "user", ...}, {"role": "assistant", ...}]}

    Args:
        interactions_file: Path to JSONL file from simulation runner
        output_file: Path to write SFT dataset
        min_response_length: Minimum response length to include
        exclude_cache_hits: Whether to exclude cached responses

    Returns:
        Number of training examples exported
    """
    from diplomacy.personalities import CHARACTER_PROFILES, INTERACTION_RULES

    input_path = Path(interactions_file)
    if not input_path.exists():
        logger.error(f"Input file not found: {interactions_file}")
        return 0

    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    count = 0
    with open(input_path) as fin, open(output_path, "w") as fout:
        for line in fin:
            try:
                interaction = json.loads(line.strip())
            except json.JSONDecodeError:
                continue

            # Skip errors
            if "error" in interaction:
                continue

            # Skip cache hits if requested (they're repetitive for training)
            if exclude_cache_hits and interaction.get("cache_hit"):
                continue

            response = interaction.get("response", "")
            if len(response) < min_response_length:
                continue

            faction_id = interaction.get("faction_id", "")
            profile = CHARACTER_PROFILES.get(faction_id)
            if not profile:
                continue

            # Build training example
            system_prompt = f"{profile['personality']}\n\n{INTERACTION_RULES}"

            # Add action to response if present
            full_response = response
            action = interaction.get("action")
            if action and isinstance(action, dict) and action.get("type") != "none":
                full_response += f'\n[ACTION: {json.dumps(action)}]'

            example = {
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": interaction.get("message", "")},
                    {"role": "assistant", "content": full_response},
                ],
                "metadata": {
                    "faction_id": faction_id,
                    "player_archetype": interaction.get("archetype", "unknown"),
                    "player_id_hash": _anonymise_player_id(
                        interaction.get("agent_id", "unknown")
                    ),
                    "turn": interaction.get("turn", 0),
                    "model_used": interaction.get("model", "unknown"),
                    "complexity": interaction.get("complexity"),
                },
            }

            fout.write(json.dumps(example) + "\n")
            count += 1

    logger.info(f"Exported {count} SFT training examples to {output_file}")
    return count


def export_conversation_pairs(
    interactions_file: str,
    output_file: str,
) -> int:
    """Export consecutive interactions as conversation pairs for RLHF.

    Groups interactions by agent+faction into multi-turn conversations.

    Returns:
        Number of conversation pairs exported
    """
    input_path = Path(interactions_file)
    if not input_path.exists():
        logger.error(f"Input file not found: {interactions_file}")
        return 0

    # Group by agent+faction
    conversations: dict[str, list[dict]] = {}
    with open(input_path) as f:
        for line in f:
            try:
                interaction = json.loads(line.strip())
            except json.JSONDecodeError:
                continue

            if "error" in interaction or not interaction.get("response"):
                continue

            key = f"{interaction.get('agent_id', '')}:{interaction.get('faction_id', '')}"
            if key not in conversations:
                conversations[key] = []
            conversations[key].append(interaction)

    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    count = 0
    with open(output_path, "w") as fout:
        for key, turns in conversations.items():
            if len(turns) < 2:
                continue

            messages = []
            for turn in turns:
                messages.append({"role": "user", "content": turn["message"]})
                messages.append({"role": "assistant", "content": turn["response"]})

            pair = {
                "conversation": messages,
                "metadata": {
                    "player_id_hash": _anonymise_player_id(
                        turns[0].get("agent_id", "unknown")
                    ),
                    "player_archetype": turns[0].get("archetype", "unknown"),
                    "faction_id": turns[0].get("faction_id", ""),
                    "num_turns": len(turns),
                    "final_relationship": turns[-1].get("turn", 0),
                },
            }

            fout.write(json.dumps(pair) + "\n")
            count += 1

    logger.info(f"Exported {count} conversation pairs to {output_file}")
    return count


def generate_training_report(interactions_file: str) -> dict:
    """Generate a summary report of interaction data for training analysis.

    Returns stats useful for evaluating training data quality.
    """
    input_path = Path(interactions_file)
    if not input_path.exists():
        return {"error": "file not found"}

    stats = {
        "total_interactions": 0,
        "by_faction": {},
        "by_archetype": {},
        "by_model": {},
        "avg_response_length": 0,
        "action_distribution": {},
        "cache_hit_rate": 0,
        "unique_messages": set(),
    }

    total_response_length = 0
    cache_hits = 0

    with open(input_path) as f:
        for line in f:
            try:
                interaction = json.loads(line.strip())
            except json.JSONDecodeError:
                continue

            if "error" in interaction:
                continue

            stats["total_interactions"] += 1

            # By faction
            faction = interaction.get("faction_id", "unknown")
            stats["by_faction"][faction] = stats["by_faction"].get(faction, 0) + 1

            # By archetype
            archetype = interaction.get("archetype", "unknown")
            stats["by_archetype"][archetype] = stats["by_archetype"].get(archetype, 0) + 1

            # By model
            model = interaction.get("model", "unknown")
            stats["by_model"][model] = stats["by_model"].get(model, 0) + 1

            # Response length
            response = interaction.get("response", "")
            total_response_length += len(response)

            # Action distribution
            action = interaction.get("action")
            if isinstance(action, dict):
                atype = action.get("type", "none")
                stats["action_distribution"][atype] = stats["action_distribution"].get(atype, 0) + 1

            # Cache hits
            if interaction.get("cache_hit"):
                cache_hits += 1

            # Unique messages
            stats["unique_messages"].add(interaction.get("message", ""))

    total = max(stats["total_interactions"], 1)
    stats["avg_response_length"] = round(total_response_length / total, 1)
    stats["cache_hit_rate"] = round(cache_hits / total * 100, 1)
    stats["unique_message_count"] = len(stats["unique_messages"])
    del stats["unique_messages"]  # Not serialisable

    return stats
