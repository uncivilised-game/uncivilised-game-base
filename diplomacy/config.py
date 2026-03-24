"""Diplomacy module configuration — all settings from environment variables."""

import os
from dataclasses import dataclass, field


@dataclass
class Settings:
    # Claude API
    anthropic_api_key: str = field(
        default_factory=lambda: os.getenv("ANTHROPIC_API_KEY", "")
    )

    # Supabase PostgreSQL
    supabase_url: str = field(
        default_factory=lambda: os.getenv("SUPABASE_URL", "")
    )
    supabase_key: str = field(
        default_factory=lambda: os.getenv("SUPABASE_KEY", "")
    )
    supabase_db_url: str = field(
        default_factory=lambda: os.getenv(
            "SUPABASE_DB_URL",
            "postgresql://user:pass@localhost:5432/uncivilised",
        )
    )

    # Upstash Redis
    upstash_redis_url: str = field(
        default_factory=lambda: os.getenv("UPSTASH_REDIS_URL", "")
    )
    upstash_redis_token: str = field(
        default_factory=lambda: os.getenv("UPSTASH_REDIS_TOKEN", "")
    )

    # Rate limiting
    rate_limit_per_minute: int = 5
    rate_limit_per_game: int = 200

    # Cache settings
    l1_cache_ttl: int = 86400  # 24 hours in seconds
    l2_semantic_threshold: float = 0.92
    l2_cache_ttl: int = 86400

    # Embedding model
    embedding_api_key: str = field(
        default_factory=lambda: os.getenv("OPENAI_API_KEY", "")
    )
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 256  # compact embeddings for speed

    # Session
    session_secret: str = field(
        default_factory=lambda: os.getenv("SESSION_SECRET", "dev-secret-change-me")
    )
    session_ttl: int = 7200  # 2 hours

    # Performance
    max_conversation_history: int = 8
    max_tokens_response: int = 200


settings = Settings()
