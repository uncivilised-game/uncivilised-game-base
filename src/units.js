import { MAP_COLS, MAP_ROWS, BASE_TERRAIN, UNIT_TYPES, UNIT_UPGRADES, UNIT_UNLOCKS, UNIT_PROMOTIONS, FACTIONS, FACTION_TRAITS, TILE_IMPROVEMENTS, ZOC_EXEMPT_CLASSES } from './constants.js';
import { game, getNextUnitId } from './state.js';
import { hexToPixel, pixelToHex, getHexNeighbors, hexDistance } from './hex.js';
import { getTileMoveCost, isTilePassable, crossesRiver, roadBridgesRiver } from './map.js';
import { resolveCombat, isAtWarWith, declareSurpriseWar, confirmAndDeclareWar, attackFactionCity, attackExpansionCity, checkCityCapture, getUnitAt, getPlayerUnitAt, getEnemyUnitAt, getCityAt, showBattlePanel, applyTacticModifier } from './combat.js';
import { showSelectionPanel, hideSelectionPanel, showCityPanel, showTileInfo, showCombatResult } from './ui-panels.js';
import { showWorkerActions, showSettlerActions, moveTowardWaypoint } from './improvements.js';
import { render, markVisibilityDirty } from './render.js';
import { addEvent, logAction, showToast, discoverVillage } from './events.js';
import { revealAround } from './discovery.js';
import { panCameraTo } from './input.js';
import { updateUI } from './leaderboard.js';
import { startAnimLoop } from './feedback.js';
import { MINOR_FACTION_TYPES, interactWithMinorFaction, interactWithBarbarianCamp } from './minor-factions.js';

function findNearestBarbarianCamp(col, row) {
  if (!game.barbarianCamps) return null;
  let best = null, bestDist = Infinity;
  for (const c of game.barbarianCamps) {
    if (c.destroyed) continue;
    const d = hexDistance(col, row, c.col, c.row);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

// ---- Civilian / Military stacking helpers ----

/** Returns true if the unit is a civilian (worker, settler, etc.) */
function isCivilian(unit) {
  const ut = UNIT_TYPES[unit.type];
  return ut && ut.class === 'civilian';
}

/** Returns true if the moving unit can stack on a tile that already has `existing` on it.
 *  Rule: one military + one civilian of the same owner may share a tile. */
function canStackWith(movingUnit, existingUnit) {
  if (movingUnit.owner !== existingUnit.owner) return false;       // must be same owner
  if (isCivilian(movingUnit) === isCivilian(existingUnit)) return false; // can't stack two of same class
  return true;
}

// ---- Territory helpers ----

/**
 * Returns the faction ID that owns the tile at (col, row), or null if unclaimed.
 * Checks player cities, faction capitals, and AI expansion cities.
 */
function getTileOwner(col, row) {
  // Player cities
  for (const city of (game.cities || [])) {
    if (hexDistance(col, row, city.col, city.row) <= (city.borderRadius || 2)) return 'player';
  }
  // Faction capital cities
  for (const [fid, fc] of Object.entries(game.factionCities || {})) {
    if (hexDistance(col, row, fc.col, fc.row) <= (fc.borderRadius || 2)) return fid;
  }
  // AI expansion cities
  if (game.aiFactionCities) {
    for (const [fid, cities] of Object.entries(game.aiFactionCities)) {
      for (const ec of cities) {
        if (hexDistance(col, row, ec.col, ec.row) <= (ec.borderRadius || 1)) return fid;
      }
    }
  }
  return null;
}

/**
 * Returns true if the given unit is NOT allowed to enter (col, row) due to
 * closed borders. At war or with open borders → entry allowed.
 */
function isTerritoryBlocked(unit, col, row) {
  const owner = getTileOwner(col, row);
  if (!owner) return false; // unclaimed land

  if (unit.owner === 'player') {
    if (owner === 'player') return false; // own territory
    // At war → can enter enemy territory
    if (isAtWarWith(owner)) return false;
    // Open borders → can enter
    if (game.openBorders && game.openBorders[owner]) return false;
    return true; // peace + no open borders → blocked
  }

  // AI unit
  if (owner === unit.owner) return false; // own territory
  if (owner === 'player') {
    // AI entering player territory — mirror the same check
    if (isAtWarWith(unit.owner)) return false;
    if (game.openBorders && game.openBorders[unit.owner]) return false;
    return true;
  }
  // AI entering another AI's territory — let AI-to-AI rules handle this
  return false;
}

/** Returns true if a hex is blocked for the given unit (can't enter or pass through) */
function isHexBlockedForUnit(unit, col, row) {
  // Territory restriction: can't enter foreign territory without open borders or war
  if (isTerritoryBlocked(unit, col, row)) return true;
  const occupants = game.units.filter(u => u.col === col && u.row === row && u.id !== unit.id);
  if (occupants.length === 0) return false;
  // If there's already a stack of 2, it's full
  if (occupants.length >= 2) return true;
  // One occupant — check if we can stack with them
  return !canStackWith(unit, occupants[0]);
}

// ---- Zone of Control helpers ----

/** Check if a hex is in an enemy's Zone of Control relative to a given faction */
function isInEnemyZOC(col, row, movingUnitOwner) {
  const neighbors = getHexNeighbors(col, row);
  for (const nb of neighbors) {
    const unitsOnTile = game.units.filter(u => u.col === nb.col && u.row === nb.row);
    for (const u of unitsOnTile) {
      if (u.owner !== movingUnitOwner) {
        const ut = UNIT_TYPES[u.type];
        if (ut && !ZOC_EXEMPT_CLASSES.includes(ut.class)) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Get all hexes currently in enemy ZOC for a given faction (for rendering) */
function getEnemyZOCHexes(factionId) {
  const zocSet = new Set();
  for (const u of game.units) {
    if (u.owner === factionId) continue;
    const ut = UNIT_TYPES[u.type];
    if (!ut || ZOC_EXEMPT_CLASSES.includes(ut.class)) continue;
    const neighbors = getHexNeighbors(u.col, u.row);
    for (const nb of neighbors) {
      zocSet.add(`${nb.col},${nb.row}`);
    }
  }
  return zocSet;
}

function createUnit(type, col, row, owner) {
  const ut = UNIT_TYPES[type];
  return {
    id: getNextUnitId(),
    type: type,
    col: col,
    row: row,
    owner: owner, // 'player' or faction ID string
    hp: 100,
    moveLeft: ut.movePoints,
    combat: ut.combat,
    fortified: false,
    sleeping: false,
    alert: false,
    xp: 0,
    promotions: [],
    pendingPromotion: false,
    ...(ut.buildCharges !== undefined ? { buildCharges: ut.buildCharges } : {}),
  };
}

function placeFactionCities(map, playerCol, playerRow, continentId, mainContinent) {
  const cities = {};
  // Reduce minDist to pack factions closer on the same landmass for demo diplomacy showcase
  const targets = Object.entries(FACTIONS).map(([id, f]) => ({
    id, name: f.city, minDist: 6 + Math.floor(Math.random() * 3), color: f.color,
  }));

  const placed = [{ col: playerCol, row: playerRow }];
  for (const t of targets) {
    let bestCol = -1, bestRow = -1, bestScore = -Infinity;
    // First pass: strict — must be on main continent
    for (let attempt = 0; attempt < 800; attempt++) {
      const c = 3 + Math.floor(Math.random() * (MAP_COLS - 6));
      const r = 3 + Math.floor(Math.random() * (MAP_ROWS - 6));
      const base = map[r][c].base;
      if (base === 'ocean' || base === 'coast' || base === 'lake' || base === 'snow') continue;
      if (map[r][c].feature === 'mountain') continue;
      // MUST be on the SAME CONTINENT as the player
      if (continentId && mainContinent >= 0 && continentId[r][c] !== mainContinent) continue;
      // Must have enough land neighbors (no tiny peninsulas)
      let landNbs = 0;
      for (const nb of getHexNeighbors(c, r)) {
        const nt = map[nb.row][nb.col].base;
        if (nt !== 'ocean' && nt !== 'coast') landNbs++;
      }
      if (landNbs < 4) continue;
      const distToPlayer = hexDistance(c, r, playerCol, playerRow);
      if (distToPlayer < t.minDist) continue;
      let tooClose = false;
      for (const p of placed) {
        if (hexDistance(c, r, p.col, p.row) < 5) { tooClose = true; break; }
      }
      if (tooClose) continue;
      // Score: prefer moderate distance (not too far, not too close) for demo density
      const idealDist = 12;
      const distPenalty = Math.abs(distToPlayer - idealDist);
      const score = 50 - distPenalty + Math.random() * 5;
      if (score > bestScore) { bestScore = score; bestCol = c; bestRow = r; }
    }
    // Fallback: relax min-distance but still require same continent
    if (bestCol < 0) {
      for (let attempt = 0; attempt < 400; attempt++) {
        const c = 3 + Math.floor(Math.random() * (MAP_COLS - 6));
        const r = 3 + Math.floor(Math.random() * (MAP_ROWS - 6));
        const base = map[r][c].base;
        if (base === 'ocean' || base === 'coast' || base === 'lake' || base === 'snow') continue;
        if (map[r][c].feature === 'mountain') continue;
        if (continentId && mainContinent >= 0 && continentId[r][c] !== mainContinent) continue;
        let tooClose = false;
        for (const p of placed) {
          if (hexDistance(c, r, p.col, p.row) < 4) { tooClose = true; break; }
        }
        if (tooClose) continue;
        bestCol = c; bestRow = r;
        break;
      }
    }
    // Last resort: any land tile on main continent
    if (bestCol < 0) {
      for (let r = 0; r < MAP_ROWS; r++) {
        for (let c = 0; c < MAP_COLS; c++) {
          if (continentId && mainContinent >= 0 && continentId[r][c] !== mainContinent) continue;
          const base = map[r][c].base;
          if (base === 'ocean' || base === 'coast' || base === 'lake' || base === 'snow') continue;
          if (map[r][c].feature === 'mountain') continue;
          let tooClose = false;
          for (const p of placed) {
            if (hexDistance(c, r, p.col, p.row) < 3) { tooClose = true; break; }
          }
          if (tooClose) continue;
          bestCol = c; bestRow = r;
          r = MAP_ROWS; break; // exit both loops
        }
      }
    }
    if (bestCol < 0) { bestCol = playerCol; bestRow = playerRow; } // absolute last resort
    cities[t.id] = { name: t.name, col: bestCol, row: bestRow, color: t.color, hp: 100, population: 1000, borderRadius: 2, improvements: 0 };
    placed.push({ col: bestCol, row: bestRow });
  }
  return cities;
}

function computeMoveRange() {
  if (!game || !game.selectedUnitId) return null;
  const unit = game.units.find(u => u.id === game.selectedUnitId);
  if (!unit || unit.moveLeft <= 0 || unit.owner !== 'player') return null;

  // Workers building improvements cannot move (cancel build first)
  if (unit.type === 'worker' && unit.sleeping) {
    const tile = game.map[unit.row]?.[unit.col];
    if (tile && tile.improvementBuilder && tile.improvementBuilder.unitId === unit.id) return null;
  }

  const visited = new Map();
  const queue = [{ col: unit.col, row: unit.row, move: unit.moveLeft }];
  visited.set(`${unit.col},${unit.row}`, unit.moveLeft);

  // ZOC: check if unit starts in enemy ZOC
  const unitStartsInZOC = isInEnemyZOC(unit.col, unit.row, unit.owner);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur.move <= 0) continue; // No movement left to expand from
    const neighbors = getHexNeighbors(cur.col, cur.row);
    for (const nb of neighbors) {
      const tile = game.map[nb.row][nb.col];
      const cost = getTileMoveCost(tile);
      if (cost >= 99) continue;
      // Civ-style movement rules:
      // - Flat terrain (cost 1): deduct 1 MP, keep moving
      // - Rough terrain (cost 2+: hills, woods, marsh, rainforest):
      //   uses ALL remaining movement points (can always enter with 1+ MP)
      // - Roads halve cost (0.5), always allow continued movement
      // - River crossing: uses ALL remaining MP (unless road bridge on both sides)
      const isRiverCross = crossesRiver(cur.col, cur.row, nb.col, nb.row)
                        && !roadBridgesRiver(cur.col, cur.row, nb.col, nb.row);
      const isRoughTerrain = cost >= 2;
      let remaining = (isRoughTerrain || isRiverCross) ? 0 : (cur.move - cost);

      // Zone of Control: entering an enemy ZOC hex ends movement
      const nbInZOC = isInEnemyZOC(nb.col, nb.row, unit.owner);
      if (nbInZOC) {
        remaining = 0; // Movement ends in ZOC hex
      }

      const key = `${nb.col},${nb.row}`;
      if (visited.has(key) && visited.get(key) >= remaining) continue;
      // Can't move through hexes with units (enemy or own)
      if (isHexBlockedForUnit(unit, nb.col, nb.row)) continue;
      // Civilian units can't enter enemy city tiles
      const ut = UNIT_TYPES[unit.type];
      if (ut && ut.class === 'civilian') {
        const isEnemyCity = Object.entries(game.factionCities).some(([, fc]) => fc.col === nb.col && fc.row === nb.row)
          || (game.aiFactionCities && Object.values(game.aiFactionCities).some(cities =>
              cities.some(ec => ec.col === nb.col && ec.row === nb.row)));
        if (isEnemyCity) continue;
      }
      visited.set(key, remaining);
      if (remaining > 0) {
        queue.push({ col: nb.col, row: nb.row, move: remaining });
      }
    }
  }

  visited.delete(`${unit.col},${unit.row}`);
  return visited;
}

/**
 * Returns a Set of "col,row" keys for tiles in the move range that require
 * an unbridged river crossing to reach (used for visual highlighting).
 */
function computeRiverCrossings() {
  if (!game || !game.selectedUnitId) return null;
  const unit = game.units.find(u => u.id === game.selectedUnitId);
  if (!unit || unit.moveLeft <= 0 || unit.owner !== 'player') return null;

  const riverTiles = new Set();
  const visited = new Map();
  const queue = [{ col: unit.col, row: unit.row, move: unit.moveLeft, crossedRiver: false }];
  visited.set(`${unit.col},${unit.row}`, unit.moveLeft);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur.move <= 0) continue;
    const neighbors = getHexNeighbors(cur.col, cur.row);
    for (const nb of neighbors) {
      const tile = game.map[nb.row][nb.col];
      const cost = getTileMoveCost(tile);
      if (cost >= 99) continue;
      const isRiverCross = crossesRiver(cur.col, cur.row, nb.col, nb.row)
                        && !roadBridgesRiver(cur.col, cur.row, nb.col, nb.row);
      const isRoughTerrain = cost >= 2;
      const remaining = (isRoughTerrain || isRiverCross) ? 0 : (cur.move - cost);
      const key = `${nb.col},${nb.row}`;
      if (visited.has(key) && visited.get(key) >= remaining) continue;
      if (isHexBlockedForUnit(unit, nb.col, nb.row)) continue;
      visited.set(key, remaining);
      const crossed = cur.crossedRiver || isRiverCross;
      if (crossed) riverTiles.add(key);
      if (remaining > 0) {
        queue.push({ col: nb.col, row: nb.row, move: remaining, crossedRiver: crossed });
      }
    }
  }
  return riverTiles;
}

function computeAttackRange() {
  if (!game || !game.selectedUnitId) return null;
  const unit = game.units.find(u => u.id === game.selectedUnitId);
  if (!unit || unit.owner !== 'player') return null;
  if (unit.type === 'worker' || unit.type === 'settler') return null; // Civilians can't attack

  const attackable = new Map();
  const ut = UNIT_TYPES[unit.type];

  if (ut.rangedCombat > 0 && ut.range > 0 && unit.moveLeft > 0 && !unit.hasAttackedThisTurn) {
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (hexDistance(c, r, unit.col, unit.row) <= ut.range) {
          const enemy = game.units.find(u => u.col === c && u.row === r && u.owner !== 'player');
          if (enemy) attackable.set(`${c},${r}`, enemy.id);
          // Also check for enemy cities
          for (const [fid, fc] of Object.entries(game.factionCities)) {
            if (fc.col === c && fc.row === r) {
              if (!attackable.has(`${c},${r}`)) attackable.set(`${c},${r}`, 'city_' + fid);
            }
          }
          // Check AI expansion cities
          if (game.aiFactionCities) {
            for (const [fid, cities] of Object.entries(game.aiFactionCities)) {
              for (let ei = 0; ei < cities.length; ei++) {
                const ec = cities[ei];
                if (ec.col === c && ec.row === r) {
                  if (!attackable.has(`${c},${r}`)) attackable.set(`${c},${r}`, 'expcity_' + fid + '_' + ei);
                }
              }
            }
          }
        }
      }
    }
  } else if (unit.moveLeft > 0 && !unit.hasAttackedThisTurn) {
    const neighbors = getHexNeighbors(unit.col, unit.row);
    for (const nb of neighbors) {
      const enemy = game.units.find(u => u.col === nb.col && u.row === nb.row && u.owner !== 'player');
      if (enemy) {
        attackable.set(`${nb.col},${nb.row}`, enemy.id);
      } else {
        // Check for enemy cities (can attack even if no garrison)
        for (const [fid, fc] of Object.entries(game.factionCities)) {
          if (fc.col === nb.col && fc.row === nb.row) {
            attackable.set(`${nb.col},${nb.row}`, 'city_' + fid);
          }
        }
        // Check AI expansion cities
        if (game.aiFactionCities) {
          for (const [fid, cities] of Object.entries(game.aiFactionCities)) {
            for (let ei = 0; ei < cities.length; ei++) {
              const ec = cities[ei];
              if (ec.col === nb.col && ec.row === nb.row) {
                if (!attackable.has(`${nb.col},${nb.row}`)) attackable.set(`${nb.col},${nb.row}`, 'expcity_' + fid + '_' + ei);
              }
            }
          }
        }
      }
    }
  }

  return attackable.size > 0 ? attackable : null;
}

function moveUnitTo(unit, targetCol, targetRow, onComplete) {
  // Block movement if worker is building an improvement
  if (unit.type === 'worker' && unit.sleeping) {
    const tile = game.map[unit.row]?.[unit.col];
    if (tile && tile.improvementBuilder && tile.improvementBuilder.unitId === unit.id) {
      showToast('Worker Busy', 'This worker is building ' + (TILE_IMPROVEMENTS?.[tile.improvementBuilder.improvementId]?.name || 'an improvement') + '. Cancel the build first.');
      if (onComplete) onComplete(false);
      return false;
    }
  }

  const moveRange = computeMoveRange();
  if (!moveRange) { if (onComplete) onComplete(false); return false; }
  const key = `${targetCol},${targetRow}`;
  if (!moveRange.has(key)) { if (onComplete) onComplete(false); return false; }

  const remaining = moveRange.get(key);
  const sightRange = unit.type === 'scout' ? 4 : 3;

  // Reconstruct path for animated movement
  const path = reconstructMovePath(unit.col, unit.row, targetCol, targetRow, unit);

  if (path.length === 0) {
    // No intermediate steps — just apply destination
    unit.col = targetCol;
    unit.row = targetRow;
    markVisibilityDirty();
    unit.moveLeft = remaining;
    unit.fortified = false;
    unit.sleeping = false;
    revealAround(unit.col, unit.row, sightRange);
    logAction('movement', UNIT_TYPES[unit.type]?.name + ' moved to (' + unit.col + ',' + unit.row + ')', { unitType: unit.type, col: unit.col, row: unit.row });
    checkAndClearBarbarianCamp(unit, targetCol, targetRow);
    if (unit.owner === 'player') {
      discoverVillage(targetCol, targetRow, unit);
      checkCityCapture(targetCol, targetRow);
    }
    render();
    if (onComplete) onComplete(true);
    return true;
  }

  // Animate tile-by-tile (150ms per step)
  const STEP_DELAY = 150;
  let stepIndex = 0;
  unit.fortified = false;
  unit.sleeping = false;

  // Store animation state so other systems know movement is in progress
  game._unitMoveAnim = { unitId: unit.id, path, step: 0 };

  function advanceStep() {
    const step = path[stepIndex];
    const prevCol = unit.col, prevRow = unit.row;
    unit.col = step.col;
    unit.row = step.row;

    // Reveal fog at each intermediate tile
    revealAround(step.col, step.row, sightRange);
    markVisibilityDirty();

    // Log river crossing if applicable
    const riverCrossed = crossesRiver(prevCol, prevRow, step.col, step.row);
    if (riverCrossed) {
      if (roadBridgesRiver(prevCol, prevRow, step.col, step.row)) {
        addEvent('Crossed river via bridge — normal movement', 'movement');
      } else {
        addEvent('Crossed river — all movement points consumed', 'movement');
      }
    }

    stepIndex++;
    game._unitMoveAnim = { unitId: unit.id, path, step: stepIndex };
    render();

    if (stepIndex < path.length) {
      setTimeout(advanceStep, STEP_DELAY);
    } else {
      // Animation complete — apply final state
      unit.moveLeft = remaining;
      game._unitMoveAnim = null;
      logAction('movement', UNIT_TYPES[unit.type]?.name + ' moved to (' + unit.col + ',' + unit.row + ')', { unitType: unit.type, col: unit.col, row: unit.row });
      checkAndClearBarbarianCamp(unit, targetCol, targetRow);
      if (unit.owner === 'player') {
        discoverVillage(targetCol, targetRow, unit);
        checkCityCapture(targetCol, targetRow);
      }
      render();
      if (onComplete) onComplete(true);
    }
  }

  advanceStep();
  return true;
}

// Reconstruct the shortest movement path from BFS
function reconstructMovePath(fromCol, fromRow, toCol, toRow, unit) {
  const parents = new Map();
  const visited = new Map();
  const queue = [{ col: fromCol, row: fromRow, move: unit.moveLeft }];
  const startKey = `${fromCol},${fromRow}`;
  visited.set(startKey, unit.moveLeft);
  parents.set(startKey, null);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur.move <= 0) continue;
    const neighbors = getHexNeighbors(cur.col, cur.row);
    for (const nb of neighbors) {
      const tile = game.map[nb.row][nb.col];
      const cost = getTileMoveCost(tile);
      if (cost >= 99) continue;
      // River crossing uses all remaining MP (unless road bridge)
      const isRiverCross = crossesRiver(cur.col, cur.row, nb.col, nb.row)
                        && !roadBridgesRiver(cur.col, cur.row, nb.col, nb.row);
      const isRough = cost >= 2;
      let remaining = (isRough || isRiverCross) ? 0 : (cur.move - cost);

      // ZOC: entering enemy ZOC ends movement
      if (isInEnemyZOC(nb.col, nb.row, unit.owner)) {
        remaining = 0;
      }

      const key = `${nb.col},${nb.row}`;
      if (visited.has(key) && visited.get(key) >= remaining) continue;
      if (isHexBlockedForUnit(unit, nb.col, nb.row)) continue;
      visited.set(key, remaining);
      parents.set(key, `${cur.col},${cur.row}`);
      if (remaining > 0) {
        queue.push({ col: nb.col, row: nb.row, move: remaining });
      }
    }
  }

  // Trace back from target to source
  const path = [];
  let current = `${toCol},${toRow}`;
  while (current && current !== startKey) {
    const [c, r] = current.split(',').map(Number);
    path.unshift({ col: c, row: r });
    current = parents.get(current);
  }
  return path;
}

function selectUnit(unit) {
  game.selectedUnitId = unit.id;
  game.selectedHex = null;
  panCameraTo(unit.col, unit.row);
  render();
  showSelectionPanel(unit);
  startAnimLoop();
}

function deselectUnit() {
  game.selectedUnitId = null;
  hideSelectionPanel();
  render();
}

// ---- Clear barbarian camp when a military unit steps on it ----
function checkAndClearBarbarianCamp(unit, col, row) {
  if (unit.owner !== 'player') return;
  if (unit.type === 'worker' || unit.type === 'settler') return; // Civilians can't clear camps

  // Don't auto-clear camps — let the player interact via the negotiation panel.
  // Camps are destroyed via the "Attack" / "Destroy" button in the interaction UI.
}

// ---- Boost reputation with nearby AI factions when clearing barbarian threats ----
function boostFactionReputation(col, row, threatType) {
  const REPUTATION_RANGE = 14; // How far away factions notice you clearing threats
  const REPUTATION_BOOST = 12; // +12 relationship points per threat cleared nearby
  if (!game.relationships) game.relationships = {};

  // Track best boost per faction (closest city = biggest boost, only applied once)
  const factionBoosts = {};

  // Check each faction's main city
  for (const [fid, fc] of Object.entries(game.factionCities)) {
    const dist = hexDistance(col, row, fc.col, fc.row);
    if (dist <= REPUTATION_RANGE) {
      const boost = Math.max(3, Math.floor(REPUTATION_BOOST * (1 - dist / (REPUTATION_RANGE * 1.5))));
      if (!factionBoosts[fid] || boost > factionBoosts[fid]) factionBoosts[fid] = boost;
    }
  }

  // Also check AI expansion cities
  if (game.aiFactionCities) {
    for (const [fid, cities] of Object.entries(game.aiFactionCities)) {
      for (const ec of cities) {
        const dist = hexDistance(col, row, ec.col, ec.row);
        if (dist <= REPUTATION_RANGE) {
          const boost = Math.max(3, Math.floor(REPUTATION_BOOST * (1 - dist / (REPUTATION_RANGE * 1.5))));
          if (!factionBoosts[fid] || boost > factionBoosts[fid]) factionBoosts[fid] = boost;
        }
      }
    }
  }

  // Apply best boost per faction (once each)
  for (const [fid, boost] of Object.entries(factionBoosts)) {
    game.relationships[fid] = (game.relationships[fid] || 0) + boost;
    const factionName = FACTIONS[fid]?.name || fid;
    addEvent(`\u{1F91D} ${factionName} appreciates you clearing a nearby ${threatType}! (+${boost} relations)`, 'diplomacy');
  }
}

// ---- Click handler with comprehensive routing ----
function handleHexClick(col, row) {
  if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) return;
  if (!game.fogOfWar[row][col]) return;
  // Block clicks while unit movement animation is in progress
  if (game._unitMoveAnim) return;

  // If a player unit is selected
  if (game.selectedUnitId) {
    const unit = game.units.find(u => u.id === game.selectedUnitId);
    if (unit && unit.owner === 'player') {
      // Check for attack target
      const attackRange = computeAttackRange();
      const aKey = `${col},${row}`;
      if (attackRange && attackRange.has(aKey)) {
        const targetId = attackRange.get(aKey);
        // Check if target is a city
        if (typeof targetId === 'string' && targetId.startsWith('city_')) {
          const factionId = targetId.replace('city_', '');
          attackFactionCity(unit, factionId);
          return;
        }
        if (typeof targetId === 'string' && targetId.startsWith('expcity_')) {
          const parts = targetId.split('_');
          const factionId = parts[1];
          const cityIdx = parseInt(parts[2]);
          attackExpansionCity(unit, factionId, cityIdx);
          return;
        }
        const target = game.units.find(u => u.id === targetId);
        if (target) {
          // Surprise attack check: non-barbarian units belonging to a faction we're not at war with
          if (target.owner !== 'barbarian' && !isAtWarWith(target.owner)) {
            if (!confirmAndDeclareWar(target.owner)) return;
          }
          // Civilian units (workers, settlers) are captured, not fought
          const targetType = UNIT_TYPES[target.type];
          if (targetType && targetType.class === 'civilian') {
            const prevOwner = target.owner;
            target.owner = 'player';
            target.moveLeft = 0;
            // Only melee units move onto the captured unit's tile
            const attackerType = UNIT_TYPES[unit.type];
            if (!attackerType || attackerType.rangedCombat <= 0 || attackerType.range <= 0) {
              unit.col = target.col;
              unit.row = target.row;
            }
            const ownerName = FACTIONS[prevOwner] ? FACTIONS[prevOwner].name : prevOwner;
            addEvent(`Captured ${targetType.name} from ${ownerName}!`, 'combat');
            showToast('Unit Captured', `${targetType.name} captured from ${ownerName}!`);
            unit.moveLeft = Math.max(0, unit.moveLeft - 1);
            showSelectionPanel(unit);
            render();
            return;
          }
          // Show tactical battle panel for player attacks
          showBattlePanel(unit, target, (tactic) => {
            if (tactic === 'cancel') return;
            const tacticResult = applyTacticModifier(tactic, 0, 0, unit, target);
            if (tacticResult.retreat) {
              unit.moveLeft = Math.max(0, unit.moveLeft - 1);
              addEvent(tacticResult.narrative, 'combat');
              showSelectionPanel(unit);
              render();
              return;
            }
            // Store tactic modifiers temporarily for resolveCombat
            unit._tacticAtkMod = tacticResult.atkMod || 1;
            unit._tacticDefMod = tacticResult.defMod || 1;
            unit._tacticNarrative = tacticResult.narrative || '';
            if (tacticResult.noMoveCost) unit._tacticNoMoveCost = true;

            const result = resolveCombat(unit, target);
            // Add tactic narrative to combat result
            if (unit._tacticNarrative) {
              addEvent(unit._tacticNarrative, 'combat');
            }
            delete unit._tacticAtkMod;
            delete unit._tacticDefMod;
            delete unit._tacticNarrative;
            delete unit._tacticNoMoveCost;

            showCombatResult(unit, target, result);
            if (result.attackerDied) {
              deselectUnit();
              autoSelectNext();
            } else if (unit.moveLeft <= 0) {
              autoSelectNext();
            } else {
              showSelectionPanel(unit);
              render();
            }
          });
          return;
        }
      }

      // Check for valid move
      const moveRange = computeMoveRange();
      const mKey = `${col},${row}`;
      if (moveRange && moveRange.has(mKey)) {
        game.selectedHex = null;
        moveUnitTo(unit, col, row, () => {
          if (unit.moveLeft <= 0) {
            autoSelectNext();
          } else {
            showSelectionPanel(unit);
            render();
          }
        });
        return;
      }

      // If hex is adjacent but territory-blocked, offer to declare war
      if (unit.moveLeft > 0 && hexDistance(col, row, unit.col, unit.row) <= 1) {
        const owner = getTileOwner(col, row);
        if (owner && owner !== 'player' && !isAtWarWith(owner) && !(game.openBorders && game.openBorders[owner])) {
          if (confirmAndDeclareWar(owner)) {
            // War declared — now the hex should be unblocked, try to move
            moveUnitTo(unit, col, row, () => {
              if (unit.moveLeft <= 0) autoSelectNext();
              else { showSelectionPanel(unit); render(); }
            });
            return;
          }
          return; // Player declined war
        }
      }
    }

    // Clicked outside movement/attack range — set as multi-turn waypoint
    if (!getUnitAt(col, row) && !getCityAt(col, row) && isTilePassable(game.map[row][col])) {
      unit.waypoint = { col, row };
      addEvent(`${(UNIT_TYPES[unit.type]?.name || unit.type)} waypoint set`, 'combat');
      // Move toward waypoint this turn if possible (animated)
      moveTowardWaypoint(unit, () => {
        if (unit.moveLeft <= 0) autoSelectNext();
        else { showSelectionPanel(unit); render(); }
      });
      return;
    }

    // Check for minor faction / barbarian camp FIRST — prioritize negotiation
    if (game.minorFactions) {
      const mf = game.minorFactions.find(m => m.col === col && m.row === row && !m.defeated);
      if (mf) { interactWithMinorFaction(mf.id); return; }
    }
    if (game.barbarianCamps) {
      const bc = game.barbarianCamps.find(c => c.col === col && c.row === row && !c.destroyed);
      if (bc) { interactWithBarbarianCamp(bc.id); return; }
    }

    // Check what's at this hex — cycle through stacked units on repeat clicks
    const unitsHere = game.units.filter(u => u.col === col && u.row === row);
    const playerUnitsHere = unitsHere.filter(u => u.owner === 'player');
    const cityHere = getCityAt(col, row);

    if (playerUnitsHere.length > 0) {
      // If a player unit is already selected here, cycle: next unit or city
      const currentlySelected = playerUnitsHere.find(u => u.id === game.selectedUnitId);
      if (currentlySelected) {
        const nextUnit = playerUnitsHere.find(u => u.id !== game.selectedUnitId);
        if (nextUnit) {
          selectUnit(nextUnit);
        } else if (cityHere && cityHere.owner === 'player') {
          // Cycled through all units — show city panel
          deselectUnit();
          game.selectedHex = { col, row };
          showCityPanel(cityHere);
        } else {
          selectUnit(playerUnitsHere[0]);
        }
      } else {
        selectUnit(playerUnitsHere[0]);
      }
      return;
    } else if (unitsHere.length > 0) {
      // Barbarian units → open camp interaction if a camp exists
      const barbUnit = unitsHere.find(u => u.owner === 'barbarian');
      if (barbUnit && game.barbarianCamps) {
        const camp = findNearestBarbarianCamp(barbUnit.col, barbUnit.row);
        if (camp) { interactWithBarbarianCamp(camp.id); return; }
      }
      selectUnit(unitsHere[0]);
      return;
    }

    // Check for city (no player units on tile)
    if (cityHere) {
      deselectUnit();
      game.selectedHex = { col, row };
      showCityPanel(cityHere);
      return;
    }

    // Deselect and show tile info
    deselectUnit();
    game.selectedHex = { col, row };
    showTileInfo(col, row);
    return;
  }

  // No unit selected — check for minor factions first
  if (game.minorFactions) {
    const mf = game.minorFactions.find(m => m.col === col && m.row === row && !m.defeated);
    if (mf) { interactWithMinorFaction(mf.id); return; }
  }
  // Check for barbarian camps (AI-spawned)
  if (game.barbarianCamps) {
    const bc = game.barbarianCamps.find(c => c.col === col && c.row === row && !c.destroyed);
    if (bc) { interactWithBarbarianCamp(bc.id); return; }
  }

  // Check for player units on this tile first — they take priority over city panel
  const unitsAtHex = game.units.filter(u => u.col === col && u.row === row);
  const playerUnitsAtHex = unitsAtHex.filter(u => u.owner === 'player');
  if (playerUnitsAtHex.length > 0) {
    selectUnit(playerUnitsAtHex[0]);
    return;
  }

  // City panel (only if no player units on tile)
  const cityHere = getCityAt(col, row);
  if (cityHere) {
    game.selectedHex = { col, row };
    showCityPanel(cityHere);
    return;
  }

  // Non-player units
  if (unitsAtHex.length > 0) {
    // Barbarian units → open camp interaction if a camp exists
    const barbUnit = unitsAtHex.find(u => u.owner === 'barbarian');
    if (barbUnit && game.barbarianCamps) {
      const camp = findNearestBarbarianCamp(barbUnit.col, barbUnit.row);
      if (camp) { interactWithBarbarianCamp(camp.id); return; }
    }
    selectUnit(unitsAtHex[0]);
    return;
  }

  // Just terrain
  game.selectedHex = { col, row };
  showTileInfo(col, row);
}

function autoSelectNext() {
  const movable = game.units.filter(u => u.owner === 'player' && u.moveLeft > 0 && !u.sleeping && !u.fortified && !u.alert);
  if (movable.length > 0) {
    selectUnit(movable[0]);
  } else {
    deselectUnit();
  }
}

function applyPromotion(unitId, promoId) {
  const unit = game.units.find(u => u.id === unitId);
  if (!unit || !unit.pendingPromotion) return;
  if (!unit.promotions) unit.promotions = [];
  unit.promotions.push(promoId);
  unit.pendingPromotion = false;
  const p = UNIT_PROMOTIONS[promoId];
  if (p && p.moveBonus) {
    const ut = UNIT_TYPES[unit.type];
    if (ut) unit.moveLeft = Math.min(unit.moveLeft + p.moveBonus, ut.movePoints + p.moveBonus);
  }
  addEvent((UNIT_TYPES[unit.type]?.name || unit.type) + ' promoted: ' + (p ? p.icon + ' ' + p.name : promoId), 'combat');
  showSelectionPanel(unit);
  updateUI();
}



function upgradeUnit(unitId) {
  const unit = game.units.find(u => u.id === unitId);
  if (!unit || unit.owner !== 'player') return;
  const upgrade = UNIT_UPGRADES[unit.type];
  if (!upgrade) return;
  if (!game.techs.includes(upgrade.requires)) return;
  if (game.gold < upgrade.cost) return;
  game.gold -= upgrade.cost;
  const oldType = unit.type;
  unit.type = upgrade.to;
  const newDef = UNIT_TYPES[upgrade.to];
  if (newDef) {
    unit.hp = Math.min(unit.hp, 100);
    unit.moveLeft = 0; // Upgrading costs all movement
  }
  if (typeof showToast === 'function') showToast(newDef.icon + ' ' + newDef.name, 'Unit upgraded from ' + UNIT_TYPES[oldType].name);
  showSelectionPanel();
  updateUI();
}
window.upgradeUnit = upgradeUnit;

function selectNextUnit() {
  if (!game || !game.units.length) return;
  const movableUnits = game.units.filter(u => u.owner === 'player' && u.moveLeft > 0 && !u.sleeping && !u.fortified && !u.alert);
  if (movableUnits.length === 0) {
    deselectUnit();
    return;
  }
  let idx = 0;
  if (game.selectedUnitId) {
    const currentIdx = movableUnits.findIndex(u => u.id === game.selectedUnitId);
    idx = (currentIdx + 1) % movableUnits.length;
  }
  selectUnit(movableUnits[idx]);
}

// ============================================
// GREAT GENERAL — ARMY MECHANICS
// ============================================

/** Get the max army capacity for a general based on XP level */
function getGeneralCapacity(general) {
  if (general.armyCapacity) return general.armyCapacity;
  // Base capacity 3, +1 at level 2 (20 XP), +1 at level 3 (50 XP)
  const xp = general.xp || 0;
  if (xp >= 50) return 5;
  if (xp >= 20) return 4;
  return 3;
}

/** Attach a military unit to a general's army */
function attachToArmy(generalId, unitId) {
  const general = game.units.find(u => u.id === generalId);
  const unit = game.units.find(u => u.id === unitId);
  if (!general || !unit) return false;
  if (general.type !== 'great_general') return false;
  if (unit.owner !== general.owner) return false;
  const ut = UNIT_TYPES[unit.type];
  if (!ut || ut.combat <= 0) return false; // only military units
  if (unit.type === 'great_general') return false; // can't nest generals

  if (!general.army) general.army = [];
  const cap = getGeneralCapacity(general);
  if (general.army.length >= cap) {
    addEvent('Army is full (' + cap + '/' + cap + '). General needs more experience.', 'combat');
    return false;
  }

  // Check unit is adjacent to or on same tile as general
  const dist = hexDistance(unit.col, unit.row, general.col, general.row);
  if (dist > 1) {
    addEvent('Unit must be adjacent to the General to join the army.', 'combat');
    return false;
  }

  // Remove unit from map — it's now inside the army
  general.army.push({
    id: unit.id, type: unit.type, hp: unit.hp, xp: unit.xp || 0,
    promotions: unit.promotions || [], combat: unit.combat || ut.combat,
    level: unit.level || 1, pendingPromotion: unit.pendingPromotion || false,
  });
  game.units = game.units.filter(u => u.id !== unitId);

  const unitName = ut.name;
  addEvent(unitName + ' joined the General\'s army (' + general.army.length + '/' + cap + ')', 'combat');
  showToast('\u{2694} Army', unitName + ' attached to Great General');
  return true;
}

/** Detach a unit from a general's army back onto the map */
function detachFromArmy(generalId, armyIdx) {
  const general = game.units.find(u => u.id === generalId);
  if (!general || !general.army || armyIdx >= general.army.length) return false;

  const stored = general.army[armyIdx];
  const ut = UNIT_TYPES[stored.type];
  if (!ut) return false;

  // Find an adjacent empty tile to place the unit
  const nbs = getHexNeighbors(general.col, general.row);
  let spawnTile = null;
  for (const nb of nbs) {
    const t = game.map[nb.row]?.[nb.col];
    if (!t || !isTilePassable(t)) continue;
    const occupied = game.units.filter(u => u.col === nb.col && u.row === nb.row);
    if (occupied.length >= 2) continue;
    if (occupied.length === 1 && !canStackWith({ owner: general.owner, type: stored.type }, occupied[0])) continue;
    spawnTile = nb;
    break;
  }
  if (!spawnTile) {
    addEvent('No room to detach unit — clear adjacent tiles first.', 'combat');
    return false;
  }

  // Create unit back on the map
  const newUnit = createUnit(stored.type, spawnTile.col, spawnTile.row, general.owner);
  newUnit.id = stored.id; // preserve original ID
  newUnit.hp = stored.hp;
  newUnit.xp = stored.xp;
  newUnit.combat = stored.combat;
  newUnit.promotions = stored.promotions;
  newUnit.level = stored.level;
  newUnit.pendingPromotion = stored.pendingPromotion;
  newUnit.moveLeft = 0; // can't move the turn they detach
  game.units.push(newUnit);

  general.army.splice(armyIdx, 1);
  addEvent(ut.name + ' detached from army', 'combat');
  return true;
}

/** Move the general and all army units together */
function moveArmyTo(general, col, row, callback) {
  // Standard movement — the general moves, army travels with it
  moveUnitTo(general, col, row, () => {
    // Grant XP to general for army movement (small amount)
    general.xp = (general.xp || 0) + 1;
    // Update capacity if XP threshold crossed
    general.armyCapacity = getGeneralCapacity(general);
    if (callback) callback();
  });
}

/**
 * Coordinated attack: general orders up to 2 army units to attack
 * a target simultaneously, applying flanking bonuses.
 */
function coordinatedAttack(generalId, targetCol, targetRow) {
  const general = game.units.find(u => u.id === generalId);
  if (!general || !general.army || general.army.length === 0) return false;

  const target = game.units.find(u => u.col === targetCol && u.row === targetRow && u.owner !== general.owner);
  if (!target) return false;

  // Check general is adjacent to target
  const dist = hexDistance(general.col, general.row, targetCol, targetRow);
  if (dist > 1) {
    addEvent('General must be adjacent to the target for a coordinated attack.', 'combat');
    return false;
  }

  // Pick up to 2 strongest army units for the attack
  const attackers = general.army
    .filter(u => UNIT_TYPES[u.type]?.combat > 0)
    .sort((a, b) => (b.combat || UNIT_TYPES[b.type].combat) - (a.combat || UNIT_TYPES[a.type].combat))
    .slice(0, 2);

  if (attackers.length === 0) {
    addEvent('No combat units in the army to attack with.', 'combat');
    return false;
  }

  const targetType = UNIT_TYPES[target.type];
  const targetName = targetType ? targetType.name : 'enemy';

  addEvent('\u{2694} Great General orders a coordinated attack on ' + targetName + '!', 'combat');

  // Execute attacks sequentially — each attacker gets a flanking bonus
  for (let i = 0; i < attackers.length; i++) {
    if (target.hp <= 0) break; // target already dead

    const stored = attackers[i];
    const aType = UNIT_TYPES[stored.type];
    const atkPower = stored.combat || aType.combat;
    const defPower = targetType.combat || 10;

    // Coordinated attack bonus: +30% for flanking
    const flankMod = attackers.length > 1 ? 1.3 : 1.15;
    const damage = Math.max(5, Math.floor(30 * flankMod * (atkPower / Math.max(1, defPower)) * (stored.hp / 100)));
    const returnDmg = Math.max(3, Math.floor(15 * (defPower / Math.max(1, atkPower)) * (target.hp / 100)));

    target.hp -= damage;
    stored.hp = Math.max(0, stored.hp - returnDmg);

    addEvent('  ' + aType.name + ' deals ' + damage + ' dmg, takes ' + returnDmg + ' return dmg', 'combat');

    // Grant XP to the attacking unit and the general
    stored.xp = (stored.xp || 0) + 10;
    general.xp = (general.xp || 0) + 5;

    // Remove dead army units
    if (stored.hp <= 0) {
      const idx = general.army.findIndex(u => u.id === stored.id);
      if (idx >= 0) general.army.splice(idx, 1);
      addEvent('  ' + aType.name + ' was destroyed in the assault!', 'combat');
    }
  }

  // Update general capacity from XP gain
  general.armyCapacity = getGeneralCapacity(general);

  // Handle target death
  if (target.hp <= 0) {
    game.units = game.units.filter(u => u.id !== target.id);
    addEvent(targetName + ' destroyed by coordinated attack!', 'combat');
    showToast('\u{2694} Victory', targetName + ' destroyed by the General\'s army!');
    markVisibilityDirty();
  }

  general.moveLeft = 0; // coordinated attack uses the general's turn
  general.hasAttackedThisTurn = true;
  return true;
}

export {
  createUnit,
  placeFactionCities,
  computeMoveRange,
  computeRiverCrossings,
  computeAttackRange,
  moveUnitTo,
  reconstructMovePath,
  selectUnit,
  deselectUnit,
  handleHexClick,
  autoSelectNext,
  applyPromotion,
  upgradeUnit,
  selectNextUnit,
  isInEnemyZOC,
  getEnemyZOCHexes,
  getTileOwner,
  isTerritoryBlocked,
  boostFactionReputation,
  getGeneralCapacity,
  attachToArmy,
  detachFromArmy,
  coordinatedAttack,
};
