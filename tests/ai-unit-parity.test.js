import { describe, test, expect, beforeEach, vi } from 'vitest';
import { setupGameState, makeUnit } from './fixtures.js';
import { game } from '../src/state.js';

// Mock modules that touch the DOM
vi.mock('../src/leaderboard.js', () => ({ updateUI: vi.fn(), updateEnvoyUI: vi.fn(), submitToLeaderboard: vi.fn(), showLeaderboard: vi.fn() }));
vi.mock('../src/render.js', () => ({ render: vi.fn(), markVisibilityDirty: vi.fn() }));
vi.mock('../src/discovery.js', () => ({ revealAround: vi.fn(), discoverVisibleFactions: vi.fn() }));
vi.mock('../src/feedback.js', () => ({ startAnimLoop: vi.fn() }));
vi.mock('../src/input.js', () => ({ panCameraTo: vi.fn(), clampCamera: vi.fn() }));
vi.mock('../src/ui-panels.js', () => ({ checkVictoryConditions: vi.fn(), hideSelectionPanel: vi.fn(), closeAllPanels: vi.fn() }));
vi.mock('../src/buildings.js', () => ({ showGreatPersonNotification: vi.fn(), useGreatPerson: vi.fn(), showPantheonPicker: vi.fn() }));
vi.mock('../src/embassy.js', () => ({ processEmbassyTurn: vi.fn(), onRumourRevealed: vi.fn(), ensureEmbassyState: vi.fn() }));
vi.mock('../src/reputation.js', () => ({ decayReputation: vi.fn(), detectContradictions: vi.fn(), updateReputation: vi.fn(), ensureReputationState: vi.fn() }));
vi.mock('../src/save-load.js', () => ({ autoSave: vi.fn() }));
vi.mock('../src/ai-diplomacy.js', () => ({ processAIDiplomacy: vi.fn(), resetTurnActions: vi.fn(), processAITradeIncome: vi.fn() }));

import { processAIUnitSpawning, processAIWorkerImprovements } from '../src/turn.js';

describe('processAIUnitSpawning()', () => {
  beforeEach(() => {
    setupGameState({
      factionCities: {
        faction_a: { name: 'Nordhaven', col: 10, row: 10, hp: 100, population: 1000, borderRadius: 2 },
      },
      aiFactionCities: { faction_a: [] },
      factionStats: {
        faction_a: { gold: 100, military: 10, population: 2500, territory: 10, techs: 2, score: 40, lastUpdated: 1 },
      },
      units: [],
      relationships: {},
    });
  });

  test('should spawn a worker when faction has enough gold and no workers', () => {
    processAIUnitSpawning();
    const workers = game.units.filter(u => u.owner === 'faction_a' && u.type === 'worker');
    expect(workers.length).toBe(1);
  });

  test('should deduct worker cost from faction gold', () => {
    const goldBefore = game.factionStats.faction_a.gold;
    processAIUnitSpawning();
    expect(game.factionStats.faction_a.gold).toBe(goldBefore - 30); // UNIT_TYPES.worker.cost = 30
  });

  test('should give spawned worker 2 build charges', () => {
    processAIUnitSpawning();
    const worker = game.units.find(u => u.owner === 'faction_a' && u.type === 'worker');
    expect(worker.buildCharges).toBe(2);
  });

  test('should not spawn worker if faction already has one', () => {
    game.units.push(makeUnit({ id: 99, col: 11, row: 10, owner: 'faction_a', type: 'worker' }));
    processAIUnitSpawning();
    const workers = game.units.filter(u => u.owner === 'faction_a' && u.type === 'worker');
    expect(workers.length).toBe(1); // Still just the one we added
  });

  test('should not spawn worker if faction gold is below cost', () => {
    game.factionStats.faction_a.gold = 10;
    processAIUnitSpawning();
    const workers = game.units.filter(u => u.owner === 'faction_a' && u.type === 'worker');
    expect(workers.length).toBe(0);
  });

  test('should spawn settler when population is above threshold and has gold', () => {
    // Give faction a worker so it skips worker spawn and tries settler
    game.units.push(makeUnit({ id: 99, col: 11, row: 10, owner: 'faction_a', type: 'worker' }));
    game.factionStats.faction_a.gold = 200;
    game.factionStats.faction_a.population = 3000;
    processAIUnitSpawning();
    const settlers = game.units.filter(u => u.owner === 'faction_a' && u.type === 'settler');
    expect(settlers.length).toBe(1);
  });

  test('should deduct settler cost and population when spawning settler', () => {
    game.units.push(makeUnit({ id: 99, col: 11, row: 10, owner: 'faction_a', type: 'worker' }));
    game.factionStats.faction_a.gold = 200;
    game.factionStats.faction_a.population = 3000;
    const goldBefore = game.factionStats.faction_a.gold;
    const popBefore = game.factionStats.faction_a.population;
    processAIUnitSpawning();
    expect(game.factionStats.faction_a.gold).toBe(goldBefore - 60); // UNIT_TYPES.settler.cost = 60
    expect(game.factionStats.faction_a.population).toBe(popBefore - 500);
  });

  test('should deduct city population when spawning settler', () => {
    game.units.push(makeUnit({ id: 99, col: 11, row: 10, owner: 'faction_a', type: 'worker' }));
    game.factionStats.faction_a.gold = 200;
    game.factionStats.faction_a.population = 3000;
    game.factionCities.faction_a.population = 1500;
    processAIUnitSpawning();
    expect(game.factionCities.faction_a.population).toBe(1000); // 1500 - 500
  });

  test('should not spawn settler if population is below threshold', () => {
    game.units.push(makeUnit({ id: 99, col: 11, row: 10, owner: 'faction_a', type: 'worker' }));
    game.factionStats.faction_a.population = 1000; // Below default settlerThreshold
    processAIUnitSpawning();
    const settlers = game.units.filter(u => u.owner === 'faction_a' && u.type === 'settler');
    expect(settlers.length).toBe(0);
  });

  test('should not spawn settler if faction already has an expansion city', () => {
    game.units.push(makeUnit({ id: 99, col: 11, row: 10, owner: 'faction_a', type: 'worker' }));
    game.factionStats.faction_a.gold = 200;
    game.factionStats.faction_a.population = 3000;
    game.aiFactionCities.faction_a = [{ name: 'Outpost', col: 20, row: 20, hp: 100, population: 500 }];
    processAIUnitSpawning();
    const settlers = game.units.filter(u => u.owner === 'faction_a' && u.type === 'settler');
    expect(settlers.length).toBe(0);
  });
});

describe('processAIWorkerImprovements()', () => {
  beforeEach(() => {
    setupGameState({
      factionCities: {
        faction_a: { name: 'Nordhaven', col: 10, row: 10, hp: 100, population: 1000, borderRadius: 2 },
      },
      aiFactionCities: {},
      factionStats: {
        faction_a: { gold: 50, military: 10, population: 1000, territory: 10, techs: 2, score: 40, lastUpdated: 1 },
      },
      techs: ['agriculture', 'mining'],
      units: [],
      relationships: {},
    });
  });

  test('should start improvement when AI worker is on a valid tile', () => {
    // Place worker on a grassland tile near the city
    const worker = makeUnit({ id: 50, col: 11, row: 10, owner: 'faction_a', type: 'worker', buildCharges: 2 });
    game.units.push(worker);
    // Ensure the tile is grassland (suitable for farm)
    game.map[10][11].base = 'grassland';
    game.map[10][11].feature = null;
    game.map[10][11].improvement = null;
    game.map[10][11].improvementBuilder = null;
    game.map[10][11].road = false;

    processAIWorkerImprovements();

    // Worker should have started building (sleeping = true and tile has builder)
    expect(worker.sleeping).toBe(true);
    expect(game.map[10][11].improvementBuilder).not.toBeNull();
    expect(game.map[10][11].improvementBuilder.unitId).toBe(50);
  });

  test('should not improve if worker has no build charges', () => {
    const worker = makeUnit({ id: 50, col: 11, row: 10, owner: 'faction_a', type: 'worker', buildCharges: 0 });
    game.units.push(worker);
    game.map[10][11].base = 'grassland';
    game.map[10][11].feature = null;
    game.map[10][11].improvement = null;
    game.map[10][11].improvementBuilder = null;

    processAIWorkerImprovements();

    expect(game.map[10][11].improvementBuilder).toBeNull();
  });

  test('should not improve if worker is already building', () => {
    const worker = makeUnit({ id: 50, col: 11, row: 10, owner: 'faction_a', type: 'worker', buildCharges: 2 });
    worker.sleeping = true;
    game.units.push(worker);

    processAIWorkerImprovements();
    // Should be skipped since worker.sleeping is true
    expect(game.map[10][11].improvementBuilder).toBeNull();
  });
});
