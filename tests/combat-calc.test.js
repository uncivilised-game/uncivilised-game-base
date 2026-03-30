import { describe, test, expect, beforeEach } from 'vitest';
import { getUnitAt, getPlayerUnitAt, getEnemyUnitAt, isAtWarWith } from '../src/combat.js';
import { setupGameState, makeUnit } from './fixtures.js';

describe('getUnitAt()', () => {
  beforeEach(() => {
    setupGameState({
      units: [
        makeUnit({ id: 1, col: 5, row: 5, owner: 'player' }),
        makeUnit({ id: 2, col: 10, row: 10, owner: 'faction_a' }),
      ],
    });
  });

  test('should find a unit at the given coordinates', () => {
    const unit = getUnitAt(5, 5);
    expect(unit).toBeDefined();
    expect(unit.id).toBe(1);
  });

  test('should return undefined when no unit is at coordinates', () => {
    expect(getUnitAt(0, 0)).toBeUndefined();
  });

  test('should find non-player units too', () => {
    const unit = getUnitAt(10, 10);
    expect(unit.owner).toBe('faction_a');
  });
});

describe('getPlayerUnitAt()', () => {
  beforeEach(() => {
    setupGameState({
      units: [
        makeUnit({ id: 1, col: 5, row: 5, owner: 'player' }),
        makeUnit({ id: 2, col: 10, row: 10, owner: 'faction_a' }),
      ],
    });
  });

  test('should find player unit', () => {
    const unit = getPlayerUnitAt(5, 5);
    expect(unit).toBeDefined();
    expect(unit.owner).toBe('player');
  });

  test('should not find non-player units', () => {
    expect(getPlayerUnitAt(10, 10)).toBeUndefined();
  });
});

describe('getEnemyUnitAt()', () => {
  beforeEach(() => {
    setupGameState({
      units: [
        makeUnit({ id: 1, col: 5, row: 5, owner: 'player' }),
        makeUnit({ id: 2, col: 10, row: 10, owner: 'faction_a' }),
      ],
    });
  });

  test('should find enemy unit', () => {
    const unit = getEnemyUnitAt(10, 10);
    expect(unit).toBeDefined();
    expect(unit.owner).toBe('faction_a');
  });

  test('should not find player units', () => {
    expect(getEnemyUnitAt(5, 5)).toBeUndefined();
  });
});

describe('isAtWarWith()', () => {
  test('should return false when no wars exist', () => {
    setupGameState({ aiWars: [] });
    expect(isAtWarWith('faction_a')).toBe(false);
  });

  test('should return true when player declared war on faction', () => {
    setupGameState({
      aiWars: [{ attacker: 'player', defender: 'faction_a', startTurn: 1 }],
    });
    expect(isAtWarWith('faction_a')).toBe(true);
  });

  test('should return true when faction declared war on player', () => {
    setupGameState({
      aiWars: [{ attacker: 'faction_a', defender: 'player', startTurn: 1 }],
    });
    expect(isAtWarWith('faction_a')).toBe(true);
  });

  test('should return false for unrelated wars', () => {
    setupGameState({
      aiWars: [{ attacker: 'faction_b', defender: 'faction_a', startTurn: 1 }],
    });
    expect(isAtWarWith('faction_a')).toBe(false);
  });

  test('should handle missing aiWars gracefully', () => {
    setupGameState({ aiWars: undefined });
    expect(isAtWarWith('faction_a')).toBe(false);
  });
});
