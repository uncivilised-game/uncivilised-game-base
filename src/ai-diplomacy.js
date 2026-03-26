// ============================================
// AI-TO-AI DIPLOMACY SYSTEM
// ============================================
// Rule-based diplomatic interactions between AI factions.
// Each turn, AI factions evaluate relationships with other AIs
// and may initiate diplomatic actions with varying visibility.

import { FACTIONS, FACTION_TRAITS } from './constants.js';
import { game } from './state.js';
import { addEvent, logAction, showToast } from './events.js';

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

  const factionIds = Object.keys(FACTIONS);
  for (const a of factionIds) {
    if (!game.aiRelations[a]) game.aiRelations[a] = {};
    for (const b of factionIds) {
      if (a === b) continue;
      if (game.aiRelations[a][b] === undefined) {
        // Initial relations based on archetype compatibility
        game.aiRelations[a][b] = getInitialRelation(a, b);
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

  // 4. Each AI evaluates and may act toward each other AI
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

  // 5. Check if any secret pacts should activate
  checkSecretPactActivation();

  // 6. Process rumour queue — reveal pending rumours
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

  const warThreshold = traitsA.warThreshold || -25;
  if (relation >= warThreshold) return false;
  if (statsA.military <= (statsB.military || 0) * 0.8) return false;

  // 20% chance per turn when conditions met
  if (Math.random() > 0.20) return false;

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
  modifyRelation(a, b, -30);

  markActed(a, b);
  markActed(b, a);

  // PUBLIC — immediate event
  const msg = `War has broken out between ${factionA.name} and ${factionB.name}!`;
  addEvent(msg, 'diplomacy');
  showToast('War Declared', msg, 5000);
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
  modifyRelation(a, b, -5);
  modifyRelation(b, a, -5);
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
  modifyRelation(a, b, 15);
  modifyRelation(b, a, 15);
  markActed(a, b);

  const factionA = FACTIONS[a];
  const factionB = FACTIONS[b];

  // RUMOURED — vague hint now, confirmation later
  game.rumourQueue.push({
    text: `Whispers suggest ${factionA.name} and ${factionB.name} are growing closer`,
    revealTurn: game.turn + 1,
    type: 'diplomacy',
  });
  game.rumourQueue.push({
    text: `${factionA.name} and ${factionB.name} have formalised an alliance`,
    revealTurn: game.turn + 2 + Math.floor(Math.random() * 2), // 2-3 turns
    type: 'diplomacy',
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
  if (relation <= 0) return false;
  if ((statsA.gold || 0) <= 100) return false;
  if (hasTradeDeal(a, b)) return false;

  const chance = 0.15 + (traitsA.diplomacy || 0) * 0.05;
  if (Math.random() > chance) return false;

  // B accepts if relation positive and they have some diplomatic inclination
  const traitsB = FACTION_TRAITS[b];
  const acceptChance = 0.6 + (traitsB ? traitsB.diplomacy : 0.5) * 0.2;
  if (Math.random() > acceptChance) return false;

  // Trade established
  const goldExchange = 20 + Math.floor(Math.random() * 21); // 20-40
  game.aiTradeDeals.push({
    factions: [a, b],
    turn: game.turn,
    goldPerTurn: goldExchange,
  });
  modifyRelation(a, b, 5);
  modifyRelation(b, a, 5);
  markActed(a, b);

  const factionA = FACTIONS[a];
  const factionB = FACTIONS[b];

  // RUMOURED — appears 1-2 turns after agreement
  game.rumourQueue.push({
    text: `Rumour: Merchants have been seen travelling between ${factionA.name} and ${factionB.name}'s lands`,
    revealTurn: game.turn + 1 + Math.floor(Math.random() * 2),
    type: 'diplomacy',
  });

  logAction('diplomacy', `${factionA.name} and ${factionB.name} establish trade (+${goldExchange}g/turn)`, {
    type: 'ai_trade', factions: [a, b], goldPerTurn: goldExchange,
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
    showToast('Secret Pact Revealed', msg, 6000);
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
    modifyRelation(war.attacker, war.defender, 5);
    modifyRelation(war.defender, war.attacker, 5);
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
          modifyRelation(a, b, 2);
          modifyRelation(b, a, 2);
        }
      } else {
        // At war: relations deteriorate
        modifyRelation(a, b, -2);
        modifyRelation(b, a, -2);
      }

      // Alliances improve relations slowly
      if (hasAlliance(a, b)) {
        modifyRelation(a, b, 1);
        modifyRelation(b, a, 1);
      }

      // Trade deals improve relations slowly
      if (hasTradeDeal(a, b)) {
        modifyRelation(a, b, 1);
        modifyRelation(b, a, 1);
      }
    }
  }
}

// ============================================
// RUMOUR QUEUE PROCESSING
// ============================================
function processRumourQueue() {
  if (!game.rumourQueue || game.rumourQueue.length === 0) return;

  const revealed = [];
  const remaining = [];

  for (const rumour of game.rumourQueue) {
    if (game.turn >= rumour.revealTurn) {
      revealed.push(rumour);
    } else {
      remaining.push(rumour);
    }
  }

  game.rumourQueue = remaining;

  for (const rumour of revealed) {
    addEvent(rumour.text, rumour.type || 'diplomacy');
  }

  if (revealed.length > 0) {
    showToast('Rumours & Whispers', `${revealed.length} new rumour${revealed.length > 1 ? 's' : ''} heard`, 4000);
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================
function modifyRelation(a, b, delta) {
  if (!game.aiRelations[a]) game.aiRelations[a] = {};
  const current = game.aiRelations[a][b] || 0;
  game.aiRelations[a][b] = Math.max(-100, Math.min(100, current + delta));
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
