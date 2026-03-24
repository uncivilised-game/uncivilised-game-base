"""Diplomacy module — FastAPI application.

This module extends the existing server.py with a proper modular structure.
It can be mounted as a sub-application or run standalone for development.

Usage:
    # Standalone (dev)
    uvicorn diplomacy.main:app --reload --port 8001

    # Mounted in server.py
    from diplomacy.main import create_diplomacy_app
    app.mount("/", create_diplomacy_app())
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from diplomacy.config import settings
from diplomacy.db.redis import redis_client
from diplomacy.db.supabase import db
from diplomacy.middleware.auth import AuthMiddleware
from diplomacy.middleware.rate_limit import RateLimitMiddleware
from diplomacy.middleware.request_logger import RequestLoggerMiddleware
from diplomacy.routes.diplomacy import router as diplomacy_router
from diplomacy.routes.evaluation import router as evaluation_router
from diplomacy.services.cache import load_templates
from diplomacy.templates.data import TEMPLATES

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("diplomacy")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events for the diplomacy module."""
    logger.info("Diplomacy module starting up...")

    # Connect to databases (graceful — app works without them)
    await db.connect()
    if db.is_connected:
        await db.init_schema()

    await redis_client.connect()

    # Load L3 templates into memory
    load_templates(TEMPLATES)

    logger.info(
        "Diplomacy module ready | DB=%s | Redis=%s",
        "connected" if db.is_connected else "offline",
        "connected" if redis_client.is_connected else "offline",
    )

    yield

    # Shutdown
    logger.info("Diplomacy module shutting down...")
    await redis_client.disconnect()
    await db.disconnect()


def create_diplomacy_app() -> FastAPI:
    """Create and configure the diplomacy FastAPI app.

    Returns a fully configured app that can be mounted or run standalone.
    """
    app = FastAPI(
        title="Uncivilised Diplomacy Module",
        version="1.0.0",
        lifespan=lifespan,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Middleware stack — order matters (outermost first)
    # 1. Request logging (outermost — logs everything)
    app.add_middleware(RequestLoggerMiddleware)
    # 2. Auth (sets player_id on request.state)
    app.add_middleware(AuthMiddleware)
    # 3. Rate limiting (uses player_id from auth)
    app.add_middleware(RateLimitMiddleware)

    # Routes
    app.include_router(diplomacy_router)
    app.include_router(evaluation_router)

    return app


# Default app instance for standalone running
app = create_diplomacy_app()
