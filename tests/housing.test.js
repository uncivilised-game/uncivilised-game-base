import { describe, test, expect } from 'vitest';
import { getHousingGrowthModifier } from '../src/housing.js';

describe('getHousingGrowthModifier()', () => {
  test('should return 1.0 when housing exceeds population by 1+', () => {
    expect(getHousingGrowthModifier(3, 1000)).toBe(1.0);
    expect(getHousingGrowthModifier(10, 1000)).toBe(1.0);
  });

  test('should return 0.5 when housing equals population', () => {
    expect(getHousingGrowthModifier(2, 1000)).toBe(0.5);
  });

  test('should return 0.25 when housing is 1 below population', () => {
    expect(getHousingGrowthModifier(1, 1000)).toBe(0.25);
  });

  test('should return 0 when housing is 2+ below population', () => {
    expect(getHousingGrowthModifier(0, 1000)).toBe(0);
    expect(getHousingGrowthModifier(2, 2500)).toBe(0);
  });

  test('should use floor(population / 500) as effective pop', () => {
    expect(getHousingGrowthModifier(1, 499)).toBe(1.0);
    expect(getHousingGrowthModifier(1, 500)).toBe(0.5);
  });

  test('should handle zero population', () => {
    expect(getHousingGrowthModifier(2, 0)).toBe(1.0);
  });
});
