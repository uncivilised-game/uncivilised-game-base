import { describe, test, expect } from 'vitest';
import { getTileMoveCost, getTileBaseMoveCost, isTilePassable, getTileName, getHexDirection } from '../src/map.js';
import { getHexNeighbors } from '../src/hex.js';
import { makeTile } from './fixtures.js';

describe('getTileBaseMoveCost()', () => {
  test('should return 1 for flat grassland', () => {
    expect(getTileBaseMoveCost(makeTile({ base: 'grassland' }))).toBe(1);
  });

  test('should return 1 for flat plains', () => {
    expect(getTileBaseMoveCost(makeTile({ base: 'plains' }))).toBe(1);
  });

  test('should return 2 for hills', () => {
    expect(getTileBaseMoveCost(makeTile({ base: 'grassland', feature: 'hills' }))).toBe(2);
  });

  test('should return 2 for woods', () => {
    expect(getTileBaseMoveCost(makeTile({ base: 'grassland', feature: 'woods' }))).toBe(2);
  });

  test('should return 99 for mountains (impassable)', () => {
    expect(getTileBaseMoveCost(makeTile({ base: 'grassland', feature: 'mountain' }))).toBe(99);
  });

  test('should return 99 for ocean', () => {
    expect(getTileBaseMoveCost(makeTile({ base: 'ocean' }))).toBe(99);
  });

  test('should return 2 for marsh', () => {
    expect(getTileBaseMoveCost(makeTile({ base: 'grassland', feature: 'marsh' }))).toBe(2);
  });
});

describe('getTileMoveCost()', () => {
  test('should equal base cost when no road', () => {
    const tile = makeTile({ base: 'grassland', feature: 'hills' });
    expect(getTileMoveCost(tile)).toBe(getTileBaseMoveCost(tile));
  });

  test('should halve cost with road (min 0.5)', () => {
    expect(getTileMoveCost(makeTile({ base: 'grassland', road: true }))).toBe(0.5);
  });

  test('should halve hills cost with road', () => {
    expect(getTileMoveCost(makeTile({ base: 'grassland', feature: 'hills', road: true }))).toBe(1);
  });

  test('should give 0.5 for road on flat terrain', () => {
    expect(getTileMoveCost(makeTile({ base: 'plains', road: true }))).toBe(0.5);
  });
});

describe('isTilePassable()', () => {
  test('should return true for grassland', () => {
    expect(isTilePassable(makeTile({ base: 'grassland' }))).toBe(true);
  });

  test('should return true for plains', () => {
    expect(isTilePassable(makeTile({ base: 'plains' }))).toBe(true);
  });

  test('should return true for desert', () => {
    expect(isTilePassable(makeTile({ base: 'desert' }))).toBe(true);
  });

  test('should return false for ocean', () => {
    expect(isTilePassable(makeTile({ base: 'ocean' }))).toBe(false);
  });

  test('should return false for coast', () => {
    expect(isTilePassable(makeTile({ base: 'coast' }))).toBe(false);
  });

  test('should return false for mountains', () => {
    expect(isTilePassable(makeTile({ base: 'grassland', feature: 'mountain' }))).toBe(false);
  });

  test('should return false for null/undefined tile', () => {
    expect(isTilePassable(null)).toBe(false);
    expect(isTilePassable(undefined)).toBe(false);
  });

  test('should return true for hills (passable rough terrain)', () => {
    expect(isTilePassable(makeTile({ base: 'grassland', feature: 'hills' }))).toBe(true);
  });
});

describe('getTileName()', () => {
  test('should return base terrain name for featureless tiles', () => {
    expect(getTileName(makeTile({ base: 'grassland' }))).toBe('Grassland');
    expect(getTileName(makeTile({ base: 'ocean' }))).toBe('Ocean');
    expect(getTileName(makeTile({ base: 'desert' }))).toBe('Desert');
  });

  test('should return "Mountain" for mountain feature', () => {
    expect(getTileName(makeTile({ base: 'grassland', feature: 'mountain' }))).toBe('Mountain');
  });

  test('should combine base and feature names', () => {
    expect(getTileName(makeTile({ base: 'grassland', feature: 'hills' }))).toBe('Grassland (Hills)');
    expect(getTileName(makeTile({ base: 'plains', feature: 'woods' }))).toBe('Plains (Woods)');
    expect(getTileName(makeTile({ base: 'grassland', feature: 'rainforest' }))).toBe('Grassland (Rainforest)');
  });
});

describe('getHexDirection()', () => {
  test('should return -1 for non-adjacent tiles', () => {
    expect(getHexDirection(0, 0, 10, 10)).toBe(-1);
  });

  test('should return a direction 0-5 for adjacent tiles', () => {
    const dir = getHexDirection(5, 10, 6, 10); // right neighbor, interior
    expect(dir).toBeGreaterThanOrEqual(0);
    expect(dir).toBeLessThanOrEqual(5);
  });

  test('should return distinct directions for each neighbor', () => {
    const neighbors = getHexNeighbors(10, 10);
    const directions = neighbors.map(n => getHexDirection(10, 10, n.col, n.row));
    expect(new Set(directions).size).toBe(6);
    for (const d of directions) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(5);
    }
  });
});
