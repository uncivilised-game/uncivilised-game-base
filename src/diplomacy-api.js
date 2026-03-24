// ============================================
// DIPLOMACY PLUGIN INTERFACE
// ============================================
// The game works without the diplomacy plugin — AI leaders just won't respond.
// To enable diplomacy, place the uncivilised-diplomacy repo alongside this repo
// and rebuild. The build system auto-detects it.

let _pluginLoaded = false;
const noop = () => {};

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
  updateDiploActions: noop,
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
};

export function registerDiplomacyPlugin(impl) {
  for (const key of Object.keys(impl)) {
    if (key in _plugin) {
      _plugin[key] = impl[key];
    }
  }
  _pluginLoaded = true;
  console.log('%c[Uncivilised] Diplomacy module loaded (%d functions registered)', 'color: #c9a84c; font-weight: bold', Object.keys(impl).length);
}

export function isDiplomacyLoaded() { return _pluginLoaded; }

// Wrapper exports — these delegate to _plugin so that late registration works
export function getRelationLabel(...args) { return _plugin.getRelationLabel(...args); }
export function establishTradeRoute(...args) { return _plugin.establishTradeRoute(...args); }
export function cancelTradeRoute(...args) { return _plugin.cancelTradeRoute(...args); }
export function renderDiplomacyPanel(...args) { return _plugin.renderDiplomacyPanel(...args); }
export function renderDiplomacyList(...args) { return _plugin.renderDiplomacyList(...args); }
export function renderRankingsView(...args) { return _plugin.renderRankingsView(...args); }
export function openChat(...args) { return _plugin.openChat(...args); }
export function renderDiplomacyActions(...args) { return _plugin.renderDiplomacyActions(...args); }
export function renderChatMarkdown(...args) { return _plugin.renderChatMarkdown(...args); }
export function updateDiploActions(...args) { return _plugin.updateDiploActions(...args); }
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
