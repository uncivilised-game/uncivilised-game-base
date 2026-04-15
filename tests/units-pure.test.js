import { describe, test, expect, beforeEach } from 'vitest';
import { createUnit, getTileOwner, isTerritoryBlocked, computeAttackRange } from '../src/units.js';
import { canFoundCityAt } from '../src/improvements.js';
import { ejectTrespassingUnits } from '../src/turn.js';
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
    expect(unit.buildCharges).toBe(3);
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

describe('computeAttackRange() one-attack-per-turn', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('should not allow ranged unit to attack after already attacking this turn', () => {
    const archer = makeUnit({ id: 1, col: 5, row: 5, owner: 'player', type: 'archer', moveLeft: 2, hasAttackedThisTurn: true });
    state.units = [archer, makeUnit({ id: 2, col: 6, row: 5, owner: 'faction_a', type: 'warrior' })];
    state.selectedUnitId = 1;
    const range = computeAttackRange();
    expect(range).toBeNull();
  });

  test('should allow ranged unit to attack if it has not attacked this turn', () => {
    const archer = makeUnit({ id: 1, col: 5, row: 5, owner: 'player', type: 'archer', moveLeft: 2, hasAttackedThisTurn: false });
    state.units = [archer, makeUnit({ id: 2, col: 6, row: 5, owner: 'faction_a', type: 'warrior' })];
    state.selectedUnitId = 1;
    const range = computeAttackRange();
    expect(range).not.toBeNull();
    expect(range.size).toBeGreaterThan(0);
  });

  test('should not allow melee unit to attack after already attacking this turn', () => {
    const warrior = makeUnit({ id: 1, col: 5, row: 5, owner: 'player', type: 'warrior', moveLeft: 2, hasAttackedThisTurn: true });
    state.units = [warrior, makeUnit({ id: 2, col: 6, row: 5, owner: 'faction_a', type: 'warrior' })];
    state.selectedUnitId = 1;
    const range = computeAttackRange();
    expect(range).toBeNull();
  });

  test('should allow melee unit to attack adjacent faction city with 0 move points remaining', () => {
    const warrior = makeUnit({ id: 1, col: 5, row: 5, owner: 'player', type: 'warrior', moveLeft: 0, hasAttackedThisTurn: false });
    state.units = [warrior];
    state.selectedUnitId = 1;
    state.factionCities = { faction_a: { name: 'Rome', col: 6, row: 5, hp: 100, borderRadius: 2 } };
    const range = computeAttackRange();
    expect(range).not.toBeNull();
    expect(range.get('6,5')).toBe('city_faction_a');
  });

  test('should not allow melee unit to attack adjacent faction city when already attacked this turn', () => {
    const warrior = makeUnit({ id: 1, col: 5, row: 5, owner: 'player', type: 'warrior', moveLeft: 0, hasAttackedThisTurn: true });
    state.units = [warrior];
    state.selectedUnitId = 1;
    state.factionCities = { faction_a: { name: 'Rome', col: 6, row: 5, hp: 100, borderRadius: 2 } };
    const range = computeAttackRange();
    expect(range).toBeNull();
  });
});

describe('canFoundCityAt()', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('should not allow founding a city in enemy territory', () => {
    state.factionCities = {
      faction_a: { name: 'Capital', col: 10, row: 10, hp: 100, borderRadius: 2 },
    };
    // Tile at (10,10) is in faction_a's territory
    expect(canFoundCityAt(10, 10)).toBe(false);
  });

  test('should allow founding a city on unclaimed land far from other cities', () => {
    state.factionCities = {};
    state.cities = [];
    // Tile at (30,20) is unclaimed and far from everything
    expect(canFoundCityAt(30, 20)).toBe(true);
  });
});

describe('ejectTrespassingUnits()', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('should eject AI unit from player territory when borders are closed', () => {
    state.cities = [{ name: 'Home', col: 10, row: 10, borderRadius: 2 }];
    // AI unit inside player territory, no open borders, no war
    const aiUnit = makeUnit({ id: 1, col: 10, row: 10, owner: 'faction_a' });
    state.units = [aiUnit];

    ejectTrespassingUnits('faction_a');

    // Unit should have been moved outside player territory
    expect(isTerritoryBlocked(aiUnit, aiUnit.col, aiUnit.row)).toBe(false);
  });

  test('should eject player unit from AI territory when borders are closed', () => {
    state.factionCities = {
      faction_a: { name: 'Capital', col: 10, row: 10, hp: 100, borderRadius: 2 },
    };
    const playerUnit = makeUnit({ id: 1, col: 10, row: 10, owner: 'player' });
    state.units = [playerUnit];

    ejectTrespassingUnits('faction_a');

    expect(isTerritoryBlocked(playerUnit, playerUnit.col, playerUnit.row)).toBe(false);
  });

  test('should not eject units that have open borders', () => {
    state.factionCities = {
      faction_a: { name: 'Capital', col: 10, row: 10, hp: 100, borderRadius: 2 },
    };
    state.openBorders = { faction_a: { startTurn: 1, duration: 20 } };
    const playerUnit = makeUnit({ id: 1, col: 10, row: 10, owner: 'player' });
    state.units = [playerUnit];

    ejectTrespassingUnits('faction_a');

    // Should stay — open borders allow it
    expect(playerUnit.col).toBe(10);
    expect(playerUnit.row).toBe(10);
  });
});
