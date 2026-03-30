import { describe, it, expect } from 'vitest';
import { getHousingGrowthModifier } from '../src/housing.js';

describe('getHousingGrowthModifier', () => {
  it('returns 1.0 when housing exceeds population by 1+', () => {
    // pop = floor(1000 / 500) = 2, housing = 3 → diff = 1
    expect(getHousingGrowthModifier(3, 1000)).toBe(1.0);
    // pop = 2, housing = 10 → diff = 8
    expect(getHousingGrowthModifier(10, 1000)).toBe(1.0);
  });

  it('returns 0.5 when housing equals population', () => {
    // pop = floor(1000 / 500) = 2, housing = 2
    expect(getHousingGrowthModifier(2, 1000)).toBe(0.5);
  });

  it('returns 0.25 when housing is 1 below population', () => {
    // pop = floor(1000 / 500) = 2, housing = 1 → diff = -1
    expect(getHousingGrowthModifier(1, 1000)).toBe(0.25);
  });

  it('returns 0 when housing is 2+ below population', () => {
    // pop = floor(1000 / 500) = 2, housing = 0 → diff = -2
    expect(getHousingGrowthModifier(0, 1000)).toBe(0);
    // pop = floor(2500 / 500) = 5, housing = 2 → diff = -3
    expect(getHousingGrowthModifier(2, 2500)).toBe(0);
  });

  it('uses floor(population / 500) as effective pop', () => {
    // pop = floor(499 / 500) = 0, housing = 1 → diff = 1 → 1.0
    expect(getHousingGrowthModifier(1, 499)).toBe(1.0);
    // pop = floor(500 / 500) = 1, housing = 1 → diff = 0 → 0.5
    expect(getHousingGrowthModifier(1, 500)).toBe(0.5);
  });

  it('handles zero population', () => {
    // pop = floor(0 / 500) = 0, housing = 2 → diff = 2 → 1.0
    expect(getHousingGrowthModifier(2, 0)).toBe(1.0);
  });
});
