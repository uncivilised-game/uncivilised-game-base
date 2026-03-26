import { UNIT_TYPES, UNIT_UNLOCKS, BUILDINGS, TECHNOLOGIES, RESOURCES, FACTIONS, GAME_VERSION, SAVE_KEY } from './constants.js';
import { game, safeStorage, API, setGame, setNextUnitId } from './state.js';
import { updateActiveGameProgress } from './leaderboard.js';
import { showToast } from './events.js';

function migrateTiles(state) {
  if (!state.tradeRoutes) state.tradeRoutes = [];
  if (state.maxTradeRoutes === undefined) state.maxTradeRoutes = 1;
  if (state.happiness === undefined) state.happiness = 5;
  // Ensure units have promotion fields
  if (state.units) {
    for (const u of state.units) {
      if (u.xp === undefined) u.xp = 0;
      if (!u.promotions) u.promotions = [];
      if (u.pendingPromotion === undefined) u.pendingPromotion = false;
    }
  }

  if (!state.civics) state.civics = [];
  if (state.currentCivic === undefined) state.currentCivic = null;
  if (state.civicProgress === undefined) state.civicProgress = 0;
  if (state.culturePerTurn === undefined) state.culturePerTurn = 1;
  if (!state.greatPeopleProgress) state.greatPeopleProgress = { science: 0, production: 0, gold: 0, military: 0, culture: 0 };
  if (!state.greatPeopleEarned) state.greatPeopleEarned = [];
  if (state.pantheon === undefined) state.pantheon = null;
  if (state.religion === undefined) state.religion = null;

  if (!state.government) state.government = 'chiefdom';
  if (state.governmentCooldown === undefined) state.governmentCooldown = 0;
  if (!state.wonders) state.wonders = [];
  if (state.currentWonderBuild === undefined) state.currentWonderBuild = null;
  if (state.wonderBuildProgress === undefined) state.wonderBuildProgress = 0;

  if (state.currentUnitBuild === undefined) state.currentUnitBuild = null;
  if (state.unitBuildProgress === undefined) state.unitBuildProgress = 0;
  if (state.factionCities) {
    for (const fc of Object.values(state.factionCities)) {
      if (fc.hp === undefined) fc.hp = 100;
      if (fc.population === undefined) fc.population = 1000;
      if (fc.borderRadius === undefined) fc.borderRadius = 2;
      if (fc.improvements === undefined) fc.improvements = 0;
    }
  }
  // Ensure cities have per-city food field
  if (state.cities) {
    for (const city of state.cities) {
      if (city.food === undefined) city.food = 0;
    }
  }
  if (!state.aiFactions) state.aiFactions = {};
  if (!state.aiFactionCities) state.aiFactionCities = {};
  if (!state.barbarianCamps) state.barbarianCamps = [];
  if (!state.aiWonders) state.aiWonders = {};
  // Ensure every tile has col/row (missing in saves before v4)
  if (state.map) {
    for (let r = 0; r < state.map.length; r++) {
      for (let c = 0; c < state.map[r].length; c++) {
        state.map[r][c].col = c;
        if (state.map[r][c].naturalWonder === undefined) state.map[r][c].naturalWonder = null;
        state.map[r][c].row = r;
      }
    }
  }
  // Migrate v4 saves to v5 diplomacy fields
  if (!state.envoys && state.envoys !== 0) state.envoys = 1;
  if (!state.maxEnvoys) state.maxEnvoys = 1;
  if (!state.envoySpentThisTurn) state.envoySpentThisTurn = {};
  if (!state.messagesThisTurn) state.messagesThisTurn = 0;
  if (!state.openBorders) state.openBorders = {};
  if (!state.embargoes) state.embargoes = {};
  if (!state.ceasefires) state.ceasefires = {};
  if (!state.vassals) state.vassals = {};
  if (!state.nonAggressionPacts) state.nonAggressionPacts = {};
  if (!state.metFactions) state.metFactions = {};
  if (!state.factionStats) state.factionStats = {};
  // Ensure all met factions have stats (handles saves from before initFactionStats was called on discovery)
  for (const fid of Object.keys(state.metFactions)) {
    if (!state.factionStats[fid]) {
      const personalities = {
        emperor_valerian:          { gold: 60,  military: 18, science: 4, population: 1200, territory: 12, techs: 2, score: 40 },
        shadow_kael:               { gold: 45,  military: 12, science: 5, population: 900,  territory: 8,  techs: 3, score: 35 },
        merchant_prince_castellan: { gold: 80,  military: 8,  science: 3, population: 1100, territory: 10, techs: 2, score: 38 },
        pirate_queen_elara:        { gold: 55,  military: 15, science: 2, population: 800,  territory: 6,  techs: 1, score: 30 },
        commander_thane:           { gold: 40,  military: 22, science: 3, population: 1000, territory: 14, techs: 2, score: 42 },
        rebel_leader_sera:         { gold: 35,  military: 10, science: 4, population: 700,  territory: 5,  techs: 2, score: 28 },
      };
      const p = personalities[fid] || { gold: 50, military: 10, science: 3, population: 1000, territory: 8, techs: 2, score: 30 };
      state.factionStats[fid] = { ...p, lastUpdated: state.turn || 1 };
    }
  }
  if (!state.relationships) state.relationships = {};
  if (!state.activeAlliances) state.activeAlliances = {};
  if (!state.appliedMods) state.appliedMods = [];
  if (!state.combatBonuses) state.combatBonuses = [];
  if (!state.yieldBonuses) state.yieldBonuses = [];
  if (!state.activeEvents) state.activeEvents = [];
  if (!state.minorFactions) state.minorFactions = [];
  if (!state.gameLog) state.gameLog = [];
  if (!state.aiCommitments) state.aiCommitments = [];
  // --- Reputation system migration ---
  if (!state.reputation) {
    state.reputation = {};
    for (const fid of Object.keys(FACTIONS)) {
      state.reputation[fid] = { honour: 0, generosity: 0, menace: 0, reliability: 0, cunning: 0 };
    }
  }
  if (!state.diplomaticLedger) {
    state.diplomaticLedger = {};
    for (const fid of Object.keys(FACTIONS)) {
      state.diplomaticLedger[fid] = [];
    }
  }
  if (!state.diplomaticSummaries) {
    state.diplomaticSummaries = {};
    for (const fid of Object.keys(FACTIONS)) {
      state.diplomaticSummaries[fid] = null;
    }
  }

  // Re-inject any dynamically created content from mods
  restoreMods(state);
  return state;
}

function restoreMods(state) {
  if (!state.appliedMods || !state.appliedMods.length) return;
  for (const record of state.appliedMods) {
    const mod = record.mod;
    if (!mod) continue;
    switch (mod.type) {
      case 'new_unit':
        if (mod.id && mod.name && !UNIT_TYPES[mod.id]) {
          UNIT_TYPES[mod.id] = {
            name: mod.name, cost: mod.cost || 50, combat: mod.combat || 20,
            rangedCombat: mod.rangedCombat || 0, range: mod.range || 0,
            movePoints: mod.movePoints || 2, icon: mod.icon || '\u{2694}',
            class: mod.class || 'melee', desc: mod.desc || 'Modded unit',
          };
          UNIT_UNLOCKS[mod.id] = null;
        }
        break;
      case 'new_building':
        if (mod.id && mod.name && !BUILDINGS.find(b => b.id === mod.id)) {
          BUILDINGS.push({ id: mod.id, name: mod.name, cost: mod.cost || 60, desc: mod.desc || '', effect: mod.effect || {} });
        }
        break;
      case 'new_tech':
        if (mod.id && mod.name && !TECHNOLOGIES.find(t => t.id === mod.id)) {
          TECHNOLOGIES.push({ id: mod.id, name: mod.name, cost: mod.cost || 40, desc: mod.desc || '', unlocks: mod.unlocks || [] });
        }
        break;
      case 'new_resource':
        if (mod.id && mod.name && !RESOURCES[mod.id]) {
          RESOURCES[mod.id] = { name: mod.name, icon: mod.icon || '\u{2728}', color: mod.color || '#aaa', bonus: mod.bonus || { gold: 1 }, category: mod.category || 'luxury' };
        }
        break;
    }
  }
  console.log(`Restored ${state.appliedMods.length} mod(s) from save`);
}

async function autoSave() {
  // Save to local storage first (fast, works offline)
  try {
    const saveData = { version: GAME_VERSION, game_state: game, timestamp: Date.now() };
    safeStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
  } catch (e) {
    console.warn('Local storage save failed:', e);
    showToast('Save Warning', 'Local save failed \u2014 your progress may not persist if you close the browser.');
  }
  // Update competition progress
  updateActiveGameProgress();
  // Also save to API in background
  try {
    const res = await fetch(`${API}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-visitor-id': safeStorage.getItem('uncivilised_visitor_id') || 'anonymous' },
      body: JSON.stringify({ game_state: game }),
    });
    if (!res.ok) console.warn('API save returned', res.status);
  } catch (e) {
    console.warn('API auto-save failed:', e);
  }
}

function isValidGameState(state) {
  // Basic structural checks to prevent loading corrupt saves
  if (!state || typeof state !== 'object') return false;
  if (!Array.isArray(state.map) || state.map.length === 0) return false;
  if (!Array.isArray(state.units)) return false;
  if (!Array.isArray(state.cities)) return false;
  if (!Array.isArray(state.fogOfWar) || state.fogOfWar.length === 0) return false;
  // Verify map grid dimensions are sensible
  if (!Array.isArray(state.map[0]) || state.map[0].length === 0) return false;
  return true;
}

async function loadGame() {
  // Try local storage first
  try {
    const raw = safeStorage.getItem(SAVE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.game_state) {
        const state = migrateTiles(data.game_state);
        if (!isValidGameState(state)) {
          console.warn('Local save is corrupt, clearing it');
          safeStorage.removeItem(SAVE_KEY);
        } else {
          setGame(state);
          if (game.units && game.units.length > 0) {
            setNextUnitId(Math.max(...game.units.map(u => u.id)) + 1);
          }
          return true;
        }
      }
    }
  } catch (e) {
    console.warn('Storage load failed:', e);
  }
  // Fallback to API
  try {
    const res = await fetch(`${API}/api/load`, {
      headers: { 'x-visitor-id': safeStorage.getItem('uncivilised_visitor_id') || 'anonymous' },
    });
    const data = await res.json();
    if (data.found && data.game_state) {
      const state = migrateTiles(data.game_state);
      if (!isValidGameState(state)) {
        console.warn('API save is corrupt, ignoring');
      } else {
        setGame(state);
        if (game.units && game.units.length > 0) {
          setNextUnitId(Math.max(...game.units.map(u => u.id)) + 1);
        }
        return true;
      }
    }
  } catch (e) {
    console.warn('API load failed:', e);
  }
  return false;
}

export { migrateTiles, restoreMods, autoSave, loadGame };
