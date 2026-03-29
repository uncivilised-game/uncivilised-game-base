// ============================================
// ENHANCED ADVISORS — LLM-Powered Royal Council
// ============================================
// Each advisor is a specialised AI persona the player can consult.
// One advisor consultation per turn (or two if research unlocks it).
// Advisors are queried via the same /api/chat backend but with
// a different character_id that maps to advisor-specific system prompts.

import { FACTIONS, FACTION_TRAITS, TECHNOLOGIES } from './constants.js';
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

/**
 * Render the advisor panel — shows either advisor selection or active chat.
 */
export function renderAdvisorPanel() {
  const container = document.getElementById('advisor-body');
  if (!container) return;
  resetAdvisorConsultations();

  if (currentAdvisor && conversationHistory.length > 0) {
    container.innerHTML = renderAdvisorChat();
    bindAdvisorChatEvents();
  } else {
    container.innerHTML = renderAdvisorSelection();
    bindAdvisorSelectionEvents();
  }
}

/**
 * Open a specific advisor's chat.
 */
export function openAdvisor(advisorKey) {
  if (!ADVISORS[advisorKey]) return;
  currentAdvisor = advisorKey;
  conversationHistory = [];
  // Update panel title
  const titleEl = document.getElementById('advisor-title');
  if (titleEl) {
    const adv = ADVISORS[advisorKey];
    titleEl.innerHTML = `${adv.icon} ${adv.name} — ${adv.title}`;
  }
  renderAdvisorPanel();
}

/**
 * Send a message to the current advisor.
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

  // Add user message to history
  conversationHistory.push({ role: 'user', content: userMsg });
  renderAdvisorPanel();

  // Call the LLM
  isWaitingForResponse = true;
  renderAdvisorPanel();

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
  renderAdvisorPanel();
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
// ADVISOR CHAT VIEW
// ============================================

function renderAdvisorChat() {
  const adv = ADVISORS[currentAdvisor];
  if (!adv) return '';
  const remaining = consultationsPerTurn - consultationsUsed;

  let html = '';
  html += `<div style="padding:8px 14px;">`;

  // Back button + status
  html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">`;
  html += `<span id="advisor-back-btn" style="cursor:pointer;color:#ffd700;font-size:12px;">\u2190 Back to Council</span>`;
  html += `<span style="color:#888;font-size:10px;">Consultations: ${remaining}/${consultationsPerTurn}</span>`;
  html += '</div>';

  // Conversation messages
  html += `<div id="advisor-messages" style="max-height:280px;overflow-y:auto;margin-bottom:8px;">`;

  if (conversationHistory.length === 0) {
    // Opening greeting
    html += `<div style="background:rgba(${hexToRgb(adv.color)},0.1);border-left:3px solid ${adv.color};padding:8px 10px;border-radius:0 6px 6px 0;margin-bottom:6px;">`;
    html += `<div style="color:${adv.color};font-size:11px;font-weight:bold;margin-bottom:2px;">${adv.icon} ${adv.name}</div>`;
    html += `<div style="color:#ddd;font-size:12px;">My liege, I am at your service. What would you have me counsel you on?</div>`;
    html += '</div>';
  }

  for (const msg of conversationHistory) {
    if (msg.role === 'user') {
      html += `<div style="background:rgba(201,168,76,0.1);border-left:3px solid #ffd700;padding:8px 10px;border-radius:0 6px 6px 0;margin-bottom:6px;">`;
      html += `<div style="color:#ffd700;font-size:11px;font-weight:bold;margin-bottom:2px;">\uD83D\uDC51 You</div>`;
      html += `<div style="color:#ddd;font-size:12px;">${escapeHtml(msg.content)}</div>`;
      html += '</div>';
    } else {
      html += `<div style="background:rgba(${hexToRgb(adv.color)},0.1);border-left:3px solid ${adv.color};padding:8px 10px;border-radius:0 6px 6px 0;margin-bottom:6px;">`;
      html += `<div style="color:${adv.color};font-size:11px;font-weight:bold;margin-bottom:2px;">${adv.icon} ${adv.name}</div>`;
      html += `<div style="color:#ddd;font-size:12px;">${formatAdvisorResponse(msg.content)}</div>`;
      html += '</div>';
    }
  }

  // Typing indicator
  if (isWaitingForResponse) {
    html += `<div style="background:rgba(${hexToRgb(adv.color)},0.1);border-left:3px solid ${adv.color};padding:8px 10px;border-radius:0 6px 6px 0;margin-bottom:6px;">`;
    html += `<div style="color:${adv.color};font-size:11px;font-weight:bold;margin-bottom:2px;">${adv.icon} ${adv.name}</div>`;
    html += `<div style="color:#888;font-size:12px;font-style:italic;">\u2328\uFE0F Thinking...</div>`;
    html += '</div>';
  }

  html += '</div>';

  // Input area
  html += `<div style="display:flex;gap:6px;">`;
  html += `<input type="text" id="advisor-input" placeholder="Ask ${adv.name}..." `;
  html += `style="flex:1;background:rgba(30,30,40,0.9);border:1px solid rgba(201,168,76,0.3);border-radius:6px;padding:8px 10px;color:#f0e8d0;font-size:12px;outline:none;" `;
  html += `${isWaitingForResponse || remaining <= 0 ? 'disabled' : ''}>`;
  html += `<button id="advisor-send-btn" style="padding:8px 14px;border-radius:6px;border:1px solid rgba(201,168,76,0.4);background:rgba(201,168,76,0.2);color:#ffd700;cursor:pointer;font-size:12px;" `;
  html += `${isWaitingForResponse || remaining <= 0 ? 'disabled' : ''}>\u27A4</button>`;
  html += '</div>';

  // Quick question suggestions
  if (conversationHistory.length === 0) {
    const suggestions = getQuickSuggestions(currentAdvisor);
    html += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;">`;
    for (const s of suggestions) {
      html += `<span class="advisor-suggestion" data-msg="${escapeHtml(s)}" style="padding:3px 8px;border-radius:12px;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.2);color:#aaa;font-size:10px;cursor:pointer;">${s}</span>`;
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function bindAdvisorChatEvents() {
  // Back button
  const backBtn = document.getElementById('advisor-back-btn');
  if (backBtn) {
    backBtn.onclick = () => {
      currentAdvisor = null;
      conversationHistory = [];
      const titleEl = document.getElementById('advisor-title');
      if (titleEl) titleEl.innerHTML = '\uD83D\uDCAC Royal Advisor';
      renderAdvisorPanel();
    };
  }
  // Send button
  const sendBtn = document.getElementById('advisor-send-btn');
  const input = document.getElementById('advisor-input');
  if (sendBtn && input) {
    sendBtn.onclick = () => {
      sendAdvisorMessage(input.value);
      input.value = '';
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation(); // Prevent end-turn hotkey
        sendAdvisorMessage(input.value);
        input.value = '';
      }
    });
  }
  // Quick suggestions
  document.querySelectorAll('.advisor-suggestion').forEach(el => {
    el.onclick = () => {
      const msg = el.dataset.msg;
      if (input) input.value = msg;
      sendAdvisorMessage(msg);
      if (input) input.value = '';
    };
  });
  // Scroll to bottom
  const msgContainer = document.getElementById('advisor-messages');
  if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
}

// ============================================
// API CALL
// ============================================

async function callAdvisorAPI(advisor, userMessage) {
  // Build game context for the advisor
  const gameContext = buildGameContext(advisor);
  const systemPrompt = buildAdvisorSystemPrompt(advisor, gameContext);

  const payload = {
    character_id: advisor.id,
    message: userMessage,
    game_state: gameContext,
    conversation_history: conversationHistory.slice(0, -1).map(m => ({
      role: m.role,
      content: m.content,
    })),
    reputation: null,
    diplomatic_ledger: [],
    diplomatic_summary: '',
    // Pass extra advisor context via the diplomatic_summary field
    // (backend will include this in the system prompt)
    system_override: systemPrompt,
  };

  // Use the existing /api/chat endpoint but with advisor character IDs
  const resp = await fetch(`${API}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    // If the backend doesn't recognise advisor character IDs,
    // fall back to a local response based on game state
    return generateLocalAdvisorResponse(advisor, userMessage, gameContext);
  }

  const data = await resp.json();
  // Strip any [ACTION:...] tags from advisor responses (advisors give advice, not actions)
  let reply = data.reply || data.response || data.message || '';
  reply = reply.replace(/\[ACTION:.*?\]/gs, '').trim();
  return reply || generateLocalAdvisorResponse(advisor, userMessage, gameContext);
}

// ============================================
// LOCAL FALLBACK — Rule-Based Advisor Responses
// ============================================
// If the backend API is unavailable or doesn't handle advisor characters,
// generate useful advice from game state alone.

function generateLocalAdvisorResponse(advisor, question, context) {
  const q = question.toLowerCase();
  const key = Object.keys(ADVISORS).find(k => ADVISORS[k].id === advisor.id) || '';

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
  const units = game.units ? game.units.filter(u => u.owner === 'player') : [];
  const militaryUnits = units.filter(u => u.class !== 'civilian' && u.class !== 'worker');
  const threats = [];

  for (const [fid, stats] of Object.entries(game.factionStats || {})) {
    if (stats.military > (game.military || 0) * 1.3) {
      threats.push(FACTIONS[fid]?.name || fid);
    }
  }

  let response = `My liege, our forces stand at ${militaryUnits.length} combat units with total military strength ${game.military || 0}. `;
  if (threats.length > 0) {
    response += `I must warn you — ${threats.join(' and ')} ${threats.length > 1 ? 'pose' : 'poses'} a significant military threat to our realm. I recommend bolstering our defences. `;
  } else {
    response += 'Our position is strong — no faction currently outmatches us militarily. ';
  }

  const wars = (game.aiWars || []);
  if (wars.length > 0) {
    response += `There are ${wars.length} active wars between other factions. This may present an opportunity to strike while our rivals are distracted.`;
  }
  return response;
}

function generateEconomicAdvice(q, ctx) {
  const gold = game.gold || 0;
  const gpt = game.goldPerTurn || 0;
  const cities = game.cities || [];

  let response = `Our treasury holds ${gold} gold with income of ${gpt > 0 ? '+' : ''}${gpt} per turn. `;
  if (gpt < 0) {
    response += 'We are bleeding gold — I strongly recommend reducing our army size or establishing new trade routes. ';
  } else if (gpt < 5) {
    response += 'Income is modest. Building markets and establishing trade routes would improve our coffers. ';
  } else {
    response += 'Our economy is healthy. ';
  }
  response += `We have ${cities.length} ${cities.length === 1 ? 'city' : 'cities'}. `;
  if (cities.length < 3) {
    response += 'I recommend founding more cities to expand our economic base — settlers are a sound investment.';
  }
  return response;
}

function generateDiplomaticAdvice(q, ctx) {
  const met = Object.keys(game.metFactions || {});
  let response = `We have established contact with ${met.length} faction${met.length !== 1 ? 's' : ''}. `;

  const friends = met.filter(f => (game.relationships?.[f] || 0) > 20);
  const enemies = met.filter(f => (game.relationships?.[f] || 0) < -20);

  if (friends.length > 0) {
    response += `Our friends: ${friends.map(f => FACTIONS[f]?.name || f).join(', ')}. `;
  }
  if (enemies.length > 0) {
    response += `Those who view us with hostility: ${enemies.map(f => FACTIONS[f]?.name || f).join(', ')}. I suggest either strengthening our military posture or attempting reconciliation through gifts and trade. `;
  }

  const wars = game.aiWars || [];
  const alliances = game.aiAlliances || [];
  if (wars.length > 0 || alliances.length > 0) {
    response += `In the wider world, there are ${wars.length} wars and ${alliances.length} alliances active. `;
    response += 'These shifting allegiances create opportunities for the astute diplomat.';
  }

  // Rumours
  const rumours = (game.rumourQueue || []).filter(r => r.revealTurn <= game.turn);
  if (rumours.length > 0) {
    response += ` I have also heard ${rumours.length} confirmed rumour${rumours.length > 1 ? 's' : ''} from my network — check the Intelligence panel for details.`;
  }

  return response;
}

function generateScienceAdvice(q, ctx) {
  const techs = game.techs || [];
  const allTechs = TECHNOLOGIES || [];
  const available = allTechs.filter(t => !techs.includes(t.id));
  const current = game.currentResearch;

  let response = `We have discovered ${techs.length} of ${allTechs.length} technologies. `;
  if (current) {
    const tech = allTechs.find(t => t.id === current);
    response += `Currently researching: ${tech?.name || current} (${Math.round((game.researchProgress || 0) / (tech?.cost || 1) * 100)}% complete). `;
  }

  // Suggest next tech based on what's missing
  const hasWriting = techs.includes('writing');
  const hasCurrency = techs.includes('currency');
  if (!hasWriting) {
    response += 'I strongly recommend researching Writing — it unlocks libraries and gives you an extra advisor consultation per turn. ';
  } else if (!hasCurrency) {
    response += 'Currency would be a wise next step — it enables markets and trade routes for economic growth. ';
  }

  // Eureka hints
  const eurekas = game.eurekas || [];
  const availableEurekas = available.filter(t => t.eureka && !eurekas.includes(t.id));
  if (availableEurekas.length > 0) {
    const hint = availableEurekas[0];
    response += `Interesting discovery: ${hint.eureka.description} — this could accelerate our research.`;
  }

  return response;
}

function generateCulturalAdvice(q, ctx) {
  const culture = game.culture || 0;
  const wonders = game.wonders || [];
  const builtWonders = game.builtWonders || {};

  let response = `Our cultural output stands at ${game.culturePerTurn || 0} per turn. `;
  if (wonders.length > 0) {
    response += `We have completed ${wonders.length} wonder${wonders.length > 1 ? 's' : ''}. `;
  }

  const availableWonders = Object.keys(builtWonders).length;
  response += `${availableWonders} wonders have been claimed across the world. `;

  const civics = game.civics || [];
  response += `We have adopted ${civics.length} civic${civics.length !== 1 ? 's' : ''}. `;
  response += 'Building temples and cultural buildings will strengthen our cultural influence. Great People are the key to cultural dominance.';

  return response;
}

// ============================================
// CONTEXT BUILDERS
// ============================================

function buildGameContext(advisor) {
  return {
    turn: game.turn,
    gold: game.gold,
    goldPerTurn: game.goldPerTurn,
    science: game.science,
    sciencePerTurn: game.sciencePerTurn,
    culture: game.culture,
    culturePerTurn: game.culturePerTurn,
    military: game.military,
    defense: game.defense,
    cities: (game.cities || []).length,
    units: (game.units || []).filter(u => u.owner === 'player').length,
    techs: (game.techs || []),
    currentResearch: game.currentResearch,
    researchProgress: game.researchProgress,
    wonders: game.wonders || [],
    relationships: game.relationships || {},
    metFactions: Object.keys(game.metFactions || {}),
    factionStats: game.factionStats || {},
    aiWars: (game.aiWars || []).length,
    aiAlliances: (game.aiAlliances || []).length,
  };
}

function buildAdvisorSystemPrompt(advisor, context) {
  let prompt = `You are ${advisor.name}, the ${advisor.title} to the ruler of a growing civilisation in the game Uncivilised. `;
  prompt += `${advisor.personality}\n\n`;
  prompt += `RULES:\n`;
  prompt += `- Stay in character at ALL times. You are a royal advisor, not an AI.\n`;
  prompt += `- Give specific, actionable advice based on the game state provided.\n`;
  prompt += `- Be BRIEF — 2-4 sentences maximum. Rulers are busy.\n`;
  prompt += `- Reference specific game numbers, faction names, and concrete recommendations.\n`;
  prompt += `- Never break the fourth wall or mention "the game" — this IS real to you.\n`;
  prompt += `- Never include [ACTION:...] tags — you advise, you don't act.\n\n`;
  prompt += `CURRENT STATE:\n`;
  prompt += `Turn: ${context.turn}\n`;
  prompt += `Gold: ${context.gold} (${context.goldPerTurn > 0 ? '+' : ''}${context.goldPerTurn}/turn)\n`;
  prompt += `Military: ${context.military}, Defense: ${context.defense}\n`;
  prompt += `Cities: ${context.cities}, Units: ${context.units}\n`;
  prompt += `Technologies: ${context.techs.length} researched${context.currentResearch ? `, currently researching ${context.currentResearch}` : ''}\n`;
  prompt += `Wonders: ${context.wonders.length > 0 ? context.wonders.join(', ') : 'none'}\n`;

  // Faction relationships
  if (context.metFactions.length > 0) {
    prompt += `\nKNOWN FACTIONS:\n`;
    for (const fid of context.metFactions) {
      const rel = context.relationships[fid] || 0;
      const faction = FACTIONS[fid];
      const stats = context.factionStats[fid];
      const label = getRelationLabel(rel);
      prompt += `- ${faction?.name || fid}: ${label.text} (${rel}), Military: ${stats?.military || '?'}\n`;
    }
  }

  prompt += `\nActive wars in the world: ${context.aiWars}, Active alliances: ${context.aiAlliances}\n`;

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
