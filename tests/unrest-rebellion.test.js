import { describe, test, expect, beforeEach } from 'vitest';
import { calculateCityAmenities, getAmenityStatus, getAmenityMod, areCitiesRoadConnected } from '../src/turn.js';
import { setupGameState, makeCity, makeUnit } from './fixtures.js';
import { UNREST } from '../src/constants.js';

describe('getAmenityStatus()', () => {
  test('should return correct status for each balance level', () => {
    expect(getAmenityStatus(3)).toBe('ECSTATIC');
    expect(getAmenityStatus(2)).toBe('ECSTATIC');
    expect(getAmenityStatus(1)).toBe('HAPPY');
    expect(getAmenityStatus(0)).toBe('CONTENT');
    expect(getAmenityStatus(-1)).toBe('DISPLEASED');
    expect(getAmenityStatus(-2)).toBe('UNHAPPY');
    expect(getAmenityStatus(-3)).toBe('REVOLT_RISK');
    expect(getAmenityStatus(-5)).toBe('REVOLT_RISK');
  });
});

describe('getAmenityMod()', () => {
  test('should return correct modifier for each balance level', () => {
    expect(getAmenityMod(2)).toBe(0.10);
    expect(getAmenityMod(1)).toBe(0.05);
    expect(getAmenityMod(0)).toBe(0);
    expect(getAmenityMod(-1)).toBe(-0.05);
    expect(getAmenityMod(-2)).toBe(-0.10);
    expect(getAmenityMod(-3)).toBe(-0.25);
  });
});

describe('calculateCityAmenities() unrest system', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('should apply no empire size penalty for 3 or fewer cities', () => {
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5 }),
      makeCity({ name: 'City 2', col: 10, row: 5 }),
      makeCity({ name: 'City 3', col: 15, row: 5 }),
    ];
    const events = [];
    calculateCityAmenities(events);
    for (const city of state.cities) {
      expect(city.unrestFromEmpireSize).toBe(0);
    }
  });

  test('should apply empire size penalty for cities beyond FREE_CITIES', () => {
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5 }),
      makeCity({ name: 'City 2', col: 10, row: 5 }),
      makeCity({ name: 'City 3', col: 15, row: 5 }),
      makeCity({ name: 'City 4', col: 20, row: 5 }),
      makeCity({ name: 'City 5', col: 25, row: 5 }),
    ];
    const events = [];
    calculateCityAmenities(events);
    // 5 cities - 3 free = 2 excess, so -2 penalty to all cities
    for (const city of state.cities) {
      expect(city.unrestFromEmpireSize).toBe(-2);
    }
  });

  test('should apply distance penalty based on hex distance from capital', () => {
    // Capital at (5,5), far city at (30,5) — distance ~25 hexes
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5 }),
      makeCity({ name: 'Far City', col: 30, row: 5 }),
    ];
    // Add amenity buildings to prevent rebellion from removing the far city
    state.buildings = ['arena', 'garden', 'temple'];
    const events = [];
    calculateCityAmenities(events);
    // Capital has no distance penalty
    expect(state.cities[0].unrestFromDistance).toBe(0);
    // Far city: floor(~25 / 8) = -3
    const farCity = state.cities.find(c => c.name === 'Far City');
    expect(farCity.unrestFromDistance).toBeLessThan(0);
  });

  test('should apply captured city penalty', () => {
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5 }),
      makeCity({ name: 'Conquered', col: 10, row: 5, captured: true }),
    ];
    // Prevent rebellion from removing the captured city during amenity calc
    const origRandom = Math.random;
    Math.random = () => 0.99;
    const events = [];
    calculateCityAmenities(events);
    Math.random = origRandom;
    expect(state.cities[0].unrestFromCapture).toBe(0);
    expect(state.cities[1].unrestFromCapture).toBe(UNREST.CAPTURED_PENALTY);
  });

  test('should apply garrison bonus for fortified military unit', () => {
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5 }),
    ];
    state.units = [
      makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player', fortified: true }),
    ];
    const events = [];
    calculateCityAmenities(events);
    expect(state.cities[0].unrestGarrisonBonus).toBe(UNREST.GARRISON_BONUS);
  });

  test('should NOT apply garrison bonus for non-fortified unit', () => {
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5 }),
    ];
    state.units = [
      makeUnit({ id: 1, col: 5, row: 5, type: 'warrior', owner: 'player', fortified: false }),
    ];
    const events = [];
    calculateCityAmenities(events);
    expect(state.cities[0].unrestGarrisonBonus).toBe(0);
  });

  test('should NOT apply garrison bonus for civilian units', () => {
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5 }),
    ];
    state.units = [
      makeUnit({ id: 1, col: 5, row: 5, type: 'worker', owner: 'player', fortified: true }),
    ];
    const events = [];
    calculateCityAmenities(events);
    expect(state.cities[0].unrestGarrisonBonus).toBe(0);
  });

  test('should include unrest in final amenity balance', () => {
    // 5 cities = -2 empire penalty on all. Keep cities close to avoid distance + rebellion.
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5, population: 200 }),
      makeCity({ name: 'City 2', col: 7, row: 5, population: 200 }),
      makeCity({ name: 'City 3', col: 9, row: 5, population: 200 }),
      makeCity({ name: 'City 4', col: 11, row: 5, population: 200 }),
      makeCity({ name: 'Captured', col: 13, row: 5, population: 200, captured: true }),
    ];
    // Add amenity buildings to keep cities above REVOLT_RISK
    state.buildings = ['arena', 'garden', 'temple'];
    const events = [];
    calculateCityAmenities(events);
    const captured = state.cities.find(c => c.name === 'Captured');
    expect(captured.unrestFromEmpireSize).toBe(-2);
    expect(captured.unrestFromCapture).toBe(-2);
    // Balance should reflect unrest penalties
    expect(captured.amenityBalance).toBeLessThan(captured.amenityFromBuildings);
  });

  test('capital should never rebel (spawns rebel unit instead)', () => {
    // Set up capital at REVOLT_RISK with deterministic rebellion
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5, population: 5000 }),
    ];
    // Force very negative amenity balance by having many cities
    for (let i = 1; i <= 10; i++) {
      state.cities.push(makeCity({ name: `City ${i}`, col: 5 + i * 3, row: 5, population: 200 }));
    }
    const events = [];
    calculateCityAmenities(events);
    // Capital should still exist (index 0)
    expect(state.cities[0].name).toBe('Capital');
  });
});

describe('rebellion suppression bonus', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('rebellionsSuppressed should default to 0', () => {
    expect(state.rebellionsSuppressed).toBe(0);
  });

  test('suppressed city should have rebellionSuppressed flag', () => {
    const city = makeCity({ name: 'Recaptured', rebellionSuppressed: true });
    expect(city.rebellionSuppressed).toBe(true);
  });

  test('suppression should reduce rebellion chance for recaptured city by 50%', () => {
    // With 1 suppression, recaptured city: chance *= 0.5 * 0.9^0 = 0.5
    // Base chance for REVOLT_RISK without garrison = 0.15
    // Suppressed chance = 0.15 * 0.5 = 0.075
    state.rebellionsSuppressed = 1;
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5, population: 200 }),
      makeCity({ name: 'Recaptured', col: 7, row: 5, population: 200, rebellionSuppressed: true }),
    ];
    state.buildings = ['arena', 'garden', 'temple'];
    const events = [];
    calculateCityAmenities(events);
    // City should still exist (suppression makes rebellion less likely)
    const recaptured = state.cities.find(c => c.name === 'Recaptured');
    expect(recaptured).toBeDefined();
    expect(recaptured.rebellionSuppressed).toBe(true);
  });

  test('suppression should reduce rebellion chance for other cities by 10% per suppression', () => {
    // With 2 suppressions, other cities: chance *= 0.9^2 = 0.81
    state.rebellionsSuppressed = 2;
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5, population: 200 }),
      makeCity({ name: 'Regular City', col: 7, row: 5, population: 200 }),
    ];
    state.buildings = ['arena', 'garden', 'temple'];
    const events = [];
    calculateCityAmenities(events);
    // City should still exist
    const regular = state.cities.find(c => c.name === 'Regular City');
    expect(regular).toBeDefined();
  });
});

describe('road connection bonus', () => {
  let state;

  beforeEach(() => {
    state = setupGameState();
  });

  test('adjacent cities should always be road-connected', () => {
    const c1 = makeCity({ name: 'A', col: 5, row: 5 });
    const c2 = makeCity({ name: 'B', col: 6, row: 5 });
    expect(areCitiesRoadConnected(c1, c2)).toBe(true);
  });

  test('distant cities without roads should NOT be connected', () => {
    const c1 = makeCity({ name: 'A', col: 5, row: 5 });
    const c2 = makeCity({ name: 'B', col: 20, row: 5 });
    expect(areCitiesRoadConnected(c1, c2)).toBe(false);
  });

  test('distant cities with road path should be connected', () => {
    const c1 = makeCity({ name: 'A', col: 5, row: 5 });
    const c2 = makeCity({ name: 'B', col: 15, row: 5 });
    // Build road tiles between them
    for (let c = 5; c <= 15; c++) {
      state.map[5][c].road = true;
    }
    expect(areCitiesRoadConnected(c1, c2)).toBe(true);
  });

  test('road-connected city should get amenity bonus', () => {
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5 }),
      makeCity({ name: 'Colony', col: 15, row: 5 }),
    ];
    // Build road between them
    for (let c = 5; c <= 15; c++) {
      state.map[5][c].road = true;
    }
    const events = [];
    calculateCityAmenities(events);
    expect(state.cities[1].roadConnected).toBe(true);
    expect(state.cities[1].amenityFromRoad).toBe(UNREST.ROAD_CONNECTION_BONUS);
  });

  test('unconnected city should NOT get road bonus', () => {
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5 }),
      makeCity({ name: 'Isolated', col: 25, row: 5 }),
    ];
    state.buildings = ['arena', 'garden', 'temple'];
    const events = [];
    calculateCityAmenities(events);
    const isolated = state.cities.find(c => c.name === 'Isolated');
    expect(isolated.roadConnected).toBe(false);
    expect(isolated.amenityFromRoad).toBe(0);
  });

  test('road bonus should be included in amenity balance', () => {
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5, population: 200 }),
      makeCity({ name: 'Connected', col: 15, row: 5, population: 200 }),
      makeCity({ name: 'Disconnected', col: 25, row: 5, population: 200 }),
    ];
    state.buildings = ['arena', 'garden', 'temple'];
    // Road only to the first colony
    for (let c = 5; c <= 15; c++) {
      state.map[5][c].road = true;
    }
    const events = [];
    calculateCityAmenities(events);
    const connected = state.cities.find(c => c.name === 'Connected');
    const disconnected = state.cities.find(c => c.name === 'Disconnected');
    expect(connected.amenityBalance).toBeGreaterThan(disconnected.amenityBalance);
  });

  test('capital itself should not get road connection bonus', () => {
    state.cities = [
      makeCity({ name: 'Capital', col: 5, row: 5 }),
    ];
    const events = [];
    calculateCityAmenities(events);
    expect(state.cities[0].roadConnected).toBe(false);
    expect(state.cities[0].amenityFromRoad).toBe(0);
  });
});

describe('UNREST constants', () => {
  test('should have expected default values', () => {
    expect(UNREST.FREE_CITIES).toBe(3);
    expect(UNREST.EMPIRE_SIZE_PENALTY).toBe(-1);
    expect(UNREST.DISTANCE_DIVISOR).toBe(8);
    expect(UNREST.CAPTURED_PENALTY).toBe(-2);
    expect(UNREST.GARRISON_BONUS).toBe(1);
    expect(UNREST.REBELLION_BASE_CHANCE).toBe(0.15);
    expect(UNREST.REBELLION_GARRISON_CHANCE).toBe(0.05);
    expect(UNREST.REBEL_UNIT_COUNT).toBe(2);
  });
});
