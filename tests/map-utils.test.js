import { describe, it, expect } from 'vitest';
import { getTileMoveCost, getTileBaseMoveCost, isTilePassable, getTileName, getHexDirection } from '../src/map.js';
import { getHexNeighbors } from '../src/hex.js';
import { makeTile } from './fixtures.js';

describe('getTileBaseMoveCost', () => {
  it('returns 1 for flat grassland', () => {
    expect(getTileBaseMoveCost(makeTile({ base: 'grassland' }))).toBe(1);
  });

  it('returns 1 for flat plains', () => {
    expect(getTileBaseMoveCost(makeTile({ base: 'plains' }))).toBe(1);
  });

  it('returns 2 for hills', () => {
    expect(getTileBaseMoveCost(makeTile({ base: 'grassland', feature: 'hills' }))).toBe(2);
  });

  it('returns 2 for woods', () => {
    expect(getTileBaseMoveCost(makeTile({ base: 'grassland', feature: 'woods' }))).toBe(2);
  });

  it('returns 99 for mountains (impassable)', () => {
    expect(getTileBaseMoveCost(makeTile({ base: 'grassland', feature: 'mountain' }))).toBe(99);
  });

  it('returns 99 for ocean', () => {
    expect(getTileBaseMoveCost(makeTile({ base: 'ocean' }))).toBe(99);
  });

  it('returns 2 for marsh', () => {
    expect(getTileBaseMoveCost(makeTile({ base: 'grassland', feature: 'marsh' }))).toBe(2);
  });
});

describe('getTileMoveCost', () => {
  it('equals base cost when no road', () => {
    const tile = makeTile({ base: 'grassland', feature: 'hills' });
    expect(getTileMoveCost(tile)).toBe(getTileBaseMoveCost(tile));
  });

  it('halves cost with road (min 0.5)', () => {
    const tile = makeTile({ base: 'grassland', road: true });
    expect(getTileMoveCost(tile)).toBe(0.5);
  });

  it('halves hills cost with road', () => {
    const tile = makeTile({ base: 'grassland', feature: 'hills', road: true });
    expect(getTileMoveCost(tile)).toBe(1); // 2 * 0.5
  });

  it('road on flat terrain gives 0.5', () => {
    const tile = makeTile({ base: 'plains', road: true });
    expect(getTileMoveCost(tile)).toBe(0.5);
  });
});

describe('isTilePassable', () => {
  it('returns true for grassland', () => {
    expect(isTilePassable(makeTile({ base: 'grassland' }))).toBe(true);
  });

  it('returns true for plains', () => {
    expect(isTilePassable(makeTile({ base: 'plains' }))).toBe(true);
  });

  it('returns true for desert', () => {
    expect(isTilePassable(makeTile({ base: 'desert' }))).toBe(true);
  });

  it('returns false for ocean', () => {
    expect(isTilePassable(makeTile({ base: 'ocean' }))).toBe(false);
  });

  it('returns false for coast', () => {
    expect(isTilePassable(makeTile({ base: 'coast' }))).toBe(false);
  });

  it('returns false for mountains', () => {
    expect(isTilePassable(makeTile({ base: 'grassland', feature: 'mountain' }))).toBe(false);
  });

  it('returns false for null/undefined tile', () => {
    expect(isTilePassable(null)).toBe(false);
    expect(isTilePassable(undefined)).toBe(false);
  });

  it('returns true for hills (passable rough terrain)', () => {
    expect(isTilePassable(makeTile({ base: 'grassland', feature: 'hills' }))).toBe(true);
  });
});

describe('getTileName', () => {
  it('returns base terrain name for featureless tiles', () => {
    expect(getTileName(makeTile({ base: 'grassland' }))).toBe('Grassland');
    expect(getTileName(makeTile({ base: 'ocean' }))).toBe('Ocean');
    expect(getTileName(makeTile({ base: 'desert' }))).toBe('Desert');
  });

  it('returns "Mountain" for mountain feature', () => {
    expect(getTileName(makeTile({ base: 'grassland', feature: 'mountain' }))).toBe('Mountain');
  });

  it('combines base and feature names', () => {
    expect(getTileName(makeTile({ base: 'grassland', feature: 'hills' }))).toBe('Grassland (Hills)');
    expect(getTileName(makeTile({ base: 'plains', feature: 'woods' }))).toBe('Plains (Woods)');
    expect(getTileName(makeTile({ base: 'grassland', feature: 'rainforest' }))).toBe('Grassland (Rainforest)');
  });
});

describe('getHexDirection', () => {
  it('returns -1 for non-adjacent tiles', () => {
    expect(getHexDirection(0, 0, 10, 10)).toBe(-1);
  });

  it('returns a direction 0-5 for adjacent tiles', () => {
    // Even row (0): neighbors of (5,0) are (4,-1),(5,-1),(4,0),(6,0),(4,1),(5,1)
    // With wrapping, (4, 39) and (5, 39) for the top neighbors
    const dir = getHexDirection(5, 0, 6, 0); // right neighbor
    expect(dir).toBeGreaterThanOrEqual(0);
    expect(dir).toBeLessThanOrEqual(5);
  });

  it('returns distinct directions for each neighbor', () => {
    // For tile (10, 10), get directions to all 6 neighbors
    const neighbors = getHexNeighbors(10, 10);
    const directions = neighbors.map(n => getHexDirection(10, 10, n.col, n.row));
    // All should be 0-5 and unique
    expect(new Set(directions).size).toBe(6);
    for (const d of directions) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(5);
    }
  });
});
