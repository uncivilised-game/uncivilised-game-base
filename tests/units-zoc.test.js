import { describe, test, expect, beforeEach } from 'vitest';
import { isInEnemyZOC, getEnemyZOCHexes } from '../src/units.js';
import { getHexNeighbors } from '../src/hex.js';
import { setupGameState, makeUnit } from './fixtures.js';

describe('isInEnemyZOC()', () => {
  beforeEach(() => {
    setupGameState();
  });

  test('should return false when no enemy units nearby', () => {
    setupGameState({ units: [] });
    expect(isInEnemyZOC(10, 10, 'player')).toBe(false);
  });

  test('should return true when adjacent to enemy military unit', () => {
    setupGameState({
      units: [makeUnit({ id: 1, col: 11, row: 10, type: 'warrior', owner: 'faction_a' })],
    });
    expect(isInEnemyZOC(10, 10, 'player')).toBe(true);
  });

  test('should return false when adjacent to friendly unit', () => {
    setupGameState({
      units: [makeUnit({ id: 1, col: 11, row: 10, type: 'warrior', owner: 'player' })],
    });
    expect(isInEnemyZOC(10, 10, 'player')).toBe(false);
  });

  test("should return false when adjacent to civilian unit (workers don't project ZOC)", () => {
    setupGameState({
      units: [makeUnit({ id: 1, col: 11, row: 10, type: 'worker', owner: 'faction_a' })],
    });
    expect(isInEnemyZOC(10, 10, 'player')).toBe(false);
  });

  test('should return true for non-player units checking player ZOC', () => {
    setupGameState({
      units: [makeUnit({ id: 1, col: 11, row: 10, type: 'warrior', owner: 'player' })],
    });
    expect(isInEnemyZOC(10, 10, 'faction_a')).toBe(true);
  });
});

describe('getEnemyZOCHexes()', () => {
  test('should return empty set when no enemy units', () => {
    setupGameState({ units: [] });
    const zoc = getEnemyZOCHexes('player');
    expect(zoc.size).toBe(0);
  });

  test('should include neighbors of enemy military units', () => {
    setupGameState({
      units: [makeUnit({ id: 1, col: 10, row: 10, type: 'warrior', owner: 'faction_a' })],
    });
    const zoc = getEnemyZOCHexes('player');
    const neighbors = getHexNeighbors(10, 10);
    for (const n of neighbors) {
      expect(zoc.has(`${n.col},${n.row}`)).toBe(true);
    }
  });

  test('should exclude civilian units from ZOC projection', () => {
    setupGameState({
      units: [makeUnit({ id: 1, col: 10, row: 10, type: 'worker', owner: 'faction_a' })],
    });
    const zoc = getEnemyZOCHexes('player');
    expect(zoc.size).toBe(0);
  });

  test('should exclude friendly units from ZOC calculation', () => {
    setupGameState({
      units: [makeUnit({ id: 1, col: 10, row: 10, type: 'warrior', owner: 'player' })],
    });
    const zoc = getEnemyZOCHexes('player');
    expect(zoc.size).toBe(0);
  });

  test('should combine ZOC from multiple enemy units', () => {
    setupGameState({
      units: [
        makeUnit({ id: 1, col: 10, row: 10, type: 'warrior', owner: 'faction_a' }),
        makeUnit({ id: 2, col: 20, row: 20, type: 'archer', owner: 'faction_b' }),
      ],
    });
    const zoc = getEnemyZOCHexes('player');
    const neighbors1 = getHexNeighbors(10, 10);
    const neighbors2 = getHexNeighbors(20, 20);
    // Far apart, no overlap — size should be sum of neighbor counts
    expect(zoc.size).toBe(neighbors1.length + neighbors2.length);
  });
});
