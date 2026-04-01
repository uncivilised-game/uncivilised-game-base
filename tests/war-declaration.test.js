import { describe, test, expect, beforeEach, vi } from 'vitest';
import { setupGameState, makeUnit } from './fixtures.js';
import { game } from '../src/state.js';

// Mock modules that touch the DOM
vi.mock('../src/leaderboard.js', () => ({ updateUI: vi.fn() }));
vi.mock('../src/render.js', () => ({ render: vi.fn(), markVisibilityDirty: vi.fn() }));
vi.mock('../src/discovery.js', () => ({ revealAround: vi.fn() }));
vi.mock('../src/feedback.js', () => ({ startAnimLoop: vi.fn() }));
vi.mock('../src/input.js', () => ({ panCameraTo: vi.fn() }));

import { isAtWarWith, declareSurpriseWar, confirmAndDeclareWar } from '../src/combat.js';

describe('isAtWarWith()', () => {
  beforeEach(() => {
    setupGameState({ aiWars: [] });
  });

  test('should return false when not at war', () => {
    expect(isAtWarWith('faction_a')).toBe(false);
  });

  test('should return true when player is attacker', () => {
    game.aiWars.push({ attacker: 'player', defender: 'faction_a', startTurn: 1, turnsActive: 0 });
    expect(isAtWarWith('faction_a')).toBe(true);
  });

  test('should return true when player is defender', () => {
    game.aiWars.push({ attacker: 'faction_a', defender: 'player', startTurn: 1, turnsActive: 0 });
    expect(isAtWarWith('faction_a')).toBe(true);
  });
});

describe('declareSurpriseWar()', () => {
  beforeEach(() => {
    setupGameState({
      aiWars: [],
      relationships: { faction_a: 0, faction_b: 10 },
      activeAlliances: { faction_a: true },
      tradeDeals: { faction_a: { gold: 5 } },
      ceasefires: { faction_a: { startTurn: 1, duration: 10 } },
      nonAggressionPacts: {},
      defensePacts: {},
      aiAlliances: [],
    });
  });

  test('should add war entry to aiWars', () => {
    declareSurpriseWar('faction_a', 'Test Faction');
    expect(game.aiWars.length).toBe(1);
    expect(game.aiWars[0].attacker).toBe('player');
    expect(game.aiWars[0].defender).toBe('faction_a');
  });

  test('should not double-declare war', () => {
    declareSurpriseWar('faction_a', 'Test Faction');
    declareSurpriseWar('faction_a', 'Test Faction');
    expect(game.aiWars.length).toBe(1);
  });

  test('should break all agreements with target faction', () => {
    declareSurpriseWar('faction_a', 'Test Faction');
    expect(game.activeAlliances.faction_a).toBeUndefined();
    expect(game.tradeDeals.faction_a).toBeUndefined();
    expect(game.ceasefires.faction_a).toBeUndefined();
  });

  test('should pull in allies of the target faction', () => {
    game.aiAlliances = [{ factions: ['faction_a', 'faction_b'], turn: 1 }];
    declareSurpriseWar('faction_a', 'Test Faction');
    // faction_b should also be at war with player now
    expect(isAtWarWith('faction_b')).toBe(true);
  });

  test('should not pull in allies already at war', () => {
    game.aiAlliances = [{ factions: ['faction_a', 'faction_b'], turn: 1 }];
    game.aiWars.push({ attacker: 'faction_b', defender: 'player', startTurn: 1, turnsActive: 0 });
    declareSurpriseWar('faction_a', 'Test Faction');
    // Should only have the existing war + the new one, not a duplicate for faction_b
    const bWars = game.aiWars.filter(w =>
      (w.attacker === 'faction_b' && w.defender === 'player') ||
      (w.attacker === 'player' && w.defender === 'faction_b')
    );
    expect(bWars.length).toBe(1);
  });

  test('should break agreements with pulled-in allies', () => {
    game.aiAlliances = [{ factions: ['faction_a', 'faction_b'], turn: 1 }];
    game.activeAlliances.faction_b = true;
    game.ceasefires.faction_b = { startTurn: 1, duration: 10 };
    declareSurpriseWar('faction_a', 'Test Faction');
    expect(game.activeAlliances.faction_b).toBeUndefined();
    expect(game.ceasefires.faction_b).toBeUndefined();
  });

  test('should damage relationships with pulled-in allies', () => {
    game.aiAlliances = [{ factions: ['faction_a', 'faction_b'], turn: 1 }];
    game.relationships.faction_b = 10;
    declareSurpriseWar('faction_a', 'Test Faction');
    expect(game.relationships.faction_b).toBeLessThanOrEqual(-30);
  });
});

describe('confirmAndDeclareWar()', () => {
  beforeEach(() => {
    setupGameState({
      aiWars: [],
      relationships: { faction_a: 0 },
      activeAlliances: {},
      tradeDeals: {},
      ceasefires: {},
      nonAggressionPacts: {},
      defensePacts: {},
      aiAlliances: [],
    });
  });

  test('should return true if already at war (no confirmation needed)', () => {
    game.aiWars.push({ attacker: 'player', defender: 'faction_a', startTurn: 1, turnsActive: 0 });
    const result = confirmAndDeclareWar('faction_a');
    expect(result).toBe(true);
  });

  test('should return false if user declines confirmation', () => {
    globalThis.confirm = vi.fn(() => false);
    const result = confirmAndDeclareWar('faction_a');
    expect(result).toBe(false);
    expect(isAtWarWith('faction_a')).toBe(false);
  });

  test('should declare war if user confirms', () => {
    globalThis.confirm = vi.fn(() => true);
    const result = confirmAndDeclareWar('faction_a');
    expect(result).toBe(true);
    expect(isAtWarWith('faction_a')).toBe(true);
  });

  test('should mention allies in confirmation message', () => {
    game.aiAlliances = [{ factions: ['faction_a', 'faction_b'], turn: 1 }];
    globalThis.confirm = vi.fn(() => true);
    confirmAndDeclareWar('faction_a');
    const msg = globalThis.confirm.mock.calls[0][0];
    expect(msg).toContain('allies');
  });

  test('should mention agreements in confirmation message', () => {
    game.activeAlliances.faction_a = true;
    game.ceasefires.faction_a = { startTurn: 1, duration: 10 };
    globalThis.confirm = vi.fn(() => true);
    confirmAndDeclareWar('faction_a');
    const msg = globalThis.confirm.mock.calls[0][0];
    expect(msg).toContain('Alliance');
    expect(msg).toContain('Ceasefire');
  });
});
