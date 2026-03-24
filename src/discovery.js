import { MAP_COLS, MAP_ROWS, FACTIONS } from './constants.js';
import { game, API } from './state.js';
import { hexDistance } from './hex.js';
import { initFactionStats } from './map.js';
import { addEvent, logAction, countPlayerTerritory } from './events.js';
import { openChat, appendChatMessage, processCharacterAction, updateDiploActions } from './diplomacy.js';
import { updateUI } from './leaderboard.js';
import { render } from './render.js';
import { closeAllPanels } from './ui-panels.js';

function revealAround(col, row, radius) {
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (hexDistance(c, r, col, row) <= radius) {
        const wasHidden = !game.fogOfWar[r][c];
        game.fogOfWar[r][c] = true;
        // Check for first contact with faction cities
        if (wasHidden) {
          for (const [fid, fc] of Object.entries(game.factionCities)) {
            if (fc.col === c && fc.row === r && !game.metFactions[fid]) {
              discoverFaction(fid, 'exploration');
            }
          }
          // Check for faction units on this tile
          for (const unit of game.units) {
            if (unit.owner !== 'player' && unit.col === c && unit.row === r && !game.metFactions[unit.owner]) {
              discoverFaction(unit.owner, 'encounter');
            }
          }
        }
      }
    }
  }
}

// Sweep all faction cities and units — if any sit on a tile the player has
// already revealed (fogOfWar === true), auto-discover that faction.
function discoverVisibleFactions() {
  // Check faction capital cities
  for (const [fid, fc] of Object.entries(game.factionCities)) {
    if (game.metFactions[fid]) continue;
    if (game.fogOfWar[fc.row] && game.fogOfWar[fc.row][fc.col]) {
      discoverFaction(fid, 'exploration');
    }
  }
  // Check AI expansion cities
  if (game.aiFactionCities) {
    for (const [fid, cities] of Object.entries(game.aiFactionCities)) {
      if (game.metFactions[fid]) continue;
      for (const ec of cities) {
        if (game.fogOfWar[ec.row] && game.fogOfWar[ec.row][ec.col]) {
          discoverFaction(fid, 'exploration');
          break;
        }
      }
    }
  }
  // Check faction units on revealed tiles
  for (const unit of game.units) {
    if (unit.owner === 'player') continue;
    if (game.metFactions[unit.owner]) continue;
    if (game.fogOfWar[unit.row] && game.fogOfWar[unit.row][unit.col]) {
      discoverFaction(unit.owner, 'encounter');
    }
  }
}

function discoverFaction(factionId, method) {
  if (!game.metFactions) game.metFactions = {};
  if (game.metFactions[factionId]) return;
  const faction = FACTIONS[factionId];
  game.metFactions[factionId] = { turn: game.turn, method: method };
  const methodText = method === 'introduction'
    ? `introduced to you by an ally`
    : method === 'encounter'
    ? `encountered by your scouts`
    : `discovered through exploration`;
  logAction('diplomacy', 'First contact with ' + faction.name + ' via ' + method, { factionId, method });
  addEvent(`First Contact: ${faction.name} — ${methodText}!`, 'diplomacy');
  // Initialize faction stats on discovery
  if (!game.factionStats[factionId]) {
    initFactionStats(factionId);
  }
  // Queue auto-greeting (runs after current turn processing completes)
  if (method !== 'introduction') {
    // Small delay so the turn processing finishes before opening the chat
    setTimeout(() => triggerFirstContactGreeting(factionId, method), 600);
  }
}

async function triggerFirstContactGreeting(factionId, method) {
  const faction = FACTIONS[factionId];
  if (!faction) return;

  // Open the chat panel for this faction
  game._firstContactPending = true;
  closeAllPanels();
  openChat(factionId);
  game._firstContactPending = false;

  // Build a contextual first-contact message from the player's perspective
  let contactMessage;
  if (method === 'encounter') {
    contactMessage = `[FIRST CONTACT] Our scouts have encountered warriors bearing your banners in the wilderness. I am the leader of a growing civilization. We come in the spirit of discovery — though we stand ready to defend ourselves if needed. What are your intentions?`;
  } else {
    contactMessage = `[FIRST CONTACT] Our explorers have discovered your great city from afar. I am the leader of a neighboring civilization. We wish to establish diplomatic relations. How do you greet a new neighbor?`;
  }

  // Mark this as a free envoy interaction (first contact doesn't cost envoys)
  game.envoySpentThisTurn[factionId] = true;

  // Display the system first-contact banner
  appendChatMessage('system', `\u{1F30D} First Contact \u2014 You have ${method === 'encounter' ? 'encountered forces of' : 'discovered the lands of'} ${faction.name}, ${faction.title}.`);

  // Show the auto-message from the player
  appendChatMessage('player', contactMessage);

  if (!game.conversationHistories[factionId]) {
    game.conversationHistories[factionId] = [];
  }
  game.conversationHistories[factionId].push({ role: 'user', content: contactMessage });

  // Show typing indicator
  const typing = appendChatMessage('npc typing', '...');

  // Send to the AI for an in-character greeting response
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
      first_contact: true,
      discovery_method: method,
    };

    const response = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character_id: factionId,
        message: contactMessage,
        game_state: gameState,
        conversation_history: [],
      }),
    });

    const data = await response.json();
    typing.remove();
    appendChatMessage('npc', data.reply);
    game.conversationHistories[factionId].push({ role: 'assistant', content: data.reply });

    if (data.action && data.action.type !== 'none') {
      processCharacterAction(factionId, data.action);
    }
    updateDiploActions(factionId);
  } catch (err) {
    typing.remove();
    appendChatMessage('npc', getOfflineFirstContactGreeting(factionId));
    console.error('First contact API error:', err);
  }

  updateUI();
  render();
}

// Offline fallback greetings based on personality
function getOfflineFirstContactGreeting(factionId) {
  const greetings = {
    emperor_valerian: `*stands tall, fur cloak billowing* So, a new power emerges from the wilderness. I am Aethelred, High Chieftain of the Northern Trade. Know this: we have built a trading confederation through strength and honour. Whether you become a valued partner or a conquered territory... that depends entirely on your next words.`,
    shadow_kael: `*strides forward in bronze armour, hand on sword pommel* Interesting. Our network has been watching your little civilization for some time now. I am Kael, Warlord of the Ashland Hegemony. My hegemony was forged in fire and blood. Show strength and I may consider you an equal. Show weakness and you become a target.`,
    merchant_prince_castellan: `*regards you with regal composure, jewelled collar gleaming* Welcome, welcome! A new civilization means new markets, new trade routes, new opportunities! I am Tariq, Queen of the Red Sea routes. Commerce is the lifeblood of civilization. Shall we discuss mutual prosperity?`,
    pirate_queen_elara: `*gazes at you with unseeing eyes that somehow see everything* Well, well. Fresh blood on the horizon. I am Pythia Ione, Oracle of the Marble Isle. The threads of fate have drawn you here. I have foreseen this meeting... and what may come after. Choose your path wisely, for I can see where each one leads.`,
    commander_thane: `*stands rigid, hand on sword hilt* I am Commander Thane of the Iron Legions. We respect strength and discipline above all else. If your army is worthy, we may forge an alliance. If not... stay out of our territory. That is my only warning.`,
    rebel_leader_sera: `*raises weathered hands in blessing, golden laurels catching the light* Greetings, traveler. I am 'Ula, High Priestess of the Elder Grove. The ancient trees have whispered your name to me. We are guardians of the old ways and keepers of sacred knowledge. Come to us with reverence and we shall share wisdom. Come with greed and the forest itself shall turn against you.`,
  };
  return greetings[factionId] || `*regards you with interest* A new civilization. How... unexpected. Let us see what kind of neighbor you turn out to be.`;
}

function scanForFirstContact() {
  // Scan all currently visible tiles for faction cities and units
  if (!game.metFactions) game.metFactions = {};
  if (!game.factionStats) game.factionStats = {};
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (!game.fogOfWar[r][c]) continue;
      // Check faction cities
      for (const [fid, fc] of Object.entries(game.factionCities)) {
        if (fc.col === c && fc.row === r && !game.metFactions[fid]) {
          discoverFaction(fid, 'exploration');
        }
      }
      // Check faction units
      for (const unit of game.units) {
        if (unit.owner !== 'player' && unit.col === c && unit.row === r && !game.metFactions[unit.owner]) {
          discoverFaction(unit.owner, 'encounter');
        }
      }
    }
  }
}

export {
  revealAround,
  discoverVisibleFactions,
  discoverFaction,
  triggerFirstContactGreeting,
  getOfflineFirstContactGreeting,
  scanForFirstContact,
};
