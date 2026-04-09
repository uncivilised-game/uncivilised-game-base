import { describe, test, expect, beforeEach } from 'vitest';
import { getBestAttackTarget } from '../src/units.js';
import { setupGameState, makeUnit } from './fixtures.js';

describe('getBestAttackTarget()', () => {
  beforeEach(() => {
    setupGameState();
  });

  test('returns null when no units at tile', () => {
    setupGameState({ units: [] });
    expect(getBestAttackTarget(5, 5, () => true)).toBeNull();
  });

  test('returns the only unit when one unit is present', () => {
    const warrior = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'faction_a' });
    setupGameState({ units: [warrior] });
    const target = getBestAttackTarget(5, 5, u => u.owner !== 'player');
    expect(target.id).toBe(1);
  });

  test('prefers combat unit over civilian when both occupy the same tile', () => {
    // Civilian appears first in the array — bug was that find() would return it
    const worker = makeUnit({ id: 1, col: 5, row: 5, type: 'worker', owner: 'faction_a' });
    const warrior = makeUnit({ id: 2, col: 5, row: 5, type: 'warrior', owner: 'faction_a' });
    setupGameState({ units: [worker, warrior] });
    const target = getBestAttackTarget(5, 5, u => u.owner !== 'player');
    expect(target.id).toBe(2); // warrior, not worker
  });

  test('returns civilian when no combat unit is present on tile', () => {
    const worker = makeUnit({ id: 1, col: 5, row: 5, type: 'worker', owner: 'faction_a' });
    setupGameState({ units: [worker] });
    const target = getBestAttackTarget(5, 5, u => u.owner !== 'player');
    expect(target.id).toBe(1);
  });

  test('ignores units at different tile', () => {
    const warrior = makeUnit({ id: 1, col: 6, row: 5, type: 'warrior', owner: 'faction_a' });
    setupGameState({ units: [warrior] });
    expect(getBestAttackTarget(5, 5, u => u.owner !== 'player')).toBeNull();
  });

  test('respects the owner predicate filter', () => {
    const playerWorker = makeUnit({ id: 1, col: 5, row: 5, type: 'worker', owner: 'player' });
    const enemyWarrior = makeUnit({ id: 2, col: 5, row: 5, type: 'warrior', owner: 'faction_a' });
    setupGameState({ units: [playerWorker, enemyWarrior] });
    const target = getBestAttackTarget(5, 5, u => u.owner !== 'player');
    expect(target.id).toBe(2); // only the enemy warrior passes the predicate
  });
});
