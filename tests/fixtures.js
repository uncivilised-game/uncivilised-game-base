/**
 * Test fixtures — factory functions for game objects.
 * Use these to build minimal, valid test data without repeating boilerplate.
 */

import { MAP_COLS, MAP_ROWS } from '../src/constants.js';
import { setGame } from '../src/state.js';

// ── Tile ──

export function makeTile(overrides = {}) {
  return {
    base: 'grassland',
    feature: null,
    elevation: 0.5,
    resource: null,
    improvement: null,
    improvementProgress: 0,
    improvementBuilder: null,
    road: false,
    hasRiver: false,
    riverEdges: [],
    naturalWonder: null,
    col: 5,
    row: 5,
    ...overrides,
  };
}

// ── Unit ──

export function makeUnit(overrides = {}) {
  return {
    id: 1,
    type: 'warrior',
    col: 5,
    row: 5,
    owner: 'player',
    hp: 100,
    moveLeft: 2,
    combat: 20,
    fortified: false,
    sleeping: false,
    alert: false,
    xp: 0,
    promotions: [],
    pendingPromotion: false,
    hasAttackedThisTurn: false,
    ...overrides,
  };
}

// ── City ──

export function makeCity(overrides = {}) {
  return {
    name: 'Test City',
    col: 5,
    row: 5,
    buildings: [],
    population: 1000,
    borderRadius: 2,
    cultureAccum: 0,
    food: 0,
    wallHP: 0,
    wallMaxHP: 0,
    wallLastAttackedTurn: -99,
    amenityBalance: 0,
    amenityStatus: 'CONTENT',
    amenityMod: 0,
    amenityRequired: 0,
    amenityFromLuxuries: 0,
    amenityFromBuildings: 0,
    amenityFromAlliance: 0,
    ...overrides,
  };
}

// ── Minimal game state ──

/**
 * Creates a minimal game state object.
 * @param {object} overrides — merged into the returned state
 * @param {object} [options] — { cols, rows } to override map dimensions
 *
 * Note: hex functions use MAP_COLS/MAP_ROWS constants for wrapping,
 * so a custom map size is useful for state-only tests but may cause
 * issues with hex coordinate functions.
 */
export function makeGameState(overrides = {}, { cols = MAP_COLS, rows = MAP_ROWS } = {}) {
  const map = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => makeTile({ col: c, row: r }))
  );

  return {
    turn: 1,
    gold: 50,
    goldPerTurn: 5,
    science: 0,
    sciencePerTurn: 3,
    food: 0,
    foodPerTurn: 5,
    production: 0,
    productionPerTurn: 3,
    culture: 0,
    culturePerTurn: 1,
    military: 0,
    defense: 0,
    population: 1000,
    score: 0,
    map,
    fogOfWar: Array.from({ length: rows }, () => Array(cols).fill(false)),
    cities: [],
    factionCities: {},
    units: [],
    selectedUnitId: null,
    techs: [],
    currentResearch: null,
    researchProgress: 0,
    revealedResources: [],
    factionRevealedResources: {},
    civics: [],
    currentCivic: null,
    civicProgress: 0,
    civicProgressMap: {},
    buildings: [],
    currentBuild: null,
    buildProgress: 0,
    currentUnitBuild: null,
    unitBuildProgress: 0,
    wonders: [],
    currentWonderBuild: null,
    wonderBuildProgress: 0,
    builtWonders: {},
    aiWonderProgress: {},
    government: 'chiefdom',
    governmentCooldown: 0,
    greatPeopleProgress: { science: 0, production: 0, gold: 0, military: 0, culture: 0 },
    greatPeopleEarned: [],
    pantheon: null,
    religion: null,
    relationships: {},
    metFactions: {},
    factionStats: {},
    openBorders: {},
    embargoes: {},
    ceasefires: {},
    vassals: {},
    nonAggressionPacts: {},
    tradeRoutes: [],
    maxTradeRoutes: 1,
    tradeDeals: {},
    aiFactions: {},
    aiFactionCities: {},
    aiRelations: {},
    aiWars: [],
    aiAlliances: [],
    aiCommitments: [],
    activeEvents: [],
    minorFactions: [],
    tribalVillages: [],
    barbarianCamps: [],
    gameLog: [],
    happiness: 5,
    appliedMods: [],
    combatBonuses: [],
    yieldBonuses: [],
    eurekas: [],
    inspirations: [],
    barbarianKills: 0,
    mineCount: 0,
    improvementCount: 0,
    techProgress: {},
    envoys: 1,
    maxEnvoys: 1,
    reputation: {},
    activeAlliances: {},
    defensePacts: {},
    diplomaticLedger: {},
    marriages: {},
    ...overrides,
  };
}

/**
 * Sets up game state on the imported `game` reference from state.js.
 * Use in beforeEach() for tests that need global game state.
 */
export function setupGameState(overrides = {}, options = {}) {
  const state = makeGameState(overrides, options);
  setGame(state);
  return state;
}
