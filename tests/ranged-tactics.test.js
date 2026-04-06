import { describe, test, expect, beforeEach } from 'vitest';
import { applyTacticModifier, resolveCombat } from '../src/combat.js';
import { setupGameState, makeUnit } from './fixtures.js';

describe('applyTacticModifier() ranged tactics', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  const rangedAttacker = () => makeUnit({ id: 1, type: 'archer', owner: 'player' });
  const meleeDefender = () => makeUnit({ id: 2, type: 'warrior', owner: 'faction_a', col: 7, row: 5 });

  test('volley should give +25% attack modifier', () => {
    const result = applyTacticModifier('volley', 0, 0, rangedAttacker(), meleeDefender());
    expect(result.atkMod).toBe(1.25);
    expect(result.defMod).toBe(1.0);
    expect(result.retreat).toBe(false);
  });

  test('precision_shot should give either +35% or normal damage', () => {
    const results = new Set();
    for (let i = 0; i < 100; i++) {
      const r = applyTacticModifier('precision_shot', 0, 0, rangedAttacker(), meleeDefender());
      results.add(r.atkMod);
      expect(r.defMod).toBe(1.0);
      expect(r.retreat).toBe(false);
    }
    // Should have seen both outcomes over 100 trials
    expect(results.has(1.35)).toBe(true);
    expect(results.has(1.0)).toBe(true);
  });

  test('suppressive_fire should give +10% attack modifier', () => {
    const result = applyTacticModifier('suppressive_fire', 0, 0, rangedAttacker(), meleeDefender());
    expect(result.atkMod).toBe(1.1);
    expect(result.defMod).toBe(1.0);
    expect(result.retreat).toBe(false);
  });

  test('fire_and_withdraw should give -15% damage and noMoveCost', () => {
    const result = applyTacticModifier('fire_and_withdraw', 0, 0, rangedAttacker(), meleeDefender());
    expect(result.atkMod).toBe(0.85);
    expect(result.defMod).toBe(1.0);
    expect(result.noMoveCost).toBe(true);
    expect(result.retreat).toBe(false);
  });

  test('retreat should still work for ranged units', () => {
    const result = applyTacticModifier('retreat', 0, 0, rangedAttacker(), meleeDefender());
    expect(result.retreat).toBe(true);
  });

  // Melee tactics should still work for melee units
  test('charge should still work for melee units', () => {
    const attacker = makeUnit({ id: 1, type: 'warrior', owner: 'player' });
    const result = applyTacticModifier('charge', 0, 0, attacker, meleeDefender());
    expect(result.atkMod).toBe(1.2);
    expect(result.defMod).toBe(1.1);
  });
});

describe('resolveCombat() with ranged tactic modifiers', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('fire_and_withdraw should not consume movement points', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'archer', owner: 'player', moveLeft: 2 });
    const defender = makeUnit({ id: 2, col: 7, row: 5, type: 'warrior', owner: 'faction_a' });
    state.units = [attacker, defender];

    attacker._tacticAtkMod = 0.85;
    attacker._tacticDefMod = 1.0;
    attacker._tacticNoMoveCost = true;

    resolveCombat(attacker, defender);

    // Should still have full movement
    expect(attacker.moveLeft).toBe(2);
  });

  test('volley tactic should consume 1 movement point for ranged unit', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'archer', owner: 'player', moveLeft: 2 });
    const defender = makeUnit({ id: 2, col: 7, row: 5, type: 'warrior', owner: 'faction_a' });
    state.units = [attacker, defender];

    attacker._tacticAtkMod = 1.25;
    attacker._tacticDefMod = 1.0;

    resolveCombat(attacker, defender);

    // Normal ranged attack costs 1 move
    expect(attacker.moveLeft).toBe(1);
  });

  test('slinger should use ranged tactics (no return damage)', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'slinger', owner: 'player' });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a' });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    expect(result.defDamage).toBe(0);
    expect(attacker.hp).toBe(100);
  });

  test('ballista should use ranged tactics (no return damage)', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'ballista', owner: 'player' });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'faction_a' });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    expect(result.defDamage).toBe(0);
    expect(attacker.hp).toBe(100);
  });
});
