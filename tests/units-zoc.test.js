import { describe, it, expect, beforeEach } from 'vitest';
import { isInEnemyZOC, getEnemyZOCHexes } from '../src/units.js';
import { getHexNeighbors } from '../src/hex.js';
import { setupGameState, makeUnit } from './fixtures.js';

describe('isInEnemyZOC', () => {
  beforeEach(() => {
    setupGameState();
  });

  it('returns false when no enemy units nearby', () => {
    setupGameState({ units: [] });
    expect(isInEnemyZOC(10, 10, 'player')).toBe(false);
  });

  it('returns true when adjacent to enemy military unit', () => {
    setupGameState({
      units: [makeUnit({ id: 1, col: 11, row: 10, type: 'warrior', owner: 'emperor_valerian' })],
    });
    // (10,10) is adjacent to (11,10) — should be in ZOC
    expect(isInEnemyZOC(10, 10, 'player')).toBe(true);
  });

  it('returns false when adjacent to friendly unit', () => {
    setupGameState({
      units: [makeUnit({ id: 1, col: 11, row: 10, type: 'warrior', owner: 'player' })],
    });
    expect(isInEnemyZOC(10, 10, 'player')).toBe(false);
  });

  it('returns false when adjacent to civilian unit (workers dont project ZOC)', () => {
    setupGameState({
      units: [makeUnit({ id: 1, col: 11, row: 10, type: 'worker', owner: 'emperor_valerian' })],
    });
    expect(isInEnemyZOC(10, 10, 'player')).toBe(false);
  });

  it('returns true for AI units checking player ZOC', () => {
    setupGameState({
      units: [makeUnit({ id: 1, col: 11, row: 10, type: 'warrior', owner: 'player' })],
    });
    expect(isInEnemyZOC(10, 10, 'emperor_valerian')).toBe(true);
  });
});

describe('getEnemyZOCHexes', () => {
  it('returns empty set when no enemy units', () => {
    setupGameState({ units: [] });
    const zoc = getEnemyZOCHexes('player');
    expect(zoc.size).toBe(0);
  });

  it('includes neighbors of enemy military units', () => {
    setupGameState({
      units: [makeUnit({ id: 1, col: 10, row: 10, type: 'warrior', owner: 'emperor_valerian' })],
    });
    const zoc = getEnemyZOCHexes('player');
    // Should include all 6 neighbors of (10,10)
    const neighbors = getHexNeighbors(10, 10);
    for (const n of neighbors) {
      expect(zoc.has(`${n.col},${n.row}`)).toBe(true);
    }
  });

  it('excludes civilian units from ZOC projection', () => {
    setupGameState({
      units: [makeUnit({ id: 1, col: 10, row: 10, type: 'worker', owner: 'emperor_valerian' })],
    });
    const zoc = getEnemyZOCHexes('player');
    expect(zoc.size).toBe(0);
  });

  it('excludes friendly units from ZOC calculation', () => {
    setupGameState({
      units: [makeUnit({ id: 1, col: 10, row: 10, type: 'warrior', owner: 'player' })],
    });
    const zoc = getEnemyZOCHexes('player');
    expect(zoc.size).toBe(0);
  });

  it('combines ZOC from multiple enemy units', () => {
    setupGameState({
      units: [
        makeUnit({ id: 1, col: 10, row: 10, type: 'warrior', owner: 'emperor_valerian' }),
        makeUnit({ id: 2, col: 20, row: 20, type: 'archer', owner: 'shadow_kael' }),
      ],
    });
    const zoc = getEnemyZOCHexes('player');
    // Should have neighbors of both units (12 total, possibly with overlap)
    expect(zoc.size).toBe(12); // far apart, no overlap
  });
});
