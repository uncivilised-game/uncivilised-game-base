// ============================================
// EMBASSY & AMBASSADOR SYSTEM
// ============================================
// Embassies are permanent diplomatic installations that provide:
// - Enhanced intelligence on the host faction (full intel regardless of relationship)
// - +10 relationship bonus (maintained while embassy active)
// - Gossip network boost: +1 gossip point per turn per embassy
// - Unlocked by Foreign Trade civic
//
// Gossip Points drive intelligence depth:
// - Rumours revealed → +1 gossip point each
// - Embassies → +1 gossip point per turn per active embassy
// - More gossip = deeper intel across ALL factions (cross-referencing)

import { FACTIONS } from './constants.js';
import { game } from './state.js';
import { addEvent, showToast } from './events.js';

// ── Constants ──
export const EMBASSY_UNLOCK_TECH = 'foreign_trade'; // civic that unlocks embassies
export const EMBASSY_COST = 50;                      // gold to establish
export const EMBASSY_RELATIONSHIP_BONUS = 10;        // permanent relationship bonus
export const EMBASSY_GOSSIP_PER_TURN = 1;            // gossip points per turn per embassy

// Gossip thresholds for intel depth upgrades
export const GOSSIP_THRESHOLDS = {
  basic:  0,   // default — relationship-based intel
  good:   5,   // override 'minimal' → 'basic' for all factions
  full:  15,   // override 'basic' → 'good' for all factions
  master: 30,  // full intel on all met factions regardless of relationship
};

// ============================================
// STATE HELPERS
// ============================================

export function ensureEmbassyState() {
  if (!game.embassies) game.embassies = {};     // { factionId: { turn: N } }
  if (game.gossipPoints === undefined) game.gossipPoints = 0;
}

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Can the player establish an embassy with this faction?
 */
export function canEstablishEmbassy(factionId) {
  ensureEmbassyState();
  // Must have researched the unlock tech (it's a civic, check both techs and civics)
  const hasTech = (game.techs || []).includes(EMBASSY_UNLOCK_TECH) ||
                  (game.civics || []).includes(EMBASSY_UNLOCK_TECH);
  // Must have met the faction
  const hasMet = game.metFactions?.[factionId];
  // Must not already have embassy
  const alreadyHas = game.embassies[factionId];
  // Must have enough gold
  const hasGold = (game.gold || 0) >= EMBASSY_COST;
  // Must not be at war with this faction
  const rel = game.relationships?.[factionId] || 0;
  const atWar = rel <= -50;

  return { can: hasTech && hasMet && !alreadyHas && hasGold && !atWar, hasTech, hasMet, alreadyHas: !!alreadyHas, hasGold, atWar };
}

/**
 * Establish an embassy with a faction.
 */
export function establishEmbassy(factionId) {
  ensureEmbassyState();
  const check = canEstablishEmbassy(factionId);
  if (!check.can) return false;

  // Deduct gold
  game.gold -= EMBASSY_COST;

  // Create embassy
  game.embassies[factionId] = { turn: game.turn };

  // Relationship bonus
  if (!game.relationships) game.relationships = {};
  game.relationships[factionId] = (game.relationships[factionId] || 0) + EMBASSY_RELATIONSHIP_BONUS;

  // Event + notification
  const faction = FACTIONS[factionId];
  const msg = `Embassy established with ${faction?.name || factionId}! (+${EMBASSY_RELATIONSHIP_BONUS} relations)`;
  addEvent('\uD83C\uDFDB\uFE0F ' + msg, 'diplomacy');
  showToast('Embassy Established', msg, 4000);

  return true;
}

/**
 * Close an embassy (voluntary or forced by war).
 */
export function closeEmbassy(factionId) {
  ensureEmbassyState();
  if (!game.embassies[factionId]) return;

  delete game.embassies[factionId];

  // Remove relationship bonus
  if (game.relationships?.[factionId] !== undefined) {
    game.relationships[factionId] -= EMBASSY_RELATIONSHIP_BONUS;
  }

  const faction = FACTIONS[factionId];
  addEvent(`\uD83C\uDFDB\uFE0F Embassy with ${faction?.name || factionId} closed.`, 'diplomacy');
}

/**
 * Process embassy effects each turn.
 * Called from intelligence module during turn processing.
 */
export function processEmbassyTurn() {
  ensureEmbassyState();
  let gossipGained = 0;

  for (const fid of Object.keys(game.embassies)) {
    // Check if still valid (not at war)
    const rel = game.relationships?.[fid] || 0;
    if (rel <= -50) {
      closeEmbassy(fid);
      addEvent(`\u26A0\uFE0F Embassy with ${FACTIONS[fid]?.name || fid} expelled due to hostilities!`, 'diplomacy');
      continue;
    }
    // Gossip from embassy network
    gossipGained += EMBASSY_GOSSIP_PER_TURN;
  }

  game.gossipPoints += gossipGained;
}

/**
 * Award gossip points when a rumour is revealed.
 */
export function onRumourRevealed(count) {
  ensureEmbassyState();
  game.gossipPoints += (count || 1);
}

/**
 * Get the effective intel level for a faction,
 * factoring in both relationship AND gossip depth.
 */
export function getEffectiveIntelLevel(factionId) {
  ensureEmbassyState();
  const gp = game.gossipPoints || 0;

  // Embassy gives full intel on that specific faction
  if (game.embassies[factionId]) return 'full';

  // Relationship-based level
  const rel = game.relationships?.[factionId] || 0;
  let relLevel = 'minimal';
  if (rel >= 50 || game.activeAlliances?.[factionId]) relLevel = 'full';
  else if (rel >= 20) relLevel = 'good';
  else if (rel >= 0) relLevel = 'basic';

  // Gossip can upgrade the level
  if (gp >= GOSSIP_THRESHOLDS.master) return 'full';
  if (gp >= GOSSIP_THRESHOLDS.full && relLevel === 'basic') return 'good';
  if (gp >= GOSSIP_THRESHOLDS.full && relLevel === 'minimal') return 'basic';
  if (gp >= GOSSIP_THRESHOLDS.good && relLevel === 'minimal') return 'basic';

  return relLevel;
}

/**
 * Get embassy status summary for UI.
 */
export function getEmbassyInfo(factionId) {
  ensureEmbassyState();
  const hasEmbassy = !!game.embassies[factionId];
  const check = canEstablishEmbassy(factionId);
  return {
    hasEmbassy,
    canEstablish: check.can,
    hasTech: check.hasTech,
    cost: EMBASSY_COST,
    unlockTech: EMBASSY_UNLOCK_TECH,
    gossipPoints: game.gossipPoints || 0,
  };
}
