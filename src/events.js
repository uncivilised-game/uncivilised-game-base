import { BUILDINGS, TECHNOLOGIES, FACTIONS, MAP_COLS, MAP_ROWS } from './constants.js';
import { game } from './state.js';
import { hexDistance } from './hex.js';
import { initFactionStats } from './map.js';
import { showModBanner } from './diplomacy-api.js';
import { updateUI } from './leaderboard.js';

export function addEvent(text, type = '') {
  if (!game) return;
  const container = document.getElementById('event-log-messages');
  const msg = document.createElement('div');
  msg.className = `event-msg ${type}`;
  msg.textContent = `Turn ${game.turn}: ${text}`;
  container.insertBefore(msg, container.firstChild);
  while (container.children.length > 15) {
    container.removeChild(container.lastChild);
  }
}

export function countPlayerTerritory() {
  let count = 0;
  for (const city of game.cities) {
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (hexDistance(c, r, city.col, city.row) <= 2) count++;
      }
    }
  }
  return count;
}

// ============================================
// TOAST NOTIFICATION SYSTEM
// ============================================
export function showToast(title, message, duration) {
  duration = duration || 3000;
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:60px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.style.cssText = 'background:rgba(20,20,30,0.92);border:1px solid rgba(255,215,0,0.5);border-radius:8px;padding:10px 16px;color:#f0e8d0;font-size:13px;max-width:300px;box-shadow:0 4px 16px rgba(0,0,0,0.5);opacity:0;transform:translateX(40px);transition:opacity 0.3s,transform 0.3s;pointer-events:auto;';
  toast.innerHTML = '<div style="font-weight:bold;color:#ffd700;margin-bottom:2px">' + title + '</div>' + (message ? '<div style="color:#bbb;font-size:11px">' + message + '</div>' : '');
  container.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(0)'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 350);
  }, duration);
}

// ============================================
// COMPLETION NOTIFICATIONS & PROMPTS
// ============================================
export function showCompletionNotification(type, name, desc) {
  // Create or reuse notification panel
  let panel = document.getElementById('completion-notify');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'completion-notify';
    document.getElementById('game-main').appendChild(panel);
  }

  const icons = { building: '\u{1F3DB}', research: '\u{1F4DA}', unit: '\u{2694}', improvement: '\u{2692}' };
  const labels = { building: 'Building Complete', research: 'Research Complete', unit: 'Unit Recruited', improvement: 'Improvement Complete' };
  const icon = icons[type] || '\u{2705}';
  const label = labels[type] || 'Complete';

  // Build options for next action
  let optionsHtml = '';
  if (type === 'building') {
    optionsHtml = buildNextBuildOptions();
  } else if (type === 'research') {
    optionsHtml = buildNextResearchOptions();
  }

  panel.innerHTML = `
    <div class="completion-card">
      <div class="completion-header">
        <span class="completion-icon">${icon}</span>
        <div>
          <div class="completion-label">${label}</div>
          <div class="completion-name">${name}</div>
          <div class="completion-desc">${desc || ''}</div>
        </div>
      </div>
      ${optionsHtml ? `<div class="completion-options"><div class="completion-options-label">Choose next:</div>${optionsHtml}</div>` : ''}
      <button class="completion-dismiss" onclick="dismissCompletion()">Dismiss</button>
    </div>
  `;
  panel.style.display = 'flex';

  // Auto-dismiss after 15 seconds (auto-select will handle the choice)
  clearTimeout(panel._timer);
  panel._timer = setTimeout(() => dismissCompletion(), 15000);
}

export function buildNextBuildOptions() {
  const unlockedBuildings = new Set();
  for (const tech of game.techs) {
    const tdata = TECHNOLOGIES.find(t => t.id === tech);
    if (tdata && tdata.unlocks) tdata.unlocks.forEach(b => unlockedBuildings.add(b));
  }
  const buildable = BUILDINGS.filter(b => unlockedBuildings.has(b.id) && !game.buildings.includes(b.id));
  if (buildable.length === 0) return '<span class="completion-none">No buildings available</span>';
  return buildable.map(b =>
    `<button class="completion-option" onclick="selectNextBuild('${b.id}')">
      <span class="option-name">${b.name}</span>
      <span class="option-detail">${b.desc} (${b.cost} \u{2692})</span>
    </button>`
  ).join('');
}

export function buildNextResearchOptions() {
  const available = TECHNOLOGIES.filter(t => {
    if (game.techs.includes(t.id)) return false;
    if (t.requires && !t.requires.every(r => game.techs.includes(r))) return false;
    return true;
  });
  if (available.length === 0) return '<span class="completion-none">All technologies researched</span>';
  return available.map(t =>
    `<button class="completion-option" onclick="selectNextResearch('${t.id}')">
      <span class="option-name">${t.name}</span>
      <span class="option-detail">${t.desc} (${t.cost} \u{1F52C})</span>
    </button>`
  ).join('');
}

window.selectNextBuild = function(buildingId) {
  game.currentBuild = buildingId;
  game.buildProgress = 0;
  const bdata = BUILDINGS.find(b => b.id === buildingId);
  addEvent(`Started building ${bdata ? bdata.name : buildingId}`, 'gold');
  dismissCompletion();
};

window.selectNextResearch = function(techId) {
  game.currentResearch = techId;
  game.researchProgress = 0;
  const tdata = TECHNOLOGIES.find(t => t.id === techId);
  addEvent(`Started researching ${tdata ? tdata.name : techId}`, 'science');
  dismissCompletion();
};

window.dismissCompletion = function() {
  const panel = document.getElementById('completion-notify');
  if (panel) {
    panel.style.display = 'none';
    clearTimeout(panel._timer);
  }
};

// ============================================
// FACTION INTELLIGENCE REPORTS
// ============================================
export function generateFactionIntelReports() {
  // Reports every 10 turns, but rumours can fire at turn 5 too
  const isReportTurn = game.turn % 10 === 0;
  const isRumourTurn = game.turn % 5 === 0;
  if (!isReportTurn && !isRumourTurn) return;

  // If no met factions, skip reports but still generate rumours
  if (!game.metFactions || Object.keys(game.metFactions).length === 0) {
    if (isRumourTurn) {
      const rumours = generateRumours();
      if (rumours.length > 0) {
        addEvent('\u{1F4AC} Rumours & Whispers', 'diplomacy');
        for (const rum of rumours) {
          addEvent(`  \u{1F4AC} ${rum.text}`, 'diplomacy');
        }
        showIntelNotification([], rumours);
      }
    }
    return;
  }
  if (!isReportTurn) {
    // Non-report turns: just rumours
    const rumours = generateRumours();
    if (rumours.length > 0) {
      addEvent('\u{1F4AC} Rumours & Whispers', 'diplomacy');
      for (const rum of rumours) {
        addEvent(`  \u{1F4AC} ${rum.text}`, 'diplomacy');
      }
      showIntelNotification([], rumours);
    }
    return;
  }

  const reports = [];
  for (const [fid, metInfo] of Object.entries(game.metFactions)) {
    const faction = FACTIONS[fid];
    const rel = game.relationships[fid] || 0;
    const stats = game.factionStats[fid];
    if (!stats || !faction) continue;

    // Detail level depends on relationship
    let detail = 'minimal'; // hostile: vague info
    if (rel >= 50) detail = 'full';        // allied: full intel
    else if (rel >= 20) detail = 'good';   // friendly: detailed
    else if (rel >= 0) detail = 'basic';   // neutral: basic
    // Check for intel-sharing agreements
    if (game.activeAlliances[fid]) detail = 'full';
    if (game.openBorders && game.openBorders[fid]) {
      if (detail === 'basic') detail = 'good';
    }

    let report = `${faction.name}: `;
    if (detail === 'full') {
      report += `Score ${stats.score}, Military ${stats.military}, Gold ${stats.gold}, Pop ${(stats.population/1000).toFixed(1)}k, ${stats.techs} techs, ${stats.territory} territory`;
      // Track changes
      const prevScore = stats._prevScore || stats.score;
      const delta = stats.score - prevScore;
      if (delta > 20) report += ' (growing rapidly!)';
      else if (delta < -10) report += ' (declining)';
      stats._prevScore = stats.score;
    } else if (detail === 'good') {
      report += `Military ${stats.military > game.military ? 'stronger' : stats.military < game.military * 0.7 ? 'weaker' : 'comparable'} to ours`;
      report += `, Economy ${stats.gold > game.gold ? 'richer' : 'poorer'}`;
      report += `, ${stats.techs} techs known`;
    } else if (detail === 'basic') {
      report += stats.military > game.military * 1.3 ? 'appears powerful' : stats.military < game.military * 0.7 ? 'seems weaker than us' : 'roughly our equal';
    } else {
      report += 'intentions unclear (hostile — limited intelligence)';
    }
    reports.push({ fid, report, detail });
  }

  if (reports.length > 0) {
    addEvent('\u{1F4CB} Intelligence Report — Turn ' + game.turn, 'diplomacy');
    for (const r of reports) {
      addEvent(`  \u{1F50D} ${r.report}`, 'diplomacy');
    }
    // Generate rumours about UNMET factions
    const rumours = generateRumours();
    for (const rum of rumours) {
      addEvent(`  \u{1F4AC} Rumour: ${rum.text}`, 'diplomacy');
    }
    showIntelNotification(reports, rumours);
  } else {
    // Even if no met factions have reports, still try rumours
    const rumours = generateRumours();
    if (rumours.length > 0) {
      addEvent('\u{1F4AC} Rumours & Whispers', 'diplomacy');
      for (const rum of rumours) {
        addEvent(`  \u{1F4AC} ${rum.text}`, 'diplomacy');
      }
      showIntelNotification([], rumours);
    }
  }
}

// ============================================
// RUMOUR SYSTEM
// ============================================
export function generateRumours() {
  const unmetFactions = Object.keys(FACTIONS).filter(fid => !(game.metFactions || {})[fid]);
  if (unmetFactions.length === 0) return [];

  const rumours = [];
  const numRumours = Math.min(unmetFactions.length, 1 + Math.floor(Math.random() * 2));
  const shuffled = [...unmetFactions].sort(() => Math.random() - 0.5);

  for (let i = 0; i < numRumours; i++) {
    const fid = shuffled[i];
    const faction = FACTIONS[fid];
    if (!game.factionStats[fid]) initFactionStats(fid);
    const fs = game.factionStats[fid];

    const sources = [
      'A wandering trader whispers of',
      'Travellers from distant lands report',
      'Merchants along the trade routes speak of',
      'Refugees fleeing conflict tell of',
      'Sailors returning from far shores mention',
      'An old hermit in the hills mutters about',
      'Shepherds on the frontier have seen signs of',
      'A caravan guard, deep in his cups, boasts of encountering',
      'Pilgrims passing through describe',
      'Nomads from the steppes warn of',
    ];
    const source = sources[Math.floor(Math.random() * sources.length)];
    const pool = getRumourPool(fid, faction, fs);
    const text = pool[Math.floor(Math.random() * pool.length)];

    rumours.push({ fid, text: `${source} ${text}`, factionType: faction.type });
  }
  return rumours;
}

export function getRumourPool(fid, faction, stats) {
  const city = faction.city;
  const strong = stats.military > 20;
  const rich = stats.gold > 80;
  const dir = ['north', 'south', 'east', 'west'][Math.floor(Math.random() * 4)];
  const colorWord = { '#c9a84c': 'golden', '#7a6fa8': 'purple', '#d4b45a': 'golden', '#c45c4a': 'crimson', '#6a7a8a': 'iron-grey', '#6aab5c': 'green' }[faction.color] || 'foreign';

  const general = [
    `a powerful civilization to the ${dir}, ruled by one they call "${faction.name.split(' ').pop()}."`,
    `a city named ${city}, beyond the unexplored frontier.`,
    `foreign soldiers bearing ${colorWord} banners seen at the edge of the known world.`,
    `a ${faction.type === 'leader' ? 'great empire' : faction.type === 'pirate' ? 'fearsome fleet' : faction.type === 'spy' ? 'shadowy network' : faction.type === 'tycoon' ? 'wealthy trading nation' : faction.type === 'general' ? 'militant stronghold' : 'popular uprising'} growing in uncharted lands.`,
  ];

  const specific = {
    emperor_valerian: [
      `a vast empire with marble cities and disciplined legions stretching across fertile plains.`,
      `an emperor who claims divine right to rule all civilized lands.`,
      `a dominion whose borders expand relentlessly. They say no neighbour stays independent for long.`,
      strong ? `an army so large it darkens the horizon when it marches.` : `a proud empire rebuilding after internal strife.`,
      rich ? `imperial tax collectors demanding gold from villages far beyond their borders.` : `an empire straining its treasury on military expansion.`,
    ],
    shadow_kael: [
      `a network of spies operating from a hidden fortress called ${city}.`,
      `mysterious disappearances in distant courts, all traced to someone called "the Shadow."`,
      `a spymaster who knows every ruler's secrets and sells them to the highest bidder.`,
      `hooded figures watching from crossroads and market squares.`,
      `strange coded messages carved into trees along trade routes.`,
    ],
    merchant_prince_castellan: [
      `a trading city of immense wealth where even the streets glitter with gold dust.`,
      `a merchant prince whose caravans carry goods from lands no map has charted.`,
      `${city}, a city where anything can be bought for the right price.`,
      rich ? `a treasury so vast this merchant prince lends gold to other rulers at interest.` : `a trading empire seeking military allies after bandit raids on its routes.`,
      `exotic spices, silks, and gemstones in frontier markets bearing the seal of a golden consortium.`,
    ],
    pirate_queen_elara: [
      `a pirate fleet terrorizing coastal waters, led by a queen who answers to no one.`,
      `ships flying crimson flags raiding merchants. Survivors speak of a woman called Elara.`,
      `a lawless port called ${city}, where stolen goods trade openly.`,
      `coastal villages paying tribute to avoid being sacked by a fearsome naval power.`,
      strong ? `a pirate armada so powerful that even established navies avoid certain waters.` : `a pirate fleet licking its wounds, but still dangerous.`,
    ],
    commander_thane: [
      `a military fortress called ${city}, where civilization is built around the discipline of war.`,
      `a commander who judges all by martial prowess. The weak are conquered, the strong respected.`,
      `iron-clad warriors patrolling far beyond their known borders, challenging all who approach.`,
      strong ? `an army never defeated in open battle. Their commander drills troops day and night.` : `a military power regrouping, but their legions remain fearsome.`,
      `the sound of war drums carried on the wind from beyond the mountains.`,
    ],
    rebel_leader_sera: [
      `an uprising of common folk who overthrew their rulers and now govern themselves.`,
      `a settlement called ${city} where all are equal and decisions are made by council.`,
      `a charismatic leader inspiring fierce loyalty among the dispossessed.`,
      `refugees finding sanctuary in a hidden refuge, protected by guerrilla fighters.`,
      `pamphlets calling for "the elder grove" appearing in frontier towns.`,
    ],
  };

  return [...general, ...(specific[fid] || [])];
}

export function showIntelNotification(reports, rumours) {
  // BUG-07: Don't show popup if turn summary is visible — events already logged
  const turnSummaryEl = document.getElementById('turn-summary');
  if (turnSummaryEl && turnSummaryEl.style.display === 'block') return;
  let banner = document.getElementById('intel-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'intel-banner';
    document.body.appendChild(banner);
  }

  const intelRows = (reports || []).map(r => {
    const detailBadge = r.detail === 'full' ? '\u{1F7E2}' : r.detail === 'good' ? '\u{1F7E1}' : r.detail === 'basic' ? '\u{1F7E0}' : '\u{1F534}';
    return `<div class="intel-row"><span class="intel-badge">${detailBadge}</span><span class="intel-text">${r.report}</span></div>`;
  }).join('');

  const rumourRows = (rumours || []).map((r, idx) => {
    const canPay = game.gold >= 15;
    const hasAlly = Object.entries(game.metFactions || {}).some(([fid]) => (game.relationships[fid] || 0) >= 20);
    return `<div class="intel-row rumour-row">
      <span class="intel-badge">\u{1F4AC}</span>
      <div class="rumour-content">
        <span class="intel-text rumour-text">${r.text}</span>
        <div class="rumour-actions">
          ${canPay ? `<button class="rumour-btn" onclick="payForRumourInfo('${r.fid}', ${idx})">\u{1F4B0} Pay 15g for details</button>` : `<span class="rumour-btn-disabled">Need 15g for details</span>`}
          ${hasAlly ? `<button class="rumour-btn rumour-btn-ally" onclick="corroborateRumour('${r.fid}', ${idx})">\u{1F91D} Ask ally to confirm</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  const hasRumours = rumours && rumours.length > 0;
  const hasReports = reports && reports.length > 0;

  banner.innerHTML = `
    <div class="intel-card">
      <div class="intel-header">${hasReports ? '\u{1F4CB} Intelligence Report' : '\u{1F4AC} Rumours & Whispers'} — Turn ${game.turn}</div>
      ${intelRows}
      ${hasRumours ? `${hasReports ? '<div class="rumour-divider">\u{1F4AC} Rumours & Whispers</div>' : ''}${rumourRows}` : ''}
      <button class="intel-dismiss" onclick="this.parentElement.parentElement.style.display='none'">Dismiss</button>
    </div>
  `;
  banner.style.display = 'block';
  // No auto-dismiss — persists until player ends the turn
}

// ============================================
// GAME LOG SYSTEM
// ============================================
export function logAction(category, detail, metadata) {
  if (!game || !game.gameLog) return;
  game.gameLog.push({
    turn: game.turn,
    time: Date.now(),
    category: category,  // combat, diplomacy, build, research, movement, trade, event, mod
    detail: detail,
    metadata: metadata || {},
  });
}

export function getGameLogSummary() {
  if (!game || !game.gameLog) return 'No log available';
  const log = game.gameLog;
  const summary = {
    totalEntries: log.length,
    turns: game.turn,
    byCategory: {},
    recentActions: log.slice(-20).map(e => `T${e.turn} [${e.category}] ${e.detail}`),
    diplomacyHistory: log.filter(e => e.category === 'diplomacy').map(e => `T${e.turn}: ${e.detail}`),
    combatHistory: log.filter(e => e.category === 'combat').map(e => `T${e.turn}: ${e.detail}`),
    buildHistory: log.filter(e => e.category === 'build').map(e => `T${e.turn}: ${e.detail}`),
  };
  for (const e of log) {
    summary.byCategory[e.category] = (summary.byCategory[e.category] || 0) + 1;
  }
  return summary;
}

// Export for querying
window.getGameLog = () => game ? game.gameLog : [];
window.getGameLogSummary = getGameLogSummary;
window.getGameLogForTurn = (turn) => game ? game.gameLog.filter(e => e.turn === turn) : [];
window.getGameLogByCategory = (cat) => game ? game.gameLog.filter(e => e.category === cat) : [];
window.getGameLogText = () => {
  if (!game) return '';
  return game.gameLog.map(e => `Turn ${e.turn} [${e.category}] ${e.detail}`).join('\n');
};

window.payForRumourInfo = function(factionId, rumourIdx) {
  if (game.gold < 15) return;
  game.gold -= 15;
  const faction = FACTIONS[factionId];
  if (!faction) return;
  if (!game.factionStats[factionId]) initFactionStats(factionId);
  const fs = game.factionStats[factionId];
  const details = [
    `The informant reveals: they are called "${faction.name}", ${faction.title}.`,
    `Their city is named ${faction.city}. They have roughly ${fs.military || '??'} military strength.`,
    `Their treasury holds about ${fs.gold || '??'} gold. They have ${fs.techs || '??'} technologies.`,
    `They are known as a ${faction.type} faction. Their banner color is distinctive.`,
  ];
  const detail = details[Math.floor(Math.random() * details.length)];
  addEvent('\u{1F4B0} Paid 15g for intelligence: ' + detail, 'diplomacy');
  const banner = document.getElementById('intel-banner');
  if (banner) banner.style.display = 'none';
  showModBanner('\u{1F50D}', detail, 'Paid informant');
  updateUI();
};

window.corroborateRumour = function(factionId, rumourIdx) {
  const faction = FACTIONS[factionId];
  if (!faction) return;
  let bestAlly = null, bestRel = 0;
  for (const [fid, met] of Object.entries(game.metFactions || {})) {
    const rel = game.relationships[fid] || 0;
    if (rel >= 20 && rel > bestRel) { bestAlly = fid; bestRel = rel; }
  }
  if (!bestAlly) { addEvent('No ally friendly enough to corroborate rumours.', 'diplomacy'); return; }
  const ally = FACTIONS[bestAlly];
  const stats = game.factionStats[factionId];
  const confirms = [
    `${ally.name} confirms: "Yes, we know of ${faction.name}. They are real, and ${stats && stats.military > 15 ? 'dangerous' : 'not to be underestimated'}."`,
    `${ally.name} says: "We have had dealings with them. Their city ${faction.city} lies beyond our borders. ${stats && stats.gold > 60 ? 'They are wealthy.' : 'They are modest in resources.'}"`,
    `${ally.name} nods: "The rumours are true. They are a ${faction.type} power. I can introduce you if you wish."`,
  ];
  const confirmMsg = confirms[Math.floor(Math.random() * confirms.length)];
  addEvent('\u{1F91D} ' + confirmMsg, 'diplomacy');
  game.relationships[bestAlly] = (game.relationships[bestAlly] || 0) + 2;
  const banner = document.getElementById('intel-banner');
  if (banner) banner.style.display = 'none';
  showModBanner('\u{1F91D}', confirmMsg, 'Corroborated by ' + ally.name);
};
