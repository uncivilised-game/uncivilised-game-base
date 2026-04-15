// ============================================
// WAR NOTIFICATIONS
// ============================================
// Blocking notifications when AI factions declare war on the player,
// and decision dialogs when AI factions attack the player's allies.

import { game } from './state.js';
import { FACTIONS } from './constants.js';
import { addEvent, logAction, showToast } from './events.js';

// ----- Queues live on game state so they survive save/load -----
function ensureQueues() {
  if (!game.pendingWarAlerts) game.pendingWarAlerts = [];
  if (!game.pendingAllyDecisions) game.pendingAllyDecisions = [];
}

// Call this when an AI faction has just declared war on the player.
// Queues a blocking alert that the player must dismiss before taking actions.
export function queueAIWarOnPlayer(factionId, reason) {
  if (!factionId || factionId === 'player') return;
  ensureQueues();
  // Avoid duplicate entries for the same attacker
  if (game.pendingWarAlerts.some(a => a.factionId === factionId)) return;
  game.pendingWarAlerts.push({
    factionId,
    reason: reason || 'declared war',
    turn: game.turn,
  });
}

// Call this when an AI faction has just declared war on a faction the player
// is allied with. Player must choose to defend (declare war on attacker) or
// cancel the alliance.
export function queueAllyAttacked(attackerId, allyId) {
  if (!attackerId || !allyId) return;
  if (attackerId === 'player' || allyId === 'player') return;
  ensureQueues();
  // Dedupe — one decision per (attacker, ally) pair
  if (game.pendingAllyDecisions.some(a => a.attackerId === attackerId && a.allyId === allyId)) return;
  game.pendingAllyDecisions.push({
    attackerId,
    allyId,
    turn: game.turn,
  });
}

// True if there's a blocking alert outstanding — input handlers should refuse
// to act on the game until this is drained.
export function hasBlockingAlert() {
  ensureQueues();
  return game.pendingWarAlerts.length > 0 || game.pendingAllyDecisions.length > 0;
}

// Drain the queues by showing blocking dialogs one at a time.
// Called at the end of endTurn() after AI processing, and also at game load
// to catch any alerts that were persisted mid-turn.
export function processPendingWarAlerts() {
  ensureQueues();

  // 1. AI-declared wars on the player — blocking alert()
  while (game.pendingWarAlerts.length > 0) {
    const entry = game.pendingWarAlerts.shift();
    const faction = FACTIONS[entry.factionId];
    const name = faction ? faction.name : entry.factionId;
    const message = `\u26A0 WAR DECLARED\n\n${name} has declared war on you!\n\n` +
      (entry.reason ? `Reason: ${entry.reason}\n\n` : '') +
      `You are now at war. Prepare your defences.`;
    try {
      if (typeof alert === 'function') alert(message);
    } catch (_) { /* non-browser env */ }
    addEvent(`${name} has declared war on you!`, 'combat');
    logAction('diplomacy', `AI declared war on player: ${name}`, { type: 'ai_war_on_player', factionId: entry.factionId });
  }

  // 2. AI attacks on player's allies — confirm() dialog with defend/cancel choice
  while (game.pendingAllyDecisions.length > 0) {
    const entry = game.pendingAllyDecisions.shift();
    const attacker = FACTIONS[entry.attackerId];
    const ally = FACTIONS[entry.allyId];
    const attackerName = attacker ? attacker.name : entry.attackerId;
    const allyName = ally ? ally.name : entry.allyId;

    const message = `\u26A0 YOUR ALLY IS UNDER ATTACK\n\n` +
      `${attackerName} has declared war on your ally ${allyName}.\n\n` +
      `OK = Defend ${allyName} (declare war on ${attackerName})\n` +
      `Cancel = Abandon your alliance with ${allyName}`;
    let defend = false;
    try {
      if (typeof confirm === 'function') defend = confirm(message);
    } catch (_) { /* non-browser env */ }

    if (defend) {
      // Declare war on attacker
      if (!game.aiWars) game.aiWars = [];
      const already = game.aiWars.some(w =>
        (w.attacker === 'player' && w.defender === entry.attackerId) ||
        (w.attacker === entry.attackerId && w.defender === 'player')
      );
      if (!already) {
        game.aiWars.push({
          attacker: 'player', defender: entry.attackerId,
          startTurn: game.turn, turnsActive: 0,
        });
      }
      // Break peace agreements with the attacker
      if (game.nonAggressionPacts) delete game.nonAggressionPacts[entry.attackerId];
      if (game.ceasefires) delete game.ceasefires[entry.attackerId];
      if (game.relationships) {
        game.relationships[entry.attackerId] = Math.min(-50, (game.relationships[entry.attackerId] || 0) - 30);
      }
      addEvent(`You honoured your alliance with ${allyName} and declared war on ${attackerName}!`, 'diplomacy');
      showToast('Alliance Honoured', `War declared on ${attackerName}`, 5000);
      logAction('diplomacy', `Player defended ally: declared war on ${attackerName}`, {
        type: 'player_defend_ally', attacker: entry.attackerId, ally: entry.allyId,
      });
    } else {
      // Abandon alliance with ally
      if (game.activeAlliances) delete game.activeAlliances[entry.allyId];
      if (game.defensePacts) delete game.defensePacts[entry.allyId];
      // Also remove from aiAlliances
      if (game.aiAlliances) {
        game.aiAlliances = game.aiAlliances.filter(al =>
          !(al.factions.includes('player') && al.factions.includes(entry.allyId))
        );
      }
      if (game.relationships) {
        game.relationships[entry.allyId] = Math.min(game.relationships[entry.allyId] || 0, -20);
      }
      addEvent(`You abandoned your alliance with ${allyName}. Relations soured.`, 'diplomacy');
      showToast('Alliance Abandoned', `${allyName} has been abandoned`, 5000);
      logAction('diplomacy', `Player abandoned alliance with ${allyName}`, {
        type: 'player_abandon_ally', ally: entry.allyId, attacker: entry.attackerId,
      });
    }
  }
}

// Check if the given faction is an ally of the player. Used by war-creation
// code paths to decide whether to queue an ally-attacked decision.
export function isPlayerAlly(factionId) {
  if (!factionId) return false;
  if (game.activeAlliances && game.activeAlliances[factionId]) return true;
  if (game.defensePacts && game.defensePacts[factionId]) return true;
  if (game.aiAlliances) {
    for (const al of game.aiAlliances) {
      if (al.factions.includes('player') && al.factions.includes(factionId)) return true;
    }
  }
  return false;
}

// Helper wrapper: when AI declares war on a faction, this function does the
// right thing — queues a player-war alert OR an ally-attacked decision.
// Returns true if player involvement was queued.
export function notifyAIWarDeclaration(attackerId, defenderId, reason) {
  if (defenderId === 'player') {
    queueAIWarOnPlayer(attackerId, reason);
    return true;
  }
  if (isPlayerAlly(defenderId)) {
    queueAllyAttacked(attackerId, defenderId);
    return true;
  }
  return false;
}
