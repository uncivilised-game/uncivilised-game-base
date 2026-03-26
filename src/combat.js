import { UNIT_TYPES, UNIT_PROMOTIONS, PROMOTION_XP_THRESHOLDS, CITY_DEFENSE, FACTIONS, BASE_TERRAIN, BUILDINGS } from './constants.js';
import { game } from './state.js';
import { hexDistance, getHexNeighbors } from './hex.js';
import { crossesRiver } from './map.js';
import { addEvent, logAction } from './events.js';
import { render, markVisibilityDirty } from './render.js';
import { getModCombatBonus } from './diplomacy-api.js';
import { revealAround } from './discovery.js';
import { deselectUnit, autoSelectNext } from './units.js';
import { updateUI } from './leaderboard.js';
import { showToast } from './events.js';
import { showModBanner } from './diplomacy-api.js';
import { panCameraTo } from './input.js';
import { startAnimLoop } from './feedback.js';

function resolveCombat(attacker, defender) {
  const aType = UNIT_TYPES[attacker.type];
  const dType = UNIT_TYPES[defender.type] || { name: 'City', combat: 15, rangedCombat: 0, range: 0, movePoints: 0, icon: '\u{1F3F0}', class: 'city', desc: 'Fortified city' };

  let atkPower = aType.rangedCombat > 0 ? aType.rangedCombat : aType.combat;
  let defPower = dType.combat;

  // Anti-cavalry bonus
  if (aType.class === 'anti-cav' && dType.class === 'cavalry') atkPower += 10;
  if (dType.class === 'anti-cav' && aType.class === 'cavalry') defPower += 10;

  // Fortification bonus
  if (defender.fortified) defPower = Math.floor(defPower * 1.2);

  // Terrain defense bonus for defender (hills/woods)
  const defTile = game.map[defender.row][defender.col];
  if (defTile.feature === 'hills') defPower += 3;
  if (defTile.feature === 'woods' || defTile.feature === 'rainforest') defPower += 3;

  // River crossing penalty: attacker loses -5 combat when attacking across a river edge
  // (Classic Civ rule — rivers are natural defensive barriers)
  if (crossesRiver(attacker.col, attacker.row, defender.col, defender.row)) {
    atkPower -= 5;
  }

  // Flanking bonus: +2 per friendly unit adjacent to defender (Civ 6 style)
  const defNeighbors = getHexNeighbors(defender.col, defender.row);
  let flankBonus = 0;
  for (const nb of defNeighbors) {
    const ally = game.units.find(u => u.col === nb.col && u.row === nb.row && u.owner === attacker.owner && u.id !== attacker.id);
    if (ally && UNIT_TYPES[ally.type].rangedCombat === 0) flankBonus += 2; // Only melee units flank
  }
  atkPower += flankBonus;

  // Support bonus: +2 per friendly ranged unit adjacent to attacker
  const atkNeighbors = getHexNeighbors(attacker.col, attacker.row);
  let supportBonus = 0;
  for (const nb of atkNeighbors) {
    const ally = game.units.find(u => u.col === nb.col && u.row === nb.row && u.owner === attacker.owner && u.id !== attacker.id);
    if (ally && UNIT_TYPES[ally.type].rangedCombat > 0) supportBonus += 2;
  }
  atkPower += supportBonus;

  // Mod combat bonuses (from diplomatic agreements)
  if (attacker.owner === 'player') atkPower += getModCombatBonus(attacker);
  if (defender.owner === 'player') defPower += getModCombatBonus(defender);

  // Promotion bonuses
  for (const pid of (attacker.promotions || [])) {
    const p = UNIT_PROMOTIONS[pid];
    if (!p) continue;
    if (p.combatBonus && (!p.vsClass || p.vsClass === dType.class)) atkPower += p.combatBonus;
    if (p.woundedBonus && defender.hp < 100) atkPower += p.woundedBonus;
    if (p.cityBonus && game.cities.some(c => c.col === attacker.col && c.row === attacker.row)) atkPower += p.cityBonus;
  }
  for (const pid of (defender.promotions || [])) {
    const p = UNIT_PROMOTIONS[pid];
    if (!p) continue;
    if (p.combatBonus && (!p.vsClass || p.vsClass === aType.class)) defPower += p.combatBonus;
    if (p.fortifyBonus && defender.fortified) defPower += p.fortifyBonus;
    if (p.cityBonus && game.cities.some(c => c.col === defender.col && c.row === defender.row)) defPower += p.cityBonus;
  }


  // Apply tactic modifiers if present
  const tacticAtkMod = attacker._tacticAtkMod || 1;
  const tacticDefMod = attacker._tacticDefMod || 1;

  // Damage calculation (simplified Civ-style) with tactic modifiers
  const atkDamage = Math.max(5, Math.floor(30 * tacticAtkMod * (atkPower / Math.max(1, defPower)) * (attacker.hp / 100)));
  const defDamage = aType.rangedCombat > 0 ? 0 : Math.max(3, Math.floor(30 * tacticDefMod * (defPower / Math.max(1, atkPower)) * (defender.hp / 100)));

  defender.hp -= atkDamage;
  attacker.hp -= defDamage;

  const result = { atkDamage, defDamage, attackerDied: false, defenderDied: false };

  // Remove dead units
  if (defender.hp <= 0) {
    game.units = game.units.filter(u => u.id !== defender.id);
    result.defenderDied = true;
    // Gold reward for kill
    game.gold += Math.floor(dType.cost / 3);
    markVisibilityDirty();
  }
  if (attacker.hp <= 0) {
    game.units = game.units.filter(u => u.id !== attacker.id);
    result.attackerDied = true;
    markVisibilityDirty();
  }

  // Melee: if defender dies and melee attacker survives, move to defender's tile
  if (result.defenderDied && !result.attackerDied && aType.rangedCombat === 0) {
    attacker.col = defender.col;
    attacker.row = defender.row;
    revealAround(attacker.col, attacker.row, attacker.type === 'scout' ? 4 : 3);

    // Check for city capture
    if (attacker.owner === 'player') {
      checkCityCapture(attacker.col, attacker.row);
    }
  }

  // Use movement points
  attacker.moveLeft = 0;

  // --- XP and Promotion ---
  if (!result.attackerDied && attacker.owner === 'player') {
    attacker.xp = (attacker.xp || 0) + 10;
    const promoLevel = (attacker.promotions || []).length;
    if (promoLevel < PROMOTION_XP_THRESHOLDS.length && attacker.xp >= PROMOTION_XP_THRESHOLDS[promoLevel]) {
      attacker.pendingPromotion = true;
    }
  }
  if (!result.defenderDied && defender.owner === 'player') {
    defender.xp = (defender.xp || 0) + 5;
    const promoLevel = (defender.promotions || []).length;
    if (promoLevel < PROMOTION_XP_THRESHOLDS.length && defender.xp >= PROMOTION_XP_THRESHOLDS[promoLevel]) {
      defender.pendingPromotion = true;
    }
  }


  return result;
}

function attackFactionCity(attacker, factionId) {
  const fc = game.factionCities[factionId];
  if (!fc) return;
  const faction = FACTIONS[factionId];
  const factionName = faction ? faction.name : 'Unknown';
  const aType = UNIT_TYPES[attacker.type];

  // Check for peace agreements — offer to break them
  const hasPeace = game.ceasefires[factionId] || game.nonAggressionPacts[factionId] ||
                   game.activeAlliances[factionId] || game.defensePacts[factionId];

  if (hasPeace) {
    // Show confirmation to break peace
    showBattlePanel(attacker, {
      type: 'city_garrison', hp: 100, col: fc.col, row: fc.row, owner: factionId,
      _isCityAttack: true, _factionId: factionId, _factionName: factionName
    }, (tactic) => {
      if (tactic === 'retreat') return;
      // Break all peace agreements
      delete game.ceasefires[factionId];
      delete game.nonAggressionPacts[factionId];
      delete game.activeAlliances[factionId];
      delete game.defensePacts[factionId];
      game.relationships[factionId] = Math.min(-50, (game.relationships[factionId] || 0) - 50);
      addEvent('Peace broken with ' + factionName + '! (-50 relations)', 'diplomacy');
      executeCityAttack(attacker, factionId, tactic);
    });
    return;
  }

  // No peace — show battle panel directly
  showBattlePanel(attacker, {
    type: 'city_garrison', hp: 100, col: fc.col, row: fc.row, owner: factionId,
    _isCityAttack: true, _factionId: factionId, _factionName: factionName
  }, (tactic) => {
    if (tactic === 'retreat') {
      attacker.moveLeft = Math.max(0, attacker.moveLeft - 1);
      addEvent('Withdrew from ' + factionName + '\'s city', 'combat');
      render();
      return;
    }
    executeCityAttack(attacker, factionId, tactic);
  });
}

// ============================================
// CITY DEFENSE SYSTEM (Civ-style)
// ============================================
function computeCityDefense(city, factionId) {
  let strength = CITY_DEFENSE.BASE_COMBAT_STRENGTH;

  // Walls bonus — check if faction has walls (simulated via military stat)
  const fStats = game.factionStats[factionId];
  if (fStats && fStats.military > 20) strength += CITY_DEFENSE.WALLS_BONUS;

  // Fortress bonus
  if (fStats && fStats.military > 40) strength += CITY_DEFENSE.FORTRESS_BONUS;

  // Terrain bonus — hills
  const tile = game.map[city.row] && game.map[city.row][city.col];
  if (tile && tile.feature === 'hills') strength += CITY_DEFENSE.TERRAIN_HILLS_BONUS;

  // Garrison bonus — strongest garrison unit contributes
  const garrison = game.units.filter(u => u.col === city.col && u.row === city.row && u.owner === factionId);
  if (garrison.length > 0) {
    const bestGarrison = Math.max(...garrison.map(g => (UNIT_TYPES[g.type]?.combat || 0)));
    strength += Math.floor(bestGarrison * CITY_DEFENSE.GARRISON_MULTIPLIER);
  }

  // Population scaling — larger cities are tougher
  const pop = city.population || 500;
  strength += Math.floor(pop / 500);

  return { strength, garrison };
}

function attackExpansionCity(attacker, factionId, cityIdx) {
  const cities = game.aiFactionCities[factionId];
  if (!cities || !cities[cityIdx]) return;
  const ec = cities[cityIdx];
  const faction = FACTIONS[factionId];
  const factionName = faction ? faction.name : 'Unknown';
  const aType = UNIT_TYPES[attacker.type];

  // Check for peace agreements
  const hasPeace = game.ceasefires[factionId] || game.nonAggressionPacts[factionId] ||
                   game.activeAlliances[factionId] || game.defensePacts[factionId];

  if (hasPeace) {
    showBattlePanel(attacker, {
      type: 'city_garrison', hp: ec.hp || CITY_DEFENSE.BASE_HP, col: ec.col, row: ec.row, owner: factionId,
      _isCityAttack: true, _factionId: factionId, _factionName: factionName
    }, (tactic) => {
      if (tactic === 'retreat') return;
      delete game.ceasefires[factionId];
      delete game.nonAggressionPacts[factionId];
      delete game.activeAlliances[factionId];
      delete game.defensePacts[factionId];
      game.relationships[factionId] = Math.min(-50, (game.relationships[factionId] || 0) - 50);
      addEvent('Peace broken with ' + factionName + '! (-50 relations)', 'diplomacy');
      executeExpansionCityAttack(attacker, factionId, cityIdx, tactic);
    });
    return;
  }

  showBattlePanel(attacker, {
    type: 'city_garrison', hp: ec.hp || CITY_DEFENSE.BASE_HP, col: ec.col, row: ec.row, owner: factionId,
    _isCityAttack: true, _factionId: factionId, _factionName: factionName
  }, (tactic) => {
    if (tactic === 'retreat') {
      attacker.moveLeft = Math.max(0, attacker.moveLeft - 1);
      addEvent('Withdrew from ' + ec.name, 'combat');
      render();
      return;
    }
    executeExpansionCityAttack(attacker, factionId, cityIdx, tactic);
  });
}

function executeExpansionCityAttack(attacker, factionId, cityIdx, tactic) {
  const cities = game.aiFactionCities[factionId];
  if (!cities || !cities[cityIdx]) return;
  const ec = cities[cityIdx];
  const faction = FACTIONS[factionId];
  const factionName = faction ? faction.name : 'Unknown';
  const aType = UNIT_TYPES[attacker.type];

  if (!ec.hp) ec.hp = CITY_DEFENSE.BASE_HP;

  const { strength: cityDefence, garrison } = computeCityDefense(ec, factionId);

  const tacticResult = applyTacticModifier(tactic, 0, 0, attacker, { type: 'warrior', owner: factionId });
  if (tacticResult.narrative) addEvent(tacticResult.narrative, 'combat');

  let atkPower = (aType.rangedCombat > 0 ? aType.rangedCombat : aType.combat);
  atkPower += getModCombatBonus(attacker);
  atkPower = Math.floor(atkPower * (tacticResult.atkMod || 1));

  const atkDamage = Math.max(5, Math.floor(30 * (atkPower / Math.max(1, cityDefence)) * (attacker.hp / 100)));
  const defDamage = aType.rangedCombat > 0 ? 0 : Math.max(3, Math.floor(20 * (cityDefence / Math.max(1, atkPower))));

  ec.hp -= atkDamage;
  attacker.hp -= defDamage;
  ec._lastAttackedTurn = game.turn;

  addEvent(aType.name + ' attacks ' + ec.name + '! (-' + atkDamage + ' city HP, -' + defDamage + ' unit HP)', 'combat');

  // Damage garrison units
  for (const g of garrison) {
    g.hp -= Math.floor(atkDamage * 0.4);
    if (g.hp <= 0) {
      game.units = game.units.filter(u => u.id !== g.id);
      addEvent('Garrison ' + (UNIT_TYPES[g.type]?.name || 'unit') + ' destroyed!', 'combat');
    }
  }

  if (attacker.hp <= 0) {
    game.units = game.units.filter(u => u.id !== attacker.id);
    addEvent(aType.name + ' lost in the assault on ' + ec.name, 'combat');
    deselectUnit();
    autoSelectNext();
    render();
    return;
  }

  if (ec.hp <= 0) {
    // Ranged units cannot capture — only reduce to 1 HP
    if (CITY_DEFENSE.CAPTURE_MELEE_ONLY && aType.rangedCombat > 0) {
      ec.hp = 1;
      addEvent(ec.name + ' defenses broken! Send in melee to capture.', 'combat');
      showModBanner('\u{2694}', ec.name + ': 1 HP — melee unit needed to capture!', factionName);
    } else {
      // Capture expansion city
      attacker.col = ec.col;
      attacker.row = ec.row;
      captureExpansionCity(factionId, cityIdx);
    }
  } else {
    addEvent(ec.name + ' holds! (' + ec.hp + ' HP remaining)', 'combat');
    showModBanner('\u{2694}', ec.name + ': ' + ec.hp + '/' + CITY_DEFENSE.BASE_HP + ' HP remaining', factionName);
  }

  attacker.moveLeft = 0;
  updateUI();
  render();
}

function captureExpansionCity(factionId, cityIdx) {
  const cities = game.aiFactionCities[factionId];
  if (!cities || !cities[cityIdx]) return;
  const ec = cities[cityIdx];
  const faction = FACTIONS[factionId];
  const factionName = faction ? faction.name : 'Unknown';

  // Convert to player city
  game.cities.push({
    name: ec.name,
    col: ec.col,
    row: ec.row,
    buildings: [],
    population: Math.max(200, Math.floor((ec.population || 500) * 0.5)),
    borderRadius: ec.borderRadius || 1,
    cultureAccum: 0,
    owner: 'player',
  });

  // Remove garrison units
  game.units = game.units.filter(u => !(u.col === ec.col && u.row === ec.row && u.owner === factionId));

  // Remove from AI faction cities
  cities.splice(cityIdx, 1);

  const plunderGold = 20 + Math.floor(Math.random() * 40);
  game.gold += plunderGold;

  game.relationships[factionId] = Math.min(-80, (game.relationships[factionId] || 0) - 40);

  addEvent('\u{1F3DB} CAPTURED: ' + ec.name + ' (' + factionName + ')! +' + plunderGold + ' gold plundered', 'combat');
  showModBanner('\u{1F3DB}', ec.name + ' captured from ' + factionName + '! +' + plunderGold + ' gold', 'Military Victory');

  revealAround(ec.col, ec.row, 4);

  // Check if faction lost ALL cities (capital + expansion)
  const hasCapital = !!game.factionCities[factionId];
  const hasExpCities = cities.length > 0;
  if (!hasCapital && !hasExpCities) {
    eliminateFaction(factionId, factionName);
  }

  updateUI();
}

function executeCityAttack(attacker, factionId, tactic) {
  const fc = game.factionCities[factionId];
  if (!fc) return;
  const faction = FACTIONS[factionId];
  const factionName = faction ? faction.name : 'Unknown';
  const aType = UNIT_TYPES[attacker.type];

  if (!fc.hp) fc.hp = CITY_DEFENSE.BASE_HP;

  // Use proper Civ-style defense computation
  const { strength: cityDefence, garrison } = computeCityDefense(fc, factionId);

  // Apply tactic modifier
  const tacticResult = applyTacticModifier(tactic, 0, 0, attacker, { type: 'warrior', owner: factionId });
  if (tacticResult.narrative) addEvent(tacticResult.narrative, 'combat');

  let atkPower = (aType.rangedCombat > 0 ? aType.rangedCombat : aType.combat);
  atkPower += getModCombatBonus(attacker);
  atkPower = Math.floor(atkPower * (tacticResult.atkMod || 1));

  const atkDamage = Math.max(5, Math.floor(30 * (atkPower / Math.max(1, cityDefence)) * (attacker.hp / 100)));
  const defDamage = aType.rangedCombat > 0 ? 0 : Math.max(3, Math.floor(20 * (cityDefence / Math.max(1, atkPower))));

  fc.hp -= atkDamage;
  attacker.hp -= defDamage;
  fc._lastAttackedTurn = game.turn;

  addEvent(aType.name + ' attacks ' + fc.name + '! (-' + atkDamage + ' city HP, -' + defDamage + ' unit HP)', 'combat');

  // Damage garrison units
  for (const g of garrison) {
    g.hp -= Math.floor(atkDamage * 0.4);
    if (g.hp <= 0) {
      game.units = game.units.filter(u => u.id !== g.id);
      addEvent('Garrison ' + (UNIT_TYPES[g.type]?.name || 'unit') + ' destroyed!', 'combat');
    }
  }

  // Check if attacker died
  if (attacker.hp <= 0) {
    game.units = game.units.filter(u => u.id !== attacker.id);
    addEvent(aType.name + ' lost in the assault on ' + fc.name, 'combat');
    deselectUnit();
    autoSelectNext();
    render();
    return;
  }

  // Check if city falls
  if (fc.hp <= 0) {
    // Ranged units cannot capture — only reduce to 1 HP
    if (CITY_DEFENSE.CAPTURE_MELEE_ONLY && aType.rangedCombat > 0) {
      fc.hp = 1;
      addEvent(fc.name + ' defenses broken! Send in melee to capture.', 'combat');
      showModBanner('\u{2694}', fc.name + ': 1 HP \u2014 melee unit needed to capture!', factionName);
    } else {
      // City captured! Move attacker onto city if melee
      attacker.col = fc.col;
      attacker.row = fc.row;
      captureFactionCity(factionId);
    }
  } else {
    addEvent(fc.name + ' holds! (' + fc.hp + ' HP remaining)', 'combat');
    showModBanner('\u{2694}', fc.name + ': ' + fc.hp + '/' + CITY_DEFENSE.BASE_HP + ' HP remaining', factionName);
  }

  attacker.moveLeft = 0;
  updateUI();
  render();
}

function checkCityCapture(col, row) {
  // Check if this tile has a faction city
  for (const [fid, fc] of Object.entries(game.factionCities)) {
    if (fc.col === col && fc.row === row) {
      captureFactionCity(fid);
      return;
    }
  }
}

function captureFactionCity(factionId) {
  const fc = game.factionCities[factionId];
  if (!fc) return;
  const faction = FACTIONS[factionId];
  const factionName = faction ? faction.name : 'Unknown';

  // Convert faction city to player city
  game.cities.push({
    name: fc.name,
    col: fc.col,
    row: fc.row,
    buildings: [],
    population: 500,
    borderRadius: 2,
    cultureAccum: 0,
  });

  // Remove from faction cities
  delete game.factionCities[factionId];

  // Gain gold from plunder
  const plunderGold = 30 + Math.floor(Math.random() * 50);
  game.gold += plunderGold;

  // Relationship devastation
  game.relationships[factionId] = -100;

  // Remove all agreements with this faction
  delete game.activeAlliances[factionId];
  delete game.tradeDeals[factionId];
  delete game.defensePacts[factionId];
  delete game.marriages[factionId];
  delete game.openBorders[factionId];
  delete game.ceasefires[factionId];
  delete game.nonAggressionPacts[factionId];

  addEvent(`🏛 CAPTURED: ${fc.name} (${factionName})! +${plunderGold} gold plundered`, 'combat');

  // Check if this was their last city — faction elimination
  const remainingCities = Object.keys(game.factionCities).filter(fid => fid === factionId);
  if (remainingCities.length === 0) {
    eliminateFaction(factionId, factionName);
  }

  // Reveal fog around captured city
  revealAround(fc.col, fc.row, 5);

  showModBanner('🏛', `${fc.name} captured from ${factionName}! +${plunderGold} gold`, 'Military Victory');
}

function eliminateFaction(factionId, factionName) {
  // Remove all their units
  const removedUnits = game.units.filter(u => u.owner === factionId).length;
  game.units = game.units.filter(u => u.owner !== factionId);

  // Remove from met factions tracking
  // (keep metFactions entry so they still show in history)

  // Big score bonus
  game.score += 100;
  game.military += 10;
  game.factionsEliminated = (game.factionsEliminated || 0) + 1;

  addEvent(`⚔️ ${factionName} has been ELIMINATED! Their civilization is no more.`, 'combat');
  addEvent(`  ${removedUnits} enemy units destroyed. +100 score.`, 'combat');

  showModBanner('⚔️', `${factionName} eliminated! Their civilization has fallen.`, 'Domination');

  // Check if ALL factions are eliminated — domination victory
  const remainingFactions = Object.keys(game.factionCities);
  if (remainingFactions.length === 0) {
    addEvent('🏆 DOMINATION VICTORY — You have conquered all civilizations!', 'combat');
  }
}

function getUnitAt(col, row) {
  return game.units.find(u => u.col === col && u.row === row);
}

function getPlayerUnitAt(col, row) {
  return game.units.find(u => u.col === col && u.row === row && u.owner === 'player');
}

function getEnemyUnitAt(col, row) {
  return game.units.find(u => u.col === col && u.row === row && u.owner !== 'player');
}

function getCityAt(col, row) {
  // Check player cities
  const pCity = game.cities.find(c => c.col === col && c.row === row);
  if (pCity) return { ...pCity, owner: 'player' };
  // Check faction cities
  for (const [fid, fc] of Object.entries(game.factionCities)) {
    if (fc.col === col && fc.row === row) return { ...fc, owner: fid };
  }
  return null;
}

function showBattlePanel(attacker, defender, onChoice) {
  const aType = UNIT_TYPES[attacker.type];
  const dType = UNIT_TYPES[defender.type] || { name: 'City Garrison', combat: 20, icon: '\u{1F3F0}', class: 'melee' };
  const isCityAttack = defender._isCityAttack;
  const defFaction = FACTIONS[defender.owner];
  const defName = isCityAttack ? (defender._factionName + '\'s City') : (defFaction ? defFaction.name : 'Enemy');

  let panel = document.getElementById('battle-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'battle-panel';
    document.getElementById('game-main').appendChild(panel);
  }

  // Calculate base odds
  let atkPower = aType.rangedCombat > 0 ? aType.rangedCombat : aType.combat;
  let defPower = isCityAttack ? 20 : dType.combat;
  const ratio = atkPower / Math.max(1, defPower);
  const odds = Math.min(95, Math.max(5, Math.floor(ratio * 50)));

  panel.innerHTML = `
    <div class="battle-card">
      <div class="battle-header">\u{2694} Battle</div>
      <div class="battle-matchup">
        <div class="battle-side battle-attacker">
          <div class="battle-icon">${aType.icon}</div>
          <div class="battle-unit-name">${aType.name}</div>
          <div class="battle-stat">HP: ${attacker.hp}/100</div>
          <div class="battle-stat">Combat: ${atkPower}</div>
        </div>
        <div class="battle-vs">VS</div>
        <div class="battle-side battle-defender">
          <div class="battle-icon">${isCityAttack ? '\u{1F3F0}' : dType.icon}</div>
          <div class="battle-unit-name">${isCityAttack ? defName : (dType.name + ' (' + defName + ')')}</div>
          <div class="battle-stat">HP: ${defender.hp || 100}/100</div>
          <div class="battle-stat">${isCityAttack ? 'City Defence: ~15-25' : 'Combat: ' + defPower}</div>
        </div>
      </div>
      <div class="battle-odds">Estimated victory: ${odds}%</div>
      <div class="battle-tactics-label">Choose your tactic:</div>
      <div class="battle-tactics">
        <button class="battle-tactic" data-tactic="charge">
          <strong>\u{2694} Charge</strong>
          <span>All-out attack. +20% damage dealt, +10% damage taken.</span>
        </button>
        <button class="battle-tactic" data-tactic="defensive">
          <strong>\u{1F6E1} Defensive</strong>
          <span>Hold formation. -10% damage dealt, -25% damage taken.</span>
        </button>
        <button class="battle-tactic" data-tactic="flanking">
          <strong>\u{1F3AF} Flanking Maneuver</strong>
          <span>Risky outflank. 60% chance of +30% damage, 40% chance of -15%.</span>
        </button>
        <button class="battle-tactic" data-tactic="feigned_retreat">
          <strong>\u{1F3C3} Feigned Retreat</strong>
          <span>Lure them in. If enemy combat > yours: +25% damage. Otherwise: -10%.</span>
        </button>
        <button class="battle-tactic battle-tactic-retreat" data-tactic="retreat">
          <strong>\u{1F6A9} Retreat</strong>
          <span>Withdraw without fighting. Unit loses 1 move point.</span>
        </button>
      </div>
    </div>
  `;
  panel.style.display = 'flex';

  // Attach click handlers
  panel.querySelectorAll('.battle-tactic').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.style.display = 'none';
      onChoice(btn.dataset.tactic);
    });
  });
}

function applyTacticModifier(tactic, atkPower, defPower, attacker, defender) {
  let atkMod = 1.0, defMod = 1.0;
  let narrative = '';

  switch (tactic) {
    case 'charge':
      atkMod = 1.2; defMod = 1.1; // +20% atk damage, +10% def damage
      narrative = 'Your forces charge with fury!';
      break;
    case 'defensive':
      atkMod = 0.9; defMod = 0.75; // -10% atk damage, -25% def damage
      narrative = 'Your troops hold steady in tight formation.';
      break;
    case 'flanking':
      if (Math.random() < 0.6) {
        atkMod = 1.3; defMod = 0.95;
        narrative = 'The flanking maneuver succeeds brilliantly!';
      } else {
        atkMod = 0.85; defMod = 1.05;
        narrative = 'The flanking attempt is spotted — the enemy adjusts!';
      }
      break;
    case 'feigned_retreat':
      const dType = UNIT_TYPES[defender.type];
      if (dType.combat > UNIT_TYPES[attacker.type].combat) {
        atkMod = 1.25; defMod = 0.9;
        narrative = 'The enemy pursues recklessly into your trap!';
      } else {
        atkMod = 0.9; defMod = 1.0;
        narrative = 'The retreat fails to draw them out.';
      }
      break;
    case 'retreat':
      return { retreat: true, narrative: 'Your forces pull back from the engagement.' };
  }

  return { atkMod, defMod, narrative, retreat: false };
}

export {
  resolveCombat,
  attackFactionCity,
  computeCityDefense,
  attackExpansionCity,
  executeExpansionCityAttack,
  captureExpansionCity,
  executeCityAttack,
  checkCityCapture,
  captureFactionCity,
  eliminateFaction,
  getUnitAt,
  getPlayerUnitAt,
  getEnemyUnitAt,
  getCityAt,
  showBattlePanel,
  applyTacticModifier,
};
