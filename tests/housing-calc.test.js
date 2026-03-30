import { describe, test, expect, beforeEach } from 'vitest';
import { calculateCityHousing } from '../src/housing.js';
import { setupGameState, makeCity } from './fixtures.js';

describe('calculateCityHousing()', () => {
  beforeEach(() => {
    setupGameState();
  });

  test('should return base housing of 2 for a bare city', () => {
    const city = makeCity({ col: 10, row: 10 });
    const { housing, sources } = calculateCityHousing(city);
    expect(housing).toBe(2);
    expect(sources).toContainEqual({ label: 'City Center', value: 2 });
  });

  test('should add +3 housing for adjacent river', () => {
    const state = setupGameState();
    state.map[10][10].hasRiver = true;
    const city = makeCity({ col: 10, row: 10 });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(5);
  });

  test('should add +1 housing for adjacent lake (no river)', () => {
    const state = setupGameState();
    state.map[9][10].base = 'lake';
    const city = makeCity({ col: 10, row: 10 });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(3);
  });

  test('should prefer river over lake/coast', () => {
    const state = setupGameState();
    state.map[10][10].hasRiver = true;
    state.map[9][10].base = 'lake';
    const city = makeCity({ col: 10, row: 10 });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(5);
  });

  test('should add +2 for granary building', () => {
    const city = makeCity({ col: 10, row: 10, buildings: ['granary'] });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(4);
  });

  test('should add +1 for walls building', () => {
    const city = makeCity({ col: 10, row: 10, buildings: ['walls'] });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(3);
  });

  test('should add +1 for garden building', () => {
    const city = makeCity({ col: 10, row: 10, buildings: ['garden'] });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(3);
  });

  test('should add +0.5 per farm in territory', () => {
    const state = setupGameState();
    state.map[10][11].improvement = 'farm';
    state.map[10][9].improvement = 'farm';
    const city = makeCity({ col: 10, row: 10, borderRadius: 2 });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(3);
  });

  test('should stack all housing sources', () => {
    const state = setupGameState();
    state.map[10][10].hasRiver = true;
    state.map[10][11].improvement = 'farm';
    state.map[10][9].improvement = 'farm';
    const city = makeCity({
      col: 10, row: 10,
      buildings: ['granary', 'walls', 'garden'],
      borderRadius: 2,
    });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(10);
  });
});
