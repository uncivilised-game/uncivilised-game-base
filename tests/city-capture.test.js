import { describe, test, expect, beforeEach, vi } from 'vitest';
import { setupGameState, makeUnit } from './fixtures.js';
import { game } from '../src/state.js';

// Mock modules that touch the DOM heavily
vi.mock('../src/leaderboard.js', () => ({ updateUI: vi.fn() }));
vi.mock('../src/render.js', () => ({
  render: vi.fn(),
  markVisibilityDirty: vi.fn(),
}));
vi.mock('../src/discovery.js', () => ({ revealAround: vi.fn() }));
vi.mock('../src/feedback.js', () => ({ startAnimLoop: vi.fn() }));
vi.mock('../src/input.js', () => ({ panCameraTo: vi.fn() }));

import { captureExpansionCity, captureFactionCity, razeCapturedCity } from '../src/combat.js';

describe('captureExpansionCity()', () => {
  beforeEach(() => {
    setupGameState({
      aiFactionCities: {
        faction_a: [
          { name: 'Outpost Alpha', col: 10, row: 10, hp: 0, population: 800, borderRadius: 2, wallHP: 0, wallMaxHP: 0, wallLastAttackedTurn: -99 },
        ],
      },
      factionCities: {
        faction_a: { name: 'Capital City', col: 15, row: 15, hp: 100, population: 1000, borderRadius: 2 },
      },
      relationships: { faction_a: 0 },
      gold: 50,
    });
  });

  test('should convert expansion city to player city', () => {
    captureExpansionCity('faction_a', 0);
    expect(game.cities.length).toBe(1);
    expect(game.cities[0].name).toBe('Outpost Alpha');
    expect(game.cities[0].col).toBe(10);
    expect(game.cities[0].row).toBe(10);
  });

  test('should reduce population to 50% (min 200)', () => {
    captureExpansionCity('faction_a', 0);
    expect(game.cities[0].population).toBe(400);
  });

  test('should remove city from AI faction cities', () => {
    captureExpansionCity('faction_a', 0);
    expect(game.aiFactionCities.faction_a.length).toBe(0);
  });

  test('should award plunder gold', () => {
    captureExpansionCity('faction_a', 0);
    expect(game.gold).toBeGreaterThan(50);
  });

  test('should damage relationships', () => {
    captureExpansionCity('faction_a', 0);
    expect(game.relationships.faction_a).toBeLessThanOrEqual(-40);
  });

  test('should remove garrison units at city tile', () => {
    game.units = [
      makeUnit({ id: 1, col: 10, row: 10, owner: 'faction_a', type: 'warrior' }),
      makeUnit({ id: 2, col: 20, row: 20, owner: 'faction_a', type: 'warrior' }),
    ];
    captureExpansionCity('faction_a', 0);
    expect(game.units.length).toBe(1);
    expect(game.units[0].id).toBe(2);
  });
});

describe('captureFactionCity()', () => {
  beforeEach(() => {
    setupGameState({
      factionCities: {
        faction_b: { name: 'Grand Capital', col: 20, row: 20, hp: 0, population: 1000, borderRadius: 2 },
      },
      aiFactionCities: { faction_b: [] },
      relationships: { faction_b: 0 },
      activeAlliances: { faction_b: true },
      tradeDeals: { faction_b: { gold: 5 } },
      gold: 100,
    });
  });

  test('should convert faction capital to player city', () => {
    captureFactionCity('faction_b');
    expect(game.cities.length).toBe(1);
    expect(game.cities[0].name).toBe('Grand Capital');
    expect(game.cities[0].population).toBe(500);
  });

  test('should remove from factionCities', () => {
    captureFactionCity('faction_b');
    expect(game.factionCities.faction_b).toBeUndefined();
  });

  test('should devastate relationships to -100', () => {
    captureFactionCity('faction_b');
    expect(game.relationships.faction_b).toBe(-100);
  });

  test('should break all diplomatic agreements', () => {
    captureFactionCity('faction_b');
    expect(game.activeAlliances.faction_b).toBeUndefined();
    expect(game.tradeDeals.faction_b).toBeUndefined();
  });

  test('should award plunder gold', () => {
    captureFactionCity('faction_b');
    expect(game.gold).toBeGreaterThan(100);
  });
});

describe('razeCapturedCity()', () => {
  beforeEach(() => {
    setupGameState({
      aiFactionCities: {
        faction_a: [
          { name: 'Raze Target', col: 10, row: 10, hp: 0, population: 600, borderRadius: 2, wallHP: 0, wallMaxHP: 0, wallLastAttackedTurn: -99 },
        ],
      },
      factionCities: {
        faction_a: { name: 'Capital City', col: 15, row: 15, hp: 100, population: 1000, borderRadius: 2 },
      },
      relationships: { faction_a: 0 },
      gold: 50,
    });
  });

  test('should NOT add city to player cities when razed', () => {
    const city = game.aiFactionCities.faction_a[0];
    razeCapturedCity(city, 'faction_a', 'expansion', 0);
    expect(game.cities.length).toBe(0);
  });

  test('should remove expansion city from AI faction cities', () => {
    const city = game.aiFactionCities.faction_a[0];
    razeCapturedCity(city, 'faction_a', 'expansion', 0);
    expect(game.aiFactionCities.faction_a.length).toBe(0);
  });

  test('should award plunder gold for razed expansion city', () => {
    const city = game.aiFactionCities.faction_a[0];
    razeCapturedCity(city, 'faction_a', 'expansion', 0);
    expect(game.gold).toBeGreaterThan(50);
  });

  test('should damage relationships when razing expansion city', () => {
    const city = game.aiFactionCities.faction_a[0];
    razeCapturedCity(city, 'faction_a', 'expansion', 0);
    expect(game.relationships.faction_a).toBeLessThanOrEqual(-40);
  });

  test('should remove garrison units at razed city', () => {
    game.units = [
      makeUnit({ id: 1, col: 10, row: 10, owner: 'faction_a', type: 'warrior' }),
      makeUnit({ id: 2, col: 5, row: 5, owner: 'player', type: 'warrior' }),
    ];
    const city = game.aiFactionCities.faction_a[0];
    razeCapturedCity(city, 'faction_a', 'expansion', 0);
    expect(game.units.length).toBe(1);
    expect(game.units[0].id).toBe(2);
  });

  test('should raze faction capital and break all agreements', () => {
    setupGameState({
      factionCities: {
        faction_b: { name: 'Enemy Capital', col: 20, row: 20, hp: 0, population: 1000, borderRadius: 2 },
      },
      aiFactionCities: { faction_b: [] },
      relationships: { faction_b: 0 },
      activeAlliances: { faction_b: true },
      tradeDeals: { faction_b: { gold: 5 } },
      gold: 100,
    });
    const city = game.factionCities.faction_b;
    razeCapturedCity(city, 'faction_b', 'capital', null);
    expect(game.factionCities.faction_b).toBeUndefined();
    expect(game.activeAlliances.faction_b).toBeUndefined();
    expect(game.tradeDeals.faction_b).toBeUndefined();
    expect(game.relationships.faction_b).toBe(-100);
    expect(game.cities.length).toBe(0);
  });

  test('should clear tile improvement at razed city', () => {
    game.map[10][10].improvement = 'farm';
    const city = game.aiFactionCities.faction_a[0];
    razeCapturedCity(city, 'faction_a', 'expansion', 0);
    expect(game.map[10][10].improvement).toBeNull();
  });

  test('should eliminate faction when last city is razed', () => {
    setupGameState({
      aiFactionCities: {
        faction_c: [
          { name: 'Last City', col: 8, row: 8, hp: 0, population: 400, borderRadius: 1 },
        ],
      },
      factionCities: {},
      relationships: { faction_c: 0 },
      gold: 50,
      units: [
        makeUnit({ id: 10, col: 30, row: 30, owner: 'faction_c', type: 'warrior' }),
      ],
    });
    const city = game.aiFactionCities.faction_c[0];
    razeCapturedCity(city, 'faction_c', 'expansion', 0);
    expect(game.units.filter(u => u.owner === 'faction_c').length).toBe(0);
    expect(game.score).toBe(100);
  });
});
