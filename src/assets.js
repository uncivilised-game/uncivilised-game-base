import { TERRAIN_TILE_MAP, FEATURE_TILE_MAP, PORTRAIT_MAP } from './constants.js';
import { TERRAIN_TILE_IMAGES, IMPROVEMENT_IMAGES, setTilesLoaded, game } from './state.js';

// render is imported lazily to avoid circular deps
let _render = null;
export function setRenderCallback(fn) { _render = fn; }

export function preloadImprovementImages() {
  const impNames = ['imp_farm','imp_mine','imp_pasture','imp_road','imp_irrigation','imp_lumber_mill','imp_camp','imp_quarry','imp_fishing_boats'];
  for (const name of impNames) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = './assets/hex/' + name + '.png';
    IMPROVEMENT_IMAGES[name.replace('imp_','')] = img;
  }
}

export function preloadTerrainTiles() {
  const allTiles = new Set();
  for (const arr of Object.values(TERRAIN_TILE_MAP)) arr.forEach(t => allTiles.add(t));
  for (const arr of Object.values(FEATURE_TILE_MAP)) arr.forEach(t => allTiles.add(t));

  let loaded = 0;
  const total = allTiles.size;
  for (const name of allTiles) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { loaded++; if (loaded >= total) { setTilesLoaded(true); if (_render && game) _render(); } };
    img.onerror = () => { loaded++; console.warn('Failed to load tile:', name); };
    img.src = `./assets/hex/${name}.png`;
    TERRAIN_TILE_IMAGES[name] = img;
  }
}

export function preloadPortraits() {
  for (const [fid, pname] of Object.entries(PORTRAIT_MAP)) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `./assets/portraits/${pname}.jpg`;
    TERRAIN_TILE_IMAGES['portrait_' + fid] = img;
  }
}

// Start preloading immediately
preloadImprovementImages();
preloadTerrainTiles();
preloadPortraits();
