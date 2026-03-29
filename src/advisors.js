// ============================================
// ENHANCED ADVISORS — LLM-Powered Royal Council
// ============================================
// Each advisor is a specialised AI persona the player can consult.
// One advisor consultation per turn (or two if research unlocks it).
// Advisors are queried via the same /api/chat backend but with
// a different character_id that maps to advisor-specific system prompts.

import { FACTIONS, FACTION_TRAITS, TECHNOLOGIES, CIVICS } from './constants.js';
import { game, API } from './state.js';
import { getRelationLabel } from './diplomacy-api.js';
import { getComparisonData } from './map.js';
import { showToast } from './events.js';

// ── Advisor Definitions ──
const ADVISORS = {
  military: {
    id: 'advisor_military',
    name: 'Marshal Ironhelm',
    title: 'Military Advisor',
    icon: '\u2694\uFE0F',
    color: '#e74c3c',
    desc: 'Troop deployments, military threats, combat strategy, unit composition',
    personality: 'A grizzled veteran commander. Blunt, strategic, thinks in terms of force projection and defensive perimeters. Speaks in short, decisive sentences. Values strength and preparation.',
  },
  economic: {
    id: 'advisor_economic',
    name: 'Chancellor Goldweave',
    title: 'Economic Advisor',
    icon: '\uD83D\uDCB0',
    color: '#f39c12',
    desc: 'Trade routes, resource management, city production, gold income',
    personality: 'A sharp-eyed merchant-turned-statesman. Sees everything through the lens of efficiency and profit. Loves numbers, hates waste. Occasionally cracks dry jokes about budgets.',
  },
  diplomatic: {
    id: 'advisor_diplomatic',
    name: 'Envoy Silvertongue',
    title: 'Diplomatic Advisor',
    icon: '\uD83E\uDD1D',
    color: '#3498db',
    desc: 'Alliances, faction relations, treaties, intelligence gathering, gossip',
    personality: 'A suave spymaster-diplomat who knows everyone\'s secrets. Speaks in allusions and careful suggestions. Always has "a friend" who heard something interesting. Values information over gold.',
  },
  science: {
    id: 'advisor_science',
    name: 'Sage Brightmind',
    title: 'Science Advisor',
    icon: '\uD83D\uDD2C',
    color: '#2ecc71',
    desc: 'Technology research, eureka conditions, tech strategy, innovation paths',
    personality: 'An enthusiastic polymath who gets excited about discovery. Thinks long-term and sees technology as the key to everything. Occasionally goes on tangents about fascinating inventions.',
  },
  cultural: {
    id: 'advisor_cultural',
    name: 'Muse Starweaver',
    title: 'Cultural Advisor',
    icon: '\uD83C\uDFAD',
    color: '#9b59b6',
    desc: 'Civics, wonders, great people, cultural victory, city development',
    personality: 'A passionate artist and philosopher who sees civilisation as a canvas. Speaks poetically but practically. Believes cultural legacy outlasts any army. Values beauty and wisdom.',
  },
};

// ── State ──
let currentAdvisor = null;
let conversationHistory = [];  // per-session history with current advisor
let consultationsUsed = 0;
let consultationsPerTurn = 1;  // increases with research
let lastConsultTurn = -1;
let isWaitingForResponse = false;

// ── Turn tracking ──
export function resetAdvisorConsultations() {
  // Called at start of each turn
  if (!game) return;
  if (game.turn !== lastConsultTurn) {
    consultationsUsed = 0;
    lastConsultTurn = game.turn;
    // Check if player has unlocked extra consultations
    consultationsPerTurn = 1;
    if (game.techs && game.techs.includes('writing')) consultationsPerTurn = 2;
    if (game.techs && game.techs.includes('philosophy')) consultationsPerTurn = 3;
  }
}

// ============================================
// PUBLIC API
// ============================================

// ── Track whether #chat-panel is in advisor mode ──
let _advisorChatActive = false;
let _advisorInputHandler = null;
let _advisorSendHandler = null;

/**
 * Check if chat-panel is currently showing an advisor conversation.
 */
export function isAdvisorChatActive() { return _advisorChatActive; }

/**
 * Render the advisor panel — shows the advisor selection grid.
 * Clicking a card opens the RIGHT-SIDE #chat-panel (same as diplomacy chat).
 */
export function renderAdvisorPanel() {
  const container = document.getElementById('advisor-body');
  if (!container) return;
  resetAdvisorConsultations();
  container.innerHTML = renderAdvisorSelection();
  bindAdvisorSelectionEvents();
}

/**
 * Open a specific advisor's chat in the RIGHT-SIDE #chat-panel.
 * This mirrors how openChat() works for faction leaders.
 */
export function openAdvisor(advisorKey) {
  if (!ADVISORS[advisorKey]) return;
  currentAdvisor = advisorKey;
  conversationHistory = [];
  _advisorChatActive = true;

  const adv = ADVISORS[advisorKey];

  // Populate the shared chat panel header
  const portrait = document.getElementById('chat-portrait');
  const name = document.getElementById('chat-name');
  const title = document.getElementById('chat-title');
  if (portrait) portrait.textContent = adv.icon;
  if (name) { name.textContent = adv.name; name.style.color = adv.color; }
  if (title) title.textContent = adv.title;

  // Hide diplo actions (not relevant for advisors)
  const diploActions = document.getElementById('diplo-actions');
  if (diploActions) diploActions.innerHTML = '';

  // Update input placeholder
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.placeholder = `Ask ${adv.name}...`;
    chatInput.value = '';
    chatInput.disabled = false;
  }

  // Render initial messages (greeting + quick suggestions)
  renderAdvisorChatMessages();

  // Bind send events to advisor handler (replacing diplomacy handlers)
  bindAdvisorChatToPanel();

  // Show the chat panel on the right (same as diplomacy)
  const chatPanel = document.getElementById('chat-panel');
  if (chatPanel) chatPanel.style.display = 'flex';

  // Focus the input
  if (chatInput) setTimeout(() => chatInput.focus(), 100);
}

/**
 * Close the advisor chat (called when chat-panel is closed).
 */
export function closeAdvisorChat() {
  _advisorChatActive = false;
  currentAdvisor = null;
  conversationHistory = [];
  unbindAdvisorChatFromPanel();
}

/**
 * Send a message to the current advisor (uses the shared #chat-panel).
 */
export async function sendAdvisorMessage(message) {
  if (!currentAdvisor || isWaitingForResponse) return;
  if (!message || !message.trim()) return;

  resetAdvisorConsultations();
  if (consultationsUsed >= consultationsPerTurn) {
    showToast('Advisors Busy', `Your advisors can only meet ${consultationsPerTurn} time${consultationsPerTurn > 1 ? 's' : ''} per turn. End your turn to consult again.`, 3000);
    return;
  }

  const adv = ADVISORS[currentAdvisor];
  const userMsg = message.trim();

  // Add user message to history and render
  conversationHistory.push({ role: 'user', content: userMsg });
  renderAdvisorChatMessages();

  // Show typing indicator
  isWaitingForResponse = true;
  const chatInput = document.getElementById('chat-input');
  if (chatInput) chatInput.disabled = true;
  renderAdvisorChatMessages();

  try {
    const response = await callAdvisorAPI(adv, userMsg);
    conversationHistory.push({ role: 'assistant', content: response });
    consultationsUsed++;
  } catch (err) {
    conversationHistory.push({
      role: 'assistant',
      content: `*${adv.name} seems distracted...* I apologise, my liege — I was momentarily lost in thought. Could you repeat that? (Connection issue)`,
    });
  }

  isWaitingForResponse = false;
  if (chatInput) chatInput.disabled = false;
  renderAdvisorChatMessages();

  // Update remaining count + re-focus input
  if (chatInput) chatInput.focus();
}

// ============================================
// ADVISOR SELECTION VIEW
// ============================================

function renderAdvisorSelection() {
  let html = '';
  const remaining = consultationsPerTurn - consultationsUsed;

  html += `<div style="padding:10px 14px;">`;
  html += `<div style="color:#ffd700;font-size:14px;font-weight:bold;margin-bottom:4px;">\uD83D\uDC51 Your Royal Council</div>`;
  html += `<div style="color:#888;font-size:11px;margin-bottom:12px;">`;
  html += `Consultations remaining this turn: <span style="color:${remaining > 0 ? '#ffd700' : '#f44'};">${remaining}/${consultationsPerTurn}</span>`;
  if (consultationsPerTurn < 3) {
    html += ` \u2022 <span style="color:#666;">Research ${consultationsPerTurn < 2 ? 'Writing' : 'Philosophy'} for more</span>`;
  }
  html += '</div>';

  for (const [key, adv] of Object.entries(ADVISORS)) {
    const canConsult = remaining > 0;
    html += `<div class="advisor-card" data-advisor="${key}" style="`;
    html += `background:rgba(30,30,40,0.8);border:2px solid ${canConsult ? 'rgba(201,168,76,0.3)' : 'rgba(100,100,100,0.2)'};`;
    html += `border-radius:8px;padding:12px 14px;margin-bottom:8px;cursor:${canConsult ? 'pointer' : 'default'};`;
    html += `opacity:${canConsult ? '1' : '0.5'};transition:all 0.2s ease;`;
    html += `${canConsult ? 'box-shadow:0 0 0 0 rgba(201,168,76,0);' : ''}">`;
    html += `<div style="display:flex;align-items:center;gap:12px;">`;
    html += `<span style="font-size:28px;width:36px;text-align:center;">${adv.icon}</span>`;
    html += `<div style="flex:1;">`;
    html += `<div style="color:${adv.color};font-weight:bold;font-size:14px;">${adv.name}</div>`;
    html += `<div style="color:#ccc;font-size:11px;">${adv.title}</div>`;
    html += `<div style="color:#888;font-size:10px;margin-top:3px;">${adv.desc}</div>`;
    html += `</div>`;
    html += `<span style="color:${canConsult ? '#ffd700' : '#555'};font-size:16px;">&#9656;</span>`;
    html += `</div>`;
    html += `</div>`;
  }
  html += '</div>';
  return html;
}

function bindAdvisorSelectionEvents() {
  document.querySelectorAll('.advisor-card').forEach(el => {
    el.addEventListener('click', () => {
      resetAdvisorConsultations();
      if (consultationsUsed >= consultationsPerTurn) {
        showToast('Advisors Busy', 'No consultations remaining this turn.', 2000);
        return;
      }
      openAdvisor(el.dataset.advisor);
    });
    // Hover effects — glow + border to make clickability obvious
    el.addEventListener('mouseenter', () => {
      el.style.borderColor = 'rgba(201,168,76,0.7)';
      el.style.background = 'rgba(201,168,76,0.08)';
      el.style.boxShadow = '0 0 12px rgba(201,168,76,0.15)';
      el.style.transform = 'translateX(2px)';
    });
    el.addEventListener('mouseleave', () => {
      el.style.borderColor = 'rgba(201,168,76,0.3)';
      el.style.background = 'rgba(30,30,40,0.8)';
      el.style.boxShadow = 'none';
      el.style.transform = 'none';
    });
  });
}

// ============================================
// ADVISOR CHAT — renders into the shared #chat-panel
// ============================================

/**
 * Render advisor conversation messages into #chat-messages
 * Uses the same .chat-msg CSS classes as diplomacy chat for consistency.
 */
function renderAdvisorChatMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const adv = ADVISORS[currentAdvisor];
  if (!adv) return;

  const remaining = consultationsPerTurn - consultationsUsed;
  let html = '';

  // Status bar at top
  html += `<div style="text-align:center;padding:4px 0;margin-bottom:8px;font-size:10px;color:#888;border-bottom:1px solid rgba(201,168,76,0.15);">`;
  html += `Consultations: <span style="color:${remaining > 0 ? '#ffd700' : '#f44'};">${remaining}/${consultationsPerTurn}</span>`;
  if (consultationsPerTurn < 3) {
    html += ` · Research ${consultationsPerTurn < 2 ? 'Writing' : 'Philosophy'} for more`;
  }
  html += '</div>';

  // Opening greeting
  if (conversationHistory.length === 0) {
    html += `<div class="chat-msg" style="align-self:flex-start;background:rgba(${hexToRgb(adv.color)},0.12);border-left:3px solid ${adv.color};">`;
    html += `<div style="color:${adv.color};font-size:11px;font-weight:bold;margin-bottom:4px;">${adv.icon} ${adv.name}</div>`;
    html += `<div style="color:#ddd;">My liege, I am at your service. What would you have me counsel you on?</div>`;
    html += '</div>';

    // Quick suggestions
    const suggestions = getQuickSuggestions(currentAdvisor);
    html += `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0;">`;
    for (const s of suggestions) {
      html += `<span class="advisor-suggestion" data-msg="${escapeHtml(s)}" style="padding:4px 10px;border-radius:14px;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.25);color:#c9a84c;font-size:11px;cursor:pointer;transition:all 0.15s;">${s}</span>`;
    }
    html += '</div>';
  }

  // Conversation messages
  for (const msg of conversationHistory) {
    if (msg.role === 'user') {
      html += `<div class="chat-msg" style="align-self:flex-end;background:rgba(201,168,76,0.12);border-right:3px solid #ffd700;">`;
      html += `<div style="color:#ddd;">${escapeHtml(msg.content)}</div>`;
      html += '</div>';
    } else {
      html += `<div class="chat-msg" style="align-self:flex-start;background:rgba(${hexToRgb(adv.color)},0.12);border-left:3px solid ${adv.color};">`;
      html += `<div style="color:${adv.color};font-size:11px;font-weight:bold;margin-bottom:4px;">${adv.icon} ${adv.name}</div>`;
      html += `<div style="color:#ddd;">${formatAdvisorResponse(msg.content)}</div>`;
      html += '</div>';
    }
  }

  // Typing indicator
  if (isWaitingForResponse) {
    html += `<div class="chat-msg" style="align-self:flex-start;background:rgba(${hexToRgb(adv.color)},0.12);border-left:3px solid ${adv.color};">`;
    html += `<div style="color:${adv.color};font-size:11px;font-weight:bold;margin-bottom:4px;">${adv.icon} ${adv.name}</div>`;
    html += `<div style="color:#888;font-style:italic;">Thinking...</div>`;
    html += '</div>';
  }

  container.innerHTML = html;

  // Bind quick suggestion clicks
  container.querySelectorAll('.advisor-suggestion').forEach(el => {
    el.onclick = () => {
      const msg = el.dataset.msg;
      const chatInput = document.getElementById('chat-input');
      if (chatInput) chatInput.value = '';
      sendAdvisorMessage(msg);
    };
    el.addEventListener('mouseenter', () => { el.style.background = 'rgba(201,168,76,0.25)'; el.style.color = '#ffd700'; });
    el.addEventListener('mouseleave', () => { el.style.background = 'rgba(201,168,76,0.1)'; el.style.color = '#c9a84c'; });
  });

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

/**
 * Bind the shared #chat-input and #chat-send to advisor message handling.
 * We store references so we can unbind later when the panel closes.
 */
function bindAdvisorChatToPanel() {
  unbindAdvisorChatFromPanel(); // clean up any prior bindings

  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');

  _advisorInputHandler = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      const val = chatInput.value;
      chatInput.value = '';
      sendAdvisorMessage(val);
    }
  };

  _advisorSendHandler = () => {
    const val = chatInput.value;
    chatInput.value = '';
    sendAdvisorMessage(val);
  };

  if (chatInput) chatInput.addEventListener('keydown', _advisorInputHandler);
  if (chatSend) chatSend.addEventListener('click', _advisorSendHandler);

  // Update char count on input
  const charCount = document.getElementById('chat-char-count');
  if (chatInput && charCount) {
    chatInput.addEventListener('input', () => {
      charCount.textContent = `${chatInput.value.length}/500`;
    });
  }
}

/**
 * Unbind advisor handlers from the shared chat panel.
 */
function unbindAdvisorChatFromPanel() {
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');

  if (_advisorInputHandler && chatInput) {
    chatInput.removeEventListener('keydown', _advisorInputHandler);
  }
  if (_advisorSendHandler && chatSend) {
    chatSend.removeEventListener('click', _advisorSendHandler);
  }
  _advisorInputHandler = null;
  _advisorSendHandler = null;
}

// ============================================
// API CALL
// ============================================

async function callAdvisorAPI(advisor, userMessage) {
  // Build DOMAIN-SPECIFIC context for this advisor
  const advisorKey = Object.keys(ADVISORS).find(k => ADVISORS[k].id === advisor.id) || '';
  const gameContext = buildDomainContext(advisorKey);
  const systemPrompt = buildAdvisorSystemPrompt(advisor, advisorKey, gameContext);

  // Use /api/advisor endpoint if available, else /api/chat with system_override
  const payload = {
    character_id: advisor.id,
    message: userMessage,
    game_state: gameContext,
    conversation_history: conversationHistory.slice(0, -1).map(m => ({
      role: m.role,
      content: m.content,
    })),
    system_override: systemPrompt,
    is_advisor: true, // Signal to backend this is an advisor, not a faction leader
  };

  try {
    // Try advisor-specific endpoint first
    let resp = await fetch(`${API}/api/advisor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Fall back to /api/chat if /api/advisor doesn't exist
    if (resp.status === 404) {
      resp = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (!resp.ok) {
      return generateLocalAdvisorResponse(advisorKey, userMessage, gameContext);
    }

    const data = await resp.json();
    let reply = data.reply || data.response || data.message || '';
    // Strip faction-leader artifacts from the response
    reply = reply.replace(/\[ACTION:.*?\]/gs, '').trim();
    reply = reply.replace(/^\*.*?enters the room.*?\*\s*/i, ''); // Strip RP entrance
    return reply || generateLocalAdvisorResponse(advisorKey, userMessage, gameContext);
  } catch (err) {
    return generateLocalAdvisorResponse(advisorKey, userMessage, gameContext);
  }
}

// ============================================
// LOCAL FALLBACK — Rule-Based Advisor Responses
// ============================================
// If the backend API is unavailable or doesn't handle advisor characters,
// generate useful advice from game state alone.

function generateLocalAdvisorResponse(key, question, context) {
  const q = question.toLowerCase();

  switch (key) {
    case 'military': return generateMilitaryAdvice(q, context);
    case 'economic': return generateEconomicAdvice(q, context);
    case 'diplomatic': return generateDiplomaticAdvice(q, context);
    case 'science': return generateScienceAdvice(q, context);
    case 'cultural': return generateCulturalAdvice(q, context);
    default: return 'I shall look into this matter, my liege. Give me a moment to gather my thoughts.';
  }
}

function generateMilitaryAdvice(q, ctx) {
  // Marshal Ironhelm — blunt, strategic, speaks in short decisive sentences
  const threats = (ctx.factionThreats || []).filter(t => t.military > (ctx.military || 0));
  const dangerous = threats.filter(t => t.military > (ctx.military || 0) * 1.3);
  const units = ctx.unitBreakdown || {};
  const unitList = Object.entries(units).map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`).join(', ') || 'no combat units';

  // Parse question for targeted answers
  if (q.includes('threat') || q.includes('danger') || q.includes('who')) {
    if (dangerous.length > 0) {
      return `Sire, we face ${dangerous.length} serious threat${dangerous.length > 1 ? 's' : ''}. ${dangerous.map(t => `**${t.name}** fields strength ${t.military} against our ${ctx.military} — relations sit at ${t.relation}`).join('. ')}. I'd fortify our borders and raise more troops immediately.`;
    }
    return `My liege, no faction currently overpowers us. Our strength stands at ${ctx.military}. Stay vigilant — complacency kills more armies than swords.`;
  }

  if (q.includes('build') || q.includes('troops') || q.includes('recruit') || q.includes('army')) {
    if (ctx.totalCombatUnits < 4) {
      return `We're dangerously thin, sire — only ${ctx.totalCombatUnits} combat units. I need at least 6 before I'll sleep soundly. Prioritise warriors or archers from your strongest production city.`;
    }
    if (dangerous.length > 0) {
      return `We have ${ctx.totalCombatUnits} combat units (${unitList}), but ${dangerous[0].name} outguns us. Build more ranged units — they're the difference between winning and bleeding.`;
    }
    return `${ctx.totalCombatUnits} combat units (${unitList}). Adequate for now, sire. I'd focus production elsewhere unless a new threat emerges.`;
  }

  if (q.includes('attack') || q.includes('strike') || q.includes('war')) {
    const weak = (ctx.factionThreats || []).filter(t => t.military < (ctx.military || 0) * 0.7 && t.relation < 0);
    if (weak.length > 0) {
      return `If blood must be spilled, ${weak[0].name} is weakest — military ${weak[0].military} against our ${ctx.military}. Strike fast before they recover. But know this: war has costs beyond gold.`;
    }
    return `No easy targets, sire. All known factions are either too strong or too friendly. Build strength first. A wise commander chooses when to fight.`;
  }

  if (q.includes('defen') || q.includes('fortif') || q.includes('protect')) {
    return `Defense rating: ${ctx.defense}. We have ${ctx.fortifiedUnits} fortified units. ${ctx.woundedUnits > 0 ? `${ctx.woundedUnits} units need healing — pull them back.` : 'All units combat-ready.'} ${ctx.barbarianCamps > 0 ? `${ctx.barbarianCamps} barbarian camps threaten our borders — clearing them earns goodwill with nearby factions.` : 'No barbarian threats nearby.'}`;
  }

  // General overview
  let r = `Sire, the military stands at strength ${ctx.military} with ${ctx.totalCombatUnits} combat units: ${unitList}. `;
  if (ctx.woundedUnits > 0) r += `${ctx.woundedUnits} wounded — get them behind walls. `;
  if (dangerous.length > 0) {
    r += `**Warning**: ${dangerous.map(t => t.name).join(' and ')} ${dangerous.length > 1 ? 'outmatch' : 'outmatches'} us. `;
  }
  if (ctx.barbarianCamps > 0) r += `${ctx.barbarianCamps} barbarian camps active — easy targets for veteran troops. `;
  if (ctx.activeWars.length > 0) r += `${ctx.activeWars.length} war${ctx.activeWars.length > 1 ? 's' : ''} rage between other factions — opportunity knocks.`;
  return r;
}

function generateEconomicAdvice(q, ctx) {
  // Chancellor Goldweave — sharp, efficiency-obsessed, dry humour about budgets
  const gold = ctx.gold || 0;
  const gpt = ctx.goldPerTurn || 0;
  const cities = ctx.cityDetails || [];
  const upkeep = ctx.militaryUpkeep || 0;

  if (q.includes('spend') || q.includes('too much') || q.includes('upkeep') || q.includes('expensive')) {
    if (upkeep > gpt + 5) {
      return `Your majesty, our military costs approximately ${upkeep}g per turn against income of ${gpt}g. We're funding an army with hopes and prayers. Either disband units or build markets — preferably both.`;
    }
    return `Military upkeep runs about ${upkeep}g against ${gpt}g income. The books balance, sire. For now. I always recommend a rainy-day fund — wars are expensive surprises.`;
  }

  if (q.includes('build') || q.includes('next') || q.includes('produce') || q.includes('construct')) {
    const idle = cities.filter(c => c.building === 'idle');
    if (idle.length > 0) {
      return `Sire! ${idle.map(c => c.name).join(' and ')} ${idle.length > 1 ? 'are' : 'is'} sitting idle — that's gold evaporating. Markets boost income, granaries boost growth. Every idle turn is wasted potential. I weep.`;
    }
    const lowest = [...cities].sort((a, b) => a.production - b.production)[0];
    if (lowest) {
      return `All cities are producing, good. ${lowest.name} has the weakest output at ${lowest.production}/turn — consider a workshop or more improvements around it. Efficiency, sire, efficiency.`;
    }
    return `All cities are busy. Focus improvements around your highest-population city for maximum return on investment.`;
  }

  if (q.includes('gold') || q.includes('earn') || q.includes('income') || q.includes('money') || q.includes('trade')) {
    let r = `Treasury: ${gold}g, income ${gpt > 0 ? '+' : ''}${gpt}g/turn. Trade routes active: ${ctx.totalTradeRoutes}. `;
    if (ctx.totalTradeRoutes < cities.length) {
      r += `We could run ${cities.length - ctx.totalTradeRoutes} more trade routes — free gold, sire. Every caravan is a moving mint.`;
    } else {
      r += `Trade is maxed. Focus on markets, harbours, and commercial buildings to grow the base.`;
    }
    return r;
  }

  // General overview
  let r = `My liege, the ledger reads: ${gold}g in treasury, ${gpt > 0 ? '+' : ''}${gpt}g per turn. `;
  if (gpt < 0) r += `We're haemorrhaging coin — military upkeep is ~${upkeep}g. Something must give. `;
  else if (gpt < 5) r += 'Modest income. Markets and trade routes are the cure. ';
  else r += 'The coffers are healthy. ';
  r += `${cities.length} ${cities.length === 1 ? 'city' : 'cities'}, ${ctx.workers} worker${ctx.workers !== 1 ? 's' : ''}, ${ctx.improvements} improvements. `;
  if (cities.length < 3) r += 'Founding more cities is the single best investment — settlers pay for themselves within 10 turns.';
  return r;
}

function generateDiplomaticAdvice(q, ctx) {
  // Envoy Silvertongue — suave spymaster, allusions, "a friend heard something"
  const rels = ctx.relationships || {};
  const names = Object.keys(rels);
  const friends = names.filter(n => rels[n].score > 20);
  const enemies = names.filter(n => rels[n].score < -20);
  const rumours = ctx.recentRumours || [];

  if (q.includes('ally') || q.includes('alliance') || q.includes('friend')) {
    if (friends.length > 0) {
      const best = friends.sort((a, b) => rels[b].score - rels[a].score)[0];
      return `A friend of mine suggests ${best} would be our most reliable partner — relations at ${rels[best].score}, ${rels[best].hasEmbassy ? 'embassy established' : 'no embassy yet'}. ${rels[best].hasAlliance ? 'We are already allied.' : 'An alliance would strengthen both our positions.'} ${friends.length > 1 ? `Other warm relations: ${friends.filter(f => f !== best).join(', ')}.` : ''}`;
    }
    return `Your majesty, I regret to say we have no strong friends yet. Diplomacy requires patience — send envoys, establish embassies, offer open borders. Trust is built turn by turn, not overnight.`;
  }

  if (q.includes('gossip') || q.includes('rumour') || q.includes('intel') || q.includes('spy')) {
    if (rumours.length > 0) {
      return `*leans in* My network has picked up ${rumours.length} whisper${rumours.length > 1 ? 's' : ''}. The latest: "${rumours[rumours.length - 1]}". ${ctx.gossipPoints > 0 ? `We have ${ctx.gossipPoints} gossip points to spend on more intelligence.` : 'Our gossip reserves are depleted — establish more embassies to rebuild them.'}`;
    }
    return `My sources are quiet, sire. ${ctx.gossipPoints > 0 ? `We have ${ctx.gossipPoints} gossip points — visit the Intelligence panel to purchase rumours.` : 'No gossip points available. Embassies are the lifeblood of any spy network.'}`;
  }

  if (q.includes('war') || q.includes('conflict') || q.includes('fight')) {
    if (ctx.activeWars.length > 0) {
      return `The world burns, sire. ${ctx.activeWars.join('; ')}. When two powers bleed each other, the wise third party prospers. Consider who you might approach with a trade deal while they're distracted.`;
    }
    return `Peace reigns — for now. No active wars between other factions. But peace is merely the pause between conflicts. Stay prepared.`;
  }

  if (q.includes('danger') || q.includes('enemy') || q.includes('hostile') || q.includes('threat')) {
    if (enemies.length > 0) {
      return `${enemies.join(' and ')} ${enemies.length > 1 ? 'view' : 'views'} us with hostility. ${enemies.map(e => `${e}: ${rels[e].status} (${rels[e].score}), military ${rels[e].military}`).join('. ')}. I recommend either charm offensives — gifts, open borders — or ensuring the Marshal has enough swords at the ready.`;
    }
    return `No outright enemies, your majesty. A rare luxury. Let us keep it that way through careful diplomacy and timely gifts.`;
  }

  // General overview
  let r = `Your majesty, we've made contact with ${ctx.factionsDiscovered} of ${ctx.totalFactions} factions. `;
  if (friends.length > 0) r += `Warm relations with ${friends.join(', ')}. `;
  if (enemies.length > 0) r += `Tension with ${enemies.join(', ')}. `;
  r += `Embassies: ${ctx.embassyCount}. `;
  if (ctx.activeWars.length > 0) r += `${ctx.activeWars.length} war${ctx.activeWars.length > 1 ? 's' : ''} among other factions — opportunity for the astute. `;
  if (rumours.length > 0) r += `I have ${rumours.length} fresh whisper${rumours.length > 1 ? 's' : ''} — check the Intelligence panel for details.`;
  return r;
}

function generateScienceAdvice(q, ctx) {
  // Sage Brightmind — enthusiastic polymath, long-term thinker, tangent-prone
  const progress = ctx.currentResearch;
  const available = ctx.availableTechs || [];
  const eurekas = ctx.eurekaHints || [];

  if (q.includes('research') || q.includes('what should') || q.includes('next') || q.includes('recommend')) {
    if (!ctx.hasWriting) {
      return `Oh, your majesty — Writing! Writing must be our priority! It unlocks libraries, extra advisor consultations, and frankly it's embarrassing to run a civilisation without it. The pen truly is mightier than the sword. Well, almost.`;
    }
    if (!ctx.hasCurrency) {
      return `Sire, Currency should be next — it unlocks markets and trade routes. Gold flows where knowledge leads, as I always say! ${progress ? `We're ${progress.pct}% through ${progress.name} first, though.` : ''}`;
    }
    if (available.length > 0) {
      const top = available[0];
      return `I'd suggest ${top.name} (cost ${top.cost}). ${available.length > 1 ? `Other options: ${available.slice(1, 3).map(t => t.name).join(', ')}.` : ''} ${eurekas.length > 0 ? `Fascinating aside — we could trigger a eureka for ${eurekas[0].tech}: ${eurekas[0].hint}!` : ''}`;
    }
    return `We're well advanced, sire! Continue the current path and the future belongs to us.`;
  }

  if (q.includes('eureka') || q.includes('boost') || q.includes('shortcut') || q.includes('discover')) {
    if (eurekas.length > 0) {
      let r = `Oh, delightful — I've identified ${eurekas.length} eureka opportunit${eurekas.length > 1 ? 'ies' : 'y'}! `;
      for (const e of eurekas) r += `**${e.tech}**: ${e.hint}. `;
      r += 'Each eureka halves the research cost. Wonderful efficiency!';
      return r;
    }
    return `No immediate eureka opportunities that I can see, sire. But keep exploring and building — discoveries often come when you least expect them!`;
  }

  if (q.includes('behind') || q.includes('ahead') || q.includes('compare') || q.includes('how far')) {
    return `We've researched ${ctx.techsResearched} of ${ctx.totalTechs} technologies at ${ctx.sciencePerTurn} science per turn. ${ctx.sciencePerTurn < 10 ? 'Frankly, sire, our science output is anaemic. Libraries and campuses would transform our progress.' : ctx.sciencePerTurn > 25 ? 'Excellent output! We\'re a beacon of knowledge.' : 'Solid output, but there\'s room to grow with more campus buildings.'}`;
  }

  // General overview
  let r = `Your majesty! ${ctx.techsResearched} of ${ctx.totalTechs} technologies mastered, producing ${ctx.sciencePerTurn} science per turn. `;
  if (progress) r += `Currently researching ${progress.name} — ${progress.pct}% complete. `;
  if (!ctx.hasWriting) r += '**Writing should be our top priority** — it unlocks so much! ';
  else if (!ctx.hasPhilosophy) r += 'Philosophy would be a fine next goal — extra consultations and cultural depth. ';
  if (eurekas.length > 0) r += `I've spotted ${eurekas.length} eureka shortcut${eurekas.length > 1 ? 's' : ''} — ask me about them!`;
  return r;
}

function generateCulturalAdvice(q, ctx) {
  // Muse Starweaver — passionate, poetic but practical, believes culture outlasts armies
  const cpt = ctx.culturePerTurn || 0;
  const wonders = ctx.wonders || [];

  if (q.includes('wonder') || q.includes('monument') || q.includes('build')) {
    if (wonders.length > 0) {
      return `We have raised ${wonders.length} wonder${wonders.length > 1 ? 's' : ''} to the sky, sire — ${wonders.join(', ')}. Monuments to our greatness! ${ctx.builtWondersGlobal} wonders have been claimed worldwide. Every unclaimed wonder is a story waiting for us to write it.`;
    }
    return `No wonders yet, your majesty. This saddens me deeply. Wonders are the soul of a civilisation — they inspire your people and intimidate your rivals. Prioritise one when your production allows it.`;
  }

  if (q.includes('culture') || q.includes('how') || q.includes('output') || q.includes('progress')) {
    let r = `Our cultural heartbeat: ${cpt} culture per turn. ${ctx.culture} accumulated. `;
    if (cpt < 5) r += 'Sire, our culture is barely a whisper. Temples, amphitheatres, monuments — our people crave beauty and meaning. ';
    else if (cpt > 15) r += 'A flourishing tapestry! Our influence radiates across the land. ';
    else r += 'Growing steadily, but with investment we could become a cultural beacon. ';
    r += `Civics adopted: ${ctx.civicsAdopted}. ${ctx.currentCivic ? `Studying: ${ctx.currentCivic}.` : 'No civic in progress — that must change!'}`;
    return r;
  }

  if (q.includes('great') || q.includes('people') || q.includes('person') || q.includes('artist')) {
    return `We have attracted ${ctx.greatPeople} Great ${ctx.greatPeople === 1 ? 'Person' : 'People'}, sire. Each one is worth a hundred ordinary citizens — they create works that echo through the ages. Build cultural districts and wonders to attract more of these luminaries.`;
  }

  if (q.includes('victory') || q.includes('win') || q.includes('path') || q.includes('strategy')) {
    return `The cultural victory path demands wonders, great works, and relentless cultural output. At ${cpt}/turn, ${cpt > 20 ? 'we are on a strong trajectory' : 'we need significantly more investment'}. Temples, amphitheatres, and above all — wonders. Let our rivals fight over scraps of land while we capture their hearts and minds.`;
  }

  // General overview
  let r = `Your majesty, our civilisation's soul: ${cpt} culture per turn, ${ctx.civicsAdopted} civics adopted, ${wonders.length} wonder${wonders.length !== 1 ? 's' : ''} built. `;
  if (ctx.greatPeople > 0) r += `${ctx.greatPeople} Great People grace our realm. `;
  if (ctx.inspirations > 0) r += `${ctx.inspirations} inspiration${ctx.inspirations > 1 ? 's' : ''} await — these halve civic costs. `;
  r += 'Culture is the legacy that outlasts every army, sire. Invest in beauty, and history will remember us.';
  return r;
}

// ============================================
// CONTEXT BUILDERS
// ============================================

// ============================================
// DOMAIN-SPECIFIC CONTEXT BUILDERS
// ============================================
// Each advisor gets different game data relevant to their domain.

function buildDomainContext(advisorKey) {
  const base = {
    turn: game.turn,
    gold: game.gold,
    goldPerTurn: game.goldPerTurn,
    cities: (game.cities || []).length,
  };

  switch (advisorKey) {
    case 'military': {
      const units = game.units ? game.units.filter(u => u.owner === 'player') : [];
      const combat = units.filter(u => u.class !== 'civilian' && u.class !== 'worker');
      const unitBreakdown = {};
      combat.forEach(u => { unitBreakdown[u.type] = (unitBreakdown[u.type] || 0) + 1; });
      const threats = [];
      for (const [fid, stats] of Object.entries(game.factionStats || {})) {
        if ((game.metFactions || {})[fid]) {
          const rel = game.relationships?.[fid] || 0;
          threats.push({ name: FACTIONS[fid]?.name || fid, military: stats.military || 0, relation: rel });
        }
      }
      threats.sort((a, b) => b.military - a.military);
      return {
        ...base,
        military: game.military || 0,
        defense: game.defense || 0,
        totalCombatUnits: combat.length,
        unitBreakdown,
        woundedUnits: combat.filter(u => u.hp < 80).length,
        fortifiedUnits: combat.filter(u => u.fortified).length,
        factionThreats: threats,
        activeWars: (game.aiWars || []).map(w => ({
          attacker: FACTIONS[w.attacker]?.name || w.attacker,
          defender: FACTIONS[w.defender]?.name || w.defender,
          turns: w.turnsActive || 0,
        })),
        barbarianCamps: (game.minorFactions || []).filter(mf => mf.type === 'barbarian' && !mf.cleared).length,
      };
    }
    case 'economic': {
      const cities = game.cities || [];
      const cityData = cities.map(c => ({
        name: c.name,
        population: c.population || 0,
        production: c.productionPerTurn || 0,
        building: c.currentBuild?.name || 'idle',
        tradeRoutes: c.tradeRoutes?.length || 0,
      }));
      return {
        ...base,
        goldPerTurn: game.goldPerTurn || 0,
        sciencePerTurn: game.sciencePerTurn || 0,
        culturePerTurn: game.culturePerTurn || 0,
        population: game.population || 0,
        foodPerTurn: game.foodPerTurn || 0,
        cityDetails: cityData,
        totalTradeRoutes: cities.reduce((s, c) => s + (c.tradeRoutes?.length || 0), 0),
        improvements: (game.improvements || []).length,
        workers: (game.units || []).filter(u => u.owner === 'player' && u.type === 'worker').length,
        militaryUpkeep: (game.units || []).filter(u => u.owner === 'player' && u.class !== 'civilian').length * 2,
      };
    }
    case 'diplomatic': {
      const met = Object.keys(game.metFactions || {});
      const relationships = {};
      for (const fid of met) {
        const rel = game.relationships?.[fid] || 0;
        const label = getRelationLabel(rel);
        const stats = game.factionStats?.[fid] || {};
        relationships[FACTIONS[fid]?.name || fid] = {
          score: rel,
          status: label.text,
          type: FACTIONS[fid]?.type || 'unknown',
          military: stats.military || '?',
          hasAlliance: !!game.activeAlliances?.[fid],
          hasOpenBorders: !!game.openBorders?.[fid],
          hasEmbassy: !!game.embassies?.[fid],
        };
      }
      const rumours = (game.rumourQueue || []).filter(r => r.revealTurn <= game.turn);
      return {
        ...base,
        factionsDiscovered: met.length,
        totalFactions: Object.keys(FACTIONS).length,
        relationships,
        activeWars: (game.aiWars || []).map(w => `${FACTIONS[w.attacker]?.name} vs ${FACTIONS[w.defender]?.name}`),
        alliances: (game.aiAlliances || []).map(a => `${FACTIONS[a.factionA]?.name} & ${FACTIONS[a.factionB]?.name}`),
        tradeDeals: (game.aiTradeDeals || []).length,
        recentRumours: rumours.slice(-5).map(r => r.text),
        gossipPoints: game.gossipPoints || 0,
        embassyCount: Object.keys(game.embassies || {}).length,
      };
    }
    case 'science': {
      const techs = game.techs || [];
      const allTechs = TECHNOLOGIES || [];
      const available = allTechs.filter(t => !techs.includes(t.id));
      const current = game.currentResearch;
      let currentProgress = null;
      if (current) {
        const tech = allTechs.find(t => t.id === current);
        if (tech) currentProgress = { name: tech.name, pct: Math.round((game.researchProgress || 0) / tech.cost * 100) };
      }
      const eurekas = game.eurekas || [];
      const eurekaHints = available.filter(t => t.eureka && !eurekas.includes(t.id)).slice(0, 3).map(t => ({
        tech: t.name, hint: t.eureka.description,
      }));
      // Suggest next techs based on what unlocks
      const recommended = available.slice(0, 5).map(t => ({ name: t.name, cost: t.cost, era: t.era || 'ancient' }));
      return {
        ...base,
        sciencePerTurn: game.sciencePerTurn || 0,
        techsResearched: techs.length,
        totalTechs: allTechs.length,
        currentResearch: currentProgress,
        researchedTechs: techs,
        availableTechs: recommended,
        eurekaHints,
        hasWriting: techs.includes('writing'),
        hasPhilosophy: techs.includes('philosophy'),
        hasCurrency: techs.includes('currency'),
      };
    }
    case 'cultural': {
      const civics = game.civics || [];
      const allCivics = CIVICS || [];
      return {
        ...base,
        culture: game.culture || 0,
        culturePerTurn: game.culturePerTurn || 0,
        civicsAdopted: civics.length,
        currentCivic: game.currentCivic || null,
        civicProgress: game.civicProgress || 0,
        wonders: game.wonders || [],
        wonderCount: (game.wonders || []).length,
        builtWondersGlobal: Object.keys(game.builtWonders || {}).length,
        greatPeople: (game.greatPeople || []).length,
        inspirations: (game.inspirations || []).length,
        happiness: game.happiness || 0,
        amenities: game.amenities || 0,
      };
    }
    default:
      return base;
  }
}

// ============================================
// ADVISOR SYSTEM PROMPTS — Unique Per Domain
// ============================================

function buildAdvisorSystemPrompt(advisor, advisorKey, context) {
  let prompt = '';

  // Core identity — unique per advisor
  prompt += `You are ${advisor.name}, the ${advisor.title} to a civilisation ruler.\n`;
  prompt += `PERSONALITY: ${advisor.personality}\n\n`;

  // Strict rules to prevent faction-leader behaviour
  prompt += `CRITICAL RULES:\n`;
  prompt += `- You are a ROYAL ADVISOR loyal to the ruler. NOT a foreign leader or opponent.\n`;
  prompt += `- You serve the ruler. Address them as "my liege", "sire", or "your majesty".\n`;
  prompt += `- Give specific, actionable advice based ONLY on your domain of expertise.\n`;
  prompt += `- Be BRIEF — 2-4 sentences maximum. Rulers are busy.\n`;
  prompt += `- Reference specific numbers, names, and concrete recommendations.\n`;
  prompt += `- NEVER negotiate, make demands, or propose treaties — you ADVISE, you don't negotiate.\n`;
  prompt += `- NEVER roleplay as a foreign leader or diplomat from another faction.\n`;
  prompt += `- NEVER include [ACTION:...] tags.\n`;
  prompt += `- Stay in character as a medieval advisor. This world is real to you.\n\n`;

  // Domain-specific context
  prompt += `YOUR DOMAIN: ${advisor.desc}\n\n`;
  prompt += `CURRENT STATE (Turn ${context.turn}):\n`;
  prompt += `Gold: ${context.gold} (${(context.goldPerTurn||0) > 0 ? '+' : ''}${context.goldPerTurn||0}/turn), Cities: ${context.cities}\n`;

  switch (advisorKey) {
    case 'military':
      prompt += `\nMILITARY BRIEFING:\n`;
      prompt += `Our strength: ${context.military} (${context.totalCombatUnits} combat units)\n`;
      prompt += `Defense rating: ${context.defense}\n`;
      prompt += `Unit composition: ${Object.entries(context.unitBreakdown || {}).map(([t,n]) => `${n}x ${t}`).join(', ') || 'none'}\n`;
      prompt += `Wounded: ${context.woundedUnits}, Fortified: ${context.fortifiedUnits}\n`;
      prompt += `Barbarian camps active: ${context.barbarianCamps}\n`;
      if (context.factionThreats.length > 0) {
        prompt += `\nFACTION THREAT ASSESSMENT:\n`;
        for (const t of context.factionThreats) {
          const danger = t.military > context.military * 1.3 ? 'DANGEROUS' : t.military > context.military ? 'STRONG' : 'MANAGEABLE';
          prompt += `- ${t.name}: Military ${t.military} (${danger}), Relations ${t.relation}\n`;
        }
      }
      if (context.activeWars.length > 0) {
        prompt += `\nWARS BETWEEN OTHER FACTIONS:\n`;
        for (const w of context.activeWars) prompt += `- ${w.attacker} vs ${w.defender} (${w.turns} turns)\n`;
      }
      break;

    case 'economic':
      prompt += `\nECONOMIC REPORT:\n`;
      prompt += `Treasury: ${context.gold}g, Income: ${context.goldPerTurn}/turn\n`;
      prompt += `Population: ${context.population}, Food: ${context.foodPerTurn}/turn\n`;
      prompt += `Science: ${context.sciencePerTurn}/turn, Culture: ${context.culturePerTurn}/turn\n`;
      prompt += `Workers: ${context.workers}, Improvements built: ${context.improvements}\n`;
      prompt += `Military upkeep (est): ~${context.militaryUpkeep}g/turn\n`;
      prompt += `Trade routes: ${context.totalTradeRoutes}\n`;
      if (context.cityDetails.length > 0) {
        prompt += `\nCITY DETAILS:\n`;
        for (const c of context.cityDetails) {
          prompt += `- ${c.name}: Pop ${c.population}, Prod ${c.production}/turn, Building: ${c.building}\n`;
        }
      }
      break;

    case 'diplomatic':
      prompt += `\nDIPLOMATIC INTELLIGENCE:\n`;
      prompt += `Factions discovered: ${context.factionsDiscovered}/${context.totalFactions}\n`;
      prompt += `Embassies: ${context.embassyCount}, Gossip depth: ${context.gossipPoints} points\n`;
      if (Object.keys(context.relationships).length > 0) {
        prompt += `\nRELATIONSHIPS:\n`;
        for (const [name, data] of Object.entries(context.relationships)) {
          let extras = [];
          if (data.hasAlliance) extras.push('ALLIED');
          if (data.hasOpenBorders) extras.push('open borders');
          if (data.hasEmbassy) extras.push('embassy');
          prompt += `- ${name}: ${data.status} (${data.score}), ${data.type} faction, mil ${data.military}${extras.length ? ' [' + extras.join(', ') + ']' : ''}\n`;
        }
      }
      if (context.activeWars.length > 0) prompt += `\nACTIVE WARS: ${context.activeWars.join('; ')}\n`;
      if (context.alliances.length > 0) prompt += `ALLIANCES: ${context.alliances.join('; ')}\n`;
      if (context.recentRumours.length > 0) {
        prompt += `\nRECENT INTELLIGENCE:\n`;
        for (const r of context.recentRumours) prompt += `- ${r}\n`;
      }
      break;

    case 'science':
      prompt += `\nRESEARCH STATUS:\n`;
      prompt += `Technologies: ${context.techsResearched}/${context.totalTechs} researched\n`;
      prompt += `Science output: ${context.sciencePerTurn}/turn\n`;
      if (context.currentResearch) {
        prompt += `Currently researching: ${context.currentResearch.name} (${context.currentResearch.pct}% complete)\n`;
      }
      prompt += `Key techs: Writing ${context.hasWriting ? '✓' : '✗'}, Philosophy ${context.hasPhilosophy ? '✓' : '✗'}, Currency ${context.hasCurrency ? '✓' : '✗'}\n`;
      if (context.availableTechs.length > 0) {
        prompt += `\nAVAILABLE TECHNOLOGIES:\n`;
        for (const t of context.availableTechs) prompt += `- ${t.name} (cost ${t.cost})\n`;
      }
      if (context.eurekaHints.length > 0) {
        prompt += `\nEUREKA OPPORTUNITIES:\n`;
        for (const e of context.eurekaHints) prompt += `- ${e.tech}: ${e.hint}\n`;
      }
      break;

    case 'cultural':
      prompt += `\nCULTURAL REPORT:\n`;
      prompt += `Culture: ${context.culture} (${context.culturePerTurn}/turn)\n`;
      prompt += `Civics adopted: ${context.civicsAdopted}\n`;
      if (context.currentCivic) prompt += `Studying: ${context.currentCivic}\n`;
      prompt += `Wonders built: ${context.wonderCount} (${context.builtWondersGlobal} claimed globally)\n`;
      prompt += `Great People: ${context.greatPeople}, Inspirations: ${context.inspirations}\n`;
      break;
  }

  return prompt;
}

// ============================================
// QUICK SUGGESTIONS
// ============================================

function getQuickSuggestions(advisorKey) {
  switch (advisorKey) {
    case 'military':
      return ['Who threatens us?', 'Should I build more troops?', 'Where should I attack?', 'Rate our defences'];
    case 'economic':
      return ['How is our economy?', 'What should I build next?', 'Are we spending too much?', 'Best way to earn gold?'];
    case 'diplomatic':
      return ['Who should I ally with?', 'Any gossip?', 'Who is at war?', 'Which faction is dangerous?'];
    case 'science':
      return ['What should I research?', 'Any eureka opportunities?', 'How far behind are we?', 'Tech strategy?'];
    case 'cultural':
      return ['Should I build a wonder?', 'How is our culture?', 'Any great people coming?', 'Cultural victory path?'];
    default:
      return ['What do you recommend?', 'What is our situation?'];
  }
}

// ============================================
// UTILITIES
// ============================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatAdvisorResponse(text) {
  // Light markdown-like formatting
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#ffd700;">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em style="color:#aaa;">$1</em>')
    .replace(/\n/g, '<br>');
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '128,128,128';
  return `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}`;
}
