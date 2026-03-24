"""Three-tier caching system for diplomacy responses.

L1 — Exact Match (Redis): faction_id + message_hash + relationship_bucket + game_phase
L2 — Semantic  (Redis + embeddings): cosine similarity > 0.92
L3 — Templates (in-memory): pre-generated response templates with variable substitution
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import re
import struct
from typing import Any

from diplomacy.config import settings
from diplomacy.db.redis import redis_client

logger = logging.getLogger("diplomacy.cache")

# ── Cache statistics (in-memory, exposed via /api/diplomacy/stats) ──

_stats = {
    "total_requests": 0,
    "l1_hits": 0,
    "l2_hits": 0,
    "l3_hits": 0,
    "misses": 0,
}

# Track last response per player to avoid repeats
_last_response: dict[str, str] = {}


def get_stats() -> dict:
    total = _stats["total_requests"] or 1  # avoid division by zero
    return {
        **_stats,
        "l1_rate": round(_stats["l1_hits"] / total * 100, 1),
        "l2_rate": round(_stats["l2_hits"] / total * 100, 1),
        "l3_rate": round(_stats["l3_hits"] / total * 100, 1),
        "miss_rate": round(_stats["misses"] / total * 100, 1),
    }


def reset_stats():
    for k in _stats:
        _stats[k] = 0


# ── Helpers ─────────────────────────────────────────────────────


def _normalize_message(msg: str) -> str:
    """Normalize a player message for hashing: lowercase, strip punctuation, trim."""
    msg = msg.lower().strip()
    msg = re.sub(r"[^\w\s]", "", msg)
    msg = re.sub(r"\s+", " ", msg)
    return msg


def _message_hash(msg: str) -> str:
    """SHA-256 hash of a normalized message."""
    return hashlib.sha256(_normalize_message(msg).encode()).hexdigest()[:16]


def relationship_bucket(value: int) -> str:
    """Map a relationship value (-100 to +100) to a bucket name."""
    if value <= -50:
        return "hostile"
    elif value <= -10:
        return "unfriendly"
    elif value <= 9:
        return "neutral"
    elif value <= 49:
        return "friendly"
    else:
        return "allied"


def game_phase(turn: int) -> str:
    """Map a turn number to a game phase."""
    if turn <= 15:
        return "early"
    elif turn <= 40:
        return "mid"
    else:
        return "late"


def _l1_cache_key(faction_id: str, message: str, rel_value: int, turn: int) -> str:
    """Build the L1 exact match cache key."""
    return (
        f"diplomacy:l1:{faction_id}"
        f":{_message_hash(message)}"
        f":{relationship_bucket(rel_value)}"
        f":{game_phase(turn)}"
    )


def _pick_variant(variants: list[str], player_id: str) -> str:
    """Pick a variant, avoiding the last response sent to this player."""
    last = _last_response.get(player_id)
    candidates = [v for v in variants if v != last] or variants
    chosen = random.choice(candidates)
    _last_response[player_id] = chosen
    return chosen


# ── L1: Exact Match Cache ──────────────────────────────────────


async def l1_get(
    faction_id: str, message: str, rel_value: int, turn: int, player_id: str
) -> dict | None:
    """Try L1 exact match cache. Returns response dict or None."""
    key = _l1_cache_key(faction_id, message, rel_value, turn)
    data = await redis_client.get_json(key)
    if data and isinstance(data, dict) and "variants" in data:
        variants = data["variants"]
        if variants:
            chosen = _pick_variant(variants, player_id)
            return {
                "reply": chosen,
                "action": data.get("action"),
                "cache_tier": "L1",
            }
    return None


async def l1_store(
    faction_id: str,
    message: str,
    rel_value: int,
    turn: int,
    response_text: str,
    action: dict | None = None,
) -> None:
    """Store a response in L1 cache, appending as a variant (up to 5)."""
    key = _l1_cache_key(faction_id, message, rel_value, turn)
    existing = await redis_client.get_json(key)

    if existing and isinstance(existing, dict):
        variants = existing.get("variants", [])
        if response_text not in variants and len(variants) < 5:
            variants.append(response_text)
        existing["variants"] = variants
        await redis_client.set_json(key, existing, settings.l1_cache_ttl)
    else:
        data = {
            "variants": [response_text],
            "action": action,
            "faction_id": faction_id,
        }
        await redis_client.set_json(key, data, settings.l1_cache_ttl)


# ── L2: Semantic Cache ─────────────────────────────────────────

# Optional numpy/httpx for embedding calculations
try:
    import numpy as np

    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False


async def _get_embedding(text: str) -> list[float] | None:
    """Get embedding vector for a text using OpenAI-compatible API."""
    if not settings.embedding_api_key:
        return None
    try:
        import httpx

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {settings.embedding_api_key}"},
                json={
                    "model": settings.embedding_model,
                    "input": text,
                    "dimensions": settings.embedding_dimensions,
                },
                timeout=5.0,
            )
            resp.raise_for_status()
            return resp.json()["data"][0]["embedding"]
    except Exception as e:
        logger.error(f"Embedding API error: {e}")
        return None


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    if HAS_NUMPY:
        va, vb = np.array(a), np.array(b)
        denom = np.linalg.norm(va) * np.linalg.norm(vb)
        if denom == 0:
            return 0.0
        return float(np.dot(va, vb) / denom)
    else:
        # Pure Python fallback
        dot = sum(x * y for x, y in zip(a, b))
        mag_a = sum(x * x for x in a) ** 0.5
        mag_b = sum(x * x for x in b) ** 0.5
        if mag_a == 0 or mag_b == 0:
            return 0.0
        return dot / (mag_a * mag_b)


def _pack_embedding(emb: list[float]) -> str:
    """Pack embedding to compact hex string for Redis storage."""
    return struct.pack(f"{len(emb)}f", *emb).hex()


def _unpack_embedding(hex_str: str, dim: int) -> list[float]:
    """Unpack embedding from hex string."""
    return list(struct.unpack(f"{dim}f", bytes.fromhex(hex_str)))


async def l2_get(
    faction_id: str, message: str, player_id: str
) -> dict | None:
    """Try L2 semantic cache. Returns response dict or None."""
    if not HAS_NUMPY and not settings.embedding_api_key:
        return None

    embedding = await _get_embedding(_normalize_message(message))
    if not embedding:
        return None

    # Scan for semantic cache entries for this faction
    keys = await redis_client.scan_keys(f"diplomacy:l2:{faction_id}:*", count=200)
    best_score = 0.0
    best_data = None

    for key in keys:
        data = await redis_client.get_json(key)
        if not data or "embedding" not in data:
            continue
        cached_emb = _unpack_embedding(data["embedding"], settings.embedding_dimensions)
        score = _cosine_similarity(embedding, cached_emb)
        if score > best_score:
            best_score = score
            best_data = data

    if best_score >= settings.l2_semantic_threshold and best_data:
        variants = best_data.get("variants", [])
        if variants:
            chosen = _pick_variant(variants, player_id)
            return {
                "reply": chosen,
                "action": best_data.get("action"),
                "cache_tier": "L2",
                "similarity": round(best_score, 4),
            }

    return None


async def l2_store(
    faction_id: str,
    message: str,
    response_text: str,
    action: dict | None = None,
) -> None:
    """Store a response with its embedding in L2 semantic cache."""
    normalized = _normalize_message(message)
    embedding = await _get_embedding(normalized)
    if not embedding:
        return

    msg_hash = _message_hash(message)
    key = f"diplomacy:l2:{faction_id}:{msg_hash}"

    existing = await redis_client.get_json(key)
    if existing and isinstance(existing, dict):
        variants = existing.get("variants", [])
        if response_text not in variants and len(variants) < 5:
            variants.append(response_text)
        existing["variants"] = variants
        await redis_client.set_json(key, existing, settings.l2_cache_ttl)
    else:
        data = {
            "variants": [response_text],
            "action": action,
            "embedding": _pack_embedding(embedding),
            "faction_id": faction_id,
            "original_message": normalized,
        }
        await redis_client.set_json(key, data, settings.l2_cache_ttl)


# ── L3: Template Cache (in-memory) ─────────────────────────────

# Templates loaded from diplomacy/templates/data.py at startup
_templates: dict[str, dict[str, list[dict]]] = {}
# Structure: { faction_id: { category: [ {text, variables} ] } }


def load_templates(templates: dict[str, dict[str, list[dict]]]) -> None:
    """Load pre-generated templates into the in-memory cache."""
    global _templates
    _templates = templates
    total = sum(
        len(tpls) for cats in templates.values() for tpls in cats.values()
    )
    logger.info(f"Loaded {total} L3 templates across {len(templates)} factions")


def _substitute_variables(template: str, game_state: dict | None = None) -> str:
    """Replace template variables with game state values."""
    if not game_state:
        return template

    gs = game_state if isinstance(game_state, dict) else {}
    substitutions = {
        "{player_name}": gs.get("player_name", "Traveller"),
        "{gold_amount}": str(gs.get("gold", "???")),
        "{military_strength}": str(gs.get("military", "???")),
        "{turn_number}": str(gs.get("turn", "???")),
        "{cities_count}": str(gs.get("cities", "???")),
        "{relationship_descriptor}": relationship_bucket(
            gs.get("relationship", 0) if isinstance(gs.get("relationship"), int) else 0
        ),
        "{faction_name}": gs.get("faction_name", "your people"),
        "{units_count}": str(gs.get("units", "???")),
    }

    result = template
    for var, val in substitutions.items():
        result = result.replace(var, val)
    return result


def _detect_category(message: str, faction_id: str, game_state: dict | None) -> str | None:
    """Detect which template category matches the player message."""
    msg_lower = message.lower().strip()

    # First contact detection
    if game_state:
        gs = game_state if isinstance(game_state, dict) else {}
        rel = gs.get("relationship", 0)
        if isinstance(rel, dict):
            rel = rel.get(faction_id, 0)
        # Very first message with neutral relationship = first contact
        if rel == 0 and any(
            kw in msg_lower
            for kw in ["hello", "greetings", "hi ", "who are you", "introduce"]
        ):
            return "first_contact"

    # Acknowledgments (check before trade to avoid "deal" false positives)
    if any(kw in msg_lower for kw in ["thank", "ok", "agreed", "accept", "yes", "sure", "fine"]):
        return "acknowledgment"

    # Trade-related
    if any(kw in msg_lower for kw in ["trade", "gold", "buy", "sell", "offer", "deal", "exchange", "resource"]):
        return "trade"

    # War/peace
    if any(kw in msg_lower for kw in ["war", "peace", "attack", "ceasefire", "surrender", "fight", "battle"]):
        return "war_peace"

    return None


async def l3_get(
    faction_id: str, message: str, game_state: dict | None, player_id: str
) -> dict | None:
    """Try L3 template cache. Returns response dict or None."""
    if faction_id not in _templates:
        return None

    category = _detect_category(message, faction_id, game_state)
    if not category:
        return None

    faction_templates = _templates[faction_id].get(category, [])
    if not faction_templates:
        return None

    # Pick a random template, substitute variables
    template_entry = random.choice(faction_templates)
    text = _substitute_variables(template_entry["text"], game_state)

    chosen = _pick_variant([text], player_id)  # dedup tracking
    return {
        "reply": chosen,
        "action": template_entry.get("action"),
        "cache_tier": "L3",
    }


# ── Unified cache lookup ───────────────────────────────────────


async def cache_lookup(
    faction_id: str,
    message: str,
    rel_value: int,
    turn: int,
    game_state: dict | None,
    player_id: str,
) -> dict | None:
    """Try all cache tiers in order: L1 → L2 → L3. Returns first hit or None."""
    _stats["total_requests"] += 1

    # L1: Exact match
    result = await l1_get(faction_id, message, rel_value, turn, player_id)
    if result:
        _stats["l1_hits"] += 1
        return result

    # L2: Semantic similarity
    result = await l2_get(faction_id, message, player_id)
    if result:
        _stats["l2_hits"] += 1
        return result

    # L3: Template match
    result = await l3_get(faction_id, message, game_state, player_id)
    if result:
        _stats["l3_hits"] += 1
        return result

    _stats["misses"] += 1
    return None


async def cache_store(
    faction_id: str,
    message: str,
    rel_value: int,
    turn: int,
    response_text: str,
    action: dict | None = None,
) -> None:
    """Store a response in both L1 and L2 caches."""
    await l1_store(faction_id, message, rel_value, turn, response_text, action)
    await l2_store(faction_id, message, response_text, action)
