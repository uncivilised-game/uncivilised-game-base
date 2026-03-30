import { describe, it, expect, beforeEach } from 'vitest';
import { getTileYields, crossesRiver, roadBridgesRiver, isResourceRevealed, getHexDirection } from '../src/map.js';
import { getHexNeighbors } from '../src/hex.js';
import { setupGameState, makeTile } from './fixtures.js';

describe('getTileYields', () => {
  beforeEach(() => {
    setupGameState();
  });

  it('returns base terrain yields for grassland', () => {
    const yields = getTileYields(makeTile({ base: 'grassland' }));
    expect(yields.food).toBe(2);
    expect(yields.prod).toBe(0);
    expect(yields.gold).toBe(0);
  });

  it('returns base terrain yields for plains', () => {
    const yields = getTileYields(makeTile({ base: 'plains' }));
    expect(yields.food).toBe(1);
    expect(yields.prod).toBe(1);
    expect(yields.gold).toBe(0);
  });

  it('returns base terrain yields for desert', () => {
    const yields = getTileYields(makeTile({ base: 'desert' }));
    expect(yields.food).toBe(0);
    expect(yields.prod).toBe(0);
    expect(yields.gold).toBe(0);
  });

  it('adds feature yields (hills)', () => {
    const yields = getTileYields(makeTile({ base: 'grassland', feature: 'hills' }));
    expect(yields.food).toBe(2);
    expect(yields.prod).toBe(1); // hills add +1 prod
    expect(yields.gold).toBe(0);
  });

  it('adds feature yields (woods)', () => {
    const yields = getTileYields(makeTile({ base: 'grassland', feature: 'woods' }));
    expect(yields.prod).toBe(1); // woods add +1 prod
  });

  it('adds feature yields (floodplains)', () => {
    const yields = getTileYields(makeTile({ base: 'desert', feature: 'floodplains' }));
    expect(yields.food).toBe(3); // 0 desert + 3 floodplains
  });

  it('adds +1 gold for river on land tiles', () => {
    const yields = getTileYields(makeTile({ base: 'grassland', hasRiver: true }));
    expect(yields.gold).toBe(1);
  });

  it('does not add river gold for ocean', () => {
    const yields = getTileYields(makeTile({ base: 'ocean', hasRiver: true }));
    expect(yields.gold).toBe(0);
  });

  it('adds resource bonus yields (revealed resources)', () => {
    // Wheat is a bonus resource (no revealedBy), so always visible
    const yields = getTileYields(makeTile({ base: 'grassland', resource: 'wheat' }));
    expect(yields.food).toBe(4); // 2 grassland + 2 wheat
  });

  it('adds improvement yields (farm)', () => {
    const yields = getTileYields(makeTile({ base: 'grassland', improvement: 'farm' }));
    expect(yields.food).toBe(4); // 2 grassland + 2 farm
  });

  it('farm on river gets extra food from improvement', () => {
    const yields = getTileYields(makeTile({ base: 'grassland', improvement: 'farm', hasRiver: true }));
    // 2 grassland + 1 river gold + 2 farm food + 1 river farm bonus food
    expect(yields.food).toBe(5); // 2 + 2 + 1 (river farm bonus)
    expect(yields.gold).toBe(1);
  });

  it('road adds +1 gold from improvement', () => {
    const yields = getTileYields(makeTile({ base: 'grassland', road: true }));
    expect(yields.gold).toBe(1); // road trade gold
  });

  it('returns zeros for unknown terrain', () => {
    const yields = getTileYields(makeTile({ base: 'nonexistent' }));
    expect(yields.food).toBe(0);
    expect(yields.prod).toBe(0);
    expect(yields.gold).toBe(0);
  });
});

describe('isResourceRevealed', () => {
  it('returns true for non-strategic resources', () => {
    expect(isResourceRevealed('wheat')).toBe(true);
    expect(isResourceRevealed('gold_ore')).toBe(true);
  });

  it('returns false for strategic resources without tech', () => {
    expect(isResourceRevealed('iron', [])).toBe(false);
  });

  it('returns true for strategic resources when revealed', () => {
    expect(isResourceRevealed('iron', ['iron'])).toBe(true);
  });

  it('returns true for unknown resource IDs', () => {
    expect(isResourceRevealed('nonexistent')).toBe(true);
  });
});

describe('crossesRiver', () => {
  beforeEach(() => {
    setupGameState();
  });

  it('returns false when no river exists', () => {
    expect(crossesRiver(5, 5, 6, 5)).toBe(false);
  });

  it('returns true when moving across a river edge', () => {
    const state = setupGameState();
    const neighbors = getHexNeighbors(10, 10);
    const dir = getHexDirection(10, 10, neighbors[3].col, neighbors[3].row);

    state.map[10][10].hasRiver = true;
    state.map[10][10].riverEdges = [dir];

    expect(crossesRiver(10, 10, neighbors[3].col, neighbors[3].row)).toBe(true);
  });

  it('returns false for river tile moving in non-river direction', () => {
    const state = setupGameState();
    state.map[10][10].hasRiver = true;
    state.map[10][10].riverEdges = [0]; // only edge 0

    // Move in direction 3 (right) — no river edge there
    const neighbors = getHexNeighbors(10, 10);
    const dir3Neighbor = neighbors.find(n => getHexDirection(10, 10, n.col, n.row) === 3);
    if (dir3Neighbor) {
      expect(crossesRiver(10, 10, dir3Neighbor.col, dir3Neighbor.row)).toBe(false);
    }
  });

  it('returns false for non-adjacent tiles', () => {
    const state = setupGameState();
    state.map[10][10].hasRiver = true;
    state.map[10][10].riverEdges = [0, 1, 2, 3, 4, 5];
    expect(crossesRiver(10, 10, 20, 20)).toBe(false);
  });
});

describe('roadBridgesRiver', () => {
  beforeEach(() => {
    setupGameState();
  });

  it('returns false when neither tile has a road', () => {
    expect(roadBridgesRiver(5, 5, 6, 5)).toBe(false);
  });

  it('returns false when only one tile has a road', () => {
    const state = setupGameState();
    state.map[5][5].road = true;
    expect(roadBridgesRiver(5, 5, 6, 5)).toBe(false);
  });

  it('returns true when both tiles have roads', () => {
    const state = setupGameState();
    state.map[5][5].road = true;
    state.map[5][6].road = true;
    expect(roadBridgesRiver(5, 5, 6, 5)).toBe(true);
  });
});
