import { TERRAIN_TILE_IMAGES } from './state.js';
import { FEATURE_TILE_MAP, TERRAIN_TILE_MAP } from './constants.js';

export function simplex(x, y) {
  const dot = (g, x, y) => g[0] * x + g[1] * y;
  const grad = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  const perm = [];
  for (let i = 0; i < 512; i++) perm[i] = Math.floor(Math.abs(Math.sin(i * 9301 + 49297) * 233280) % 8);
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const s = (x + y) * F2;
  const i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = ((i % 256) + 256) % 256, jj = ((j % 256) + 256) % 256;
  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) { t0 *= t0; n0 = t0 * t0 * dot(grad[perm[(ii + perm[jj % 512]) % 512]], x0, y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) { t1 *= t1; n1 = t1 * t1 * dot(grad[perm[(ii + i1 + perm[(jj + j1) % 512]) % 512]], x1, y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) { t2 *= t2; n2 = t2 * t2 * dot(grad[perm[(ii + 1 + perm[(jj + 1) % 512]) % 512]], x2, y2); }
  return 70 * (n0 + n1 + n2);
}

export function valueNoise(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function fbmNoise(x, y, octaves) {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < (octaves || 3); i++) {
    val += amp * (valueNoise(x * freq, y * freq) * 2 - 1);
    amp *= 0.5; freq *= 2;
  }
  return val * 0.5 + 0.5;
}

export function rgbStr(r, g, b, a) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a === undefined ? 1 : a})`;
}

export function adjustBrightness(hex, amount) {
  let r = parseInt(hex.slice(1, 3), 16) + amount;
  let g = parseInt(hex.slice(3, 5), 16) + amount;
  let b = parseInt(hex.slice(5, 7), 16) + amount;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}

export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function getTerrainTileImage(tile) {
  // Pick a tile image with maximum variety — different hash for each position
  const hash = Math.abs((tile.col * 127 + tile.row * 311 + tile.col * tile.row * 17) % 1000);

  // Feature tiles take priority
  if (tile.feature && FEATURE_TILE_MAP[tile.feature]) {
    const opts = FEATURE_TILE_MAP[tile.feature];
    const idx = hash % opts.length;
    return TERRAIN_TILE_IMAGES[opts[idx]];
  }

  // Base terrain
  if (TERRAIN_TILE_MAP[tile.base]) {
    const opts = TERRAIN_TILE_MAP[tile.base];
    const idx = hash % opts.length;
    return TERRAIN_TILE_IMAGES[opts[idx]];
  }

  return null;
}
