import { describe, it, expect } from 'vitest';
import { hexToPixel, pixelToHex, hexDistance, hexDistanceDirect, getHexNeighbors, createFogOfWar } from '../src/hex.js';
import { MAP_COLS, MAP_ROWS, HEX_SIZE, SQRT3 } from '../src/constants.js';

describe('hexToPixel', () => {
  it('returns origin-area coordinates for (0,0)', () => {
    const { x, y } = hexToPixel(0, 0);
    expect(x).toBe(0); // col=0, even row offset = 0
    expect(y).toBe(0);
  });

  it('offsets odd rows by half a hex width', () => {
    const even = hexToPixel(3, 0);
    const odd = hexToPixel(3, 1);
    // Odd row should be shifted right by 0.5 * SQRT3 * HEX_SIZE
    expect(odd.x - even.x).toBeCloseTo(HEX_SIZE * SQRT3 * 0.5, 5);
  });

  it('y increases by 1.5 * HEX_SIZE per row', () => {
    const r0 = hexToPixel(0, 0);
    const r1 = hexToPixel(0, 1);
    expect(r1.y - r0.y).toBeCloseTo(HEX_SIZE * 1.5, 5);
  });
});

describe('pixelToHex', () => {
  it('converts center of (0,0) back to (0,0)', () => {
    const px = hexToPixel(0, 0);
    const hex = pixelToHex(px.x, px.y);
    expect(hex.col).toBe(0);
    expect(hex.row).toBe(0);
  });

  it('roundtrips for various coordinates', () => {
    const testCases = [
      [0, 0], [5, 5], [10, 3], [30, 20], [59, 39],
    ];
    for (const [col, row] of testCases) {
      const px = hexToPixel(col, row);
      const hex = pixelToHex(px.x, px.y);
      expect(hex.col).toBe(col);
      expect(hex.row).toBe(row);
    }
  });

  it('wraps coordinates toroidally', () => {
    // Negative pixel should wrap
    const hex = pixelToHex(-1, -1);
    expect(hex.col).toBeGreaterThanOrEqual(0);
    expect(hex.col).toBeLessThan(MAP_COLS);
    expect(hex.row).toBeGreaterThanOrEqual(0);
    expect(hex.row).toBeLessThan(MAP_ROWS);
  });
});

describe('hexDistanceDirect', () => {
  it('returns 0 for same tile', () => {
    expect(hexDistanceDirect(5, 5, 5, 5)).toBe(0);
  });

  it('returns 1 for adjacent tiles', () => {
    // Even row: (5,4) neighbors include (4,3), (5,3), (4,4), (6,4), (4,5), (5,5)
    expect(hexDistanceDirect(5, 4, 6, 4)).toBe(1);
  });

  it('is symmetric', () => {
    expect(hexDistanceDirect(3, 2, 7, 8)).toBe(hexDistanceDirect(7, 8, 3, 2));
  });

  it('computes known distances correctly', () => {
    // Two tiles in same row, 3 apart
    expect(hexDistanceDirect(0, 0, 3, 0)).toBe(3);
  });
});

describe('hexDistance (toroidal)', () => {
  it('returns 0 for same tile', () => {
    expect(hexDistance(10, 10, 10, 10)).toBe(0);
  });

  it('wrapping is shorter than direct for tiles near map edges', () => {
    // Tile at col 0 and tile at col 59 — wrapping should be distance 1
    const directDist = hexDistanceDirect(0, 0, MAP_COLS - 1, 0);
    const toroidalDist = hexDistance(0, 0, MAP_COLS - 1, 0);
    expect(toroidalDist).toBeLessThan(directDist);
  });

  it('is symmetric', () => {
    expect(hexDistance(2, 3, 55, 37)).toBe(hexDistance(55, 37, 2, 3));
  });

  it('satisfies triangle inequality', () => {
    const a = [5, 5], b = [15, 10], c = [25, 20];
    const ab = hexDistance(...a, ...b);
    const bc = hexDistance(...b, ...c);
    const ac = hexDistance(...a, ...c);
    expect(ac).toBeLessThanOrEqual(ab + bc);
  });
});

describe('getHexNeighbors', () => {
  it('always returns exactly 6 neighbors', () => {
    expect(getHexNeighbors(5, 5)).toHaveLength(6);
    expect(getHexNeighbors(0, 0)).toHaveLength(6);
    expect(getHexNeighbors(59, 39)).toHaveLength(6);
  });

  it('returns unique neighbors', () => {
    const neighbors = getHexNeighbors(10, 10);
    const keys = neighbors.map(n => `${n.col},${n.row}`);
    expect(new Set(keys).size).toBe(6);
  });

  it('neighbors are all distance 1 away', () => {
    const neighbors = getHexNeighbors(10, 10);
    for (const n of neighbors) {
      expect(hexDistance(10, 10, n.col, n.row)).toBe(1);
    }
  });

  it('wraps at map edges', () => {
    const neighbors = getHexNeighbors(0, 0);
    // All coordinates should be valid (within map bounds)
    for (const n of neighbors) {
      expect(n.col).toBeGreaterThanOrEqual(0);
      expect(n.col).toBeLessThan(MAP_COLS);
      expect(n.row).toBeGreaterThanOrEqual(0);
      expect(n.row).toBeLessThan(MAP_ROWS);
    }
  });

  it('uses different offsets for even vs odd rows', () => {
    const evenNeighbors = getHexNeighbors(5, 4); // even row
    const oddNeighbors = getHexNeighbors(5, 5);  // odd row
    // They should have different neighbor sets
    const evenKeys = new Set(evenNeighbors.map(n => `${n.col},${n.row}`));
    const oddKeys = new Set(oddNeighbors.map(n => `${n.col},${n.row}`));
    // The sets should not be identical (different row parity = different offsets)
    const overlap = [...evenKeys].filter(k => oddKeys.has(k));
    expect(overlap.length).toBeLessThan(6);
  });
});

describe('createFogOfWar', () => {
  it('returns a MAP_ROWS x MAP_COLS grid', () => {
    const fog = createFogOfWar(30, 20);
    expect(fog).toHaveLength(MAP_ROWS);
    expect(fog[0]).toHaveLength(MAP_COLS);
  });

  it('starting tile is visible', () => {
    const fog = createFogOfWar(30, 20);
    expect(fog[20][30]).toBe(true);
  });

  it('tiles within radius 5 are visible', () => {
    const fog = createFogOfWar(30, 20);
    // Check a few tiles known to be within 5 hexes
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (hexDistance(c, r, 30, 20) <= 5) {
          expect(fog[r][c]).toBe(true);
        }
      }
    }
  });

  it('tiles beyond radius 5 are not visible', () => {
    const fog = createFogOfWar(30, 20);
    // Find a tile far away
    let foundHidden = false;
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (hexDistance(c, r, 30, 20) > 5) {
          expect(fog[r][c]).toBe(false);
          foundHidden = true;
          break;
        }
      }
      if (foundHidden) break;
    }
    expect(foundHidden).toBe(true);
  });
});
