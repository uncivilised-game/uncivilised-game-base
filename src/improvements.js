import { TILE_IMPROVEMENTS, BASE_TERRAIN, TERRAIN_FEATURES, RESOURCES, MAP_COLS, MAP_ROWS, UNIT_TYPES } from './constants.js';
import { game } from './state.js';
import { hexDistance, getHexNeighbors } from './hex.js';
import { getTileMoveCost, isTilePassable } from './map.js';
import { addEvent, logAction } from './events.js';
import { render } from './render.js';
import { createUnit } from './units.js';
import { revealAround } from './discovery.js';
import { getUnitAt } from './combat.js';
import { hideSelectionPanel } from './ui-panels.js';
import { updateUI } from './leaderboard.js';
import { showCompletionNotification, showToast } from './events.js';
import { NATURAL_WONDERS } from './constants.js';

export function getAvailableImprovements(col, row) {
  const tile = game.map[row][col];
  // Can't improve city tiles
  const isCity = game.cities.some(c => c.col === col && c.row === row) ||
    Object.values(game.factionCities).some(fc => fc.col === col && fc.row === row);
  if (isCity) return [];
  const available = [];

  for (const [id, imp] of Object.entries(TILE_IMPROVEMENTS)) {
    // Check tech requirement
    if (imp.requires && !game.techs.includes(imp.requires)) continue;
    // Check if already built (except roads can coexist)
    if (id !== 'road' && tile.improvement === id) continue;
    if (id === 'road' && tile.road) continue;
    // Check valid terrain
    if (imp.validOn && !imp.validOn.includes(tile.base) && !(imp.validOn.includes('hills') && tile.feature === 'hills')) continue;
    // Check valid feature
    if (imp.validFeature && !imp.validFeature.includes(tile.feature)) continue;
    // Check river requirement
    if (imp.requiresRiver && !tile.hasRiver) continue;
    // Check resource requirement
    if (imp.requiresResource && (!tile.resource || !imp.requiresResource.includes(tile.resource))) continue;
    // Terraforming checks
    if (imp.terraform) {
      if (imp.terraform.removeFeature && !tile.feature) continue;
      if (imp.terraform.addFeature && tile.feature) continue;
    }
    // Can't build on water (except fishing boats)
    if ((tile.base === 'ocean' || tile.base === 'coast' || tile.base === 'lake') && id !== 'fishing_boats') continue;
    // Can't build on mountains
    if (tile.feature === 'mountain') continue;
    // Must be within city borders
    const inTerritory = game.cities.some(city => hexDistance(col, row, city.col, city.row) <= (city.borderRadius || 2));
    if (!inTerritory) continue;

    available.push({ id, ...imp });
  }
  return available;
}

export function startImprovement(unitId, improvementId) {
  const unit = game.units.find(u => u.id === unitId);
  if (!unit || unit.type !== 'worker') return;

  const tile = game.map[unit.row][unit.col];
  const imp = TILE_IMPROVEMENTS[improvementId];
  if (!imp) return;

  tile.improvementProgress = 0;
  tile.improvementBuilder = { unitId, improvementId, turnsLeft: imp.turns };
  unit.sleeping = true; // Worker is busy
  addEvent(`Worker began building ${imp.name}`, 'gold');
}

export function cancelImprovement(unitId) {
  const unit = game.units.find(u => u.id === unitId);
  if (!unit || unit.type !== 'worker') return;

  const tile = game.map[unit.row]?.[unit.col];
  if (tile && tile.improvementBuilder && tile.improvementBuilder.unitId === unitId) {
    const impName = TILE_IMPROVEMENTS[tile.improvementBuilder.improvementId]?.name || 'improvement';
    tile.improvementBuilder = null;
    tile.improvementProgress = 0;
    unit.sleeping = false;
    addEvent(`Worker cancelled building ${impName}`, 'warning');
  }
}

export function processImprovements() {
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const tile = game.map[r][c];
      if (!tile.improvementBuilder) continue;

      const builder = tile.improvementBuilder;
      builder.turnsLeft--;

      if (builder.turnsLeft <= 0) {
        const imp = TILE_IMPROVEMENTS[builder.improvementId];
        if (!imp) { tile.improvementBuilder = null; continue; }

        // Apply the improvement
        if (builder.improvementId === 'road') {
          tile.road = true;
        } else if (imp.terraform) {
          // Terraforming
          if (imp.terraform.removeFeature) {
            tile.feature = null;
            if (imp.terraform.prodBonus) {
              game.production += imp.terraform.prodBonus;
              addEvent(`Forest cleared! +${imp.terraform.prodBonus} production`, 'gold');
            }
          }
          if (imp.terraform.addFeature) {
            tile.feature = imp.terraform.addFeature;
            addEvent(`${imp.name} complete!`, 'gold');
          }
        } else {
          tile.improvement = builder.improvementId;
          addEvent(`${imp.name} completed!`, 'gold');
        logAction('build', 'Improvement completed: ' + imp.name + ' at (' + c + ',' + r + ')', { improvement: builder.improvementId, col: c, row: r });
        }

        // Wake the worker and decrement build charges
        const worker = game.units.find(u => u.id === builder.unitId);
        if (worker) {
          if (worker.buildCharges !== undefined) {
            worker.buildCharges--;
            if (worker.buildCharges <= 0) {
              game.units = game.units.filter(u => u.id !== worker.id);
              if (game.selectedUnitId === worker.id) game.selectedUnitId = null;
              addEvent('Worker exhausted all build charges and was consumed', 'warning');
            } else {
              worker.sleeping = false;
            }
          } else {
            worker.sleeping = false;
          }
        }

        tile.improvementBuilder = null;
        showCompletionNotification('improvement', imp.name, imp.desc);
      }
    }
  }
}

export function getImprovementYields(tile) {
  let food = 0, prod = 0, gold = 0;
  if (tile.improvement && TILE_IMPROVEMENTS[tile.improvement]) {
    const imp = TILE_IMPROVEMENTS[tile.improvement];
    if (imp.yields.food) food += imp.yields.food;
    if (imp.yields.prod) prod += imp.yields.prod;
    if (imp.yields.gold) gold += imp.yields.gold;
    // Bonus for river adjacency on farms
    if (tile.improvement === 'farm' && tile.hasRiver) food += 1;
  }
  // Natural wonder yields
  if (tile.naturalWonder) {
    const nwDef = NATURAL_WONDERS.find(n => n.id === tile.naturalWonder);
    if (nwDef) {
      if (nwDef.yields.food) food += nwDef.yields.food;
      if (nwDef.yields.prod) prod += nwDef.yields.prod;
      if (nwDef.yields.gold) gold += nwDef.yields.gold;
    }
  }
  if (tile.road) gold += 1; // Roads generate trade gold
  return { food, prod, gold };
}

export function showWorkerActions(unitOrId) {
  const unit = typeof unitOrId === 'number' ? game.units.find(u => u.id === unitOrId) : unitOrId;
  if (!unit) return;
  const tile = game.map[unit.row][unit.col];
  const available = getAvailableImprovements(unit.col, unit.row);

  const panel = document.getElementById('selection-panel');
  const chargesLeft = unit.buildCharges !== undefined ? unit.buildCharges : null;
  const chargesDisplay = chargesLeft !== null ? ` (${chargesLeft} charge${chargesLeft !== 1 ? 's' : ''} left)` : '';
  let html = `<div class="panel-header"><h3>👷 Worker Actions</h3><button class="panel-close" onclick="hideSelectionPanel()">&times;</button></div>`;
  html += `<div class="panel-body" style="padding:8px">`;
  if (chargesLeft !== null) {
    const color = chargesLeft > 1 ? 'var(--color-gold)' : '#ff9800';
    html += `<p style="color:${color};margin-bottom:6px">Build charges: ${chargesLeft}</p>`;
  }

  // Show current improvement if building
  if (tile.improvementBuilder) {
    html += `<p style="color:var(--color-gold)">Building: ${TILE_IMPROVEMENTS[tile.improvementBuilder.improvementId]?.name} (${tile.improvementBuilder.turnsLeft} turns left)</p>`;
    html += `<button class="minor-btn" style="color:#ff6b6b" onclick="cancelImprovement(${unit.id});showWorkerActions(${unit.id})">✕ Cancel Build</button>`;
  }

  // Show existing improvement
  if (tile.improvement) {
    const existing = TILE_IMPROVEMENTS[tile.improvement];
    if (existing) html += `<p style="color:var(--color-text-muted)">Current: ${existing.icon} ${existing.name}</p>`;
  }
  if (tile.road) html += `<p style="color:var(--color-text-muted)">Has Road</p>`;

  if (chargesLeft !== null && chargesLeft <= 0) {
    html += `<p style="color:#d9534f;font-style:italic">This worker has no build charges remaining.</p>`;
  } else if (available.length === 0 && !tile.improvementBuilder) {
    html += `<p style="color:var(--color-text-faint);font-style:italic">City tile \u2014 move to an adjacent tile to build improvements</p>`;
  } else {
    for (const imp of available) {
      const yieldParts = [];
      if (imp.yields.food) yieldParts.push(`+${imp.yields.food} Food`);
      if (imp.yields.prod) yieldParts.push(`+${imp.yields.prod} Prod`);
      if (imp.yields.gold) yieldParts.push(`+${imp.yields.gold} Gold`);
      html += `<button class="minor-btn" onclick="startImprovement(${unit.id},'${imp.id}');showWorkerActions(${unit.id})">
        ${imp.icon} <strong>${imp.name}</strong> (${imp.turns} turns) — ${imp.desc}
      </button>`;
    }
  }

  // Standard unit actions
  html += `<div style="margin-top:8px;border-top:1px solid var(--color-border);padding-top:8px">`;
  html += `<button class="minor-btn" onclick="unitAction('skip')">Skip Turn</button>`;
  html += `<button class="minor-btn" onclick="unitAction('sleep')">Sleep</button>`;
  html += `</div>`;

  html += `</div>`;
  panel.innerHTML = html;
  panel.style.display = 'block';
}


export function showSettlerActions(unit) {
  const panel = document.getElementById('selection-panel');
  const tile = game.map[unit.row][unit.col];
  const canFound = canFoundCityAt(unit.col, unit.row);

  let html = `<div class="panel-header"><h3>🏕 Settler</h3><button class="panel-close" onclick="hideSelectionPanel()">&times;</button></div>`;
  html += `<div class="panel-body" style="padding:8px">`;

  if (canFound) {
    html += `<button class="minor-btn minor-btn-special" onclick="foundCity(${unit.id})" style="padding:10px;font-size:13px">🏛 <strong>Found City Here</strong><br><span style="font-size:11px;color:var(--color-text-muted)">Consumes the Settler to create a new city</span></button>`;
  } else {
    html += `<p style="color:var(--color-text-muted);font-style:italic">Cannot found city here:</p>`;
    if (tile.base === 'ocean' || tile.base === 'coast' || tile.base === 'lake') html += `<p style="color:#d9534f;font-size:12px">• Must be on land</p>`;
    if (tile.feature === 'mountain') html += `<p style="color:#d9534f;font-size:12px">• Cannot build on mountains</p>`;
    const tooClose = game.cities.some(c => hexDistance(unit.col, unit.row, c.col, c.row) < 4);
    if (tooClose) html += `<p style="color:#d9534f;font-size:12px">• Too close to an existing city (min 4 hexes)</p>`;
    const factionTooClose = Object.values(game.factionCities).some(fc => hexDistance(unit.col, unit.row, fc.col, fc.row) < 4);
    if (factionTooClose) html += `<p style="color:#d9534f;font-size:12px">• Too close to a foreign city</p>`;
  }

  html += `<div style="margin-top:8px;border-top:1px solid var(--color-border);padding-top:8px">`;
  html += `<button class="minor-btn" onclick="unitAction('skip')">Skip Turn</button>`;
  html += `<button class="minor-btn" onclick="unitAction('sleep')">Sleep</button>`;
  html += `</div></div>`;

  panel.innerHTML = html;
  panel.style.display = 'block';
}

export function canFoundCityAt(col, row) {
  const tile = game.map[row][col];
  // Must be passable land
  if (tile.base === 'ocean' || tile.base === 'coast' || tile.base === 'lake') return false;
  if (tile.feature === 'mountain') return false;
  // Must be 4+ hexes from any existing city
  for (const city of game.cities) {
    if (hexDistance(col, row, city.col, city.row) < 4) return false;
  }
  // Must be 4+ hexes from faction cities
  for (const fc of Object.values(game.factionCities)) {
    if (hexDistance(col, row, fc.col, fc.row) < 4) return false;
  }
  return true;
}

window.foundCity = function(unitId) {
  const unit = game.units.find(u => u.id === unitId);
  if (!unit || unit.type !== 'settler') return;
  if (!canFoundCityAt(unit.col, unit.row)) return;

  // Generate city name
  const cityNames = ['Nova', 'Farshore', 'Rimhold', 'Dusthaven', 'Greenreach', 'Stonebridge',
    'Thornwall', 'Ashford', 'Windhaven', 'Deepwell', 'Brightmoor', 'Ironvale',
    'Sandport', 'Mistwood', 'Goldcrest', 'Silverdale', 'Oakhollow', 'Riverton'];
  const usedNames = game.cities.map(c => c.name);
  const available = cityNames.filter(n => !usedNames.includes(n));
  const cityName = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : 'Colony ' + game.cities.length;

  // Create the city
  game.cities.push({
    name: cityName,
    col: unit.col,
    row: unit.row,
    buildings: [],
    population: 500,
    borderRadius: 1,
    cultureAccum: 0,
  });

  // Remove the settler
  game.units = game.units.filter(u => u.id !== unitId);
  game.selectedUnitId = null;

  // Reveal fog around new city
  revealAround(unit.col, unit.row, 5);

  // Score bonus
  game.score += 20;
  game.population += 500;

  addEvent('🏛 City of ' + cityName + ' founded!', 'gold');
  logAction('build', 'Founded city: ' + cityName + ' at (' + unit.col + ',' + unit.row + ')', { cityName, col: unit.col, row: unit.row });
  showCompletionNotification('building', cityName + ' Founded', 'New city established! Population: 500');

  hideSelectionPanel();
  updateUI();
  render();
};

window.startImprovement = startImprovement;

// ============================================
// MULTI-TURN WAYPOINT SYSTEM
// ============================================
export function processUnitWaypoint(unit) {
  if (!unit.waypoint) return;
  if (unit.col === unit.waypoint.col && unit.row === unit.waypoint.row) {
    unit.waypoint = null;
    addEvent(`${(UNIT_TYPES[unit.type]?.name || unit.type)} reached destination`, 'combat');
    return;
  }
  moveTowardWaypoint(unit);
}

export function moveTowardWaypoint(unit) {
  if (!unit.waypoint || unit.moveLeft <= 0) return;
  const target = unit.waypoint;
  // Greedy pathfinding: move toward target one step at a time
  let moved = true;
  while (unit.moveLeft > 0 && moved && !(unit.col === target.col && unit.row === target.row)) {
    moved = false;
    const neighbors = getHexNeighbors(unit.col, unit.row);
    let best = null, bestDist = hexDistance(unit.col, unit.row, target.col, target.row);
    for (const nb of neighbors) {
      const tile = game.map[nb.row][nb.col];
      if (!isTilePassable(tile)) continue;
      if (getUnitAt(nb.col, nb.row)) continue;
      const cost = getTileMoveCost(tile);
      if (cost >= 99) continue;
      const d = hexDistance(nb.col, nb.row, target.col, target.row);
      if (d < bestDist) { bestDist = d; best = nb; }
    }
    if (best) {
      const cost = getTileMoveCost(game.map[best.row][best.col]);
      unit.col = best.col;
      unit.row = best.row;
      // Civ-style: entering rough terrain uses all remaining movement
      unit.moveLeft = cost <= unit.moveLeft ? unit.moveLeft - cost : 0;
      unit.fortified = false;
      unit.sleeping = false;
      revealAround(unit.col, unit.row, unit.type === 'scout' ? 4 : 3);
      moved = true;
    }
  }
  if (unit.col === target.col && unit.row === target.row) {
    unit.waypoint = null;
  }
}

export function getWaypointPath(unit) {
  // Compute approximate path for visual display
  if (!unit.waypoint) return [];
  const path = [];
  let cx = unit.col, cy = unit.row;
  const tx = unit.waypoint.col, ty = unit.waypoint.row;
  for (let step = 0; step < 30; step++) {
    if (cx === tx && cy === ty) break;
    const neighbors = getHexNeighbors(cx, cy);
    let best = null, bestDist = hexDistance(cx, cy, tx, ty);
    for (const nb of neighbors) {
      if (!isTilePassable(game.map[nb.row][nb.col])) continue;
      const d = hexDistance(nb.col, nb.row, tx, ty);
      if (d < bestDist) { bestDist = d; best = nb; }
    }
    if (!best) break;
    cx = best.col; cy = best.row;
    path.push({ col: cx, row: cy });
  }
  return path;
}
