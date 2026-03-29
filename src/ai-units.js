// ============================================
// AI UNIT SPAWNING, MOVEMENT & CITY DEFENCE
// ============================================
// Gives AI factions actual units on the map that move, fight, and defend.
// Previously AI wars were purely stat-based attrition. This module adds
// tactical presence: AI cities spawn garrisons, factions build armies
// during wars, and units move toward targets.

import { UNIT_TYPES, FACTIONS, FACTION_TRAITS, MAP_COLS, MAP_ROWS } from './constants.js';
import { game } from './state.js';
import { hexDistance, getHexNeighbors } from './hex.js';
import { getTileMoveCost, isTilePassable } from './map.js';
import { resolveCombat, getUnitAt } from './combat.js';
import { createUnit } from './units.js';
import { addEvent, logAction } from './events.js';
import { getAIWars } from './ai-diplomacy.js';

// ============================================
// CONFIGURATION
// ============================================
const AI_MAX_UNITS_PER_FACTION = 8;  // Cap to avoid performance issues
const AI_SPAWN_COOLDOWN = 3;         // Minimum turns between spawns per faction
const AI_GARRISON_TYPES = ['warrior', 'archer', 'spearman'];
const AI_ARMY_TYPES = ['warrior', 'archer', 'spearman', 'chariot', 'horseman'];

// ============================================
// INITIALISATION
// ============================================
export function initAIUnits() {
  if (!game.aiUnitState) game.aiUnitState = {};
  for (const fid of Object.keys(FACTIONS)) {
    if (!game.aiUnitState[fid]) {
      game.aiUnitState[fid] = { lastSpawnTurn: -99 };
    }
  }
}

// ============================================
// MAIN ENTRY POINT — called each turn from endTurn()
// ============================================
export function processAIUnitTurns() {
  initAIUnits();

  for (const fid of Object.keys(FACTIONS)) {
    const traits = FACTION_TRAITS[fid];
    if (!traits) continue;
    const stats = game.factionStats?.[fid];
    if (!stats) continue;

    const factionUnits = game.units.filter(u => u.owner === fid);
    const city = game.factionCities?.[fid];
    if (!city) continue;

    // --- 1. CITY DEFENCE: ensure garrison ---
    ensureGarrison(fid, city, factionUnits, traits);

    // --- 2. WARTIME SPAWNING: produce military units when at war ---
    const wars = getActiveWarsFor(fid);
    if (wars.length > 0 && factionUnits.length < AI_MAX_UNITS_PER_FACTION) {
      spawnWarUnits(fid, city, factionUnits, stats, traits, wars);
    }

    // --- 3. MOVE UNITS: advance toward targets ---
    for (const unit of factionUnits) {
      processAIUnitMove(unit, fid, wars);
    }

    // --- 4. RESET MOVEMENT for next turn ---
    for (const unit of factionUnits) {
      const ut = UNIT_TYPES[unit.type];
      if (ut) {
        unit.moveLeft = ut.movePoints;
        unit.hasAttackedThisTurn = false;
      }
    }
  }
}

// ============================================
// GARRISON LOGIC
// ============================================
function ensureGarrison(fid, city, factionUnits, traits) {
  // Check if there's a unit in or adjacent to the city
  const garrisonUnit = factionUnits.find(u =>
    hexDistance(u.col, u.row, city.col, city.row) <= 1
  );
  if (garrisonUnit) return; // Already garrisoned

  // Spawn a garrison unit next to the city
  const garrisonType = pickUnitType(AI_GARRISON_TYPES, traits);
  const spawnHex = findSpawnHex(city.col, city.row);
  if (!spawnHex) return;

  const unit = createUnit(garrisonType, spawnHex.col, spawnHex.row, fid);
  unit.moveLeft = 0; // Can't move this turn
  unit._role = 'garrison'; // Tag for AI movement decisions
  game.units.push(unit);
}

// ============================================
// WARTIME UNIT PRODUCTION
// ============================================
function spawnWarUnits(fid, city, factionUnits, stats, traits, wars) {
  const state = game.aiUnitState[fid];
  if (game.turn - state.lastSpawnTurn < AI_SPAWN_COOLDOWN) return;

  // Military-oriented factions spawn more aggressively
  const militaryBias = traits.military || 0.5;
  const spawnChance = 0.3 + militaryBias * 0.3;
  if (Math.random() > spawnChance) return;

  // Pick unit type based on available tech level (approximated by faction stats)
  const availableTypes = AI_ARMY_TYPES.filter(t => {
    const ut = UNIT_TYPES[t];
    if (!ut) return false;
    // Higher-tier units require more accumulated gold/military
    if (t === 'horseman' && (stats.military || 0) < 20) return false;
    if (t === 'chariot' && (stats.military || 0) < 10) return false;
    return true;
  });

  const unitType = pickUnitType(availableTypes, traits);
  const spawnHex = findSpawnHex(city.col, city.row);
  if (!spawnHex) return;

  const unit = createUnit(unitType, spawnHex.col, spawnHex.row, fid);
  unit.moveLeft = 0;
  unit._role = 'army';
  game.units.push(unit);
  state.lastSpawnTurn = game.turn;

  // Deduct from faction military stat (represents investment)
  stats.military = Math.max(0, (stats.military || 0) - 2);
}

// ============================================
// AI UNIT MOVEMENT
// ============================================
function processAIUnitMove(unit, fid, wars) {
  if (unit.moveLeft <= 0) return;
  const ut = UNIT_TYPES[unit.type];
  if (!ut || ut.class === 'civilian') return;

  // Garrison units stay near their city
  if (unit._role === 'garrison') {
    const city = game.factionCities?.[fid];
    if (city && hexDistance(unit.col, unit.row, city.col, city.row) > 2) {
      moveToward(unit, city.col, city.row);
    }
    return;
  }

  // Army units: find a target
  const target = findTarget(unit, fid, wars);
  if (!target) return;

  // If adjacent to target, attack
  const dist = hexDistance(unit.col, unit.row, target.col, target.row);
  if (dist <= 1 && !unit.hasAttackedThisTurn) {
    // Check if there's an enemy unit there
    const enemy = game.units.find(u =>
      u.col === target.col && u.row === target.row && u.owner !== fid
    );
    if (enemy) {
      try {
        const result = resolveCombat(unit, enemy);
        if (result.defenderDied) {
          game.units = game.units.filter(u => u.id !== enemy.id);
        }
        if (result.attackerDied) {
          game.units = game.units.filter(u => u.id !== unit.id);
        }
        unit.hasAttackedThisTurn = true;
      } catch (e) {
        console.error('AI combat error:', e);
      }
      return;
    }
  }

  // Move toward target
  if (dist > 1) {
    moveToward(unit, target.col, target.row);
  }
}

function findTarget(unit, fid, wars) {
  // Priority 1: enemy units near our cities (defensive)
  const myCity = game.factionCities?.[fid];
  if (myCity) {
    const nearbyEnemy = game.units.find(u =>
      u.owner !== fid && u.owner !== 'player' &&
      hexDistance(u.col, u.row, myCity.col, myCity.row) <= 4 &&
      getActiveWarsFor(fid).some(w => w.attacker === u.owner || w.defender === u.owner)
    );
    if (nearbyEnemy) return { col: nearbyEnemy.col, row: nearbyEnemy.row };
  }

  // Priority 2: enemy cities we're at war with
  for (const war of wars) {
    const enemyFid = war.attacker === fid ? war.defender : war.attacker;
    const enemyCity = game.factionCities?.[enemyFid];
    if (enemyCity) return { col: enemyCity.col, row: enemyCity.row };
  }

  // Priority 3: player units/cities if at war with player
  const atWarWithPlayer = wars.some(w => w.attacker === 'player' || w.defender === 'player');
  if (atWarWithPlayer && game.cities.length > 0) {
    return { col: game.cities[0].col, row: game.cities[0].row };
  }

  return null;
}

function moveToward(unit, targetCol, targetRow) {
  const neighbors = getHexNeighbors(unit.col, unit.row);
  let bestHex = null;
  let bestDist = hexDistance(unit.col, unit.row, targetCol, targetRow);

  for (const nb of neighbors) {
    if (nb.row < 0 || nb.row >= MAP_ROWS || nb.col < 0 || nb.col >= MAP_COLS) continue;
    const tile = game.map[nb.row]?.[nb.col];
    if (!tile || !isTilePassable(tile)) continue;
    const cost = getTileMoveCost(tile);
    if (cost >= 99 || cost > unit.moveLeft) continue;
    // Don't move onto occupied hexes
    if (getUnitAt(nb.col, nb.row)) continue;
    const dist = hexDistance(nb.col, nb.row, targetCol, targetRow);
    if (dist < bestDist) {
      bestDist = dist;
      bestHex = nb;
    }
  }

  if (bestHex) {
    unit.col = bestHex.col;
    unit.row = bestHex.row;
    unit.moveLeft = 0; // Simplified: AI uses all movement per step
  }
}

// ============================================
// AI-TO-AI DIPLOMACY: RICHER TRIGGERS
// ============================================
export function processEnhancedAIDiplomacy() {
  if (!game.aiSecretPacts) return;

  for (const pact of game.aiSecretPacts) {
    if (pact.activated) continue;

    // NEW TRIGGER: activate if target just lost a war
    if (pact.activationCondition === 'target_weakened') {
      const statsT = game.factionStats?.[pact.target];
      if (statsT && (statsT.military || 0) < 5) {
        pact.activationCondition = 'military_ready'; // Convert to standard trigger
      }
    }

    // NEW TRIGGER: activate if player allied with the target
    if (pact.activationCondition === 'player_allied_target') {
      if (game.activeAlliances?.[pact.target]) {
        pact.activationCondition = 'military_ready';
      }
    }
  }
}

// ============================================
// AI TRADE DEAL VISIBLE IMPACT
// ============================================
export function processAITradeVisibleEffects() {
  if (!game.aiTradeDeals) return;

  for (const deal of game.aiTradeDeals) {
    for (const fid of deal.factions) {
      const stats = game.factionStats?.[fid];
      if (!stats) continue;

      // Trade deals boost faction growth visibly
      // Gold from trade → military investment (every 5 turns)
      if (game.turn % 5 === 0 && (stats.gold || 0) > 80) {
        stats.military = (stats.military || 0) + 2;
        stats.gold = (stats.gold || 0) - 20;
      }

      // Population growth from trade prosperity
      const city = game.factionCities?.[fid];
      if (city && game.turn % 8 === 0) {
        city.population = (city.population || 1000) + 100;
      }
    }
  }
}

// ============================================
// HELPERS
// ============================================
function getActiveWarsFor(fid) {
  return (game.aiWars || []).filter(w => w.attacker === fid || w.defender === fid);
}

function pickUnitType(types, traits) {
  if (types.length === 0) return 'warrior';
  // Military factions prefer stronger units
  if (traits.archetype === 'militaristic') {
    // Sort by combat descending, pick from top
    const sorted = [...types].sort((a, b) => (UNIT_TYPES[b]?.combat || 0) - (UNIT_TYPES[a]?.combat || 0));
    return sorted[Math.floor(Math.random() * Math.min(2, sorted.length))];
  }
  return types[Math.floor(Math.random() * types.length)];
}

function findSpawnHex(col, row) {
  const neighbors = getHexNeighbors(col, row);
  // Shuffle to avoid always spawning in the same hex
  for (let i = neighbors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [neighbors[i], neighbors[j]] = [neighbors[j], neighbors[i]];
  }
  for (const nb of neighbors) {
    if (nb.row < 0 || nb.row >= MAP_ROWS || nb.col < 0 || nb.col >= MAP_COLS) continue;
    const tile = game.map[nb.row]?.[nb.col];
    if (!tile || !isTilePassable(tile)) continue;
    if (getUnitAt(nb.col, nb.row)) continue;
    return nb;
  }
  return null;
}
