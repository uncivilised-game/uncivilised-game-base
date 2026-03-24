import { FACTIONS, FACTION_TRAITS, UNIT_TYPES, RESOURCES, BUILDINGS, TECHNOLOGIES, MAP_COLS, MAP_ROWS } from './constants.js';
import { game, API, safeStorage, currentChatCharacter, setCurrentChatCharacter } from './state.js';
import { hexDistance, getHexNeighbors } from './hex.js';
import { addEvent, logAction, showToast } from './events.js';
import { render } from './render.js';
import { applyGameMod, showModBanner } from './game-mods.js';
import { getComparisonData, getUnmetFactions } from './map.js';
import { createUnit } from './units.js';
import { PORTRAIT_MAP } from './constants.js';
import { TERRAIN_TILE_IMAGES } from './state.js';
import { discoverVisibleFactions, discoverFaction, revealAround } from './discovery.js';
import { countPlayerTerritory } from './events.js';
import { updateUI, updateEnvoyUI } from './leaderboard.js';

function getRelationLabel(value) {
  if (value >= 50) return { text: 'Allied', cls: 'relation-allied' };
  if (value >= 20) return { text: 'Friendly', cls: 'relation-friendly' };
  if (value > -20) return { text: 'Neutral', cls: 'relation-neutral' };
  return { text: 'Hostile', cls: 'relation-hostile' };
}


// ============================================
// TRADE ROUTES
// ============================================
function establishTradeRoute(factionId) {
  if (!game.tradeRoutes) game.tradeRoutes = [];
  const max = game.maxTradeRoutes || 1;
  if (game.tradeRoutes.length >= max) { addEvent('Max trade routes reached (' + max + ')', 'gold'); return; }
  if (game.tradeRoutes.some(r => r.factionId === factionId)) { addEvent('Already trading with this faction', 'gold'); return; }
  if (!game.techs.includes('currency')) { addEvent('Need Currency tech for trade routes', 'gold'); return; }
  game.tradeRoutes.push({ factionId, startTurn: game.turn });
  const fname = FACTIONS[factionId] ? FACTIONS[factionId].name : factionId;
  addEvent('Trade route established with ' + fname, 'gold');
  updateUI();
}

function cancelTradeRoute(factionId) {
  game.tradeRoutes = (game.tradeRoutes || []).filter(r => r.factionId !== factionId);
  addEvent('Trade route cancelled', 'gold');
  updateUI();
}

function renderDiplomacyPanel() {
  // Auto-discover any factions on tiles the player has already revealed
  discoverVisibleFactions();
  const container = document.getElementById('diplomacy-characters');
  container.innerHTML = '';

  const metCount = Object.keys(game.metFactions || {}).length;
  const totalFactions = Object.keys(FACTIONS).length;
  const unmetCount = totalFactions - metCount;

  // Tab bar: Diplomacy | Rankings
  const tabs = document.createElement('div');
  tabs.className = 'diplo-tabs';
  tabs.innerHTML = `
    <button class="diplo-tab active" data-tab="diplomacy">Diplomacy (${metCount}/${totalFactions})</button>
    <button class="diplo-tab" data-tab="rankings">Rankings</button>
  `;
  container.appendChild(tabs);

  const content = document.createElement('div');
  content.id = 'diplo-tab-content';
  container.appendChild(content);

  tabs.addEventListener('click', (e) => {
    if (!e.target.dataset.tab) return;
    tabs.querySelectorAll('.diplo-tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    if (e.target.dataset.tab === 'rankings') renderRankingsView(content);
    else renderDiplomacyList(content);
  });

  renderDiplomacyList(content);
}

function renderDiplomacyList(container) {
  container.innerHTML = '';

  const metIds = Object.keys(game.metFactions || {});
  const unmetIds = Object.keys(FACTIONS).filter(fid => !game.metFactions[fid]);

  if (metIds.length === 0) {
    container.innerHTML = '<p class="diplo-empty">You have not yet encountered any civilizations. Explore the map to discover them.</p>';
    return;
  }

  // Met factions
  for (const cid of metIds) {
    const faction = FACTIONS[cid];
    const rel = game.relationships[cid] || 0;
    const relLabel = getRelationLabel(rel);
    const metInfo = game.metFactions[cid];

    const card = document.createElement('div');
    card.className = 'char-card';
    const portraitImg = TERRAIN_TILE_IMAGES['portrait_' + cid];
    const hasPortraitImg = portraitImg && portraitImg.complete && portraitImg.naturalWidth > 0;
    card.innerHTML = `
      <span class="portrait ${faction.portraitClass}" ${hasPortraitImg ? `style="background-image:url(./assets/portraits/${PORTRAIT_MAP[cid] || ''}.jpg);background-size:cover;color:transparent"` : ''}>${faction.portrait}</span>
      <div class="char-info">
        <div class="char-name">${faction.name}</div>
        <div class="char-title">${faction.title}</div>
      </div>
      <span class="char-relation ${relLabel.cls}">${relLabel.text} (${rel > 0 ? '+' : ''}${rel})</span>
    `;
    card.addEventListener('click', () => openChat(cid));
    container.appendChild(card);
  }

  // Unmet civilizations indicator
  if (unmetIds.length > 0) {
    const unmetDiv = document.createElement('div');
    unmetDiv.className = 'unmet-civs';
    unmetDiv.innerHTML = `
      <div class="unmet-header">
        <span class="unmet-icon">?</span>
        <span>${unmetIds.length} undiscovered civilization${unmetIds.length > 1 ? 's' : ''}</span>
      </div>
      <p class="unmet-hint">Explore the map or ask a friendly faction for an introduction (requires Friendly relations, 20+)</p>
    `;
    container.appendChild(unmetDiv);
  }
}

function renderRankingsView(container) {
  container.innerHTML = '';
  const data = getComparisonData();

  if (data.length <= 1) {
    container.innerHTML = '<p class="diplo-empty">No civilizations discovered to compare against. Explore the map.</p>';
    return;
  }

  // Sort by score descending
  data.sort((a, b) => (b.stats.score || 0) - (a.stats.score || 0));

  const categories = [
    { key: 'score',      label: 'Score',      icon: '\u{2B50}' },
    { key: 'military',   label: 'Military',   icon: '\u{2694}' },
    { key: 'gold',       label: 'Gold',       icon: '\u{1F4B0}' },
    { key: 'population', label: 'Population', icon: '\u{1F465}' },
    { key: 'techs',      label: 'Technology', icon: '\u{1F4DA}' },
    { key: 'territory',  label: 'Territory',  icon: '\u{1F30D}' },
  ];

  // Overall rankings table
  let html = '<div class="rankings-table">';
  html += '<div class="rankings-header">';
  html += '<span class="rank-col rank-pos">#</span>';
  html += '<span class="rank-col rank-name">Civilization</span>';
  for (const cat of categories) {
    html += `<span class="rank-col rank-stat" title="${cat.label}">${cat.icon}</span>`;
  }
  html += '</div>';

  data.forEach((entry, idx) => {
    const isPlayer = entry.isPlayer;
    html += `<div class="rankings-row ${isPlayer ? 'rankings-player' : ''}">`;
    html += `<span class="rank-col rank-pos">${idx + 1}</span>`;
    html += `<span class="rank-col rank-name">${isPlayer ? '\u{1F451} ' : ''}${entry.name}</span>`;
    for (const cat of categories) {
      const val = entry.stats[cat.key] || 0;
      // Compare to player
      let cls = '';
      if (!isPlayer) {
        const playerVal = data.find(e => e.isPlayer)?.stats[cat.key] || 0;
        if (val > playerVal * 1.2) cls = 'stat-higher';
        else if (val < playerVal * 0.8) cls = 'stat-lower';
        else cls = 'stat-equal';
      }
      const display = cat.key === 'population' ? (val / 1000).toFixed(1) + 'k' : val;
      html += `<span class="rank-col rank-stat ${cls}">${display}</span>`;
    }
    html += '</div>';
  });
  html += '</div>';

  // Per-category leaders
  html += '<div class="category-leaders">';
  for (const cat of categories) {
    const sorted = [...data].sort((a, b) => (b.stats[cat.key] || 0) - (a.stats[cat.key] || 0));
    const leader = sorted[0];
    html += `<div class="cat-leader">`;
    html += `<span class="cat-icon">${cat.icon}</span>`;
    html += `<span class="cat-label">${cat.label}</span>`;
    html += `<span class="cat-name ${leader.isPlayer ? 'cat-player' : ''}">${leader.name}</span>`;
    html += `</div>`;
  }
  html += '</div>';

  container.innerHTML = html;
}

function openChat(characterId) {
  setCurrentChatCharacter(characterId);
  const faction = FACTIONS[characterId];

  document.getElementById('chat-name').textContent = faction.name;
  document.getElementById('chat-title').textContent = faction.title;
  const portrait = document.getElementById('chat-portrait');
  portrait.className = `portrait ${faction.portraitClass}`;
  const pImgName = PORTRAIT_MAP[characterId];
  if (pImgName) {
    portrait.style.backgroundImage = `url(./assets/portraits/${pImgName}.jpg)`;
    portrait.style.backgroundSize = 'cover';
    portrait.style.color = 'transparent';
  }
  portrait.textContent = faction.portrait;

  const chatBody = document.getElementById('chat-messages');
  chatBody.innerHTML = '';

  const history = game.conversationHistories[characterId] || [];
  for (const msg of history) {
    appendChatMessage(msg.role === 'user' ? 'player' : 'npc', msg.content, false);
  }

  if (history.length === 0 && !game._firstContactPending) {
    appendChatMessage('system', `You have requested an audience with ${faction.name}.`, false);
  }

  // Build quick-action bar showing current status + action buttons
  renderDiplomacyActions(characterId);

  document.getElementById('diplomacy-panel').style.display = 'none';
  document.getElementById('selection-panel').style.display = 'none';
  document.getElementById('chat-panel').style.display = 'flex';
  document.getElementById('chat-input').focus();
}

function renderDiplomacyActions(characterId) {
  const bar = document.getElementById('diplo-actions');
  if (!bar) return;
  const faction = FACTIONS[characterId];
  const rel = game.relationships[characterId] || 0;
  const hasAlliance = !!game.activeAlliances[characterId];
  const hasTrade = !!game.tradeDeals[characterId];
  const hasMarriage = !!game.marriages[characterId];
  const hasDefensePact = !!game.defensePacts[characterId];

  // Show envoy count
  const hasOB = game.openBorders && !!game.openBorders[characterId];
  const hasNAP = game.nonAggressionPacts && !!game.nonAggressionPacts[characterId];
  const hasCF = game.ceasefires && !!game.ceasefires[characterId];
  const isVassal = game.vassals && !!game.vassals[characterId];
  const hasEmbargo = game.embargoes && !!game.embargoes[characterId];

  let html = `<div class="diplo-envoy-bar"><span class="envoy-indicator">Envoys: ${game.envoys}/${game.maxEnvoys}</span>`;
  if (game.envoySpentThisTurn[characterId]) {
    html += `<span class="envoy-free">Free conversation (already engaged)</span>`;
  } else if (game.envoys > 0) {
    html += `<span class="envoy-cost">Starting costs 1 envoy</span>`;
  } else {
    html += `<span class="envoy-depleted">No envoys — end turn to replenish</span>`;
  }
  html += '</div>';

  html += '<div class="diplo-status">';
  if (hasAlliance) html += `<span class="diplo-badge alliance">\u{1F91D} Alliance (${game.activeAlliances[characterId].turns - (game.turn - game.activeAlliances[characterId].startTurn)}t)</span>`;
  if (hasTrade) html += `<span class="diplo-badge trade">\u{1F4E6} Trade Deal</span>`;
  if (hasMarriage) html += `<span class="diplo-badge marriage">\u{1F48D} ${game.marriages[characterId].member}</span>`;
  if (hasDefensePact) html += `<span class="diplo-badge defense">\u{1F6E1} Defense Pact</span>`;
  if (hasOB) html += `<span class="diplo-badge trade">\u{1F6A9} Open Borders</span>`;
  if (hasNAP) html += `<span class="diplo-badge defense">\u{1F4DC} Non-Aggression</span>`;
  if (hasCF) html += `<span class="diplo-badge neutral">\u{1F3F3} Ceasefire</span>`;
  if (isVassal) html += `<span class="diplo-badge alliance">\u{1F451} Vassal</span>`;
  if (hasEmbargo) html += `<span class="diplo-badge danger">\u{1F6AB} Embargo</span>`;
  if (!hasAlliance && !hasTrade && !hasMarriage && !hasDefensePact && !hasOB && !hasNAP && !hasCF && !isVassal && !hasEmbargo) html += `<span class="diplo-badge neutral">No active agreements</span>`;
  html += '</div>';

  html += '<div class="diplo-btns">';
  // Core diplomatic actions
  html += `<button class="diplo-btn" onclick="proposeDiplomacy('alliance')">\u{1F91D} Alliance</button>`;
  html += `<button class="diplo-btn" onclick="proposeDiplomacy('trade')">\u{1F4E6} Trade Deal</button>`;
  html += `<button class="diplo-btn" onclick="proposeDiplomacy('marriage')">\u{1F48D} Marriage</button>`;
  html += `<button class="diplo-btn" onclick="proposeDiplomacy('defense')">\u{1F6E1} Defense Pact</button>`;
  // New diplomatic options
  html += `<button class="diplo-btn" onclick="proposeDiplomacy('open_borders')">\u{1F6A9} Open Borders</button>`;
  html += `<button class="diplo-btn" onclick="proposeDiplomacy('non_aggression')">\u{1F4DC} Non-Aggression</button>`;
  html += `<button class="diplo-btn" onclick="proposeDiplomacy('gift')">\u{1F381} Send Gift</button>`;
  html += `<button class="diplo-btn" onclick="proposeDiplomacy('demand_tribute')">\u{1F4B0} Demand Tribute</button>`;
  html += `<button class="diplo-btn" onclick="proposeDiplomacy('intel')">\u{1F50D} Request Intel</button>`;
  html += `<button class="diplo-btn" onclick="proposeDiplomacy('tech_share')">\u{1F4DA} Share Technology</button>`;
  html += `<button class="diplo-btn" onclick="proposeDiplomacy('resource_trade')">\u{2696} Resource Trade</button>`;
  // Introduction: only if friendly (20+) and there are unmet factions
  const unmetForIntro = getUnmetFactions(characterId);
  if (rel >= 20 && unmetForIntro.length > 0) {
    html += `<button class="diplo-btn diplo-btn-intro" onclick="proposeDiplomacy('introduction')">\u{1F465} Request Introduction</button>`;
  }
  // Hostile/situational actions
  if (!game.embargoes[characterId]) {
    html += `<button class="diplo-btn diplo-btn-warning" onclick="proposeDiplomacy('embargo')">\u{1F6AB} Embargo</button>`;
  }
  html += `<button class="diplo-btn diplo-btn-warning" onclick="proposeDiplomacy('threat')">\u{26A0} Threaten</button>`;
  if (hasAlliance || hasDefensePact) {
    html += `<button class="diplo-btn diplo-btn-danger" onclick="proposeDiplomacy('surprise_attack')">\u{1F5E1} Surprise Attack</button>`;
  }
  if (rel < -20) {
    html += `<button class="diplo-btn" onclick="proposeDiplomacy('peace')">\u{1F54A} Offer Peace</button>`;
    html += `<button class="diplo-btn" onclick="proposeDiplomacy('ceasefire')">\u{1F3F3} Ceasefire</button>`;
  }
  if (rel > 30 && game.military > 20) {
    html += `<button class="diplo-btn" onclick="proposeDiplomacy('vassalage')">\u{1F451} Vassalage</button>`;
  }
  html += '</div>';

  bar.innerHTML = html;
}

window.proposeDiplomacy = function(type) {
  const input = document.getElementById('chat-input');
  const faction = FACTIONS[currentChatCharacter];
  const templates = {
    alliance: `I propose a formal alliance between our nations for 15 turns. Together we would be stronger against our enemies.`,
    trade: `I would like to establish a trade agreement. I can offer gold per turn in exchange for military support and resources.`,
    marriage: `To strengthen our bond, I propose a royal marriage between our houses. I offer a generous dowry to seal this union.`,
    defense: `I propose a mutual defense pact. If either of us is attacked, the other pledges to come to their aid.`,
    surprise_attack: `*launches a surprise military strike against ${faction.name}'s forces*`,
    peace: `I come seeking peace. Let us end this conflict and find a way to coexist.`,
    open_borders: `I propose an open borders agreement for 10 turns. Our people and traders may pass freely through each other's lands.`,
    non_aggression: `I propose a non-aggression pact for 20 turns. Neither side will initiate hostilities during this period.`,
    gift: `As a gesture of goodwill, I wish to send you a gift of ${Math.min(30, game.gold)} gold and fine goods from our lands.`,
    demand_tribute: `Your position grows weak, ${faction.name}. I demand tribute of gold and resources as acknowledgment of our superiority.`,
    intel: `I seek intelligence about our mutual rivals. What can you tell me about the movements and strength of nearby factions?`,
    tech_share: `I propose we share our scholarly knowledge. Our scribes have made advances that could benefit both our peoples.`,
    resource_trade: `I would like to trade resources. We have surplus ${game.gold > 80 ? 'gold' : 'goods'} and seek what your lands produce.`,
    embargo: `I propose we jointly embargo ${faction.name === 'Valerian' ? 'our rivals' : 'those who threaten us'}. Cut off their trade and weaken their economy.`,
    threat: `Hear me well, ${faction.name}. Our armies grow stronger by the day. It would be unwise to test our patience.`,
    ceasefire: `I propose an immediate ceasefire for 10 turns. Let the blood stop flowing while we negotiate a lasting peace.`,
    vassalage: `Given the balance of power, I offer you protection as a vassal state. You will pay tribute but enjoy the security of our forces.`,
    introduction: `Our friendship has grown strong, ${faction.name}. I would be grateful if you could introduce me to other rulers you know. I seek to broaden my diplomatic reach.`,
  };
  input.value = templates[type] || `I wish to discuss ${type} with you.`;
  input.focus();
};
// Make openChat available globally for onclick handlers
window.openChat = openChat;

function renderChatMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function updateDiploActions(characterId) {
  // Refresh the diplomacy action buttons to reflect updated envoy count and agreements
  const actionsDiv = document.getElementById('diplo-actions');
  if (!actionsDiv || !characterId) return;
  const envoyEl = actionsDiv.querySelector('.envoy-info');
  if (envoyEl && game) {
    const spent = game.envoySpentThisTurn && game.envoySpentThisTurn[characterId] ? 1 : 0;
    envoyEl.textContent = 'Envoys: ' + game.envoys + '/' + (game.maxEnvoys || 3) + (spent ? ' Free conversation (already engaged)' : ' Starting costs 1 envoy');
  }
}

function appendChatMessage(type, text, scroll = true) {
  const chatBody = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = `chat-msg ${type}`;
  if (type === 'npc') {
    msg.innerHTML = renderChatMarkdown(text);
  } else {
    msg.textContent = text;
  }
  chatBody.appendChild(msg);
  if (scroll) chatBody.scrollTop = chatBody.scrollHeight;
  return msg;
}

function appendChatAction(text) {
  const chatBody = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-action';
  div.textContent = text;
  chatBody.appendChild(div);
  chatBody.scrollTop = chatBody.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message || !currentChatCharacter) return;

  // Check envoy credits — each "send" to a NEW character this turn costs 1 envoy
  // Continuing a conversation with the same character in the same turn is free (unlimited rounds)
  const alreadyTalked = game.envoySpentThisTurn[currentChatCharacter];
  if (!alreadyTalked && game.envoys <= 0) {
    appendChatMessage('system', 'No diplomatic envoys remaining this turn. End your turn to replenish.');
    return;
  }
  if (!alreadyTalked) {
    game.envoys--;
    game.envoySpentThisTurn[currentChatCharacter] = true;
    updateEnvoyUI();
  }

  input.value = '';
  input.disabled = true;
  document.getElementById('chat-send').disabled = true;
  appendChatMessage('player', message);

  if (!game.conversationHistories[currentChatCharacter]) {
    game.conversationHistories[currentChatCharacter] = [];
  }
  game.conversationHistories[currentChatCharacter].push({ role: 'user', content: message });

  const typing = appendChatMessage('npc typing', '...');

  try {
    const gameState = {
      turn: game.turn,
      gold: game.gold,
      military: game.military,
      cities: game.cities.length,
      population: game.population,
      territory: countPlayerTerritory(),
      units: game.units.filter(u => u.owner === 'player').length,
      relationship: game.relationships,
      alliances: game.activeAlliances,
      trade_deals: game.tradeDeals,
      marriages: game.marriages,
      defense_pacts: game.defensePacts,
      open_borders: game.openBorders || {},
      embargoes: game.embargoes || {},
      ceasefires: game.ceasefires || {},
      vassals: game.vassals || {},
      non_aggression_pacts: game.nonAggressionPacts || {},
      envoys_remaining: game.envoys,
      recent_events: game.recentEvents.slice(-5).map(e => e.text),
    };

    const response = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-player-name': (safeStorage.getItem('uncivilised_username') || 'anonymous'),
        'x-game-session': (window._gameSessionId || '')
      },
      body: JSON.stringify({
        character_id: currentChatCharacter,
        message: message,
        game_state: gameState,
        conversation_history: game.conversationHistories[currentChatCharacter].slice(-8),
      }),
    });

    const data = await response.json();
    typing.remove();
    appendChatMessage('npc', data.reply);
    game.conversationHistories[currentChatCharacter].push({ role: 'assistant', content: data.reply });
    logAction('diplomacy', `Spoke with ${FACTIONS[currentChatCharacter]?.name}: "${message.substring(0, 80)}..."`,
      { character: currentChatCharacter, playerMsg: message, aiReply: data.reply.substring(0, 200), action: data.action });

    if (data.action && data.action.type !== 'none') {
      // Actions that require player approval (proposals/offers)
      const NEEDS_APPROVAL = new Set([
        'offer_trade', 'offer_alliance', 'marriage_offer', 'trade_deal',
        'mutual_defense', 'offer_peace', 'open_borders', 'non_aggression',
        'ceasefire', 'vassalage', 'tech_share', 'resource_trade',
        'demand_tribute', 'send_gift', 'accept_tribute',
      ]);

      if (NEEDS_APPROVAL.has(data.action.type)) {
        // Show Accept/Reject buttons in the chat
        showDiplomacyProposal(currentChatCharacter, data.action);
      } else {
        // Unilateral actions (war, threats, intel, etc.) execute immediately
        processCharacterAction(currentChatCharacter, data.action);
      }
    }
    // Refresh the diplo actions bar to show updated envoy count and agreements
    updateDiploActions(currentChatCharacter);
  } catch (err) {
    typing.remove();
    appendChatMessage('system', 'The diplomat seems distracted. Try again.');
    console.error('Chat error:', err);
  }

  input.disabled = false;
  document.getElementById('chat-send').disabled = false;
  input.focus();
}


// ============================================
// DIPLOMACY PROPOSAL — Accept/Reject UI
// ============================================
function showDiplomacyProposal(characterId, action) {
  const faction = FACTIONS[characterId];
  const factionName = faction ? faction.name : 'Unknown';

  // Build a human-readable description of the proposal
  let proposalText = '';
  let proposalIcon = '\u{1F4DC}';

  switch (action.type) {
    case 'offer_trade':
      proposalIcon = '\u{1F4B0}';
      proposalText = `Trade Offer: ${action.give || 'resources'} for ${action.want || action.receive || 'resources'}`;
      break;
    case 'offer_alliance':
      proposalIcon = '\u{1F91D}';
      proposalText = `Alliance for ${action.duration || 15} turns`;
      break;
    case 'marriage_offer':
      proposalIcon = '\u{1F48D}';
      proposalText = `Royal Marriage with ${action.member || 'a family member'} (+${action.dowry_gold || 50} gold dowry)`;
      break;
    case 'trade_deal':
      proposalIcon = '\u{1F4E6}';
      proposalText = `Trade Deal for ${action.duration || 10} turns: You give ${action.player_gives || '?'}, receive ${action.player_receives || '?'}`;
      break;
    case 'mutual_defense':
      proposalIcon = '\u{1F6E1}';
      proposalText = `Mutual Defense Pact for ${action.duration || 15} turns`;
      break;
    case 'offer_peace':
      proposalIcon = '\u{1F54A}';
      proposalText = 'Peace Treaty';
      break;
    case 'open_borders':
      proposalIcon = '\u{1F6A9}';
      proposalText = `Open Borders for ${action.duration || 10} turns`;
      break;
    case 'non_aggression':
      proposalIcon = '\u{1F4DC}';
      proposalText = `Non-Aggression Pact for ${action.duration || 20} turns`;
      break;
    case 'ceasefire':
      proposalIcon = '\u{1F3F3}';
      proposalText = `Ceasefire for ${action.duration || 10} turns`;
      break;
    case 'vassalage':
      proposalIcon = '\u{1F451}';
      proposalText = `Vassalage (they pay ${action.tribute_gold || 5} gold/turn)`;
      break;
    case 'tech_share':
      proposalIcon = '\u{1F4DA}';
      proposalText = 'Technology Exchange (+1 science/turn)';
      break;
    case 'resource_trade':
      proposalIcon = '\u{2696}';
      proposalText = `Resource Trade: You give ${action.gives || '?'}, receive ${action.receives || '?'}`;
      break;
    case 'demand_tribute':
      proposalIcon = '\u{1F4B0}';
      proposalText = `Demands ${action.amount || 20} gold as tribute`;
      break;
    case 'send_gift':
      proposalIcon = '\u{1F381}';
      proposalText = `Gift of ${action.amount || 20} gold`;
      break;
    case 'accept_tribute':
      proposalIcon = '\u{1F4B0}';
      proposalText = `Offers ${action.amount || 15} gold in tribute`;
      break;
    case 'request_unit':
      proposalIcon = '\u{1F381}';
      proposalText = `Requests a unit as a gift of good faith`;
      break;
    case 'gift_unit':
      proposalIcon = '\u{1F381}';
      proposalText = `Offers to gift a unit to you`;
      break;
    default:
      proposalText = action.type.replace(/_/g, ' ');
  }

  // Create the proposal UI in the chat
  const messagesDiv = document.getElementById('chat-messages');
  const proposalDiv = document.createElement('div');
  proposalDiv.style.cssText = 'margin:8px 0;padding:10px 14px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.3);border-radius:8px';
  proposalDiv.innerHTML = `
    <div style="color:#c9a84c;font-size:13px;font-weight:600;margin-bottom:6px">${proposalIcon} ${factionName} proposes:</div>
    <div style="color:#e8e0d0;font-size:13px;margin-bottom:10px">${proposalText}</div>
    <div style="display:flex;gap:8px">
      <button id="proposal-accept" style="flex:1;background:rgba(90,158,111,0.2);border:1px solid rgba(90,158,111,0.5);color:#5a9e6f;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s"
        onmouseover="this.style.background='rgba(90,158,111,0.35)'" onmouseout="this.style.background='rgba(90,158,111,0.2)'"
        >Accept</button>
      <button id="proposal-reject" style="flex:1;background:rgba(217,83,79,0.15);border:1px solid rgba(217,83,79,0.4);color:#d9534f;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s"
        onmouseover="this.style.background='rgba(217,83,79,0.3)'" onmouseout="this.style.background='rgba(217,83,79,0.15)'"
        >Reject</button>
    </div>
  `;
  messagesDiv.appendChild(proposalDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  // Wire up buttons
  proposalDiv.querySelector('#proposal-accept').addEventListener('click', function() {
    proposalDiv.innerHTML = '<div style="color:#5a9e6f;font-size:12px;padding:4px 0">\u2714 Accepted</div>';
    processCharacterAction(characterId, action);
    updateDiploActions(characterId);
  });

  proposalDiv.querySelector('#proposal-reject').addEventListener('click', function() {
    proposalDiv.innerHTML = '<div style="color:#d9534f;font-size:12px;padding:4px 0">\u2718 Rejected</div>';
    game.relationships[characterId] = (game.relationships[characterId] || 0) - 5;
    addEvent('Rejected ' + factionName + '\'s proposal (-5 relations)', 'diplomacy');
    updateDiploActions(characterId);
  });
}

function processCharacterAction(characterId, action) {
  const faction = FACTIONS[characterId];
  switch (action.type) {
    case 'offer_trade': {
      const give = action.give || action.receive || '?';
      const want = action.want || '?';
      appendChatAction(`\u{1F4DC} Trade Offer: ${faction.name} gives ${give}`);
      // Parse gold gifts
      const giveStr = String(action.give || '');
      if (giveStr.startsWith('gold:')) {
        const amount = parseInt(giveStr.split(':')[1]) || 0;
        game.gold += amount;
        game.relationships[characterId] = (game.relationships[characterId] || 0) + 5;
        addEvent(`Trade with ${faction.name}: +${amount} gold`, 'gold');
      }
      break;
    }
    case 'offer_alliance': {
      const duration = action.duration || 15;
      game.activeAlliances[characterId] = { turns: duration, startTurn: game.turn };
      game.relationships[characterId] = (game.relationships[characterId] || 0) + 20;
      // AI commits to defend player during alliance
      if (!game.aiCommitments) game.aiCommitments = [];
      game.aiCommitments.push({ factionId: characterId, type: 'defend_player', turnsLeft: duration });
      logAction('diplomacy', faction.name + ' commits to mutual defence for ' + duration + ' turns', { factionId: characterId });
      appendChatAction(`\u{1F91D} Alliance formed with ${faction.name} for ${duration} turns`);
      addEvent(`Alliance with ${faction.name} for ${duration} turns`, 'diplomacy');
      break;
    }
    case 'declare_war': {
      // Register AI commitment to wage war
      if (!game.aiCommitments) game.aiCommitments = [];
      game.aiCommitments.push({ factionId: characterId, type: 'war', target: 'player', turnsLeft: 15 });
      logAction('diplomacy', faction.name + ' declares war!', { factionId: characterId });
      // Check if breaking an alliance (extra penalty)
      if (game.activeAlliances[characterId]) {
        delete game.activeAlliances[characterId];
        game.relationships[characterId] = (game.relationships[characterId] || 0) - 60;
        appendChatAction(`\u{1F494} ${faction.name} has broken the alliance and declared war!`);
      } else {
        game.relationships[characterId] = Math.min(-50, (game.relationships[characterId] || 0) - 40);
        appendChatAction(`\u{2694} ${faction.name} has declared war!`);
      }
      // Remove any existing pacts
      delete game.defensePacts[characterId];
      delete game.tradeDeals[characterId];
      addEvent(`${faction.name} has declared war!`, 'combat');
      break;
    }
    case 'surprise_attack': {
      // Treacherous attack — breaks all agreements with massive penalty
      const hadAlliance = !!game.activeAlliances[characterId];
      const hadMarriage = !!game.marriages[characterId];
      delete game.activeAlliances[characterId];
      delete game.defensePacts[characterId];
      delete game.tradeDeals[characterId];
      let penalty = -40;
      if (hadAlliance) penalty -= 30;
      if (hadMarriage) penalty -= 20;
      game.relationships[characterId] = Math.min(-70, (game.relationships[characterId] || 0) + penalty);
      appendChatAction(`\u{1F5E1} TREACHERY! ${faction.name} has launched a surprise attack!`);
      addEvent(`${faction.name} BETRAYAL — surprise attack!`, 'combat');
      // Damage a random player unit
      const playerUnits = game.units.filter(u => u.owner === 'player');
      if (playerUnits.length > 0) {
        const target = playerUnits[Math.floor(Math.random() * playerUnits.length)];
        target.hp = Math.max(10, target.hp - 30);
        addEvent(`${UNIT_TYPES[target.type].name} ambushed! (-30 HP)`, 'combat');
      }
      break;
    }
    case 'marriage_offer': {
      const member = action.member || 'a royal family member';
      const dowry = action.dowry_gold || 50;
      const duration = action.duration || 20;
      game.marriages[characterId] = {
        member: member,
        startTurn: game.turn,
        duration: duration,
      };
      game.gold += dowry;
      game.relationships[characterId] = (game.relationships[characterId] || 0) + 30;
      game.culture += 3;
      appendChatAction(`\u{1F48D} Royal Marriage: ${member} joins your court! (+${dowry} gold dowry, +30 relations, +3 culture)`);
      addEvent(`Marriage with ${faction.name}: ${member} (+${dowry}g)`, 'diplomacy');
      break;
    }
    case 'trade_deal': {
      const gives = action.player_gives || 'resources';
      const receives = action.player_receives || 'resources';
      const duration = action.duration || 10;
      game.tradeDeals[characterId] = {
        playerGives: gives,
        playerReceives: receives,
        duration: duration,
        startTurn: game.turn,
      };
      game.relationships[characterId] = (game.relationships[characterId] || 0) + 10;
      appendChatAction(`\u{1F4E6} Trade Deal established for ${duration} turns\nYou give: ${gives}\nYou receive: ${receives}`);
      addEvent(`Trade deal with ${faction.name} for ${duration} turns`, 'gold');
      break;
    }
    case 'mutual_defense': {
      const duration = action.duration || 15;
      game.defensePacts[characterId] = {
        duration: duration,
        startTurn: game.turn,
      };
      game.relationships[characterId] = (game.relationships[characterId] || 0) + 15;
      game.defense += 3;
      appendChatAction(`\u{1F6E1} Mutual Defense Pact with ${faction.name} for ${duration} turns (+3 defense)`);
      addEvent(`Defense pact with ${faction.name}`, 'diplomacy');
      break;
    }
    case 'share_intel': {
      const target = action.target;
      if (target && game.factionCities[target]) {
        const fc = game.factionCities[target];
        revealAround(fc.col, fc.row, 4);
        appendChatAction(`\u{1F50D} Intel received about ${game.factionCities[target].name}`);
        addEvent(`Intelligence about ${game.factionCities[target].name}`, 'diplomacy');
      }
      game.relationships[characterId] = (game.relationships[characterId] || 0) + 3;
      break;
    }
    case 'offer_peace': {
      if (game.relationships[characterId] < -20) {
        game.relationships[characterId] = -10;
        appendChatAction(`\u{1F54A} Peace treaty signed with ${faction.name}`);
        addEvent(`Peace with ${faction.name}`, 'diplomacy');
      }
      break;
    }
    case 'demand_tribute': {
      const amount = action.amount || 20;
      appendChatAction(`\u{1F4B0} ${faction.name} demands ${amount} gold as tribute`);
      break;
    }
    case 'open_borders': {
      const duration = action.duration || 10;
      if (!game.openBorders) game.openBorders = {};
      game.openBorders[characterId] = { startTurn: game.turn, duration };
      game.relationships[characterId] = (game.relationships[characterId] || 0) + 8;
      appendChatAction(`\u{1F6A9} Open Borders agreement with ${faction.name} for ${duration} turns`);
      addEvent(`Open borders with ${faction.name}`, 'diplomacy');
      break;
    }
    case 'non_aggression': {
      const duration = action.duration || 20;
      if (!game.nonAggressionPacts) game.nonAggressionPacts = {};
      game.nonAggressionPacts[characterId] = { startTurn: game.turn, duration };
      game.relationships[characterId] = (game.relationships[characterId] || 0) + 10;
      appendChatAction(`\u{1F4DC} Non-Aggression Pact with ${faction.name} for ${duration} turns`);
      addEvent(`Non-aggression pact with ${faction.name}`, 'diplomacy');
      break;
    }
    case 'send_gift': {
      const amount = action.amount || 20;
      game.gold = Math.max(0, game.gold - amount);
      game.relationships[characterId] = (game.relationships[characterId] || 0) + Math.floor(amount / 3);
      appendChatAction(`\u{1F381} Sent gift of ${amount} gold to ${faction.name} (+${Math.floor(amount/3)} relations)`);
      addEvent(`Gift to ${faction.name}: ${amount} gold`, 'diplomacy');
      break;
    }
    case 'accept_tribute': {
      const amount = action.amount || 15;
      game.gold += amount;
      game.relationships[characterId] = (game.relationships[characterId] || 0) - 15;
      appendChatAction(`\u{1F4B0} ${faction.name} pays ${amount} gold in tribute`);
      addEvent(`Tribute from ${faction.name}: +${amount} gold`, 'gold');
      break;
    }
    case 'gift_unit': {
      // AI gifts a unit to the player — spawn near player capital
      let giftType = action.unit_type || 'warrior';
      if (!UNIT_TYPES[giftType]) giftType = 'warrior'; // validate AI-provided unit type
      const ut = UNIT_TYPES[giftType];
      if (ut && game.cities[0]) {
        const cap = game.cities[0];
        const neighbors = getHexNeighbors(cap.col, cap.row);
        const freeHex = neighbors.find(n => {
          if (n.col < 0 || n.col >= MAP_COLS || n.row < 0 || n.row >= MAP_ROWS) return false;
          return !game.units.some(u => u.col === n.col && u.row === n.row);
        });
        if (freeHex) {
          createUnit(giftType, freeHex.col, freeHex.row, 'player');
          game.relationships[characterId] = (game.relationships[characterId] || 0) + 10;
          appendChatAction(`\u{1F381} ${faction.name} gifts you a ${ut.name}! (+10 relations)`);
          addEvent(`${faction.name} gifted a ${ut.name}`, 'diplomacy');
        }
      }
      break;
    }
    case 'request_unit': {
      // AI requests the player gift them a unit — show toast prompting action
      appendChatAction(`\u{1F381} ${faction.name} requests you gift them a military unit as a sign of trust`);
      showToast('Unit Requested', `${faction.name} wants you to gift them a unit.\nSelect a unit and use the Gift button.`);
      break;
    }
    case 'embargo': {
      const duration = action.duration || 15;
      if (!game.embargoes) game.embargoes = {};
      game.embargoes[characterId] = { startTurn: game.turn, duration };
      game.relationships[characterId] = (game.relationships[characterId] || 0) - 25;
      delete game.tradeDeals[characterId];
      appendChatAction(`\u{1F6AB} Embargo imposed on ${faction.name} for ${duration} turns!`);
      addEvent(`Embargo on ${faction.name}`, 'diplomacy');
      break;
    }
    case 'ceasefire': {
      const duration = action.duration || 10;
      if (!game.ceasefires) game.ceasefires = {};
      game.ceasefires[characterId] = { startTurn: game.turn, duration };
      game.relationships[characterId] = Math.max(-20, (game.relationships[characterId] || 0) + 15);
      appendChatAction(`\u{1F3F3} Ceasefire with ${faction.name} for ${duration} turns`);
      addEvent(`Ceasefire with ${faction.name}`, 'diplomacy');
      break;
    }
    case 'vassalage': {
      const tribute = action.tribute_gold || 5;
      if (!game.vassals) game.vassals = {};
      game.vassals[characterId] = { startTurn: game.turn, tributeGold: tribute };
      game.relationships[characterId] = (game.relationships[characterId] || 0) - 10;
      game.military += 5;
      appendChatAction(`\u{1F451} ${faction.name} becomes a vassal state! (+${tribute} gold/turn tribute, +5 military)`);
      addEvent(`${faction.name} is now a vassal`, 'diplomacy');
      break;
    }
    case 'tech_share': {
      game.sciencePerTurn += 1;
      game.relationships[characterId] = (game.relationships[characterId] || 0) + 8;
      appendChatAction(`\u{1F4DA} Technology exchange with ${faction.name} (+1 science/turn)`);
      addEvent(`Tech sharing with ${faction.name}`, 'science');
      break;
    }
    case 'resource_trade': {
      const gives = action.gives || 'resources';
      const receives = action.receives || 'resources';
      game.relationships[characterId] = (game.relationships[characterId] || 0) + 5;
      appendChatAction(`\u{2696} Resource trade: You give ${gives}, receive ${receives}`);
      addEvent(`Resource trade with ${faction.name}`, 'gold');
      break;
    }
    case 'threaten': {
      game.relationships[characterId] = (game.relationships[characterId] || 0) - 15;
      appendChatAction(`\u{26A0} Threat issued to ${faction.name} (-15 relations)`);
      // Weak factions may yield tribute
      if (game.military > 25 && Math.random() < 0.4) {
        const tribute = 10 + Math.floor(Math.random() * 20);
        game.gold += tribute;
        appendChatAction(`\u{1F4B0} ${faction.name} backs down and pays ${tribute} gold!`);
      }
      break;
    }
    case 'attack_target': {
      // AI agrees to attack a specific faction
      const targetFid = action.target_faction;
      if (targetFid && FACTIONS[targetFid]) {
        if (!game.aiCommitments) game.aiCommitments = [];
        game.aiCommitments.push({ factionId: characterId, type: 'attack_faction', target: targetFid, turnsLeft: 15 });
        game.relationships[characterId] = (game.relationships[characterId] || 0) + 5;
        appendChatAction(`\u{2694} ${faction.name} commits to attack ${FACTIONS[targetFid].name}!`);
        addEvent(`${faction.name} will attack ${FACTIONS[targetFid].name}!`, 'combat');
        logAction('diplomacy', `${faction.name} commits to attack ${FACTIONS[targetFid].name}`, { factionId: characterId, target: targetFid });
      }
      break;
    }
    case 'defend_city': {
      const cityIdx = action.city_index || 0;
      const city = game.cities[cityIdx];
      if (city) {
        if (!game.aiCommitments) game.aiCommitments = [];
        game.aiCommitments.push({ factionId: characterId, type: 'defend_city', cityCol: city.col, cityRow: city.row, turnsLeft: action.duration || 10 });
        appendChatAction(`\u{1F6E1} ${faction.name} sends forces to defend ${city.name}!`);
        logAction('diplomacy', `${faction.name} commits to defend ${city.name}`, { factionId: characterId });
      }
      break;
    }
    case 'respect_borders': {
      if (!game.aiCommitments) game.aiCommitments = [];
      game.aiCommitments.push({ factionId: characterId, type: 'respect_borders', turnsLeft: action.duration || 20 });
      appendChatAction(`\u{1F6A9} ${faction.name} agrees to respect your borders!`);
      logAction('diplomacy', `${faction.name} commits to respect borders`, { factionId: characterId });
      break;
    }
    case 'no_settle_near': {
      if (!game.aiCommitments) game.aiCommitments = [];
      game.aiCommitments.push({ factionId: characterId, type: 'no_settle_near', turnsLeft: action.duration || 30 });
      appendChatAction(`\u{1F3D8} ${faction.name} agrees not to settle near your territory!`);
      logAction('diplomacy', `${faction.name} won't settle near player`, { factionId: characterId });
      break;
    }
    case 'tribute_payment': {
      const goldPT = action.gold_per_turn || 3;
      if (!game.aiCommitments) game.aiCommitments = [];
      game.aiCommitments.push({ factionId: characterId, type: 'tribute_payment', goldPerTurn: goldPT, turnsLeft: action.duration || 15 });
      appendChatAction(`\u{1F4B0} ${faction.name} will pay ${goldPT} gold/turn in tribute!`);
      logAction('diplomacy', `${faction.name} pays ${goldPT}g/turn tribute`, { factionId: characterId, goldPerTurn: goldPT });
      break;
    }
    case 'joint_research': {
      const sciBoost = action.science_boost || 2;
      game.sciencePerTurn += sciBoost;
      if (!game.aiCommitments) game.aiCommitments = [];
      game.aiCommitments.push({ factionId: characterId, type: 'joint_research', turnsLeft: action.duration || 10, _scienceAdded: sciBoost });
      appendChatAction(`\u{1F52C} Joint research with ${faction.name}! +${sciBoost} science/turn for ${action.duration || 10} turns`);
      logAction('diplomacy', `Joint research: +${sciBoost} science/turn`, { factionId: characterId, sciBoost });
      break;
    }
    case 'wage_war_on': {
      const warTarget = action.target_faction;
      if (warTarget && FACTIONS[warTarget]) {
        if (!game.aiCommitments) game.aiCommitments = [];
        const dur = action.duration || 15;
        game.aiCommitments.push({ factionId: characterId, type: 'wage_war_on', target: warTarget, turnsLeft: dur, _initialTurns: dur });
        appendChatAction(`\u{2694} ${faction.name} declares war on ${FACTIONS[warTarget].name}!`);
        logAction('diplomacy', `${faction.name} wages war on ${FACTIONS[warTarget].name}`, { factionId: characterId, target: warTarget });
      }
      break;
    }
    case 'make_peace_with': {
      const peaceTarget = action.target_faction;
      if (peaceTarget && FACTIONS[peaceTarget]) {
        if (!game.aiCommitments) game.aiCommitments = [];
        const dur = action.duration || 20;
        game.aiCommitments.push({ factionId: characterId, type: 'make_peace_with', target: peaceTarget, turnsLeft: dur, _initialTurns: dur });
        appendChatAction(`\u{1F54A} ${faction.name} makes peace with ${FACTIONS[peaceTarget].name}`);
        logAction('diplomacy', `${faction.name} makes peace with ${FACTIONS[peaceTarget].name}`, { factionId: characterId, target: peaceTarget });
      }
      break;
    }
    case 'introduce': {
      // Faction introduces the player to an unmet faction
      const targetId = action.target_faction;
      if (targetId && FACTIONS[targetId] && !game.metFactions[targetId]) {
        discoverFaction(targetId, 'introduction');
        game.relationships[characterId] = (game.relationships[characterId] || 0) + 5;
        const targetFaction = FACTIONS[targetId];
        appendChatAction(`\u{1F465} ${faction.name} introduces you to ${targetFaction.name}!`);
        addEvent(`${faction.name} introduced you to ${targetFaction.name}`, 'diplomacy');
      } else {
        // Pick a random unmet faction to introduce
        const unmet = getUnmetFactions(characterId);
        if (unmet.length > 0) {
          const pick = unmet[Math.floor(Math.random() * unmet.length)];
          discoverFaction(pick, 'introduction');
          game.relationships[characterId] = (game.relationships[characterId] || 0) + 5;
          const targetFaction = FACTIONS[pick];
          appendChatAction(`\u{1F465} ${faction.name} introduces you to ${targetFaction.name}!`);
          addEvent(`${faction.name} introduced you to ${targetFaction.name}`, 'diplomacy');
        }
      }
      break;
    }
    case 'game_mod': {
      if (action.mod) {
        applyGameMod(action.mod, characterId);
      }
      break;
    }
  }
  updateUI();
  render();
}

export {
  getRelationLabel,
  establishTradeRoute,
  cancelTradeRoute,
  renderDiplomacyPanel,
  renderDiplomacyList,
  renderRankingsView,
  openChat,
  renderDiplomacyActions,
  renderChatMarkdown,
  updateDiploActions,
  appendChatMessage,
  appendChatAction,
  sendChatMessage,
  showDiplomacyProposal,
  processCharacterAction,
};

// --- Chat event listeners ---
document.getElementById('chat-send').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});
