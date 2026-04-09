// ============================================
// ARMY / COMMANDER SYSTEM
// ============================================
// Inspired by Civ VII's Commander system:
// - Great Generals are a special unit type that can "pack" nearby military units
// - Packed units travel as a single stack (the army), moving at the General's speed
// - When arriving at a destination, the army "deploys" — units spread to adjacent hexes
// - Generals provide a passive +5 combat aura to all friendly units within 2 hexes
// - Units that were recently deployed from an army get an additional +5 combat bonus

import { UNIT_TYPES, ARMY_MAX_UNITS, ARMY_COMBAT_BONUS, ARMY_ADJACENT_AURA, ARMY_AURA_RANGE, MAP_COLS, MAP_ROWS } from './constants.js';
import { game } from './state.js';
import { hexDistance, getHexNeighbors } from './hex.js';
import { isTilePassable } from './map.js';
import { getUnitAt } from './combat.js';
import { addEvent, showToast } from './events.js';
import { render } from './render.js';
import { selectUnit } from './units.js';

// ============================================
// PACK UNITS INTO ARMY
// ============================================
/**
 * Pack nearby friendly military units into the general's army stack.
 * Units within 1 hex of the general can be packed.
 * @param {object} general - The general unit
 * @returns {number} Number of units packed
 */
export function packArmy(general) {
  if (!general || UNIT_TYPES[general.type]?.class !== 'commander') return 0;

  // Initialize army storage on the general
  if (!general.army) general.army = [];

  const maxSlots = getArmyCapacity(general);
  const available = maxSlots - general.army.length;
  if (available <= 0) {
    showToast('Army Full', `This general's army is at capacity (${maxSlots} units)`);
    return 0;
  }

  // Find eligible units within 1 hex
  const nearbyUnits = game.units.filter(u => {
    if (u.id === general.id) return false;
    if (u.owner !== general.owner) return false;
    const ut = UNIT_TYPES[u.type];
    if (!ut) return false;
    // Can't pack civilians, other commanders, or naval units
    if (['civilian', 'commander', 'naval'].includes(ut.class)) return false;
    // Must be adjacent
    if (hexDistance(u.col, u.row, general.col, general.row) > 1) return false;
    // Can't pack units already in another army
    if (u._inArmy) return false;
    return true;
  });

  let packed = 0;
  for (const unit of nearbyUnits) {
    if (packed >= available) break;

    // Store unit data and remove from map
    general.army.push({
      id: unit.id,
      type: unit.type,
      hp: unit.hp,
      xp: unit.xp,
      promotions: [...(unit.promotions || [])],
      combat: unit.combat,
    });

    // Remove unit from the game units array (it's now inside the general)
    game.units = game.units.filter(u => u.id !== unit.id);
    packed++;
  }

  if (packed > 0) {
    addEvent(`General packed ${packed} unit${packed > 1 ? 's' : ''} into army (${general.army.length}/${maxSlots})`, 'combat');
    showToast('Army Packed', `${packed} unit${packed > 1 ? 's' : ''} joined the army`);
    render();
  } else {
    showToast('No Units Nearby', 'Move military units adjacent to the General to pack them');
  }

  return packed;
}

// ============================================
// DEPLOY (UNPACK) ARMY
// ============================================
/**
 * Deploy all units from the general's army onto adjacent hexes.
 * Units spread out from the general's position.
 * @param {object} general - The general unit
 * @returns {number} Number of units deployed
 */
export function deployArmy(general) {
  if (!general || !general.army || general.army.length === 0) {
    showToast('No Army', 'This general has no packed units to deploy');
    return 0;
  }

  const neighbors = getHexNeighbors(general.col, general.row);
  // Shuffle deployment hexes for variety
  for (let i = neighbors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [neighbors[i], neighbors[j]] = [neighbors[j], neighbors[i]];
  }

  // Find valid deployment hexes
  const validHexes = neighbors.filter(nb => {
    if (nb.row < 0 || nb.row >= MAP_ROWS || nb.col < 0 || nb.col >= MAP_COLS) return false;
    const tile = game.map[nb.row]?.[nb.col];
    if (!tile || !isTilePassable(tile)) return false;
    if (getUnitAt(nb.col, nb.row)) return false;
    return true;
  });

  let deployed = 0;
  const undeployed = [];

  for (const stored of general.army) {
    if (deployed < validHexes.length) {
      const hex = validHexes[deployed];
      // Recreate the unit on the map
      const unit = {
        id: stored.id,
        type: stored.type,
        col: hex.col,
        row: hex.row,
        owner: general.owner,
        hp: stored.hp,
        moveLeft: 0, // Can't move the turn they deploy
        combat: stored.combat || UNIT_TYPES[stored.type]?.combat || 10,
        fortified: false,
        sleeping: false,
        alert: false,
        xp: stored.xp || 0,
        promotions: stored.promotions || [],
        pendingPromotion: false,
        hasAttackedThisTurn: false,
        _deployedFromArmy: true, // Tag for combat bonus
        _deployTurn: game.turn,
      };
      game.units.push(unit);
      deployed++;
    } else {
      undeployed.push(stored);
    }
  }

  // Keep any units that couldn't deploy (not enough space)
  general.army = undeployed;

  if (deployed > 0) {
    addEvent(`General deployed ${deployed} unit${deployed > 1 ? 's' : ''}!`, 'combat');
    showToast('Army Deployed!', `${deployed} unit${deployed > 1 ? 's' : ''} took the field`);
    if (undeployed.length > 0) {
      addEvent(`${undeployed.length} unit${undeployed.length > 1 ? 's' : ''} couldn't deploy — not enough space`, 'combat');
    }
    render();
  }

  return deployed;
}

// ============================================
// GENERAL AURA — COMBAT BONUS
// ============================================
/**
 * Calculate the combat bonus a unit receives from nearby generals.
 * Called from resolveCombat to add bonus to attack/defense.
 * @param {object} unit - The combat unit
 * @returns {number} Combat bonus from general aura
 */
export function getGeneralAuraBonus(unit) {
  if (!unit || !unit.owner) return 0;

  let bonus = 0;

  // Check for nearby generals (passive aura)
  const nearbyGeneral = game.units.find(u =>
    u.owner === unit.owner &&
    u.id !== unit.id &&
    UNIT_TYPES[u.type]?.class === 'commander' &&
    hexDistance(u.col, u.row, unit.col, unit.row) <= ARMY_AURA_RANGE
  );
  if (nearbyGeneral) {
    bonus += ARMY_ADJACENT_AURA;
  }

  // Deployment bonus: units recently deployed from an army get extra combat
  if (unit._deployedFromArmy && unit._deployTurn && (game.turn - unit._deployTurn) <= 2) {
    bonus += ARMY_COMBAT_BONUS;
  }

  return bonus;
}

// ============================================
// ARMY CAPACITY
// ============================================
function getArmyCapacity(general) {
  let capacity = ARMY_MAX_UNITS;
  // Future: promotions could increase capacity
  // e.g. 'logistics' promotion adds +2 slots
  if ((general.promotions || []).includes('logistics_mastery')) {
    capacity += 2;
  }
  return capacity;
}

// ============================================
// ARMY INFO (for UI display)
// ============================================
/**
 * Get a summary of what's in a general's army (for the selection panel).
 * @param {object} general - The general unit
 * @returns {object} Army info summary
 */
export function getArmyInfo(general) {
  if (!general || !general.army) return { count: 0, units: [], capacity: ARMY_MAX_UNITS };

  return {
    count: general.army.length,
    capacity: getArmyCapacity(general),
    units: general.army.map(u => ({
      type: u.type,
      name: UNIT_TYPES[u.type]?.name || u.type,
      icon: UNIT_TYPES[u.type]?.icon || '?',
      hp: u.hp,
    })),
  };
}

// ============================================
// UI INTEGRATION: SHOW ARMY ACTIONS IN SELECTION PANEL
// ============================================
/**
 * Returns HTML for army-specific action buttons.
 * Called from showSelectionPanel when a general is selected.
 */
export function renderArmyActions(general) {
  if (!general || UNIT_TYPES[general.type]?.class !== 'commander') return '';

  const info = getArmyInfo(general);
  const nearbyCount = game.units.filter(u => {
    if (u.id === general.id || u.owner !== general.owner) return false;
    const ut = UNIT_TYPES[u.type];
    if (!ut || ['civilian', 'commander', 'naval'].includes(ut.class)) return false;
    return hexDistance(u.col, u.row, general.col, general.row) <= 1;
  }).length;

  let html = `<div class="army-panel" style="margin-top:8px;padding:8px;background:rgba(0,0,0,0.3);border-radius:4px">`;
  html += `<p style="font-size:11px;color:#c9a84c;margin-bottom:4px"><strong>Army (${info.count}/${info.capacity})</strong></p>`;

  // Show packed units
  if (info.units.length > 0) {
    html += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">`;
    for (const u of info.units) {
      html += `<span style="font-size:14px" title="${u.name} (${u.hp}HP)">${u.icon}</span>`;
    }
    html += `</div>`;
  }

  // Pack button
  if (nearbyCount > 0 && info.count < info.capacity) {
    html += `<button id="btn-pack-army" class="btn btn-secondary" style="font-size:11px;padding:3px 8px;margin-right:4px">Pack ${nearbyCount} nearby</button>`;
  }

  // Deploy button
  if (info.count > 0) {
    html += `<button id="btn-deploy-army" class="btn btn-primary" style="font-size:11px;padding:3px 8px">Deploy Army</button>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Wire up army button click handlers.
 * Call this after rendering the selection panel for a general.
 */
export function bindArmyActions(general) {
  const packBtn = document.getElementById('btn-pack-army');
  if (packBtn) {
    packBtn.addEventListener('click', () => {
      packArmy(general);
      // Re-select to refresh the panel
      selectUnit(general);
    });
  }

  const deployBtn = document.getElementById('btn-deploy-army');
  if (deployBtn) {
    deployBtn.addEventListener('click', () => {
      deployArmy(general);
      selectUnit(general);
    });
  }
}
