import { describe, test, expect, beforeEach, vi } from 'vitest';
import { setupGameState, makeCity, makeTile } from './fixtures.js';
import { game } from '../src/state.js';
import { RESOURCE_ZONES, UNIT_RESOURCE_REQUIREMENTS } from '../src/constants.js';
import { hasResourceAccess } from '../src/map.js';
import {
  processAIDiplomacy,
  getAIRelation,
  getAITradeDeals,
  getFactionResources,
  initAIRelations,
  resetTurnActions,
} from '../src/ai-diplomacy.js';

// Mock modules that touch the DOM
vi.mock('../src/leaderboard.js', () => ({ updateUI: vi.fn() }));
vi.mock('../src/render.js', () => ({ render: vi.fn(), markVisibilityDirty: vi.fn() }));
vi.mock('../src/discovery.js', () => ({ revealAround: vi.fn() }));
vi.mock('../src/feedback.js', () => ({ startAnimLoop: vi.fn() }));
vi.mock('../src/input.js', () => ({ panCameraTo: vi.fn() }));

function placeResourceOnTile(col, row, resourceId, zoneId) {
  game.map[row][col].resource = resourceId;
  game.map[row][col].resourceZone = zoneId || resourceId;
}

describe('hasResourceAccess()', () => {
  beforeEach(() => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5, borderRadius: 2 })],
      factionCities: {
        faction_a: { col: 20, row: 20, borderRadius: 2 },
      },
      aiFactionCities: {
        faction_b: [{ col: 35, row: 15, borderRadius: 2 }],
      },
      aiTradeDeals: [],
      tradeRoutes: [],
      resourceZones: [],
    });
  });

  test('returns false when no resource nearby', () => {
    expect(hasResourceAccess('iron', 'player')).toBe(false);
  });

  test('returns true when resource within city border', () => {
    placeResourceOnTile(6, 5, 'iron');
    expect(hasResourceAccess('iron', 'player')).toBe(true);
  });

  test('returns false when resource outside city border', () => {
    placeResourceOnTile(15, 15, 'iron');
    expect(hasResourceAccess('iron', 'player')).toBe(false);
  });

  test('AI faction capital border check works', () => {
    placeResourceOnTile(21, 20, 'copper');
    expect(hasResourceAccess('copper', 'faction_a')).toBe(true);
  });

  test('AI expansion city border check works', () => {
    placeResourceOnTile(36, 15, 'horses');
    expect(hasResourceAccess('horses', 'faction_b')).toBe(true);
  });

  test('player trade route grants access via partner', () => {
    // faction_a has iron in their borders
    placeResourceOnTile(21, 20, 'iron');
    // Player has a trade route with faction_a
    game.tradeRoutes = [{ factionId: 'faction_a' }];
    expect(hasResourceAccess('iron', 'player')).toBe(true);
  });

  test('AI trade deal grants access via partner', () => {
    // faction_a has iron in their borders
    placeResourceOnTile(21, 20, 'iron');
    // faction_b has a trade deal with faction_a
    game.aiTradeDeals = [{ factions: ['faction_a', 'faction_b'], turn: 1, goldPerTurn: 20 }];
    expect(hasResourceAccess('iron', 'faction_b')).toBe(true);
  });

  test('AI trade deal does not grant access if partner also lacks resource', () => {
    game.aiTradeDeals = [{ factions: ['faction_a', 'faction_b'], turn: 1, goldPerTurn: 20 }];
    expect(hasResourceAccess('iron', 'faction_b')).toBe(false);
  });
});

describe('getFactionResources()', () => {
  beforeEach(() => {
    setupGameState({
      cities: [],
      factionCities: {
        faction_a: { col: 20, row: 20, borderRadius: 2 },
      },
      aiFactionCities: {},
      aiTradeDeals: [],
      tradeRoutes: [],
      resourceZones: [{ id: 'iron', center: { col: 21, row: 20 }, tiles: [{ col: 21, row: 20 }] }],
    });
  });

  test('reports owned resources correctly', () => {
    placeResourceOnTile(21, 20, 'iron');
    const result = getFactionResources('faction_a');
    expect(result.owned).toContain('iron');
    expect(result.missing).not.toContain('iron');
  });

  test('reports missing resources correctly', () => {
    const result = getFactionResources('faction_a');
    expect(result.missing).toContain('iron');
    expect(result.owned).not.toContain('iron');
  });
});

describe('resource scarcity diplomacy integration', () => {
  // Use real faction IDs from constants.js
  const factionA = 'emperor_valerian';
  const factionB = 'shadow_kael';

  beforeEach(() => {
    // Build factionStats for ALL factions so processAIDiplomacy doesn't skip them
    const factionStats = {};
    const factionCities = {};
    const allFactions = [
      'emperor_valerian', 'shadow_kael', 'merchant_prince_castellan',
      'pirate_queen_elara', 'commander_thane', 'rebel_leader_sera',
    ];
    for (const fid of allFactions) {
      factionStats[fid] = { military: 50, territory: 10, gold: 200, score: 100 };
      factionCities[fid] = { col: 30, row: 20, borderRadius: 2 };
    }
    // Override specific positions
    factionCities[factionA] = { col: 20, row: 20, borderRadius: 2 };
    factionCities[factionB] = { col: 35, row: 15, borderRadius: 2 };

    setupGameState({
      turn: 5,
      cities: [],
      factionCities,
      aiFactionCities: {},
      factionStats,
      aiTradeDeals: [],
      aiRelations: {},
      aiWars: [],
      aiAlliances: [],
      aiSecretPacts: [],
      aiDenouncements: [],
      aiMotivations: {},
      rumourQueue: [],
      tradeRoutes: [],
      resourceZones: [
        { id: 'iron', center: { col: 36, row: 15 }, tiles: [{ col: 36, row: 15 }] },
      ],
    });

    // factionB has iron in their city borders
    placeResourceOnTile(36, 15, 'iron');
    resetTurnActions();
  });

  test('resource envy creates negative relation modifier', () => {
    initAIRelations();

    // Process diplomacy — turn 5, so resource tension runs
    processAIDiplomacy();

    // factionA should have resource_envy motivation toward factionB (who has iron they lack)
    const motivations = game.aiMotivations?.[factionA]?.[factionB] || [];
    const envyMotivation = motivations.find(m => m.type === 'resource_envy');
    expect(envyMotivation).toBeDefined();
    expect(envyMotivation.detail).toContain('Iron');
  });
});
