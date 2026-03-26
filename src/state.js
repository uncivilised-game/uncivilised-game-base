// ============================================
// SHARED MUTABLE STATE
// ============================================

// Safe storage wrapper — degrades gracefully in sandboxed iframes
export const safeStorage = (() => {
  let store = null;
  try { store = window['local' + 'Storage']; store.getItem('_test'); } catch(e) { store = null; }
  return {
    getItem(k) { try { return store ? store.getItem(k) : null; } catch(e) { return null; } },
    setItem(k,v) { try { if(store) store.setItem(k,v); } catch(e) {} },
    removeItem(k) { try { if(store) store.removeItem(k); } catch(e) {} }
  };
})();

// API base URL — localhost for dev, empty string (same origin) for prod
export const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:8000' : '';

// Persistent visitor ID for session tracking — runs immediately on import
if (!safeStorage.getItem('uncivilised_visitor_id')) {
  safeStorage.setItem('uncivilised_visitor_id', 'v-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9));
}

// ============================================
// IMAGE / ASSET STATE
// ============================================

// Terrain tile images — populated by loadTerrainTileImages()
export const TERRAIN_TILE_IMAGES = {};

// Improvement images — populated by loadImprovementImages()
export const IMPROVEMENT_IMAGES = {};

// Whether terrain tile images have finished loading
export let tilesLoaded = false;
export function setTilesLoaded(v) { tilesLoaded = v; }

// Unit sprite atlas
export const unitAtlas = new Image();
unitAtlas.crossOrigin = 'anonymous';
unitAtlas.src = 'assets/units/absolute_units.png';

// Realistic hex terrain tileset
export const realisticTerrainTileset = new Image();
realisticTerrainTileset.crossOrigin = 'anonymous';
realisticTerrainTileset.src = 'assets/terrain-tiles/hex_terrain_flat.png';

// ============================================
// GAME STATE
// ============================================
// Wonder race state fields (initialized in main.js createGameState):
//   game.builtWonders = {}      — maps wonder_id to owner faction (e.g. { pyramids: 'player', oracle: 'pirate_queen_elara' })
//   game.aiWonderProgress = {}  — maps faction_id to { wonderId, progress } for AI wonder building

export let game = null;
export function setGame(g) { game = g; }

export let nextUnitId = 1;
export function getNextUnitId() { return nextUnitId++; }
export function setNextUnitId(v) { nextUnitId = v; }

// Debug accessor
Object.defineProperty(window, 'G', { get() { return game; } });

// ============================================
// CANVAS / RENDERER STATE
// ============================================

export let canvas = null;
export let ctx = null;
export let miniCanvas = null;
export let miniCtx = null;

export function initCanvasRefs() {
  canvas = document.getElementById('hex-canvas');
  ctx = canvas.getContext('2d');
  miniCanvas = document.getElementById('mini-map');
  miniCtx = miniCanvas.getContext('2d');
}

export let canvasW, canvasH;
export function setCanvasSize(w, h) { canvasW = w; canvasH = h; }

export let gameZoom = 1.0;
export function setGameZoom(z) { gameZoom = z; }

// Drag state
export let isDragging = false;
export let hasDragged = false;
export let dragStartX = 0;
export let dragStartY = 0;
export let camStartX = 0;
export let camStartY = 0;

export function setDragState(dragging, dragged, dsx, dsy, csx, csy) {
  isDragging = dragging;
  hasDragged = dragged;
  dragStartX = dsx;
  dragStartY = dsy;
  camStartX = csx;
  camStartY = csy;
}
export function setIsDragging(v) { isDragging = v; }
export function setHasDragged(v) { hasDragged = v; }

export let hoveredHex = null;
export function setHoveredHex(v) { hoveredHex = v; }

// Lock DPR at page load — browser zoom changes devicePixelRatio but we
// don't want that to shrink / stretch the game canvas.
export const LOCKED_DPR = window.devicePixelRatio || 1;

// ============================================
// CHAT / DIPLOMACY STATE
// ============================================

export let currentChatCharacter = null;
export function setCurrentChatCharacter(v) { currentChatCharacter = v; }

// ============================================
// SUPABASE / COMPETITION STATE
// ============================================

// Database access is server-side only (via API endpoints). No client-side DB credentials.
export const SB_HEADERS = { 'Content-Type': 'application/json' };

export let currentCompetition = null; // { id, name, starts_at, ends_at }
export function setCurrentCompetition(v) { currentCompetition = v; }

export let activeGameRecord = null; // The active_games row for this player+competition
export function setActiveGameRecord(v) { activeGameRecord = v; }

// ============================================
// ANIMATION STATE
// ============================================

export let animRunning = false;
export function setAnimRunning(v) { animRunning = v; }
