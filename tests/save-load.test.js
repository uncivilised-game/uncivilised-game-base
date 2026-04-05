import { describe, test, expect } from 'vitest';
import { migrateTiles } from '../src/save-load.js';

describe('migrateTiles()', () => {
  test('adds missing top-level state fields', () => {
    const state = { turn: 5 };
    migrateTiles(state);

    expect(state.tradeRoutes).toEqual([]);
    expect(state.maxTradeRoutes).toBe(1);
    expect(state.happiness).toBe(5);
    expect(state.civics).toEqual([]);
    expect(state.currentCivic).toBeNull();
    expect(state.civicProgress).toBe(0);
    expect(state.culturePerTurn).toBe(1);
    expect(state.government).toBe('chiefdom');
    expect(state.governmentCooldown).toBe(0);
    expect(state.wonders).toEqual([]);
    expect(state.currentWonderBuild).toBeNull();
    expect(state.wonderBuildProgress).toBe(0);
    expect(state.currentUnitBuild).toBeNull();
    expect(state.unitBuildProgress).toBe(0);
    expect(state.pantheon).toBeNull();
    expect(state.religion).toBeNull();
  });

  test('adds missing great people fields', () => {
    const state = {};
    migrateTiles(state);

    expect(state.greatPeopleProgress).toEqual({
      science: 0, production: 0, gold: 0, military: 0, culture: 0,
    });
    expect(state.greatPeopleEarned).toEqual([]);
  });

  test('migrates unit fields', () => {
    const state = {
      units: [
        { type: 'warrior', col: 5, row: 5, owner: 'player', hp: 100 },
        { type: 'worker', col: 6, row: 6, owner: 'player', hp: 100 },
      ],
    };
    migrateTiles(state);

    // Warrior
    expect(state.units[0].xp).toBe(0);
    expect(state.units[0].promotions).toEqual([]);
    expect(state.units[0].pendingPromotion).toBe(false);
    expect(state.units[0].hasAttackedThisTurn).toBe(false);
    expect(state.units[0].buildCharges).toBeUndefined(); // not a worker

    // Worker gets buildCharges
    expect(state.units[1].buildCharges).toBe(2);
  });

  test('does not overwrite existing unit fields', () => {
    const state = {
      units: [
        { type: 'warrior', xp: 30, promotions: ['shield_wall'], pendingPromotion: true },
      ],
    };
    migrateTiles(state);

    expect(state.units[0].xp).toBe(30);
    expect(state.units[0].promotions).toEqual(['shield_wall']);
    expect(state.units[0].pendingPromotion).toBe(true);
  });

  test('backfills movePoints from unit type for units without it', () => {
    const state = {
      units: [
        { type: 'warrior', promotions: [] },
        { type: 'scout', promotions: [] },
      ],
    };
    migrateTiles(state);

    expect(state.units[0].movePoints).toBe(2); // warrior base
    expect(state.units[1].movePoints).toBe(3); // scout base
  });

  test('backfills movePoints including move-bonus promotions', () => {
    const state = {
      units: [
        { type: 'horseman', promotions: ['pursuit'] }, // pursuit: moveBonus 1
      ],
    };
    migrateTiles(state);

    expect(state.units[0].movePoints).toBe(4); // horseman(3) + pursuit(1)
  });

  test('does not overwrite existing movePoints', () => {
    const state = {
      units: [
        { type: 'warrior', promotions: [], movePoints: 5 },
      ],
    };
    migrateTiles(state);

    expect(state.units[0].movePoints).toBe(5);
  });

  test('migrates faction city fields', () => {
    const state = {
      factionCities: {
        faction_a: { col: 10, row: 10, name: 'Nordhaven' },
        faction_b: { col: 20, row: 20, name: 'Ashland', hp: 80 },
      },
    };
    migrateTiles(state);

    const ev = state.factionCities.faction_a;
    expect(ev.hp).toBe(100);
    expect(ev.population).toBe(1000);
    expect(ev.borderRadius).toBe(2);
    expect(ev.improvements).toBe(0);
    expect(ev.wallHP).toBe(0);
    expect(ev.wallMaxHP).toBe(0);
    expect(ev.wallLastAttackedTurn).toBe(-99);

    // Existing fields preserved
    expect(state.factionCities.faction_b.hp).toBe(80);
  });

  test('migrates player city fields with wall detection', () => {
    const state = {
      cities: [
        { name: 'Capital', col: 5, row: 5, buildings: ['walls'] },
        { name: 'Town', col: 15, row: 15, buildings: [] },
      ],
    };
    migrateTiles(state);

    // City with walls gets wall HP
    expect(state.cities[0].wallHP).toBe(50); // WALL_HP.ancient_walls
    expect(state.cities[0].wallMaxHP).toBe(50);

    // City without walls gets 0
    expect(state.cities[1].wallHP).toBe(0);
    expect(state.cities[1].wallMaxHP).toBe(0);

    // Both get amenity fields
    expect(state.cities[0].amenityStatus).toBe('CONTENT');
    expect(state.cities[1].amenityBalance).toBe(0);
    expect(state.cities[1].food).toBe(0);
  });

  test('adds map tile coordinates if missing', () => {
    const state = {
      map: [
        [{ base: 'grassland' }, { base: 'plains' }],
        [{ base: 'desert' }, { base: 'ocean' }],
      ],
    };
    migrateTiles(state);

    expect(state.map[0][0].col).toBe(0);
    expect(state.map[0][0].row).toBe(0);
    expect(state.map[0][1].col).toBe(1);
    expect(state.map[0][1].row).toBe(0);
    expect(state.map[1][0].col).toBe(0);
    expect(state.map[1][0].row).toBe(1);
    expect(state.map[1][1].naturalWonder).toBeNull();
  });

  test('adds diplomacy and AI state fields', () => {
    const state = {};
    migrateTiles(state);

    expect(state.aiFactions).toEqual({});
    expect(state.aiFactionCities).toEqual({});
    expect(state.barbarianCamps).toEqual([]);
    expect(state.aiWars).toEqual([]);
    expect(state.aiAlliances).toEqual([]);
    expect(state.aiRelations).toEqual({});
    expect(state.builtWonders).toEqual({});
    expect(state.aiWonderProgress).toEqual({});
    expect(state.openBorders).toEqual({});
    expect(state.embargoes).toEqual({});
    expect(state.ceasefires).toEqual({});
    expect(state.vassals).toEqual({});
    expect(state.nonAggressionPacts).toEqual({});
    expect(state.metFactions).toEqual({});
    expect(state.factionStats).toEqual({});
    expect(state.relationships).toEqual({});
  });

  test('adds event and mod fields', () => {
    const state = {};
    migrateTiles(state);

    expect(state.appliedMods).toEqual([]);
    expect(state.combatBonuses).toEqual([]);
    expect(state.yieldBonuses).toEqual([]);
    expect(state.activeEvents).toEqual([]);
    expect(state.minorFactions).toEqual([]);
    expect(state.gameLog).toEqual([]);
    expect(state.aiCommitments).toEqual([]);
    expect(state.tribalVillages).toEqual([]);
  });

  test('rebuilds revealedResources from techs if missing', () => {
    const state = {
      techs: ['bronze_working', 'mining'],
    };
    migrateTiles(state);

    // bronze_working reveals iron, mining reveals copper
    expect(state.revealedResources).toContain('iron');
    expect(state.revealedResources).toContain('copper');
  });

  test('preserves existing revealedResources', () => {
    const state = {
      techs: ['bronze_working'],
      revealedResources: ['horses'],
    };
    migrateTiles(state);

    expect(state.revealedResources).toEqual(['horses']);
  });

  test('creates faction stats for met factions that lack them', () => {
    const state = {
      turn: 10,
      metFactions: { faction_a: true, faction_b: true },
      factionStats: {},
    };
    migrateTiles(state);

    expect(state.factionStats.faction_a).toBeDefined();
    expect(state.factionStats.faction_a.gold).toBeDefined();
    expect(state.factionStats.faction_b).toBeDefined();
  });

  test('adds envoy and v5 diplomacy fields', () => {
    const state = {};
    migrateTiles(state);

    expect(state.envoys).toBe(1);
    expect(state.maxEnvoys).toBe(1);
    expect(state.envoySpentThisTurn).toEqual({});
    expect(state.messagesThisTurn).toBe(0);
  });

  test('adds reputation system', () => {
    const state = {};
    migrateTiles(state);

    expect(state.reputation).toBeDefined();
    // Should have entries for each faction
    expect(Object.keys(state.reputation).length).toBeGreaterThan(0);
    const first = Object.values(state.reputation)[0];
    expect(first).toHaveProperty('honour', 0);
    expect(first).toHaveProperty('generosity', 0);
    expect(first).toHaveProperty('menace', 0);
    expect(first).toHaveProperty('reliability', 0);
    expect(first).toHaveProperty('cunning', 0);
  });

  test('is idempotent (running twice does not change state)', () => {
    const state = {
      units: [{ type: 'warrior' }],
      cities: [{ name: 'City', buildings: [] }],
      factionCities: { faction_a: { col: 0, row: 0 } },
      map: [[{ base: 'grassland' }]],
      metFactions: {},
      turn: 1,
    };
    migrateTiles(state);
    const snapshot = JSON.parse(JSON.stringify(state));
    migrateTiles(state);
    expect(state).toEqual(snapshot);
  });
});
