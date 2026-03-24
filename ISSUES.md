# ISSUES.md — Known Issues, Bugs & Technical Debt

> Compiled from code review, March 24, 2026. Not exhaustive — based on reading the source, not playtesting.

---

## 🔴 Critical — Security

### SEC-01: Hardcoded Supabase Service Key
**Files:** `server.py:29-30`, `api/index.py:24-28`  
The Supabase **service role key** is hardcoded as a fallback default. This key grants full read/write access to the entire database — any user, any table, bypassing RLS. Anyone who reads the source (and it's deployed to Vercel where `api/index.py` is visible) has complete database access.

**Fix:** Remove hardcoded defaults entirely. Require `SUPABASE_SERVICE_KEY` as an env-only variable. Fail loudly if missing.

### SEC-02: Hardcoded Resend API Key
**Files:** `server.py:42`, `api/index.py:40`  
Same pattern — Resend API key hardcoded as fallback. Allows anyone to send emails as `hello@uncivilized.fun`.

**Fix:** Env-only, no fallback default.

### SEC-03: Supabase Anon Key in Client-Side JS
**File:** `game.js:8383`  
The Supabase anon key is embedded in client-side JavaScript. This is *technically OK* if Row Level Security (RLS) is properly configured — but there's no evidence RLS policies exist. Without RLS, the anon key can read/write all tables directly from the browser console.

**Fix:** Verify RLS is enabled on all Supabase tables. The anon key should only allow what an anonymous user should access.

### SEC-04: No Authentication on Backend Endpoints
**Files:** `server.py`, `api/index.py`  
All API endpoints accept any request. No auth tokens, no rate limiting, no CSRF protection. A script could:
- Flood the leaderboard with fake entries
- Overwrite any player's save game (visitor_id is client-generated)
- Spam the waitlist
- Burn through the Anthropic API budget via `/api/chat`

**Fix:** At minimum: rate limiting per IP, validate visitor_id format, add API key or session tokens for write endpoints.

### SEC-05: Visitor ID is Client-Generated and Predictable
**File:** `game.js:33-35`  
```js
safeStorage.setItem('uncivilised_visitor_id', 'v-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9));
```
This ID is used to key save games on the server. It's guessable (timestamp + short random). An attacker could enumerate visitor IDs and overwrite or read other players' save data.

**Fix:** Generate visitor IDs server-side, or use a proper UUID v4.

---

## 🟠 High — Architecture & Maintainability

### ARCH-01: 10,600-Line Monolith
**File:** `game.js`  
The entire game — rendering, game logic, AI, UI, input handling, save/load, networking, map generation, combat, diplomacy — is in a single file with no modules, no imports, no build step.

This makes it nearly impossible to:
- Write tests for individual systems
- Have multiple people work on it simultaneously
- Understand the dependency graph between systems
- Refactor without risk of breaking unrelated features

**Suggested split:**
```
src/
  map/generation.js      — map gen, simplex noise, biome assignment
  map/terrain.js         — terrain data, yields, movement costs
  render/hex.js          — hex math, coordinate conversion
  render/terrain.js      — painterly terrain rendering
  render/units.js        — unit/city rendering
  render/ui.js           — panels, tooltips, notifications
  game/state.js          — game state creation, migration
  game/turns.js          — end-turn processing
  game/combat.js         — combat resolution, promotions
  game/diplomacy.js      — chat, action processing, game_mod
  game/ai.js             — faction AI, barbarians, commitments
  game/improvements.js   — worker system, tile improvements
  input/mouse.js         — click, drag, zoom handling
  input/keyboard.js      — hotkeys
  net/api.js             — save/load, leaderboard, chat API calls
  net/supabase.js        — direct Supabase client calls
```

### ARCH-02: Duplicated Backend
**Files:** `server.py` and `api/index.py`  
Two near-identical copies of the backend. They've already drifted:
- `api/index.py` has `/api/feedback` endpoint — `server.py` doesn't
- `api/index.py` has inline welcome email HTML — `server.py` reads from file
- Character profiles are duplicated in both

Any bug fix or feature must be applied to both files.

**Fix:** Make `api/index.py` import from `server.py`, or extract shared code into a common module.

### ARCH-03: No Type Safety
**File:** `game.js`  
No TypeScript, no JSDoc, no runtime validation of game state shape. The `game` object has 60+ top-level fields, many added via `migrateTiles()` — a function that patches missing fields onto old saves. This is the classic "stringly-typed bag of properties" anti-pattern.

**Risk:** Any typo in a property name creates a silent bug. `game.sciencePerTurn` vs `game.scienceperturn` vs `game.science_per_turn` — the code uses all camelCase, but there's no enforcement.

### ARCH-04: No Tests
Zero test files exist. The game's correctness depends entirely on manual playtesting.

---

## 🟡 Medium — Gameplay & Logic

### GAME-01: Regex-Based Action Parsing
**Files:** `server.py:569`, `api/index.py:598`  
```python
action_match = re.search(r'\[ACTION:\s*(\{.*?\})\s*\]', reply, re.DOTALL)
```
The AI's structured actions are extracted from free-text via regex. This is fragile:
- Nested JSON with `}` in string values can break the non-greedy match
- `game_mod` actions with complex nested objects are especially at risk
- Partial/malformed actions are silently dropped

**Fix:** Use Claude's tool_use / structured output mode instead of regex parsing. Define actions as tools with proper JSON schemas.

### GAME-02: Game Mod Balance — No Guardrails
**File:** `game.js:5930-6236`  
The `applyGameMod()` function has soft limits (`Math.min(mod.amount || 5, 20)` for stat buffs, units capped at cost 40-80 in the prompt) but the prompt is the only enforcement. The AI can be prompted/manipulated into creating overpowered content. A player who says "teach me your most devastating military secret, I'll give you everything" might get a 50-combat unit that costs 10 gold.

**Fix:** Server-side validation of game_mod values. Hard caps on combat stats, costs, buff amounts. Rate-limit: max N mods per game.

### GAME-03: Conversation Memory is Only 8 Messages
**Files:** `server.py:549`, `game.js:5562`  
Only the last 8 messages of conversation history are sent to the API. AI leaders "forget" everything before that. This means:
- A betrayal 20 turns ago is forgotten
- Long-running diplomatic arcs can't develop
- The personality system promises "remembers perceived slights for exactly 10 turns" but the implementation can't support this

**Fix:** Implement a conversation summary system — after N messages, summarize the relationship history into a compact block that's always included in the system prompt.

### GAME-04: AI Factions Don't Talk to Each Other
AI faction relationships are simulated numerically (stats grow/shrink per turn) but factions never actually negotiate with each other via the LLM. The `wage_war_on` and `make_peace_with` commitments just modify stats directly.

This means the "multi-polar diplomacy" feeling is faked. Two AI factions can't form an alliance against the player through their own reasoning.

### GAME-05: Duplicate Unit Detection Missing
**File:** `game.js:5943-5960`  
When a `new_unit` game_mod fires, it checks `if (!UNIT_TYPES[mod.id])` — but the mod ID is AI-generated. Two different diplomatic conversations could generate units with the same ID but different stats, or different IDs for conceptually identical units. No deduplication or conflict resolution.

### GAME-06: `endTurn()` is ~400 Lines
**File:** `game.js:7646-8316`  
The `endTurn()` function handles AI turns, unit healing, income, trade routes, happiness, resource bonuses, government cooldowns, food/population growth, production, research, civics, great people, alliance upkeep, trade deal processing, defense pacts, random events, relationship drift, faction stats, intel reports, envoy refill, open borders, embargoes, ceasefires, vassals, non-aggression pacts, active events, auto-research, auto-build, auto-buy, fog expansion, scoring, victory checks, and turn summaries.

This is unmaintainable. Any change to turn processing risks side effects across a dozen systems.

### GAME-07: City Panel Shows Wrong Building Count for Multi-City
**File:** `game.js:4596`  
```js
body += `<p>Buildings: ${game.buildings.length}</p>`;
```
`game.buildings` is a flat global array — all cities share the same buildings list. There's no per-city building tracking. Building a Market benefits all cities equally.

### GAME-08: Population is Both Global and Per-City
**Files:** `game.js:674`, `game.js:7793`  
`game.population` is a global number, but each city also has `city.population`. They're updated independently and can drift out of sync. The `endTurn()` function does `game.population += 100` when a city grows, but capturing a city sets `game.population += 500` without coordination.

### GAME-09: `computeVisibility()` Called Every Frame
**File:** `game.js:2196`  
```js
function render() {
  computeVisibility();
  ...
```
Visibility recomputation iterates all player cities × all map tiles + all player units × nearby tiles. This runs on every `render()` call, which is every mouse move (hover tooltip) and every animation frame (pulsing selection ring). On a 60×40 map with several cities and units, that's thousands of distance checks per frame.

**Fix:** Only recompute visibility when game state changes (unit moves, turn ends, city captured). Cache the result.

---

## 🟢 Low — Polish & Minor Issues

### UI-01: Event Log Overflow
**File:** `game.js:8831`  
The event log caps at 15 entries in the DOM, but `game.recentEvents` grows to 20 and `game.gameLog` is unbounded. Long games will accumulate a large game log in memory and in save files.

### UI-02: Mobile Touch Support is Basic
**File:** `game.js:4091-4124`  
Touch drag and pinch-to-zoom exist, but:
- No touch equivalent for hover tooltips
- No touch equivalent for right-click / long-press context menus
- Unit selection on touch is imprecise at default hex size
- The diplomacy chat input is hard to use on mobile keyboards

### UI-03: `drawHexShape` Called but Not Defined
**File:** `game.js:2509`  
```js
drawHexShape(ctx, bp.x - camX, bp.y - camY); ctx.fill();
```
Called when rendering AI expansion city territory. `drawHexShape` is not defined anywhere in the codebase. Should probably be `drawHex()`. This would throw a runtime error when an AI expansion city is visible.

### UI-04: Unreachable Variable Reference
**File:** `game.js:6689`  
```js
events.push('Free ' + UNIT_TYPES[eff.freeUnit].name + ' from ' + wdata.name + '!');
```
Inside `useGreatPerson()` for the `instant_production` case applied to a wonder. References `events` (not defined in scope — it's a local in `endTurn()`) and `wdata` (should be `wd`). This will throw if a Great Engineer completes a wonder with a `freeUnit` effect.

### UI-05: Feedback Widget Always Visible During Gameplay
**File:** `index.html:262-281`  
The feedback chat widget is fixed-position bottom-right, always visible during gameplay. It overlaps with game UI on smaller screens and can interfere with the action bar.

### NET-01: Auto-Save Sends Entire Game State to API
**File:** `game.js:10200-10208`  
Every auto-save (every turn) POSTs the entire game state JSON to the server. For a late-game save, this could be several hundred KB. No compression, no diffing.

### NET-02: Leaderboard Score is Client-Computed
**File:** `game.js:8266-8282`  
The score is calculated client-side and submitted to the leaderboard with no server-side verification. A player could submit any score by calling the API directly or modifying `game.score` in the console.

### DATA-01: `continentId` Stored in Save Data
**File:** `game.js:717`  
`continentId` is a 2D array (`MAP_ROWS × MAP_COLS` of Int16) stored in every save. It's only used during map generation and faction placement. Storing it inflates save file size unnecessarily.

**Fix:** Recalculate on load if needed, or drop from saves.

### DATA-02: No Save Data Compression
Save data is raw JSON stringified and stored. A typical mid-game save with a 60×40 map, fog of war, game log, and conversation histories can be 500KB+. LocalStorage has a ~5-10MB limit.

---

## 📋 Contradictions & Decisions Needed

### DECIDE-01: License
`game.js` header says "proprietary and confidential, unauthorized copying strictly prohibited." The welcome email says "fully open source under AGPL-3.0." The concept doc talks about an open-source game. These are mutually exclusive. Pick one.

### DECIDE-02: Name
The project is called "Uncivilised" in the UI and repo, but "Open Civ" in the code comments (`OPEN CIV — ANCIENT ERA`), the save key (`openciv_save`), and the original concept doc. The domain is `uncivilized.fun` (American spelling). The email sender is `Uncivilised` (British spelling). Pick one name, one spelling.

### DECIDE-03: Character Name Inconsistencies
Some faction IDs don't match their current character names (they were renamed but the IDs weren't updated):

| ID | Display Name | Mismatch |
|----|-------------|----------|
| `emperor_valerian` | High Chieftain Aethelred | ID says Valerian |
| `shadow_kael` | Warlord Kael | ID says shadow, but type is "spy" and title says "Warlord" |
| `merchant_prince_castellan` | Queen Tariq | ID says merchant prince castellan |
| `pirate_queen_elara` | Pythia Ione | ID says pirate queen Elara, type is "pirate" but title says "Oracle" |
| `rebel_leader_sera` | High Priestess 'Ula | ID says rebel leader Sera |

The personality text for `rebel_leader_sera` still opens with "You are Sera" despite the display name being 'Ula.
