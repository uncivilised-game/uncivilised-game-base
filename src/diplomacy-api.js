// ============================================
// DIPLOMACY PLUGIN INTERFACE
// ============================================
// The game works without the diplomacy plugin — AI leaders just won't respond.
// To enable diplomacy, place the uncivilised-diplomacy repo alongside this repo
// and rebuild. The build system auto-detects it.

import { game } from './state.js';
import { currentChatCharacter } from './state.js';
import { FACTIONS } from './constants.js';

let _pluginLoaded = false;
const noop = () => {};
let _onTradeRouteEstablished = noop;
export function registerTradeRouteCallback(fn) { _onTradeRouteEstablished = fn; }

/** Base-game diplomacy shortcuts — always shown beneath the chat */
function _renderDiploShortcuts(factionId) {
  const container = document.getElementById('diplo-shortcuts');
  if (!container) return;
  const fid = factionId || currentChatCharacter;
  if (!fid) { container.innerHTML = ''; return; }

  const isAtWar = (game.aiWars || []).some(w =>
    (w.attacker === 'player' && w.defender === fid) ||
    (w.attacker === fid && w.defender === 'player')
  );
  const factionName = FACTIONS[fid]?.name || fid;

  let html = '<div style="display:flex;gap:6px;padding:6px 8px;flex-wrap:wrap">';
  if (isAtWar) {
    html += `<button class="minor-btn" style="background:#2a4a2a;color:#6aab5c;border:1px solid #3a5a3a;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px" onclick="window._diploQuickAction('${fid}','peace')">☮ Offer Peace</button>`;
  } else {
    html += `<button class="minor-btn" style="background:#4a2a2a;color:#d9534f;border:1px solid #5a3a3a;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px" onclick="window._diploQuickAction('${fid}','war')">⚔ Declare War</button>`;
  }
  html += '</div>';
  container.innerHTML = html;
}

window._diploQuickAction = function(factionId, action) {
  if (action === 'war') {
    const factionName = FACTIONS[factionId]?.name || factionId;
    if (!confirm(`Declare war on ${factionName}? This will end all agreements.`)) return;
    // Add war entry
    if (!game.aiWars) game.aiWars = [];
    const alreadyAtWar = game.aiWars.some(w =>
      (w.attacker === 'player' && w.defender === factionId) ||
      (w.attacker === factionId && w.defender === 'player')
    );
    if (!alreadyAtWar) {
      game.aiWars.push({ attacker: 'player', defender: factionId, startTurn: game.turn, turnsActive: 0 });
    }
    // Break all agreements
    delete game.activeAlliances?.[factionId];
    delete game.tradeDeals?.[factionId];
    delete game.defensePacts?.[factionId];
    delete game.openBorders?.[factionId];
    delete game.ceasefires?.[factionId];
    delete game.nonAggressionPacts?.[factionId];
    delete game.marriages?.[factionId];
    game.relationships[factionId] = Math.min(-50, (game.relationships[factionId] || 0) - 50);
    // Refresh the actions panel
    _renderDiploShortcuts(factionId);
    if (_pluginLoaded) _plugin.updateDiploActions(factionId);
  } else if (action === 'peace') {
    const factionName = FACTIONS[factionId]?.name || factionId;
    // Send peace message via chat instead of auto-accepting
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = `I wish to end this war. Let us make peace, ${factionName}.`;
      input.focus();
    }
  }
};

const _plugin = {
  // --- diplomacy.js ---
  getRelationLabel: (value) => {
    if (value >= 50) return { text: 'Allied', cls: 'relation-allied' };
    if (value >= 20) return { text: 'Friendly', cls: 'relation-friendly' };
    if (value > -20) return { text: 'Neutral', cls: 'relation-neutral' };
    return { text: 'Hostile', cls: 'relation-hostile' };
  },
  establishTradeRoute: noop,
  cancelTradeRoute: noop,
  renderDiplomacyPanel: () => {
    const container = document.getElementById('diplomacy-characters');
    if (container) container.innerHTML = '<p style="padding:20px;color:#888">Diplomacy module not installed.</p>';
  },
  renderDiplomacyList: noop,
  renderRankingsView: noop,
  openChat: () => {
    console.warn('Diplomacy module not installed — chat unavailable');
  },
  renderDiplomacyActions: noop,
  renderChatMarkdown: (text) => text,
  updateDiploActions: (fid) => { _renderDiploShortcuts(fid); },
  appendChatMessage: noop,
  appendChatAction: noop,
  sendChatMessage: noop,
  showDiplomacyProposal: noop,
  processCharacterAction: noop,

  // --- game-mods.js ---
  applyGameMod: noop,
  showModBanner: noop,
  getModCombatBonus: () => 0,
  getModYieldBonus: () => ({ food: 0, prod: 0, gold: 0 }),

  // --- ai.js ---
  processAITurns: noop,
  processBarbarianTurns: noop,
  processAICommitments: noop,
  moveAIUnitToward: noop,

  // --- advisors.js ---
  renderAdvisorPanel: noop,
  openAdvisor: noop,
  sendAdvisorMessage: noop,
  closeAdvisorChat: noop,
  isAdvisorChatActive: () => false,
  resetAdvisorConsultations: noop,
};

export function registerDiplomacyPlugin(impl) {
  for (const key of Object.keys(impl)) {
    if (key in _plugin) {
      _plugin[key] = impl[key];
    }
  }
  _pluginLoaded = true;
  console.log('%c[Uncivilized] Diplomacy module loaded (%d functions registered)', 'color: #c9a84c; font-weight: bold', Object.keys(impl).length);
}

export function isDiplomacyLoaded() { return _pluginLoaded; }

// Wrapper exports — these delegate to _plugin so that late registration works
export function getRelationLabel(...args) { return _plugin.getRelationLabel(...args); }

// War-aware relation label: when the player is at war with the faction, the
// displayed label should be "At War" regardless of the underlying relationship
// score. Base-game UI should call this instead of getRelationLabel() whenever
// it has a factionId available.
export function getWarAwareRelationLabel(factionId, value) {
  if (factionId && factionId !== 'player') {
    const wars = (game && game.aiWars) || [];
    const atWar = wars.some(w =>
      (w.attacker === 'player' && w.defender === factionId) ||
      (w.attacker === factionId && w.defender === 'player')
    );
    if (atWar) return { text: 'At War', cls: 'relation-at-war' };
  }
  const rel = (value !== undefined) ? value : ((game && game.relationships && game.relationships[factionId]) || 0);
  return getRelationLabel(rel);
}
export function establishTradeRoute(...args) {
  const result = _plugin.establishTradeRoute(...args);
  // Trigger currency eureka when a trade route is established
  _onTradeRouteEstablished();
  return result;
}
export function cancelTradeRoute(...args) { return _plugin.cancelTradeRoute(...args); }
export function renderDiplomacyPanel(...args) { return _plugin.renderDiplomacyPanel(...args); }
export function renderDiplomacyList(...args) { return _plugin.renderDiplomacyList(...args); }
export function renderRankingsView(...args) { return _plugin.renderRankingsView(...args); }
export function openChat(...args) { return _plugin.openChat(...args); }
export function renderDiplomacyActions(...args) { return _plugin.renderDiplomacyActions(...args); }
export function renderChatMarkdown(...args) { return _plugin.renderChatMarkdown(...args); }
export function updateDiploActions(...args) {
  _plugin.updateDiploActions(...args);
  // Always render base-game shortcuts (Declare War / Offer Peace)
  _renderDiploShortcuts(args[0]);
}
export function appendChatMessage(...args) { return _plugin.appendChatMessage(...args); }
export function appendChatAction(...args) { return _plugin.appendChatAction(...args); }
export function sendChatMessage(...args) { return _plugin.sendChatMessage(...args); }
export function showDiplomacyProposal(...args) { return _plugin.showDiplomacyProposal(...args); }
export function processCharacterAction(...args) { return _plugin.processCharacterAction(...args); }
export function applyGameMod(...args) { return _plugin.applyGameMod(...args); }
export function showModBanner(...args) { return _plugin.showModBanner(...args); }
export function getModCombatBonus(...args) { return _plugin.getModCombatBonus(...args); }
export function getModYieldBonus(...args) { return _plugin.getModYieldBonus(...args); }
export function processAITurns(...args) { return _plugin.processAITurns(...args); }
export function processBarbarianTurns(...args) { return _plugin.processBarbarianTurns(...args); }
export function processAICommitments(...args) { return _plugin.processAICommitments(...args); }
export function moveAIUnitToward(...args) { return _plugin.moveAIUnitToward(...args); }
export function renderAdvisorPanel(...args) { return _plugin.renderAdvisorPanel(...args); }
export function openAdvisor(...args) { return _plugin.openAdvisor(...args); }
export function sendAdvisorMessage(...args) { return _plugin.sendAdvisorMessage(...args); }
export function closeAdvisorChat(...args) { return _plugin.closeAdvisorChat(...args); }
export function isAdvisorChatActive(...args) { return _plugin.isAdvisorChatActive(...args); }
export function resetAdvisorConsultations(...args) { return _plugin.resetAdvisorConsultations(...args); }
