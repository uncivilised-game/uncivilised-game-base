// ============================================
// AI-TO-AI DIPLOMACY SYSTEM
// ============================================
// Rule-based diplomatic interactions between AI factions.
// Each turn, AI factions evaluate relationships with other AIs
// and may initiate diplomatic actions with varying visibility.

import { FACTIONS, FACTION_TRAITS, RESOURCE_ZONES, UNIT_RESOURCE_REQUIREMENTS, RESOURCES } from './constants.js';
import { game } from './state.js';
import { addEvent, logAction, showToast, showDiploToast } from './events.js';
import { hexDistance } from './hex.js';
import { hasResourceAccess } from './map.js';

// ============================================
// VISIBILITY LEVELS
// ============================================
const VISIBILITY = {
  PUBLIC: 'public',     // Immediately visible to player
  RUMOURED: 'rumoured', // Visible after delay, sometimes vague
  SECRET: 'secret',     // Never visible until activation
};

// ============================================
// INITIALISE AI-TO-AI RELATIONS
// ============================================
export function initAIRelations() {
  if (!game.aiRelations) game.aiRelations = {};
  if (!game.aiWars) game.aiWars = [];
  if (!game.aiSecretPacts) game.aiSecretPacts = [];
  if (!game.rumourQueue) game.rumourQueue = [];
  if (!game.aiAlliances) game.aiAlliances = [];
  if (!game.aiTradeDeals) game.aiTradeDeals = [];
  if (!game.aiDenouncements) game.aiDenouncements = [];
  if (!game.aiMotivations) game.aiMotivations = {};

  const factionIds = Object.keys(FACTIONS);
  // Include player as a first-class participant
  const allParticipants = [...factionIds, 'player'];

  for (const a of allParticipants) {
    if (!game.aiRelations[a]) game.aiRelations[a] = {};
    if (!game.aiMotivations[a]) game.aiMotivations[a] = {};
    for (const b of allParticipants) {
      if (a === b) continue;
      if (game.aiRelations[a][b] === undefined) {
        // Initial relations based on archetype compatibility
        if (a === 'player' || b === 'player') {
          game.aiRelations[a][b] = 0; // Start neutral with player
        } else {
          game.aiRelations[a][b] = getInitialRelation(a, b);
        }
      }
      if (!game.aiMotivations[a][b]) {
        game.aiMotivations[a][b] = [];
      }
    }
  }
}

function getInitialRelation(a, b) {
  const traitA = FACTION_TRAITS[a];
  const traitB = FACTION_TRAITS[b];
  if (!traitA || !traitB) return 0;

  // Similar archetypes start friendlier, opposing ones start hostile
  if (traitA.archetype === traitB.archetype) return 10;
  if (traitA.archetype === 'militaristic' && traitB.archetype === 'diplomatic') return -10;
  if (traitA.archetype === 'diplomatic' && traitB.archetype === 'militaristic') return -10;
  return 0;
}

// ============================================
// MAIN AI-TO-AI DIPLOMACY PROCESSING
// ============================================
export function processAIDiplomacy() {
  initAIRelations();

  const factionIds = Object.keys(FACTIONS);

  // 1. Process existing wars (attrition)
  processWarAttrition();

  // 2. Process peace from improving relations
  checkWarEndings();

  // 3. Natural relation drift
  applyRelationDrift(factionIds);

  // 4. Spatial awareness — border tension (every 5 turns to avoid performance issues)
  if (game.turn % 5 === 0) {
    computeBorderTension(factionIds);
  }

  // 5. Balance of power — threat assessment
  computePowerBalance(factionIds);

  // 5b. Resource scarcity tension (every 5 turns, same cadence as border tension)
  if (game.turn % 5 === 0 && game.resourceZones && game.resourceZones.length > 0) {
    computeResourceTension(factionIds);
  }

  // 6. Each AI evaluates and may act toward each other AI (SKIP player as actor)
  for (const a of factionIds) {
    const traitsA = FACTION_TRAITS[a];
    if (!traitsA) continue;
    const statsA = game.factionStats[a];
    if (!statsA) continue;

    for (const b of factionIds) {
      if (a === b) continue;
      const traitsB = FACTION_TRAITS[b];
      if (!traitsB) continue;
      const statsB = game.factionStats[b];
      if (!statsB) continue;

      const relation = game.aiRelations[a][b] || 0;

      // Only one action per pair per turn — check if A already acted toward B
      if (hasActedThisTurn(a, b)) continue;

      // Evaluate possible actions (ordered by priority)
      if (tryDeclareWar(a, b, relation, traitsA, statsA, statsB)) continue;
      if (tryDenounce(a, b, relation, traitsA)) continue;
      if (trySecretPact(a, b, relation, traitsA, factionIds)) continue;
      if (tryProposeAlliance(a, b, relation, traitsA)) continue;
      if (tryProposeTrade(a, b, relation, traitsA, statsA)) continue;
    }
  }

  // 7. Player involvement — alliance/trade spillover
  processPlayerSpillover(factionIds);

  // 8. Check if any secret pacts should activate
  checkSecretPactActivation();

  // 9. Process rumour queue — reveal pending rumours
  processRumourQueue();
}

// ============================================
// ACTION TRACKING (prevent duplicate actions per turn)
// ============================================
const _actedThisTurn = new Set();

function hasActedThisTurn(a, b) {
  return _actedThisTurn.has(`${a}->${b}`);
}

function markActed(a, b) {
  _actedThisTurn.add(`${a}->${b}`);
}

export function resetTurnActions() {
  _actedThisTurn.clear();
}

// ============================================
// WAR DECLARATION [PUBLIC]
// ============================================
function tryDeclareWar(a, b, relation, traitsA, statsA, statsB) {
  // Already at war?
  if (areAtWar(a, b)) return false;

  let warThreshold = traitsA.warThreshold || -25;

  // Resource desperation: lower war threshold if b controls resources a critically needs
  let resourceDesperation = 0;
  if (game.resourceZones && game.resourceZones.length > 0) {
    const missingA = getMissingResources(a);
    const ownedB = getOwnedResources(b);
    for (const res of missingA) {
      if (ownedB.includes(res)) {
        resourceDesperation += getResourceNeed(a, res);
      }
    }
  }
  // Each point of desperation makes war 2 points more tolerable
  warThreshold += Math.min(resourceDesperation * 2, 15);

  if (relation >= warThreshold) return false;
  if (statsA.military <= (statsB.military || 0) * 0.8) return false;

  // 20% base + up to 10% extra from resource desperation
  const warChance = 0.20 + Math.min(resourceDesperation * 0.02, 0.10);
  if (Math.random() > warChance) return false;

  // Declare war
  declareWar(a, b);
  return true;
}

function declareWar(a, b) {
  const factionA = FACTIONS[a];
  const factionB = FACTIONS[b];

  // Add to active wars
  game.aiWars.push({
    attacker: a,
    defender: b,
    startTurn: game.turn,
    turnsActive: 0,
  });

  // Relationship plummets
  modifyRelation(a, b, -30, { type: 'war_declared', detail: factionB.name });

  markActed(a, b);
  markActed(b, a);

  // PUBLIC — immediate event
  const msg = `War has broken out between ${factionA.name} and ${factionB.name}!`;
  addEvent(msg, 'diplomacy');
  showDiploToast('War Declared', msg);
  logAction('diplomacy', msg, { type: 'ai_war', attacker: a, defender: b });

  // Break any existing alliance or trade between them
  removeAlliance(a, b);
  removeTradeDeal(a, b);
}

// ============================================
// DENOUNCEMENT [PUBLIC]
// ============================================
function tryDenounce(a, b, relation, traitsA) {
  if (relation >= -10 || relation <= (traitsA.warThreshold || -25)) return false;
  // Already denounced recently?
  if (hasRecentDenouncement(a, b)) return false;

  if (Math.random() > 0.10) return false;

  const factionA = FACTIONS[a];
  const factionB = FACTIONS[b];

  // Record denouncement
  game.aiDenouncements.push({ from: a, to: b, turn: game.turn });
  modifyRelation(a, b, -5, { type: 'denouncement', detail: FACTIONS[b]?.name });
  modifyRelation(b, a, -5, { type: 'denounced_by', detail: FACTIONS[a]?.name });
  markActed(a, b);

  // PUBLIC — immediate event
  const msg = `${factionA.name} publicly condemns ${factionB.name}'s actions`;
  addEvent(msg, 'diplomacy');
  logAction('diplomacy', msg, { type: 'ai_denounce', from: a, to: b });

  return true;
}

function hasRecentDenouncement(a, b) {
  return (game.aiDenouncements || []).some(
    d => d.from === a && d.to === b && game.turn - d.turn < 10
  );
}

// ============================================
// ALLIANCE PROPOSAL [RUMOURED]
// ============================================
function tryProposeAlliance(a, b, relation, traitsA) {
  if (relation <= 30) return false;
  if (hasAlliance(a, b)) return false;

  // Diplomatic archetypes more likely to propose
  const chance = 0.10 + (traitsA.diplomacy || 0) * 0.05;
  if (Math.random() > chance) return false;

  // B accepts based on their diplomacy weight and relation
  const traitsB = FACTION_TRAITS[b];
  const acceptChance = 0.5 + (traitsB ? traitsB.diplomacy : 0.5) * 0.3 + relation * 0.005;
  if (Math.random() > acceptChance) return false;

  // Alliance formed
  game.aiAlliances.push({ factions: [a, b], turn: game.turn });
  modifyRelation(a, b, 15, { type: 'alliance_formed', detail: FACTIONS[b]?.name });
  modifyRelation(b, a, 15, { type: 'alliance_formed', detail: FACTIONS[a]?.name });
  markActed(a, b);

  const factionA = FACTIONS[a];
  const factionB = FACTIONS[b];

  // RUMOURED — vague hint now, confirmation later
  game.rumourQueue.push({
    text: `Whispers suggest ${factionA.name} and ${factionB.name} are growing closer`,
    revealTurn: game.turn + 1,
    type: 'diplomacy',
    relatedFactions: [a, b],
  });
  game.rumourQueue.push({
    text: `${factionA.name} and ${factionB.name} have formalised an alliance`,
    revealTurn: game.turn + 2 + Math.floor(Math.random() * 2), // 2-3 turns
    type: 'diplomacy',
    relatedFactions: [a, b],
  });

  logAction('diplomacy', `${factionA.name} and ${factionB.name} form alliance`, {
    type: 'ai_alliance', factions: [a, b],
  });

  return true;
}

// ============================================
// TRADE PROPOSAL [RUMOURED]
// ============================================
function tryProposeTrade(a, b, relation, traitsA, statsA) {
  if (hasTradeDeal(a, b)) return false;

  // Resource complementarity: A has something B needs and vice versa
  let resourceBonus = 0;
  let resourceDetail = null;
  if (game.resourceZones && game.resourceZones.length > 0) {
    const ownedA = getOwnedResources(a);
    const ownedB = getOwnedResources(b);
    const missingA = getMissingResources(a);
    const missingB = getMissingResources(b);

    // A has resources B needs
    const aCanOfferB = ownedA.filter(r => missingB.includes(r));
    // B has resources A needs
    const bCanOfferA = ownedB.filter(r => missingA.includes(r));

    if (aCanOfferB.length > 0 && bCanOfferA.length > 0) {
      // Mutual resource trade — strong incentive
      resourceBonus = 0.30;
      resourceDetail = `${RESOURCES[bCanOfferA[0]]?.name} for ${RESOURCES[aCanOfferB[0]]?.name}`;
    } else if (bCanOfferA.length > 0) {
      // A needs something B has — A is motivated
      resourceBonus = 0.20;
      resourceDetail = `seeks ${RESOURCES[bCanOfferA[0]]?.name}`;
    } else if (aCanOfferB.length > 0) {
      // A can offer something B needs — leverage
      resourceBonus = 0.10;
    }
  }

  // Resource need can override the relation threshold (normally > 0)
  const relationThreshold = resourceBonus >= 0.20 ? -10 : 0;
  if (relation <= relationThreshold) return false;
  if ((statsA.gold || 0) <= 100 && resourceBonus === 0) return false;

  const chance = 0.15 + (traitsA.diplomacy || 0) * 0.05 + resourceBonus;
  if (Math.random() > chance) return false;

  // B accepts if relation positive and they have some diplomatic inclination
  // Resource complementarity boosts acceptance
  const traitsB = FACTION_TRAITS[b];
  let acceptChance = 0.6 + (traitsB ? traitsB.diplomacy : 0.5) * 0.2;
  if (resourceBonus >= 0.20) acceptChance += 0.20; // B also benefits from resource trade
  if (Math.random() > acceptChance) return false;

  // Trade established
  const goldExchange = 20 + Math.floor(Math.random() * 21); // 20-40
  game.aiTradeDeals.push({
    factions: [a, b],
    turn: game.turn,
    goldPerTurn: goldExchange,
    resourceTrade: resourceDetail || null,
  });
  modifyRelation(a, b, 5, { type: 'trade_established', detail: FACTIONS[b]?.name });
  modifyRelation(b, a, 5, { type: 'trade_established', detail: FACTIONS[a]?.name });
  markActed(a, b);

  const factionA = FACTIONS[a];
  const factionB = FACTIONS[b];

  // RUMOURED — appears 1-2 turns after agreement
  const rumourText = resourceDetail
    ? `Rumour: Caravans laden with ${resourceDetail.includes('for') ? 'goods' : RESOURCES[resourceDetail.split(' ').pop()]?.name || 'resources'} have been seen travelling between ${factionA.name} and ${factionB.name}'s lands`
    : `Rumour: Merchants have been seen travelling between ${factionA.name} and ${factionB.name}'s lands`;
  game.rumourQueue.push({
    text: rumourText,
    revealTurn: game.turn + 1 + Math.floor(Math.random() * 2),
    type: 'diplomacy',
    relatedFactions: [a, b],
  });

  logAction('diplomacy', `${factionA.name} and ${factionB.name} establish trade (+${goldExchange}g/turn${resourceDetail ? ', ' + resourceDetail : ''})`, {
    type: 'ai_trade', factions: [a, b], goldPerTurn: goldExchange, resourceTrade: resourceDetail,
  });

  return true;
}

// ============================================
// SECRET PACT [SECRET until activation]
// ============================================
function trySecretPact(a, b, relation, traitsA, factionIds) {
  // A needs a common enemy C: A hates C, A likes B
  if (relation <= 20) return false;

  // Find a mutual enemy
  let targetC = null;
  for (const c of factionIds) {
    if (c === a || c === b) continue;
    const relAC = game.aiRelations[a][c] || 0;
    const relBC = game.aiRelations[b][c] || 0;
    if (relAC < -30 && relBC < 0) {
      targetC = c;
      break;
    }
  }
  if (!targetC) return false;

  // Already have a pact against this target?
  if (game.aiSecretPacts.some(p =>
    p.target === targetC && p.allies.includes(a) && p.allies.includes(b) && !p.activated
  )) return false;

  // 5% chance
  if (Math.random() > 0.05) return false;

  game.aiSecretPacts.push({
    allies: [a, b],
    target: targetC,
    turn: game.turn,
    activated: false,
    // Activate when both have sufficient military
    activationCondition: 'military_ready',
  });
  markActed(a, b);

  const factionA = FACTIONS[a];
  const factionB = FACTIONS[b];
  const factionC = FACTIONS[targetC];

  // SECRET — only logged, never shown to player
  logAction('diplomacy', `[SECRET] ${factionA.name} and ${factionB.name} form secret pact against ${factionC.name}`, {
    type: 'ai_secret_pact', allies: [a, b], target: targetC,
  });

  return true;
}

// ============================================
// SECRET PACT ACTIVATION
// ============================================
function checkSecretPactActivation() {
  for (const pact of game.aiSecretPacts) {
    if (pact.activated) continue;

    const [a, b] = pact.allies;
    const target = pact.target;
    const statsA = game.factionStats[a];
    const statsB = game.factionStats[b];
    const statsT = game.factionStats[target];
    if (!statsA || !statsB || !statsT) continue;

    // Activate if combined military exceeds target's by 50%
    const combinedMil = (statsA.military || 0) + (statsB.military || 0);
    const targetMil = statsT.military || 0;
    if (combinedMil < targetMil * 1.5) continue;

    // 30% chance per turn when conditions are met
    if (Math.random() > 0.30) continue;

    pact.activated = true;

    // Both declare war on target
    if (!areAtWar(a, target)) declareWar(a, target);
    if (!areAtWar(b, target)) declareWar(b, target);

    const factionA = FACTIONS[a];
    const factionB = FACTIONS[b];
    const factionT = FACTIONS[target];

    // Now PUBLIC — the secret is revealed through the joint declaration
    const msg = `${factionA.name} and ${factionB.name} suddenly declare war on ${factionT.name} simultaneously!`;
    addEvent(msg, 'diplomacy');
    showDiploToast('Secret Pact Revealed', msg);
    logAction('diplomacy', msg, {
      type: 'ai_secret_pact_activated', allies: [a, b], target,
    });
  }
}

// ============================================
// WAR ATTRITION
// ============================================
function processWarAttrition() {
  for (const war of game.aiWars) {
    war.turnsActive++;
    const statsA = game.factionStats[war.attacker];
    const statsB = game.factionStats[war.defender];

    if (statsA) {
      const loss = 2 + Math.floor(Math.random() * 4); // 2-5
      statsA.military = Math.max(0, (statsA.military || 0) - loss);
    }
    if (statsB) {
      const loss = 1 + Math.floor(Math.random() * 4); // 1-4
      statsB.military = Math.max(0, (statsB.military || 0) - loss);
    }
  }
}

// ============================================
// WAR ENDING CONDITIONS
// ============================================
function checkWarEndings() {
  const endedWars = [];

  for (let i = game.aiWars.length - 1; i >= 0; i--) {
    const war = game.aiWars[i];

    // Player wars do NOT auto-end — only explicit peace deals can end them
    if (war.attacker === 'player' || war.defender === 'player') continue;

    const statsA = game.factionStats[war.attacker];
    const statsB = game.factionStats[war.defender];
    const relation = game.aiRelations[war.attacker]?.[war.defender] || -50;

    let ended = false;
    let reason = '';

    // Either faction military drops below 5
    if (statsA && (statsA.military || 0) < 5) {
      ended = true;
      reason = `${FACTIONS[war.attacker]?.name || war.attacker} can no longer sustain the war`;
    } else if (statsB && (statsB.military || 0) < 5) {
      ended = true;
      reason = `${FACTIONS[war.defender]?.name || war.defender} can no longer sustain the war`;
    }
    // After 15 turns
    else if (war.turnsActive >= 15) {
      ended = true;
      reason = 'both sides exhausted after prolonged conflict';
    }
    // Relations improve above -10
    else if (relation > -10) {
      ended = true;
      reason = 'diplomatic channels reopened';
    }

    if (ended) {
      endedWars.push({ war, reason });
      game.aiWars.splice(i, 1);
    }
  }

  for (const { war, reason } of endedWars) {
    const factionA = FACTIONS[war.attacker];
    const factionB = FACTIONS[war.defender];
    const msg = `Peace restored between ${factionA?.name} and ${factionB?.name} — ${reason}`;
    addEvent(msg, 'diplomacy');
    logAction('diplomacy', msg, { type: 'ai_peace', factions: [war.attacker, war.defender] });

    // Small relation boost from peace
    modifyRelation(war.attacker, war.defender, 5, { type: 'peace_restored', detail: reason });
    modifyRelation(war.defender, war.attacker, 5, { type: 'peace_restored', detail: reason });
  }
}

// ============================================
// RELATION DRIFT
// ============================================
function applyRelationDrift(factionIds) {
  for (const a of factionIds) {
    for (const b of factionIds) {
      if (a >= b) continue; // Process each pair once

      // Peace restores +2 relations per turn (if not at war)
      if (!areAtWar(a, b)) {
        const rel = game.aiRelations[a][b] || 0;
        if (rel < 0) {
          modifyRelation(a, b, 2, { type: 'relation_drift', detail: 'time heals' });
          modifyRelation(b, a, 2, { type: 'relation_drift', detail: 'time heals' });
        }
      } else {
        // At war: relations deteriorate
        modifyRelation(a, b, -2, { type: 'war_attrition', detail: 'ongoing conflict' });
        modifyRelation(b, a, -2, { type: 'war_attrition', detail: 'ongoing conflict' });
      }

      // Alliances improve relations slowly
      if (hasAlliance(a, b)) {
        modifyRelation(a, b, 1, { type: 'alliance_maintenance', detail: 'shared interests' });
        modifyRelation(b, a, 1, { type: 'alliance_maintenance', detail: 'shared interests' });
      }

      // Trade deals improve relations slowly (resource trades bond even stronger)
      if (hasTradeDeal(a, b)) {
        const deal = (game.aiTradeDeals || []).find(td => td.factions.includes(a) && td.factions.includes(b));
        const bonus = (deal && deal.resourceTrade) ? 2 : 1;
        modifyRelation(a, b, bonus, { type: 'trade_maintenance', detail: deal?.resourceTrade || 'mutual benefit' });
        modifyRelation(b, a, bonus, { type: 'trade_maintenance', detail: deal?.resourceTrade || 'mutual benefit' });
      }
    }
  }
}

// ============================================
// RUMOUR QUEUE PROCESSING
// ============================================
function processRumourQueue() {
  if (!game.rumourQueue || game.rumourQueue.length === 0) return;

  let newlyRevealed = 0;
  for (const rumour of game.rumourQueue) {
    if (!rumour.revealed && game.turn >= rumour.revealTurn) {
      rumour.revealed = true;
      newlyRevealed++;

      // Enhance rumour text with motivation details if available
      let enhancedText = rumour.text;
      if (rumour.relatedFactions && rumour.relatedFactions.length >= 2) {
        const [a, b] = rumour.relatedFactions;
        const motivations = getRelationMotivations(a, b);
        if (motivations.length > 0) {
          const recent = motivations[motivations.length - 1];
          if (recent.detail) {
            enhancedText = `${rumour.text} — ${recent.detail}`;
          }
        }
      }

      addEvent(enhancedText, rumour.type || 'diplomacy');
    }
  }

  if (newlyRevealed > 0) {
    showDiploToast('Rumours & Whispers', `${newlyRevealed} new rumour${newlyRevealed > 1 ? 's' : ''} heard`);
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================
function modifyRelation(a, b, delta, motivation = null) {
  if (!game.aiRelations[a]) game.aiRelations[a] = {};
  const current = game.aiRelations[a][b] || 0;
  game.aiRelations[a][b] = Math.max(-100, Math.min(100, current + delta));

  // Log motivation if provided
  if (motivation && motivation.type !== 'relation_drift') {
    // Skip relation_drift unless delta >= 2 to avoid noise
    if (motivation.type === 'relation_drift' && Math.abs(delta) < 2) {
      return;
    }

    if (!game.aiMotivations[a]) game.aiMotivations[a] = {};
    if (!game.aiMotivations[a][b]) game.aiMotivations[a][b] = [];

    const entry = {
      type: motivation.type,
      delta: delta,
      turn: game.turn,
      detail: motivation.detail || null,
    };

    game.aiMotivations[a][b].push(entry);

    // Keep max 10 entries per pair (FIFO)
    if (game.aiMotivations[a][b].length > 10) {
      game.aiMotivations[a][b].shift();
    }
  }
}

function areAtWar(a, b) {
  return (game.aiWars || []).some(w =>
    (w.attacker === a && w.defender === b) || (w.attacker === b && w.defender === a)
  );
}

function hasAlliance(a, b) {
  return (game.aiAlliances || []).some(al =>
    al.factions.includes(a) && al.factions.includes(b)
  );
}

function removeAlliance(a, b) {
  if (!game.aiAlliances) return;
  game.aiAlliances = game.aiAlliances.filter(al =>
    !(al.factions.includes(a) && al.factions.includes(b))
  );
}

function hasTradeDeal(a, b) {
  return (game.aiTradeDeals || []).some(td =>
    td.factions.includes(a) && td.factions.includes(b)
  );
}

function removeTradeDeal(a, b) {
  if (!game.aiTradeDeals) return;
  game.aiTradeDeals = game.aiTradeDeals.filter(td =>
    !(td.factions.includes(a) && td.factions.includes(b))
  );
}

// ============================================
// AI TRADE INCOME (applied to faction stats)
// ============================================
export function processAITradeIncome() {
  for (const deal of (game.aiTradeDeals || [])) {
    for (const fid of deal.factions) {
      const stats = game.factionStats[fid];
      if (stats) {
        stats.gold = (stats.gold || 0) + (deal.goldPerTurn || 0);
      }
    }
  }
}

// ============================================
// FEATURE 1: MOTIVATION MEMORY
// ============================================
export function getRelationMotivations(a, b) {
  return (game.aiMotivations?.[a]?.[b] || []).slice(); // Return a copy
}

export function getRelationSummary(a, b) {
  const motivations = getRelationMotivations(a, b);
  if (motivations.length === 0) return 'Neutral stance';

  const relation = game.aiRelations?.[a]?.[b] || 0;
  let stance = 'Neutral';
  if (relation > 30) stance = 'Friendly';
  else if (relation > 10) stance = 'Cordial';
  else if (relation < -30) stance = 'Hostile';
  else if (relation < -10) stance = 'Tense';

  // Get top 3 most recent motivations
  const recent = motivations.slice(-3).reverse();
  const reasons = recent.map(m => {
    if (m.detail) return `${m.type} (${m.detail})`;
    return m.type;
  });

  return `${stance}: ${reasons.join(', ')}`;
}

// ============================================
// FEATURE 2: SPATIAL AWARENESS
// ============================================
function computeBorderTension(factionIds) {
  // Include player for tension computation
  const allFactions = [...factionIds, 'player'];

  for (let i = 0; i < allFactions.length; i++) {
    for (let j = i + 1; j < allFactions.length; j++) {
      const a = allFactions[i];
      const b = allFactions[j];

      // Find minimum distance between any city pair
      const citiesA = getCitiesForFaction(a);
      const citiesB = getCitiesForFaction(b);

      let minDistance = Infinity;
      for (const ca of citiesA) {
        for (const cb of citiesB) {
          const dist = hexDistance(ca.col, ca.row, cb.col, cb.row);
          minDistance = Math.min(minDistance, dist);
        }
      }

      // Apply relation modifiers based on proximity
      if (minDistance <= 8) {
        // Close neighbors: border tension
        const tension = -5 + Math.floor((8 - minDistance) * 0.5); // -5 to -8
        modifyRelation(a, b, tension, { type: 'border_tension', detail: `${minDistance} hexes apart` });
        modifyRelation(b, a, tension, { type: 'border_tension', detail: `${minDistance} hexes apart` });
      } else if (minDistance > 20) {
        // Far apart: non-threatening, small positive modifier
        modifyRelation(a, b, 1, { type: 'distant_peace', detail: 'far enough apart' });
        modifyRelation(b, a, 1, { type: 'distant_peace', detail: 'far enough apart' });
      }
    }
  }
}

function getCitiesForFaction(fid) {
  const cities = [];
  if (fid === 'player') {
    // Player's cities
    if (game.cities) {
      for (const city of game.cities) {
        cities.push({ col: city.col, row: city.row });
      }
    }
  } else {
    // AI faction capital
    if (game.factionCities[fid]) {
      cities.push(game.factionCities[fid]);
    }
    // AI expansion cities
    if (game.aiFactionCities[fid]) {
      for (const city of game.aiFactionCities[fid]) {
        cities.push(city);
      }
    }
  }
  return cities;
}

// ============================================
// FEATURE 3: BALANCE OF POWER
// ============================================
function computePowerBalance(factionIds) {
  // Calculate threat score for each faction
  const threatScores = {};
  for (const fid of factionIds) {
    const stats = game.factionStats[fid];
    if (!stats) {
      threatScores[fid] = 0;
      continue;
    }
    threatScores[fid] = (stats.military || 0) * 0.4 +
                        (stats.territory || 0) * 0.3 +
                        (stats.gold || 0) * 0.002 +
                        (stats.score || 0) * 0.3;
  }

  // Find leader and average
  const scores = Object.values(threatScores);
  if (scores.length === 0) return;

  const avgThreat = scores.reduce((a, b) => a + b, 0) / scores.length;
  let maxThreat = 0;
  let leader = null;
  let minThreat = Infinity;
  let underdog = null;

  for (const fid of factionIds) {
    if (threatScores[fid] > maxThreat) {
      maxThreat = threatScores[fid];
      leader = fid;
    }
    if (threatScores[fid] < minThreat) {
      minThreat = threatScores[fid];
      underdog = fid;
    }
  }

  // Apply coalition-against-leader dynamic
  if (leader && maxThreat > avgThreat * 1.5) {
    // Leader is ahead: others resent them
    for (const fid of factionIds) {
      if (fid === leader) continue;
      const penalty = -3 - Math.floor((maxThreat - avgThreat) * 0.005); // -3 to -8
      modifyRelation(fid, leader, penalty, { type: 'power_threat', detail: 'dominance concern' });
    }
  }

  // Apply underdog sympathy
  if (underdog && minThreat < avgThreat * 0.6) {
    for (const fid of factionIds) {
      if (fid === underdog) continue;
      modifyRelation(fid, underdog, 2, { type: 'underdog_sympathy', detail: 'weaker faction' });
    }
  }
}

// ============================================
// FEATURE 4: PLAYER INVOLVEMENT
// ============================================
function processPlayerSpillover(factionIds) {
  // Check player's trade routes
  const playerTrades = new Set();
  if (game.tradeRoutes) {
    for (const route of game.tradeRoutes) {
      if (route.factionId) {
        playerTrades.add(route.factionId);
      }
    }
  }

  // Check player's alliances
  const playerAllies = new Set();
  if (game.aiAlliances) {
    for (const alliance of game.aiAlliances) {
      if (alliance.factions.includes('player')) {
        for (const fid of alliance.factions) {
          if (fid !== 'player') {
            playerAllies.add(fid);
          }
        }
      }
    }
  }

  // For each AI faction, apply spillover effects
  for (const fid of factionIds) {
    // If AI is allied/trading with player, consider it a positive factor
    if (playerAllies.has(fid) || playerTrades.has(fid)) {
      // AI's enemies should sour toward the player
      for (const other of factionIds) {
        if (other === fid) continue;
        const relation = game.aiRelations[fid][other] || 0;
        if (relation < -20) {
          // fid is enemy with other, so other should sour toward player
          modifyRelation(other, 'player', -2, { type: 'alliance_spillover', detail: `allied with ${FACTIONS[fid]?.name}` });
        }
      }
    }

    // Check if AI has enemies of the player
    const playerRelation = game.aiRelations[fid]['player'] || 0;
    if (playerRelation < -20 && game.aiAlliances) {
      // This faction is hostile to player; their allies should respect that
      for (const alliance of game.aiAlliances) {
        if (alliance.factions.includes(fid)) {
          for (const allyId of alliance.factions) {
            if (allyId !== fid && allyId !== 'player') {
              // Ally of enemy should sour slightly toward player
              modifyRelation(allyId, 'player', -1, { type: 'spillover_tension', detail: `ally of hostile faction` });
            }
          }
        }
      }
    }
  }
}

// ============================================
// FEATURE 5: RESOURCE SCARCITY AWARENESS
// ============================================

// Strategic resources this faction lacks direct access to
function getMissingResources(factionId) {
  const missing = [];
  for (const zoneId of Object.keys(RESOURCE_ZONES)) {
    const zone = RESOURCE_ZONES[zoneId];
    if (!hasResourceAccess(zone.resource, factionId)) {
      missing.push(zone.resource);
    }
  }
  return missing;
}

// Strategic resources this faction HAS access to
function getOwnedResources(factionId) {
  const owned = [];
  for (const zoneId of Object.keys(RESOURCE_ZONES)) {
    const zone = RESOURCE_ZONES[zoneId];
    if (hasResourceAccess(zone.resource, factionId)) {
      owned.push(zone.resource);
    }
  }
  return owned;
}

// How badly does a faction need a resource? Higher = more desperate
function getResourceNeed(factionId, resourceId) {
  let need = 1; // base need for any strategic resource
  // Check if any important units require this resource
  for (const unitType of Object.keys(UNIT_RESOURCE_REQUIREMENTS)) {
    const req = UNIT_RESOURCE_REQUIREMENTS[unitType];
    if (req.resource === resourceId) {
      // Higher cost multiplier = more painful to lack
      need += req.costMultiplier;
      if (req.combatPenalty > 0) need += req.combatPenalty * 0.2;
    }
  }
  return need;
}

// Which faction controls a given resource zone? Returns factionId or null
function getZoneController(resourceId) {
  const allFactions = [...Object.keys(FACTIONS), 'player'];
  for (const fid of allFactions) {
    if (hasResourceAccess(resourceId, fid)) return fid;
  }
  return null;
}

// Compute resource scarcity tension between factions (every 5 turns)
function computeResourceTension(factionIds) {
  const allParticipants = [...factionIds, 'player'];

  for (const a of allParticipants) {
    const missingA = getMissingResources(a);
    if (missingA.length === 0) continue; // Has everything, no tension

    for (const needed of missingA) {
      const controller = getZoneController(needed);
      if (!controller || controller === a) continue;

      // A needs this resource and controller has it
      const urgency = getResourceNeed(a, needed);

      // Negative modifier toward controller — they have what we need
      if (a !== 'player' && controller !== 'player') {
        // AI-to-AI: resource envy
        const penalty = Math.floor(-1 * urgency);
        modifyRelation(a, controller, penalty, {
          type: 'resource_envy',
          detail: `covets ${RESOURCES[needed]?.name || needed}`,
        });
      } else if (a !== 'player') {
        // AI toward player: resource envy
        const penalty = Math.floor(-1 * urgency);
        modifyRelation(a, 'player', penalty, {
          type: 'resource_envy',
          detail: `covets ${RESOURCES[needed]?.name || needed}`,
        });
      }
    }
  }
}

// ============================================
// QUERY FUNCTIONS (for UI / debug)
// ============================================
export function getAIRelation(a, b) {
  return game.aiRelations?.[a]?.[b] || 0;
}

export function getAIWars() {
  return game.aiWars || [];
}

export function getAIAlliances() {
  return game.aiAlliances || [];
}

export function getAISecretPacts() {
  return game.aiSecretPacts || [];
}

export function getAITradeDeals() {
  return game.aiTradeDeals || [];
}

export function getFactionResources(factionId) {
  return { owned: getOwnedResources(factionId), missing: getMissingResources(factionId) };
}
