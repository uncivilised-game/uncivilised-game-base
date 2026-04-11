import { describe, test, expect, beforeEach } from 'vitest';
import { attachToArmy, detachFromArmy, coordinatedAttack, getGeneralCapacity } from '../src/units.js';
import { setupGameState, makeUnit } from './fixtures.js';

describe('Great General — Army Mechanics', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  function makeGeneral(overrides = {}) {
    return makeUnit({
      id: 100, type: 'great_general', col: 5, row: 5, owner: 'player',
      combat: 0, moveLeft: 3, army: [], armyCapacity: 3, xp: 0,
      ...overrides,
    });
  }

  describe('getGeneralCapacity()', () => {
    test('base capacity is 3', () => {
      expect(getGeneralCapacity({ xp: 0 })).toBe(3);
    });

    test('capacity is 4 at 20 XP', () => {
      expect(getGeneralCapacity({ xp: 20 })).toBe(4);
    });

    test('capacity is 5 at 50 XP', () => {
      expect(getGeneralCapacity({ xp: 50 })).toBe(5);
    });

    test('uses armyCapacity if set', () => {
      expect(getGeneralCapacity({ armyCapacity: 4, xp: 0 })).toBe(4);
    });
  });

  describe('attachToArmy()', () => {
    test('should attach an adjacent military unit to the army', () => {
      const general = makeGeneral();
      const warrior = makeUnit({ id: 1, type: 'warrior', col: 5, row: 4, owner: 'player' });
      state.units = [general, warrior];

      const result = attachToArmy(100, 1);

      expect(result).toBe(true);
      expect(general.army).toHaveLength(1);
      expect(general.army[0].type).toBe('warrior');
      // Unit should be removed from map
      expect(state.units.find(u => u.id === 1)).toBeUndefined();
    });

    test('should reject when army is full', () => {
      const general = makeGeneral({
        army: [
          { id: 10, type: 'warrior', hp: 100, xp: 0, combat: 20, promotions: [] },
          { id: 11, type: 'warrior', hp: 100, xp: 0, combat: 20, promotions: [] },
          { id: 12, type: 'warrior', hp: 100, xp: 0, combat: 20, promotions: [] },
        ],
      });
      const warrior = makeUnit({ id: 2, type: 'warrior', col: 5, row: 4, owner: 'player' });
      state.units = [general, warrior];

      const result = attachToArmy(100, 2);

      expect(result).toBe(false);
      expect(general.army).toHaveLength(3);
    });

    test('should reject non-adjacent units', () => {
      const general = makeGeneral();
      const warrior = makeUnit({ id: 1, type: 'warrior', col: 10, row: 10, owner: 'player' });
      state.units = [general, warrior];

      const result = attachToArmy(100, 1);

      expect(result).toBe(false);
      expect(general.army).toHaveLength(0);
    });

    test('should reject civilian units', () => {
      const general = makeGeneral();
      const worker = makeUnit({ id: 1, type: 'worker', col: 5, row: 4, owner: 'player', combat: 0 });
      state.units = [general, worker];

      const result = attachToArmy(100, 1);

      expect(result).toBe(false);
    });
  });

  describe('detachFromArmy()', () => {
    test('should place detached unit on adjacent tile', () => {
      const general = makeGeneral({
        army: [{ id: 1, type: 'warrior', hp: 80, xp: 5, combat: 20, promotions: [], level: 1, pendingPromotion: false }],
      });
      state.units = [general];

      const result = detachFromArmy(100, 0);

      expect(result).toBe(true);
      expect(general.army).toHaveLength(0);
      const detached = state.units.find(u => u.id === 1);
      expect(detached).toBeDefined();
      expect(detached.hp).toBe(80);
      expect(detached.moveLeft).toBe(0);
    });
  });

  describe('coordinatedAttack()', () => {
    test('should deal damage from army units to an adjacent enemy', () => {
      const general = makeGeneral({
        army: [
          { id: 10, type: 'warrior', hp: 100, xp: 0, combat: 20, promotions: [], level: 1 },
          { id: 11, type: 'archer', hp: 100, xp: 0, combat: 15, promotions: [], level: 1 },
        ],
      });
      const enemy = makeUnit({ id: 50, type: 'warrior', col: 5, row: 4, owner: 'faction_a', hp: 100 });
      state.units = [general, enemy];

      const result = coordinatedAttack(100, 5, 4);

      expect(result).toBe(true);
      expect(general.moveLeft).toBe(0);
      expect(general.xp).toBeGreaterThan(0);
      // Enemy should have taken damage
      const remainingEnemy = state.units.find(u => u.id === 50);
      if (remainingEnemy) {
        expect(remainingEnemy.hp).toBeLessThan(100);
      }
    });

    test('should reject when general has no army', () => {
      const general = makeGeneral();
      const enemy = makeUnit({ id: 50, type: 'warrior', col: 5, row: 4, owner: 'faction_a' });
      state.units = [general, enemy];

      const result = coordinatedAttack(100, 5, 4);

      expect(result).toBe(false);
    });

    test('should reject non-adjacent targets', () => {
      const general = makeGeneral({
        army: [{ id: 10, type: 'warrior', hp: 100, xp: 0, combat: 20, promotions: [] }],
      });
      const enemy = makeUnit({ id: 50, type: 'warrior', col: 10, row: 10, owner: 'faction_a' });
      state.units = [general, enemy];

      const result = coordinatedAttack(100, 10, 10);

      expect(result).toBe(false);
    });
  });
});
