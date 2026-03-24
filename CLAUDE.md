# CLAUDE.md — Context for AI Assistants

> This file exists so Claude (or any LLM) can resume work on this codebase without prior conversation history.

## Project Identity

**Uncivilised** (base game) — a browser-based 4X strategy game. This is the **open-source** repo containing the complete game engine. The AI diplomacy system lives in a separate private repo (`uncivilised-diplomacy`) and plugs in at build time.

**Live URL:** [uncivilized.fun](https://uncivilized.fun)
**Created:** March 2026
**Game version:** 5 (`GAME_VERSION = 5` in both `src/constants.js` and `server.py`)

## Architecture: Plugin Split

The codebase was split into two repos:

- **This repo** (`uncivilised-game-base`) — open source, contains the full game engine
- **Private repo** (`uncivilised-diplomacy`) — AI diplomacy, game mods, AI faction logic

### How the Plugin Works

1. `src/diplomacy-api.js` defines the plugin interface with no-op stubs for all diplomacy functions
2. All modules import diplomacy functions from `diplomacy-api.js` (never directly from diplomacy files)
3. `esbuild.config.mjs` checks for `../uncivilised-diplomacy/src/plugin.js` at build time
4. If found: generates `src/_diplomacy-plugin.gen.js` that imports the plugin and calls `init(registerDiplomacyPlugin)`
5. If not found: generates a no-op loader — game works without diplomacy

### Plugin Interface (`src/diplomacy-api.js`)

Exports these wrapper functions that delegate to the plugin:

**From diplomacy.js:** `getRelationLabel`, `establishTradeRoute`, `cancelTradeRoute`, `renderDiplomacyPanel`, `renderDiplomacyList`, `renderRankingsView`, `openChat`, `renderDiplomacyActions`, `renderChatMarkdown`, `updateDiploActions`, `appendChatMessage`, `appendChatAction`, `sendChatMessage`, `showDiplomacyProposal`, `processCharacterAction`

**From game-mods.js:** `applyGameMod`, `showModBanner`, `getModCombatBonus`, `getModYieldBonus`

**From ai.js:** `processAITurns`, `processBarbarianTurns`, `processAICommitments`, `moveAIUnitToward`

### Import Convention

The diplomacy repo's files use `@game/` prefixed imports to reference base-game modules:
```js
import { FACTIONS } from '@game/constants.js';
import { game } from '@game/state.js';
```
esbuild resolves these via the `alias` config in `esbuild.config.mjs`.

## Frontend Architecture

ES modules under `src/`, bundled by esbuild into `game.js` (IIFE format, gitignored). Key modules:

| Module | Purpose |
|--------|---------|
| `src/constants.js` | Game data: terrain, units, buildings, techs, factions |
| `src/render.js` | Canvas2D hex rendering, visibility, minimap |
| `src/terrain-render.js` | Painterly terrain detail (noise, splotches, trees) |
| `src/ui-panels.js` | Build, research, civics, victory, selection panels |
| `src/diplomacy-api.js` | Plugin interface — stubs + registerDiplomacyPlugin() |
| `src/turn.js` | End-of-turn processing, income, maintenance |
| `src/map.js` | Map generation (tectonic plates -> biomes -> rivers) |
| `src/combat.js` | Combat resolution, promotions, city attacks |
| `src/units.js` | Unit creation, selection, movement, pathfinding |
| `src/state.js` | Shared mutable state (game, canvas, camera, drag) |
| `src/main.js` | Entry point, wires modules, exposes window globals |
| `src/input.js` | Mouse/touch/keyboard handlers, camera, zoom |
| `src/improvements.js` | Worker actions, tile improvements, settlers |
| `src/events.js` | Event log, toasts, notifications, rumours |
| `src/save-load.js` | Save/load (localStorage + API fallback) |
| `src/discovery.js` | Fog of war, faction discovery, first contact |

**Build:**
- `npm run build` — one-shot build
- `npm run watch` — rebuild on file changes
- `npm run dev` — watch + serve via `server.py`

## Backend (Python FastAPI)

Two near-identical copies: `server.py` (local dev) and `api/index.py` (Vercel production).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/chat` | POST | AI diplomacy (requires diplomacy plugin + ANTHROPIC_API_KEY) |
| `/api/characters` | GET | List available AI leaders |
| `/api/save` | POST | Save game state (keyed by visitor_id) |
| `/api/load` | GET | Load game state |
| `/api/leaderboard` | GET/POST | Fetch/submit leaderboard entries |
| `/api/claim-username` | POST | Register a unique username |
| `/api/check-username/:name` | GET | Check username availability |
| `/api/profile/:name` | GET | Player profile + recent games |
| `/api/session/start` | POST | Track game session start |
| `/api/session/end` | POST | Track game session end |
| `/api/feedback` | POST | In-game feedback with AI categorization |
| `/api/health` | GET | Health check |

Note: `/api/chat` and `/api/characters` are diplomacy endpoints that still live in server.py. The frontend handles them being unavailable gracefully (try/catch). These may move to the diplomacy repo in the future.

## Database (Supabase)

Tables: `players`, `leaderboard`, `game_saves`, `game_sessions`, `waitlist`, `diplomacy_interactions`, `feedback`, `competitions`, `active_games`. Schema is not in the repo — inferred from code.

## Key Constants & Config

- `MAP_COLS = 60`, `MAP_ROWS = 40` — hex grid dimensions
- `HEX_SIZE = 36` — hex radius in pixels
- `MAX_TURNS = 100` — game length
- `GAME_VERSION = 5` — save format version

## Code Patterns to Know

- **`game` state** — the entire game state is one mutable object in `src/state.js`, accessible as `window.G` for debugging
- **`window.*` globals** — functions called from HTML `onclick` attributes must be assigned to `window` in `src/main.js` (esbuild wraps in IIFE)
- **`safeStorage`** — wrapper around localStorage that gracefully handles sandboxed iframes (`src/state.js`)
- **`migrateTiles(state)`** — save migration in `src/save-load.js`, adds missing fields for backward compat
- **`restoreMods(state)`** — in `src/save-load.js`, re-injects dynamically created content (units, buildings, etc.) from `state.appliedMods[]` into constants on load. This stays in the base repo because it's save-format compatibility, not the diplomacy engine itself.
- **`addEvent(text, type)`** — logs to the in-game event log panel (`src/events.js`)
- **`logAction(category, detail, metadata)`** — logs to `game.gameLog[]` for analytics (`src/events.js`)
- **`showToast(title, message)`** — ephemeral toast notifications (`src/events.js`)

## Security Issues (Must Fix)

- `server.py` line 29-30: Supabase service key as default
- `server.py` line 42: Resend API key as default
- `api/index.py` lines 24-28: Same keys duplicated

The service key gives full database read/write access. These must be environment-only.

## Deployment

Deployed on Vercel:
- `vercel.json` runs `npm run build` to bundle `src/` -> `game.js` at deploy time
- `api/index.py` runs as a serverless Python function
- `vercel.json` rewrites `/api/*` -> `api/index.py`

**Local dev:** `npm run dev` (or `npm run watch` + `python server.py` separately)

## Working with the Diplomacy Module

**Important for AI assistants:** This repo is only half the codebase. The AI diplomacy system (chat UI, game mods, AI faction logic) lives in a separate private repo called `uncivilised-diplomacy`.

When a task involves diplomacy, game mods, or AI faction behavior:

1. **Check if the diplomacy repo is present:** look for `../uncivilised-diplomacy/src/plugin.js`
2. **If not found:** ask the user whether they have the diplomacy repo available and where it's located, or whether the task should be scoped to just the base game
3. **If found:** the diplomacy files are at `../uncivilised-diplomacy/src/` — read `diplomacy.js`, `game-mods.js`, and `ai.js` there
4. **Never recreate** `diplomacy.js`, `game-mods.js`, or `ai.js` in this repo — they belong in the private repo

When modifying `src/diplomacy-api.js` (the plugin interface):
- Any new function added here must also be implemented in the diplomacy repo's `src/plugin.js` registration
- Keep stubs as no-ops that return sensible defaults (0 for numbers, empty objects, etc.)
- The wrapper pattern (`export function foo(...args) { return _plugin.foo(...args); }`) ensures late plugin registration works

When modifying modules that the diplomacy repo imports from (constants, state, hex, events, render, map, units, discovery, leaderboard, combat):
- Changing or removing exports from these modules will break the diplomacy build
- The diplomacy repo imports them via `@game/` aliases (e.g., `@game/constants.js`)
- If you add a new export that diplomacy needs, it's available automatically via the alias

## Context

Jamie built this as a Civ-style game with AI-powered diplomacy. Gio (Fragcolor) is evaluating it for collaboration. The decision was: **diplomacy engine stays private, game goes open source**. This repo is the open-source half.
