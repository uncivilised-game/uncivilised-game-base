import { describe, test, expect, beforeEach, vi } from 'vitest';
import { getTileYields, crossesRiver, roadBridgesRiver, isResourceRevealed, getHexDirection } from '../src/map.js';
import { registerDiplomacyPlugin } from '../src/diplomacy-api.js';
import { getHexNeighbors } from '../src/hex.js';
import { setupGameState, makeTile } from './fixtures.js';

describe('getTileYields()', () => {
  beforeEach(() => {
    setupGameState();
  });

  test('should return base terrain yields for grassland', () => {
    const yields = getTileYields(makeTile({ base: 'grassland' }));
    expect(yields.food).toBe(2);
    expect(yields.prod).toBe(0);
    expect(yields.gold).toBe(0);
  });

  test('should return base terrain yields for plains', () => {
    const yields = getTileYields(makeTile({ base: 'plains' }));
    expect(yields.food).toBe(1);
    expect(yields.prod).toBe(1);
    expect(yields.gold).toBe(0);
  });

  test('should return base terrain yields for desert', () => {
    const yields = getTileYields(makeTile({ base: 'desert' }));
    expect(yields).toEqual({ food: 0, prod: 0, gold: 0 });
  });

  test('should add feature yields (hills)', () => {
    const yields = getTileYields(makeTile({ base: 'grassland', feature: 'hills' }));
    expect(yields.prod).toBe(1);
  });

  test('should add feature yields (woods)', () => {
    const yields = getTileYields(makeTile({ base: 'grassland', feature: 'woods' }));
    expect(yields.prod).toBe(1);
  });

  test('should add feature yields (floodplains)', () => {
    const yields = getTileYields(makeTile({ base: 'desert', feature: 'floodplains' }));
    expect(yields.food).toBe(3);
  });

  test('should add +1 gold for river on land tiles', () => {
    const yields = getTileYields(makeTile({ base: 'grassland', hasRiver: true }));
    expect(yields.gold).toBe(1);
  });

  test('should not add river gold for ocean', () => {
    const yields = getTileYields(makeTile({ base: 'ocean', hasRiver: true }));
    expect(yields.gold).toBe(0);
  });

  test('should add resource bonus yields', () => {
    const yields = getTileYields(makeTile({ base: 'grassland', resource: 'wheat' }));
    expect(yields.food).toBe(4);
  });

  test('should add improvement yields (farm)', () => {
    const yields = getTileYields(makeTile({ base: 'grassland', improvement: 'farm' }));
    expect(yields.food).toBe(4);
  });

  test('should give farm on river extra food', () => {
    const yields = getTileYields(makeTile({ base: 'grassland', improvement: 'farm', hasRiver: true }));
    expect(yields.food).toBe(5);
    expect(yields.gold).toBe(1);
  });

  test('should add +1 gold from road', () => {
    const yields = getTileYields(makeTile({ base: 'grassland', road: true }));
    expect(yields.gold).toBe(1);
  });

  test('should return zeros for unknown terrain', () => {
    const yields = getTileYields(makeTile({ base: 'nonexistent' }));
    expect(yields).toEqual({ food: 0, prod: 0, gold: 0 });
  });

  test('should pass factionId to getModYieldBonus so bonuses are faction-specific', () => {
    const state = setupGameState();
    state.yieldBonuses = [{ factionId: 'player' }];
    const tile = makeTile({ base: 'grassland' });
    const mockGetModYieldBonus = vi.fn(() => ({ food: 0, prod: 0, gold: 0 }));
    registerDiplomacyPlugin({ getModYieldBonus: mockGetModYieldBonus });

    getTileYields(tile, 'player');
    expect(mockGetModYieldBonus).toHaveBeenCalledWith(tile, 'player');

    getTileYields(tile, 'faction_a');
    expect(mockGetModYieldBonus).toHaveBeenCalledWith(tile, 'faction_a');

    // Restore no-op plugin
    registerDiplomacyPlugin({ getModYieldBonus: () => ({ food: 0, prod: 0, gold: 0 }) });
  });
});

describe('isResourceRevealed()', () => {
  test('should return true for non-strategic resources', () => {
    expect(isResourceRevealed('wheat')).toBe(true);
    expect(isResourceRevealed('gold_ore')).toBe(true);
  });

  test('should return false for strategic resources without tech', () => {
    expect(isResourceRevealed('iron', [])).toBe(false);
  });

  test('should return true for strategic resources when revealed', () => {
    expect(isResourceRevealed('iron', ['iron'])).toBe(true);
  });

  test('should return true for unknown resource IDs', () => {
    expect(isResourceRevealed('nonexistent')).toBe(true);
  });
});

describe('crossesRiver()', () => {
  beforeEach(() => {
    setupGameState();
  });

  test('should return false when no river exists', () => {
    expect(crossesRiver(5, 5, 6, 5)).toBe(false);
  });

  test('should return true when moving across a river edge', () => {
    const state = setupGameState();
    const neighbors = getHexNeighbors(10, 10);
    const dir = getHexDirection(10, 10, neighbors[3].col, neighbors[3].row);
    state.map[10][10].hasRiver = true;
    state.map[10][10].riverEdges = [dir];
    expect(crossesRiver(10, 10, neighbors[3].col, neighbors[3].row)).toBe(true);
  });

  test('should return false for river tile moving in non-river direction', () => {
    const state = setupGameState();
    state.map[10][10].hasRiver = true;
    state.map[10][10].riverEdges = [0];
    const neighbors = getHexNeighbors(10, 10);
    const dir3Neighbor = neighbors.find(n => getHexDirection(10, 10, n.col, n.row) === 3);
    if (dir3Neighbor) {
      expect(crossesRiver(10, 10, dir3Neighbor.col, dir3Neighbor.row)).toBe(false);
    }
  });

  test('should return false for non-adjacent tiles', () => {
    const state = setupGameState();
    state.map[10][10].hasRiver = true;
    state.map[10][10].riverEdges = [0, 1, 2, 3, 4, 5];
    expect(crossesRiver(10, 10, 20, 20)).toBe(false);
  });
});

describe('roadBridgesRiver()', () => {
  beforeEach(() => {
    setupGameState();
  });

  test('should return false when neither tile has a road', () => {
    expect(roadBridgesRiver(5, 5, 6, 5)).toBe(false);
  });

  test('should return false when only one tile has a road', () => {
    const state = setupGameState();
    state.map[5][5].road = true;
    expect(roadBridgesRiver(5, 5, 6, 5)).toBe(false);
  });

  test('should return true when both tiles have roads', () => {
    const state = setupGameState();
    state.map[5][5].road = true;
    state.map[5][6].road = true;
    expect(roadBridgesRiver(5, 5, 6, 5)).toBe(true);
  });
});
