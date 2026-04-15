import { UNIT_TYPES, UNIT_UPGRADES, UNIT_UNLOCKS, UNIT_PROMOTIONS, PROMOTION_PATHS, PROMOTION_XP_THRESHOLDS, BUILDINGS, TECHNOLOGIES, CIVICS, GOVERNMENTS, WONDERS, FACTIONS, BASE_TERRAIN, RESOURCES, TILE_IMPROVEMENTS, MAX_TURNS, goldCost, UNIT_MAINTENANCE, CITY_DEFENSE, HEX_SIZE, SQRT3, DISTRICTS, TERRAIN_FEATURES, UNIT_RESOURCE_REQUIREMENTS } from './constants.js';
import { getNextUnitId } from './state.js';
import { game, canvasW, canvasH, gameZoom } from './state.js';
import { hexToPixel, hexDistance } from './hex.js';
import { getTileYields, getTileName, isResourceRevealed, hasResourceAccess } from './map.js';
import { render } from './render.js';
import { addEvent, logAction, showToast, showCompletionNotification } from './events.js';
import { selectUnit, deselectUnit, applyPromotion, upgradeUnit, selectNextUnit, moveUnitTo } from './units.js';
import { getRelationLabel, getWarAwareRelationLabel } from './diplomacy-api.js';
import { getModCombatBonus } from './diplomacy-api.js';
import { isAtWarWith, declareSurpriseWar, confirmAndDeclareWar } from './combat.js';
import { showWorkerActions, showSettlerActions } from './improvements.js';
import { updateUI, updateEnvoyUI } from './leaderboard.js';
import { autoSelectNext, computeAttackRange } from './units.js';
import { getHexNeighbors } from './hex.js';
import { renderDiplomacyWithIntel, switchDiploTab } from './intelligence.js';
import { renderAdvisorPanel, isAdvisorChatActive, closeAdvisorChat } from './diplomacy-api.js';
import { MAP_COLS, MAP_ROWS, GREAT_PEOPLE_TYPES, PANTHEONS } from './constants.js';
import { isTilePassable, getTileMoveCost } from './map.js';
import { openChat, establishTradeRoute, cancelTradeRoute, renderDiplomacyPanel } from './diplomacy-api.js';
import { useGreatPerson } from './buildings.js';
import { hexToRgba } from './utils.js';
import { attachToArmy, detachFromArmy, coordinatedAttack, getGeneralCapacity, generalHeal, generalPillage } from './units.js';
import { getTileOwner } from './units.js';
import { calculateCityHousing, getHousingGrowthModifier } from './housing.js';

function showSelectionPanel(unit) {
  // Special panel for workers
  if (unit.type === 'worker' && unit.owner === 'player') {
    showWorkerActions(unit);
    return;
  }
  // Special panel for settlers
  if (unit.type === 'settler' && unit.owner === 'player') {
    showSettlerActions(unit);
    return;
  }
  // Special panel for Great General
  if (unit.type === 'great_general' && unit.owner === 'player') {
    showGeneralPanel(unit);
    return;
  }
  const panel = document.getElementById('selection-panel');
  const ut = UNIT_TYPES[unit.type] || { icon: '❓', class: 'civilian', name: unit.type, combat: 0, rangedCombat: 0, range: 0, movePoints: 2, desc: '', cost: 0 };
  const tile = game.map[unit.row][unit.col];
  const isPlayer = unit.owner === 'player';

  let html = '';

  if (isPlayer) {
    // YOUR UNIT PANEL
    html += `<div class="sel-header">
      <div class="sel-icon" style="background:rgba(201,168,76,0.2);border-color:#c9a84c">${ut.icon}</div>
      <div class="sel-info">
        <div class="sel-name">${ut.name}</div>
        <div class="sel-sub">${ut.desc}</div>
      </div>
    </div>`;

    html += `<div class="sel-stats">
      <div class="sel-stat"><span class="sel-stat-label">HP</span><span class="sel-stat-value">${unit.hp}%</span></div>
      <div class="sel-stat"><span class="sel-stat-label">Combat</span><span class="sel-stat-value">${ut.combat}</span></div>`;
    if (ut.rangedCombat > 0) {
      html += `<div class="sel-stat"><span class="sel-stat-label">Ranged</span><span class="sel-stat-value">${ut.rangedCombat} (${ut.range})</span></div>`;
    }
    html += `<div class="sel-stat"><span class="sel-stat-label">Moves</span><span class="sel-stat-value">${unit.moveLeft}/${ut.movePoints}</span></div>
      <div class="sel-stat"><span class="sel-stat-label">Class</span><span class="sel-stat-value">${ut.class}</span></div>
      <div class="sel-stat" style="grid-column:1/-1"><span class="sel-stat-label">Terrain</span><span class="sel-stat-value">${getTileName(tile)}</span></div>
    </div>`;

    // Status
    if (unit.fortified) html += `<div class="sel-status fortified">\u{1F6E1} Fortified (+20% defense)</div>`;
    if (unit.sleeping) html += `<div class="sel-status sleeping">\u{1F4A4} Sleeping</div>`;
    if (unit.waypoint) html += `<div class="sel-status" style="color:#c9a84c">\u{1F6A9} En route to (${unit.waypoint.col},${unit.waypoint.row})</div>`;

    // XP & Promotions
    const xpStr = (unit.xp || 0) + ' XP';
    const promoIcons = (unit.promotions || []).map(pid => { const p = UNIT_PROMOTIONS[pid]; return p ? '<span title="' + p.name + ': ' + p.desc + '">' + p.icon + '</span>' : ''; }).join(' ');
    html += '<div class="sel-status" style="color:#ffd700;font-size:11px">' + xpStr + (promoIcons ? ' | ' + promoIcons : '') + '</div>';
    if (unit.pendingPromotion) {
      html += '<div style="margin:6px 0;padding:8px;background:rgba(255,215,0,0.1);border:1px solid #ffd700;border-radius:6px"><p style="color:#ffd700;font-size:12px;margin-bottom:6px;font-weight:600">\u2B50 Promotion Available!</p>';
      const uClass = ut.class;
      const path = PROMOTION_PATHS[uClass] || PROMOTION_PATHS.melee;
      const promoLevel = (unit.promotions || []).length;
      const choices = promoLevel < path.length ? path[promoLevel] : path[path.length - 1];
      for (const pid of choices) {
        if ((unit.promotions || []).includes(pid)) continue;
        const p = UNIT_PROMOTIONS[pid];
        if (!p) continue;
        html += '<button class="sel-btn" style="margin:2px 0;width:100%;text-align:left;border-color:#ffd700" onclick="applyPromotion(' + unit.id + ',\'' + pid + '\')">' + p.icon + ' ' + p.name + ' \u2014 ' + p.desc + '</button>';
      }
      html += '</div>';
    }


    // Action buttons
    html += `<div class="sel-actions">`;
    // Great Person activation button
    const gpDef = GREAT_PEOPLE_TYPES.find(g => g.type === unit.type);
    if (gpDef) {
      html += `<button class="sel-btn" style="border-color:#ffd700;background:rgba(255,215,0,0.1)" onclick="activateGreatPersonFromUnit(${unit.id})"><span>${gpDef.icon} Activate — ${gpDef.effect}</span></button>`;
    }
    // Cancel waypoint journey
    if (unit.waypoint) {
      html += `<button class="sel-btn" style="border-color:#c9a84c" onclick="unitAction('cancelWaypoint')"><span>\u{1F6A9} Cancel Journey</span></button>`;
    }
    // Unit upgrade button
    const upg = UNIT_UPGRADES[unit.type];
    if (upg && game.techs.includes(upg.requires)) {
      const canAfford = game.gold >= upg.cost;
      const newDef = UNIT_TYPES[upg.to];
      html += '<button class="sel-btn" style="border-color:' + (canAfford ? '#4a9' : '#666') + ';opacity:' + (canAfford ? '1' : '0.5') + '" ' + (canAfford ? 'onclick="upgradeUnit(' + unit.id + ')"' : 'disabled') + '><span>' + (newDef ? newDef.icon : '') + ' Upgrade to ' + (newDef ? newDef.name : upg.to) + ' (' + upg.cost + 'g)</span></button>';
    }
    // Activate button for fortified/sleeping units
    if (unit.fortified || unit.sleeping) {
      html += `<button class="sel-btn" style="border-color:#6aab5c" onclick="unitAction('activate')"><span>\u{26A1} Activate</span><span class="sel-key">W</span></button>`;
    }
    if (unit.moveLeft > 0) {
      html += `<button class="sel-btn" onclick="unitAction('skip')"><span>Skip</span><span class="sel-key">S</span></button>`;
      if (!unit.fortified) {
        html += `<button class="sel-btn" onclick="unitAction('fortify')"><span>Fortify</span><span class="sel-key">F</span></button>`;
      }
      if (unit.hp < 100) {
        html += `<button class="sel-btn" onclick="unitAction('heal')"><span>Heal</span><span class="sel-key">H</span></button>`;
      }
      // Pillage: available if on a tile with an improvement/road NOT in player territory
      const pillTile = game.map[unit.row][unit.col];
      let isPlayerTile = false;
      for (const pc of (game.cities || [])) {
        if (hexDistance(unit.col, unit.row, pc.col, pc.row) <= (pc.borderRadius || 2)) { isPlayerTile = true; break; }
      }
      const canPillage = pillTile && (pillTile.improvement || pillTile.road) && ut.combat > 0 && !isPlayerTile;
      if (canPillage) {
        html += `<button class="sel-btn" style="border-color:#d9534f" onclick="unitAction('pillage')"><span>\u{1F525} Pillage</span><span class="sel-key">P</span></button>`;
      }
      html += `<button class="sel-btn" onclick="unitAction('sleep')"><span>Sleep</span><span class="sel-key">Z</span></button>`;
      html += `<button class="sel-btn" onclick="unitAction('alert')"><span>Alert</span><span class="sel-key">A</span></button>`;
    }
    // Attack City button — show if adjacent to an enemy city (even with 0 move points)
    if (ut.combat > 0 && !unit.hasAttackedThisTurn) {
      const attackRange = computeAttackRange();
      if (attackRange) {
        for (const [key, tid] of attackRange.entries()) {
          if (typeof tid === 'string' && (tid.startsWith('city_') || tid.startsWith('expcity_'))) {
            const [tc, tr] = key.split(',').map(Number);
            let cityName = '';
            if (tid.startsWith('city_')) {
              const fid = tid.replace('city_', '');
              cityName = game.factionCities[fid] ? game.factionCities[fid].name : fid;
            } else {
              const parts = tid.split('_');
              const fid = parts[1], ci = parseInt(parts[2]);
              const ecs = game.aiFactionCities[fid];
              cityName = (ecs && ecs[ci]) ? ecs[ci].name : fid;
            }
            html += '<button class="sel-btn" style="border-color:#d9534f;background:rgba(217,83,79,0.1)" onclick="handleHexClick(' + tc + ',' + tr + ')"><span>\u2694\uFE0F Attack ' + cityName + '</span></button>';
            break;
          }
        }
      }
    }
    // Show adjacent enemy city attack button
    if (ut.combat > 0) {
      const adjNeighbors = getHexNeighbors(unit.col, unit.row);
      for (const nb of adjNeighbors) {
        for (const [fid, fc] of Object.entries(game.factionCities)) {
          if (fc.col === nb.col && fc.row === nb.row) {
            if (!unit.hasAttackedThisTurn) {
              html += `<button class="sel-btn" style="border-color:#e03030;color:#ff4444;background:rgba(220,40,40,0.15);font-weight:bold" onclick="handleHexClick(${nb.col},${nb.row})"><span>\u2694 Attack ${fc.name}</span></button>`;
            } else {
              html += `<div style="color:#ff6666;font-size:11px;padding:6px;margin-top:4px;border:1px solid rgba(220,60,60,0.3);border-radius:4px;text-align:center">\u2694 ${fc.name} adjacent \u2014 attack next turn</div>`;
            }
          }
        }
      }
    }
    // Attack Barbarian Camp button — available if combat unit is adjacent to a barbarian camp
    if (ut.combat > 0 && game.barbarianCamps) {
      const adjNeighbors = getHexNeighbors(unit.col, unit.row);
      for (const nb of adjNeighbors) {
        const bc = game.barbarianCamps.find(c => c.col === nb.col && c.row === nb.row && !c.destroyed);
        if (bc) {
          html += `<button class="sel-btn" style="border-color:#d9534f;background:rgba(217,83,79,0.1)" onclick="interactWithBarbarianCamp('${bc.id}')"><span>\u2694\uFE0F Attack Barbarian Camp</span></button>`;
          break;
        }
      }
    }
    // Gift Unit button — available if any factions discovered
    const discoveredFactions = Object.keys(game.relationships || {}).filter(fid => FACTIONS[fid]);
    if (discoveredFactions.length > 0 && unit.moveLeft > 0) {
      html += `<button class="sel-btn" style="border-color:#9b59b6;background:rgba(155,89,182,0.1)" onclick="showGiftUnitPanel(${unit.id})"><span>\u{1F381} Gift Unit</span></button>`;
    }
    html += `<button class="sel-btn sel-btn-danger" onclick="unitAction('delete')"><span>Delete</span><span class="sel-key">Del</span></button>`;
    html += `</div>`;
  } else {
    // FOREIGN UNIT PANEL
    const faction = FACTIONS[unit.owner];
    const fName = faction ? faction.name : unit.owner;
    const fColor = faction ? faction.color : '#888';
    const rel = game.relationships[unit.owner] || 0;
    const relLabel = getWarAwareRelationLabel(unit.owner, rel);

    html += `<div class="sel-header">
      <div class="sel-icon" style="background:${hexToRgba(fColor, 0.2)};border-color:${fColor}">${ut.icon}</div>
      <div class="sel-info">
        <div class="sel-name" style="color:${fColor}">${ut.name}</div>
        <div class="sel-sub">${fName}</div>
      </div>
      <span class="char-relation ${relLabel.cls}" style="font-size:10px">${relLabel.text}</span>
    </div>`;

    html += `<div class="sel-stats">
      <div class="sel-stat"><span class="sel-stat-label">HP</span><span class="sel-stat-value">${unit.hp > 75 ? 'Healthy' : unit.hp > 50 ? 'Wounded' : unit.hp > 25 ? 'Injured' : 'Critical'}</span></div>
      <div class="sel-stat"><span class="sel-stat-label">Class</span><span class="sel-stat-value">${ut.class}</span></div>
      <div class="sel-stat"><span class="sel-stat-label">Strength</span><span class="sel-stat-value">${ut.combat > 20 ? 'Strong' : ut.combat > 10 ? 'Average' : 'Weak'}</span></div>
    </div>`;

    html += `<div class="sel-actions">
      <button class="sel-btn" onclick="openChat('${unit.owner}')"><span>Diplomacy</span></button>
    </div>`;
  }

  panel.innerHTML = html;
  panel.style.display = 'block';
  document.getElementById('tile-info').style.display = 'none';
}

function showGiftUnitPanel(unitId) {
  const unit = game.units.find(u => u.id === unitId);
  if (!unit) return;
  const ut = UNIT_TYPES[unit.type];
  const panel = document.getElementById('selection-panel');
  const discoveredFactions = Object.keys(game.relationships || {}).filter(fid => FACTIONS[fid]);

  let html = `<div class="sel-header">
    <div class="sel-icon" style="background:rgba(155,89,182,0.2);border-color:#9b59b6">\u{1F381}</div>
    <div class="sel-info">
      <div class="sel-name">Gift ${ut.name}</div>
      <div class="sel-sub">Choose a faction to receive this unit</div>
    </div>
  </div>`;

  html += `<div class="sel-actions">`;
  for (const fid of discoveredFactions) {
    const f = FACTIONS[fid];
    const rel = game.relationships[fid] || 0;
    const relLabel = getRelationLabel(rel);
    html += `<button class="sel-btn" style="border-color:${f.color}" onclick="giftUnit(${unitId},'${fid}')">
      <span style="color:${f.color}">${f.name}</span>
      <span class="sel-key" style="font-size:10px">${relLabel.text}</span>
    </button>`;
  }
  html += `<button class="sel-btn" onclick="selectUnit(${unitId})"><span>Cancel</span></button>`;
  html += `</div>`;

  panel.innerHTML = html;
  panel.style.display = 'block';
}

function giftUnit(unitId, factionId) {
  const unitIdx = game.units.findIndex(u => u.id === unitId);
  if (unitIdx === -1) return;
  const unit = game.units[unitIdx];
  const ut = UNIT_TYPES[unit.type];
  const faction = FACTIONS[factionId];
  if (!faction) return;

  // Transfer ownership
  unit.owner = factionId;
  unit.moves = 0;
  unit.moveLeft = 0;
  unit.sleeping = false;
  unit.fortified = false;

  // Relationship boost: scales with unit value
  const unitCost = ut.cost || 40;
  const relBoost = Math.floor(unitCost / 4) + 5; // 15 for warrior (cost 40), more for expensive units
  game.relationships[factionId] = (game.relationships[factionId] || 0) + relBoost;

  addEvent(`Gifted ${ut.name} to ${faction.name} (+${relBoost} relations)`, 'diplomacy');
  showToast('Unit Gifted', `${ut.icon} ${ut.name} gifted to ${faction.name}\n+${relBoost} relations`);
  logAction('diplomacy', 'gift_unit', { unitType: unit.type, faction: factionId, relBoost });

  // Deselect and close panel
  hideSelectionPanel();
  deselectUnit();
}

function showGeneralPanel(unit) {
  const panel = document.getElementById('selection-panel');
  const ut = UNIT_TYPES[unit.type];
  const army = unit.army || [];
  const cap = getGeneralCapacity(unit);
  const xp = unit.xp || 0;
  const nextThreshold = xp < 20 ? 20 : xp < 50 ? 50 : null;

  let html = `<div class="sel-header">
    <div class="sel-icon" style="background:rgba(201,168,76,0.2);border-color:#c9a84c">${ut.icon}</div>
    <div class="sel-info">
      <div class="sel-name" style="color:#ffd700">Great General</div>
      <div class="sel-sub">Army: ${army.length}/${cap} units${nextThreshold ? ' \u00B7 Next slot at ' + nextThreshold + ' XP' : ' \u00B7 Max capacity'}</div>
    </div>
  </div>`;

  html += `<div class="sel-stats">
    <div class="sel-stat"><span class="sel-stat-label">Moves</span><span class="sel-stat-value">${unit.moveLeft}/${ut.movePoints}</span></div>
    <div class="sel-stat"><span class="sel-stat-label">XP</span><span class="sel-stat-value">${xp}</span></div>
    <div class="sel-stat"><span class="sel-stat-label">Capacity</span><span class="sel-stat-value">${cap} units</span></div>
  </div>`;

  // Army roster
  if (army.length > 0) {
    html += '<div style="margin:8px 0;border-top:1px solid var(--color-border);padding-top:6px">';
    html += '<p style="color:#c9a84c;font-size:11px;margin-bottom:4px;font-weight:600">Army Roster:</p>';
    for (let i = 0; i < army.length; i++) {
      const u = army[i];
      const aut = UNIT_TYPES[u.type];
      if (!aut) continue;
      const hpColor = u.hp > 60 ? '#6aab5c' : u.hp > 30 ? '#ddc060' : '#d9534f';
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px">
        <span>${aut.icon} ${aut.name} <span style="color:${hpColor}">${u.hp}HP</span> <span style="color:#888">C:${u.combat || aut.combat}</span></span>
        <button class="sel-btn" style="padding:2px 8px;font-size:10px;margin:0" onclick="window.detachFromArmy(${unit.id},${i})">Detach</button>
      </div>`;
    }
    html += '</div>';
  }

  html += '<div class="sel-actions">';

  // Attach nearby units button
  if (army.length < cap) {
    const nearby = game.units.filter(u =>
      u.owner === 'player' && u.id !== unit.id &&
      UNIT_TYPES[u.type]?.combat > 0 && u.type !== 'great_general' &&
      hexDistance(u.col, u.row, unit.col, unit.row) <= 1
    );
    for (const nu of nearby) {
      const nut = UNIT_TYPES[nu.type];
      html += `<button class="sel-btn" style="border-color:#c9a84c" onclick="window.attachToArmy(${unit.id},${nu.id})"><span>${nut.icon} Attach ${nut.name}</span></button>`;
    }
    if (nearby.length === 0 && army.length === 0) {
      html += '<div style="color:#888;font-size:11px;padding:6px;text-align:center;font-style:italic">Move adjacent to military units to attach them</div>';
    }
  }

  // Coordinated attack button — show enemy targets adjacent to general
  if (army.length > 0 && unit.moveLeft > 0 && !unit.hasAttackedThisTurn) {
    const adjEnemies = game.units.filter(u =>
      u.owner !== 'player' &&
      hexDistance(u.col, u.row, unit.col, unit.row) <= 1 &&
      UNIT_TYPES[u.type]?.combat > 0
    );
    for (const enemy of adjEnemies) {
      const et = UNIT_TYPES[enemy.type];
      const fName = FACTIONS[enemy.owner]?.name || enemy.owner;
      html += `<button class="sel-btn" style="border-color:#e03030;color:#ff4444;background:rgba(220,40,40,0.15);font-weight:bold" onclick="window.coordinatedAttack(${unit.id},${enemy.col},${enemy.row})"><span>\u{2694} Coordinated Attack: ${et.name} (${fName})</span></button>`;
    }
  }

  // Heal — always available when the general has moves and someone needs healing
  const generalHp = unit.hp !== undefined ? unit.hp : 100;
  const anyArmyInjured = army.some(u => (u.hp || 100) < 100);
  if (unit.moveLeft > 0 && (generalHp < 100 || anyArmyInjured)) {
    html += `<button class="sel-btn" style="border-color:#6aab5c;color:#8fd87f" onclick="window.generalHeal(${unit.id})"><span>\u2764\uFE0F Rest & Heal (+25 HP, ends turn)</span></button>`;
  }

  // Pillage — when standing on a tile that isn't player-owned
  if (unit.moveLeft > 0) {
    const pillageTile = game.map[unit.row]?.[unit.col];
    const pillageTileOwner = getTileOwner(unit.col, unit.row);
    const canPillage = pillageTile && pillageTileOwner !== 'player' &&
      (pillageTile.improvement || pillageTile.road || pillageTileOwner !== null);
    if (canPillage) {
      const label = pillageTile.improvement
        ? `Pillage ${pillageTile.improvement} (+40 HP, +15g)`
        : pillageTile.road
          ? 'Pillage road (+20 HP, +5g)'
          : 'Scorch earth (+15 HP)';
      html += `<button class="sel-btn" style="border-color:#c45c4a;color:#ff8866" onclick="window.generalPillage(${unit.id})"><span>\uD83D\uDD25 ${label}</span></button>`;
    }
  }

  html += `<button class="sel-btn" onclick="unitAction('fortify')"><span>Fortify</span><span class="sel-key">F</span></button>`;
  html += `<button class="sel-btn" onclick="unitAction('sleep')"><span>Sleep</span><span class="sel-key">Z</span></button>`;
  html += `<button class="sel-btn sel-btn-danger" onclick="unitAction('delete')"><span>Delete</span><span class="sel-key">Del</span></button>`;
  html += '</div>';

  panel.innerHTML = html;
  panel.style.display = 'block';
  document.getElementById('tile-info').style.display = 'none';
}

function hideSelectionPanel() {
  document.getElementById('selection-panel').style.display = 'none';
  document.getElementById('tile-info').style.display = 'none';
}

function showTileInfo(col, row) {
  if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) return;
  if (!game.fogOfWar[row][col]) return;

  hideSelectionPanel();
  const tile = game.map[row][col];
  const yields = getTileYields(tile);
  const panel = document.getElementById('tile-info');

  document.getElementById('tile-info-title').textContent = getTileName(tile);

  let body = `<div class="tile-yields">`;
  if (yields.food > 0) body += `<span class="yield food">${yields.food} Food</span>`;
  if (yields.prod > 0) body += `<span class="yield prod">${yields.prod} Prod</span>`;
  if (yields.gold > 0) body += `<span class="yield gold">${yields.gold} Gold</span>`;
  if (yields.food === 0 && yields.prod === 0 && yields.gold === 0) body += `<span class="yield none">No yields</span>`;
  body += `</div>`;

  if (!isTilePassable(tile)) body += `<p style="color:var(--color-red)">Impassable</p>`;
  else body += `<p>Move cost: ${getTileMoveCost(tile)}</p>`;

  if (tile.hasRiver) body += `<p style="color:#4a9adc">\u{1F30A} River (+1 Gold · crossing costs all MP · -5 combat across)</p>`;

  if (tile.resource && RESOURCES[tile.resource] && isResourceRevealed(tile.resource)) {
    const res = RESOURCES[tile.resource];
    const bonusStr = Object.entries(res.bonus).map(([k, v]) => `+${v} ${k}`).join(', ');
    body += `<p style="color:${res.color}; margin-top:4px">${res.icon} ${res.name} (${bonusStr})</p>`;
  }

  document.getElementById('tile-info-body').innerHTML = body;
  panel.style.display = 'block';
  render();
}

function showCityPanel(cityData) {
  hideSelectionPanel();
  const panel = document.getElementById('tile-info');
  const isPlayer = cityData.owner === 'player';

  // Track selected city for production/purchase targeting
  if (isPlayer) {
    const idx = game.cities.findIndex(c => c.col === cityData.col && c.row === cityData.row);
    game.selectedCityIdx = idx >= 0 ? idx : 0;
  }

  let title, body;
  if (isPlayer) {
    title = `\u2605 ${cityData.name}`;
    const yields = computeCityYields(cityData);
    body = `<div class="tile-yields">
      <span class="yield food">${yields.food} Food</span>
      <span class="yield prod">${yields.prod} Prod</span>
      <span class="yield gold">${yields.gold} Gold</span>
    </div>`;
    body += `<p>Population: ${(cityData.population || game.population).toLocaleString()}</p>`;
    if (cityData.wallMaxHP > 0) {
      const wallPct = Math.round((cityData.wallHP / cityData.wallMaxHP) * 100);
      body += `<p style="color:#7090b0">Wall HP: ${cityData.wallHP}/${cityData.wallMaxHP} (${wallPct}%)</p>`;
    }
    if (cityData.hp !== undefined) {
      body += `<p style="color:#6aab5c">City HP: ${cityData.hp}/${CITY_DEFENSE.BASE_HP}</p>`;
    }

    // Housing display
    const { housing, sources } = calculateCityHousing(cityData);
    const effectivePop = Math.floor((cityData.population || 1000) / 500);
    const housingMod = getHousingGrowthModifier(housing, cityData.population || 1000);
    const housingColor = housingMod >= 1 ? '#6b8' : housingMod >= 0.5 ? '#db3' : housingMod > 0 ? '#d93' : '#d55';
    const housingLabel = housingMod >= 1 ? '' : housingMod >= 0.5 ? ' (Slow)' : housingMod > 0 ? ' (Very Slow)' : ' (Stagnant)';
    const sourceTip = sources.map(s => `${s.label}: +${s.value}`).join('\n');
    body += `<p style="color:${housingColor}" title="${sourceTip}">\u{1F3E0} Housing: ${housing}/${effectivePop}${housingLabel}</p>`;
    body += `<p>Buildings: ${game.buildings.length}</p>`;
    if (game.currentBuild) {
      const bdata = BUILDINGS.find(b => b.id === game.currentBuild);
      const pct = Math.floor((game.buildProgress / bdata.cost) * 100);
      body += `<p style="color:var(--color-gold)">Building: ${bdata.name} (${pct}%)</p>`;
    }
    body += `<div style="margin-top:8px"><button class="sel-btn" onclick="togglePanel('build-panel')">Production</button></div>`;
  } else {
    const faction = FACTIONS[cityData.owner];
    const fName = faction ? faction.name : cityData.owner;
    const fColor = faction ? faction.color : '#888';
    const rel = game.relationships[cityData.owner] || 0;
    const relLabel = getWarAwareRelationLabel(cityData.owner, rel);

    title = `\u{1F3F0} ${cityData.name}`;
    body = `<p style="color:${fColor}">${fName}</p>`;
    body += `<p><span class="char-relation ${relLabel.cls}">${relLabel.text} (${rel > 0 ? '+' : ''}${rel})</span></p>`;
    body += `<div style="margin-top:8px"><button class="sel-btn" onclick="openChat('${cityData.owner}')">Diplomacy</button></div>`;
  }

  document.getElementById('tile-info-title').textContent = title;
  document.getElementById('tile-info-body').innerHTML = body;
  panel.style.display = 'block';
  render();
}

function computeCityYields(cityData) {
  let food = 0, prod = 0, gold = 0;
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (hexDistance(c, r, cityData.col, cityData.row) <= 2) {
        const tile = game.map[r][c];
        const y = getTileYields(tile);
        food += y.food;
        prod += y.prod;
        gold += y.gold;
      }
    }
  }
  return { food, prod, gold };
}

function showCombatResult(attacker, defender, result) {
  const aType = UNIT_TYPES[attacker.type] || { name: attacker.type };
  const dType = UNIT_TYPES[defender.type] || { name: 'City' };
  const dOwner = defender.owner === 'barbarian' ? (defender.barbName || 'Barbarian') : (FACTIONS[defender.owner]?.name || defender.owner || 'Enemy');
  let msg = '';
  if (result.defenderDied) {
    msg = `${aType.name} destroyed ${dOwner}'s ${dType.name}!`;
    addEvent(msg, 'combat');
  } else if (result.attackerDied) {
    msg = `${aType.name} was destroyed attacking ${dOwner}'s ${dType.name}!`;
    addEvent(msg, 'combat');
  } else {
    msg = `${aType.name} dealt ${result.atkDamage} dmg, took ${result.defDamage} dmg`;
    addEvent(msg, 'combat');
  }
  logAction('combat', msg, { attacker: attacker.type, defender: defender.type, defOwner: defender.owner, ...result });
  updateUI();
  render();
}

function showDeleteConfirm(unit, ut) {
  const goldRefund = Math.floor(ut.cost / 4);
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box">
      <p>Delete <strong>${ut.name}</strong>?<br>You will receive <strong style="color:var(--color-gold)">${goldRefund} gold</strong>.</p>
      <div class="confirm-btns">
        <button class="btn btn-secondary btn-small" id="confirm-cancel">Cancel</button>
        <button class="btn btn-primary btn-small" id="confirm-delete" style="background:var(--color-red);color:#fff">Delete</button>
      </div>
    </div>`;
  document.getElementById('game-main').appendChild(overlay);
  document.getElementById('confirm-cancel').onclick = () => overlay.remove();
  document.getElementById('confirm-delete').onclick = () => {
    game.gold += goldRefund;
    game.units = game.units.filter(u => u.id !== unit.id);
    addEvent(`${ut.name} disbanded (+${goldRefund} gold)`, 'gold');
    deselectUnit();
    autoSelectNext();
    updateUI();
    render();
    overlay.remove();
  };
}

function togglePanel(id) {
  const panel = document.getElementById(id);
  if (panel.style.display === 'none' || !panel.style.display) {
    closeAllPanels();
    panel.style.display = 'block';
    if (id === 'diplomacy-panel') { switchDiploTab('leaders'); }
    if (id === 'build-panel') renderBuildPanel();
    if (id === 'research-panel') renderResearchPanel();
    if (id === 'units-panel') renderUnitsPanel();
    if (id === 'civics-panel') renderCivicsPanel();
    if (id === 'advisor-panel') renderAdvisorPanel();
  } else {
    panel.style.display = 'none';
  }
}

function closeAllPanels() {
  if (isAdvisorChatActive()) closeAdvisorChat();
  ['diplomacy-panel', 'chat-panel', 'build-panel', 'research-panel', 'tile-info', 'turn-summary', 'game-over', 'units-panel', 'selection-panel', 'civics-panel', 'victory-panel', 'leaderboard-panel', 'advisor-panel', 'government-panel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function renderUnitsPanel() {
  const container = document.getElementById('units-options');
  if (!container) return;
  container.innerHTML = '';

  const playerUnits = game.units.filter(u => u.owner === 'player');

  // Current units list — grouped by type
  if (playerUnits.length > 0) {
    const header = document.createElement('p');
    header.style.cssText = 'color:var(--color-text-muted); margin-bottom:8px; font-size:12px';
    header.textContent = `Your Forces (${playerUnits.length} units)`;
    container.appendChild(header);

    // Group units by type
    const grouped = {};
    for (const unit of playerUnits) {
      if (!grouped[unit.type]) grouped[unit.type] = [];
      grouped[unit.type].push(unit);
    }

    for (const [typeId, units] of Object.entries(grouped)) {
      const ut = UNIT_TYPES[typeId];
      if (!ut) continue;
      const count = units.length;
      const ready = units.filter(u => u.moveLeft > 0 && !u.sleeping && !u.fortified).length;
      const wounded = units.filter(u => u.hp < 100).length;
      const statusParts = [];
      if (ready > 0) statusParts.push(ready + ' ready');
      if (wounded > 0) statusParts.push(wounded + ' wounded');
      const sleeping = units.filter(u => u.sleeping).length;
      const fortified = units.filter(u => u.fortified).length;
      if (sleeping > 0) statusParts.push(sleeping + ' \u{1F4A4}');
      if (fortified > 0) statusParts.push(fortified + ' \u{1F6E1}');

      const div = document.createElement('div');
      div.className = 'build-item';
      div.style.cursor = 'pointer';
      div.innerHTML = `
        <div class="item-info">
          <div class="item-name">${ut.icon} ${ut.name}${count > 1 ? ' \u00D7' + count : ''}</div>
          <div class="item-desc">${statusParts.length ? statusParts.join(' \u00B7 ') : 'Idle'} | Combat: ${ut.combat}</div>
        </div>
        <div class="item-cost" style="color:#c9a84c">${ut.class}</div>
      `;
      // Click cycles through units of this type
      let clickIdx = 0;
      div.addEventListener('click', () => {
        closeAllPanels();
        selectUnit(units[clickIdx % units.length]);
        clickIdx++;
      });
      container.appendChild(div);
    }
  }

  // Recruit section
  const hasBarracks = game.buildings.includes('barracks');
  const recruitHeader = document.createElement('p');
  recruitHeader.style.cssText = 'color:var(--color-gold); margin-top:12px; margin-bottom:8px; font-size:12px; border-top:1px solid var(--color-border); padding-top:8px';
  recruitHeader.textContent = hasBarracks ? 'Recruit New Unit' : 'Build Barracks to recruit advanced units';
  container.appendChild(recruitHeader);

  for (const [typeId, ut] of Object.entries(UNIT_TYPES)) {
    const requiredTech = UNIT_UNLOCKS[typeId];
    const techUnlocked = !requiredTech || game.techs.includes(requiredTech);
    const needsBarracks = !['scout', 'warrior', 'slinger', 'archer', 'worker', 'settler'].includes(typeId);
    const needsPop = typeId === 'settler' && game.population < 2000;
    const canRecruit = techUnlocked && (!needsBarracks || hasBarracks) && !needsPop;
    const reason = !techUnlocked ? `Requires ${getTechNameById(requiredTech)}` : (needsBarracks && !hasBarracks) ? 'Requires Barracks' : needsPop ? 'Requires population 2,000+' : '';
    const prodBusy = game.currentBuild || game.currentUnitBuild || game.currentWonderBuild || game.currentDistrictBuild;
    // Resource requirement check for substitute mechanic
    const resReq = UNIT_RESOURCE_REQUIREMENTS[typeId];
    const hasRes = resReq ? hasResourceAccess(resReq.resource, 'player') : true;
    const effectiveProdCost = hasRes ? ut.cost : Math.ceil(ut.cost * resReq.costMultiplier);
    const gCost = goldCost(effectiveProdCost);
    const canBuy = canRecruit && game.gold >= gCost;
    const turns = Math.ceil(effectiveProdCost / Math.max(1, game.productionPerTurn));
    const resWarning = (resReq && !hasRes) ? `<div style="color:#ff6b6b;font-size:11px">\u26A0 ${resReq.label}</div>` : '';

    const div = document.createElement('div');
    const disabled = !canRecruit && !canBuy;
    div.className = 'build-item' + (disabled ? ' item-disabled' : '') + (!canRecruit && canBuy ? ' has-gold-option' : '');
    div.innerHTML = `
      <div class="item-info">
        <div class="item-name">${ut.icon} ${ut.name}</div>
        <div class="item-desc">${ut.desc}${reason ? ` — ${reason}` : ''}</div>
        ${resWarning}
      </div>
      <div class="item-cost-group">
        <span class="cost-prod${canRecruit && !prodBusy ? '' : ' cost-na'}">${prodBusy && canRecruit ? 'Busy' : turns + 'T'}</span>
        ${canRecruit ? `<span class="cost-gold${canBuy ? '' : ' cost-na'}" title="Buy instantly with gold">${gCost}g</span>` : ''}
      </div>
    `;
    if (canBuy) {
      div.addEventListener('click', ((uid) => (e) => { e.stopPropagation(); purchaseUnit(uid); })(typeId));
    } else if (canRecruit && !prodBusy) {
      div.addEventListener('click', () => recruitUnit(typeId));
    } else if (canRecruit && prodBusy) {
      div.addEventListener('click', () => addEvent('Production busy — need ' + gCost + 'g to buy with gold (have ' + game.gold + 'g)', 'gold'));
    }
    container.appendChild(div);
  }
}

function getCurrentProductionName() {
  if (game.currentBuild) {
    const bd = BUILDINGS.find(b => b.id === game.currentBuild);
    return bd ? bd.name : game.currentBuild;
  }
  if (game.currentUnitBuild) {
    const ut = UNIT_TYPES[game.currentUnitBuild];
    return ut ? ut.name : game.currentUnitBuild;
  }
  if (game.currentWonderBuild) {
    const wd = WONDERS.find(w => w.id === game.currentWonderBuild);
    return wd ? wd.name : game.currentWonderBuild;
  }
  return null;
}

function switchProduction(startFn) {
  const currentName = getCurrentProductionName();
  if (!currentName) { startFn(); return; }
  const agreed = confirm('Cancel ' + currentName + '? All progress will be lost.');
  if (!agreed) return;
  cancelProduction();
  startFn();
}

function switchBuildCity(dir) {
  if (game.cities.length <= 1) return;
  const idx = (game.selectedCityIdx || 0) + dir;
  game.selectedCityIdx = ((idx % game.cities.length) + game.cities.length) % game.cities.length;
  renderBuildPanel();
}

function getNearestCityIndex() {
  if (game.cities.length <= 1) return 0;
  // Use explicitly selected city if available
  if (game.selectedCityIdx != null && game.selectedCityIdx < game.cities.length) {
    return game.selectedCityIdx;
  }
  // Fallback: find city closest to camera center
  const camCenterCol = Math.floor((game.cameraX + (canvasW / 2) / gameZoom) / (HEX_SIZE * SQRT3));
  const camCenterRow = Math.floor((game.cameraY + (canvasH / 2) / gameZoom) / (HEX_SIZE * 1.5));
  let bestIdx = 0, bestDist = Infinity;
  for (let i = 0; i < game.cities.length; i++) {
    const d = hexDistance(camCenterCol, camCenterRow, game.cities[i].col, game.cities[i].row);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

function recruitUnit(typeId) {
  const ut = UNIT_TYPES[typeId];
  if (typeId === 'settler' && game.population < 2000) {
    addEvent('Need population 2,000+ to train Settler (current: ' + game.population.toLocaleString() + ')', 'combat');
    return;
  }
  const doRecruit = () => {
    game.currentUnitBuild = typeId;
    game.unitBuildProgress = 0;
    // Track which city is building (closest to camera center)
    game.unitBuildCityIdx = getNearestCityIndex();
    const rResReq = UNIT_RESOURCE_REQUIREMENTS[typeId];
    const rHasRes = rResReq ? hasResourceAccess(rResReq.resource, 'player') : true;
    const rEffCost = rHasRes ? ut.cost : Math.ceil(ut.cost * rResReq.costMultiplier);
    const turnsNeeded = Math.ceil(rEffCost / Math.max(1, game.productionPerTurn));
    const buildCityName = game.cities[game.unitBuildCityIdx]?.name || 'city';
    logAction('build', 'Started training ' + ut.name + ' in ' + buildCityName, { unitType: typeId });
    const rWarnMsg = (!rHasRes && rResReq) ? ' \u26A0 ' + rResReq.label : '';
    addEvent('Training ' + ut.name + ' in ' + buildCityName + ' (' + turnsNeeded + ' turns)' + rWarnMsg, 'combat');
    if (typeId === 'settler') addEvent('Settler will consume 500 population when complete', 'gold');
    updateUI();
    closeAllPanels();
    render();
  };
  if (game.currentBuild || game.currentUnitBuild || game.currentWonderBuild) {
    switchProduction(doRecruit);
  } else {
    doRecruit();
  }
}

function checkVictoryConditions() {
  const aliveFactions = Object.keys(game.factionCities || {}).length;
  if (aliveFactions === 0) { game.score += 200; return { type: 'domination', desc: 'You conquered all civilizations! (+200 score)', icon: '\u2694' }; }
  const allTechs = TECHNOLOGIES.filter(t => !t.id.startsWith('mod_'));
  if (game.techs.length >= allTechs.length) return { type: 'science', desc: 'You achieved technological supremacy!', icon: '\u{1F52C}' };
  if (game.civics.length >= CIVICS.length) return { type: 'culture', desc: 'Your culture is legendary!', icon: '\u{1F3A8}' };
  if (game.turn >= MAX_TURNS && !game.postVictoryPlay) return { type: 'score', desc: 'Your civilization endures!', icon: '\u{1F3C6}' };
  return null;
}

function ensureVictoryPanel() {
  let panel = document.getElementById('victory-panel');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'victory-panel';
  panel.className = 'panel';
  panel.style.cssText = 'display:none;position:fixed;top:60px;right:10px;width:320px;max-height:65vh;overflow-y:auto;background:var(--color-panel-bg,#1a1a2e);border:1px solid var(--color-border,#333);border-radius:8px;padding:16px;z-index:200;color:#e0e0e0;font-size:13px';
  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0;color:#ffd700;font-size:15px">\u{1F3C6} Victory Progress</h3><button class="panel-close" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer" onclick="this.closest(\'.panel\').style.display=\'none\'">\u2715</button></div><div id="victory-options"></div>';
  document.body.appendChild(panel);
  return panel;
}

function renderVictoryPanel() {
  const panel = ensureVictoryPanel();
  const c = panel.querySelector('#victory-options');
  c.innerHTML = '';
  const allTechs = TECHNOLOGIES.filter(t => !t.id.startsWith('mod_'));
  const aliveFactions = Object.keys(game.factionCities || {}).length;
  const totalFactions = Object.keys(FACTIONS).length;
  const items = [
    { name: '\u2694 Domination', pct: Math.floor(((totalFactions - aliveFactions) / Math.max(1, totalFactions)) * 100), desc: 'Capture all capitals (' + (totalFactions - aliveFactions) + '/' + totalFactions + ')' },
    { name: '\u{1F52C} Science', pct: Math.floor((game.techs.length / Math.max(1, allTechs.length)) * 100), desc: 'Research all techs (' + game.techs.length + '/' + allTechs.length + ')' },
    { name: '\u{1F3A8} Culture', pct: Math.floor((game.civics.length / Math.max(1, CIVICS.length)) * 100), desc: 'Complete all civics (' + game.civics.length + '/' + CIVICS.length + ')' },
    { name: '\u{1F3C6} Score', pct: Math.floor(((game.turn || 1) / MAX_TURNS) * 100), desc: 'Highest score at turn ' + MAX_TURNS + ' (Score: ' + game.score + ')' },
  ];
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const isDom = idx === 0;
    const border = isDom ? 'border:1px solid rgba(255,80,80,0.4);' : '';
    const barColor = isDom ? '#e04040' : '#ffd700';
    const label = isDom ? '<span style="color:#ff6040;font-weight:600">' + it.name + ' <span style="font-size:10px;color:#e08080">(PRIMARY)</span></span>' : '<span style="color:#ffd700">' + it.name + '</span>';
    c.innerHTML += '<div style="margin-bottom:10px;padding:8px;background:rgba(255,255,255,0.03);border-radius:6px;' + border + '"><div style="display:flex;justify-content:space-between;margin-bottom:4px">' + label + '<span style="color:#888;font-size:11px">' + it.pct + '%</span></div><div style="background:#1a1a2e;border-radius:3px;height:6px;overflow:hidden"><div style="background:' + barColor + ';height:100%;width:' + it.pct + '%;transition:width 0.3s"></div></div><p style="color:#888;font-size:11px;margin-top:3px">' + it.desc + '</p></div>';
  }
  // Trade routes section
  c.innerHTML += '<p style="color:#c9a84c;margin-top:12px;margin-bottom:6px;font-size:13px;font-weight:600;border-bottom:1px solid rgba(201,168,76,0.3);padding-bottom:3px">\u{1F6A2} Trade Routes (' + (game.tradeRoutes || []).length + '/' + (game.maxTradeRoutes || 1) + ')</p>';
  for (const route of (game.tradeRoutes || [])) {
    const fname = FACTIONS[route.factionId] ? FACTIONS[route.factionId].name : route.factionId;
    const fc = game.factionCities[route.factionId];
    const dist = fc ? hexDistance(game.cities[0].col, game.cities[0].row, fc.col, fc.row) : 0;
    const rGold = 2 + Math.floor(dist / 5) + (game.activeAlliances[route.factionId] ? 2 : ((game.relationships[route.factionId] || 0) > 0 ? 1 : 0));
    c.innerHTML += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px"><span>' + fname + ' (+' + rGold + 'g)</span><button class="sel-btn" style="font-size:10px;padding:2px 6px;background:#5a2020;border-color:#8a3030" onclick="cancelTradeRoute(\'' + route.factionId + '\');renderVictoryPanel()">Cancel</button></div>';
  }
  if (game.techs.includes('currency')) {
    const available = Object.keys(game.metFactions || {}).filter(fid => game.factionCities[fid] && !(game.tradeRoutes || []).some(r => r.factionId === fid));
    for (const fid of available) {
      const fname = FACTIONS[fid] ? FACTIONS[fid].name : fid;
      c.innerHTML += '<div style="padding:3px 0;font-size:12px"><button class="sel-btn" style="font-size:10px;width:100%;text-align:left" onclick="establishTradeRoute(\'' + fid + '\');renderVictoryPanel()">\u{1F6A2} Trade with ' + fname + '</button></div>';
    }
  }
  // Amenity section (per-city)
  c.innerHTML += '<p style="color:#60c060;margin-top:12px;margin-bottom:4px;font-size:13px;font-weight:600;border-bottom:1px solid rgba(96,192,96,0.3);padding-bottom:3px">City Amenities & Unrest</p>';
  for (const city of game.cities) {
    const bal = city.amenityBalance || 0;
    const status = city.amenityStatus || 'CONTENT';
    const statusColors = { ECSTATIC: '#40e040', HAPPY: '#60c060', CONTENT: '#c0c060', DISPLEASED: '#c0a040', UNHAPPY: '#c06040', REVOLT_RISK: '#e02020' };
    const statusEmojis = { ECSTATIC: '\u{1F929}', HAPPY: '\u{1F600}', CONTENT: '\u{1F610}', DISPLEASED: '\u{1F61F}', UNHAPPY: '\u{1F621}', REVOLT_RISK: '\u{1F525}' };
    const modPct = Math.round((city.amenityMod || 0) * 100);
    const modStr = modPct > 0 ? '+' + modPct + '%' : modPct < 0 ? modPct + '%' : '';
    const emoji = statusEmojis[status] || '\u{1F610}';
    const color = statusColors[status] || '#c0c060';

    // Build unrest tooltip
    const unrestParts = [];
    if (city.unrestFromEmpireSize) unrestParts.push('Empire size: ' + city.unrestFromEmpireSize);
    if (city.unrestFromDistance) unrestParts.push('Distance: ' + city.unrestFromDistance);
    if (city.unrestFromCapture) unrestParts.push('Captured: ' + city.unrestFromCapture);
    if (city.unrestGarrisonBonus) unrestParts.push('Garrison: +' + city.unrestGarrisonBonus);
    if (city.amenityFromRoad) unrestParts.push('Road to capital: +' + city.amenityFromRoad);
    const unrestTip = unrestParts.length > 0 ? unrestParts.join(', ') : 'No unrest';
    const capturedTag = city.captured ? ' <span style="color:#d93;font-size:9px">[CAPTURED]</span>' : '';
    const roadTag = city.roadConnected ? ' <span style="color:#6b8;font-size:9px">[CONNECTED]</span>' : '';

    c.innerHTML += '<div style="padding:2px 0;font-size:11px" title="' + unrestTip + '">' + emoji + ' <b>' + city.name + '</b>' + capturedTag + roadTag + ': <span style="color:' + color + '">' + status + '</span> (bal ' + (bal >= 0 ? '+' : '') + bal + ')' + (modStr ? ' <span style="color:#888">' + modStr + ' growth/prod</span>' : '') + '</div>';
  }
  // Summary of amenity sources
  const luxCount = new Set();
  for (const city of game.cities) { if (city.amenityFromLuxuries > 0) luxCount.add(city); }
  const buildingAmenities = ['arena', 'garden', 'temple'].filter(b => game.buildings.includes(b));
  const hasAlliance = Object.keys(game.activeAlliances || {}).length > 0;
  let sources = [];
  if (buildingAmenities.length > 0) sources.push('Buildings: ' + buildingAmenities.join(', '));
  if (hasAlliance) sources.push('Alliance: +1 capital');
  if (sources.length > 0) c.innerHTML += '<p style="color:#888;font-size:10px;margin-top:4px">' + sources.join(' | ') + '</p>';
}

function toggleVictoryPanel() {
  const panel = ensureVictoryPanel();
  if (panel.style.display === 'none' || !panel.style.display) {
    closeAllPanels();
    panel.style.display = 'block';
    renderVictoryPanel();
  } else {
    panel.style.display = 'none';
  }
}

// Look up the display name for a tech ID
function getTechNameById(techId) {
  if (!techId) return 'tech';
  const td = TECHNOLOGIES.find(t => t.id === techId);
  return td ? td.name : techId;
}

// Build reverse map: building/unit id -> tech name that unlocks it
function getBuildingUnlockTech(buildingId) {
  for (const tech of TECHNOLOGIES) {
    if (tech.unlocks && tech.unlocks.includes(buildingId)) return tech.name;
  }
  return null;
}

function renderBuildPanel() {
  const container = document.getElementById('build-options');
  container.innerHTML = '';
  const prodBusy = game.currentBuild || game.currentUnitBuild || game.currentWonderBuild || game.currentDistrictBuild;
  const prodRate = Math.max(1, game.productionPerTurn);

  // City selector — show which city production targets
  if (game.cities.length > 0) {
    if (game.selectedCityIdx == null || game.selectedCityIdx >= game.cities.length) {
      game.selectedCityIdx = 0;
    }
    const city = game.cities[game.selectedCityIdx];
    const citySelector = document.createElement('div');
    citySelector.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:8px 10px;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);border-radius:6px';
    const hasMult = game.cities.length > 1;
    citySelector.innerHTML = (hasMult ? '<button style="background:none;border:none;color:var(--color-gold);font-size:16px;cursor:pointer;padding:0 4px" onclick="switchBuildCity(-1)">\u25C0</button>' : '')
      + '<span style="color:var(--color-gold);font-size:12px;font-weight:600">\u2605 ' + (city.name || 'Capital') + '</span>'
      + (hasMult ? '<button style="background:none;border:none;color:var(--color-gold);font-size:16px;cursor:pointer;padding:0 4px" onclick="switchBuildCity(1)">\u25B6</button>' : '');
    container.appendChild(citySelector);
  }

  // Current production status
  if (game.currentBuild) {
    const bd = BUILDINGS.find(b => b.id === game.currentBuild);
    const pct = Math.floor((game.buildProgress / bd.cost) * 100);
    const tl = Math.ceil((bd.cost - game.buildProgress) / prodRate);
    const s = document.createElement('div');
    s.style.cssText = 'margin-bottom:12px;padding:10px;background:rgba(201,168,76,0.08);border:1px solid var(--color-border);border-radius:6px';
    s.innerHTML = '<p style="color:var(--color-gold);margin-bottom:6px">Building: <strong>' + bd.name + '</strong></p>'
      + '<div style="background:#1a1a2e;border-radius:4px;height:8px;overflow:hidden;margin:4px 0"><div style="background:var(--color-gold);height:100%;width:' + pct + '%;transition:width 0.3s"></div></div>'
      + '<p style="color:var(--color-text-muted);font-size:11px">' + pct + '% \u2014 ' + tl + ' turn' + (tl!==1?'s':'') + ' left</p>'
      + '<button class="sel-btn" style="margin-top:6px;background:#5a2020;border-color:#8a3030;font-size:11px" onclick="cancelProduction()">Cancel</button>';
    container.appendChild(s);
  } else if (game.currentUnitBuild) {
    const ut = UNIT_TYPES[game.currentUnitBuild];
    const ubResReq = UNIT_RESOURCE_REQUIREMENTS[game.currentUnitBuild];
    const ubHasRes = ubResReq ? hasResourceAccess(ubResReq.resource, 'player') : true;
    const ubEffCost = ubHasRes ? ut.cost : Math.ceil(ut.cost * ubResReq.costMultiplier);
    const pct = Math.floor((game.unitBuildProgress / ubEffCost) * 100);
    const tl = Math.ceil((ubEffCost - game.unitBuildProgress) / prodRate);
    const ubResWarn = (ubResReq && !ubHasRes) ? '<p style="color:#ff6b6b;font-size:11px;margin-top:4px">\u26A0 ' + ubResReq.label + '</p>' : '';
    const s = document.createElement('div');
    s.style.cssText = 'margin-bottom:12px;padding:10px;background:rgba(91,141,199,0.08);border:1px solid var(--color-border);border-radius:6px';
    s.innerHTML = '<p style="color:var(--color-blue);margin-bottom:6px">Training: <strong>' + ut.icon + ' ' + ut.name + '</strong></p>'
      + '<div style="background:#1a1a2e;border-radius:4px;height:8px;overflow:hidden;margin:4px 0"><div style="background:var(--color-blue);height:100%;width:' + pct + '%;transition:width 0.3s"></div></div>'
      + '<p style="color:var(--color-text-muted);font-size:11px">' + pct + '% \u2014 ' + tl + ' turn' + (tl!==1?'s':'') + ' left</p>'
      + ubResWarn
      + '<button class="sel-btn" style="margin-top:6px;background:#5a2020;border-color:#8a3030;font-size:11px" onclick="cancelProduction()">Cancel</button>';
    container.appendChild(s);
  } else if (game.currentWonderBuild) {
    const wd = WONDERS.find(w => w.id === game.currentWonderBuild);
    if (wd) {
      const pct = Math.floor((game.wonderBuildProgress / wd.cost) * 100);
      const tl = Math.ceil((wd.cost - game.wonderBuildProgress) / prodRate);
      const s = document.createElement('div');
      s.style.cssText = 'margin-bottom:12px;padding:10px;background:rgba(255,215,0,0.08);border:1px solid var(--color-border);border-radius:6px';
      s.innerHTML = '<p style="color:#ffd700;margin-bottom:6px">Wonder: <strong>' + wd.icon + ' ' + wd.name + '</strong></p>'
        + '<div style="background:#1a1a2e;border-radius:4px;height:8px;overflow:hidden;margin:4px 0"><div style="background:#ffd700;height:100%;width:' + pct + '%;transition:width 0.3s"></div></div>'
        + '<p style="color:var(--color-text-muted);font-size:11px">' + pct + '% \u2014 ' + tl + ' turn' + (tl!==1?'s':'') + ' left</p>'
        + '<button class="sel-btn" style="margin-top:6px;background:#5a2020;border-color:#8a3030;font-size:11px" onclick="cancelProduction()">Cancel</button>';
      container.appendChild(s);
    }
  } else if (game.currentDistrictBuild) {
    const dd = DISTRICTS[game.currentDistrictBuild];
    if (dd) {
      const pct = Math.floor((game.districtBuildProgress / dd.cost) * 100);
      const tl = Math.ceil((dd.cost - game.districtBuildProgress) / prodRate);
      const s = document.createElement('div');
      s.style.cssText = 'margin-bottom:12px;padding:10px;background:rgba(240,200,72,0.08);border:1px solid var(--color-border);border-radius:6px';
      s.innerHTML = '<p style="color:#f0c848;margin-bottom:6px">District: <strong>' + dd.icon + ' ' + dd.name + '</strong></p>'
        + '<div style="background:#1a1a2e;border-radius:4px;height:8px;overflow:hidden;margin:4px 0"><div style="background:#f0c848;height:100%;width:' + pct + '%;transition:width 0.3s"></div></div>'
        + '<p style="color:var(--color-text-muted);font-size:11px">' + pct + '% \u2014 ' + tl + ' turn' + (tl!==1?'s':'') + ' left</p>'
        + '<button class="sel-btn" style="margin-top:6px;background:#5a2020;border-color:#8a3030;font-size:11px" onclick="cancelProduction()">Cancel</button>';
      container.appendChild(s);
    }
  } else {
    const idle = document.createElement('div');
    idle.style.cssText = 'margin-bottom:10px;padding:6px 8px;background:rgba(255,255,255,0.03);border:1px dashed var(--color-border);border-radius:6px;text-align:center';
    idle.innerHTML = '<p style="color:var(--color-text-muted);font-size:12px;font-style:italic">Production idle \u2014 select a building or unit</p>';
    container.appendChild(idle);
  }

  const rateP = document.createElement('p');
  rateP.style.cssText = 'color:var(--color-text-muted);font-size:11px;margin-bottom:8px;text-align:right';
  rateP.textContent = '\u2692 ' + game.productionPerTurn + ' production/turn';
  container.appendChild(rateP);

  // Buildings
  const bh = document.createElement('p');
  bh.style.cssText = 'color:var(--color-gold);margin-bottom:8px;font-size:13px;font-weight:600;border-bottom:1px solid var(--color-border);padding-bottom:4px';
  bh.textContent = 'Buildings';
  container.appendChild(bh);

  const unlockedBuildings = new Set();
  for (const tech of game.techs) {
    const td = TECHNOLOGIES.find(t => t.id === tech);
    if (td && td.unlocks) td.unlocks.forEach(b => unlockedBuildings.add(b));
  }
  for (const b of BUILDINGS) {
    const unlocked = unlockedBuildings.has(b.id);
    const built = game.buildings.includes(b.id);
    const can = unlocked && !built;
    const gCost = goldCost(b.cost);
    const canBuy = unlocked && !built && game.gold >= gCost;
    const turns = Math.ceil(b.cost / prodRate);
    const div = document.createElement('div');
    const disabled = !can && !canBuy;
    let bReason = '';
    if (built) bReason = 'Already built';
    else if (!unlocked) { const tn = getBuildingUnlockTech(b.id); bReason = 'Requires ' + (tn || 'tech'); }
    else if (!can && !canBuy) bReason = 'Production busy';
    div.className = 'build-item' + (disabled ? ' item-disabled' : '') + (!can && canBuy ? ' item-disabled has-gold-option' : '');
    if (disabled && bReason) div.title = bReason;
    div.innerHTML = '<div class="item-info"><div class="item-name">' + b.name + (built ? ' \u2713' : '') + '</div>'
      + '<div class="item-desc">' + b.desc + (!unlocked ? ' (Requires ' + (getBuildingUnlockTech(b.id) || 'tech') + ')' : '') + '</div></div>'
      + '<div class="item-cost-group">'
      + (can ? '<span class="cost-prod" title="Build with production">' + turns + 'T</span>' : '<span class="cost-prod cost-na">' + turns + 'T</span>')
      + (unlocked && !built ? '<span class="cost-gold' + (canBuy ? '' : ' cost-na') + '" title="Buy instantly with gold">' + gCost + 'g</span>' : '')
      + '</div>';
    if (can) div.addEventListener('click', () => startBuild(b.id));
    container.appendChild(div);
    if (canBuy) {
      const goldBtn = div.querySelector('.cost-gold');
      if (goldBtn) {
        goldBtn.style.cursor = 'pointer';
        goldBtn.addEventListener('click', (e) => { e.stopPropagation(); purchaseBuilding(b.id); });
      }
    }
  }

  // --- Wonders Section ---
  const wh = document.createElement('p');
  wh.style.cssText = 'color:#ffd700;margin-top:14px;margin-bottom:8px;font-size:13px;font-weight:600;border-bottom:1px solid var(--color-border);padding-bottom:4px';
  wh.textContent = '\u{1F3DB} Wonders (' + game.wonders.length + ' built)';
  container.appendChild(wh);

  // Show current wonder in production
  if (game.currentWonderBuild) {
    const wd = WONDERS.find(w => w.id === game.currentWonderBuild);
    if (wd) {
      const wpct = Math.floor((game.wonderBuildProgress / wd.cost) * 100);
      const wtl = Math.ceil((wd.cost - game.wonderBuildProgress) / prodRate);
      const ws = document.createElement('div');
      ws.style.cssText = 'margin-bottom:8px;padding:8px;background:rgba(255,215,0,0.08);border:1px solid var(--color-border);border-radius:6px';
      ws.innerHTML = '<p style="color:#ffd700;margin-bottom:4px">Wonder: <strong>' + wd.icon + ' ' + wd.name + '</strong></p>'
        + '<div style="background:#1a1a2e;border-radius:4px;height:8px;overflow:hidden;margin:4px 0"><div style="background:#ffd700;height:100%;width:' + wpct + '%;transition:width 0.3s"></div></div>'
        + '<p style="color:var(--color-text-muted);font-size:11px">' + wpct + '% \u2014 ' + wtl + ' turn' + (wtl!==1?'s':'') + ' left</p>';
      container.appendChild(ws);
    }
  }

  for (const w of WONDERS) {
    const techOk = !w.requires || game.techs.includes(w.requires);
    const alreadyBuiltByPlayer = game.wonders.includes(w.id);
    const globallyBuilt = game.builtWonders && game.builtWonders[w.id];
    const canBuild = techOk && !alreadyBuiltByPlayer && !globallyBuilt;
    const turns = Math.ceil(w.cost / prodRate);
    const div = document.createElement('div');
    div.className = 'build-item ' + (!canBuild ? 'item-disabled' : '');
    let statusLabel = '';
    let wonderReason = '';
    if (globallyBuilt) {
      const ownerFid = game.builtWonders[w.id];
      const ownerName = ownerFid === 'player' ? 'You' : (FACTIONS[ownerFid] ? FACTIONS[ownerFid].name : ownerFid);
      statusLabel = ' <span style="color:#e05050;font-size:10px">(Built by ' + ownerName + ')</span>';
      wonderReason = 'Built by ' + ownerName;
    } else if (!techOk) {
      const wonderTechName = getTechNameById(w.requires);
      statusLabel = ' <span style="color:#888;font-size:10px">(Requires ' + wonderTechName + ')</span>';
      wonderReason = 'Requires ' + wonderTechName;
    }
    if (!canBuild && wonderReason) div.title = wonderReason;
    div.innerHTML = '<div class="item-info"><div class="item-name">' + w.icon + ' ' + w.name + (alreadyBuiltByPlayer ? ' \u2713' : '') + statusLabel + '</div>'
      + '<div class="item-desc">' + w.desc + '</div></div>'
      + '<div class="item-cost" style="color:#ffd700">' + turns + 'T</div>';
    if (globallyBuilt && !alreadyBuiltByPlayer) {
      div.style.opacity = '0.4';
    }
    if (canBuild) {
      div.addEventListener('click', ((wid) => () => {
        startWonderBuild(wid);
      })(w.id));
    }
    container.appendChild(div);
  }

  // --- Districts Section ---
  const dh = document.createElement('p');
  dh.style.cssText = 'color:#f0c848;margin-top:14px;margin-bottom:8px;font-size:13px;font-weight:600;border-bottom:1px solid var(--color-border);padding-bottom:4px';
  dh.textContent = '\u{1F3D8} Districts (' + (game.playerDistricts || []).length + ' placed)';
  container.appendChild(dh);

  // Show current district in production
  if (game.currentDistrictBuild) {
    const dd = DISTRICTS[game.currentDistrictBuild];
    if (dd) {
      const dpct = Math.floor((game.districtBuildProgress / dd.cost) * 100);
      const dtl = Math.ceil((dd.cost - game.districtBuildProgress) / prodRate);
      const ds = document.createElement('div');
      ds.style.cssText = 'margin-bottom:8px;padding:8px;background:rgba(240,200,72,0.08);border:1px solid var(--color-border);border-radius:6px';
      ds.innerHTML = '<p style="color:#f0c848;margin-bottom:4px">District: <strong>' + dd.icon + ' ' + dd.name + '</strong></p>'
        + '<div style="background:#1a1a2e;border-radius:4px;height:8px;overflow:hidden;margin:4px 0"><div style="background:#f0c848;height:100%;width:' + dpct + '%;transition:width 0.3s"></div></div>'
        + '<p style="color:var(--color-text-muted);font-size:11px">' + dpct + '% \u2014 ' + dtl + ' turn' + (dtl!==1?'s':'') + ' left</p>'
        + '<button class="sel-btn" style="margin-top:6px;background:#5a2020;border-color:#8a3030;font-size:11px" onclick="cancelProduction()">Cancel</button>';
      container.appendChild(ds);
    }
  }

  for (const [did, dd] of Object.entries(DISTRICTS)) {
    const alreadyPlaced = (game.playerDistricts || []).includes(did);
    const currentlyBuilding = game.currentDistrictBuild === did;
    const canPlace = !alreadyPlaced && !currentlyBuilding;
    const turns = Math.ceil(dd.cost / prodRate);
    const gCostD = goldCost(dd.cost);
    const canBuyD = canPlace && game.gold >= gCostD;
    const div = document.createElement('div');
    div.className = 'build-item' + (!canPlace ? ' item-disabled' : '');
    let dReason = '';
    if (alreadyPlaced) dReason = 'Already placed';
    else if (currentlyBuilding) dReason = 'Under construction';
    if (!canPlace && dReason) div.title = dReason;
    // Build yield string
    const yieldStr = Object.entries(dd.yields).map(([k, v]) => '+' + v + ' ' + k).join(', ');
    div.innerHTML = '<div class="item-info"><div class="item-name">' + dd.icon + ' ' + dd.name + (alreadyPlaced ? ' \u2713' : '') + '</div>'
      + '<div class="item-desc">' + dd.desc + ' <span style="color:#8f8">(' + yieldStr + ')</span></div></div>'
      + '<div class="item-cost-group">'
      + (canPlace ? '<span class="cost-prod" title="Build with production">' + turns + 'T</span>' : '<span class="cost-prod cost-na">' + turns + 'T</span>')
      + (canPlace ? '<span class="cost-gold' + (canBuyD ? '' : ' cost-na') + '" title="Buy instantly with gold">' + gCostD + 'g</span>' : '')
      + '</div>';
    if (canPlace) {
      div.addEventListener('click', ((distId) => () => { startDistrictBuild(distId); })(did));
    }
    if (canBuyD) {
      const goldBtn = div.querySelector('.cost-gold');
      if (goldBtn) {
        goldBtn.style.cursor = 'pointer';
        goldBtn.addEventListener('click', ((distId) => (e) => { e.stopPropagation(); purchaseDistrict(distId); })(did));
      }
    }
    container.appendChild(div);
  }

}

// ---- Gold Purchase Functions ----
function purchaseBuilding(buildingId) {
  const bd = BUILDINGS.find(b => b.id === buildingId);
  if (!bd) return;
  if (game.buildings.includes(buildingId)) { addEvent(bd.name + ' already built', 'gold'); return; }
  const cost = goldCost(bd.cost);
  if (game.gold < cost) { addEvent('Not enough gold (' + cost + 'g needed, have ' + game.gold + 'g)', 'gold'); return; }
  game.gold -= cost;
  game.buildings.push(buildingId);
  if (bd.effect) {
    if (bd.effect.food) game.foodPerTurn += bd.effect.food;
    if (bd.effect.gold) game.goldPerTurn += bd.effect.gold;
    if (bd.effect.science) game.sciencePerTurn += bd.effect.science;
    if (bd.effect.production) game.productionPerTurn += bd.effect.production;
    if (bd.effect.culture) game.culturePerTurn = (game.culturePerTurn || 0) + bd.effect.culture;
    if (bd.effect.defense) game.cityDefense = (game.cityDefense || 0) + bd.effect.defense;
    if (bd.effect.military) game.militaryPower = (game.militaryPower || 0) + bd.effect.military;
  }
  logAction('build', 'Purchased ' + bd.name + ' for ' + cost + ' gold', { buildingId, goldCost: cost });
  addEvent('\u{1F4B0} Purchased ' + bd.name + ' for ' + cost + ' gold', 'gold');
  updateUI(); renderBuildPanel();
}

function purchaseUnit(typeId) {
  const ut = UNIT_TYPES[typeId];
  if (!ut) return;
  // Substitute mechanic for gold purchases
  const pResReq = UNIT_RESOURCE_REQUIREMENTS[typeId];
  const pHasRes = pResReq ? hasResourceAccess(pResReq.resource, 'player') : true;
  const pEffCost = pHasRes ? ut.cost : Math.ceil(ut.cost * pResReq.costMultiplier);
  const cost = goldCost(pEffCost);
  if (game.gold < cost) { addEvent('Not enough gold (' + cost + 'g needed, have ' + game.gold + 'g)', 'gold'); return; }
  if (typeId === 'settler' && game.population < 2000) {
    addEvent('Need population 2,000+ to buy Settler', 'combat'); return;
  }
  game.gold -= cost;
  const cityIdx = getNearestCityIndex();
  const city = game.cities[cityIdx] || game.cities[0];
  // Place on adjacent tile (not on city tile) — same as production-built units
  let spawnCol = city.col, spawnRow = city.row;
  const neighbors = getHexNeighbors(city.col, city.row);
  for (const nb of neighbors) {
    const t = game.map[nb.row]?.[nb.col];
    if (!t) continue;
    const bi = BASE_TERRAIN[t.base];
    if (!bi || !bi.movable) continue;
    if (t.feature === 'mountain') continue;
    const occupied = game.units.some(u => u.col === nb.col && u.row === nb.row && u.owner === 'player' && UNIT_TYPES[u.type]?.combat > 0);
    if (occupied) continue;
    spawnCol = nb.col;
    spawnRow = nb.row;
    break;
  }
  const unitId = getNextUnitId();
  const newUnit = {
    id: unitId, type: typeId, col: spawnCol, row: spawnRow,
    owner: 'player', hp: 100, moveLeft: 0,
    xp: 0, level: 1, fortified: false, sleeping: false
  };
  // Apply substitute penalties if no resource
  if (!pHasRes && pResReq) {
    newUnit.combat = Math.max(0, (ut.combat || 0) - pResReq.combatPenalty);
    if (pResReq.rangedPenalty && ut.rangedCombat) newUnit.rangedCombat = Math.max(0, ut.rangedCombat - pResReq.rangedPenalty);
    if (pResReq.movePenalty) newUnit.movePoints = Math.max(1, ut.movePoints - pResReq.movePenalty);
    newUnit.substitute = true;
  }
  game.units.push(newUnit);
  if (typeId === 'settler') {
    game.population = Math.max(500, game.population - 500);
    city.population = Math.max(500, (city.population || game.population) - 500);
  }
  const pSubLabel = (!pHasRes && pResReq) ? ' (substitute)' : '';
  logAction('build', 'Purchased ' + ut.name + pSubLabel + ' in ' + city.name + ' for ' + cost + ' gold', { unitType: typeId, goldCost: cost });
  addEvent('\u{1F4B0} Purchased ' + ut.icon + ' ' + ut.name + pSubLabel + ' in ' + city.name + ' for ' + cost + ' gold (ready next turn)', 'gold');
  updateUI(); renderBuildPanel(); render();
}

function startBuild(buildingId) {
  const doBuild = () => {
    game.currentBuild = buildingId;
    game.buildProgress = 0;
    const bd = BUILDINGS.find(b => b.id === buildingId);
    const tl = Math.ceil(bd.cost / Math.max(1, game.productionPerTurn));
    logAction('build', 'Started building ' + bd.name, { buildingId });
    addEvent('Building ' + bd.name + ' (' + tl + ' turns)', 'gold');
    closeAllPanels();
  };
  if (game.currentBuild || game.currentUnitBuild || game.currentWonderBuild) {
    switchProduction(doBuild);
  } else {
    doBuild();
  }
}

function cancelProduction() {
  if (game.currentBuild) {
    const bd = BUILDINGS.find(b => b.id === game.currentBuild);
    addEvent('Cancelled ' + (bd ? bd.name : 'building'), 'gold');
    game.currentBuild = null; game.buildProgress = 0;
  } else if (game.currentUnitBuild) {
    const ut = UNIT_TYPES[game.currentUnitBuild];
    addEvent('Cancelled ' + (ut ? ut.name : 'unit') + ' training', 'combat');
    game.currentUnitBuild = null; game.unitBuildProgress = 0;
  } else if (game.currentWonderBuild) {
    const wd = WONDERS.find(w => w.id === game.currentWonderBuild);
    addEvent('Cancelled ' + (wd ? wd.name : 'wonder'), 'gold');
    game.currentWonderBuild = null; game.wonderBuildProgress = 0;
  } else if (game.currentDistrictBuild) {
    const dd = DISTRICTS[game.currentDistrictBuild];
    addEvent('Cancelled ' + (dd ? dd.name : 'district'), 'gold');
    game.currentDistrictBuild = null; game.districtBuildProgress = 0; game.districtBuildTarget = null;
  }
  updateUI(); renderBuildPanel();
}

// --- District placement helpers ---

/** Find a valid tile to place a district near a player city. */
function findDistrictPlacement(districtId) {
  const dd = DISTRICTS[districtId];
  if (!dd) return null;
  const placement = dd.placement || {};

  // Search tiles within border radius of each player city
  for (const city of game.cities) {
    const radius = city.borderRadius || 2;
    for (let ring = 1; ring <= radius; ring++) {
      for (let r = city.row - ring; r <= city.row + ring; r++) {
        for (let c = city.col - ring; c <= city.col + ring; c++) {
          if (r < 0 || r >= MAP_ROWS || c < 0 || c >= MAP_COLS) continue;
          const tile = game.map[r][c];
          if (!tile) continue;
          // Skip water, mountains, existing districts/improvements
          if (tile.base === 'ocean' || tile.base === 'coast' || tile.base === 'lake') continue;
          if (tile.feature === 'mountain') continue;
          if (tile.district || tile.improvement) continue;
          // Skip city centre tiles
          if (game.cities.some(ct => ct.col === c && ct.row === r)) continue;
          if (Object.values(game.factionCities || {}).some(fc => fc.col === c && fc.row === r)) continue;

          // Check placement rules
          if (placement.requiresTerrain && !placement.requiresTerrain.includes(tile.base)) continue;
          if (placement.requiresAdjacentWater) {
            const nbs = getHexNeighbors(c, r);
            const hasW = nbs.some(nb => {
              const nt = game.map[nb.row] && game.map[nb.row][nb.col];
              return nt && (nt.base === 'ocean' || nt.base === 'coast' || nt.base === 'lake');
            });
            if (!hasW) continue;
          }
          if (placement.notAdjacentToCity) {
            const nbs = getHexNeighbors(c, r);
            const adjCity = nbs.some(nb => game.cities.some(ct => ct.col === nb.col && ct.row === nb.row));
            if (adjCity) continue;
          }

          // Must be within city territory (within border radius)
          if (hexDistance(c, r, city.col, city.row) > radius) continue;

          return { col: c, row: r };
        }
      }
    }
  }
  return null;
}

function startDistrictBuild(districtId) {
  const dd = DISTRICTS[districtId];
  if (!dd) return;
  if ((game.playerDistricts || []).includes(districtId)) { addEvent(dd.name + ' already placed', 'gold'); return; }

  const target = findDistrictPlacement(districtId);
  if (!target) {
    addEvent('No valid tile for ' + dd.name + ' near your cities', 'gold');
    showToast('Cannot Place', 'No valid tile for ' + dd.name + '. Check city borders and placement rules.');
    return;
  }

  const doBuild = () => {
    game.currentDistrictBuild = districtId;
    game.districtBuildProgress = 0;
    game.districtBuildTarget = target;
    // Clear other production
    game.currentBuild = null; game.buildProgress = 0;
    game.currentUnitBuild = null; game.unitBuildProgress = 0;
    game.currentWonderBuild = null; game.wonderBuildProgress = 0;
    const tl = Math.ceil(dd.cost / Math.max(1, game.productionPerTurn));
    logAction('district', 'Started building ' + dd.name + ' district', { districtId });
    addEvent(dd.icon + ' Building ' + dd.name + ' (' + tl + ' turns)', 'gold');
    closeAllPanels();
  };

  if (game.currentBuild || game.currentUnitBuild || game.currentWonderBuild || game.currentDistrictBuild) {
    switchProduction(doBuild);
  } else {
    doBuild();
  }
}

function purchaseDistrict(districtId) {
  const dd = DISTRICTS[districtId];
  if (!dd) return;
  if ((game.playerDistricts || []).includes(districtId)) { addEvent(dd.name + ' already placed', 'gold'); return; }
  const gCostD = goldCost(dd.cost);
  if (game.gold < gCostD) { addEvent('Not enough gold (' + gCostD + 'g needed)', 'gold'); return; }

  const target = findDistrictPlacement(districtId);
  if (!target) {
    addEvent('No valid tile for ' + dd.name + ' near your cities', 'gold');
    return;
  }

  game.gold -= gCostD;
  placePlayerDistrict(districtId, target);
  addEvent(dd.icon + ' ' + dd.name + ' district purchased and placed!', 'gold');
  if (typeof showToast === 'function') showToast('\u{1F3D8} District Placed', dd.name + ' purchased with gold!');
  updateUI(); renderBuildPanel(); render();
}

/** Place a completed player district on the map and apply yields. */
function placePlayerDistrict(districtId, target) {
  const dd = DISTRICTS[districtId];
  if (!dd) return;
  const tile = game.map[target.row][target.col];
  tile.district = districtId;
  if (!game.playerDistricts) game.playerDistricts = [];
  game.playerDistricts.push(districtId);

  // Apply base yields (culture is recalculated per turn in turn.js, so skip it here)
  if (dd.yields.science) game.sciencePerTurn += dd.yields.science;
  if (dd.yields.gold) game.goldPerTurn += dd.yields.gold;
  if (dd.yields.food) game.foodPerTurn += dd.yields.food;
  if (dd.yields.military) game.military += dd.yields.military;

  // Apply adjacency bonuses (culture handled per-turn)
  const adjBonus = computeAdjacencyBonus(districtId, target.col, target.row);
  if (adjBonus.science) game.sciencePerTurn += adjBonus.science;
  if (adjBonus.gold) game.goldPerTurn += adjBonus.gold;
  if (adjBonus.food) game.foodPerTurn += adjBonus.food;
  if (adjBonus.military) game.military += adjBonus.military;
}

/** Compute adjacency bonus yields for a district at a given position. */
function computeAdjacencyBonus(districtId, col, row) {
  const dd = DISTRICTS[districtId];
  if (!dd || !dd.adjacency) return {};
  const bonus = {};
  const nbs = getHexNeighbors(col, row);

  for (const nb of nbs) {
    const tile = game.map[nb.row] && game.map[nb.row][nb.col];
    if (!tile) continue;

    for (const [adjType, yields] of Object.entries(dd.adjacency)) {
      let match = false;
      // Terrain features
      if (adjType === 'mountain' && tile.feature === 'mountain') match = true;
      else if (adjType === 'woods' && (tile.feature === 'woods' || tile.feature === 'rainforest')) match = true;
      else if (adjType === 'hills' && tile.feature === 'hills') match = true;
      // Terrain base types
      else if (adjType === 'coast' && (tile.base === 'coast' || tile.base === 'ocean')) match = true;
      // Tile properties
      else if (adjType === 'river' && tile.hasRiver) match = true;
      // Improvements
      else if (adjType === 'farm' && tile.improvement === 'farm') match = true;
      // Districts
      else if (adjType === 'harbor' && tile.district === 'harbor') match = true;
      // Natural wonders
      else if (adjType === 'natural_wonder' && tile.naturalWonder) match = true;

      if (match) {
        for (const [yieldType, amount] of Object.entries(yields)) {
          bonus[yieldType] = (bonus[yieldType] || 0) + amount;
        }
      }
    }
  }
  return bonus;
}

function startWonderBuild(wonderId) {
  // Wonder exclusivity check
  if (game.builtWonders && game.builtWonders[wonderId]) {
    const ownerFid = game.builtWonders[wonderId];
    const ownerName = ownerFid === 'player' ? 'You' : (FACTIONS[ownerFid] ? FACTIONS[ownerFid].name : ownerFid);
    showToast('Cannot Build', 'This wonder has already been built by ' + ownerName);
    return;
  }
  const doBuild = () => {
    game.currentWonderBuild = wonderId;
    game.wonderBuildProgress = 0;
    const wd = WONDERS.find(w => w.id === wonderId);
    const tl = Math.ceil(wd.cost / Math.max(1, game.productionPerTurn));
    logAction('build', 'Started building wonder ' + wd.name, { wonderId });
    addEvent('Wonder: ' + wd.icon + ' ' + wd.name + ' (' + tl + ' turns)', 'gold');
    closeAllPanels();
  };
  if (game.currentBuild || game.currentUnitBuild || game.currentWonderBuild) {
    switchProduction(doBuild);
  } else {
    doBuild();
  }
}

function ensureCivicsPanel() {
  let panel = document.getElementById('civics-panel');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'civics-panel';
  panel.className = 'panel';
  panel.style.cssText = 'display:none;position:fixed;top:60px;right:10px;width:340px;max-height:70vh;overflow-y:auto;background:var(--color-panel-bg,#1a1a2e);border:1px solid var(--color-border,#333);border-radius:8px;padding:16px;z-index:200;color:#e0e0e0;font-size:13px';
  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0;color:#e8a0ff;font-size:15px">\u{1F3DB} Civics Tree</h3><button class="panel-close" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer" onclick="this.closest(\'.panel\').style.display=\'none\'">\u2715</button></div><div id="civics-options"></div>';
  document.body.appendChild(panel);
  return panel;
}

function renderCivicsPanel() {
  const panel = ensureCivicsPanel();
  const container = panel.querySelector('#civics-options');
  container.innerHTML = '';

  // Current civic progress
  if (game.currentCivic) {
    const cdata = CIVICS.find(c => c.id === game.currentCivic);
    const progress = Math.floor((game.civicProgress / cdata.cost) * 100);
    const turnsLeft = Math.ceil((cdata.cost - game.civicProgress) / Math.max(1, game.culturePerTurn));
    const prog = document.createElement('div');
    prog.style.cssText = 'margin-bottom:12px;padding:10px;background:rgba(232,160,255,0.08);border:1px solid var(--color-border);border-radius:6px';
    prog.innerHTML = '<p style="color:#e8a0ff;margin-bottom:6px">Adopting: <strong>' + cdata.name + '</strong></p>'
      + '<div style="background:#1a1a2e;border-radius:4px;height:8px;overflow:hidden;margin:4px 0"><div style="background:#e8a0ff;height:100%;width:' + progress + '%;transition:width 0.3s"></div></div>'
      + '<p style="color:var(--color-text-muted,#888);font-size:11px">' + progress + '% \u2014 ' + turnsLeft + ' turn' + (turnsLeft!==1?'s':'') + ' left (' + game.culturePerTurn + ' culture/turn)</p>';
    container.appendChild(prog);
  } else {
    const idle = document.createElement('p');
    idle.style.cssText = 'color:var(--color-text-muted,#888);font-size:12px;margin-bottom:8px;font-style:italic';
    idle.textContent = 'No civic in progress \u2014 select one below';
    container.appendChild(idle);
  }

  // Organize civics by depth
  const civicDepth = {};
  function getCivicDepth(cid) {
    if (civicDepth[cid] !== undefined) return civicDepth[cid];
    const c = CIVICS.find(x => x.id === cid);
    if (!c || !c.requires || c.requires.length === 0) { civicDepth[cid] = 0; return 0; }
    const d = 1 + Math.max(...c.requires.map(r => getCivicDepth(r)));
    civicDepth[cid] = d;
    return d;
  }
  CIVICS.forEach(c => getCivicDepth(c.id));
  const maxDepth = Math.max(0, ...Object.values(civicDepth));

  const categoryColors = { governance: '#e8a0ff', economy: '#ffd700', military: '#ff6060', expansion: '#60c060', religion: '#60a0ff', culture: '#ff80c0' };
  const tierLabels = ['Ancient Civics', 'Classical Civics', 'Medieval Civics'];

  for (let d = 0; d <= maxDepth; d++) {
    const tierCivics = CIVICS.filter(c => (civicDepth[c.id] || 0) === d);
    if (tierCivics.length === 0) continue;
    const th = document.createElement('p');
    th.style.cssText = 'color:#e8a0ff;margin-top:10px;margin-bottom:6px;font-size:12px;font-weight:600;border-bottom:1px solid rgba(232,160,255,0.2);padding-bottom:3px';
    th.textContent = tierLabels[d] || ('Era ' + (d + 1));
    container.appendChild(th);

    for (const c of tierCivics) {
      const adopted = game.civics.includes(c.id);
      const hasPrereqs = !c.requires || c.requires.every(r => game.civics.includes(r));
      const canStart = !game.currentCivic && !adopted && hasPrereqs;
      const isCurrent = game.currentCivic === c.id;
      const turns = Math.ceil(c.cost / Math.max(1, game.culturePerTurn));
      const catColor = categoryColors[c.category] || '#e8a0ff';

      const div = document.createElement('div');
      div.className = 'build-item ' + (!canStart && !adopted && !isCurrent ? 'item-disabled' : '');
      if (adopted) div.style.opacity = '0.6';
      if (isCurrent) div.style.borderLeft = '3px solid #e8a0ff';

      const reqNames = (c.requires || []).map(r => { const rc = CIVICS.find(x => x.id === r); return rc ? rc.name : r; });
      const reqStr = reqNames.length > 0 && !hasPrereqs ? ' (needs: ' + reqNames.join(', ') + ')' : '';

      const hasInspiration = c.inspiration;
      const inspirationTriggered = hasInspiration && game.inspirations && game.inspirations.includes(c.id);
      const inspirationHtml = hasInspiration
        ? '<div style="font-size:10px;font-style:italic;color:' + (inspirationTriggered ? '#4caf50' : '#e8a0ff') + ';margin-top:2px">' + (inspirationTriggered ? '\u2713 ' : '\u{1F4A1} ') + 'Inspiration: ' + c.inspiration.description + (inspirationTriggered ? '' : ' (40%)') + '</div>'
        : '';
      div.innerHTML = '<div class="item-info"><div class="item-name" style="color:' + catColor + '">' + (adopted ? '\u2713 ' : '') + c.name + ' <span style="font-size:10px;opacity:0.6">[' + c.category + ']</span></div>'
        + '<div class="item-desc">' + c.desc + reqStr + '</div>' + inspirationHtml + '</div>'
        + '<div class="item-cost" style="color:#e8a0ff">' + turns + 'T</div>';
      if (canStart) {
        div.addEventListener('click', ((cid) => () => {
          game.currentCivic = cid;
          game.civicProgress = 0;
          const cd = CIVICS.find(x => x.id === cid);
          addEvent('Started adopting civic: ' + cd.name, 'gold');
          renderCivicsPanel();
        })(c.id));
      }
      container.appendChild(div);
    }
  }

  // Great People progress section
  const gph = document.createElement('p');
  gph.style.cssText = 'color:#ffd700;margin-top:16px;margin-bottom:6px;font-size:13px;font-weight:600;border-bottom:1px solid rgba(255,215,0,0.2);padding-bottom:3px';
  gph.textContent = '\u{2B50} Great People Progress';
  container.appendChild(gph);

  for (const gp of GREAT_PEOPLE_TYPES) {
    const prog = game.greatPeopleProgress ? (game.greatPeopleProgress[gp.trigger] || 0) : 0;
    const pct = Math.min(100, Math.floor((prog / gp.threshold) * 100));
    const div = document.createElement('div');
    div.style.cssText = 'margin-bottom:6px;padding:6px 8px;background:rgba(255,255,255,0.02);border-radius:4px';
    div.innerHTML = '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span>' + gp.icon + ' ' + gp.name + '</span><span style="color:var(--color-text-muted,#888)">' + prog + '/' + gp.threshold + '</span></div>'
      + '<div style="background:#1a1a2e;border-radius:3px;height:5px;overflow:hidden"><div style="background:#ffd700;height:100%;width:' + pct + '%;transition:width 0.3s"></div></div>';
    container.appendChild(div);
  }

  // Earned great people (unused)
  const unused = (game.greatPeopleEarned || []).filter(g => !g.used);
  if (unused.length > 0) {
    const ugh = document.createElement('p');
    ugh.style.cssText = 'color:#ffd700;margin-top:10px;margin-bottom:6px;font-size:12px;font-weight:600';
    ugh.textContent = 'Available Great People:';
    container.appendChild(ugh);
    for (const gpe of unused) {
      const gpdef = GREAT_PEOPLE_TYPES.find(g => g.type === gpe.type);
      if (!gpdef) continue;
      const btn = document.createElement('div');
      btn.className = 'build-item';
      btn.style.cursor = 'pointer';
      btn.innerHTML = '<div class="item-info"><div class="item-name" style="color:#ffd700">' + gpdef.icon + ' ' + gpdef.name + '</div>'
        + '<div class="item-desc">' + gpdef.effect + '</div></div>'
        + '<div class="item-cost" style="color:#ffd700;font-size:11px">Use</div>';
      btn.addEventListener('click', ((gpEntry, gpDef) => () => {
        useGreatPerson(gpEntry, gpDef);
        renderCivicsPanel();
      })(gpe, gpdef));
      container.appendChild(btn);
    }
  }

  // Pantheon display
  if (game.pantheon) {
    const pd = PANTHEONS.find(p => p.id === game.pantheon);
    if (pd) {
      const ph = document.createElement('p');
      ph.style.cssText = 'color:#60a0ff;margin-top:14px;margin-bottom:4px;font-size:12px;font-weight:600;border-bottom:1px solid rgba(96,160,255,0.2);padding-bottom:3px';
      ph.textContent = '\u{1F54C} Pantheon: ' + pd.icon + ' ' + pd.name;
      container.appendChild(ph);
      const pdesc = document.createElement('p');
      pdesc.style.cssText = 'color:var(--color-text-muted,#888);font-size:11px';
      pdesc.textContent = pd.desc;
      container.appendChild(pdesc);
    }
  }
}

function toggleCivicsPanel() {
  const panel = ensureCivicsPanel();
  if (panel.style.display === 'none' || !panel.style.display) {
    closeAllPanels();
    panel.style.display = 'block';
    renderCivicsPanel();
  } else {
    panel.style.display = 'none';
  }
}

// --- Government Panel ---

function getGovernmentCivicReq(govId) {
  // Map government IDs to their civic unlock keys
  const govUnlockMap = { despotism: 'despotism_gov', classical_republic: 'republic_gov', oligarchy: 'oligarchy_gov' };
  const unlockKey = govUnlockMap[govId];
  if (!unlockKey) return null;
  return CIVICS.find(c => c.unlocks && c.unlocks.includes(unlockKey)) || null;
}

function isGovernmentUnlocked(govId) {
  const gov = GOVERNMENTS[govId];
  if (!gov) return false;
  // Chiefdom is always available
  if (!gov.unlockTech) return true;
  // Need the tech
  if (!game.techs.includes(gov.unlockTech)) return false;
  // Need the civic
  const civicReq = getGovernmentCivicReq(govId);
  if (civicReq && !game.civics.includes(civicReq.id)) return false;
  return true;
}

function ensureGovernmentPanel() {
  let panel = document.getElementById('government-panel');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'government-panel';
  panel.className = 'panel';
  panel.style.cssText = 'display:none;position:fixed;top:60px;right:10px;width:340px;max-height:70vh;overflow-y:auto;background:var(--color-panel-bg,#1a1a2e);border:1px solid var(--color-border,#333);border-radius:8px;padding:16px;z-index:200;color:#e0e0e0;font-size:13px';
  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0;color:#d4a0ff;font-size:15px">\u{1F3DB} Government</h3><button class="panel-close" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer" onclick="this.closest(\'.panel\').style.display=\'none\'">\u2715</button></div><div id="government-options"></div>';
  document.body.appendChild(panel);
  return panel;
}

function renderGovernmentPanel() {
  const panel = ensureGovernmentPanel();
  const container = panel.querySelector('#government-options');
  container.innerHTML = '';

  const curGov = GOVERNMENTS[game.government] || GOVERNMENTS.chiefdom;

  // Current government section
  const curDiv = document.createElement('div');
  curDiv.style.cssText = 'margin-bottom:14px;padding:12px;background:rgba(212,160,255,0.1);border:1px solid rgba(212,160,255,0.3);border-radius:6px';
  const bonusLines = [];
  if (curGov.bonuses) {
    if (curGov.bonuses.scienceBonus) bonusLines.push('+' + Math.round(curGov.bonuses.scienceBonus * 100) + '% Science');
    if (curGov.bonuses.militaryProdBonus) bonusLines.push('+' + Math.round(curGov.bonuses.militaryProdBonus * 100) + '% Military Production');
    if (curGov.bonuses.cultureBonus) bonusLines.push('+' + Math.round(curGov.bonuses.cultureBonus * 100) + '% Culture');
    if (curGov.bonuses.wonderProdBonus) bonusLines.push('+' + Math.round(curGov.bonuses.wonderProdBonus * 100) + '% Wonder Production');
    if (curGov.bonuses.foodBonus) bonusLines.push('+' + Math.round(curGov.bonuses.foodBonus * 100) + '% Food');
    if (curGov.bonuses.buildingProdBonus) bonusLines.push('+' + Math.round(curGov.bonuses.buildingProdBonus * 100) + '% Building Production');
  }
  const bonusHtml = bonusLines.length > 0
    ? '<div style="margin-top:6px;font-size:11px;color:#b0ffb0">' + bonusLines.map(b => '<div>' + b + '</div>').join('') + '</div>'
    : '<div style="margin-top:4px;font-size:11px;color:var(--color-text-muted)">No bonuses</div>';
  const slotsHtml = '<div style="margin-top:4px;font-size:11px;color:#aaa">Policy slots: ' + (curGov.slots || 0) + '</div>';
  const cooldownHtml = game.governmentCooldown > 0
    ? '<div style="margin-top:4px;font-size:11px;color:#ffd700">Cooldown: ' + game.governmentCooldown + ' turns remaining</div>'
    : '';
  curDiv.innerHTML = '<div style="font-size:14px;font-weight:600;color:#d4a0ff">' + (curGov.icon || '') + ' ' + curGov.name + ' <span style="font-size:11px;color:#aaa;font-weight:normal">(current)</span></div>'
    + '<div style="font-size:12px;color:#ccc;margin-top:4px">' + curGov.desc + '</div>'
    + bonusHtml + slotsHtml + cooldownHtml;
  container.appendChild(curDiv);

  // Available governments header
  const availH = document.createElement('p');
  availH.style.cssText = 'color:#b0ffb0;margin-top:4px;margin-bottom:8px;font-size:12px;font-weight:600;border-bottom:1px solid rgba(176,255,176,0.2);padding-bottom:3px';
  availH.textContent = 'Available Governments';
  container.appendChild(availH);

  let hasAvailable = false;
  for (const [gid, gov] of Object.entries(GOVERNMENTS)) {
    if (gid === game.government) continue;
    if (!isGovernmentUnlocked(gid)) continue;
    hasAvailable = true;

    const div = document.createElement('div');
    div.className = 'build-item';
    div.style.cursor = 'pointer';
    const gBonuses = [];
    if (gov.bonuses) {
      if (gov.bonuses.scienceBonus) gBonuses.push('+' + Math.round(gov.bonuses.scienceBonus * 100) + '% Science');
      if (gov.bonuses.militaryProdBonus) gBonuses.push('+' + Math.round(gov.bonuses.militaryProdBonus * 100) + '% Military Prod');
      if (gov.bonuses.cultureBonus) gBonuses.push('+' + Math.round(gov.bonuses.cultureBonus * 100) + '% Culture');
      if (gov.bonuses.wonderProdBonus) gBonuses.push('+' + Math.round(gov.bonuses.wonderProdBonus * 100) + '% Wonder Prod');
      if (gov.bonuses.foodBonus) gBonuses.push('+' + Math.round(gov.bonuses.foodBonus * 100) + '% Food');
      if (gov.bonuses.buildingProdBonus) gBonuses.push('+' + Math.round(gov.bonuses.buildingProdBonus * 100) + '% Building Prod');
    }
    div.innerHTML = '<div class="item-info"><div class="item-name" style="color:#d4a0ff">' + (gov.icon || '') + ' ' + gov.name + '</div>'
      + '<div class="item-desc">' + gov.desc + '</div>'
      + (gBonuses.length > 0 ? '<div style="font-size:10px;color:#b0ffb0;margin-top:2px">' + gBonuses.join(' | ') + '</div>' : '')
      + '<div style="font-size:10px;color:#aaa;margin-top:1px">Policy slots: ' + (gov.slots || 0) + '</div>'
      + '</div>'
      + '<div class="item-cost" style="color:#d4a0ff;font-size:11px">Switch</div>';
    div.addEventListener('click', ((gidCopy) => () => {
      if (game.governmentCooldown > 0) {
        addEvent('Government cooldown: ' + game.governmentCooldown + ' turns remaining', 'gold');
        return;
      }
      game.government = gidCopy;
      game.governmentCooldown = 10;
      addEvent('Government changed to ' + GOVERNMENTS[gidCopy].name, 'gold');
      renderGovernmentPanel();
      updateUI();
    })(gid));
    container.appendChild(div);
  }

  if (!hasAvailable) {
    const noAvail = document.createElement('p');
    noAvail.style.cssText = 'color:var(--color-text-muted);font-size:11px;font-style:italic;margin-bottom:8px';
    noAvail.textContent = 'No other governments available yet';
    container.appendChild(noAvail);
  }

  // Locked governments header
  const lockedGovs = Object.entries(GOVERNMENTS).filter(([gid]) => gid !== game.government && !isGovernmentUnlocked(gid));
  if (lockedGovs.length > 0) {
    const lockedH = document.createElement('p');
    lockedH.style.cssText = 'color:#ff8080;margin-top:14px;margin-bottom:8px;font-size:12px;font-weight:600;border-bottom:1px solid rgba(255,128,128,0.2);padding-bottom:3px';
    lockedH.textContent = 'Locked Governments';
    container.appendChild(lockedH);

    for (const [gid, gov] of lockedGovs) {
      const techOk = !gov.unlockTech || game.techs.includes(gov.unlockTech);
      const civicReq = getGovernmentCivicReq(gid);
      const civicOk = !civicReq || game.civics.includes(civicReq.id);

      const reqs = [];
      if (!techOk) {
        const techName = getTechNameById(gov.unlockTech);
        reqs.push('Research: ' + techName);
      }
      if (!civicOk) {
        reqs.push('Civic: ' + civicReq.name);
      }

      const div = document.createElement('div');
      div.className = 'build-item item-disabled';
      div.style.pointerEvents = 'auto';
      div.style.cursor = 'default';
      div.title = 'Requires: ' + reqs.join(', ');
      div.innerHTML = '<div class="item-info"><div class="item-name" style="color:#888">' + (gov.icon || '') + ' ' + gov.name + '</div>'
        + '<div class="item-desc">' + gov.desc + '</div>'
        + '<div style="font-size:10px;color:#ff8080;margin-top:2px">' + reqs.join(' | ') + '</div>'
        + '</div>'
        + '<div class="item-cost" style="color:#666;font-size:10px">\u{1F512}</div>';
      container.appendChild(div);
    }
  }
}

function toggleGovernmentPanel() {
  const panel = ensureGovernmentPanel();
  if (panel.style.display === 'none' || !panel.style.display) {
    closeAllPanels();
    panel.style.display = 'block';
    renderGovernmentPanel();
  } else {
    panel.style.display = 'none';
  }
}

function openGovernmentPanel() {
  closeAllPanels();
  const panel = ensureGovernmentPanel();
  panel.style.display = 'block';
  renderGovernmentPanel();
}

function renderResearchPanel() {
  const container = document.getElementById('research-options');
  container.innerHTML = '';

  if (game.currentResearch) {
    const tdata = TECHNOLOGIES.find(t => t.id === game.currentResearch);
    const progress = Math.floor((game.researchProgress / tdata.cost) * 100);
    const turnsLeft = Math.ceil((tdata.cost - game.researchProgress) / Math.max(1, game.sciencePerTurn));
    container.innerHTML = `<p style="color:var(--color-blue); margin-bottom: 12px">Researching: <strong>${tdata.name}</strong> (${progress}%) \u2014 ${turnsLeft} turns</p>`;
  }

  // Render visual tech tree
  const treeDiv = document.createElement('div');
  treeDiv.className = 'tech-tree';

  // Organize techs into tiers by dependency depth
  const techDepth = {};
  function getDepth(tid) {
    if (techDepth[tid] !== undefined) return techDepth[tid];
    const t = TECHNOLOGIES.find(x => x.id === tid);
    if (!t || !t.requires || t.requires.length === 0) { techDepth[tid] = 0; return 0; }
    const d = 1 + Math.max(...t.requires.map(r => getDepth(r)));
    techDepth[tid] = d;
    return d;
  }
  TECHNOLOGIES.forEach(t => getDepth(t.id));

  const maxDepth = Math.max(0, ...Object.values(techDepth));
  const tiers = [];
  for (let d = 0; d <= maxDepth; d++) {
    tiers.push(TECHNOLOGIES.filter(t => (techDepth[t.id] || 0) === d));
  }

  // Tier labels
  const tierLabels = ['Ancient Era', 'Classical Era', 'Medieval Era', 'Renaissance'];

  for (let d = 0; d <= maxDepth; d++) {
    const tierDiv = document.createElement('div');
    tierDiv.className = 'tech-tier';
    tierDiv.innerHTML = `<div class="tech-tier-label">${tierLabels[d] || `Era ${d + 1}`}</div>`;
    const nodesDiv = document.createElement('div');
    nodesDiv.className = 'tech-tier-nodes';

    for (const t of tiers[d]) {
      const researched = game.techs.includes(t.id);
      const hasPrereqs = !t.requires || t.requires.every(r => game.techs.includes(r));
      const canStart = !game.currentResearch && !researched && hasPrereqs;
      const isCurrent = game.currentResearch === t.id;
      const isOnPath = game._techGoalPath && game._techGoalPath.includes(t.id);

      let cls = 'tech-node';
      if (researched) cls += ' tech-done';
      else if (isCurrent) cls += ' tech-current';
      else if (canStart) cls += ' tech-available';
      else cls += ' tech-locked';
      if (isOnPath && !researched) cls += ' tech-on-path';

      const reqNames = (t.requires || []).map(r => {
        const rt = TECHNOLOGIES.find(x => x.id === r);
        return rt ? rt.name : r;
      });

      const node = document.createElement('div');
      node.className = cls;
      const hasEureka = t.eureka;
      const eurekaTriggered = hasEureka && game.eurekas && game.eurekas.includes(t.id);
      const eurekaHtml = hasEureka
        ? `<div class="tech-node-eureka" style="font-size:10px;font-style:italic;color:${eurekaTriggered ? '#4caf50' : '#c9a84c'};margin-top:2px">${eurekaTriggered ? '\u2713 ' : '\u{1F4A1} '}Eureka: ${t.eureka.description}${eurekaTriggered ? '' : ' (40%)'}</div>`
        : '';
      node.innerHTML = `
        <div class="tech-node-name">${t.name}</div>
        <div class="tech-node-cost">${t.cost} \u{1F52C}</div>
        <div class="tech-node-desc">${t.desc}</div>
        ${reqNames.length ? `<div class="tech-node-req">\u2190 ${reqNames.join(', ')}</div>` : ''}
        ${eurekaHtml}
      `;
      node.title = `${t.name}: ${t.desc}${reqNames.length ? '\nRequires: ' + reqNames.join(', ') : ''}${hasEureka ? '\nEureka: ' + t.eureka.description + (eurekaTriggered ? ' (triggered!)' : ' (40% boost)') : ''}`;

      if (canStart) {
        node.addEventListener('click', (e) => {
          e.stopPropagation();
          startResearch(t.id);
          closeAllPanels();
        });
      } else if (!researched && !isCurrent) {
        // Set as goal — auto-path
        node.addEventListener('click', (e) => {
          e.stopPropagation();
          setTechGoal(t.id);
          renderResearchPanel(); // Re-render to show path
        });
      }
      nodesDiv.appendChild(node);
    }
    tierDiv.appendChild(nodesDiv);
    treeDiv.appendChild(tierDiv);
  }

  // Goal indicator
  if (game._techGoal) {
    const goalTech = TECHNOLOGIES.find(t => t.id === game._techGoal);
    if (goalTech) {
      const goalDiv = document.createElement('div');
      goalDiv.className = 'tech-goal-bar';
      goalDiv.innerHTML = `\u{1F3AF} Goal: <strong>${goalTech.name}</strong> \u2014 <span onclick="clearTechGoal()" style="cursor:pointer;text-decoration:underline">Clear</span>`;
      container.appendChild(goalDiv);
    }
  }

  container.appendChild(treeDiv);
}

function clearTechGoal() {
  game._techGoal = null;
  game._techGoalPath = null;
  renderResearchPanel();
}

function setTechGoal(goalId) {
  game._techGoal = goalId;
  // Calculate the path from current techs to the goal
  const path = [];
  function findPath(tid) {
    if (game.techs.includes(tid)) return;
    if (path.includes(tid)) return;
    const t = TECHNOLOGIES.find(x => x.id === tid);
    if (!t) return;
    if (t.requires) {
      for (const r of t.requires) findPath(r);
    }
    path.push(tid);
  }
  findPath(goalId);
  game._techGoalPath = path;

  // If not currently researching, start the first tech in the path
  if (!game.currentResearch && path.length > 0) {
    const first = path.find(tid => {
      const t = TECHNOLOGIES.find(x => x.id === tid);
      return !game.techs.includes(tid) && (!t.requires || t.requires.every(r => game.techs.includes(r)));
    });
    if (first) {
      startResearch(first);
    }
  }
  addEvent(`\u{1F3AF} Tech goal set: ${TECHNOLOGIES.find(t => t.id === goalId)?.name}`, 'science');
}

function startResearch(techId) {
  game.currentResearch = techId;
  game.researchProgress = 0;
  const tdata = TECHNOLOGIES.find(t => t.id === techId);
  logAction('research', `Started researching ${tdata?.name || techId}`, { techId });
  addEvent(`Started researching ${tdata.name}`, 'science');
  closeAllPanels();
}

export {
  showSelectionPanel,
  hideSelectionPanel,
  showTileInfo,
  showCityPanel,
  computeCityYields,
  showCombatResult,
  showDeleteConfirm,
  togglePanel,
  closeAllPanels,
  renderUnitsPanel,
  recruitUnit,
  checkVictoryConditions,
  ensureVictoryPanel,
  renderVictoryPanel,
  toggleVictoryPanel,
  renderBuildPanel,
  startBuild,
  cancelProduction,
  startWonderBuild,
  startDistrictBuild,
  findDistrictPlacement,
  placePlayerDistrict,
  computeAdjacencyBonus,
  ensureCivicsPanel,
  renderCivicsPanel,
  toggleCivicsPanel,
  ensureGovernmentPanel,
  renderGovernmentPanel,
  toggleGovernmentPanel,
  openGovernmentPanel,
  isGovernmentUnlocked,
  renderResearchPanel,
  setTechGoal,
  clearTechGoal,
  startResearch,
  showGiftUnitPanel,
  giftUnit,
  switchBuildCity
};

window.activateGreatPersonFromUnit = function(unitId) {
  const unit = game.units.find(u => u.id === unitId);
  if (!unit || unit.owner !== 'player') return;
  const gpDef = GREAT_PEOPLE_TYPES.find(g => g.type === unit.type);
  if (!gpDef) return;
  game.generalActiveTurns = 10;
  game.units = game.units.filter(u => u.id !== unitId);
  deselectUnit();
  addEvent(`${gpDef.icon} ${gpDef.name} activated! All units gain +5 combat for 10 turns.`, 'combat');
  showToast('General Activated', '+5 combat strength to all units for 10 turns.');
  render();
};

window.unitAction = function(action) {
  const unit = game.units.find(u => u.id === game.selectedUnitId);
  if (!unit || unit.owner !== 'player') return;
  const ut = UNIT_TYPES[unit.type];

  switch (action) {
    case 'activate':
      unit.fortified = false;
      unit.sleeping = false;
      unit.alert = false;
      addEvent(`${ut.name} activated`, '');
      showSelectionPanel(unit);
      render();
      return;
    case 'cancelWaypoint':
      unit.waypoint = null;
      addEvent(`${ut.name} journey cancelled`, '');
      showSelectionPanel(unit);
      render();
      return;
    case 'skip':
      unit.moveLeft = 0;
      addEvent(`${ut.name} skipped`, '');
      autoSelectNext();
      break;
    case 'fortify':
      unit.fortified = true;
      unit.moveLeft = 0;
      addEvent(`${ut.name} fortified`, 'combat');
      autoSelectNext();
      break;
    case 'heal':
      unit.fortified = true;
      unit.sleeping = false;
      unit.moveLeft = 0;
      addEvent(`${ut.name} fortifying to heal`, 'combat');
      autoSelectNext();
      break;
    case 'sleep':
      unit.sleeping = true;
      unit.moveLeft = 0;
      addEvent(`${ut.name} sleeping`, '');
      autoSelectNext();
      break;
    case 'alert':
      unit.alert = true;
      unit.moveLeft = 0;
      addEvent(`${ut.name} on alert`, 'combat');
      autoSelectNext();
      break;
    case 'pillage': {
      const tile = game.map[unit.row][unit.col];
      if (!tile || (!tile.improvement && !tile.road)) break;
      let tileOwner = null;
      for (const [fid, fc] of Object.entries(game.factionCities)) {
        if (hexDistance(unit.col, unit.row, fc.col, fc.row) <= (fc.borderRadius || 2)) { tileOwner = fid; break; }
      }
      if (!tileOwner && game.aiFactionCities) {
        for (const [fid, cities] of Object.entries(game.aiFactionCities)) {
          for (const ec of cities) {
            if (hexDistance(unit.col, unit.row, ec.col, ec.row) <= (ec.borderRadius || 1)) { tileOwner = fid; break; }
          }
          if (tileOwner) break;
        }
      }
      if (tileOwner) {
        const ownerName = FACTIONS[tileOwner] ? FACTIONS[tileOwner].name : tileOwner;
        if (!isAtWarWith(tileOwner)) {
          if (!confirmAndDeclareWar(tileOwner)) break;
        }
      }
      let reward = '';
      if (tile.improvement) {
        const impDef = TILE_IMPROVEMENTS[tile.improvement];
        const impName = impDef ? impDef.name : tile.improvement;
        const goldReward = 25 + Math.floor(Math.random() * 25);
        game.gold += goldReward;
        const healAmount = Math.min(25, 100 - unit.hp);
        unit.hp = Math.min(100, unit.hp + 25);
        tile.improvement = null;
        reward = `\u{1F525} Pillaged ${impName}! +${goldReward} gold` + (healAmount > 0 ? `, +${healAmount} HP healed` : '');
      } else if (tile.road) {
        tile.road = false;
        const goldReward = 10 + Math.floor(Math.random() * 15);
        game.gold += goldReward;
        const healAmount = Math.min(15, 100 - unit.hp);
        unit.hp = Math.min(100, unit.hp + 15);
        reward = `\u{1F525} Pillaged road! +${goldReward} gold` + (healAmount > 0 ? `, +${healAmount} HP healed` : '');
      }
      if (reward) {
        addEvent(reward, 'combat');
        logAction('combat', reward, { col: unit.col, row: unit.row, tileOwner });
      }
      unit.moveLeft = 0;
      autoSelectNext();
      break;
    }
    case 'delete':
      showDeleteConfirm(unit, ut);
      return;
  }
  render();
};
