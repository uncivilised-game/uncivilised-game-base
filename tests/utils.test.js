import { describe, it, expect } from 'vitest';
import { simplex, valueNoise, fbmNoise, rgbStr, adjustBrightness, hexToRgba } from '../src/utils.js';

describe('rgbStr', () => {
  it('returns correct rgba string with explicit alpha', () => {
    expect(rgbStr(255, 128, 0, 0.5)).toBe('rgba(255,128,0,0.5)');
  });

  it('defaults alpha to 1 when omitted', () => {
    expect(rgbStr(100, 200, 50)).toBe('rgba(100,200,50,1)');
  });

  it('rounds fractional values', () => {
    expect(rgbStr(100.7, 200.3, 50.9, 1)).toBe('rgba(101,200,51,1)');
  });
});

describe('adjustBrightness', () => {
  it('brightens a color', () => {
    const result = adjustBrightness('#808080', 20);
    expect(result).toBe('rgb(148,148,148)');
  });

  it('darkens a color', () => {
    const result = adjustBrightness('#808080', -20);
    expect(result).toBe('rgb(108,108,108)');
  });

  it('clamps to 0-255 range', () => {
    const bright = adjustBrightness('#ffffff', 50);
    expect(bright).toBe('rgb(255,255,255)');

    const dark = adjustBrightness('#000000', -50);
    expect(dark).toBe('rgb(0,0,0)');
  });

  it('handles pure colors', () => {
    const result = adjustBrightness('#ff0000', 0);
    expect(result).toBe('rgb(255,0,0)');
  });
});

describe('hexToRgba', () => {
  it('converts hex to rgba', () => {
    expect(hexToRgba('#ff8040', 0.5)).toBe('rgba(255,128,64,0.5)');
  });

  it('handles black', () => {
    expect(hexToRgba('#000000', 1)).toBe('rgba(0,0,0,1)');
  });

  it('handles white', () => {
    expect(hexToRgba('#ffffff', 0)).toBe('rgba(255,255,255,0)');
  });
});

describe('simplex', () => {
  it('is deterministic', () => {
    const a = simplex(1.5, 2.3);
    const b = simplex(1.5, 2.3);
    expect(a).toBe(b);
  });

  it('returns values in a reasonable range', () => {
    // Simplex noise should be roughly in [-1, 1]
    for (let i = 0; i < 100; i++) {
      const v = simplex(i * 0.1, i * 0.17);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(2);
    }
  });

  it('returns different values for different inputs', () => {
    const a = simplex(0, 0);
    const b = simplex(10, 10);
    expect(a).not.toBe(b);
  });
});

describe('valueNoise', () => {
  it('is deterministic', () => {
    expect(valueNoise(3.7, 8.2)).toBe(valueNoise(3.7, 8.2));
  });

  it('returns values in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const v = valueNoise(i * 1.3, i * 0.7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('fbmNoise', () => {
  it('is deterministic', () => {
    expect(fbmNoise(1, 2, 3)).toBe(fbmNoise(1, 2, 3));
  });

  it('returns values roughly in [0, 1]', () => {
    for (let i = 0; i < 50; i++) {
      const v = fbmNoise(i * 0.5, i * 0.3, 3);
      expect(v).toBeGreaterThanOrEqual(-0.5);
      expect(v).toBeLessThanOrEqual(1.5);
    }
  });

  it('defaults to 3 octaves', () => {
    expect(fbmNoise(1, 2)).toBe(fbmNoise(1, 2, 3));
  });
});
