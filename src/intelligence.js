// ============================================
// INTELLIGENCE PANEL — World Knowledge Dashboard
// ============================================
// Gives the player a centralised view of everything they know:
// - Faction dossiers (met factions, reputation, diplomatic history)
// - AI-to-AI relationships (known wars, alliances, trade deals)
// - Rumours & whispers (unmet factions, delayed intel)
// - Power rankings & threat assessment
// - Historical diplomatic ledger

import { FACTIONS, FACTION_TRAITS } from './constants.js';
import { game } from './state.js';
import { getAIRelation, getAIWars, getAIAlliances, getAITradeDeals } from './ai-diplomacy.js';
import { getRelationLabel, openChat } from './diplomacy-api.js';
import { getComparisonData } from './map.js';

// ── Panel state ──
let currentTab = 'overview';
let selectedFaction = null;

// ── Styles ──
const STYLES = {
  panel: 'background:rgba(10,12,18,0.96);color:#f0e8d0;font-size:13px;line-height:1.5;',
  header: 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(201,168,76,0.3);',
  tabs: 'display:flex;gap:2px;padding:6px 10px;border-bottom:1px solid rgba(201,168,76,0.15);background:rgba(0,0,0,0.2);',
  tab: 'padding:5px 12px;border-radius:4px 4px 0 0;cursor:pointer;font-size:12px;border:1px solid transparent;border-bottom:none;',
  tabActive: 'background:rgba(201,168,76,0.2);border-color:rgba(201,168,76,0.4);color:#ffd700;',
  tabInactive: 'background:transparent;color:#aaa;',
  body: 'padding:10px 14px;max-height:400px;overflow-y:auto;',
  card: 'background:rgba(30,30,40,0.8);border:1px solid rgba(201,168,76,0.2);border-radius:6px;padding:10px 12px;margin-bottom:8px;',
  cardHeader: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;',
  badge: 'display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:bold;',
  stat: 'display:inline-block;margin-right:12px;font-size:11px;color:#bbb;',
  divider: 'border:none;border-top:1px solid rgba(201,168,76,0.15);margin:8px 0;',
  btn: 'padding:4px 10px;border-radius:4px;border:1px solid rgba(201,168,76,0.4);background:rgba(201,168,76,0.15);color:#ffd700;cursor:pointer;font-size:11px;',
  threat: { low: 'background:rgba(40,120,40,0.3);color:#8f8;', medium: 'background:rgba(180,150,30,0.3);color:#ff0;', high: 'background:rgba(180,40,40,0.3);color:#f88;' },
};

// ============================================
// PUBLIC API
// ============================================

/**
 * Render the full intelligence panel into the given container element.
 * Called by togglePanel('intel-panel') in ui-panels.js.
 */
export function renderIntelligencePanel() {
  const container = document.getElementById('intel-body');
  if (!container) return;

  let html = '';
  // Tab bar
  html += renderTabs();
  // Tab content
  html += `<div style="${STYLES.body}">`;
  switch (currentTab) {
    case 'overview': html += renderOverview(); break;
    case 'factions': html += selectedFaction ? renderFactionDossier(selectedFaction) : renderFactionList(); break;
    case 'relations': html += renderRelationsMap(); break;
    case 'rumours': html += renderRumoursTab(); break;
    case 'ledger': html += renderLedgerTab(); break;
    default: html += renderOverview();
  }
  html += '</div>';
  container.innerHTML = html;

  // Bind tab clicks
  bindTabClicks();
}

/**
 * Switch to a specific tab and re-render.
 */
export function switchIntelTab(tab, faction) {
  currentTab = tab;
  selectedFaction = faction || null;
  renderIntelligencePanel();
}

/**
 * Get a quick intel summary for the turn summary panel.
 * Returns a short HTML string of the most important new intel.
 */
export function getIntelSummary() {
  const items = [];
  // Active wars
  const wars = game.aiWars || [];
  if (wars.length > 0) {
    items.push(`\u2694\uFE0F ${wars.length} active war${wars.length > 1 ? 's' : ''} between AI factions`);
  }
  // Active alliances
  const alliances = game.aiAlliances || [];
  if (alliances.length > 0) {
    items.push(`\uD83E\uDD1D ${alliances.length} alliance${alliances.length > 1 ? 's' : ''} in effect`);
  }
  // Pending rumours
  const rumours = game.rumourQueue || [];
  const pending = rumours.filter(r => r.revealTurn > game.turn);
  if (pending.length > 0) {
    items.push(`\uD83D\uDCAC ${pending.length} unconfirmed rumour${pending.length > 1 ? 's' : ''}`);
  }
  // Threat assessment
  const topThreat = getTopThreat();
  if (topThreat) {
    items.push(`\u26A0\uFE0F Highest threat: ${FACTIONS[topThreat.fid]?.name || topThreat.fid}`);
  }
  return items.join(' \u2022 ');
}

// ============================================
// TAB RENDERING
// ============================================

function renderTabs() {
  const tabs = [
    { id: 'overview', label: '\uD83C\uDF0D Overview' },
    { id: 'factions', label: '\uD83D\uDC51 Factions' },
    { id: 'relations', label: '\uD83D\uDD17 Relations' },
    { id: 'rumours', label: '\uD83D\uDCAC Rumours' },
    { id: 'ledger', label: '\uD83D\uDCDC Ledger' },
  ];
  let html = `<div style="${STYLES.tabs}">`;
  for (const tab of tabs) {
    const active = currentTab === tab.id;
    html += `<div class="intel-tab" data-tab="${tab.id}" style="${STYLES.tab}${active ? STYLES.tabActive : STYLES.tabInactive}">${tab.label}</div>`;
  }
  html += '</div>';
  return html;
}

function bindTabClicks() {
  document.querySelectorAll('.intel-tab').forEach(el => {
    el.onclick = () => {
      currentTab = el.dataset.tab;
      selectedFaction = null;
      renderIntelligencePanel();
    };
  });
  // Faction card clicks
  document.querySelectorAll('.intel-faction-card').forEach(el => {
    el.onclick = () => {
      selectedFaction = el.dataset.fid;
      currentTab = 'factions';
      renderIntelligencePanel();
    };
  });
  // Back button
  const backBtn = document.getElementById('intel-back-btn');
  if (backBtn) {
    backBtn.onclick = () => { selectedFaction = null; renderIntelligencePanel(); };
  }
  // Chat buttons
  document.querySelectorAll('.intel-chat-btn').forEach(el => {
    el.onclick = () => { openChat(el.dataset.fid); };
  });
}

// ============================================
// OVERVIEW TAB
// ============================================

function renderOverview() {
  let html = '';
  const metCount = Object.keys(game.metFactions || {}).length;
  const totalFactions = Object.keys(FACTIONS).length;
  const wars = game.aiWars || [];
  const alliances = game.aiAlliances || [];
  const trades = game.aiTradeDeals || [];

  // World status card
  html += `<div style="${STYLES.card}">`;
  html += `<div style="${STYLES.cardHeader}"><strong>\uD83C\uDF0D World Status — Turn ${game.turn}</strong></div>`;
  html += `<div style="${STYLES.stat}">Factions discovered: ${metCount}/${totalFactions}</div>`;
  html += `<div style="${STYLES.stat}">Active wars: ${wars.length}</div>`;
  html += `<div style="${STYLES.stat}">Alliances: ${alliances.length}</div>`;
  html += `<div style="${STYLES.stat}">Trade deals: ${trades.length}</div>`;
  html += '</div>';

  // Your diplomatic standing
  html += `<div style="${STYLES.card}">`;
  html += `<div style="${STYLES.cardHeader}"><strong>\uD83D\uDC51 Your Diplomatic Standing</strong></div>`;
  const metFactions = Object.keys(game.metFactions || {});
  if (metFactions.length === 0) {
    html += '<div style="color:#888;font-style:italic;">No factions discovered yet. Send scouts to explore!</div>';
  } else {
    for (const fid of metFactions) {
      const faction = FACTIONS[fid];
      if (!faction) continue;
      const rel = game.relationships?.[fid] || 0;
      const label = getRelationLabel(rel);
      const threat = assessThreat(fid);
      html += `<div class="intel-faction-card" data-fid="${fid}" style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);">`;
      html += `<span style="color:${faction.color}">${faction.icon || '\uD83C\uDFF0'} ${faction.name}</span>`;
      html += `<span><span class="${label.cls}" style="font-size:11px;">${label.text}</span>`;
      html += ` <span style="${STYLES.badge}${STYLES.threat[threat.level]}">${threat.level.toUpperCase()}</span></span>`;
      html += '</div>';
    }
  }
  html += '</div>';

  // Active conflicts
  if (wars.length > 0) {
    html += `<div style="${STYLES.card}">`;
    html += `<div style="${STYLES.cardHeader}"><strong>\u2694\uFE0F Active Conflicts</strong></div>`;
    for (const war of wars) {
      const a = FACTIONS[war.attacker];
      const d = FACTIONS[war.defender];
      html += `<div style="padding:2px 0;font-size:12px;">`;
      html += `<span style="color:${a?.color || '#fff'}">${a?.name || war.attacker}</span>`;
      html += ` vs <span style="color:${d?.color || '#fff'}">${d?.name || war.defender}</span>`;
      html += ` <span style="color:#888;font-size:10px;">(${war.turnsActive || 0} turns)</span>`;
      html += '</div>';
    }
    html += '</div>';
  }

  // Power rankings snapshot
  html += renderPowerSnapshot();

  return html;
}

function renderPowerSnapshot() {
  const data = typeof getComparisonData === 'function' ? getComparisonData() : [];
  if (data.length <= 1) return '';
  data.sort((a, b) => (b.stats?.score || 0) - (a.stats?.score || 0));

  let html = `<div style="${STYLES.card}">`;
  html += `<div style="${STYLES.cardHeader}"><strong>\uD83D\uDCCA Power Rankings</strong></div>`;
  const maxScore = data[0]?.stats?.score || 1;
  for (let i = 0; i < data.length; i++) {
    const e = data[i];
    const pct = Math.round(((e.stats?.score || 0) / maxScore) * 100);
    const color = e.isPlayer ? '#ffd700' : (e.color || '#888');
    html += `<div style="display:flex;align-items:center;gap:8px;padding:2px 0;font-size:12px;">`;
    html += `<span style="width:16px;text-align:right;color:#888;">${i + 1}.</span>`;
    html += `<span style="flex:1;color:${color}">${e.isPlayer ? '\uD83D\uDC51 ' : ''}${e.name}</span>`;
    html += `<div style="width:80px;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">`;
    html += `<div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>`;
    html += '</div>';
    html += `<span style="width:40px;text-align:right;color:#aaa;">${e.stats?.score || 0}</span>`;
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// ============================================
// FACTIONS TAB — List & Dossier
// ============================================

function renderFactionList() {
  let html = '';
  const metFactions = Object.keys(game.metFactions || {});
  const unmetFactions = Object.keys(FACTIONS).filter(fid => !game.metFactions?.[fid]);

  // Met factions
  html += `<div style="font-weight:bold;color:#ffd700;margin-bottom:6px;">Known Factions (${metFactions.length})</div>`;
  if (metFactions.length === 0) {
    html += '<div style="color:#888;font-style:italic;margin-bottom:12px;">No factions discovered yet.</div>';
  }
  for (const fid of metFactions) {
    html += renderFactionCard(fid);
  }

  // Unmet factions (mysterious)
  if (unmetFactions.length > 0) {
    html += `<hr style="${STYLES.divider}">`;
    html += `<div style="font-weight:bold;color:#888;margin-bottom:6px;">Unknown Lands (${unmetFactions.length} undiscovered)</div>`;
    for (const fid of unmetFactions) {
      const faction = FACTIONS[fid];
      html += `<div style="${STYLES.card}opacity:0.5;">`;
      html += `<span style="color:#666;">\u2753 ${faction?.name || 'Unknown'}</span>`;
      html += `<span style="color:#555;font-size:11px;margin-left:8px;">— rumours only</span>`;
      html += '</div>';
    }
  }
  return html;
}

function renderFactionCard(fid) {
  const faction = FACTIONS[fid];
  if (!faction) return '';
  const rel = game.relationships?.[fid] || 0;
  const label = getRelationLabel(rel);
  const stats = game.factionStats?.[fid] || {};
  const traits = FACTION_TRAITS[fid];
  const threat = assessThreat(fid);
  const arcIcons = { militaristic: '\u2694\uFE0F', expansionist: '\uD83C\uDF0D', cultural: '\uD83C\uDFAD', diplomatic: '\uD83E\uDD1D' };

  let html = `<div class="intel-faction-card" data-fid="${fid}" style="${STYLES.card}cursor:pointer;">`;
  html += `<div style="${STYLES.cardHeader}">`;
  html += `<span style="color:${faction.color};font-weight:bold;">${faction.icon || '\uD83C\uDFF0'} ${faction.name}</span>`;
  html += `<span style="${STYLES.badge}${STYLES.threat[threat.level]}">${threat.level.toUpperCase()} THREAT</span>`;
  html += '</div>';
  html += `<div style="margin-bottom:4px;">`;
  html += `<span class="${label.cls}" style="font-size:12px;">${label.text}</span>`;
  html += ` <span style="color:#888;font-size:11px;">(${rel > 0 ? '+' : ''}${rel})</span>`;
  if (traits) html += ` <span style="font-size:11px;color:#aaa;margin-left:8px;">${arcIcons[traits.archetype] || ''} ${traits.archetype}</span>`;
  html += '</div>';
  // Quick stats (based on intel level)
  const detail = getIntelLevel(fid);
  if (detail !== 'minimal') {
    html += '<div>';
    if (detail === 'full' || detail === 'good') {
      html += `<span style="${STYLES.stat}">\u2694 Military: ${stats.military || '?'}</span>`;
      html += `<span style="${STYLES.stat}">\uD83D\uDCB0 Gold: ${stats.gold || '?'}</span>`;
    }
    if (detail === 'full') {
      html += `<span style="${STYLES.stat}">\uD83D\uDC65 Pop: ${stats.population ? (stats.population / 1000).toFixed(1) + 'k' : '?'}</span>`;
      html += `<span style="${STYLES.stat}">\uD83D\uDD2C Techs: ${stats.techs || '?'}</span>`;
    }
    html += '</div>';
  } else {
    html += '<div style="color:#666;font-size:11px;font-style:italic;">Limited intelligence — improve relations for better info</div>';
  }
  html += '<div style="text-align:right;margin-top:4px;font-size:11px;color:#ffd700;">Click for full dossier \u2192</div>';
  html += '</div>';
  return html;
}

// ============================================
// FACTION DOSSIER — Deep dive on one faction
// ============================================

function renderFactionDossier(fid) {
  const faction = FACTIONS[fid];
  if (!faction) { selectedFaction = null; return renderFactionList(); }

  let html = '';
  // Back button
  html += `<div id="intel-back-btn" style="cursor:pointer;color:#ffd700;margin-bottom:8px;font-size:12px;">\u2190 Back to faction list</div>`;

  // Faction header
  const rel = game.relationships?.[fid] || 0;
  const label = getRelationLabel(rel);
  const traits = FACTION_TRAITS[fid];
  const stats = game.factionStats?.[fid] || {};
  const threat = assessThreat(fid);

  html += `<div style="${STYLES.card}">`;
  html += `<div style="display:flex;align-items:center;justify-content:space-between;">`;
  html += `<span style="color:${faction.color};font-size:16px;font-weight:bold;">${faction.icon || '\uD83C\uDFF0'} ${faction.name}</span>`;
  html += `<button class="intel-chat-btn" data-fid="${fid}" style="${STYLES.btn}">\uD83D\uDCAC Speak to Leader</button>`;
  html += '</div>';
  html += `<div style="margin-top:6px;">`;
  html += `<span class="${label.cls}">${label.text}</span>`;
  html += ` <span style="color:#888;">(${rel > 0 ? '+' : ''}${rel})</span>`;
  html += ` \u2022 <span style="${STYLES.badge}${STYLES.threat[threat.level]}">${threat.level.toUpperCase()} THREAT</span>`;
  if (traits) html += ` \u2022 <span style="color:#aaa;">${traits.archetype}</span>`;
  html += '</div>';
  html += '</div>';

  // Reputation breakdown (what your spies tell you about how this leader sees you)
  html += renderReputationCard(fid);

  // Known stats
  html += renderStatsCard(fid, stats);

  // Their diplomatic relationships with other AI factions
  html += renderFactionRelationsCard(fid);

  // Diplomatic history with player
  html += renderDiplomaticHistory(fid);

  return html;
}

function renderReputationCard(fid) {
  const rep = game.reputation?.[fid];
  if (!rep) return '';

  const dims = [
    { key: 'honour', label: 'Honour', icon: '\uD83C\uDFC5', desc: 'Do you keep your word?' },
    { key: 'generosity', label: 'Generosity', icon: '\uD83C\uDF81', desc: 'Do you give more than you take?' },
    { key: 'menace', label: 'Menace', icon: '\uD83D\uDDE1\uFE0F', desc: 'How threatening are you?' },
    { key: 'reliability', label: 'Reliability', icon: '\uD83E\uDD1D', desc: 'Do you follow through?' },
    { key: 'cunning', label: 'Cunning', icon: '\uD83E\uDD8A', desc: 'Have you been caught manipulating?' },
  ];

  let html = `<div style="${STYLES.card}">`;
  html += `<div style="${STYLES.cardHeader}"><strong>\uD83D\uDD75\uFE0F How ${FACTIONS[fid]?.name || fid} Sees You</strong></div>`;
  for (const dim of dims) {
    const val = Math.round(rep[dim.key] || 0);
    const maxBar = 50;
    const absVal = Math.min(Math.abs(val), maxBar);
    const pct = (absVal / maxBar) * 50;
    const color = dim.key === 'menace' || dim.key === 'cunning'
      ? (val > 10 ? '#f44' : val < -5 ? '#4f4' : '#888')
      : (val > 10 ? '#4f4' : val < -5 ? '#f44' : '#888');

    html += `<div style="display:flex;align-items:center;gap:8px;padding:2px 0;font-size:12px;" title="${dim.desc}">`;
    html += `<span style="width:90px;">${dim.icon} ${dim.label}</span>`;
    html += `<div style="flex:1;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;position:relative;">`;
    // Center bar showing positive/negative
    html += `<div style="position:absolute;left:50%;top:0;width:1px;height:100%;background:rgba(255,255,255,0.2);"></div>`;
    if (val >= 0) {
      html += `<div style="position:absolute;left:50%;top:0;width:${pct}%;height:100%;background:${color};border-radius:0 3px 3px 0;"></div>`;
    } else {
      html += `<div style="position:absolute;right:50%;top:0;width:${pct}%;height:100%;background:${color};border-radius:3px 0 0 3px;"></div>`;
    }
    html += '</div>';
    html += `<span style="width:30px;text-align:right;color:${color};">${val > 0 ? '+' : ''}${val}</span>`;
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderStatsCard(fid, stats) {
  const detail = getIntelLevel(fid);
  let html = `<div style="${STYLES.card}">`;
  html += `<div style="${STYLES.cardHeader}"><strong>\uD83D\uDCCA Intelligence Report</strong> <span style="font-size:10px;color:#888;">Level: ${detail}</span></div>`;

  if (detail === 'minimal') {
    html += '<div style="color:#666;font-style:italic;">Your intelligence network has limited reach into this faction. Improve relations, establish embassies, or use spies to learn more.</div>';
  } else if (detail === 'basic') {
    const mil = stats.military || 0;
    const ourMil = game.military || 0;
    const comparison = mil > ourMil * 1.3 ? 'Stronger than us' : mil < ourMil * 0.7 ? 'Weaker than us' : 'Roughly equal';
    html += `<div style="${STYLES.stat}">\u2694 Military: ${comparison}</div>`;
  } else if (detail === 'good') {
    html += `<div style="${STYLES.stat}">\u2694 Military: ${stats.military || '?'}</div>`;
    html += `<div style="${STYLES.stat}">\uD83D\uDCB0 Gold: ${stats.gold || '?'}</div>`;
    html += `<div style="${STYLES.stat}">\uD83C\uDFDB Cities: ${stats.cities || '?'}</div>`;
  } else if (detail === 'full') {
    html += `<div style="${STYLES.stat}">\u2694 Military: ${stats.military || 0}</div>`;
    html += `<div style="${STYLES.stat}">\uD83D\uDCB0 Gold: ${stats.gold || 0}</div>`;
    html += `<div style="${STYLES.stat}">\uD83D\uDC65 Population: ${stats.population ? (stats.population / 1000).toFixed(1) + 'k' : '0'}</div>`;
    html += `<div style="${STYLES.stat}">\uD83D\uDD2C Technologies: ${stats.techs || 0}</div>`;
    html += `<div style="${STYLES.stat}">\uD83C\uDFDB Cities: ${stats.cities || 0}</div>`;
    html += `<div style="${STYLES.stat}">\uD83C\uDF0D Territory: ${stats.territory || 0}</div>`;
    html += `<div style="${STYLES.stat}">\u2B50 Score: ${stats.score || 0}</div>`;
  }
  html += '</div>';
  return html;
}

function renderFactionRelationsCard(fid) {
  const otherFactions = Object.keys(FACTIONS).filter(f => f !== fid);
  const relations = [];
  for (const other of otherFactions) {
    const rel = game.aiRelations?.[fid]?.[other];
    if (rel === undefined) continue;
    relations.push({ fid: other, rel });
  }
  if (relations.length === 0) return '';

  let html = `<div style="${STYLES.card}">`;
  html += `<div style="${STYLES.cardHeader}"><strong>\uD83D\uDD17 Their Relationships</strong></div>`;
  relations.sort((a, b) => b.rel - a.rel);
  for (const r of relations) {
    const other = FACTIONS[r.fid];
    if (!other) continue;
    const label = getRelationLabel(r.rel);
    // Check for active war
    const atWar = (game.aiWars || []).some(w =>
      (w.attacker === fid && w.defender === r.fid) || (w.attacker === r.fid && w.defender === fid)
    );
    // Check for alliance
    const allied = (game.aiAlliances || []).some(a =>
      (a.factionA === fid && a.factionB === r.fid) || (a.factionA === r.fid && a.factionB === fid)
    );
    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 0;font-size:12px;">`;
    html += `<span style="color:${other.color}">${other.icon || ''} ${other.name}</span>`;
    html += '<span>';
    if (atWar) html += '<span style="color:#f44;font-weight:bold;">\u2694\uFE0F AT WAR</span> ';
    else if (allied) html += '<span style="color:#4f4;font-weight:bold;">\uD83E\uDD1D ALLIED</span> ';
    else html += `<span class="${label.cls}">${label.text}</span> `;
    html += `<span style="color:#888;">(${r.rel > 0 ? '+' : ''}${r.rel})</span>`;
    html += '</span></div>';
  }
  html += '</div>';
  return html;
}

function renderDiplomaticHistory(fid) {
  const ledger = game.diplomaticLedger?.[fid] || [];
  if (ledger.length === 0) return '';

  let html = `<div style="${STYLES.card}">`;
  html += `<div style="${STYLES.cardHeader}"><strong>\uD83D\uDCDC Diplomatic History</strong></div>`;
  // Show most recent first, limit to 10
  const recent = [...ledger].reverse().slice(0, 10);
  for (const entry of recent) {
    const turnLabel = entry.turn !== undefined ? `Turn ${entry.turn}` : '';
    const typeLabel = formatEventType(entry.type || entry.event);
    html += `<div style="padding:2px 0;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.03);">`;
    html += `<span style="color:#888;width:50px;display:inline-block;">${turnLabel}</span> `;
    html += `<span>${typeLabel}</span>`;
    if (entry.detail || entry.context) html += ` <span style="color:#888;">— ${entry.detail || entry.context}</span>`;
    html += '</div>';
  }
  if (ledger.length > 10) {
    html += `<div style="color:#888;font-size:10px;text-align:center;margin-top:4px;">... and ${ledger.length - 10} earlier events</div>`;
  }
  html += '</div>';
  return html;
}

// ============================================
// RELATIONS MAP TAB — AI-to-AI web
// ============================================

function renderRelationsMap() {
  let html = '';
  const factionIds = Object.keys(FACTIONS);
  const wars = game.aiWars || [];
  const alliances = game.aiAlliances || [];
  const trades = game.aiTradeDeals || [];
  const denouncements = game.aiDenouncements || [];

  // Summary
  html += `<div style="${STYLES.card}">`;
  html += `<div style="${STYLES.cardHeader}"><strong>\uD83D\uDD17 World Diplomatic Web</strong></div>`;
  html += `<div style="${STYLES.stat}">\u2694 Wars: ${wars.length}</div>`;
  html += `<div style="${STYLES.stat}">\uD83E\uDD1D Alliances: ${alliances.length}</div>`;
  html += `<div style="${STYLES.stat}">\uD83D\uDCB0 Trade Deals: ${trades.length}</div>`;
  html += `<div style="${STYLES.stat}">\uD83D\uDCA2 Denouncements: ${denouncements.length}</div>`;
  html += '</div>';

  // Active treaties & conflicts
  if (wars.length > 0) {
    html += `<div style="${STYLES.card}">`;
    html += '<div style="font-weight:bold;color:#f44;margin-bottom:4px;">\u2694\uFE0F Active Wars</div>';
    for (const w of wars) {
      const a = FACTIONS[w.attacker]; const d = FACTIONS[w.defender];
      html += `<div style="font-size:12px;padding:2px 0;">`;
      html += `<span style="color:${a?.color||'#fff'}">${a?.name||w.attacker}</span> vs `;
      html += `<span style="color:${d?.color||'#fff'}">${d?.name||w.defender}</span>`;
      html += ` <span style="color:#888;font-size:10px;">(Turn ${w.startTurn}, ${w.turnsActive||0} turns)</span>`;
      html += '</div>';
    }
    html += '</div>';
  }

  if (alliances.length > 0) {
    html += `<div style="${STYLES.card}">`;
    html += '<div style="font-weight:bold;color:#4f4;margin-bottom:4px;">\uD83E\uDD1D Active Alliances</div>';
    for (const a of alliances) {
      const fA = FACTIONS[a.factionA]; const fB = FACTIONS[a.factionB];
      html += `<div style="font-size:12px;padding:2px 0;">`;
      html += `<span style="color:${fA?.color||'#fff'}">${fA?.name||a.factionA}</span> \u2194 `;
      html += `<span style="color:${fB?.color||'#fff'}">${fB?.name||a.factionB}</span>`;
      html += ` <span style="color:#888;font-size:10px;">(since Turn ${a.turn||'?'})</span>`;
      html += '</div>';
    }
    html += '</div>';
  }

  if (trades.length > 0) {
    html += `<div style="${STYLES.card}">`;
    html += '<div style="font-weight:bold;color:#ffd700;margin-bottom:4px;">\uD83D\uDCB0 Trade Deals</div>';
    for (const t of trades) {
      const fA = FACTIONS[t.factionA]; const fB = FACTIONS[t.factionB];
      html += `<div style="font-size:12px;padding:2px 0;">`;
      html += `<span style="color:${fA?.color||'#fff'}">${fA?.name||t.factionA}</span> \u2194 `;
      html += `<span style="color:${fB?.color||'#fff'}">${fB?.name||t.factionB}</span>`;
      html += '</div>';
    }
    html += '</div>';
  }

  // Relationship matrix
  html += `<div style="${STYLES.card}">`;
  html += '<div style="font-weight:bold;margin-bottom:6px;">Relationship Scores</div>';
  html += '<div style="overflow-x:auto;">';
  html += '<table style="width:100%;border-collapse:collapse;font-size:10px;">';
  html += '<tr><th style="padding:2px 4px;"></th>';
  for (const fid of factionIds) {
    const f = FACTIONS[fid];
    html += `<th style="padding:2px 4px;color:${f?.color||'#fff'};writing-mode:vertical-rl;max-width:20px;" title="${f?.name}">${f?.icon || fid.substr(0,3)}</th>`;
  }
  html += '</tr>';
  for (const a of factionIds) {
    const fA = FACTIONS[a];
    html += `<tr><td style="padding:2px 4px;color:${fA?.color||'#fff'}">${fA?.icon || a.substr(0,3)}</td>`;
    for (const b of factionIds) {
      if (a === b) { html += '<td style="padding:2px 4px;text-align:center;color:#333;">\u2014</td>'; continue; }
      const rel = game.aiRelations?.[a]?.[b] || 0;
      const color = rel > 20 ? '#4f4' : rel < -20 ? '#f44' : '#888';
      html += `<td style="padding:2px 4px;text-align:center;color:${color};">${rel}</td>`;
    }
    html += '</tr>';
  }
  html += '</table></div>';
  html += '</div>';

  return html;
}

// ============================================
// RUMOURS TAB
// ============================================

function renderRumoursTab() {
  let html = '';
  const rumours = game.rumourQueue || [];
  const revealed = rumours.filter(r => r.revealTurn <= game.turn);
  const pending = rumours.filter(r => r.revealTurn > game.turn);

  // Recently revealed
  if (revealed.length > 0) {
    html += `<div style="${STYLES.card}">`;
    html += '<div style="font-weight:bold;color:#ffd700;margin-bottom:4px;">\uD83D\uDCAC Confirmed Reports</div>';
    const recent = [...revealed].reverse().slice(0, 10);
    for (const r of recent) {
      html += `<div style="padding:3px 0;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.03);">`;
      html += `<span style="color:#888;">Turn ${r.revealTurn}:</span> ${r.text || r.summary || 'Unknown event'}`;
      html += '</div>';
    }
    html += '</div>';
  }

  // Pending whispers
  if (pending.length > 0) {
    html += `<div style="${STYLES.card}">`;
    html += '<div style="font-weight:bold;color:#888;margin-bottom:4px;">\uD83E\uDD14 Unconfirmed Whispers</div>';
    html += `<div style="color:#666;font-size:11px;margin-bottom:4px;">Your envoys are investigating ${pending.length} rumour${pending.length > 1 ? 's' : ''}...</div>`;
    for (const r of pending) {
      html += `<div style="padding:3px 0;font-size:12px;color:#888;font-style:italic;">`;
      html += r.vagueSummary || 'Something is stirring in distant lands...';
      html += '</div>';
    }
    html += '</div>';
  }

  if (revealed.length === 0 && pending.length === 0) {
    html += `<div style="${STYLES.card}color:#666;font-style:italic;">`;
    html += 'No rumours have reached your court. Your envoys report all is quiet... for now.';
    html += '</div>';
  }

  return html;
}

// ============================================
// LEDGER TAB — Full diplomatic event log
// ============================================

function renderLedgerTab() {
  let html = '';
  // Aggregate all ledger entries across factions
  const allEntries = [];
  const ledger = game.diplomaticLedger || {};
  for (const [fid, entries] of Object.entries(ledger)) {
    for (const entry of entries) {
      allEntries.push({ ...entry, fid });
    }
  }
  allEntries.sort((a, b) => (b.turn || 0) - (a.turn || 0));

  if (allEntries.length === 0) {
    html += `<div style="${STYLES.card}color:#666;font-style:italic;">`;
    html += 'The diplomatic ledger is empty. Your scribes await events to record.';
    html += '</div>';
    return html;
  }

  html += `<div style="${STYLES.card}">`;
  html += `<div style="${STYLES.cardHeader}"><strong>\uD83D\uDCDC Complete Diplomatic Record</strong> <span style="color:#888;font-size:10px;">${allEntries.length} events</span></div>`;
  const shown = allEntries.slice(0, 30);
  for (const entry of shown) {
    const faction = FACTIONS[entry.fid];
    const turnLabel = entry.turn !== undefined ? `Turn ${entry.turn}` : '';
    const typeLabel = formatEventType(entry.type || entry.event);
    html += `<div style="padding:3px 0;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.03);">`;
    html += `<span style="color:#888;display:inline-block;width:50px;">${turnLabel}</span>`;
    html += `<span style="color:${faction?.color || '#aaa'};">${faction?.name || entry.fid}</span>: `;
    html += `${typeLabel}`;
    if (entry.detail || entry.context) html += ` <span style="color:#888;">— ${entry.detail || entry.context}</span>`;
    html += '</div>';
  }
  if (allEntries.length > 30) {
    html += `<div style="color:#888;font-size:10px;text-align:center;margin-top:6px;">Showing 30 of ${allEntries.length} events</div>`;
  }
  html += '</div>';
  return html;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function getIntelLevel(fid) {
  const rel = game.relationships?.[fid] || 0;
  if (rel >= 50 || game.activeAlliances?.[fid]) return 'full';
  if (rel >= 20) return 'good';
  if (rel >= 0) return 'basic';
  return 'minimal';
}

function assessThreat(fid) {
  const stats = game.factionStats?.[fid] || {};
  const ourMil = game.military || 1;
  const theirMil = stats.military || 0;
  const rel = game.relationships?.[fid] || 0;
  const atWar = (game.aiWars || []).some(w =>
    (w.attacker === fid && w.defender === 'player') || (w.defender === fid && w.attacker === 'player')
  );

  let score = 0;
  // Military ratio
  if (theirMil > ourMil * 1.5) score += 3;
  else if (theirMil > ourMil) score += 1;
  // Relationship
  if (rel < -30) score += 3;
  else if (rel < -10) score += 1;
  else if (rel > 30) score -= 2;
  // Active war with us
  if (atWar) score += 5;

  if (score >= 4) return { level: 'high', score };
  if (score >= 2) return { level: 'medium', score };
  return { level: 'low', score };
}

function getTopThreat() {
  const metFactions = Object.keys(game.metFactions || {});
  let top = null;
  for (const fid of metFactions) {
    const threat = assessThreat(fid);
    if (!top || threat.score > top.score) {
      top = { fid, ...threat };
    }
  }
  return top && top.score > 0 ? top : null;
}

function formatEventType(type) {
  if (!type) return 'Unknown event';
  const map = {
    alliance_formed: '\uD83E\uDD1D Alliance formed',
    alliance_broken: '\uD83D\uDCA5 Alliance broken',
    alliance_honoured: '\uD83C\uDFC5 Alliance honoured',
    war_declared: '\u2694\uFE0F War declared',
    peace_signed: '\u2615 Peace signed',
    trade_deal_accepted: '\uD83D\uDCB0 Trade deal',
    trade_deal_honoured: '\uD83D\uDCB0 Trade honoured',
    gift_sent: '\uD83C\uDF81 Gift sent',
    tribute_paid: '\uD83D\uDCB0 Tribute paid',
    tribute_demanded: '\uD83D\uDCA2 Tribute demanded',
    tech_shared: '\uD83D\uDD2C Technology shared',
    surprise_attack: '\u26A0\uFE0F Surprise attack!',
    defense_pact_formed: '\uD83D\uDEE1\uFE0F Defense pact',
    nap_formed: '\u270C\uFE0F Non-aggression pact',
    nap_broken: '\uD83D\uDCA5 NAP broken',
    marriage_formed: '\uD83D\uDC8D Royal marriage',
    ceasefire_accepted: '\u2615 Ceasefire',
    embargo_imposed: '\uD83D\uDEAB Embargo',
    open_borders_accepted: '\uD83D\uDEAA Open borders',
    unit_gifted: '\u2694\uFE0F Units gifted',
  };
  return map[type] || type.replace(/_/g, ' ');
}
