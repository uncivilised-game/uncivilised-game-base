import { describe, it, expect, beforeEach } from 'vitest';
import { calculateCityHousing } from '../src/housing.js';
import { setupGameState, makeCity, makeTile } from './fixtures.js';

describe('calculateCityHousing', () => {
  beforeEach(() => {
    setupGameState();
  });

  it('returns base housing of 2 for a bare city', () => {
    const city = makeCity({ col: 10, row: 10 });
    const { housing, sources } = calculateCityHousing(city);
    expect(housing).toBe(2);
    expect(sources).toContainEqual({ label: 'City Center', value: 2 });
  });

  it('adds +3 housing for adjacent river', () => {
    const state = setupGameState();
    // Put a river on the city tile
    state.map[10][10].hasRiver = true;
    const city = makeCity({ col: 10, row: 10 });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(5); // 2 base + 3 river
  });

  it('adds +1 housing for adjacent lake (no river)', () => {
    const state = setupGameState();
    // Put a lake adjacent to the city
    state.map[9][10].base = 'lake';
    const city = makeCity({ col: 10, row: 10 });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(3); // 2 base + 1 lake
  });

  it('river takes priority over lake/coast', () => {
    const state = setupGameState();
    state.map[10][10].hasRiver = true;
    state.map[9][10].base = 'lake';
    const city = makeCity({ col: 10, row: 10 });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(5); // 2 + 3 river, NOT +1 lake
  });

  it('adds +2 for granary building', () => {
    const city = makeCity({ col: 10, row: 10, buildings: ['granary'] });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(4); // 2 + 2
  });

  it('adds +1 for walls building', () => {
    const city = makeCity({ col: 10, row: 10, buildings: ['walls'] });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(3); // 2 + 1
  });

  it('adds +1 for garden building', () => {
    const city = makeCity({ col: 10, row: 10, buildings: ['garden'] });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(3); // 2 + 1
  });

  it('adds +0.5 per farm in territory', () => {
    const state = setupGameState();
    // Place 2 farms within city border radius (default 2)
    state.map[10][11].improvement = 'farm';
    state.map[10][9].improvement = 'farm';
    const city = makeCity({ col: 10, row: 10, borderRadius: 2 });
    const { housing } = calculateCityHousing(city);
    expect(housing).toBe(3); // 2 + 2 * 0.5
  });

  it('stacks all housing sources', () => {
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
    // 2 base + 3 river + 2 granary + 1 walls + 1 garden + 1 farms(2*0.5)
    expect(housing).toBe(10);
  });
});
