// ============================================
// AI WONDER SELECTION & PRODUCTION
// ============================================
// AI factions evaluate and build wonders based on their archetype priorities.
// Called each turn from endTurn() in turn.js.

import { WONDERS, WONDER_PRIORITIES, FACTIONS, FACTION_TRAITS, DISTRICTS, MAP_COLS, MAP_ROWS } from './constants.js';
import { game } from './state.js';
import { showWonderCompletionEvent, addEvent } from './events.js';
import { getHexNeighbors } from './hex.js';

/** Cancel all AI factions building a given wonder (called when someone completes it). */
export function cancelAIWonderBuilders(wonderId, completedBy) {
  if (!game.aiWonderProgress) return;
  for (const [fid, wp] of Object.entries(game.aiWonderProgress)) {
    if (wp.wonderId === wonderId && fid !== completedBy) {
      const refundGold = Math.floor(wp.progress * 0.5);
      // Credit refund to AI faction stats
      if (game.factionStats && game.factionStats[fid]) {
        game.factionStats[fid].gold = (game.factionStats[fid].gold || 0) + refundGold;
      }
      delete game.aiWonderProgress[fid];
    }
  }
}

/** Process AI wonder building each turn — called from endTurn after processAITurns. */
export function processAIWonderTurns() {
  if (!game.aiWonderProgress) game.aiWonderProgress = {};
  if (!game.builtWonders) game.builtWonders = {};

  for (const fid of Object.keys(FACTIONS)) {
    const traits = FACTION_TRAITS[fid];
    if (!traits) continue;
    const stats = game.factionStats[fid];
    if (!stats) continue;

    // If this faction is already building a wonder, advance production
    if (game.aiWonderProgress[fid]) {
      const wp = game.aiWonderProgress[fid];
      // Check if the wonder was scooped
      if (game.builtWonders[wp.wonderId]) {
        const refundGold = Math.floor(wp.progress * 0.5);
        if (stats) stats.gold = (stats.gold || 0) + refundGold;
        delete game.aiWonderProgress[fid];
        continue;
      }
      // AI production rate: 3-8 per turn based on faction economy
      const baseProd = 3 + Math.floor(Math.random() * 3) + Math.min(3, Math.floor((stats.gold || 0) / 50));
      wp.progress += baseProd;
      const wdata = WONDERS.find(w => w.id === wp.wonderId);
      if (wdata && wp.progress >= wdata.cost) {
        // AI completes the wonder!
        game.builtWonders[wp.wonderId] = fid;
        const factionName = FACTIONS[fid].name;
        showWonderCompletionEvent(wdata.name, wdata.icon, factionName);
        // Cancel other AI builders
        cancelAIWonderBuilders(wp.wonderId, fid);
        delete game.aiWonderProgress[fid];
      }
      continue;
    }

    // Should the AI start building a wonder?
    // Requirements: accumulated production >= 60 (simulated via gold/military proxy), no urgent military needs
    const accumulated = (stats.gold || 0) + (stats.military || 0);
    if (accumulated < 60) continue;
    // Skip if under military pressure (high military trait + low military)
    if (traits.military > 0.7 && (stats.military || 0) < 15) continue;

    // Evaluate available wonders based on archetype
    const archetype = traits.archetype;
    const priorities = WONDER_PRIORITIES[archetype] || WONDER_PRIORITIES.diplomatic;
    const available = WONDERS.filter(w => !game.builtWonders[w.id] && !isWonderBeingBuiltByAI(w.id));

    if (available.length === 0) continue;

    // Score each wonder
    let bestWonder = null;
    let bestScore = -1;
    for (const w of available) {
      const priority = priorities[w.id] || 0.3;
      // Add some randomness so AI doesn't always pick the same one
      const score = priority + Math.random() * 0.3;
      if (score > bestScore) {
        bestScore = score;
        bestWonder = w;
      }
    }

    // Only start if score is high enough (prevents every AI from building wonders immediately)
    if (bestWonder && bestScore > 0.5) {
      game.aiWonderProgress[fid] = { wonderId: bestWonder.id, progress: 0 };
    }
  }
}

/** Check if any AI faction is currently building a given wonder. */
export function isWonderBeingBuiltByAI(wonderId) {
  if (!game.aiWonderProgress) return false;
  for (const wp of Object.values(game.aiWonderProgress)) {
    if (wp.wonderId === wonderId) return true;
  }
  return false;
}

// ============================================
// AI DISTRICT SELECTION & PRODUCTION
// ============================================

/** District priority weights per archetype (higher = more likely to build). */
const DISTRICT_PRIORITIES = {
  expansionist: {
    garden_quarter: 0.9, commercial_hub: 0.7, harbor: 0.6, campus: 0.4, encampment: 0.5, holy_site: 0.3,
  },
  militaristic: {
    encampment: 0.95, harbor: 0.5, commercial_hub: 0.4, garden_quarter: 0.3, campus: 0.3, holy_site: 0.2,
  },
  diplomatic: {
    commercial_hub: 0.9, harbor: 0.7, holy_site: 0.6, garden_quarter: 0.5, campus: 0.5, encampment: 0.2,
  },
  cultural: {
    holy_site: 0.9, campus: 0.8, garden_quarter: 0.6, commercial_hub: 0.4, harbor: 0.4, encampment: 0.2,
  },
};

/** Find a valid tile near an AI faction city for a district. */
function findAIDistrictTile(fid, districtId) {
  const fc = game.factionCities[fid];
  if (!fc) return null;
  const dd = DISTRICTS[districtId];
  if (!dd) return null;
  const placement = dd.placement || {};
  const radius = fc.borderRadius || 2;

  for (let ring = 1; ring <= radius; ring++) {
    for (let r = fc.row - ring; r <= fc.row + ring; r++) {
      for (let c = fc.col - ring; c <= fc.col + ring; c++) {
        if (r < 0 || r >= MAP_ROWS || c < 0 || c >= MAP_COLS) continue;
        const tile = game.map[r][c];
        if (!tile) continue;
        if (tile.base === 'ocean' || tile.base === 'coast' || tile.base === 'lake') continue;
        if (tile.feature === 'mountain') continue;
        if (tile.district || tile.improvement) continue;
        // Skip city tiles
        if (fc.col === c && fc.row === r) continue;
        if (game.cities.some(ct => ct.col === c && ct.row === r)) continue;

        // Placement rules
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
          const adjCity = nbs.some(nb => fc.col === nb.col && fc.row === nb.row);
          if (adjCity) continue;
        }

        return { col: c, row: r };
      }
    }
  }
  return null;
}

/** Place a completed AI district on the map and apply stat bonuses. */
function placeAIDistrict(fid, districtId, target) {
  const dd = DISTRICTS[districtId];
  if (!dd) return;
  const tile = game.map[target.row][target.col];
  tile.district = districtId;
  tile.districtOwner = fid; // track who owns it

  // Apply yield bonuses to faction stats
  const stats = game.factionStats[fid];
  if (stats) {
    if (dd.yields.gold) stats.gold = (stats.gold || 0) + dd.yields.gold * 5; // simulated accumulation
    if (dd.yields.science) stats.science = (stats.science || 0) + dd.yields.science;
    if (dd.yields.military) stats.military = (stats.military || 0) + dd.yields.military;
    if (dd.yields.food) stats.population = (stats.population || 0) + dd.yields.food * 100;
  }
}

/** Process AI district building each turn — called from endTurn after processAIWonderTurns. */
export function processAIDistrictTurns() {
  if (!game.aiDistrictProgress) game.aiDistrictProgress = {};

  for (const fid of Object.keys(FACTIONS)) {
    const traits = FACTION_TRAITS[fid];
    if (!traits) continue;
    const stats = game.factionStats[fid];
    if (!stats) continue;
    const fc = game.factionCities[fid];
    if (!fc) continue;

    // Track which districts this faction has built
    if (!fc.districts) fc.districts = [];

    // If currently building a district, advance production
    if (game.aiDistrictProgress[fid]) {
      const dp = game.aiDistrictProgress[fid];
      const ddata = DISTRICTS[dp.districtId];
      if (!ddata) { delete game.aiDistrictProgress[fid]; continue; }

      // AI production rate: 3-7 per turn based on economy
      const baseProd = 3 + Math.floor(Math.random() * 2) + Math.min(2, Math.floor((stats.gold || 0) / 80));
      dp.progress += baseProd;

      if (dp.progress >= ddata.cost) {
        // Completed!
        placeAIDistrict(fid, dp.districtId, dp.target);
        fc.districts.push(dp.districtId);
        const fName = FACTIONS[fid].name;
        addEvent(ddata.icon + ' ' + fName + ' built a ' + ddata.name + ' district', 'gold');
        delete game.aiDistrictProgress[fid];
      }
      continue;
    }

    // Should the AI start a district? (only after turn 10, and with some economy established)
    if (game.turn < 10) continue;
    if ((stats.gold || 0) < 30) continue;
    // Don't start if already building a wonder
    if (game.aiWonderProgress[fid]) continue;
    // Limit: max 3 districts per AI faction
    if (fc.districts.length >= 3) continue;
    // Random chance per turn to start (so they don't all build at once)
    if (Math.random() > 0.25) continue;

    // Evaluate districts based on archetype
    const archetype = traits.archetype || 'diplomatic';
    const priorities = DISTRICT_PRIORITIES[archetype] || DISTRICT_PRIORITIES.diplomatic;

    // Filter to districts not yet built by this faction
    const available = Object.keys(DISTRICTS).filter(did => !fc.districts.includes(did));
    if (available.length === 0) continue;

    // Score each district
    let bestDistrict = null;
    let bestScore = -1;
    for (const did of available) {
      const priority = priorities[did] || 0.3;
      // Check if we can actually place it
      const target = findAIDistrictTile(fid, did);
      if (!target) continue;

      const score = priority + Math.random() * 0.2;
      if (score > bestScore) {
        bestScore = score;
        bestDistrict = { id: did, target };
      }
    }

    if (bestDistrict && bestScore > 0.3) {
      game.aiDistrictProgress[fid] = {
        districtId: bestDistrict.id,
        target: bestDistrict.target,
        progress: 0,
      };
    }
  }
}
