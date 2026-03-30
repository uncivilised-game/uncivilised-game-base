import { describe, test, expect } from 'vitest';
import { hexToPixel, pixelToHex, hexDistance, hexDistanceDirect, getHexNeighbors, createFogOfWar } from '../src/hex.js';
import { MAP_COLS, MAP_ROWS, HEX_SIZE, SQRT3 } from '../src/constants.js';

describe('hexToPixel()', () => {
  test('should return origin-area coordinates for (0,0)', () => {
    const { x, y } = hexToPixel(0, 0);
    expect(x).toBe(0);
    expect(y).toBe(0);
  });

  test('should offset odd rows by half a hex width', () => {
    const even = hexToPixel(3, 0);
    const odd = hexToPixel(3, 1);
    expect(odd.x - even.x).toBeCloseTo(HEX_SIZE * SQRT3 * 0.5, 5);
  });

  test('should increase y by 1.5 * HEX_SIZE per row', () => {
    const r0 = hexToPixel(0, 0);
    const r1 = hexToPixel(0, 1);
    expect(r1.y - r0.y).toBeCloseTo(HEX_SIZE * 1.5, 5);
  });
});

describe('pixelToHex()', () => {
  test('should convert center of (0,0) back to (0,0)', () => {
    const px = hexToPixel(0, 0);
    const hex = pixelToHex(px.x, px.y);
    expect(hex.col).toBe(0);
    expect(hex.row).toBe(0);
  });

  test('should roundtrip for various coordinates', () => {
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

  test('should wrap columns but clamp rows (cylinder geometry)', () => {
    // Negative pixel should wrap columns but clamp rows
    const hex = pixelToHex(-1, -1);
    expect(hex.col).toBeGreaterThanOrEqual(0);
    expect(hex.col).toBeLessThan(MAP_COLS);
    expect(hex.row).toBe(0); // clamped to top, not wrapped
  });

  test('should clamp rows at bottom edge', () => {
    // Very large y should clamp to MAP_ROWS - 1
    const hex = pixelToHex(0, 99999);
    expect(hex.row).toBe(MAP_ROWS - 1);
  });
});

describe('hexDistanceDirect()', () => {
  test('should return 0 for same tile', () => {
    expect(hexDistanceDirect(5, 5, 5, 5)).toBe(0);
  });

  test('should return 1 for adjacent tiles', () => {
    expect(hexDistanceDirect(5, 4, 6, 4)).toBe(1);
  });

  test('should be symmetric', () => {
    expect(hexDistanceDirect(3, 2, 7, 8)).toBe(hexDistanceDirect(7, 8, 3, 2));
  });

  test('should compute known distances correctly', () => {
    expect(hexDistanceDirect(0, 0, 3, 0)).toBe(3);
  });
});

describe('hexDistance() (cylindrical)', () => {
  test('should return 0 for same tile', () => {
    expect(hexDistance(10, 10, 10, 10)).toBe(0);
  });

  test('should wrap east-west for tiles near map edges', () => {
    // col 0 and col 59 — wrapping should be shorter than direct
    const directDist = hexDistanceDirect(0, 0, MAP_COLS - 1, 0);
    const cylDist = hexDistance(0, 0, MAP_COLS - 1, 0);
    expect(cylDist).toBeLessThan(directDist);
  });

  test('should NOT wrap north-south (cylinder, not torus)', () => {
    // row 0 and row 39 — distance should be the direct distance, no wrapping
    const directDist = hexDistanceDirect(0, 0, 0, MAP_ROWS - 1);
    const cylDist = hexDistance(0, 0, 0, MAP_ROWS - 1);
    expect(cylDist).toBe(directDist);
  });

  test('should be symmetric', () => {
    expect(hexDistance(2, 3, 55, 37)).toBe(hexDistance(55, 37, 2, 3));
  });

  test('should satisfy triangle inequality', () => {
    const a = [5, 5], b = [15, 10], c = [25, 20];
    const ab = hexDistance(...a, ...b);
    const bc = hexDistance(...b, ...c);
    const ac = hexDistance(...a, ...c);
    expect(ac).toBeLessThanOrEqual(ab + bc);
  });
});

describe('getHexNeighbors()', () => {
  test('should return 6 neighbors for interior tiles', () => {
    expect(getHexNeighbors(5, 5)).toHaveLength(6);
    expect(getHexNeighbors(30, 20)).toHaveLength(6);
  });

  test('should return fewer neighbors for top row (no north wrapping)', () => {
    const neighbors = getHexNeighbors(5, 0);
    // Top row: 2 upward neighbors are off-map, only 4 remain
    expect(neighbors.length).toBeLessThan(6);
    for (const n of neighbors) {
      expect(n.row).toBeGreaterThanOrEqual(0);
    }
  });

  test('should return fewer neighbors for bottom row', () => {
    const neighbors = getHexNeighbors(5, MAP_ROWS - 1);
    expect(neighbors.length).toBeLessThan(6);
    for (const n of neighbors) {
      expect(n.row).toBeLessThan(MAP_ROWS);
    }
  });

  test('should return unique neighbors', () => {
    const neighbors = getHexNeighbors(10, 10);
    const keys = neighbors.map(n => `${n.col},${n.row}`);
    expect(new Set(keys).size).toBe(neighbors.length);
  });

  test('should return neighbors all distance 1 away', () => {
    const neighbors = getHexNeighbors(10, 10);
    for (const n of neighbors) {
      expect(hexDistance(10, 10, n.col, n.row)).toBe(1);
    }
  });

  test('should wrap east-west at map edges', () => {
    const neighbors = getHexNeighbors(0, 10);
    // Left neighbor should wrap to MAP_COLS - 1
    const cols = neighbors.map(n => n.col);
    expect(cols.some(c => c === MAP_COLS - 1)).toBe(true);
  });

  test('should use different offsets for even vs odd rows', () => {
    const evenNeighbors = getHexNeighbors(5, 4); // even row
    const oddNeighbors = getHexNeighbors(5, 5);  // odd row
    const evenKeys = new Set(evenNeighbors.map(n => `${n.col},${n.row}`));
    const oddKeys = new Set(oddNeighbors.map(n => `${n.col},${n.row}`));
    const overlap = [...evenKeys].filter(k => oddKeys.has(k));
    expect(overlap.length).toBeLessThan(6);
  });
});

describe('createFogOfWar()', () => {
  test('should return a MAP_ROWS x MAP_COLS grid', () => {
    const fog = createFogOfWar(30, 20);
    expect(fog).toHaveLength(MAP_ROWS);
    expect(fog[0]).toHaveLength(MAP_COLS);
  });

  test('should mark starting tile as visible', () => {
    const fog = createFogOfWar(30, 20);
    expect(fog[20][30]).toBe(true);
  });

  test('should mark tiles within radius 5 as visible', () => {
    const fog = createFogOfWar(30, 20);
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (hexDistance(c, r, 30, 20) <= 5) {
          expect(fog[r][c]).toBe(true);
        }
      }
    }
  });

  test('should not reveal tiles beyond radius 5', () => {
    const fog = createFogOfWar(30, 20);
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

  test('should not wrap fog visibility north-south', () => {
    // Start at top row — fog should NOT appear at bottom row
    const fog = createFogOfWar(30, 0);
    expect(fog[MAP_ROWS - 1][30]).toBe(false);
  });
});
