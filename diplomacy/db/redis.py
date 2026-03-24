"""Upstash Redis client for caching layers.

Supports both Upstash REST-style Redis and standard Redis connections.
Falls back gracefully when Redis is unavailable.
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger("diplomacy.redis")

try:
    import redis.asyncio as aioredis

    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False


class RedisClient:
    """Async Redis client wrapping Upstash or any Redis-compatible server."""

    def __init__(self, url: str = "", token: str = ""):
        self._url = url
        self._token = token
        self._client: Any = None
        self._connected = False

    async def connect(self) -> bool:
        """Establish Redis connection. Returns False if unavailable."""
        if not HAS_REDIS or not self._url:
            logger.warning("Redis not configured — caching disabled")
            return False
        try:
            # Upstash uses rediss:// (TLS) URLs; standard redis also works
            self._client = aioredis.from_url(
                self._url,
                password=self._token if self._token else None,
                decode_responses=True,
                socket_connect_timeout=5,
            )
            # Verify connection
            await self._client.ping()
            self._connected = True
            logger.info("Connected to Redis")
            return True
        except Exception as e:
            logger.warning(f"Redis connection failed: {e} — caching disabled")
            self._connected = False
            return False

    async def disconnect(self) -> None:
        if self._client:
            await self._client.close()
            self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    # ── Basic ops ───────────────────────────────────────────────

    async def get(self, key: str) -> str | None:
        if not self._connected:
            return None
        try:
            return await self._client.get(key)
        except Exception as e:
            logger.error(f"Redis GET error: {e}")
            return None

    async def set(self, key: str, value: str, ttl: int | None = None) -> bool:
        if not self._connected:
            return False
        try:
            if ttl:
                await self._client.setex(key, ttl, value)
            else:
                await self._client.set(key, value)
            return True
        except Exception as e:
            logger.error(f"Redis SET error: {e}")
            return False

    async def delete(self, key: str) -> bool:
        if not self._connected:
            return False
        try:
            await self._client.delete(key)
            return True
        except Exception as e:
            logger.error(f"Redis DELETE error: {e}")
            return False

    async def incr(self, key: str) -> int:
        if not self._connected:
            return 0
        try:
            return await self._client.incr(key)
        except Exception as e:
            logger.error(f"Redis INCR error: {e}")
            return 0

    async def expire(self, key: str, ttl: int) -> bool:
        if not self._connected:
            return False
        try:
            await self._client.expire(key, ttl)
            return True
        except Exception as e:
            logger.error(f"Redis EXPIRE error: {e}")
            return False

    async def ttl(self, key: str) -> int:
        if not self._connected:
            return -1
        try:
            return await self._client.ttl(key)
        except Exception as e:
            logger.error(f"Redis TTL error: {e}")
            return -1

    # ── JSON helpers ────────────────────────────────────────────

    async def get_json(self, key: str) -> Any:
        raw = await self.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    async def set_json(self, key: str, value: Any, ttl: int | None = None) -> bool:
        return await self.set(key, json.dumps(value), ttl)

    # ── Scan for pattern ────────────────────────────────────────

    async def scan_keys(self, pattern: str, count: int = 100) -> list[str]:
        """Scan for keys matching a pattern."""
        if not self._connected:
            return []
        try:
            keys = []
            async for key in self._client.scan_iter(match=pattern, count=count):
                keys.append(key)
                if len(keys) >= count:
                    break
            return keys
        except Exception as e:
            logger.error(f"Redis SCAN error: {e}")
            return []


# Singleton
redis_client = RedisClient()
