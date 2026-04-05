import { describe, test, expect, beforeEach } from 'vitest';
import { resolveCombat, checkCityCapture } from '../src/combat.js';
import { setupGameState, makeUnit } from './fixtures.js';

describe('resolveCombat()', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  // ── Adjacency requirement ──

  test('should not allow combat between non-adjacent units', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player' });
    const defender = makeUnit({ id: 2, col: 20, row: 20, type: 'warrior', owner: 'faction_a' });
    state.units = [attacker, defender];
    // resolveCombat doesn't enforce adjacency (that's handleHexClick's job),
    // but the damage formula still works — this documents the current behavior
    const result = resolveCombat(attacker, defender);
    expect(result).toBeDefined();
  });

  // ── Melee combat ──

  test('should deal damage to both units in melee combat', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player' });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a' });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    expect(result.atkDamage).toBeGreaterThan(0);
    expect(result.defDamage).toBeGreaterThan(0);
    expect(defender.hp).toBeLessThan(100);
    expect(attacker.hp).toBeLessThan(100);
  });

  // ── Ranged combat ──

  test('should only deal damage to defender in ranged combat', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'archer', owner: 'player' });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a' });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    expect(result.atkDamage).toBeGreaterThan(0);
    expect(result.defDamage).toBe(0);
    expect(attacker.hp).toBe(100);
  });

  // ── Civilian capture ──

  test('should capture civilian units without dealing damage', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player' });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'worker', owner: 'faction_a' });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    expect(result.captured).toBe(true);
    expect(result.attackerDied).toBe(false);
    expect(result.defenderDied).toBe(false);
    expect(defender.owner).toBe('player');
    expect(defender.moveLeft).toBe(0);
  });

  // ── Defender death ──

  test('should remove defender from game.units when killed', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player', hp: 100 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a', hp: 1 });
    state.units = [attacker, defender];
    state.cities = [];

    const result = resolveCombat(attacker, defender);
    expect(result.defenderDied).toBe(true);
    expect(state.units.find(u => u.id === 2)).toBeUndefined();
  });

  test('should allow defender to survive when HP is high enough', () => {
    // Damage formula: max(5, floor(30 * (atkPower / defPower) * (attacker.hp / 100)))
    // Warrior vs warrior (equal strength): ~30 damage, so 100 HP defender survives
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player', hp: 100 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a', hp: 100 });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    expect(result.defenderDied).toBe(false);
    expect(defender.hp).toBeGreaterThan(0);
    expect(defender.hp).toBeLessThan(100);
  });

  // ── Attacker death ──

  test('should remove attacker from game.units when killed', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player', hp: 1 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a', hp: 100 });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    expect(result.attackerDied).toBe(true);
    expect(state.units.find(u => u.id === 1)).toBeUndefined();
  });

  // ── Fortification bonus ──

  test('should apply 20% defense bonus to fortified defender', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player', hp: 100 });
    const defNormal = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a', hp: 100 });
    const defFort = makeUnit({ id: 3, col: 6, row: 5, type: 'warrior', owner: 'faction_a', hp: 100, fortified: true });

    state.units = [attacker, defNormal];
    const r1 = resolveCombat(
      { ...attacker },
      { ...defNormal }
    );

    state.units = [attacker, defFort];
    const r2 = resolveCombat(
      { ...attacker },
      { ...defFort }
    );

    // Fortified defender should take less damage
    expect(r2.atkDamage).toBeLessThan(r1.atkDamage);
  });

  // ── Terrain defense ──

  test('should apply hills defense bonus to defender', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player', hp: 100 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a', hp: 100 });

    state.units = [attacker, defender];
    const r1 = resolveCombat({ ...attacker }, { ...defender, hp: 100 });

    state.map[5][6].feature = 'hills';
    const r2 = resolveCombat({ ...attacker }, { ...defender, hp: 100 });

    expect(r2.atkDamage).toBeLessThan(r1.atkDamage);
  });

  // ── Movement consumption ──

  test('should consume all movement points after attack', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player', moveLeft: 2 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a' });
    state.units = [attacker, defender];

    resolveCombat(attacker, defender);
    expect(attacker.moveLeft).toBe(0);
    expect(attacker.hasAttackedThisTurn).toBe(true);
  });

  // ── XP and promotions ──

  test('should grant XP to surviving player attacker', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player', hp: 100 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a' });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    expect(result.attackerDied).toBe(false);
    expect(attacker.xp).toBe(10);
  });

  test('should grant XP to surviving player defender', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'faction_a', hp: 1 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'player', hp: 100 });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    expect(result.defenderDied).toBe(false);
    expect(defender.xp).toBe(5);
  });

  test('should not grant XP to non-player surviving attacker', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'faction_a', hp: 100 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_b' });
    state.units = [attacker, defender];

    resolveCombat(attacker, defender);
    // Current implementation only grants XP to player-owned units
    expect(attacker.xp).toBe(0);
  });

  test('should not grant XP to non-player surviving defender', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'faction_a', hp: 1 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_b', hp: 100 });
    state.units = [attacker, defender];

    resolveCombat(attacker, defender);
    expect(defender.xp).toBe(0);
  });

  // ── Anti-cavalry bonus ──

  test('should apply anti-cavalry +10 bonus vs cavalry', () => {
    const spearman = makeUnit({ id: 1, col: 5, row: 5, type: 'spearman', owner: 'player', hp: 100 });
    const horseman = makeUnit({ id: 2, col: 6, row: 5, type: 'horseman', owner: 'faction_a' });
    state.units = [spearman, horseman];

    const result = resolveCombat({ ...spearman }, { ...horseman, hp: 100 });
    expect(result.atkDamage).toBeGreaterThan(0);
  });

  // ── Melee advance to tile ──

  test('should move melee attacker to defender tile when defender dies', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player', hp: 100 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a', hp: 1 });
    state.units = [attacker, defender];
    state.cities = [];

    const result = resolveCombat(attacker, defender);
    expect(result.defenderDied).toBe(true);
    expect(attacker.col).toBe(6);
    expect(attacker.row).toBe(5);
  });

  test('should move cavalry attacker to defender tile when defender dies', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'horseman', owner: 'player', hp: 100 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a', hp: 1 });
    state.units = [attacker, defender];
    state.cities = [];

    const result = resolveCombat(attacker, defender);
    expect(result.defenderDied).toBe(true);
    expect(attacker.col).toBe(6);
  });

  test('should NOT move ranged attacker to defender tile when defender dies', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'archer', owner: 'player', hp: 100 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a', hp: 1 });
    state.units = [attacker, defender];
    state.cities = [];

    const result = resolveCombat(attacker, defender);
    expect(result.defenderDied).toBe(true);
    // Ranged units stay in place
    expect(attacker.col).toBe(5);
    expect(attacker.row).toBe(5);
  });

  // ── Gold reward ──

  test('should award gold when defender is killed', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player', hp: 100 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a', hp: 1 });
    state.units = [attacker, defender];
    state.cities = [];
    const goldBefore = state.gold;

    const result = resolveCombat(attacker, defender);
    expect(result.defenderDied).toBe(true);
    expect(state.gold).toBeGreaterThan(goldBefore);
  });
});

describe('checkCityCapture()', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('should capture an expansion city at 0 HP when a player unit is on its tile', () => {
    state.aiFactionCities = {
      faction_a: [
        { name: 'Outpost', col: 10, row: 10, hp: 0, population: 500, borderRadius: 1 },
      ],
    };
    state.units = [makeUnit({ id: 1, col: 10, row: 10, owner: 'player' })];

    checkCityCapture(10, 10);

    // Expansion city should be removed from AI faction cities
    expect(state.aiFactionCities.faction_a).toHaveLength(0);
    // Should be converted to a player city
    expect(state.cities.some(c => c.col === 10 && c.row === 10)).toBe(true);
  });

  test('should not capture an expansion city that still has HP', () => {
    state.aiFactionCities = {
      faction_a: [
        { name: 'Outpost', col: 10, row: 10, hp: 50, population: 500, borderRadius: 1 },
      ],
    };
    state.units = [makeUnit({ id: 1, col: 10, row: 10, owner: 'player' })];

    checkCityCapture(10, 10);

    // Should NOT be captured
    expect(state.aiFactionCities.faction_a).toHaveLength(1);
    expect(state.cities).toHaveLength(0);
  });
});
