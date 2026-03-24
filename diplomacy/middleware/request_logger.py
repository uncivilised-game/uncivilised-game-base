"""Request logging middleware for all /api/diplomacy/* endpoints.

Logs timestamp, player_id, endpoint, HTTP method, latency, and status code.
"""

from __future__ import annotations

import logging
import time

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

logger = logging.getLogger("diplomacy.request")


class RequestLoggerMiddleware(BaseHTTPMiddleware):
    """Log every request to /api/diplomacy/* with timing data."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if not request.url.path.startswith("/api/diplomacy"):
            return await call_next(request)

        start = time.perf_counter()
        player_id = getattr(request.state, "player_id", "unknown")

        try:
            response = await call_next(request)
        except Exception:
            latency_ms = int((time.perf_counter() - start) * 1000)
            logger.error(
                "request_error | %s %s | player=%s | latency=%dms",
                request.method,
                request.url.path,
                player_id,
                latency_ms,
            )
            raise

        latency_ms = int((time.perf_counter() - start) * 1000)
        logger.info(
            "request | %s %s | status=%d | player=%s | latency=%dms",
            request.method,
            request.url.path,
            response.status_code,
            player_id,
            latency_ms,
        )

        # Inject latency header for observability
        response.headers["X-Diplomacy-Latency-Ms"] = str(latency_ms)
        return response
