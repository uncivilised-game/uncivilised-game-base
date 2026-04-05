import { describe, test, expect, beforeEach } from 'vitest';
import { createUnit, getTileOwner, isTerritoryBlocked } from '../src/units.js';
import { UNIT_TYPES } from '../src/constants.js';
import { setupGameState, makeUnit } from './fixtures.js';

describe('createUnit()', () => {
  test('should create a warrior with correct defaults', () => {
    const unit = createUnit('warrior', 10, 15, 'player');
    expect(unit.type).toBe('warrior');
    expect(unit.col).toBe(10);
    expect(unit.row).toBe(15);
    expect(unit.owner).toBe('player');
    expect(unit.hp).toBe(100);
    expect(unit.moveLeft).toBe(UNIT_TYPES.warrior.movePoints);
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

describe('getTileOwner()', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('should return faction ID for tiles within faction capital border', () => {
    state.factionCities = {
      faction_a: { name: 'Capital', col: 10, row: 10, hp: 100, borderRadius: 2 },
    };
    expect(getTileOwner(10, 10)).toBe('faction_a');
    expect(getTileOwner(11, 10)).toBe('faction_a');
  });

  test('should return faction ID for tiles within expansion city border', () => {
    state.aiFactionCities = {
      faction_b: [{ name: 'Outpost', col: 20, row: 20, hp: 100, borderRadius: 1 }],
    };
    expect(getTileOwner(20, 20)).toBe('faction_b');
    expect(getTileOwner(21, 20)).toBe('faction_b');
  });

  test('should return player for tiles within player city border', () => {
    state.cities = [{ name: 'Home', col: 5, row: 5, borderRadius: 2 }];
    expect(getTileOwner(5, 5)).toBe('player');
  });

  test('should return null for unclaimed tiles', () => {
    expect(getTileOwner(30, 30)).toBeNull();
  });
});

describe('isTerritoryBlocked()', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
    state.factionCities = {
      faction_a: { name: 'Capital', col: 10, row: 10, hp: 100, borderRadius: 2 },
    };
  });

  test('should block player unit from entering faction territory at peace', () => {
    const unit = makeUnit({ id: 1, col: 8, row: 8, owner: 'player' });
    expect(isTerritoryBlocked(unit, 10, 10)).toBe(true);
  });

  test('should allow player unit into faction territory with open borders', () => {
    state.openBorders = { faction_a: { startTurn: 1, duration: 20 } };
    const unit = makeUnit({ id: 1, col: 8, row: 8, owner: 'player' });
    expect(isTerritoryBlocked(unit, 10, 10)).toBe(false);
  });

  test('should allow player unit into faction territory when at war', () => {
    state.aiWars = [{ attacker: 'player', defender: 'faction_a', startTurn: 1, turnsActive: 0 }];
    const unit = makeUnit({ id: 1, col: 8, row: 8, owner: 'player' });
    expect(isTerritoryBlocked(unit, 10, 10)).toBe(false);
  });

  test('should block AI unit from entering player territory at peace', () => {
    state.cities = [{ name: 'Home', col: 5, row: 5, borderRadius: 2 }];
    const unit = makeUnit({ id: 2, col: 3, row: 3, owner: 'faction_a' });
    expect(isTerritoryBlocked(unit, 5, 5)).toBe(true);
  });

  test('should allow AI unit into player territory with open borders', () => {
    state.cities = [{ name: 'Home', col: 5, row: 5, borderRadius: 2 }];
    state.openBorders = { faction_a: { startTurn: 1, duration: 20 } };
    const unit = makeUnit({ id: 2, col: 3, row: 3, owner: 'faction_a' });
    expect(isTerritoryBlocked(unit, 5, 5)).toBe(false);
  });

  test('should allow AI unit into player territory when at war', () => {
    state.cities = [{ name: 'Home', col: 5, row: 5, borderRadius: 2 }];
    state.aiWars = [{ attacker: 'faction_a', defender: 'player', startTurn: 1, turnsActive: 0 }];
    const unit = makeUnit({ id: 2, col: 3, row: 3, owner: 'faction_a' });
    expect(isTerritoryBlocked(unit, 5, 5)).toBe(false);
  });

  test('should not block units in their own territory', () => {
    const unit = makeUnit({ id: 2, col: 9, row: 10, owner: 'faction_a' });
    expect(isTerritoryBlocked(unit, 10, 10)).toBe(false);
  });
});
