# CLAUDE.md — Context for AI Assistants

> This file exists so Claude (or any LLM) can resume work on this codebase without prior conversation history.

## Project Identity

**Uncivilised** — a browser-based 4X strategy game with LLM-powered diplomacy. Built by Jamie (contact@uncivilized.fun) using Perplexity Computer (which uses Claude under the hood). The repo is being reviewed/maintained by Giovanni (Gio), founder of Fragcolor, who is evaluating the project as a potential collaboration.

**Live URL:** [uncivilized.fun](https://uncivilized.fun)  
**Created:** March 2026  
**Game version:** 5 (`GAME_VERSION = 5` in both `src/constants.js` and `server.py`)

## What This Project Is

A Civilization-style browser game where the core differentiator is **AI-powered diplomacy with emergent game modification**. Six AI faction leaders (powered by Claude Sonnet) can:

1. Negotiate with personality-driven dialogue (alliances, trades, threats, marriages, betrayals)
2. **Dynamically create new game content** through a `game_mod` action system — new units, buildings, techs, resources, map reveals, stat buffs, combat bonuses, and events can be injected into the running game as a result of diplomatic conversation
3. Command their units to execute commitments (attack factions, defend cities, pay tribute)

The game mod system is the novel part. Everything else is a competent Civ clone.

## Architecture Overview

### Frontend (100% client-side)

The frontend is split into **27 ES modules** under `src/`, bundled by esbuild into `game.js` (a build artifact, gitignored). Key modules:

| Module | Lines | Purpose |
|--------|-------|---------|
| `src/constants.js` | ~420 | Game data: terrain, units, buildings, techs, factions |
| `src/render.js` | ~1060 | Canvas2D hex rendering, visibility, minimap |
| `src/terrain-render.js` | ~520 | Painterly terrain detail (noise, splotches, trees) |
| `src/ui-panels.js` | ~1250 | Build, research, civics, victory, selection panels |
| `src/diplomacy.js` | ~960 | Chat UI, AI action processing, trade routes |
| `src/ai.js` | ~720 | AI faction turn logic, commitments |
| `src/turn.js` | ~770 | End-of-turn processing, income, maintenance |
| `src/map.js` | ~675 | Map generation (tectonic plates → biomes → rivers) |
| `src/combat.js` | ~675 | Combat resolution, promotions, city attacks |
| `src/units.js` | ~530 | Unit creation, selection, movement, pathfinding |
| `src/state.js` | ~135 | Shared mutable state (game, canvas, camera, drag) |
| `src/main.js` | ~365 | Entry point, wires modules, exposes window globals |
| `src/input.js` | ~275 | Mouse/touch/keyboard handlers, camera, zoom |
| `src/improvements.js` | ~345 | Worker actions, tile improvements, settlers |
| `src/events.js` | ~490 | Event log, toasts, notifications, rumours |
| `src/game-mods.js` | ~320 | Dynamic game modification from diplomacy |
| `src/save-load.js` | ~180 | Save/load (localStorage + API fallback) |
| `src/leaderboard.js` | ~460 | Leaderboard, username, competition tracking |
| `src/discovery.js` | ~215 | Fog of war, faction discovery, first contact |
| `src/minor-factions.js` | ~280 | Barbarian camps, mystic sects, nomadic tribes |
| `src/resource-icons.js` | ~780 | Canvas-drawn resource icons |

**Build tooling:**
- `esbuild.config.mjs` — bundles `src/main.js` → `game.js` (IIFE format, with sourcemaps)
- `npm run build` — one-shot build
- `npm run watch` — rebuild on file changes
- `npm run dev` — watch + serve via `server.py`

Other frontend files:
- **`style.css`** — All styling, dark theme with gold accents
- **`index.html`** — Title screen + game screen, all panels as hidden divs

### Backend (Python FastAPI)

Two copies exist (they're near-identical, `api/index.py` is the Vercel production version):

- **`server.py`** — local dev server (run with `python server.py`, serves on port 8000)
- **`api/index.py`** — Vercel serverless function

Both provide:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/chat` | POST | AI diplomacy — sends player message + game state to Claude, returns response + parsed action |
| `/api/characters` | GET | List available AI leaders |
| `/api/save` | POST | Save game state (keyed by visitor_id) |
| `/api/load` | GET | Load game state |
| `/api/leaderboard` | GET/POST | Fetch/submit leaderboard entries |
| `/api/claim-username` | POST | Register a unique username |
| `/api/check-username/:name` | GET | Check username availability |
| `/api/profile/:name` | GET | Player profile + recent games |
| `/api/waitlist` | POST | Add email to waitlist + send welcome |
| `/api/waitlist/count` | GET | Waitlist count |
| `/api/session/start` | POST | Track game session start |
| `/api/session/end` | POST | Track game session end |
| `/api/feedback` | POST | In-game feedback with AI categorization |
| `/api/health` | GET | Health check |

### Database (Supabase)

Tables (inferred from code, schema not in repo):

- `players` — username, username_lower, email, games_played, best_score, total_score, last_active
- `leaderboard` — player_name, score, turns_played, victory_type, factions_eliminated, cities_count, game_version, competition_id, created_at
- `game_saves` — visitor_id (unique), game_state (JSON), updated_at
- `game_sessions` — visitor_id, game_mode, started_at, ended_at, turns_played, outcome
- `waitlist` — email, source, created_at
- `diplomacy_interactions` — visitor_id, character_id, player_message, ai_reply, action_type, action_data, turn
- `feedback` — visitor_id, player_name, message, category, priority, ai_summary, ai_response, game_state_snapshot, status
- `competitions` — id, name, status, starts_at, ends_at
- `active_games` — player_name, competition_id, game_id, sessions_used, max_sessions, turn, score, finished, started_at, last_session_at

## The Diplomacy Engine (Core Innovation)

### How It Works

1. Player opens chat with an AI leader
2. Player types message (or clicks a diplomatic action template button)
3. Frontend sends to `/api/chat`:
   ```json
   {
     "character_id": "shadow_kael",
     "message": "I propose an alliance...",
     "game_state": { "turn": 15, "gold": 200, "military": 25, ... },
     "conversation_history": [ ... last 8 messages ... ]
   }
   ```
4. Backend builds a massive system prompt (~3000 tokens) containing:
   - Character personality profile
   - Current game state context
   - Interaction rules
   - Complete list of available ACTION types (30+ diplomatic actions)
   - Complete list of game_mod types (12 mod categories)
   - Rules for when to use game_mods
5. Claude Sonnet responds in-character with optional `[ACTION: {...}]` tag
6. Backend parses the action via regex: `r'\[ACTION:\s*(\{.*?\})\s*\]'`
7. Frontend's `processCharacterAction()` interprets the action and modifies game state
8. For `game_mod` actions, `applyGameMod()` dynamically extends `UNIT_TYPES`, `BUILDINGS`, `TECHNOLOGIES`, `RESOURCES` at runtime

### game_mod Types

| Mod Type | What It Does |
|----------|-------------|
| `new_unit` | Adds to `UNIT_TYPES` + `UNIT_UNLOCKS` dynamically |
| `new_building` | Pushes to `BUILDINGS` array |
| `new_tech` | Pushes to `TECHNOLOGIES` array |
| `new_resource` | Adds to `RESOURCES` + places deposits on map |
| `reveal_map` | Calls `revealAround(col, row, radius)` |
| `stat_buff` | Directly modifies `game.military`, `game.goldPerTurn`, etc. |
| `gold_grant` | Adds gold |
| `combat_bonus` | Pushed to `game.combatBonuses[]`, applied in `resolveCombat()` |
| `yield_bonus` | Pushed to `game.yieldBonuses[]`, applied in `getTileYields()` |
| `spawn_units` | Creates player units near capital |
| `event` | Pushed to `game.activeEvents[]` with turn-based expiry |

Mods are tracked in `game.appliedMods[]` and restored on save/load via `restoreMods()`.

## Key Constants & Config

- `MAP_COLS = 60`, `MAP_ROWS = 40` — hex grid dimensions
- `HEX_SIZE = 36` — hex radius in pixels
- `MAX_TURNS = 100` — game length
- `GAME_VERSION = 5` — save format version
- Model: `claude-sonnet-4-20250514`, `max_tokens=200`
- Conversation history: last 8 messages sent to API
- Envoys: 3 base per turn + culture/tech bonuses (starting a NEW conversation costs 1 envoy, continuing is free)

## Security Issues (Must Fix)

⚠️ **Hardcoded secrets in source code:**
- `server.py` line 29-30: Supabase service key as default
- `server.py` line 42: Resend API key as default
- `api/index.py` lines 24-28: Same keys duplicated

The service key gives full database read/write access. These must be environment-only.

## Deployment

Deployed on Vercel:
- `vercel.json` runs `npm run build` to bundle `src/` → `game.js` at deploy time
- `api/index.py` runs as a serverless Python function
- `vercel.json` rewrites `/api/*` → `api/index.py`
- `Cache-Control: no-store` on `game.js` to prevent stale code

**Local dev:** run `npm run dev` (or `npm run watch` + `python server.py` separately)

## Code Patterns to Know

- **`game` state** — the entire game state is one mutable object in `src/state.js`, accessible as `window.G` for debugging
- **`window.*` globals** — functions called from HTML `onclick` attributes must be assigned to `window` in `src/main.js` (since esbuild wraps everything in an IIFE)
- **`safeStorage`** — wrapper around localStorage that gracefully handles sandboxed iframes (`src/state.js`)
- **`migrateTiles(state)`** — save migration function in `src/save-load.js`, adds missing fields for backward compat
- **`addEvent(text, type)`** — logs to the in-game event log panel (`src/events.js`)
- **`logAction(category, detail, metadata)`** — logs to `game.gameLog[]` for analytics (`src/events.js`)
- **`showModBanner(icon, desc, source)`** — floating notification when game is modified (`src/game-mods.js`)
- **`showToast(title, message)`** — ephemeral toast notifications (`src/events.js`)
- **`showCompletionNotification(type, name, desc)`** — completion prompt with "choose next" options (`src/events.js`)

## What Needs Work (If Continuing Development)

1. ~~**Modularize `game.js`**~~ — Done. Split into 27 ES modules under `src/`, bundled by esbuild.
2. **Move to structured output** — replace regex `[ACTION: {...}]` parsing with Claude's tool_use / structured output
3. **Persistent conversation memory** — current 8-message window is too short for meaningful diplomatic relationships
4. **Balance guardrails** — AI can currently create overpowered content via game_mods
5. **Multi-agent diplomacy** — factions should negotiate with each other, not just react to player
6. **Performance** — terrain renderer needs caching/offscreen canvas, visibility computation is O(map_size × units)
7. **Tests** — zero tests exist
8. **TypeScript** — if this grows, the untyped codebase will become unmaintainable

## Context: Why Gio Has This Repo

Jamie pitched this to Gio (March 22, 2026) as a potential collaboration. The original pitch doc ("Open Civ: Zero-Friction Play & AI-Native Creation") was a much grander vision involving blockchain marketplaces and AI-generated mod ecosystems. After discussion, the scope narrowed to: **the diplomacy engine as the product, game as open source**. Gio's assessment: the game_mod system is genuinely novel, the rest is a competent Civ clone. The question is whether this becomes a middleware product, an API service, or just a cool open-source game.
