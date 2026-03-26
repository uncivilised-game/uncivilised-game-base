// ============================================
// AI WONDER SELECTION & PRODUCTION
// ============================================
// AI factions evaluate and build wonders based on their archetype priorities.
// Called each turn from endTurn() in turn.js.

import { WONDERS, WONDER_PRIORITIES, FACTIONS, FACTION_TRAITS } from './constants.js';
import { game } from './state.js';
import { showWonderCompletionEvent } from './events.js';

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
