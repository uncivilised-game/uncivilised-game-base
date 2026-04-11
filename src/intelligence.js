// ============================================
// INTELLIGENCE — Integrated into the Diplomacy Panel
// ============================================
// Adds a tab bar to the diplomacy panel so it becomes a combined
// Diplomacy + Intelligence hub. The existing "Leaders" content from
// the diplomacy plugin renders into one tab; the intel tabs
// (Overview, Relations, Rumours, Ledger) render alongside.

import { FACTIONS, FACTION_TRAITS } from './constants.js';
import { game } from './state.js';
import { getAIRelation, getAIWars, getAIAlliances, getAITradeDeals } from './ai-diplomacy.js';
import { getRelationLabel, openChat, renderDiplomacyPanel as pluginRenderDiplomacy } from './diplomacy-api.js';
import { getEffectiveIntelLevel, getEmbassyInfo, establishEmbassy, EMBASSY_UNLOCK_TECH, EMBASSY_COST, GOSSIP_THRESHOLDS, ensureEmbassyState } from './embassy.js';
import { getComparisonData } from './map.js';

// ── Tab state ──
let currentDiploTab = 'leaders'; // 'leaders' | 'overview' | 'relations' | 'rumours' | 'ledger'

// ── Styles ──
const S = {
  tabs: 'display:flex;gap:0;border-bottom:1px solid rgba(201,168,76,0.25);background:rgba(0,0,0,0.25);',
  tab: 'padding:7px 14px;cursor:pointer;font-size:11px;border-bottom:2px solid transparent;transition:all 0.15s;',
  tabOn: 'color:#ffd700;border-bottom-color:#ffd700;background:rgba(201,168,76,0.08);',
  tabOff: 'color:#888;border-bottom-color:transparent;',
  body: 'padding:10px 14px;max-height:400px;overflow-y:auto;',
  card: 'background:rgba(30,30,40,0.8);border:1px solid rgba(201,168,76,0.2);border-radius:6px;padding:10px 12px;margin-bottom:8px;',
  cardHd: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;',
  badge: 'display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:bold;',
  stat: 'display:inline-block;margin-right:12px;font-size:11px;color:#bbb;',
  hr: 'border:none;border-top:1px solid rgba(201,168,76,0.15);margin:8px 0;',
  threat: { low: 'background:rgba(40,120,40,0.3);color:#8f8;', medium: 'background:rgba(180,150,30,0.3);color:#ff0;', high: 'background:rgba(180,40,40,0.3);color:#f88;' },
};

// ============================================
// PUBLIC: Wrap the diplomacy panel with tabs
// ============================================

/**
 * Called by togglePanel('diplomacy-panel') instead of the raw
 * pluginRenderDiplomacy. Renders a tab bar above the diplomacy-characters
 * container and fills it based on the active tab.
 */
export function renderDiplomacyWithIntel() {
  const container = document.getElementById('diplomacy-characters');
  if (!container) return;

  let html = '';

  // Tab bar
  const tabs = [
    { id: 'leaders',   label: '\uD83D\uDC51 Leaders' },
    { id: 'overview',  label: '\uD83C\uDF0D Overview' },
    { id: 'relations', label: '\uD83D\uDD17 Relations' },
    { id: 'rumours',   label: '\uD83D\uDCAC Rumours' },
    { id: 'ledger',    label: '\uD83D\uDCDC Ledger' },
  ];
  html += `<div style="${S.tabs}">`;
  for (const t of tabs) {
    const on = currentDiploTab === t.id;
    html += `<div class="intel-tab" data-tab="${t.id}" style="${S.tab}${on ? S.tabOn : S.tabOff}">${t.label}</div>`;
  }
  html += '</div>';

  // Tab content
  html += `<div style="${S.body}">`;
  switch (currentDiploTab) {
    case 'leaders':   html += '<div id="diplo-leaders-slot"></div>'; break;
    case 'overview':  html += renderOverview(); break;
    case 'relations': html += renderRelationsMap(); break;
    case 'rumours':   html += renderRumoursTab(); break;
    case 'ledger':    html += renderLedgerTab(); break;
    default:          html += '<div id="diplo-leaders-slot"></div>';
  }
  html += '</div>';

  container.innerHTML = html;

  // If on Leaders tab, let the diplomacy plugin render into the slot
  if (currentDiploTab === 'leaders') {
    const slot = document.getElementById('diplo-leaders-slot');
    if (slot) {
      // Temporarily swap IDs so the plugin renders into the slot
      slot.id = 'diplomacy-characters';
      container.id = '_diplo-wrapper-tmp';
      try {
        pluginRenderDiplomacy();
      } finally {
        slot.id = 'diplo-leaders-slot';
        container.id = 'diplomacy-characters';
      }
    }
  }

  // Bind tab clicks
  container.querySelectorAll('.intel-tab').forEach(el => {
    el.onclick = () => {
      currentDiploTab = el.dataset.tab;
      renderDiplomacyWithIntel();
    };
  });

  // Bind faction cards (in overview/relations)
  container.querySelectorAll('.intel-faction-link').forEach(el => {
    el.onclick = () => openChat(el.dataset.fid);
  });

  // Bind embassy buttons
  container.querySelectorAll('.embassy-btn').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const fid = el.dataset.fid;
      if (establishEmbassy(fid)) {
        renderDiplomacyWithIntel(); // re-render to show updated state
      }
    };
  });
}

/**
 * Switch to a specific diplomacy tab programmatically.
 */
export function switchDiploTab(tab) {
  currentDiploTab = tab || 'leaders';
  renderDiplomacyWithIntel();
}

/**
 * Get a compact intel summary string for turn summaries.
 */
export function getIntelSummary() {
  const items = [];
  const wars = game.aiWars || [];
  if (wars.length > 0) items.push(`\u2694\uFE0F ${wars.length} war${wars.length > 1 ? 's' : ''}`);
  const alliances = game.aiAlliances || [];
  if (alliances.length > 0) items.push(`\uD83E\uDD1D ${alliances.length} alliance${alliances.length > 1 ? 's' : ''}`);
  const rumours = (game.rumourQueue || []).filter(r => r.revealTurn >= game.turn);
  if (rumours.length > 0) items.push(`\uD83D\uDCAC ${rumours.length} unconfirmed rumour${rumours.length > 1 ? 's' : ''}`);
  const topThreat = getTopThreat();
  if (topThreat) items.push(`\u26A0\uFE0F Threat: ${FACTIONS[topThreat.fid]?.name || topThreat.fid}`);
  return items.join(' \u2022 ');
}

// ============================================
// OVERVIEW TAB
// ============================================

function renderOverview() {
  ensureEmbassyState();
  let html = '';
  const metCount = Object.keys(game.metFactions || {}).length;
  const totalFactions = Object.keys(FACTIONS).length;
  const wars = game.aiWars || [];
  const alliances = game.aiAlliances || [];
  const trades = game.aiTradeDeals || [];
  const embassyCount = Object.keys(game.embassies || {}).length;
  const gp = game.gossipPoints || 0;

  // World status + gossip network
  html += `<div style="${S.card}">`;
  html += `<div style="${S.cardHd}"><strong>\uD83C\uDF0D World Status — Turn ${game.turn}</strong></div>`;
  html += `<div style="${S.stat}">Discovered: ${metCount}/${totalFactions}</div>`;
  html += `<div style="${S.stat}">Wars: ${wars.length}</div>`;
  html += `<div style="${S.stat}">Alliances: ${alliances.length}</div>`;
  html += `<div style="${S.stat}">Trades: ${trades.length}</div>`;
  html += `<div style="${S.stat}">\uD83C\uDFDB\uFE0F Embassies: ${embassyCount}</div>`;
  html += '</div>';

  // Gossip network card
  html += `<div style="${S.card}">`;
  html += `<div style="${S.cardHd}"><strong>\uD83D\uDCAC Gossip Network</strong></div>`;
  const nextThreshold = gp < GOSSIP_THRESHOLDS.good ? GOSSIP_THRESHOLDS.good
    : gp < GOSSIP_THRESHOLDS.full ? GOSSIP_THRESHOLDS.full
    : gp < GOSSIP_THRESHOLDS.master ? GOSSIP_THRESHOLDS.master : null;
  const depthLabel = gp >= GOSSIP_THRESHOLDS.master ? 'Master' : gp >= GOSSIP_THRESHOLDS.full ? 'Deep' : gp >= GOSSIP_THRESHOLDS.good ? 'Growing' : 'Shallow';
  const depthColor = gp >= GOSSIP_THRESHOLDS.master ? '#ffd700' : gp >= GOSSIP_THRESHOLDS.full ? '#4f4' : gp >= GOSSIP_THRESHOLDS.good ? '#ff0' : '#888';
  html += `<div style="display:flex;align-items:center;justify-content:space-between;">`;
  html += `<span style="font-size:12px;">Gossip Points: <strong style="color:${depthColor};">${gp}</strong></span>`;
  html += `<span style="${S.badge}background:rgba(${depthColor === '#ffd700' ? '255,215,0' : depthColor === '#4f4' ? '68,255,68' : depthColor === '#ff0' ? '255,255,0' : '136,136,136'},0.2);color:${depthColor};">${depthLabel} Intel</span>`;
  html += '</div>';
  if (nextThreshold) {
    const pct = Math.min(100, Math.round((gp / nextThreshold) * 100));
    html += `<div style="margin-top:4px;"><div style="width:100%;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;">`;
    html += `<div style="width:${pct}%;height:100%;background:${depthColor};border-radius:2px;transition:width 0.3s;"></div></div>`;
    html += `<div style="font-size:10px;color:#666;margin-top:2px;">Next level at ${nextThreshold} points — rumours and embassies increase gossip</div></div>`;
  } else {
    html += `<div style="font-size:10px;color:#888;margin-top:2px;">Maximum intelligence depth reached — full intel on all factions</div>`;
  }
  html += '</div>';

  // Your standing with each faction (now with embassy indicators)
  html += `<div style="${S.card}">`;
  html += `<div style="${S.cardHd}"><strong>\uD83D\uDC51 Your Standing</strong></div>`;
  const metFactions = Object.keys(game.metFactions || {});
  if (metFactions.length === 0) {
    html += '<div style="color:#888;font-style:italic;">No factions discovered yet. Send scouts!</div>';
  } else {
    for (const fid of metFactions) {
      const faction = FACTIONS[fid];
      if (!faction) continue;
      const isEliminated = game.eliminatedFactions?.[fid];
      if (isEliminated) {
        // Show dead faction with skull and elimination turn
        html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);opacity:0.5;">`;
        html += `<span style="color:#666;text-decoration:line-through;">${faction.icon||'\uD83C\uDFF0'} ${faction.name}</span>`;
        html += `<span style="${S.badge}background:rgba(180,40,40,0.3);color:#d44;">\uD83D\uDC80 Eliminated (Turn ${isEliminated.turn})</span>`;
        html += '</div>';
        continue;
      }
      const rel = game.relationships?.[fid] || 0;
      const label = getRelationLabel(rel);
      const threat = assessThreat(fid);
      const emb = getEmbassyInfo(fid);
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);">`;
      html += `<span class="intel-faction-link" data-fid="${fid}" style="cursor:pointer;color:${faction.color}">${faction.icon||'\uD83C\uDFF0'} ${faction.name}</span>`;
      html += '<span style="display:flex;align-items:center;gap:6px;">';
      // Embassy indicator/button
      if (emb.hasEmbassy) {
        html += `<span style="${S.badge}background:rgba(201,168,76,0.25);color:#ffd700;" title="Embassy active — full intel">\uD83C\uDFDB\uFE0F</span>`;
      } else if (emb.canEstablish) {
        html += `<span class="embassy-btn" data-fid="${fid}" style="${S.badge}background:rgba(201,168,76,0.15);color:#c9a84c;cursor:pointer;border:1px dashed rgba(201,168,76,0.4);" title="Establish embassy (${EMBASSY_COST}g)">\uD83C\uDFDB\uFE0F ${EMBASSY_COST}g</span>`;
      } else if (!emb.hasTech) {
        html += `<span style="${S.badge}background:rgba(100,100,100,0.2);color:#555;cursor:help;" title="Requires ${EMBASSY_UNLOCK_TECH.replace(/_/g,' ')} to establish embassy">\uD83C\uDFDB\uFE0F \uD83D\uDD12</span>`;
      }
      html += `<span class="${label.cls}" style="font-size:11px;">${label.text}</span>`;
      html += `<span style="${S.badge}${S.threat[threat.level]}">${threat.level.toUpperCase()}</span>`;
      html += '</span></div>';
    }
  }
  html += '</div>';

  // Active conflicts
  if (wars.length > 0) {
    html += `<div style="${S.card}">`;
    html += `<div style="${S.cardHd}"><strong>\u2694\uFE0F Active Conflicts</strong></div>`;
    for (const w of wars) {
      const a = FACTIONS[w.attacker]; const d = FACTIONS[w.defender];
      html += `<div style="padding:2px 0;font-size:12px;">`;
      html += `<span style="color:${a?.color||'#fff'}">${a?.name||w.attacker}</span> vs `;
      html += `<span style="color:${d?.color||'#fff'}">${d?.name||w.defender}</span>`;
      html += ` <span style="color:#888;font-size:10px;">(${w.turnsActive||0} turns)</span>`;
      html += '</div>';
    }
    html += '</div>';
  }

  // Power rankings
  html += renderPowerSnapshot();

  // Reputation breakdown for met factions
  const metWithRep = metFactions.filter(fid => game.reputation?.[fid]);
  if (metWithRep.length > 0) {
    html += `<div style="${S.card}">`;
    html += `<div style="${S.cardHd}"><strong>\uD83D\uDD75\uFE0F How They See You</strong></div>`;
    for (const fid of metWithRep) {
      const faction = FACTIONS[fid];
      const rep = game.reputation[fid];
      if (!faction || !rep) continue;
      const dims = ['honour','generosity','menace','reliability','cunning'];
      const icons = {honour:'\uD83C\uDFC5',generosity:'\uD83C\uDF81',menace:'\uD83D\uDDE1\uFE0F',reliability:'\uD83E\uDD1D',cunning:'\uD83E\uDD8A'};
      html += `<div style="margin-bottom:6px;">`;
      html += `<div style="color:${faction.color};font-size:12px;font-weight:bold;margin-bottom:2px;">${faction.icon||''} ${faction.name}</div>`;
      html += `<div style="display:flex;gap:8px;flex-wrap:wrap;">`;
      for (const d of dims) {
        const v = Math.round(rep[d] || 0);
        const col = (d==='menace'||d==='cunning') ? (v>10?'#f66':v<-5?'#6f6':'#888') : (v>10?'#6f6':v<-5?'#f66':'#888');
        html += `<span style="font-size:10px;color:${col};" title="${d}">${icons[d]} ${v > 0?'+':''}${v}</span>`;
      }
      html += '</div></div>';
    }
    html += '</div>';
  }

  return html;
}

function renderPowerSnapshot() {
  const data = typeof getComparisonData === 'function' ? getComparisonData() : [];
  if (data.length <= 1) return '';
  data.sort((a, b) => (b.stats?.score || 0) - (a.stats?.score || 0));
  const maxScore = data[0]?.stats?.score || 1;

  let html = `<div style="${S.card}">`;
  html += `<div style="${S.cardHd}"><strong>\uD83D\uDCCA Power Rankings</strong></div>`;
  for (let i = 0; i < data.length; i++) {
    const e = data[i];
    const pct = Math.round(((e.stats?.score || 0) / maxScore) * 100);
    const color = e.isPlayer ? '#ffd700' : (e.color || '#888');
    html += `<div style="display:flex;align-items:center;gap:8px;padding:2px 0;font-size:12px;">`;
    html += `<span style="width:14px;text-align:right;color:#888;">${i+1}.</span>`;
    html += `<span style="flex:1;color:${color}">${e.isPlayer?'\uD83D\uDC51 ':''}${e.name}</span>`;
    html += `<div style="width:80px;height:5px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">`;
    html += `<div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div></div>`;
    html += `<span style="width:36px;text-align:right;color:#aaa;">${e.stats?.score||0}</span>`;
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// ============================================
// RELATIONS TAB — AI-to-AI web
// ============================================

function renderRelationsMap() {
  let html = '';
  const factionIds = Object.keys(FACTIONS);
  const wars = game.aiWars || [];
  const alliances = game.aiAlliances || [];
  const trades = game.aiTradeDeals || [];
  const denouncements = game.aiDenouncements || [];

  html += `<div style="${S.card}">`;
  html += `<div style="${S.cardHd}"><strong>\uD83D\uDD17 World Diplomatic Web</strong></div>`;
  html += `<div style="${S.stat}">\u2694 Wars: ${wars.length}</div>`;
  html += `<div style="${S.stat}">\uD83E\uDD1D Alliances: ${alliances.length}</div>`;
  html += `<div style="${S.stat}">\uD83D\uDCB0 Trades: ${trades.length}</div>`;
  html += `<div style="${S.stat}">\uD83D\uDCA2 Denouncements: ${denouncements.length}</div>`;
  html += '</div>';

  if (wars.length > 0) {
    html += `<div style="${S.card}">`;
    html += '<div style="font-weight:bold;color:#f44;margin-bottom:4px;">\u2694\uFE0F Active Wars</div>';
    for (const w of wars) {
      const a = FACTIONS[w.attacker]; const d = FACTIONS[w.defender];
      html += `<div style="font-size:12px;padding:2px 0;"><span style="color:${a?.color||'#fff'}">${a?.name||w.attacker}</span> vs <span style="color:${d?.color||'#fff'}">${d?.name||w.defender}</span> <span style="color:#888;font-size:10px;">(Turn ${w.startTurn}, ${w.turnsActive||0}t)</span></div>`;
    }
    html += '</div>';
  }

  if (alliances.length > 0) {
    html += `<div style="${S.card}">`;
    html += '<div style="font-weight:bold;color:#4f4;margin-bottom:4px;">\uD83E\uDD1D Alliances</div>';
    for (const a of alliances) {
      const fA = FACTIONS[a.factionA]; const fB = FACTIONS[a.factionB];
      html += `<div style="font-size:12px;padding:2px 0;"><span style="color:${fA?.color||'#fff'}">${fA?.name||a.factionA}</span> \u2194 <span style="color:${fB?.color||'#fff'}">${fB?.name||a.factionB}</span> <span style="color:#888;font-size:10px;">(Turn ${a.turn||'?'})</span></div>`;
    }
    html += '</div>';
  }

  if (trades.length > 0) {
    html += `<div style="${S.card}">`;
    html += '<div style="font-weight:bold;color:#ffd700;margin-bottom:4px;">\uD83D\uDCB0 Trade Deals</div>';
    for (const t of trades) {
      const fA = FACTIONS[t.factionA]; const fB = FACTIONS[t.factionB];
      html += `<div style="font-size:12px;padding:2px 0;"><span style="color:${fA?.color||'#fff'}">${fA?.name||t.factionA}</span> \u2194 <span style="color:${fB?.color||'#fff'}">${fB?.name||t.factionB}</span></div>`;
    }
    html += '</div>';
  }

  // Relationship matrix
  html += `<div style="${S.card}">`;
  html += '<div style="font-weight:bold;margin-bottom:6px;">Relationship Scores</div>';
  html += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:10px;">';
  html += '<tr><th></th>';
  for (const fid of factionIds) { const f = FACTIONS[fid]; html += `<th style="padding:2px 4px;color:${f?.color||'#fff'};writing-mode:vertical-rl;max-width:20px;" title="${f?.name}">${f?.icon||fid.substr(0,3)}</th>`; }
  html += '</tr>';
  for (const a of factionIds) {
    const fA = FACTIONS[a];
    html += `<tr><td style="padding:2px 4px;color:${fA?.color||'#fff'}">${fA?.icon||a.substr(0,3)}</td>`;
    for (const b of factionIds) {
      if (a === b) { html += '<td style="padding:2px 4px;text-align:center;color:#333;">\u2014</td>'; continue; }
      const rel = game.aiRelations?.[a]?.[b] || 0;
      const color = rel > 20 ? '#4f4' : rel < -20 ? '#f44' : '#888';
      html += `<td style="padding:2px 4px;text-align:center;color:${color};">${rel}</td>`;
    }
    html += '</tr>';
  }
  html += '</table></div></div>';

  return html;
}

// ============================================
// RUMOURS TAB
// ============================================

function renderRumoursTab() {
  let html = '';
  const rumours = game.rumourQueue || [];
  const revealed = rumours.filter(r => r.revealed || r.revealTurn < game.turn);
  const pending = rumours.filter(r => !r.revealed && r.revealTurn >= game.turn);

  if (pending.length > 0) {
    html += `<div style="${S.card}">`;
    html += '<div style="font-weight:bold;color:#888;margin-bottom:4px;">\uD83E\uDD14 Unconfirmed Whispers</div>';
    html += `<div style="color:#666;font-size:11px;margin-bottom:4px;">Your envoys investigate ${pending.length} rumour${pending.length>1?'s':''}...</div>`;
    for (const r of pending) {
      html += `<div style="padding:3px 0;font-size:12px;color:#888;font-style:italic;">${r.vagueSummary||'Something stirs in distant lands...'}</div>`;
    }
    html += '</div>';
  }

  if (revealed.length > 0) {
    html += `<div style="${S.card}">`;
    html += `<div style="font-weight:bold;color:#ffd700;margin-bottom:4px;">\uD83D\uDCAC All Reports (${revealed.length})</div>`;
    for (const r of [...revealed].reverse()) {
      const icon = r.text && r.text.includes('Paid informant') ? '\uD83D\uDCB0' :
                   r.text && r.text.includes('Corroborated') ? '\uD83E\uDD1D' : '\uD83D\uDCAC';
      html += `<div style="padding:4px 0;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.03);">`;
      html += `<span style="color:#666;font-size:10px;">Turn ${r.revealTurn || r.turn || '?'}</span> `;
      html += `<span>${icon} ${r.text||r.summary||'Unknown event'}</span>`;
      html += `</div>`;
    }
    html += '</div>';
  }

  if (revealed.length === 0 && pending.length === 0) {
    html += `<div style="${S.card}color:#666;font-style:italic;">No rumours have reached your court. All is quiet... for now.</div>`;
  }

  return html;
}

// ============================================
// LEDGER TAB — Full diplomatic event log
// ============================================

function renderLedgerTab() {
  let html = '';

  // Diplomatic notifications (persistent toast history)
  const notifications = game.diploNotifications || [];
  if (notifications.length > 0) {
    html += `<div style="${S.card}">`;
    html += `<div style="${S.cardHd}"><strong>\uD83D\uDD14 Diplomatic Notifications</strong></div>`;
    for (const notif of [...notifications].reverse().slice(0, 20)) {
      const turnLabel = notif.turn !== undefined ? `Turn ${notif.turn}` : '';
      html += `<div style="padding:3px 0;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.03);">`;
      html += `<span style="color:#888;display:inline-block;width:50px;">${turnLabel}</span>`;
      html += `<strong style="color:#ffd700;">${notif.title}</strong>`;
      if (notif.message) html += ` <span style="color:#aaa;">${notif.message}</span>`;
      html += '</div>';
    }
    if (notifications.length > 20) html += `<div style="color:#888;font-size:10px;text-align:center;margin-top:4px;">Showing 20 of ${notifications.length}</div>`;
    html += '</div>';
  }

  const allEntries = [];
  const ledger = game.diplomaticLedger || {};
  for (const [fid, entries] of Object.entries(ledger)) {
    for (const entry of entries) allEntries.push({ ...entry, fid });
  }
  allEntries.sort((a, b) => (b.turn || 0) - (a.turn || 0));

  if (allEntries.length === 0 && notifications.length === 0) {
    html += `<div style="${S.card}color:#666;font-style:italic;">The diplomatic ledger is empty. Your scribes await events to record.</div>`;
    return html;
  }

  html += `<div style="${S.card}">`;
  html += `<div style="${S.cardHd}"><strong>\uD83D\uDCDC Diplomatic Record</strong> <span style="color:#888;font-size:10px;">${allEntries.length} events</span></div>`;
  for (const entry of allEntries.slice(0, 30)) {
    const faction = FACTIONS[entry.fid];
    const turnLabel = entry.turn !== undefined ? `Turn ${entry.turn}` : '';
    const typeLabel = fmtEvent(entry.type || entry.event);
    html += `<div style="padding:3px 0;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.03);">`;
    html += `<span style="color:#888;display:inline-block;width:50px;">${turnLabel}</span>`;
    html += `<span style="color:${faction?.color||'#aaa'};">${faction?.name||entry.fid}</span>: ${typeLabel}`;
    if (entry.detail||entry.context) html += ` <span style="color:#888;">— ${entry.detail||entry.context}</span>`;
    html += '</div>';
  }
  if (allEntries.length > 30) html += `<div style="color:#888;font-size:10px;text-align:center;margin-top:6px;">Showing 30 of ${allEntries.length}</div>`;
  html += '</div>';
  return html;
}

// ============================================
// UTILITIES
// ============================================

function assessThreat(fid) {
  const stats = game.factionStats?.[fid] || {};
  const ourMil = game.military || 1;
  const theirMil = stats.military || 0;
  const rel = game.relationships?.[fid] || 0;
  let score = 0;
  if (theirMil > ourMil * 1.5) score += 3; else if (theirMil > ourMil) score += 1;
  if (rel < -30) score += 3; else if (rel < -10) score += 1; else if (rel > 30) score -= 2;
  if ((game.aiWars||[]).some(w => (w.attacker===fid||w.defender===fid) && (w.attacker==='player'||w.defender==='player'))) score += 5;
  if (score >= 4) return { level: 'high', score };
  if (score >= 2) return { level: 'medium', score };
  return { level: 'low', score };
}

function getTopThreat() {
  let top = null;
  for (const fid of Object.keys(game.metFactions || {})) {
    const t = assessThreat(fid);
    if (!top || t.score > top.score) top = { fid, ...t };
  }
  return top && top.score > 0 ? top : null;
}

function fmtEvent(type) {
  if (!type) return 'Unknown';
  const m = {
    alliance_formed:'\uD83E\uDD1D Alliance',alliance_broken:'\uD83D\uDCA5 Alliance broken',war_declared:'\u2694\uFE0F War',
    peace_signed:'\u2615 Peace',trade_deal_accepted:'\uD83D\uDCB0 Trade',gift_sent:'\uD83C\uDF81 Gift',
    tribute_paid:'\uD83D\uDCB0 Tribute',tech_shared:'\uD83D\uDD2C Tech shared',surprise_attack:'\u26A0\uFE0F Surprise attack',
    defense_pact_formed:'\uD83D\uDEE1\uFE0F Defense pact',nap_formed:'\u270C\uFE0F NAP',nap_broken:'\uD83D\uDCA5 NAP broken',
    marriage_formed:'\uD83D\uDC8D Marriage',ceasefire_accepted:'\u2615 Ceasefire',embargo_imposed:'\uD83D\uDEAB Embargo',
    open_borders_accepted:'\uD83D\uDEAA Open borders',unit_gifted:'\u2694\uFE0F Units gifted',
    tribute_demanded:'\uD83D\uDCA2 Tribute demanded',trade_deal_honoured:'\uD83D\uDCB0 Trade honoured',
    alliance_honoured:'\uD83C\uDFC5 Alliance honoured',
  };
  return m[type] || type.replace(/_/g, ' ');
}
