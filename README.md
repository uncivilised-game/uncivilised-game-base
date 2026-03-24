# Uncivilised — AI-Powered Diplomacy

A browser-based 4X strategy game where every faction leader is powered by an LLM. They think, remember, negotiate, betray, and — uniquely — can dynamically modify the game world through diplomatic conversation.

**Live at:** [uncivilized.fun](https://uncivilized.fun)

## What Makes This Different

The core innovation is the **emergent game modification system**: AI leaders don't just talk — they can inject new units, buildings, technologies, and resources into the game as a result of diplomatic negotiation. A pirate queen teaches you naval warfare → new ship class appears. A spymaster sells you intel → fog of war lifts. A merchant prince shares trade secrets → desert tiles now yield food. Every playthrough evolves differently based on what you negotiate.

## Tech Stack

| Layer | Tech |
|-------|------|
| **Frontend** | Vanilla JS (27 ES modules under `src/`), Canvas2D rendering, esbuild bundler |
| **Backend** | Python FastAPI (`server.py` / `api/index.py`) |
| **AI** | Anthropic Claude Sonnet via API |
| **Database** | Supabase (PostgREST, no SDK) |
| **Email** | Resend API (waitlist welcome emails) |
| **Hosting** | Vercel (static + serverless Python) |

## Game Features

- **Hex map generation** — tectonic plates, temperature/moisture biomes, rivers, resources, natural wonders
- **6 AI faction leaders** — each with distinct personality, speech patterns, and behavioral rules
- **Full Civ-style mechanics** — tech tree, civics, wonders, great people, governments, religions, happiness
- **Combat system** — flanking, promotions, tactical battle choices, city sieges with ranged strikes
- **Worker improvements** — farms, mines, roads, irrigation, lumber mills, terraforming
- **Settler expansion** — found new cities, cultural border growth
- **Barbarian camps & minor factions** — mystic sects, nomadic tribes with interaction menus
- **Fog of war** — exploration, first contact events, rumour system about undiscovered factions
- **Diplomacy** — alliances, trade deals, marriages, defense pacts, embargoes, vassalage, introductions
- **Emergent game mods** — AI leaders create new content through conversation (see above)
- **Competition system** — weekly leaderboards with session limits, Supabase-backed
- **Save/load** — localStorage + server-side via Supabase

## Running Locally

### Prerequisites

- Python 3.11+
- An [Anthropic API key](https://console.anthropic.com/)

### Setup

```bash
# Clone
git clone <repo-url>
cd uncivilised-game

# Install dependencies
pip install -r requirements.txt
npm install

# Set your Anthropic API key
export ANTHROPIC_API_KEY="sk-ant-..."

# Build & run (watch mode + server)
npm run dev
# → runs on http://localhost:8000

# Or manually:
npm run build          # bundle src/ → game.js
python server.py       # serve on :8000
```

The frontend auto-detects localhost and routes API calls to `http://localhost:8000`.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for AI diplomacy |
| `SUPABASE_URL` | No | Supabase project URL (falls back to hardcoded demo) |
| `SUPABASE_SERVICE_KEY` | No | Supabase service role key |
| `RESEND_API_KEY` | No | Resend API key for waitlist emails |

Without Supabase/Resend, the game runs fine — leaderboard, saves, and waitlist just won't persist to the server.

## Project Structure

```
uncivilised-game/
├── src/                     # Game engine (27 ES modules)
│   ├── main.js              # Entry point — wires modules, exposes window globals
│   ├── constants.js         # Game data: terrain, units, buildings, techs, factions
│   ├── state.js             # Shared mutable state (game, canvas, camera)
│   ├── render.js            # Canvas2D hex rendering, visibility, minimap
│   ├── terrain-render.js    # Painterly terrain detail
│   ├── ui-panels.js         # Build, research, civics, victory panels
│   ├── diplomacy.js         # Chat UI, AI action processing
│   ├── ai.js                # AI faction turn logic
│   ├── turn.js              # End-of-turn processing
│   ├── map.js               # Map generation
│   ├── combat.js            # Combat resolution
│   ├── units.js             # Unit movement, pathfinding
│   ├── input.js             # Mouse/touch/keyboard, camera
│   ├── improvements.js      # Worker actions, tile improvements
│   ├── events.js            # Event log, notifications
│   ├── game-mods.js         # Dynamic game modification from diplomacy
│   ├── save-load.js         # Save/load system
│   └── ...                  # + 10 more modules
├── index.html               # Main game page
├── style.css                # UI styling
├── server.py                # Local dev backend (FastAPI + uvicorn)
├── api/
│   └── index.py             # Vercel serverless function (production backend)
├── esbuild.config.mjs       # Bundler config (src/ → game.js)
├── package.json             # npm scripts: build, watch, dev
├── assets/                  # Portraits, hex tiles, unit sprites, terrain
├── vercel.json              # Vercel deployment config
└── requirements.txt         # Python dependencies
```

## The 6 Faction Leaders

| ID | Name | Archetype | Personality |
|----|------|-----------|-------------|
| `emperor_valerian` | High Chieftain Aethelred | Expansionist | Formal, calculated, respects strength |
| `shadow_kael` | Warlord Kael | Militaristic/Spy | Cryptic, trades in secrets, trusts no one |
| `merchant_prince_castellan` | Queen Tariq | Diplomatic/Trade | Jovial, deal-obsessed, razor-sharp terms |
| `pirate_queen_elara` | Pythia Ione | Cultural/Oracle | Flamboyant, freedom-obsessed, tests boundaries |
| `commander_thane` | Commander Thane | Militaristic | Blunt, honorable, judges by martial prowess |
| `rebel_leader_sera` | High Priestess 'Ula | Cultural/Rebel | Passionate, idealistic, champions the oppressed |

## Known Issues

- **Security:** API keys are hardcoded as fallback defaults in `server.py` and `api/index.py`. For production, these must be moved to environment variables only.
- **Architecture:** ~~Single `game.js` monolith~~ — now modularized into 27 ES modules under `src/`.
- **Performance:** The painterly terrain renderer is expensive — draws noise-driven splotches, individual trees, gradient blending per hex per frame. May struggle on low-end devices at full zoom.
## License

TBD — Contact jamie247@gmail.com for licensing inquiries.
