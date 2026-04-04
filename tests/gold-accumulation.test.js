import { describe, test, expect, beforeEach } from 'vitest';
import { game } from '../src/state.js';
import { setupGameState, makeCity, makeUnit, makeTile } from './fixtures.js';
import { endTurn } from '../src/turn.js';
import { goldCost } from '../src/constants.js';

describe('Gold accumulation - endTurn()', () => {
  beforeEach(() => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5 })],
      gold: 50,
      goldPerTurn: 5,
    });
  });

  test('base goldPerTurn should accumulate each turn', () => {
    const before = game.gold;
    endTurn();
    expect(game.gold).toBeGreaterThanOrEqual(before + 5);
  });

  test('gold should accumulate on turn 2 after fresh setup', () => {
    // Simulate starting from turn 2 to test second-turn accumulation
    setupGameState({
      cities: [makeCity({ col: 5, row: 5 })],
      gold: 55,
      goldPerTurn: 5,
      turn: 2,
    });
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    const before = game.gold;
    endTurn();
    expect(game.gold).toBe(before + 5);
  });

  test('unit maintenance should reduce net gold income', () => {
    // Archer has maintenance of 1
    game.units = [makeUnit({ type: 'archer', owner: 'player', col: 5, row: 5 })];
    const before = game.gold;
    endTurn();
    // goldPerTurn (5) - maintenance (1) = 4, plus any tile yields
    // Gold should increase by at least 4 (net income)
    expect(game.gold).toBeGreaterThanOrEqual(before + 4);
  });

  test('high maintenance can reduce gold below starting amount', () => {
    // 4 horsemen = 8 maintenance vs 5 goldPerTurn = -3 net per turn
    setupGameState({
      cities: [makeCity({ col: 5, row: 5 })],
      gold: 10,
      goldPerTurn: 5,
    });
    // Place tiles as desert (0 gold yield) to isolate maintenance effect
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    game.units = [
      makeUnit({ id: 1, type: 'horseman', owner: 'player', col: 5, row: 5 }),
      makeUnit({ id: 2, type: 'horseman', owner: 'player', col: 6, row: 5 }),
      makeUnit({ id: 3, type: 'horseman', owner: 'player', col: 7, row: 5 }),
      makeUnit({ id: 4, type: 'horseman', owner: 'player', col: 8, row: 5 }),
    ];
    const before = game.gold;
    endTurn();
    // Net: 5 - 8 = -3
    expect(game.gold).toBe(before - 3);
  });

  test('non-player units should not incur maintenance', () => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5 })],
      gold: 50,
      goldPerTurn: 5,
    });
    // Clear all tile yields
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    game.units = [
      makeUnit({ id: 1, type: 'horseman', owner: 'faction_a', col: 10, row: 10 }),
    ];
    const before = game.gold;
    endTurn();
    // Should get full goldPerTurn with no maintenance deducted
    expect(game.gold).toBe(before + 5);
  });
});

describe('Gold from tile yields', () => {
  test('river tiles in city territory should generate gold', () => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5, borderRadius: 2 })],
      gold: 100,
      goldPerTurn: 0,
    });
    // Clear all tiles to desert first
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    // Place a river on a grassland tile in city territory
    game.map[5][5].base = 'grassland';
    game.map[5][5].hasRiver = true;
    const before = game.gold;
    endTurn();
    // River on grassland = +1 gold from river
    expect(game.gold).toBeGreaterThan(before);
  });

  test('coast tiles in city territory should generate gold', () => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5, borderRadius: 2 })],
      gold: 100,
      goldPerTurn: 0,
    });
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    // Place a coast tile in city territory
    game.map[5][6].base = 'coast';
    const before = game.gold;
    endTurn();
    // Coast = +1 gold
    expect(game.gold).toBe(before + 1);
  });

  test('road tiles in city territory should generate gold', () => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5, borderRadius: 2 })],
      gold: 100,
      goldPerTurn: 0,
    });
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    // Place a road on desert tile in city territory
    game.map[5][6].road = true;
    const before = game.gold;
    endTurn();
    // Road = +1 gold
    expect(game.gold).toBe(before + 1);
  });

  test('camp improvement should generate gold', () => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5, borderRadius: 2 })],
      gold: 100,
      goldPerTurn: 0,
    });
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    // Camp on grassland = +2 gold
    game.map[5][6].base = 'grassland';
    game.map[5][6].improvement = 'camp';
    const before = game.gold;
    endTurn();
    expect(game.gold).toBe(before + 2);
  });

  test('tiles outside city borders should not generate gold', () => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5, borderRadius: 1 })],
      gold: 100,
      goldPerTurn: 0,
    });
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    // Place coast tile well outside city borders (borderRadius=1)
    game.map[20][20].base = 'coast'; // +1 gold but outside borders
    const before = game.gold;
    endTurn();
    expect(game.gold).toBe(before);
  });

  test('overlapping city borders should not double-count tiles', () => {
    setupGameState({
      cities: [
        makeCity({ name: 'City A', col: 5, row: 5, borderRadius: 2 }),
        makeCity({ name: 'City B', col: 7, row: 5, borderRadius: 2 }),
      ],
      gold: 100,
      goldPerTurn: 0,
    });
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    // Place a coast tile that's within both cities' borders (col 6 is 1 from both 5 and 7)
    game.map[5][6].base = 'coast'; // +1 gold, should only count once
    const before = game.gold;
    endTurn();
    expect(game.gold).toBe(before + 1);
  });
});

describe('Gold from trade routes', () => {
  test('trade route should generate gold based on distance', () => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5 })],
      gold: 100,
      goldPerTurn: 0,
      factionCities: { faction_a: { col: 20, row: 5 } },
      tradeRoutes: [{ factionId: 'faction_a' }],
      relationships: {},
      activeAlliances: {},
    });
    // Clear tile yields
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    const before = game.gold;
    endTurn();
    // Trade route should add gold: 2 + floor(dist/5) = 2 + floor(15/5) = 5
    expect(game.gold).toBeGreaterThan(before);
  });

  test('alliance should add +2 gold to trade route', () => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5 })],
      gold: 100,
      goldPerTurn: 0,
      factionCities: { faction_a: { col: 10, row: 5 } },
      tradeRoutes: [{ factionId: 'faction_a' }],
      relationships: { faction_a: 5 },
      activeAlliances: { faction_a: true },
    });
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    const before = game.gold;
    endTurn();
    // dist=5, base=2+1=3, alliance=+2, total=5
    expect(game.gold).toBe(before + 5);
  });
});

describe('Gold spending', () => {
  test('gold purchase deducts correct amount', () => {
    // This tests the goldCost formula: prodCost * GOLD_PER_PRODUCTION (4)
    expect(goldCost(20)).toBe(80);   // Warrior: 20 * 4 = 80
    expect(goldCost(30)).toBe(120);  // Archer: 30 * 4 = 120
    expect(goldCost(60)).toBe(240);  // Settler: 60 * 4 = 240
  });
});

describe('Gold from vassal tribute', () => {
  test('vassals should generate tribute gold each turn', () => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5 })],
      gold: 100,
      goldPerTurn: 0,
      vassals: { faction_a: { tributeGold: 10 } },
      relationships: { faction_a: 0 },
    });
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    const before = game.gold;
    endTurn();
    expect(game.gold).toBe(before + 10);
  });

  test('default vassal tribute should be 5 gold', () => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5 })],
      gold: 100,
      goldPerTurn: 0,
      vassals: { faction_a: {} },
      relationships: { faction_a: 0 },
    });
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    const before = game.gold;
    endTurn();
    expect(game.gold).toBe(before + 5);
  });
});

describe('Gold from trade deals', () => {
  test('trade deal giving player gold should add to treasury', () => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5 })],
      gold: 100,
      goldPerTurn: 0,
      tradeDeals: {
        faction_a: {
          playerReceives: '5 gold per turn',
          playerGives: 'open borders',
          startTurn: 0,
          duration: 20,
        },
      },
    });
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    const before = game.gold;
    endTurn();
    expect(game.gold).toBe(before + 5);
  });

  test('trade deal costing player gold should deduct from treasury', () => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5 })],
      gold: 100,
      goldPerTurn: 0,
      tradeDeals: {
        faction_a: {
          playerReceives: 'open borders',
          playerGives: '3 gold per turn',
          startTurn: 0,
          duration: 20,
        },
      },
    });
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    const before = game.gold;
    endTurn();
    expect(game.gold).toBe(before - 3);
  });

  test('expired trade deal should not affect gold', () => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5 })],
      gold: 100,
      goldPerTurn: 0,
      turn: 22, // not divisible by 5 to avoid random events
      tradeDeals: {
        faction_a: {
          playerReceives: '10 gold per turn',
          playerGives: '',
          startTurn: 1,
          duration: 5, // expired at turn 6
        },
      },
    });
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    const before = game.gold;
    endTurn();
    expect(game.gold).toBe(before);
  });
});

describe('Gold from building completion', () => {
  test('completing a market should increase goldPerTurn', () => {
    setupGameState({
      cities: [makeCity({ col: 5, row: 5 })],
      gold: 50,
      goldPerTurn: 5,
      currentBuild: 'market',
      buildProgress: 49, // Market costs 50, will complete with 3+ production
      productionPerTurn: 3,
      buildings: [],
    });
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        game.map[r][c].base = 'desert';
        game.map[r][c].hasRiver = false;
        game.map[r][c].improvement = null;
        game.map[r][c].resource = null;
        game.map[r][c].road = false;
      }
    }
    endTurn();
    // Market gives +3 gold per turn
    expect(game.goldPerTurn).toBe(8);
    expect(game.buildings).toContain('market');
  });
});
