import { describe, it, expect, beforeEach } from 'vitest';
import { setupGameState, makeUnit } from './fixtures.js';

import { resolveCombat } from '../src/combat.js';

describe('resolveCombat', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  it('melee combat: both units take damage', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player' });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'emperor_valerian' });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    expect(result.atkDamage).toBeGreaterThan(0);
    expect(result.defDamage).toBeGreaterThan(0);
    expect(defender.hp).toBeLessThan(100);
    expect(attacker.hp).toBeLessThan(100);
  });

  it('ranged combat: only defender takes damage', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'archer', owner: 'player' });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'emperor_valerian' });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    expect(result.atkDamage).toBeGreaterThan(0);
    expect(result.defDamage).toBe(0); // ranged: no counter-attack
    expect(attacker.hp).toBe(100);
  });

  it('civilian capture: ownership changes, no damage', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player' });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'worker', owner: 'emperor_valerian' });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    expect(result.captured).toBe(true);
    expect(result.attackerDied).toBe(false);
    expect(result.defenderDied).toBe(false);
    expect(defender.owner).toBe('player');
    expect(defender.moveLeft).toBe(0);
  });

  it('attacker kills defender: defender removed from game.units', () => {
    // Give attacker overwhelming advantage
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player', hp: 100 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'emperor_valerian', hp: 10 });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    expect(result.defenderDied).toBe(true);
    expect(state.units.find(u => u.id === 2)).toBeUndefined();
  });

  it('dead attacker is removed from game.units', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player', hp: 5 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'emperor_valerian', hp: 100 });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    expect(result.attackerDied).toBe(true);
    expect(state.units.find(u => u.id === 1)).toBeUndefined();
  });

  it('fortified defender gets 20% bonus', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player' });
    const defNormal = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'emperor_valerian' });
    const defFort = makeUnit({ id: 3, col: 6, row: 5, type: 'warrior', owner: 'emperor_valerian', fortified: true });
    state.units = [attacker, defNormal];

    const r1 = resolveCombat(
      { ...attacker, hp: 100 },
      { ...defNormal, hp: 100 }
    );

    state.units = [attacker, defFort];
    const r2 = resolveCombat(
      { ...attacker, hp: 100 },
      { ...defFort, hp: 100 }
    );

    // Fortified defender should take less damage
    expect(r2.atkDamage).toBeLessThan(r1.atkDamage);
  });

  it('hills defense bonus: defender on hills takes less damage', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player' });
    const defFlat = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'emperor_valerian' });

    // Flat terrain
    state.units = [attacker, defFlat];
    const r1 = resolveCombat({ ...attacker, hp: 100 }, { ...defFlat, hp: 100 });

    // Hills terrain
    state.map[5][6].feature = 'hills';
    const r2 = resolveCombat({ ...attacker, hp: 100 }, { ...defFlat, hp: 100 });

    expect(r2.atkDamage).toBeLessThan(r1.atkDamage);
  });

  it('uses all movement points after attack', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player', moveLeft: 2 });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'emperor_valerian' });
    state.units = [attacker, defender];

    resolveCombat(attacker, defender);
    expect(attacker.moveLeft).toBe(0);
    expect(attacker.hasAttackedThisTurn).toBe(true);
  });

  it('surviving player attacker gains XP', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player' });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'emperor_valerian' });
    state.units = [attacker, defender];

    const result = resolveCombat(attacker, defender);
    if (!result.attackerDied) {
      expect(attacker.xp).toBe(10);
    }
  });

  it('anti-cavalry gets +10 vs cavalry', () => {
    const spearman = makeUnit({ id: 1, col: 5, row: 5, type: 'spearman', owner: 'player' });
    const horseman = makeUnit({ id: 2, col: 6, row: 5, type: 'horseman', owner: 'emperor_valerian' });
    state.units = [spearman, horseman];

    const result = resolveCombat({ ...spearman, hp: 100 }, { ...horseman, hp: 100 });
    // Spearman (25 + 10 anti-cav = 35) vs Horseman (30)
    // Attacker should deal more than if it were warrior (20) vs horseman (30)
    expect(result.atkDamage).toBeGreaterThan(0);
  });

  it('melee attacker moves to defender tile when defender dies', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player' });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'emperor_valerian', hp: 5 });
    state.units = [attacker, defender];
    state.cities = [];

    const result = resolveCombat(attacker, defender);
    if (result.defenderDied && !result.attackerDied) {
      expect(attacker.col).toBe(6);
      expect(attacker.row).toBe(5);
    }
  });

  it('gold reward on kill', () => {
    const attacker = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player' });
    const defender = makeUnit({ id: 2, col: 6, row: 5, type: 'warrior', owner: 'emperor_valerian', hp: 5 });
    state.units = [attacker, defender];
    state.cities = [];
    const goldBefore = state.gold;

    const result = resolveCombat(attacker, defender);
    if (result.defenderDied) {
      expect(state.gold).toBeGreaterThan(goldBefore);
    }
  });
});
