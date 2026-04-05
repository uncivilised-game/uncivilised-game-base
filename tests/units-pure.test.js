import { describe, test, expect, beforeEach } from 'vitest';
import { createUnit, applyPromotion } from '../src/units.js';
import { UNIT_TYPES } from '../src/constants.js';
import { setupGameState } from './fixtures.js';

describe('createUnit()', () => {
  test('should create a warrior with correct defaults', () => {
    const unit = createUnit('warrior', 10, 15, 'player');
    expect(unit.type).toBe('warrior');
    expect(unit.col).toBe(10);
    expect(unit.row).toBe(15);
    expect(unit.owner).toBe('player');
    expect(unit.hp).toBe(100);
    expect(unit.moveLeft).toBe(UNIT_TYPES.warrior.movePoints);
    expect(unit.movePoints).toBe(UNIT_TYPES.warrior.movePoints);
    expect(unit.combat).toBe(UNIT_TYPES.warrior.combat);
    expect(unit.fortified).toBe(false);
    expect(unit.sleeping).toBe(false);
    expect(unit.xp).toBe(0);
    expect(unit.promotions).toEqual([]);
    expect(unit.pendingPromotion).toBe(false);
  });

  test('should create a scout with 3 move points', () => {
    const unit = createUnit('scout', 0, 0, 'player');
    expect(unit.moveLeft).toBe(3);
    expect(unit.combat).toBe(UNIT_TYPES.scout.combat);
  });

  test('should create a worker with build charges', () => {
    const unit = createUnit('worker', 5, 5, 'player');
    expect(unit.buildCharges).toBe(2);
  });

  test('should not add buildCharges to non-civilian units', () => {
    const unit = createUnit('warrior', 5, 5, 'player');
    expect(unit.buildCharges).toBeUndefined();
  });

  test('should assign unique IDs to successive units', () => {
    const u1 = createUnit('warrior', 0, 0, 'player');
    const u2 = createUnit('archer', 1, 1, 'player');
    expect(u1.id).not.toBe(u2.id);
  });

  test('should assign correct owner for non-player factions', () => {
    const unit = createUnit('warrior', 5, 5, 'some_faction');
    expect(unit.owner).toBe('some_faction');
  });

  test('should create ranged units with correct combat stats', () => {
    const archer = createUnit('archer', 0, 0, 'player');
    expect(archer.combat).toBe(UNIT_TYPES.archer.combat);
    expect(archer.moveLeft).toBe(UNIT_TYPES.archer.movePoints);
  });
});

describe('applyPromotion()', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('permanently increases unit movePoints when promotion has moveBonus', () => {
    const unit = createUnit('horseman', 5, 5, 'player');
    unit.pendingPromotion = true;
    state.units = [unit];
    const baseMovePoints = unit.movePoints;

    applyPromotion(unit.id, 'pursuit'); // pursuit: moveBonus: 1

    expect(unit.movePoints).toBe(baseMovePoints + 1);
  });

  test('increases moveLeft immediately when promotion has moveBonus', () => {
    const unit = createUnit('horseman', 5, 5, 'player');
    unit.pendingPromotion = true;
    unit.moveLeft = 1; // partially spent
    state.units = [unit];

    applyPromotion(unit.id, 'pursuit');

    expect(unit.moveLeft).toBe(2); // 1 + 1 bonus, capped at new movePoints
  });

  test('does not change movePoints for promotions without moveBonus', () => {
    const unit = createUnit('warrior', 5, 5, 'player');
    unit.pendingPromotion = true;
    state.units = [unit];
    const baseMovePoints = unit.movePoints;

    applyPromotion(unit.id, 'elite'); // elite: combatBonus: 5, no moveBonus

    expect(unit.movePoints).toBe(baseMovePoints);
  });

  test('clears pendingPromotion flag after applying', () => {
    const unit = createUnit('warrior', 5, 5, 'player');
    unit.pendingPromotion = true;
    state.units = [unit];

    applyPromotion(unit.id, 'battlecry');

    expect(unit.pendingPromotion).toBe(false);
    expect(unit.promotions).toContain('battlecry');
  });
});
