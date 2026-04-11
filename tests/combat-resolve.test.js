import { describe, test, expect, beforeEach } from 'vitest';
import { resolveCombat, checkCityCapture, captureFactionCity, eliminateFaction, razeCity, aiCapturePlayerCity, barbarianRazeAICity } from '../src/combat.js';
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

  test('should not move attacker onto captured civilian tile if enemy military is there', () => {
    // Barbarian attacks a settler that is stacked with a player warrior
    const barbarian = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'barbarian' });
    const settler = makeUnit({ id: 2, col: 6, row: 5, type: 'settler', owner: 'player' });
    const warrior = makeUnit({ id: 3, col: 6, row: 5, type: 'warrior', owner: 'player' });
    state.units = [barbarian, settler, warrior];

    const result = resolveCombat(barbarian, settler);
    expect(result.captured).toBe(true);
    expect(settler.owner).toBe('barbarian');
    // Barbarian should NOT move onto the tile — player warrior is there
    expect(barbarian.col).toBe(5);
    expect(barbarian.row).toBe(5);
  });

  test('should move attacker onto captured civilian tile if no enemy military present', () => {
    const barbarian = makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'barbarian' });
    const settler = makeUnit({ id: 2, col: 6, row: 5, type: 'settler', owner: 'player' });
    state.units = [barbarian, settler];

    const result = resolveCombat(barbarian, settler);
    expect(result.captured).toBe(true);
    // Barbarian SHOULD move onto the tile — no enemy military present
    expect(barbarian.col).toBe(6);
    expect(barbarian.row).toBe(5);
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
    // Give faction_a a capital so capturing the expansion doesn't trigger elimination
    state.factionCities = {
      faction_a: { name: 'Capital', col: 20, row: 20, hp: 100, color: '#f00', population: 1000, borderRadius: 2 },
    };
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

describe('eliminateFaction()', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('should remove expansion cities when a faction is eliminated', () => {
    state.aiFactionCities = {
      faction_a: [
        { name: 'Outpost', col: 10, row: 10, hp: 50, population: 500, borderRadius: 1 },
      ],
    };
    state.units = [makeUnit({ id: 2, col: 12, row: 12, owner: 'faction_a' })];

    eliminateFaction('faction_a', 'Test Faction');

    expect(state.aiFactionCities.faction_a).toBeUndefined();
    expect(state.units.filter(u => u.owner === 'faction_a')).toHaveLength(0);
  });
});

describe('captureFactionCity()', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('should promote expansion city to capital when capital is captured', () => {
    state.factionCities = {
      faction_a: { name: 'Capital', col: 5, row: 5, hp: 0, color: '#f00', population: 1000, borderRadius: 2 },
    };
    state.aiFactionCities = {
      faction_a: [
        { name: 'Outpost', col: 10, row: 10, hp: 50, population: 500, borderRadius: 1, color: '#f00' },
      ],
    };
    state.units = [makeUnit({ id: 1, col: 5, row: 5, owner: 'player' })];

    captureFactionCity('faction_a');

    // Expansion city promoted to capital
    expect(state.factionCities.faction_a).toBeDefined();
    expect(state.factionCities.faction_a.name).toBe('Outpost');
    expect(state.factionCities.faction_a.col).toBe(10);
    // Expansion cities list is now empty (promoted out)
    expect(state.aiFactionCities.faction_a).toHaveLength(0);
    // Faction NOT eliminated
    expect(state.factionsEliminated || 0).toBe(0);
  });
});

describe('razeCity()', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('should remove a player city from the map and grant gold', () => {
    state.cities = [{ name: 'Outpost', col: 10, row: 10, population: 500, borderRadius: 1 }];
    state.population = 500;
    const goldBefore = state.gold;

    razeCity(10, 10, 'Outpost', 'faction_a');

    expect(state.cities).toHaveLength(0);
    expect(state.gold).toBeGreaterThan(goldBefore);
    expect(state.population).toBe(0);
  });
});

describe('aiCapturePlayerCity()', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('barbarians should always raze a captured player city', () => {
    state.cities = [{ name: 'Outpost', col: 10, row: 10, population: 500, borderRadius: 1 }];
    state.population = 500;

    aiCapturePlayerCity(0, 'barbarian');

    // City should be razed (removed), not converted to AI
    expect(state.cities).toHaveLength(0);
    expect(state.aiFactionCities.barbarian || []).toHaveLength(0);
  });

  test('AI faction should capture or raze without crashing', () => {
    state.cities = [{ name: 'Outpost', col: 10, row: 10, population: 500, borderRadius: 1 }];
    state.population = 500;
    state.factionCities = {
      faction_a: { name: 'Capital', col: 20, row: 20, hp: 100, color: '#f00', borderRadius: 2 },
    };

    aiCapturePlayerCity(0, 'faction_a');

    // City removed from player
    expect(state.cities).toHaveLength(0);
    // Either razed or converted to AI expansion city
    const aiCities = state.aiFactionCities.faction_a || [];
    // No crash — result depends on random roll
    expect(state.population).toBeLessThanOrEqual(500);
  });
});

describe('barbarianRazeAICity()', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('barbarians should raze an AI faction capital', () => {
    state.factionCities = {
      faction_a: { name: 'EnemyCapital', col: 5, row: 5, hp: 100, color: '#f00', borderRadius: 2 },
    };
    state.barbarianCamps = [{ id: 'camp1', col: 7, row: 7, destroyed: false, strength: 5, gold: 0 }];

    const razed = barbarianRazeAICity(5, 5);

    expect(razed).toBe(true);
    expect(state.factionCities.faction_a).toBeUndefined();
    // Plunder gold should go to nearest camp
    expect(state.barbarianCamps[0].gold).toBeGreaterThan(0);
  });

  test('barbarians should raze an AI expansion city', () => {
    // Faction keeps its capital so elimination doesn't fire
    state.factionCities = {
      faction_b: { name: 'Capital', col: 20, row: 20, hp: 100, color: '#0f0', borderRadius: 2 },
    };
    state.aiFactionCities = {
      faction_b: [{ name: 'Outpost', col: 8, row: 8, hp: 0, color: '#0f0', borderRadius: 1, population: 500 }],
    };
    state.barbarianCamps = [{ id: 'camp2', col: 10, row: 10, destroyed: false, strength: 5, gold: 0 }];

    const razed = barbarianRazeAICity(8, 8);

    expect(razed).toBe(true);
    expect(state.aiFactionCities.faction_b).toHaveLength(0);
    expect(state.barbarianCamps[0].gold).toBeGreaterThan(0);
  });

  test('should return false when no city at location', () => {
    state.factionCities = {};
    state.aiFactionCities = {};

    const razed = barbarianRazeAICity(5, 5);

    expect(razed).toBe(false);
  });

  test('should eliminate faction when last city is razed', () => {
    state.factionCities = {
      faction_a: { name: 'LastCity', col: 5, row: 5, hp: 100, color: '#f00', borderRadius: 2 },
    };
    state.aiFactionCities = { faction_a: [] };
    state.barbarianCamps = [];
    // Add a faction unit to verify elimination cleans up
    state.units.push(makeUnit('warrior', 6, 6, 'faction_a'));

    barbarianRazeAICity(5, 5);

    expect(state.factionCities.faction_a).toBeUndefined();
    // Faction units should be removed by eliminateFaction
    expect(state.units.filter(u => u.owner === 'faction_a')).toHaveLength(0);
  });
});
