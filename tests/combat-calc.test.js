import { describe, it, expect, beforeEach } from 'vitest';
import { getUnitAt, getPlayerUnitAt, getEnemyUnitAt, isAtWarWith } from '../src/combat.js';
import { setupGameState, makeUnit } from './fixtures.js';

describe('getUnitAt', () => {
  beforeEach(() => {
    setupGameState({
      units: [
        makeUnit({ id: 1, col: 5, row: 5, owner: 'player' }),
        makeUnit({ id: 2, col: 10, row: 10, owner: 'emperor_valerian' }),
      ],
    });
  });

  it('finds a unit at the given coordinates', () => {
    const unit = getUnitAt(5, 5);
    expect(unit).toBeDefined();
    expect(unit.id).toBe(1);
  });

  it('returns undefined when no unit is at coordinates', () => {
    expect(getUnitAt(0, 0)).toBeUndefined();
  });

  it('finds AI units too', () => {
    const unit = getUnitAt(10, 10);
    expect(unit.owner).toBe('emperor_valerian');
  });
});

describe('getPlayerUnitAt', () => {
  beforeEach(() => {
    setupGameState({
      units: [
        makeUnit({ id: 1, col: 5, row: 5, owner: 'player' }),
        makeUnit({ id: 2, col: 10, row: 10, owner: 'emperor_valerian' }),
      ],
    });
  });

  it('finds player unit', () => {
    const unit = getPlayerUnitAt(5, 5);
    expect(unit).toBeDefined();
    expect(unit.owner).toBe('player');
  });

  it('does not find AI units', () => {
    expect(getPlayerUnitAt(10, 10)).toBeUndefined();
  });
});

describe('getEnemyUnitAt', () => {
  beforeEach(() => {
    setupGameState({
      units: [
        makeUnit({ id: 1, col: 5, row: 5, owner: 'player' }),
        makeUnit({ id: 2, col: 10, row: 10, owner: 'emperor_valerian' }),
      ],
    });
  });

  it('finds enemy unit', () => {
    const unit = getEnemyUnitAt(10, 10);
    expect(unit).toBeDefined();
    expect(unit.owner).toBe('emperor_valerian');
  });

  it('does not find player units', () => {
    expect(getEnemyUnitAt(5, 5)).toBeUndefined();
  });
});

describe('isAtWarWith', () => {
  it('returns false when no wars exist', () => {
    setupGameState({ aiWars: [] });
    expect(isAtWarWith('emperor_valerian')).toBe(false);
  });

  it('returns true when player declared war on faction', () => {
    setupGameState({
      aiWars: [{ attacker: 'player', defender: 'emperor_valerian', startTurn: 1 }],
    });
    expect(isAtWarWith('emperor_valerian')).toBe(true);
  });

  it('returns true when faction declared war on player', () => {
    setupGameState({
      aiWars: [{ attacker: 'emperor_valerian', defender: 'player', startTurn: 1 }],
    });
    expect(isAtWarWith('emperor_valerian')).toBe(true);
  });

  it('returns false for unrelated wars', () => {
    setupGameState({
      aiWars: [{ attacker: 'shadow_kael', defender: 'emperor_valerian', startTurn: 1 }],
    });
    expect(isAtWarWith('emperor_valerian')).toBe(false);
  });

  it('handles missing aiWars gracefully', () => {
    setupGameState({ aiWars: undefined });
    expect(isAtWarWith('emperor_valerian')).toBe(false);
  });
});
