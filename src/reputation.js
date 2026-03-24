// ============================================
// REPUTATION & DIPLOMATIC MEMORY ENGINE
// ============================================
// Tracks multi-dimensional reputation per faction.
// Reputation is the AI's "compressed memory" of player behaviour.
// Players never see their scores — they infer reputation through AI tone.

import { FACTIONS } from './constants.js';
import { game } from './state.js';
import { addEvent, logAction } from './events.js';

// ── Reputation Dimensions ──
// honour:      Do you keep your word?
// generosity:  Do you give more than you take?
// menace:      How militarily threatening are you?
// reliability: Do you follow through on commitments?
// cunning:     Have you been caught manipulating?

// ── Per-Faction Weights ──
// Each faction interprets reputation through their own personality lens.
export const REPUTATION_WEIGHTS = {
  emperor_valerian: {
    honour: 1.5, generosity: 0.5, menace: 1.0, reliability: 1.2, cunning: -1.0,
  },
  shadow_kael: {
    honour: 0.3, generosity: 0.5, menace: 0.8, reliability: 1.0, cunning: 1.5,
  },
  merchant_prince_castellan: {
    honour: 0.8, generosity: 1.2, menace: -0.5, reliability: 1.5, cunning: 0.3,
  },
  pirate_queen_elara: {
    honour: 1.0, generosity: 0.8, menace: 1.2, reliability: 0.5, cunning: 1.0,
  },
  commander_thane: {
    honour: 1.5, generosity: 0.3, menace: 1.0, reliability: 1.5, cunning: -1.5,
  },
  rebel_leader_sera: {
    honour: 1.0, generosity: 1.5, menace: -1.0, reliability: 1.0, cunning: -0.5,
  },
};

// ── Decay Rates (per turn, toward zero) ──
const DECAY_RATES = {
  honour: 0.5,
  generosity: 1.0,
  menace: 0.5,
  reliability: 0.3,
  cunning: 0.3,
};

// ── Event → Delta Mapping ──
const EVENT_DELTAS = {
  // Agreements & Treaties
  alliance_formed:        { honour: 5,   generosity: 0,   menace: 0,   reliability: 0,   cunning: 0 },
  alliance_honoured:      { honour: 15,  generosity: 0,   menace: 0,   reliability: 10,  cunning: 0 },
  alliance_broken:        { honour: -30, generosity: 0,   menace: 10,  reliability: -20, cunning: 5 },
  defense_pact_formed:    { honour: 5,   generosity: 5,   menace: 0,   reliability: 0,   cunning: 0 },
  defense_pact_honoured:  { honour: 10,  generosity: 10,  menace: 5,   reliability: 15,  cunning: 0 },
  nap_formed:             { honour: 3,   generosity: 0,   menace: -5,  reliability: 0,   cunning: 0 },
  nap_broken:             { honour: -20, generosity: 0,   menace: 15,  reliability: -15, cunning: 5 },
  open_borders_accepted:  { honour: 3,   generosity: 3,   menace: -3,  reliability: 0,   cunning: 0 },
  ceasefire_accepted:     { honour: 5,   generosity: 0,   menace: -5,  reliability: 0,   cunning: 0 },
  peace_signed:           { honour: 5,   generosity: 0,   menace: -10, reliability: 0,   cunning: 0 },
  marriage_formed:        { honour: 8,   generosity: 5,   menace: 0,   reliability: 0,   cunning: 0 },

  // Trade & Economy
  trade_deal_accepted:    { honour: 3,   generosity: 0,   menace: 0,   reliability: 0,   cunning: 0 },
  trade_deal_honoured:    { honour: 5,   generosity: 3,   menace: 0,   reliability: 8,   cunning: 0 },
  gift_sent:              { honour: 0,   generosity: 5,   menace: 0,   reliability: 0,   cunning: 0 },
  tribute_paid:           { honour: 0,   generosity: 8,   menace: -5,  reliability: 5,   cunning: 0 },
  tribute_demanded:       { honour: 0,   generosity: -10, menace: 10,  reliability: 0,   cunning: 0 },
  embargo_imposed:        { honour: -5,  generosity: -10, menace: 10,  reliability: 0,   cunning: 0 },
  vassalage_imposed:      { honour: -3,  generosity: -15, menace: 15,  reliability: 0,   cunning: 0 },
  tech_shared:            { honour: 3,   generosity: 5,   menace: 0,   reliability: 0,   cunning: 0 },
  resource_traded:        { honour: 2,   generosity: 2,   menace: 0,   reliability: 0,   cunning: 0 },

  // Military & Aggression
  war_declared:           { honour: -5,  generosity: 0,   menace: 20,  reliability: 0,   cunning: 0 },
  surprise_attack:        { honour: -40, generosity: 0,   menace: 25,  reliability: -30, cunning: 15 },
  attack_committed:       { honour: 0,   generosity: 0,   menace: 5,   reliability: 0,   cunning: 5 },
  threat_issued:          { honour: -3,  generosity: 0,   menace: 10,  reliability: 0,   cunning: 0 },
  proposal_rejected:      { honour: -2,  generosity: 0,   menace: 0,   reliability: 0,   cunning: 0 },
  unit_gifted:            { honour: 0,   generosity: 10,  menace: 0,   reliability: 5,   cunning: 0 },

  // Cross-faction
  contradiction_detected: { honour: 0,   generosity: 0,   menace: 0,   reliability: 0,   cunning: 10 },
  betrayal_witnessed:     { honour: 0,   generosity: 0,   menace: 0,   reliability: 0,   cunning: 8 },
};

// ── Core Functions ──

/** Ensure reputation structures exist on game state */
export function ensureReputationState() {
  if (!game.reputation) game.reputation = {};
  if (!game.diplomaticLedger) game.diplomaticLedger = {};
  if (!game.diplomaticSummaries) game.diplomaticSummaries = {};
  for (const fid of Object.keys(FACTIONS)) {
    if (!game.reputation[fid]) {
      game.reputation[fid] = { honour: 0, generosity: 0, menace: 0, reliability: 0, cunning: 0 };
    }
    if (!game.diplomaticLedger[fid]) game.diplomaticLedger[fid] = [];
    if (!game.diplomaticSummaries[fid]) game.diplomaticSummaries[fid] = null;
  }
}

/**
 * Update a faction's reputation based on a game event.
 * @param {string} factionId - which faction observed the event
 * @param {string} eventType - key from EVENT_DELTAS
 * @param {string} [detail] - human-readable description for ledger
 * @param {object} [overrideDelta] - optional custom delta instead of EVENT_DELTAS lookup
 */
export function updateReputation(factionId, eventType, detail, overrideDelta) {
  ensureReputationState();
  const delta = overrideDelta || EVENT_DELTAS[eventType];
  if (!delta) {
    console.warn(`[REPUTATION] Unknown event type: ${eventType}`);
    return;
  }
  const rep = game.reputation[factionId];
  if (!rep) return;

  // Apply deltas with clamping
  for (const dim of ['honour', 'generosity', 'menace', 'reliability', 'cunning']) {
    if (delta[dim]) {
      rep[dim] = clamp(rep[dim] + delta[dim], -100, 100);
    }
  }

  // Add ledger entry
  addLedgerEntry(factionId, eventType, detail || eventType.replace(/_/g, ' '), delta);

  logAction('reputation', `${factionId}: ${eventType}`, {
    factionId, eventType, delta,
    scores: { ...rep },
  });
}

/**
 * Broadcast a reputation event to all factions (e.g. betrayal witnessed by everyone).
 * @param {string} eventType
 * @param {string} [detail]
 * @param {string} [excludeFaction] - don't update this faction (e.g. the directly affected one)
 */
export function broadcastReputation(eventType, detail, excludeFaction) {
  for (const fid of Object.keys(FACTIONS)) {
    if (fid !== excludeFaction) {
      updateReputation(fid, eventType, detail);
    }
  }
}

/** Add a structured entry to a faction's diplomatic ledger. Capped at 30 entries. */
function addLedgerEntry(factionId, event, detail, delta) {
  const ledger = game.diplomaticLedger[factionId];
  if (!ledger) return;
  ledger.push({
    turn: game.turn,
    event,
    detail,
    reputationDelta: { ...delta },
  });
  // Cap at 30 entries — remove oldest
  while (ledger.length > 30) ledger.shift();
}

/**
 * Decay all reputation scores toward zero. Called at end of turn.
 */
export function decayReputation() {
  ensureReputationState();
  for (const fid of Object.keys(FACTIONS)) {
    const rep = game.reputation[fid];
    for (const dim of ['honour', 'generosity', 'menace', 'reliability', 'cunning']) {
      const rate = DECAY_RATES[dim];
      if (rep[dim] > 0) {
        rep[dim] = Math.max(0, rep[dim] - rate);
      } else if (rep[dim] < 0) {
        rep[dim] = Math.min(0, rep[dim] + rate);
      }
    }
  }
}

/**
 * Detect cross-faction contradictions that increase cunning scores.
 * Called at end of turn.
 */
export function detectContradictions() {
  ensureReputationState();
  const alliances = game.activeAlliances || {};
  const wars = (game.aiCommitments || []).filter(c => c.type === 'war' || c.type === 'wage_war_on');
  const attackCommits = (game.aiCommitments || []).filter(c => c.type === 'attack_faction');

  // Check: player allied with faction A while attacking faction A's ally
  for (const [alliedFid] of Object.entries(alliances)) {
    for (const commit of attackCommits) {
      // If player asked someone to attack a faction they're allied with
      if (commit.target === alliedFid) {
        updateReputation(alliedFid, 'contradiction_detected',
          'Detected: player is undermining alliance');
      }
    }
  }

  // Check: player has open borders with factions at war with each other
  const openBorderFids = Object.keys(game.openBorders || {});
  for (let i = 0; i < openBorderFids.length; i++) {
    for (let j = i + 1; j < openBorderFids.length; j++) {
      const a = openBorderFids[i];
      const b = openBorderFids[j];
      // If these two factions are at war (one has a war commitment against the other)
      const atWar = wars.some(w =>
        (w.factionId === a && w.target === b) ||
        (w.factionId === b && w.target === a)
      );
      if (atWar) {
        updateReputation(a, 'contradiction_detected',
          'Open borders with your enemy');
        updateReputation(b, 'contradiction_detected',
          'Open borders with your enemy');
      }
    }
  }
}

/**
 * Compute a faction's weighted disposition toward the player.
 * Returns a score roughly in -100..+100 range.
 */
export function computeDisposition(factionId) {
  ensureReputationState();
  const rep = game.reputation[factionId];
  const weights = REPUTATION_WEIGHTS[factionId];
  if (!rep || !weights) return 0;

  let score = 0;
  for (const dim of ['honour', 'generosity', 'menace', 'reliability', 'cunning']) {
    score += (rep[dim] || 0) * (weights[dim] || 0);
  }
  // Normalise: max raw ≈ 5 × 100 × 1.5 = 750, divide by 7.5
  return clamp(Math.round(score / 7.5), -100, 100);
}

/** Map disposition score to a qualitative label */
export function getDispositionLabel(score) {
  if (score >= 80) return 'Devoted';
  if (score >= 50) return 'Trusting';
  if (score >= 20) return 'Warm';
  if (score >= -19) return 'Neutral';
  if (score >= -49) return 'Wary';
  if (score >= -79) return 'Hostile';
  return 'Nemesis';
}

/** Get a qualitative label for a single reputation dimension */
function getDimLabel(value) {
  if (value >= 60) return 'Exemplary';
  if (value >= 30) return 'Strong';
  if (value >= 10) return 'Decent';
  if (value >= -9) return 'Neutral';
  if (value >= -29) return 'Poor';
  if (value >= -59) return 'Bad';
  return 'Terrible';
}

/**
 * Generate a deterministic narrative summary from reputation + ledger.
 * No LLM call — template-based.
 */
export function generateDeterministicSummary(factionId) {
  ensureReputationState();
  const rep = game.reputation[factionId];
  const ledger = game.diplomaticLedger[factionId] || [];
  if (!rep) return 'No prior history.';

  const parts = [];

  // Honour
  if (rep.honour > 30) parts.push('has proven trustworthy in dealings');
  else if (rep.honour < -30) parts.push('has a history of breaking agreements');

  // Generosity
  if (rep.generosity > 30) parts.push('has been generous in trade and gifts');
  else if (rep.generosity < -20) parts.push('tends to take more than they give');

  // Menace
  if (rep.menace > 40) parts.push('commands a threatening military presence');
  else if (rep.menace < -20) parts.push('appears militarily passive');

  // Reliability
  if (rep.reliability > 30) parts.push('follows through on commitments');
  else if (rep.reliability < -20) parts.push('has failed to deliver on promises');

  // Cunning
  if (rep.cunning > 30) parts.push('is known for political manipulation');
  else if (rep.cunning < -10) parts.push('deals straightforwardly');

  if (parts.length === 0) parts.push('is still largely unknown');

  // Recent events
  let recentStr = '';
  if (ledger.length > 0) {
    const last = ledger[ledger.length - 1];
    recentStr = ` Most recently (turn ${last.turn}): ${last.detail}.`;
  }

  return `The player ${parts.join(', ')}.${recentStr}`;
}

/**
 * Build the DIPLOMATIC MEMORY prompt section for a specific faction.
 * This string gets injected into the system prompt sent to Claude.
 */
export function formatReputationForPrompt(factionId) {
  ensureReputationState();
  const rep = game.reputation[factionId];
  if (!rep) return '';

  const disposition = computeDisposition(factionId);
  const dispLabel = getDispositionLabel(disposition);
  const ledger = game.diplomaticLedger[factionId] || [];
  const summary = game.diplomaticSummaries[factionId]?.text
    || generateDeterministicSummary(factionId);

  // Count broken agreements
  const brokenCount = ledger.filter(e =>
    e.event === 'alliance_broken' ||
    e.event === 'nap_broken' ||
    e.event === 'surprise_attack'
  ).length;

  // Build active agreements list
  const activeAgreements = [];
  if (game.activeAlliances?.[factionId]) activeAgreements.push('Alliance');
  if (game.defensePacts?.[factionId]) activeAgreements.push('Mutual Defense');
  if (game.tradeDeals?.[factionId]) activeAgreements.push('Trade Deal');
  if (game.openBorders?.[factionId]) activeAgreements.push('Open Borders');
  if (game.nonAggressionPacts?.[factionId]) activeAgreements.push('Non-Aggression');
  if (game.ceasefires?.[factionId]) activeAgreements.push('Ceasefire');
  if (game.marriages?.[factionId]) activeAgreements.push('Marriage');
  if (game.vassals?.[factionId]) activeAgreements.push('Vassal');

  // Top 5 ledger entries (most recent first)
  const recentEntries = ledger.slice(-5).reverse()
    .map(e => `- Turn ${e.turn}: ${e.detail}`)
    .join('\n');

  return `
DIPLOMATIC MEMORY — YOUR PERCEPTION OF THIS PLAYER:

Overall Disposition: ${dispLabel} (${disposition})
- Honour: ${Math.round(rep.honour)} (${getDimLabel(rep.honour)})
- Generosity: ${Math.round(rep.generosity)} (${getDimLabel(rep.generosity)})
- Military Threat: ${Math.round(rep.menace)} (${getDimLabel(rep.menace)})
- Reliability: ${Math.round(rep.reliability)} (${getDimLabel(rep.reliability)})
- Cunning: ${Math.round(rep.cunning)} (${getDimLabel(rep.cunning)})

${recentEntries ? 'Key Facts (most recent first):\n' + recentEntries : 'No significant diplomatic events yet.'}

Narrative: ${summary}

Active Agreements: ${activeAgreements.length > 0 ? activeAgreements.join(', ') : 'None'}
Broken Agreements: ${brokenCount}

IMPORTANT: Let your disposition colour your tone, trust level, and willingness to deal. A player with low Honour should face suspicion. High Menace warrants caution. Adapt to what you KNOW from experience.`;
}

// ── Utility ──
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

export {
  EVENT_DELTAS,
  DECAY_RATES,
};
