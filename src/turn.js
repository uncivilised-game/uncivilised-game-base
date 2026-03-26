import { MAX_TURNS, UNIT_TYPES, BUILDINGS, TECHNOLOGIES, CIVICS, GOVERNMENTS, WONDERS, FACTIONS, FACTION_TRAITS, GREAT_PEOPLE_TYPES, LUXURY_RESOURCES, RESOURCES, MAP_COLS, MAP_ROWS, UNIT_MAINTENANCE } from './constants.js';
import { game, safeStorage, API } from './state.js';
import { hexDistance, getHexNeighbors } from './hex.js';
import { getTileYields, updateFactionStats, initFactionStats } from './map.js';
import { processAITurns, processBarbarianTurns, processAICommitments } from './diplomacy-api.js';
import { processImprovements, getImprovementYields } from './improvements.js';
import { addEvent, logAction, showToast, showCompletionNotification, generateFactionIntelReports, generateRumours, showIntelNotification, countPlayerTerritory } from './events.js';
import { render, markVisibilityDirty } from './render.js';
import { checkVictoryConditions, hideSelectionPanel, closeAllPanels } from './ui-panels.js';
import { updateUI, updateEnvoyUI, submitToLeaderboard, showLeaderboard } from './leaderboard.js';
import { showGreatPersonNotification, useGreatPerson, showPantheonPicker } from './buildings.js';
import { discoverVisibleFactions, revealAround } from './discovery.js';
import { processUnitWaypoint } from './improvements.js';
import { isTilePassable } from './map.js';
import { getUnitAt } from './combat.js';
import { decayReputation, detectContradictions, updateReputation, ensureReputationState } from './reputation.js';
import { createUnit, selectUnit, autoSelectNext } from './units.js';
import { autoSave } from './save-load.js';
import { clampCamera } from './input.js';
import { processAIDiplomacy, resetTurnActions, processAITradeIncome } from './ai-diplomacy.js';

let _processingTurn = false;

function endTurn() {
  if (!game || game.turn > MAX_TURNS) return;
  if (_processingTurn) return; // prevent double-click / re-entrance
  _processingTurn = true;
  markVisibilityDirty();
  const btn = document.getElementById('btn-end-turn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
  try {

  // Dismiss intel/rumour banner from previous turn
  const intelBanner = document.getElementById('intel-banner');
  if (intelBanner) intelBanner.style.display = 'none';

  const events = [];

  // --- Auto-discover factions whose cities/units are in revealed tiles ---
  discoverVisibleFactions();

  // --- Process AI first ---
  processAITurns();

  // --- AI-to-AI diplomacy (rule-based negotiations between AI factions) ---
  resetTurnActions();
  processAIDiplomacy();
  processAITradeIncome();

  // --- Reset player unit move points and process waypoints ---
  for (const unit of game.units) {
    if (unit.owner !== 'player') continue;
    const ut = UNIT_TYPES[unit.type];
    unit.moveLeft = ut.movePoints;

    // Process multi-turn waypoint movement
    if (unit.waypoint && !unit.sleeping && !unit.fortified) {
      processUnitWaypoint(unit);
    }

    // Healing system
    if (unit.hp < 100) {
      let healAmount = 0;
      // In city: +20 HP
      const inCity = game.cities.some(c => c.col === unit.col && c.row === unit.row);
      if (inCity) {
        healAmount = 20;
      } else if (unit.fortified) {
        // Fortified: +10 HP
        healAmount = 10;
      } else if (unit.moveLeft === ut.movePoints) {
        // Didn't move last turn (full moves remaining means they were idle): +5 HP
        healAmount = 5;
      }
      // Medic aura: adjacent friendly units with medic promotion heal +10
      const nearbyMedics = game.units.filter(u => u.owner === 'player' && u.id !== unit.id && (u.promotions || []).includes('medic') && hexDistance(u.col, u.row, unit.col, unit.row) <= 1);
      if (nearbyMedics.length > 0) healAmount += 10;

      if (healAmount > 0) {
        const oldHp = unit.hp;
        unit.hp = Math.min(100, unit.hp + healAmount);
        if (unit.hp >= 100 && oldHp < 100) {
          if (unit.fortified) unit.fortified = false;
          addEvent(`${ut.name} fully healed`, 'combat');
        }
      }
    }

    // Alert: wake up if enemy within 3 hexes
    if (unit.alert) {
      const nearbyEnemy = game.units.find(u =>
        u.owner !== 'player' && hexDistance(u.col, u.row, unit.col, unit.row) <= 3
      );
      if (nearbyEnemy) {
        unit.alert = false;
        unit.sleeping = false;
        addEvent(`${ut.name} spotted an enemy!`, 'combat');
      }
    }
  }

  // --- Unit maintenance costs ---
  let totalMaint = 0;
  for (const unit of game.units) {
    if (unit.owner !== 'player') continue;
    totalMaint += UNIT_MAINTENANCE[unit.type] || 0;
  }

  // --- Income (net of maintenance) ---
  const netGold = game.goldPerTurn - totalMaint;
  game.gold += netGold;
  if (totalMaint > 0) {
    events.push(`Gold: +${game.goldPerTurn} income, -${totalMaint} maintenance = ${netGold >= 0 ? '+' : ''}${netGold} net`);
  } else {
    events.push(`Gold: +${game.goldPerTurn}`);
  }

  // --- Trade route income ---
  let tradeGold = 0;
  const maxRoutes = 1 + (game.civics.includes('foreign_trade') ? 1 : 0) + (game.buildings.includes('harbor') ? 1 : 0);
  game.maxTradeRoutes = maxRoutes;
  for (const route of (game.tradeRoutes || [])) {
    const fc = game.factionCities[route.factionId];
    if (!fc || !game.cities.length) continue;
    const dist = hexDistance(game.cities[0].col, game.cities[0].row, fc.col, fc.row);
    let rGold = 2 + Math.floor(dist / 5);
    const rel = game.relationships[route.factionId] || 0;
    if (game.activeAlliances[route.factionId]) rGold += 2;
    else if (rel > 0) rGold += 1;
    tradeGold += rGold;
  }
  if (tradeGold > 0) { game.gold += tradeGold; events.push('Trade: +' + tradeGold + ' Gold'); }

  // --- Happiness calculation ---
  let hap = 5;
  // Luxury resources in territory
  for (const city of game.cities) {
    const br = city.borderRadius || 2;
    for (let r = 0; r < MAP_ROWS; r++) for (let c = 0; c < MAP_COLS; c++) {
      if (hexDistance(c, r, city.col, city.row) <= br) {
        const t = game.map[r][c];
        if (t.resource && LUXURY_RESOURCES.includes(t.resource)) hap += 1;
      }
    }
  }
  // Buildings
  if (game.buildings.includes('temple')) hap += 2;
  if (game.buildings.includes('garden')) hap += 1;
  if (game.buildings.includes('arena')) hap += 2;
  // Penalties
  hap -= Math.max(0, game.cities.length - 1);
  hap -= Math.floor(game.units.filter(u => u.owner === 'player').length / 5);
  game.happiness = hap;


  // --- Resource bonuses from territory (respects city border radius) ---
  let resBonus = { food: 0, gold: 0, prod: 0 };
  for (const city of game.cities) {
    const bRadius = city.borderRadius || 2;
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (hexDistance(c, r, city.col, city.row) <= bRadius) {
          const tile = game.map[r][c];
          if (tile.resource && RESOURCES[tile.resource]) {
            const bonus = RESOURCES[tile.resource].bonus;
            if (bonus.food) resBonus.food += bonus.food;
            if (bonus.gold) resBonus.gold += bonus.gold;
            if (bonus.prod) resBonus.prod += bonus.prod;
          }
        }
      }
    }
  }
  if (resBonus.gold > 0) game.gold += resBonus.gold;
  if (resBonus.food > 0) game.food += resBonus.food;

  // --- Government cooldown ---
  if (game.governmentCooldown > 0) game.governmentCooldown--;

  // --- Food & Population (per-city growth) ---
  for (const city of game.cities) {
    if (!city.food) city.food = 0;
    // Calculate food for this city based on its tiles
    const cityFood = game.foodPerTurn / game.cities.length; // Split evenly for now
    city.food += cityFood;
    // Growth threshold scales with city population
    const growthThreshold = 15 + Math.floor((city.population || 1000) / 500);
    // Apply happiness modifier
    let growthMod = 1.0;
    if (game.happiness > 10) growthMod = 1.2;
    else if (game.happiness > 5) growthMod = 1.1;
    else if (game.happiness < 0) growthMod = 0.75;
    else if (game.happiness < -5) growthMod = 0.5;

    if (city.food * growthMod >= growthThreshold) {
      city.food = 0;
      city.population = (city.population || 1000) + 100;
      game.population += 100;
      events.push(city.name + ' grew! (pop ' + city.population + ')');
    }
  }

  // --- Process tile improvements ---
  processImprovements();

  // --- Production (Buildings OR Units — one at a time) ---
  let prodThisTurn = game.productionPerTurn + resBonus.prod;
  // Government production bonuses
  if (game.government === 'oligarchy' && GOVERNMENTS.oligarchy) {
    // Oligarchy: +30% building production
    if (game.currentBuild) prodThisTurn = Math.floor(prodThisTurn * 1.3);
  }
  // Happiness production modifier
  if (game.happiness > 10) prodThisTurn = Math.floor(prodThisTurn * 1.1);
  else if (game.happiness < -5) prodThisTurn = Math.floor(prodThisTurn * 0.75);
  if (game.currentBuild) {
    game.buildProgress += prodThisTurn;
    const bdata = BUILDINGS.find(b => b.id === game.currentBuild);
    if (!bdata) { game.currentBuild = null; game.buildProgress = 0; }
    else if (game.buildProgress >= bdata.cost) {
      game.buildings.push(game.currentBuild);
      const eff = bdata.effect;
      if (eff.food) game.foodPerTurn += eff.food;
      if (eff.gold) game.goldPerTurn += eff.gold;
      if (eff.science) game.sciencePerTurn += eff.science;
      if (eff.military) game.military += eff.military;
      if (eff.defense) game.defense += eff.defense;
      if (eff.production) game.productionPerTurn += eff.production;
      if (eff.culture) game.culture += eff.culture;
      events.push(`${bdata.name} completed!`);
      addEvent(`${bdata.name} completed!`, 'gold');
      game.currentBuild = null;
      game.buildProgress = 0;
      showCompletionNotification('building', bdata.name, bdata.desc);
      if (typeof showToast === 'function') showToast('\u{1F3D7} Building Complete', bdata.name + ' constructed!');
    }
  } else if (game.currentUnitBuild) {
    game.unitBuildProgress += prodThisTurn;
    const ut = UNIT_TYPES[game.currentUnitBuild];
    if (ut && game.unitBuildProgress >= ut.cost) {
      const city = game.cities[0];
      const neighbors = getHexNeighbors(city.col, city.row);
      let placed = false;
      for (const nb of neighbors) {
        const tile = game.map[nb.row][nb.col];
        if (!isTilePassable(tile)) continue;
        if (getUnitAt(nb.col, nb.row)) continue;
        const newUnit = createUnit(game.currentUnitBuild, nb.col, nb.row, 'player');
        newUnit.moveLeft = 0;
        game.units.push(newUnit);
        game.military += Math.floor(ut.combat / 4);
        placed = true;
        break;
      }
      if (placed) {
        if (game.currentUnitBuild === 'settler') {
          game.population = Math.max(500, game.population - 500);
          const mc = game.cities[0];
          if (mc) mc.population = Math.max(500, (mc.population || game.population) - 500);
        }
        events.push(`${ut.name} trained!`);
        addEvent(`${ut.name} trained!`, 'combat');
        game.currentUnitBuild = null;
        game.unitBuildProgress = 0;
        showCompletionNotification('unit', ut.name, ut.desc);
        if (typeof showToast === 'function') showToast('\u2694 Unit Ready', ut.name + ' trained!');
      } else {
        addEvent(`${ut.name} ready but no room — clear tiles near city`, 'combat');
        game.unitBuildProgress = ut.cost;
      }
    }
  } else if (game.currentWonderBuild) {
    game.wonderBuildProgress += prodThisTurn;
    const wdata = WONDERS.find(w => w.id === game.currentWonderBuild);
    if (wdata && game.wonderBuildProgress >= wdata.cost) {
      game.wonders.push(game.currentWonderBuild);
      const eff = wdata.effect;
      if (eff.food) game.foodPerTurn += eff.food;
      if (eff.gold) game.goldPerTurn += eff.gold;
      if (eff.science) game.sciencePerTurn += eff.science;
      if (eff.production) game.productionPerTurn += eff.production;
      if (eff.culture) game.culture += eff.culture;
      events.push(wdata.icon + ' ' + wdata.name + ' completed!');
      addEvent(wdata.icon + ' ' + wdata.name + ' completed!', 'gold');
      game.currentWonderBuild = null;
      game.wonderBuildProgress = 0;
      showCompletionNotification('wonder', wdata.name, wdata.desc);
      if (typeof showToast === 'function') showToast('\u{1F3DB} Wonder Complete', wdata.name + ' has been built!');
    }
  }

  // --- Research ---
  if (game.currentResearch) {
    game.researchProgress += game.sciencePerTurn;
    const tdata = TECHNOLOGIES.find(t => t.id === game.currentResearch);
    if (!tdata) { game.currentResearch = null; game.researchProgress = 0; }
    else if (game.researchProgress >= tdata.cost) {
      game.techs.push(game.currentResearch);
      events.push(`${tdata.name} discovered!`);
      addEvent(`Technology: ${tdata.name} discovered!`, 'science');
      game.currentResearch = null;
      game.researchProgress = 0;
      // Show completion notification with prompt
      showCompletionNotification('research', tdata.name, tdata.desc);
      if (typeof showToast === 'function') showToast('\u{1F4A1} Research Complete', tdata.name + ' researched!');
    }
  }

  // --- Culture per turn calculation ---
  let cpt = 1; // base
  for (const bid of game.buildings) {
    const bd = BUILDINGS.find(b => b.id === bid);
    if (bd && bd.effect && bd.effect.culture) cpt += bd.effect.culture;
  }
  // Government culture bonus
  if (game.government && GOVERNMENTS[game.government]) {
    const gov = GOVERNMENTS[game.government];
    if (gov.bonuses && gov.bonuses.cultureBonus) cpt = Math.floor(cpt * (1 + gov.bonuses.cultureBonus));
  }
  // Pantheon bonus
  if (game.pantheon === 'earth_goddess') cpt += 1;
  game.culturePerTurn = cpt;
  game.culture += cpt;

  // --- Civic progression ---
  if (game.currentCivic) {
    game.civicProgress += game.culturePerTurn;
    const cdata = CIVICS.find(c => c.id === game.currentCivic);
    if (cdata && game.civicProgress >= cdata.cost) {
      game.civics.push(game.currentCivic);
      events.push('Civic: ' + cdata.name + ' adopted!');
      addEvent('Civic: ' + cdata.name + ' adopted!', 'gold');
      // Check if unlocks pantheon
      if (cdata.unlocks && cdata.unlocks.includes('pantheon') && !game.pantheon) {
        setTimeout(() => showPantheonPicker(), 500);
      }
      game.currentCivic = null;
      game.civicProgress = 0;
      showCompletionNotification('civic', cdata.name, cdata.desc);
    }
  }

  // --- Auto-civic: pick first available civic if none selected ---
  if (!game.currentCivic) {
    const availCivics = CIVICS.filter(c => {
      if (game.civics.includes(c.id)) return false;
      if (c.requires && !c.requires.every(r => game.civics.includes(r))) return false;
      return true;
    });
    if (availCivics.length > 0) {
      availCivics.sort((a, b) => a.cost - b.cost);
      game.currentCivic = availCivics[0].id;
      game.civicProgress = 0;
      addEvent('Auto-civic: ' + availCivics[0].name, 'gold');
    }
  }

  // --- Great People progression ---
  if (game.greatPeopleProgress) {
    game.greatPeopleProgress.science += game.sciencePerTurn;
    game.greatPeopleProgress.production += game.productionPerTurn;
    game.greatPeopleProgress.gold += game.goldPerTurn;
    game.greatPeopleProgress.culture += game.culturePerTurn;
    // Military accumulates from military stat
    game.greatPeopleProgress.military += Math.floor(game.military / 5);

    for (const gp of GREAT_PEOPLE_TYPES) {
      const prog = game.greatPeopleProgress[gp.trigger] || 0;
      if (prog >= gp.threshold) {
        game.greatPeopleProgress[gp.trigger] -= gp.threshold;
        game.greatPeopleEarned.push({ type: gp.type, turn: game.turn, used: false });
        events.push(gp.icon + ' ' + gp.name + ' has appeared!');
        addEvent(gp.icon + ' ' + gp.name + ' has appeared!', 'gold');
        showGreatPersonNotification(gp);
      }
    }
  }


  // --- Alliance upkeep ---
  for (const [cid, alliance] of Object.entries(game.activeAlliances)) {
    if (game.turn >= alliance.startTurn + alliance.turns) {
      delete game.activeAlliances[cid];
      addEvent(`Alliance with ${FACTIONS[cid].name} expired`, 'diplomacy');
      updateReputation(cid, 'alliance_honoured', `Alliance with ${FACTIONS[cid].name} honoured to completion`);
    }
  }

  // --- Trade deal processing ---
  for (const [cid, deal] of Object.entries(game.tradeDeals)) {
    if (game.turn >= deal.startTurn + deal.duration) {
      delete game.tradeDeals[cid];
      addEvent(`Trade deal with ${FACTIONS[cid].name} expired`, 'gold');
      updateReputation(cid, 'trade_deal_honoured', `Trade deal with ${FACTIONS[cid].name} honoured to completion`);
      continue;
    }
    // Parse and apply trade effects per turn
    const receives = String(deal.playerReceives || '');
    if (receives.includes('gold')) { const m = receives.match(/(\d+)/); if (m) game.gold += parseInt(m[1]) || 0; }
    if (receives.includes('science')) { game.science += (parseInt(receives.match(/(\d+)/)?.[1]) || 2); }
    if (receives.includes('military')) { game.military += 1; }
    // Deduct what player gives
    const gives = String(deal.playerGives || '');
    if (gives.includes('gold')) { const m = gives.match(/(\d+)/); if (m) game.gold -= Math.min(game.gold, parseInt(m[1]) || 0); }
  }

  // --- Defense pact upkeep ---
  for (const [cid, pact] of Object.entries(game.defensePacts)) {
    if (game.turn >= pact.startTurn + pact.duration) {
      delete game.defensePacts[cid];
      game.defense = Math.max(0, game.defense - 3);
      addEvent(`Defense pact with ${FACTIONS[cid].name} expired`, 'diplomacy');
      updateReputation(cid, 'defense_pact_honoured', `Defense pact with ${FACTIONS[cid].name} honoured`);
    }
  }

  // --- Road trade income between cities ---
  if (game.cities.length > 1) {
    for (let i = 0; i < game.cities.length; i++) {
      for (let j = i + 1; j < game.cities.length; j++) {
        // Check if there's a road path between cities (simplified: just check distance and road density)
        const c1 = game.cities[i], c2 = game.cities[j];
        const dist = hexDistance(c1.col, c1.row, c2.col, c2.row);
        if (dist <= 15) {
          // Count road tiles between them
          let roadCount = 0;
          for (let r = 0; r < MAP_ROWS; r++) {
            for (let c = 0; c < MAP_COLS; c++) {
              if (game.map[r][c].road) {
                const d1 = hexDistance(c, r, c1.col, c1.row);
                const d2 = hexDistance(c, r, c2.col, c2.row);
                if (d1 + d2 <= dist + 2) roadCount++; // Road is roughly between the cities
              }
            }
          }
          if (roadCount >= dist * 0.5) { // At least half the path has roads
            game.gold += 3;
            // Only log occasionally
            if (game.turn % 10 === 1) addEvent('Trade route: ' + c1.name + ' \u2194 ' + c2.name + ' (+3 gold)', 'gold');
          }
        }
      }
    }
  }

  // --- City cultural expansion ---
  for (const city of game.cities) {
    if (!city.borderRadius) city.borderRadius = 2;
    if (!city.cultureAccum) city.cultureAccum = 0;
    // Accumulate culture toward border expansion
    city.cultureAccum += game.culture * 0.1 + 1;
    const expansionCost = city.borderRadius * 15; // More expensive as borders grow
    if (city.cultureAccum >= expansionCost && city.borderRadius < 5) {
      city.borderRadius++;
      city.cultureAccum = 0;
      addEvent('City borders expanded! Now controlling ' + city.borderRadius + ' rings', 'diplomacy');
    }
  }

  // --- Marriage bond upkeep ---
  for (const [cid, marriage] of Object.entries(game.marriages)) {
    // Marriages give ongoing +1 culture per turn
    game.culture += 1;
    // Relationship maintenance bonus
    game.relationships[cid] = (game.relationships[cid] || 0) + 1;
  }

  // --- Random events ---
  if (game.turn % 5 === 0) {
    const randomEvents = [
      { text: 'Traders from distant lands bring gold', effect: () => { game.gold += 15; } },
      { text: 'Barbarian raid on the frontier!', effect: () => { game.military = Math.max(0, game.military - 2); }, type: 'combat' },
      { text: 'A bountiful harvest!', effect: () => { game.food += 10; } },
      { text: 'Scholars make a breakthrough', effect: () => { if (game.currentResearch) game.researchProgress += 5; }, type: 'science' },
      { text: 'Diplomatic envoy arrives bearing gifts', effect: () => { game.gold += 10; game.culture += 1; }, type: 'diplomacy' },
    ];
    const evt = randomEvents[Math.floor(Math.random() * randomEvents.length)];
    evt.effect();
    events.push(evt.text);
    addEvent(evt.text, evt.type || 'gold');
  }

  // --- Relationship drift ---
  for (const cid of Object.keys(game.relationships)) {
    if (game.relationships[cid] > 0) game.relationships[cid] = Math.max(0, game.relationships[cid] - 1);
    if (game.relationships[cid] < 0) game.relationships[cid] = Math.min(0, game.relationships[cid] + 1);
    if (game.activeAlliances[cid]) game.relationships[cid] += 2;
  }

  // --- Update faction AI economies ---
  updateFactionStats();

  // --- Faction intelligence reports (every 10 turns) ---
  generateFactionIntelReports();

  // --- Refill envoys (1 per turn) and messages (3 per turn) ---
  game.maxEnvoys = 1;
  game.envoys = game.maxEnvoys;
  game.envoySpentThisTurn = {};
  game.messagesThisTurn = 0;

  // --- Open borders upkeep ---
  for (const [cid, ob] of Object.entries(game.openBorders || {})) {
    if (game.turn >= ob.startTurn + ob.duration) {
      delete game.openBorders[cid];
      addEvent(`Open borders with ${FACTIONS[cid].name} expired`, 'diplomacy');
    }
  }

  // --- Embargo upkeep ---
  for (const [cid, emb] of Object.entries(game.embargoes || {})) {
    if (game.turn >= emb.startTurn + emb.duration) {
      delete game.embargoes[cid];
      addEvent(`Embargo against ${FACTIONS[cid].name} lifted`, 'diplomacy');
    } else {
      // Embargoes reduce target's trade income (simulated)
      game.relationships[cid] = (game.relationships[cid] || 0) - 2;
    }
  }

  // --- Ceasefire upkeep ---
  for (const [cid, cf] of Object.entries(game.ceasefires || {})) {
    if (game.turn >= cf.startTurn + cf.duration) {
      delete game.ceasefires[cid];
      addEvent(`Ceasefire with ${FACTIONS[cid].name} expired`, 'diplomacy');
    } else {
      // Ceasefire slowly improves relations
      game.relationships[cid] = (game.relationships[cid] || 0) + 1;
    }
  }

  // --- Vassal tribute ---
  for (const [cid, v] of Object.entries(game.vassals || {})) {
    game.gold += v.tributeGold || 5;
    game.relationships[cid] = (game.relationships[cid] || 0) - 2;
  }

  // --- Non-aggression pact upkeep ---
  for (const [cid, nap] of Object.entries(game.nonAggressionPacts || {})) {
    if (game.turn >= nap.startTurn + nap.duration) {
      delete game.nonAggressionPacts[cid];
      addEvent(`Non-aggression pact with ${FACTIONS[cid].name} expired`, 'diplomacy');
    }
  }

  // --- Process active events from mods ---
  if (game.activeEvents) {
    for (let i = game.activeEvents.length - 1; i >= 0; i--) {
      game.activeEvents[i].turnsLeft--;
      if (game.activeEvents[i].turnsLeft <= 0) {
        const evt = game.activeEvents[i];
        // Reverse effects when event ends
        if (evt.type === 'golden_age') {
          game.goldPerTurn = Math.max(0, game.goldPerTurn - 3);
          addEvent(`Golden Age ended`, 'diplomacy');
        } else if (evt.type === 'military_drill') {
          game.military = Math.max(0, game.military - 5);
          addEvent(`Military drill ended`, 'combat');
        }
        game.activeEvents.splice(i, 1);
      }
    }
  }

  // --- Auto-research: pick next tech from goal path, or cheapest ---
  if (!game.currentResearch) {
    // Check tech goal path first
    if (game._techGoalPath && game._techGoalPath.length > 0) {
      const nextOnPath = game._techGoalPath.find(tid => {
        const t = TECHNOLOGIES.find(x => x.id === tid);
        return !game.techs.includes(tid) && (!t.requires || t.requires.every(r => game.techs.includes(r)));
      });
      if (nextOnPath) {
        game.currentResearch = nextOnPath;
        game.researchProgress = 0;
        addEvent(`Researching (goal path): ${TECHNOLOGIES.find(t => t.id === nextOnPath)?.name}`, 'science');
      }
      // Clear goal if all path techs researched
      if (game._techGoal && game.techs.includes(game._techGoal)) {
        addEvent(`\u{1F3AF} Tech goal achieved: ${TECHNOLOGIES.find(t => t.id === game._techGoal)?.name}!`, 'science');
        game._techGoal = null;
        game._techGoalPath = null;
      }
    }
  }
  if (!game.currentResearch) {
    const available = TECHNOLOGIES.filter(t => {
      if (game.techs.includes(t.id)) return false;
      if (t.requires && !t.requires.every(r => game.techs.includes(r))) return false;
      return true;
    });
    if (available.length > 0) {
      // Pick cheapest available tech
      available.sort((a, b) => a.cost - b.cost);
      game.currentResearch = available[0].id;
      game.researchProgress = 0;
      addEvent(`Auto-research: ${available[0].name}`, 'science');
    }
  }

  // --- Auto-build: start a building if idle and techs unlocked ---
  if (game.turn <= 1) { /* Skip auto-build on turn 1 — let the player choose */ }
  else
  if (!game.currentBuild && !game.currentUnitBuild) {
    const unlockedBuildings = new Set();
    for (const tech of game.techs) {
      const tdata = TECHNOLOGIES.find(t => t.id === tech);
      if (tdata && tdata.unlocks) tdata.unlocks.forEach(b => unlockedBuildings.add(b));
    }
    const buildable = BUILDINGS.filter(b => unlockedBuildings.has(b.id) && !game.buildings.includes(b.id));
    if (buildable.length > 0) {
      // Prioritize: granary > barracks > market > library > walls > others
      const priority = ['granary', 'barracks', 'market', 'library', 'walls', 'workshop', 'temple', 'harbor', 'university', 'bank', 'fortress'];
      let pick = buildable[0];
      for (const pid of priority) {
        const found = buildable.find(b => b.id === pid);
        if (found) { pick = found; break; }
      }
      game.currentBuild = pick.id;
      game.buildProgress = 0;
      addEvent(`Auto-build: ${pick.name}`, 'gold');
    }
  }

  // --- Gold spending: rush-buy units if gold is piling up AND production is idle ---
  if (game.gold > 100 && !game.currentBuild && !game.currentUnitBuild && game.units.filter(u => u.owner === 'player').length < 6) {
    // Buy a unit near the capital — check two rings of hexes
    const city = game.cities[0];
    if (city) {
      const ring1 = getHexNeighbors(city.col, city.row);
      const ring2 = [];
      for (const nb of ring1) {
        for (const nb2 of getHexNeighbors(nb.col, nb.row)) {
          if (nb2.col !== city.col || nb2.row !== city.row) ring2.push(nb2);
        }
      }
      const candidates = [...ring1, ...ring2];
      const open = candidates.find(nb => {
        const tile = game.map[nb.row][nb.col];
        return isTilePassable(tile) && !getUnitAt(nb.col, nb.row);
      });
      if (open) {
        // Pick unit based on what we need
        let unitType = 'warrior';
        const playerUnits = game.units.filter(u => u.owner === 'player');
        const hasArcher = playerUnits.some(u => u.type === 'archer');
        const hasSpearman = playerUnits.some(u => u.type === 'spearman');
        if (game.techs.includes('archery') && !hasArcher) unitType = 'archer';
        else if (game.techs.includes('bronze_working') && !hasSpearman) unitType = 'spearman';
        else if (game.gold > 150 && game.techs.includes('the_wheel')) unitType = 'chariot';
        const cost = UNIT_TYPES[unitType].cost;
        if (game.gold >= cost * 2) { // Gold-buy at 2x cost
          game.gold -= cost * 2;
          const newUnit = createUnit(unitType, open.col, open.row, 'player');
          game.units.push(newUnit);
          game.military += UNIT_TYPES[unitType].combat;
          addEvent(`Recruited ${UNIT_TYPES[unitType].name} (gold purchase)`, 'combat');
          showCompletionNotification('unit', UNIT_TYPES[unitType].name, `${UNIT_TYPES[unitType].combat} combat, ${UNIT_TYPES[unitType].movePoints} moves`);
        }
      }
    }
  }

  // --- Expand fog around cities and units ---
  for (const city of game.cities) {
    const revealRadius = 5 + Math.floor(game.turn / 15);
    revealAround(city.col, city.row, revealRadius);
  }
  for (const unit of game.units) {
    if (unit.owner !== 'player') continue;
    revealAround(unit.col, unit.row, unit.type === 'scout' ? 4 : 3);
  }

  // --- Score ---
  game.score = Math.floor(
    game.population * 0.01 +
    game.techs.length * 10 +
    game.civics.length * 10 +
    game.buildings.length * 5 +
    game.wonders.length * 25 +
    game.cities.length * 15 +
    game.military * 0.5 +
    game.gold * 0.05 +
    (game.greatPeopleEarned ? game.greatPeopleEarned.length * 20 : 0) +
    (game.government !== 'chiefdom' ? 10 : 0) +
    (game.pantheon ? 15 : 0) +
    game.culture * 3 +
    Object.values(game.relationships || {}).reduce((a, b) => a + Math.max(0, b), 0) * 0.5 +
    (game.factionsEliminated || 0) * 50 +
    Object.keys(game.activeAlliances || {}).length * 10 +
    (game.barbarianCamps ? game.barbarianCamps.filter(bc => bc.destroyed).length * 15 : 0)
  );

  // --- Reputation decay & contradiction detection ---
  ensureReputationState();
  decayReputation();
  detectContradictions();

  game.turn++;
  game.recentEvents = events.map(text => ({ text, turn: game.turn })).concat(game.recentEvents).slice(0, 20);

  const victory = checkVictoryConditions();
  if (victory) {
    showGameOver(victory);
    return;
  }

  if (events.length > 2 || game.turn % 10 === 0) {
    showTurnSummary(events);
  }

  updateUI();
  render();

  // Auto-select first movable unit
  game.selectedUnitId = null;
  hideSelectionPanel();
  const movable = game.units.filter(u => u.owner === 'player' && u.moveLeft > 0 && !u.sleeping && !u.fortified);
  if (movable.length > 0) {
    selectUnit(movable[0]);
    addEvent(`${movable.length} unit${movable.length > 1 ? 's' : ''} ready for orders`, 'combat');
  }

  // Ensure camera is clamped after all turn processing (prevents zoom/pan glitches)
  clampCamera();

  // Log turn summary
  logAction('turn', 'Turn ' + (game.turn - 1) + ' ended. Gold:' + game.gold + ' Military:' + game.military + ' Pop:' + game.population + ' Score:' + game.score, {
    gold: game.gold, military: game.military, population: game.population,
    score: game.score, techs: game.techs.length, buildings: game.buildings.length,
    units: game.units.filter(u => u.owner === 'player').length,
    cities: game.cities.length,
  });
  autoSave();
  } catch (e) {
    console.error('Error during turn processing:', e);
  } finally {
    // Re-enable End Turn button — always runs even if an error occurred
    _processingTurn = false;
    const btnEnd = document.getElementById('btn-end-turn');
    if (btnEnd) { btnEnd.disabled = false; btnEnd.style.opacity = '1'; }
  }
}

function showTurnSummary(events) {
  const body = document.getElementById('turn-summary-body');
  body.innerHTML = `
    <div class="summary-stat"><span class="summary-label">Turn</span><span class="summary-value">${game.turn} / ${MAX_TURNS}</span></div>
    <div class="summary-stat"><span class="summary-label">Gold</span><span class="summary-value">${game.gold} (+${game.goldPerTurn}/turn)</span></div>
    <div class="summary-stat"><span class="summary-label">Military</span><span class="summary-value">${game.military}</span></div>
    <div class="summary-stat"><span class="summary-label">Units</span><span class="summary-value">${game.units.filter(u => u.owner === 'player').length}</span></div>
    <div class="summary-stat"><span class="summary-label">Population</span><span class="summary-value">${game.population.toLocaleString()}</span></div>
    <div class="summary-stat"><span class="summary-label">Score</span><span class="summary-value">${game.score}</span></div>
    ${events.map(e => `<p style="margin-top:4px">\u2022 ${e}</p>`).join('')}
  `;
  document.getElementById('turn-summary').style.display = 'block';
}

document.getElementById('btn-dismiss-summary').addEventListener('click', () => {
  document.getElementById('turn-summary').style.display = 'none';
});

function showGameOver(victory) {
  const body = document.getElementById('game-over-body');
  document.getElementById('btn-end-turn').disabled = true;
  document.getElementById('btn-end-turn').style.opacity = '0.4';
  document.getElementById('stat-turn').innerHTML = `Turn <strong>${MAX_TURNS}</strong>/${MAX_TURNS}`;

  let rating = 'Chieftain';
  if (game.score >= 500) rating = 'Warlord';
  if (game.score >= 800) rating = 'Prince';
  if (game.score >= 1200) rating = 'King';
  if (game.score >= 1800) rating = 'Emperor';
  if (game.score >= 2500) rating = 'Deity';

  const victoryType = victory ? victory.icon + ' ' + victory.type.toUpperCase() + ' VICTORY' : 'Game Over';
  const victoryDesc = victory ? victory.desc : 'The ages have ended.';


  body.innerHTML = `
    <p style="text-align:center; font-family: var(--font-display); font-size: var(--text-xl); color: var(--color-gold); margin-bottom: 4px">${rating}</p>
    <p style="text-align:center; color:#ffd700; font-size:14px; margin-bottom:16px">${victoryType}<br><span style="font-size:12px;color:#aaa">${victoryDesc}</span></p>
    <div class="summary-stat"><span class="summary-label">Final Score</span><span class="summary-value" style="color:var(--color-gold)">${game.score}</span></div>
    <div class="summary-stat"><span class="summary-label">Turns Played</span><span class="summary-value">${game.turn - 1}</span></div>
    <div class="summary-stat"><span class="summary-label">Gold Accumulated</span><span class="summary-value">${game.gold}</span></div>
    <div class="summary-stat"><span class="summary-label">Military Strength</span><span class="summary-value">${game.military}</span></div>
    <div class="summary-stat"><span class="summary-label">Units</span><span class="summary-value">${game.units.filter(u => u.owner === 'player').length}</span></div>
    <div class="summary-stat"><span class="summary-label">Population</span><span class="summary-value">${game.population.toLocaleString()}</span></div>
    <div class="summary-stat"><span class="summary-label">Technologies</span><span class="summary-value">${game.techs.length}/${TECHNOLOGIES.length}</span></div>
    <div class="summary-stat"><span class="summary-label">Buildings</span><span class="summary-value">${game.buildings.length}</span></div>
    <div class="summary-stat"><span class="summary-label">Factions Eliminated</span><span class="summary-value">${game.factionsEliminated || 0}</span></div>
    <div style="text-align:center;margin-top:12px"><button id="btn-show-leaderboard-end" class="btn btn-secondary" style="font-size:12px;padding:6px 14px">\u{1F3C6} Leaderboard</button></div>
  `;
  closeAllPanels();
  document.getElementById('game-over').style.display = 'block';

  // Submit to leaderboard — use saved username or generate anonymous name
  const savedUsername = safeStorage.getItem('uncivilised_username');
  const playerName = savedUsername || ('Player_' + String(Math.floor(Math.random() * 9000) + 1000));
  submitToLeaderboard(playerName, victory);

  document.getElementById('btn-show-leaderboard-end').addEventListener('click', () => showLeaderboard());
}

export { endTurn, showTurnSummary, showGameOver };
