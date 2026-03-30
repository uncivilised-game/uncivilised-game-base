import { describe, test, expect } from 'vitest';
import { simplex, valueNoise, fbmNoise, rgbStr, adjustBrightness, hexToRgba } from '../src/utils.js';

describe('rgbStr()', () => {
  test('should return correct rgba string with explicit alpha', () => {
    expect(rgbStr(255, 128, 0, 0.5)).toBe('rgba(255,128,0,0.5)');
  });

  test('should default alpha to 1 when omitted', () => {
    expect(rgbStr(100, 200, 50)).toBe('rgba(100,200,50,1)');
  });

  test('should round fractional values', () => {
    expect(rgbStr(100.7, 200.3, 50.9, 1)).toBe('rgba(101,200,51,1)');
  });
});

describe('adjustBrightness()', () => {
  test('should brighten a color', () => {
    const result = adjustBrightness('#808080', 20);
    expect(result).toBe('rgb(148,148,148)');
  });

  test('should darken a color', () => {
    const result = adjustBrightness('#808080', -20);
    expect(result).toBe('rgb(108,108,108)');
  });

  test('should clamp to 0-255 range', () => {
    expect(adjustBrightness('#ffffff', 50)).toBe('rgb(255,255,255)');
    expect(adjustBrightness('#000000', -50)).toBe('rgb(0,0,0)');
  });

  test('should handle zero adjustment', () => {
    expect(adjustBrightness('#ff0000', 0)).toBe('rgb(255,0,0)');
  });
});

describe('hexToRgba()', () => {
  test('should convert hex to rgba', () => {
    expect(hexToRgba('#ff8040', 0.5)).toBe('rgba(255,128,64,0.5)');
  });

  test('should handle black', () => {
    expect(hexToRgba('#000000', 1)).toBe('rgba(0,0,0,1)');
  });

  test('should handle white', () => {
    expect(hexToRgba('#ffffff', 0)).toBe('rgba(255,255,255,0)');
  });
});

describe('simplex()', () => {
  test('should be deterministic', () => {
    expect(simplex(1.5, 2.3)).toBe(simplex(1.5, 2.3));
  });

  test('should return values in a reasonable range', () => {
    for (let i = 0; i < 100; i++) {
      const v = simplex(i * 0.1, i * 0.17);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(2);
    }
  });

  test('should return different values for different inputs', () => {
    expect(simplex(0, 0)).not.toBe(simplex(10, 10));
  });
});

describe('valueNoise()', () => {
  test('should be deterministic', () => {
    expect(valueNoise(3.7, 8.2)).toBe(valueNoise(3.7, 8.2));
  });

  test('should return values in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const v = valueNoise(i * 1.3, i * 0.7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('fbmNoise()', () => {
  test('should be deterministic', () => {
    expect(fbmNoise(1, 2, 3)).toBe(fbmNoise(1, 2, 3));
  });

  test('should return values roughly in [0, 1]', () => {
    for (let i = 0; i < 50; i++) {
      const v = fbmNoise(i * 0.5, i * 0.3, 3);
      expect(v).toBeGreaterThanOrEqual(-0.5);
      expect(v).toBeLessThanOrEqual(1.5);
    }
  });

  test('should default to 3 octaves', () => {
    expect(fbmNoise(1, 2)).toBe(fbmNoise(1, 2, 3));
  });
});
