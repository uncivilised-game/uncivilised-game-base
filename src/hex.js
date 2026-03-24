import { HEX_SIZE, SQRT3, MAP_COLS, MAP_ROWS, DIR_TO_EDGE } from './constants.js';

export function hexToPixel(col, row) {
  const x = HEX_SIZE * SQRT3 * (col + 0.5 * (row & 1));
  const y = HEX_SIZE * 1.5 * row;
  return { x, y };
}

export function pixelToHex(px, py) {
  const r = Math.round(py / (HEX_SIZE * 1.5));
  const c = Math.round((px / (HEX_SIZE * SQRT3)) - 0.5 * (r & 1));
  return { col: ((c % MAP_COLS) + MAP_COLS) % MAP_COLS, row: ((r % MAP_ROWS) + MAP_ROWS) % MAP_ROWS };
}

export function drawHex(ctx, cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const hx = cx + size * Math.cos(angle);
    const hy = cy + size * Math.sin(angle);
    if (i === 0) ctx.moveTo(hx, hy);
    else ctx.lineTo(hx, hy);
  }
  ctx.closePath();
}

export function getHexEdgeMidpoint(col, row, dirIndex) {
  const { x: cx, y: cy } = hexToPixel(col, row);
  const edgeIdx = DIR_TO_EDGE[dirIndex];
  const a0 = (Math.PI / 180) * (60 * edgeIdx - 30);
  const a1 = (Math.PI / 180) * (60 * ((edgeIdx + 1) % 6) - 30);
  return {
    x: cx + HEX_SIZE * (Math.cos(a0) + Math.cos(a1)) / 2,
    y: cy + HEX_SIZE * (Math.sin(a0) + Math.sin(a1)) / 2
  };
}

export function getHexNeighbors(col, row) {
  const even = (row & 1) === 0;
  const dirs = even
    ? [[-1,-1],[0,-1],[-1,0],[1,0],[-1,1],[0,1]]
    : [[0,-1],[1,-1],[-1,0],[1,0],[0,1],[1,1]];
  const neighbors = [];
  for (const [dc, dr] of dirs) {
    // Toroidal wrapping: east-west wraps, north-south wraps
    const nc = ((col + dc) % MAP_COLS + MAP_COLS) % MAP_COLS;
    const nr = ((row + dr) % MAP_ROWS + MAP_ROWS) % MAP_ROWS;
    neighbors.push({ col: nc, row: nr });
  }
  return neighbors;
}

export function hexDistance(c1, r1, c2, r2) {
  // Toroidal distance: check direct and wrapped distances, use minimum
  const directDist = hexDistanceDirect(c1, r1, c2, r2);
  // Check wrapping alternatives
  const wrapDistances = [
    hexDistanceDirect(c1, r1, c2 + MAP_COLS, r2),
    hexDistanceDirect(c1, r1, c2 - MAP_COLS, r2),
    hexDistanceDirect(c1, r1, c2, r2 + MAP_ROWS),
    hexDistanceDirect(c1, r1, c2, r2 - MAP_ROWS),
  ];
  return Math.min(directDist, ...wrapDistances);
}

export function hexDistanceDirect(c1, r1, c2, r2) {
  const x1 = c1 - (r1 - (r1 & 1)) / 2, z1 = r1, y1 = -x1 - z1;
  const x2 = c2 - (r2 - (r2 & 1)) / 2, z2 = r2, y2 = -x2 - z2;
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
}

export function createFogOfWar(startCol, startRow) {
  const fog = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(false));
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (hexDistance(c, r, startCol, startRow) <= 5) {
        fog[r][c] = true;
      }
    }
  }
  return fog;
}
