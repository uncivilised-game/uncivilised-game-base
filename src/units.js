import { MAP_COLS, MAP_ROWS, BASE_TERRAIN, UNIT_TYPES, UNIT_UPGRADES, UNIT_UNLOCKS, UNIT_PROMOTIONS, FACTIONS, FACTION_TRAITS, TILE_IMPROVEMENTS, ZOC_EXEMPT_CLASSES } from './constants.js';
import { game, getNextUnitId } from './state.js';
import { hexToPixel, pixelToHex, getHexNeighbors, hexDistance } from './hex.js';
import { getTileMoveCost, isTilePassable, crossesRiver, roadBridgesRiver } from './map.js';
import { resolveCombat, attackFactionCity, attackExpansionCity, getUnitAt, getPlayerUnitAt, getEnemyUnitAt, getCityAt, showBattlePanel, applyTacticModifier } from './combat.js';
import { showSelectionPanel, hideSelectionPanel, showCityPanel, showTileInfo, showCombatResult } from './ui-panels.js';
import { showWorkerActions, showSettlerActions, moveTowardWaypoint } from './improvements.js';
import { render, markVisibilityDirty } from './render.js';
import { addEvent, logAction, showToast } from './events.js';
import { revealAround } from './discovery.js';
import { panCameraTo } from './input.js';
import { updateUI } from './leaderboard.js';
import { startAnimLoop } from './feedback.js';
import { MINOR_FACTION_TYPES, interactWithMinorFaction, interactWithBarbarianCamp } from './minor-factions.js';

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
      const blockingUnit = game.units.find(u => u.col === nb.col && u.row === nb.row && u.id !== unit.id);
      if (blockingUnit) continue;
      visited.set(key, remaining);
      if (remaining > 0) {
        queue.push({ col: nb.col, row: nb.row, move: remaining });
      }
    }
  }

  visited.delete(`${unit.col},${unit.row}`);
  return visited;
}

function computeAttackRange() {
  if (!game || !game.selectedUnitId) return null;
  const unit = game.units.find(u => u.id === game.selectedUnitId);
  if (!unit || unit.owner !== 'player') return null;
  if (unit.type === 'worker' || unit.type === 'settler') return null; // Civilians can't attack

  const attackable = new Map();
  const ut = UNIT_TYPES[unit.type];

  if (ut.rangedCombat > 0 && ut.range > 0 && unit.moveLeft > 0) {
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
  } else if (unit.moveLeft > 0) {
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

function moveUnitTo(unit, targetCol, targetRow) {
  // Block movement if worker is building an improvement
  if (unit.type === 'worker' && unit.sleeping) {
    const tile = game.map[unit.row]?.[unit.col];
    if (tile && tile.improvementBuilder && tile.improvementBuilder.unitId === unit.id) {
      showToast('Worker Busy', 'This worker is building ' + (TILE_IMPROVEMENTS?.[tile.improvementBuilder.improvementId]?.name || 'an improvement') + '. Cancel the build first.');
      return false;
    }
  }

  const moveRange = computeMoveRange();
  if (!moveRange) return false;
  const key = `${targetCol},${targetRow}`;
  if (!moveRange.has(key)) return false;

  const remaining = moveRange.get(key);
  const sightRange = unit.type === 'scout' ? 4 : 3;

  // Reveal fog along the path, not just at destination
  // Trace path using BFS parent pointers
  const path = reconstructMovePath(unit.col, unit.row, targetCol, targetRow, unit);
  for (const step of path) {
    revealAround(step.col, step.row, sightRange);
  }

  unit.col = targetCol;
  unit.row = targetRow;
  markVisibilityDirty();
  unit.moveLeft = remaining;
  unit.fortified = false;
  unit.sleeping = false;

  // Reveal at destination too (in case path was empty)
  revealAround(unit.col, unit.row, sightRange);
  logAction('movement', UNIT_TYPES[unit.type]?.name + ' moved to (' + unit.col + ',' + unit.row + ')', { unitType: unit.type, col: unit.col, row: unit.row });

  // Auto-clear barbarian camps when stepping on them
  checkAndClearBarbarianCamp(unit, targetCol, targetRow);

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
      const blockingUnit = game.units.find(u => u.col === nb.col && u.row === nb.row && u.id !== unit.id);
      if (blockingUnit) continue;
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

  // Check AI-spawned barbarianCamps
  if (game.barbarianCamps) {
    const camp = game.barbarianCamps.find(bc => bc.col === col && bc.row === row && !bc.destroyed);
    if (camp) {
      // Check if camp is undefended (no barbarian units on or adjacent to camp)
      const defenders = game.units.filter(u =>
        u.owner === 'barbarian' && u.id !== unit.id && hexDistance(u.col, u.row, col, row) <= 1
      );
      if (defenders.length === 0) {
        camp.destroyed = true;
        const lootGold = 15 + Math.floor(camp.strength * 1.5);
        game.gold += lootGold;
        addEvent(`\u{1F525} Cleared barbarian camp! +${lootGold}g looted.`, 'combat');
        showToast('Camp Cleared!', `Your ${UNIT_TYPES[unit.type]?.name || 'unit'} cleared an undefended barbarian camp.`);
        logAction('combat', 'Cleared barbarian camp at (' + col + ',' + row + ')', { gold: lootGold });

        // Reputation boost with nearby AI factions (Civ-style)
        boostFactionReputation(col, row, 'barbarian camp');
      }
    }
  }

  // Check minorFaction barbarian_camps
  if (game.minorFactions) {
    const mf = game.minorFactions.find(m => m.col === col && m.row === row && !m.defeated && m.type === 'barbarian_camp');
    if (mf) {
      const defenders = game.units.filter(u =>
        u.owner === 'barbarian' && u.id !== unit.id && hexDistance(u.col, u.row, col, row) <= 1
      );
      if (defenders.length === 0) {
        mf.defeated = true;
        const lootGold = 10 + Math.floor(mf.strength);
        game.gold += lootGold;
        addEvent(`\u{1F525} Cleared ${MINOR_FACTION_TYPES[mf.type]?.name || 'barbarian camp'}! +${lootGold}g looted.`, 'combat');
        showToast('Camp Cleared!', `Your ${UNIT_TYPES[unit.type]?.name || 'unit'} cleared an undefended barbarian camp.`);

        // Reputation boost with nearby AI factions
        boostFactionReputation(col, row, 'barbarian camp');
      }
    }
  }
}

// ---- Boost reputation with nearby AI factions when clearing barbarian threats ----
function boostFactionReputation(col, row, threatType) {
  const REPUTATION_RANGE = 12; // How far away factions notice you clearing camps
  const REPUTATION_BOOST = 8;  // +8 relationship points per camp cleared
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
          // Show tactical battle panel for player attacks
          showBattlePanel(unit, target, (tactic) => {
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

            const result = resolveCombat(unit, target);
            // Add tactic narrative to combat result
            if (unit._tacticNarrative) {
              addEvent(unit._tacticNarrative, 'combat');
            }
            delete unit._tacticAtkMod;
            delete unit._tacticDefMod;
            delete unit._tacticNarrative;

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
        moveUnitTo(unit, col, row);

        if (unit.moveLeft <= 0) {
          autoSelectNext();
        } else {
          showSelectionPanel(unit);
          render();
        }
        game.selectedHex = null;
        return;
      }
    }

    // Clicked outside movement/attack range — set as multi-turn waypoint
    if (!getUnitAt(col, row) && !getCityAt(col, row) && isTilePassable(game.map[row][col])) {
      unit.waypoint = { col, row };
      addEvent(`${(UNIT_TYPES[unit.type]?.name || unit.type)} waypoint set`, 'combat');
      // Move toward waypoint this turn if possible
      moveTowardWaypoint(unit);
      if (unit.moveLeft <= 0) autoSelectNext();
      else { showSelectionPanel(unit); render(); }
      return;
    }

    // Check what's at this hex
    const clickedUnit = getUnitAt(col, row);
    if (clickedUnit) {
      selectUnit(clickedUnit);
      return;
    }

    // Check for city
    const cityHere = getCityAt(col, row);
    if (cityHere) {
      deselectUnit();
      game.selectedHex = { col, row };
      showCityPanel(cityHere);
      return;
    }

    // Check for minor faction
    if (game.minorFactions) {
      const mf = game.minorFactions.find(m => m.col === col && m.row === row && !m.defeated);
      if (mf) { interactWithMinorFaction(mf.id); return; }
    }
    // Check for barbarian camps (AI-spawned)
    if (game.barbarianCamps) {
      const bc = game.barbarianCamps.find(c => c.col === col && c.row === row && !c.destroyed);
      if (bc) { interactWithBarbarianCamp(bc.id); return; }
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

  // Check what's here — city takes priority over unit (BUG-16)
  const cityHere = getCityAt(col, row);
  if (cityHere) {
    game.selectedHex = { col, row };
    showCityPanel(cityHere);
    return;
  }

  const unitHere = getUnitAt(col, row);
  if (unitHere) {
    selectUnit(unitHere);
    return;
  }

  // Just terrain
  game.selectedHex = { col, row };
  showTileInfo(col, row);
}

function autoSelectNext() {
  const movable = game.units.filter(u => u.owner === 'player' && u.moveLeft > 0 && !u.sleeping && !u.fortified);
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
  const movableUnits = game.units.filter(u => u.owner === 'player' && u.moveLeft > 0 && !u.sleeping && !u.fortified);
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

export {
  createUnit,
  placeFactionCities,
  computeMoveRange,
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
};
