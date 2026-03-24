# Uncivilised — Diplomacy Module

Server-side diplomacy infrastructure for Uncivilised. This is the game's core USP and proprietary moat.

## Architecture

```
Player → API Gateway (auth + rate limit)
  → L1 Exact Cache (Redis)
  → L2 Semantic Cache (Redis + embeddings)
  → L3 Template Cache (in-memory)
  → Claude API (Sonnet/Haiku)
  → Response Variation (synonym swap + game state injection)
  → Interaction Logger (PostgreSQL)
  → Response to Player
```

## Project Structure

```
diplomacy/
├── main.py                 # FastAPI app, lifespan, app factory
├── config.py               # Settings from environment variables
├── models.py               # Pydantic request/response models
├── personalities.py        # 6 faction personality profiles + system prompt builder
├── requirements.txt        # Python dependencies
├── README.md               # This file
├── routes/
│   └── diplomacy.py        # POST /api/diplomacy/chat, GET /stats, POST /session
├── services/
│   ├── cache.py            # L1/L2/L3 three-tier cache system
│   ├── claude.py           # Claude API client, action parser
│   ├── logging_service.py  # Interaction logging (DB + in-memory fallback)
│   └── variation.py        # Synonym swap + game state injection
├── middleware/
│   ├── auth.py             # Session-scoped API key auth
│   ├── rate_limit.py       # 5 msg/min/player, 200 msg/game
│   └── request_logger.py   # Request timing + logging
├── db/
│   ├── supabase.py         # PostgreSQL client + schema (asyncpg)
│   └── redis.py            # Redis client (Upstash-compatible)
├── templates/
│   └── data.py             # ~100 pre-generated response templates
└── tests/
    ├── test_auth.py
    ├── test_cache.py
    ├── test_claude.py
    ├── test_rate_limit.py
    └── test_variation.py
```

## Setup

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...          # Claude API key (already in use)

# Database (optional — app works without)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...
SUPABASE_DB_URL=postgresql://user:pass@db.xxx.supabase.co:5432/postgres

# Redis (optional — caching disabled without)
UPSTASH_REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379
UPSTASH_REDIS_TOKEN=xxx

# Embeddings for L2 semantic cache (optional)
OPENAI_API_KEY=sk-...

# Auth
SESSION_SECRET=change-me-in-production
```

### Install Dependencies

```bash
pip install -r diplomacy/requirements.txt
```

### Run Standalone (Development)

```bash
uvicorn diplomacy.main:app --reload --port 8001
```

### Run Tests

```bash
cd uncivilised-game
python -m pytest diplomacy/tests/ -v
```

## API Endpoints

### `POST /api/diplomacy/chat`

Main conversation endpoint. Requires Bearer token auth.

**Request:**
```json
{
  "faction_id": "shadow_kael",
  "message": "I'll give you 50 gold if you attack Thane",
  "game_state": {
    "turn": 25,
    "gold": 150,
    "military": 45,
    "relationship": 15,
    "at_war": false,
    "techs": ["writing", "archery"],
    "cities": 2,
    "units": 8
  }
}
```

**Response:**
```json
{
  "response": "Kael leans forward. Fifty gold to point my blades at the Iron Marshal? Make it eighty...",
  "reply": "...",
  "action": {
    "type": "counter_trade",
    "give": "attack_target:commander_thane",
    "receive": "gold:80"
  },
  "interaction_id": "int-abc-123",
  "model": "sonnet",
  "cache_hit": false,
  "cache_tier": null,
  "character": "Warlord Kael",
  "character_type": "spy"
}
```

### `POST /api/diplomacy/session`

Create a session token.

```json
{ "player_id": "visitor-abc", "game_id": "game-123" }
```

Returns: `{ "token": "...", "player_id": "...", "expires_in": 7200 }`

### `GET /api/diplomacy/stats`

Cache performance statistics.

```json
{
  "total_requests": 1500,
  "l1_hits": 450,
  "l2_hits": 150,
  "l3_hits": 300,
  "misses": 600,
  "l1_rate": 30.0,
  "l2_rate": 10.0,
  "l3_rate": 20.0,
  "miss_rate": 40.0
}
```

### `GET /api/diplomacy/factions`

List available factions.

## Caching Tiers

| Tier | Method | Key/Trigger | Target Latency |
|------|--------|-------------|----------------|
| L1 | Exact match | `faction_id:msg_hash:rel_bucket:phase` | < 50ms |
| L2 | Semantic similarity | Embedding cosine > 0.92 | < 500ms |
| L3 | Template match | Category detection + variable substitution | < 10ms |
| Miss | Claude API | Full model inference | < 6s (Sonnet) |

## Rate Limits

- **5 messages per minute** per player
- **200 messages per game session**
- Returns `429 Too Many Requests` with retry info

## Graceful Degradation

The module is designed to work with or without external services:

- **No database**: Interactions logged to in-memory buffer
- **No Redis**: Caching disabled, all requests go to Claude API
- **No embedding API**: L2 semantic cache disabled, L1 and L3 still work
- **Claude API down**: Returns a fallback "distracted" response

## Security

- All faction personality prompts are server-side only
- Player IDs are hashed (SHA-256) before storage for anonymisation
- Session tokens expire after 2 hours
- Model weights, training data, and embeddings are never exposed to the client

## License

Proprietary. The diplomacy module is NOT covered by the AGPL license that applies to the game code.
