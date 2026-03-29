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
| `src/main.js` | Entry point, wires modules, exposes window globals |
| `src/state.js` | Shared mutable state (game, canvas, camera, drag) |
| `src/constants.js` | Game data: terrain, units, buildings, techs, factions |
| `src/render.js` | Canvas2D hex rendering, visibility, minimap |
| `src/terrain-render.js` | Painterly terrain detail (noise, splotches, trees) |
| `src/hex.js` | Hex grid utilities, coordinate math, neighbor lookups |
| `src/map.js` | Map generation (tectonic plates -> biomes -> rivers) |
| `src/assets.js` | Terrain tile preloading, portrait/icon asset management |
| `src/input.js` | Mouse/touch/keyboard handlers, camera, zoom |
| `src/ui-panels.js` | Build, research, civics, victory, selection panels |
| `src/units.js` | Unit creation, selection, movement, pathfinding |
| `src/combat.js` | Combat resolution, promotions, city attacks |
| `src/buildings.js` | Building mechanics, great persons, pantheon |
| `src/improvements.js` | Worker actions, tile improvements, settlers |
| `src/turn.js` | End-of-turn processing, income, maintenance |
| `src/housing.js` | City housing and population mechanics |
| `src/minor-factions.js` | Barbarian and minor faction system |
| `src/discovery.js` | Fog of war, faction discovery, first contact |
| `src/events.js` | Event log, toasts, notifications, rumours |
| `src/save-load.js` | Save/load (localStorage + API fallback) |
| `src/leaderboard.js` | Leaderboard UI and player ranking display |
| `src/rankings.js` | Rankings and stats calculation |
| `src/feedback.js` | In-game feedback UI |
| `src/resource-icons.js` | Resource icon and display utilities |
| `src/utils.js` | General utility functions |
| `src/diplomacy-api.js` | Plugin interface — stubs + registerDiplomacyPlugin() |
| `src/ai-diplomacy.js` | AI-to-AI diplomatic system |

**Build:**
- `npm run build` — one-shot build
- `npm run watch` — rebuild on file changes
- `npm run dev` — watch + serve via `server.py`

## Backend (Python FastAPI)

Two near-identical copies: `server.py` (local dev) and `api/index.py` (Vercel production). The production version has additional endpoints for auth, feedback, and admin.

### Core Endpoints (both server.py and api/index.py)

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
| `/api/waitlist` | POST/GET | Join waitlist / get waitlist count |
| `/api/session/start` | POST | Track game session start |
| `/api/session/end` | POST | Track game session end |
| `/api/unsubscribe` | GET | One-click email unsubscribe (HMAC-signed token) |
| `/api/admin/manage-player` | GET | Admin player management (requires ADMIN_SECRET) |
| `/api/admin/analytics` | GET | Admin analytics dashboard (requires ADMIN_SECRET) |
| `/api/health` | GET | Health check |

### Production-Only Endpoints (api/index.py)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/signup` | POST | Player registration with email verification |
| `/api/signin` | POST | Player authentication |
| `/api/verify-token/:token` | GET | Email/token verification |
| `/api/spots-remaining` | GET | Available beta spots |
| `/api/verify-access` | GET | Check player access status |
| `/api/feedback` | POST | In-game feedback with AI categorization |
| `/api/admin/resend-missed-emails` | GET | Resend failed welcome emails |

Note: `/api/chat` and `/api/characters` are diplomacy endpoints that still live in server.py. The frontend handles them being unavailable gracefully (try/catch). These may move to the diplomacy repo in the future.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/conviction-triage.py` | Auto-triages new GitHub issues with conviction scoring |
| `scripts/newsletter.py` | Sends newsletter emails to active players via Resend API |
| `scripts/newsletter.html` | Reusable newsletter HTML template (dynamic placeholders) |
| `scripts/newsletter-launch.html` | Open-source launch announcement template (baked-in content) |
| `scripts/newsletter.sql` | SQL migration for feedback `thanked_at` and player `email_opt_out` columns |

**Newsletter system:** Supports two templates (`TEMPLATE=newsletter` or `TEMPLATE=launch`), test-send to a single address (`TEST_EMAIL=...`), dry-run mode, and per-player HMAC-signed unsubscribe links. Only sends to active players (not waitlisted).

## Database (Supabase)

Tables: `players`, `leaderboard`, `game_saves`, `game_sessions`, `waitlist`, `diplomacy_interactions`, `feedback`, `competitions`, `active_games`. Schema is not in the repo — inferred from code. Note: `competitions` and `active_games` are only used in production (api/index.py).

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

## Deployment

Deployed on Vercel (`uncivilised-game-v2` project). Vercel auto-deploys are disabled (`vercel.json` → `git.deploymentEnabled: false`) because builds require both repos (base + diplomacy). GitHub Actions handles all deployments.

**Branches:**
- **`main`** → Production (`uncivilized.fun`) — `vercel deploy --prod`
- **`devel`** → Staging (`staging.uncivilized.fun`) — `vercel deploy` + `vercel alias`
- Other branches are ignored by CI

**Workflows:**
- `.github/workflows/deploy.yml` — triggers on push to `main` or `devel`. Checks out both repos, builds with the diplomacy plugin, and deploys via the Vercel CLI.
- `.github/workflows/conviction-triage.yml` — auto-triages new issues with conviction scoring.
- `.github/workflows/conviction-implement.yml` — comment `/fix` on a conviction-labeled issue to have Claude Code implement it and open a PR. Restricted to repo owners, members, and collaborators.
- `.github/workflows/pr-preview.yml` — comment `/deploy` on any PR to get a Vercel preview deployment URL posted back as a comment. Restricted to repo owners, members, and collaborators.
- `.github/workflows/pr-assist.yml` — comment `@claude <request>` on any PR to have Claude Code make further changes, fix issues, or answer questions. Works on both PR comments and review comments. Restricted to repo owners, members, and collaborators.
- `.github/workflows/newsletter.yml` — manual-only workflow to send emails to active players. Inputs: `template` (newsletter/launch), `message`, `subject`, `dry_run`, `test_email`. Runs `scripts/newsletter.py`.

**Important:** `main` is production. Always work on `devel` or feature branches. If you're about to commit to `main` directly or create a PR targeting `main`, confirm with the user first — they likely want to target `devel` instead.

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
