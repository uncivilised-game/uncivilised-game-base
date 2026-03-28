// ============================================
// INTER-FACTION RELATIONS ENGINE
// ============================================
// Tracks AI-to-AI relationships, evolves them each turn,
// and generates diplomatic events between factions.
// This makes the world feel politically alive — factions
// ally, trade, skirmish, and betray each other independently
// of the player.

import { FACTIONS, FACTION_TRAITS } from './constants.js';
import { game } from './state.js';
import { hexDistance } from './hex.js';
import { addEvent, logAction } from './events.js';

// ── Archetype Affinity Matrix ──
// How much archetypes naturally like each other (-1 to +1).
// Symmetric — order doesn't matter.
const ARCHETYPE_AFFINITY = {
  expansionist:  { expansionist: -0.4, militaristic: 0.1,  diplomatic: 0.2,  cultural: -0.1 },
  militaristic:  { expansionist: 0.1,  militaristic: -0.6, diplomatic: -0.3, cultural: -0.2 },
  diplomatic:    { expansionist: 0.2,  militaristic: -0.3, diplomatic: 0.5,  cultural: 0.4 },
  cultural:      { expansionist: -0.1, militaristic: -0.2, diplomatic: 0.4,  cultural: 0.3 },
};

// ── Relationship Labels ──
function getInterFactionLabel(value) {
  if (value >= 60) return 'Allied';
  if (value >= 30) return 'Friendly';
  if (value >= -10) return 'Neutral';
  if (value >= -40) return 'Tense';
  if (value >= -70) return 'Hostile';
  return 'At War';
}

// ── Core Functions ──

/**
 * Ensure the inter-faction relationship matrix exists on game state.
 * Initializes from archetype affinity + some randomness if missing.
 */
export function ensureInterFactionRelations() {
  if (!game) return;
  if (game.interFactionRelations) return; // already exists
  seedInterFactionRelations();
}

/**
 * Seed the inter-faction relationship matrix for a new game.
 * Uses archetype affinity as a baseline with bounded randomness.
 */
export function seedInterFactionRelations() {
  const fids = Object.keys(FACTIONS);
  const matrix = {};

  for (const a of fids) {
    matrix[a] = {};
    for (const b of fids) {
      if (a === b) { matrix[a][b] = 0; continue; }
      // Only compute once per pair — use alphabetical ordering
      if (a > b) continue;

      const traitsA = FACTION_TRAITS[a];
      const traitsB = FACTION_TRAITS[b];
      if (!traitsA || !traitsB) { matrix[a][b] = 0; continue; }

      // Base affinity from archetypes
      const affinityRow = ARCHETYPE_AFFINITY[traitsA.archetype] || {};
      const baseAffinity = affinityRow[traitsB.archetype] || 0;

      // Convert affinity (-1..+1) to relationship score (-40..+40)
      const baseScore = Math.round(baseAffinity * 40);

      // Add bounded randomness (-15..+15)
      const noise = Math.round((Math.random() - 0.5) * 30);

      const score = Math.max(-60, Math.min(60, baseScore + noise));
      matrix[a][b] = score;
    }
  }

  // Fill the symmetric half
  for (const a of fids) {
    for (const b of fids) {
      if (a === b) continue;
      if (matrix[a][b] === undefined) {
        matrix[a][b] = matrix[b][a];
      }
    }
  }

  game.interFactionRelations = matrix;

  // Track inter-faction wars and alliances
  if (!game.interFactionWars) game.interFactionWars = [];
  if (!game.interFactionAlliances) game.interFactionAlliances = [];
  // Track diplomatic events for the event log (visible to player via gossip)
  if (!game.interFactionEvents) game.interFactionEvents = [];
}

/**
 * Get the relationship value between two AI factions.
 */
export function getInterFactionRelation(factionA, factionB) {
  if (!game.interFactionRelations) return 0;
  return game.interFactionRelations[factionA]?.[factionB] || 0;
}

/**
 * Adjust the relationship between two AI factions symmetrically.
 */
function adjustRelation(factionA, factionB, delta) {
  if (!game.interFactionRelations) return;
  if (!game.interFactionRelations[factionA]) game.interFactionRelations[factionA] = {};
  if (!game.interFactionRelations[factionB]) game.interFactionRelations[factionB] = {};
  game.interFactionRelations[factionA][factionB] =
    clamp((game.interFactionRelations[factionA][factionB] || 0) + delta, -100, 100);
  game.interFactionRelations[factionB][factionA] =
    game.interFactionRelations[factionA][factionB];
}

/**
 * Record an inter-faction event for gossip/intelligence.
 * Capped at 30 entries.
 */
function recordInterFactionEvent(type, factionA, factionB, detail) {
  if (!game.interFactionEvents) game.interFactionEvents = [];
  game.interFactionEvents.push({
    turn: game.turn,
    type,
    factionA,
    factionB,
    detail,
  });
  while (game.interFactionEvents.length > 30) game.interFactionEvents.shift();
}

// ── Per-Turn Processing ──

/**
 * Process inter-faction diplomacy each turn.
 * Call this from endTurn() after processAICommitments().
 *
 * This function:
 * 1. Adjusts relationships based on proximity and territory pressure
 * 2. Probabilistically triggers diplomatic events (alliances, wars, trades, betrayals)
 * 3. Decays extreme relationships toward neutral
 * 4. Surfaces events to the player's event log
 */
export function processInterFactionTurn() {
  ensureInterFactionRelations();
  if (!game.interFactionWars) game.interFactionWars = [];
  if (!game.interFactionAlliances) game.interFactionAlliances = [];

  const fids = Object.keys(FACTIONS).filter(f => game.factionCities[f]); // only alive factions

  // --- 1. Proximity pressure ---
  for (let i = 0; i < fids.length; i++) {
    for (let j = i + 1; j < fids.length; j++) {
      const a = fids[i], b = fids[j];
      const cityA = game.factionCities[a];
      const cityB = game.factionCities[b];
      if (!cityA || !cityB) continue;

      const dist = hexDistance(cityA.col, cityA.row, cityB.col, cityB.row);

      // Close neighbours feel more territorial pressure
      if (dist < 12) {
        const pressure = Math.round((12 - dist) * -0.3);
        adjustRelation(a, b, pressure);
      }

      // Units near each other's cities cause tension
      const aUnitsNearB = game.units.filter(u => u.owner === a && hexDistance(u.col, u.row, cityB.col, cityB.row) <= 4).length;
      const bUnitsNearA = game.units.filter(u => u.owner === b && hexDistance(u.col, u.row, cityA.col, cityA.row) <= 4).length;
      if (aUnitsNearB > 1) adjustRelation(a, b, -2);
      if (bUnitsNearA > 1) adjustRelation(a, b, -2);
    }
  }

  // --- 2. Diplomatic events (probabilistic) ---
  for (let i = 0; i < fids.length; i++) {
    for (let j = i + 1; j < fids.length; j++) {
      const a = fids[i], b = fids[j];
      const rel = getInterFactionRelation(a, b);
      const traitsA = FACTION_TRAITS[a] || {};
      const traitsB = FACTION_TRAITS[b] || {};
      const nameA = FACTIONS[a]?.name || a;
      const nameB = FACTIONS[b]?.name || b;

      const atWar = game.interFactionWars.some(w =>
        (w.a === a && w.b === b) || (w.a === b && w.b === a)
      );
      const allied = game.interFactionAlliances.some(al =>
        (al.a === a && al.b === b) || (al.a === b && al.b === a)
      );

      // --- War declaration ---
      if (!atWar && !allied && rel < -50 && Math.random() < 0.08) {
        // Militaristic factions more likely to start wars
        const aggression = Math.max(traitsA.military || 0, traitsB.military || 0);
        if (Math.random() < aggression) {
          game.interFactionWars.push({ a, b, startTurn: game.turn });
          adjustRelation(a, b, -20);
          const msg = `${nameA} has declared war on ${nameB}!`;
          addEvent(msg, 'combat');
          recordInterFactionEvent('war_declared', a, b, msg);
          logAction('inter-faction', msg, { type: 'war', factionA: a, factionB: b });
          continue; // skip other events for this pair
        }
      }

      // --- Border skirmish (at war) ---
      if (atWar) {
        // Ongoing war erodes relations further
        adjustRelation(a, b, -1);

        // Visible skirmish events (every few turns)
        if (game.turn % 3 === 0 && Math.random() < 0.5) {
          const skirmishEvents = [
            `Skirmishes reported between ${nameA} and ${nameB} forces`,
            `${nameA} raided ${nameB}'s outskirts`,
            `${nameB} repelled ${nameA}'s assault`,
            `Fierce fighting continues between ${nameA} and ${nameB}`,
          ];
          const msg = skirmishEvents[Math.floor(Math.random() * skirmishEvents.length)];
          addEvent(msg, 'combat');
          recordInterFactionEvent('skirmish', a, b, msg);

          // War attrition — both sides lose some military/gold
          const statsA = game.factionStats[a];
          const statsB = game.factionStats[b];
          if (statsA) { statsA.military = Math.max(5, (statsA.military || 20) - 2); statsA.gold = Math.max(0, (statsA.gold || 50) - 5); }
          if (statsB) { statsB.military = Math.max(5, (statsB.military || 20) - 2); statsB.gold = Math.max(0, (statsB.gold || 50) - 5); }
        }

        // Peace chance — increases as war drags on
        const warEntry = game.interFactionWars.find(w =>
          (w.a === a && w.b === b) || (w.a === b && w.b === a)
        );
        const warDuration = game.turn - (warEntry?.startTurn || game.turn);
        const peaceChance = 0.02 + warDuration * 0.01 + (traitsA.diplomacy + traitsB.diplomacy) * 0.02;
        if (Math.random() < peaceChance && warDuration >= 5) {
          game.interFactionWars = game.interFactionWars.filter(w =>
            !((w.a === a && w.b === b) || (w.a === b && w.b === a))
          );
          adjustRelation(a, b, 15);
          const msg = `${nameA} and ${nameB} have signed a peace treaty`;
          addEvent(msg, 'diplomacy');
          recordInterFactionEvent('peace_signed', a, b, msg);
          logAction('inter-faction', msg, { type: 'peace', factionA: a, factionB: b });
        }
        continue; // skip positive events while at war
      }

      // --- Alliance formation ---
      if (!allied && rel >= 40 && Math.random() < 0.06) {
        const dipAvg = ((traitsA.diplomacy || 0) + (traitsB.diplomacy || 0)) / 2;
        if (Math.random() < dipAvg) {
          game.interFactionAlliances.push({ a, b, startTurn: game.turn });
          adjustRelation(a, b, 10);
          const msg = `${nameA} and ${nameB} have formed an alliance`;
          addEvent(msg, 'diplomacy');
          recordInterFactionEvent('alliance_formed', a, b, msg);
          logAction('inter-faction', msg, { type: 'alliance', factionA: a, factionB: b });
        }
      }

      // --- Alliance betrayal (rare) ---
      if (allied && rel < 0 && Math.random() < 0.03) {
        game.interFactionAlliances = game.interFactionAlliances.filter(al =>
          !((al.a === a && al.b === b) || (al.a === b && al.b === a))
        );
        adjustRelation(a, b, -30);
        const betrayer = traitsA.espionage > traitsB.espionage ? nameA : nameB;
        const msg = `${betrayer} has broken their alliance with ${betrayer === nameA ? nameB : nameA}!`;
        addEvent(msg, 'diplomacy');
        recordInterFactionEvent('alliance_broken', a, b, msg);
        logAction('inter-faction', msg, { type: 'betrayal', factionA: a, factionB: b });
      }

      // --- Trade established (friendly factions) ---
      if (rel >= 20 && Math.random() < 0.04) {
        const msg = `${nameA} established trade with ${nameB}`;
        addEvent(msg, 'gold');
        recordInterFactionEvent('trade_established', a, b, msg);
        adjustRelation(a, b, 3);
        // Small economic boost to both
        const statsA = game.factionStats[a];
        const statsB = game.factionStats[b];
        if (statsA) statsA.gold = (statsA.gold || 50) + 5;
        if (statsB) statsB.gold = (statsB.gold || 50) + 5;
      }

      // --- Shared intel about the player (neutral+ factions gossip) ---
      if (rel >= 10 && Math.random() < 0.03 && game.turn > 10) {
        const playerMenace = getPlayerMenaceToFaction(a, b);
        if (playerMenace > 0) {
          const msg = `${nameA} warned ${nameB} about the player's growing power`;
          recordInterFactionEvent('intel_shared', a, b, msg);
          // Both factions become slightly warier of the player
          if (game.relationships[a] !== undefined) game.relationships[a] = Math.max(-60, game.relationships[a] - 2);
          if (game.relationships[b] !== undefined) game.relationships[b] = Math.max(-60, game.relationships[b] - 2);
        }
      }
    }
  }

  // --- 3. Slow decay toward neutral ---
  for (const a of fids) {
    for (const b of fids) {
      if (a >= b) continue;
      const rel = getInterFactionRelation(a, b);
      if (Math.abs(rel) > 5) {
        const decay = rel > 0 ? -0.5 : 0.5;
        adjustRelation(a, b, decay);
      }
    }
  }

  // --- 4. Alliance maintenance —check for expired alliances ---
  if (game.interFactionAlliances) {
    game.interFactionAlliances = game.interFactionAlliances.filter(al => {
      const rel = getInterFactionRelation(al.a, al.b);
      // Alliance dissolves if relationship drops too low
      if (rel < -10) {
        const nameA = FACTIONS[al.a]?.name || al.a;
        const nameB = FACTIONS[al.b]?.name || al.b;
        const msg = `Alliance between ${nameA} and ${nameB} has dissolved`;
        addEvent(msg, 'diplomacy');
        recordInterFactionEvent('alliance_dissolved', al.a, al.b, msg);
        return false;
      }
      return true;
    });
  }

  // --- 5. War cascading — allies join wars ---
  const newWars = [];
  for (const war of (game.interFactionWars || [])) {
    for (const alliance of (game.interFactionAlliances || [])) {
      // If faction A is at war and has an ally, the ally might join
      let warFaction = null, allyFaction = null, enemyFaction = null;
      if (alliance.a === war.a || alliance.b === war.a) {
        warFaction = war.a;
        allyFaction = alliance.a === war.a ? alliance.b : alliance.a;
        enemyFaction = war.b;
      } else if (alliance.a === war.b || alliance.b === war.b) {
        warFaction = war.b;
        allyFaction = alliance.a === war.b ? alliance.b : alliance.a;
        enemyFaction = war.a;
      }
      if (allyFaction && enemyFaction && allyFaction !== enemyFaction) {
        const alreadyAtWar = game.interFactionWars.some(w =>
          (w.a === allyFaction && w.b === enemyFaction) || (w.a === enemyFaction && w.b === allyFaction)
        ) || newWars.some(w =>
          (w.a === allyFaction && w.b === enemyFaction) || (w.a === enemyFaction && w.b === allyFaction)
        );
        if (!alreadyAtWar && Math.random() < 0.15) {
          newWars.push({ a: allyFaction, b: enemyFaction, startTurn: game.turn });
          adjustRelation(allyFaction, enemyFaction, -20);
          const msg = `${FACTIONS[allyFaction]?.name} joins the war against ${FACTIONS[enemyFaction]?.name} (allied with ${FACTIONS[warFaction]?.name})`;
          addEvent(msg, 'combat');
          recordInterFactionEvent('war_joined', allyFaction, enemyFaction, msg);
        }
      }
    }
  }
  game.interFactionWars.push(...newWars);
}

// ── Gossip / Intelligence ──

/**
 * Build a context string for a specific AI faction describing their
 * relationships with all other AI factions. Injected into the system
 * prompt so the AI can gossip about and reference other factions.
 */
export function buildInterFactionContext(factionId) {
  ensureInterFactionRelations();
  if (!game.interFactionRelations) return '';

  const fids = Object.keys(FACTIONS).filter(f => f !== factionId && game.factionCities[f]);
  if (fids.length === 0) return '';

  const lines = [];
  for (const other of fids) {
    const rel = getInterFactionRelation(factionId, other);
    const label = getInterFactionLabel(rel);
    const name = FACTIONS[other]?.name || other;

    const atWar = (game.interFactionWars || []).some(w =>
      (w.a === factionId && w.b === other) || (w.a === other && w.b === factionId)
    );
    const allied = (game.interFactionAlliances || []).some(al =>
      (al.a === factionId && al.b === other) || (al.a === other && al.b === factionId)
    );

    let status = label;
    if (atWar) status = 'AT WAR';
    else if (allied) status = 'ALLIED';

    lines.push(`- ${name}: ${status} (${rel})`);
  }

  // Recent inter-faction events this faction was involved in
  const recentEvents = (game.interFactionEvents || [])
    .filter(e => e.factionA === factionId || e.factionB === factionId)
    .slice(-5)
    .reverse()
    .map(e => `  Turn ${e.turn}: ${e.detail}`);

  // Other factions' wars (intelligence / gossip material)
  const otherWars = (game.interFactionWars || [])
    .filter(w => w.a !== factionId && w.b !== factionId)
    .map(w => `  ${FACTIONS[w.a]?.name || w.a} vs ${FACTIONS[w.b]?.name || w.b} (since turn ${w.startTurn})`);

  let ctx = `\nYOUR RELATIONS WITH OTHER RULERS:\n${lines.join('\n')}`;

  if (recentEvents.length > 0) {
    ctx += `\n\nRecent diplomatic events involving you:\n${recentEvents.join('\n')}`;
  }
  if (otherWars.length > 0) {
    ctx += `\n\nWars between other factions (gossip material):\n${otherWars.join('\n')}`;
  }

  ctx += `\n\nIMPORTANT: Reference your relationships with other rulers naturally in conversation. If the player asks about another faction, share your genuine opinion based on your relationship. If you're at war with someone, mention it. If you have allies, leverage that in negotiations. This political web is real — use it.`;

  return ctx;
}

/**
 * Build a simplified inter-faction context for sending to the server.
 * Returns a JSON-serialisable object (not a prompt string).
 */
export function getInterFactionPayload(factionId) {
  ensureInterFactionRelations();
  if (!game.interFactionRelations) return null;

  const fids = Object.keys(FACTIONS).filter(f => f !== factionId && game.factionCities[f]);
  const relations = {};
  for (const other of fids) {
    const rel = getInterFactionRelation(factionId, other);
    const atWar = (game.interFactionWars || []).some(w =>
      (w.a === factionId && w.b === other) || (w.a === other && w.b === factionId)
    );
    const allied = (game.interFactionAlliances || []).some(al =>
      (al.a === factionId && al.b === other) || (al.a === other && al.b === factionId)
    );
    relations[other] = {
      name: FACTIONS[other]?.name || other,
      score: rel,
      label: getInterFactionLabel(rel),
      atWar,
      allied,
    };
  }

  const recentEvents = (game.interFactionEvents || [])
    .filter(e => e.factionA === factionId || e.factionB === factionId)
    .slice(-5);

  const otherWars = (game.interFactionWars || [])
    .filter(w => w.a !== factionId && w.b !== factionId)
    .map(w => ({
      factionA: w.a, nameA: FACTIONS[w.a]?.name || w.a,
      factionB: w.b, nameB: FACTIONS[w.b]?.name || w.b,
      since: w.startTurn,
    }));

  return { relations, recentEvents, otherWars };
}

// ── Helpers ──

function getPlayerMenaceToFaction(factionA, factionB) {
  // Heuristic: player's military relative to factions
  const playerMil = game.military || 0;
  const avgFactionMil = ((game.factionStats[factionA]?.military || 10) + (game.factionStats[factionB]?.military || 10)) / 2;
  return playerMil > avgFactionMil * 1.5 ? 1 : 0;
}

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }
