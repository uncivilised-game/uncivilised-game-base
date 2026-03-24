import { MAP_COLS, MAP_ROWS, BASE_TERRAIN, UNIT_TYPES, FACTIONS, FACTION_TRAITS, TILE_IMPROVEMENTS, BUILDINGS, TECHNOLOGIES, BARBARIAN_UNITS, CITY_DEFENSE } from './constants.js';
import { game, getNextUnitId } from './state.js';
import { hexDistance, getHexNeighbors } from './hex.js';
import { getTileMoveCost, isTilePassable, getTileYields } from './map.js';
import { discoverFaction } from './discovery.js';
import { createUnit } from './units.js';
import { getUnitAt, resolveCombat } from './combat.js';
import { addEvent, logAction } from './events.js';

export function processAICommitments() {
  if (!game.aiCommitments) return;

  for (let i = game.aiCommitments.length - 1; i >= 0; i--) {
    const commit = game.aiCommitments[i];
    commit.turnsLeft--;

    if (commit.turnsLeft <= 0) {
      // Commitment expired
      const faction = FACTIONS[commit.factionId];
      if (faction && commit.type !== 'war') {
        addEvent(faction.name + ': ' + (commit.type.replace(/_/g,' ')) + ' commitment expired', 'diplomacy');
        logAction('diplomacy', faction.name + ' commitment expired: ' + commit.type, { factionId: commit.factionId, type: commit.type });
      }
      // Reverse ongoing effects
      if (commit.type === 'joint_research' && commit._scienceAdded) {
        game.sciencePerTurn = Math.max(1, game.sciencePerTurn - commit._scienceAdded);
      }
      if (commit.type === 'tribute_payment') {
        // Tribute stops
      }
      game.aiCommitments.splice(i, 1);
      continue;
    }

    const faction = FACTIONS[commit.factionId];
    if (!faction) { game.aiCommitments.splice(i, 1); continue; }
    const factionUnits = game.units.filter(u => u.owner === commit.factionId);

    switch (commit.type) {
      // === MILITARY COMMITMENTS ===
      case 'attack_faction': {
        const targetCity = game.factionCities[commit.target];
        if (!targetCity) { game.aiCommitments.splice(i, 1); break; }
        for (const unit of factionUnits) {
          if (unit.sleeping || unit.fortified) continue;
          const dist = hexDistance(unit.col, unit.row, targetCity.col, targetCity.row);
          if (dist > 1 && dist < 20) moveAIUnitToward(unit, targetCity.col, targetCity.row);
          // Attack enemy units near target city
          if (dist <= 2) {
            const enemyNear = game.units.find(u => u.owner === commit.target && hexDistance(u.col, u.row, unit.col, unit.row) <= 1);
            if (enemyNear) {
              const result = resolveCombat(unit, enemyNear);
              if (result.defenderDied) addEvent(faction.name + ' destroyed ' + (FACTIONS[commit.target]?.name || 'enemy') + ' unit!', 'combat');
            }
          }
        }
        if (commit.turnsLeft % 5 === 0) addEvent(faction.name + ' continues campaign against ' + (FACTIONS[commit.target]?.name || 'enemy'), 'combat');
        break;
      }
      case 'attack_unit': {
        // Target a specific unit or unit type near a location
        const targetUnit = game.units.find(u => u.owner === commit.target && u.type === (commit.unitType || u.type));
        if (!targetUnit) { game.aiCommitments.splice(i, 1); break; }
        for (const unit of factionUnits) {
          if (unit.sleeping || unit.fortified) continue;
          moveAIUnitToward(unit, targetUnit.col, targetUnit.row);
          if (hexDistance(unit.col, unit.row, targetUnit.col, targetUnit.row) <= 1) {
            resolveCombat(unit, targetUnit);
          }
        }
        break;
      }
      case 'war': {
        game.relationships[commit.factionId] = Math.min(-30, game.relationships[commit.factionId] || 0);
        break;
      }

      // === DEFENCE COMMITMENTS ===
      case 'defend_player': {
        if (game.cities.length === 0) break;
        const playerCity = game.cities[0];
        for (const unit of factionUnits) {
          if (unit.sleeping || unit.fortified) continue;
          const dist = hexDistance(unit.col, unit.row, playerCity.col, playerCity.row);
          if (dist > 3 && dist < 15) moveAIUnitToward(unit, playerCity.col, playerCity.row);
          // Attack enemy units near player city
          if (dist <= 4) {
            const threat = game.units.find(u => u.owner !== 'player' && u.owner !== commit.factionId && hexDistance(u.col, u.row, playerCity.col, playerCity.row) <= 3 && hexDistance(u.col, u.row, unit.col, unit.row) <= 1);
            if (threat) resolveCombat(unit, threat);
          }
        }
        break;
      }
      case 'defend_city': {
        const cityToDefend = commit.cityCol !== undefined ? { col: commit.cityCol, row: commit.cityRow } : game.cities[0];
        if (!cityToDefend) break;
        for (const unit of factionUnits) {
          if (unit.sleeping || unit.fortified) continue;
          const dist = hexDistance(unit.col, unit.row, cityToDefend.col, cityToDefend.row);
          if (dist > 2 && dist < 15) moveAIUnitToward(unit, cityToDefend.col, cityToDefend.row);
          else if (dist <= 2) unit.fortified = true; // Fortify near the city
        }
        break;
      }
      case 'defend_unit': {
        const unitToDefend = game.units.find(u => u.id === commit.targetUnitId);
        if (!unitToDefend) { game.aiCommitments.splice(i, 1); break; }
        for (const unit of factionUnits) {
          if (unit.sleeping || unit.fortified) continue;
          moveAIUnitToward(unit, unitToDefend.col, unitToDefend.row);
        }
        break;
      }

      // === TERRITORIAL COMMITMENTS ===
      case 'respect_borders': {
        // AI units avoid player territory
        for (const unit of factionUnits) {
          const inPlayerTerritory = game.cities.some(c => hexDistance(unit.col, unit.row, c.col, c.row) <= (c.borderRadius || 2));
          if (inPlayerTerritory) {
            // Move away from player cities
            const nearestCity = game.cities.reduce((best, c) => {
              const d = hexDistance(unit.col, unit.row, c.col, c.row);
              return !best || d < best.dist ? { city: c, dist: d } : best;
            }, null);
            if (nearestCity) {
              // Move in opposite direction
              const nbs = getHexNeighbors(unit.col, unit.row);
              const awayNb = nbs.reduce((best, nb) => {
                const d = hexDistance(nb.col, nb.row, nearestCity.city.col, nearestCity.city.row);
                return (!best || d > best.dist) && isTilePassable(game.map[nb.row][nb.col]) ? { nb, dist: d } : best;
              }, null);
              if (awayNb) { unit.col = awayNb.nb.col; unit.row = awayNb.nb.row; }
            }
          }
        }
        break;
      }
      case 'no_settle_near': {
        // Prevent AI from building cities near player (enforced in AI city-building logic)
        // This is a passive commitment — checked elsewhere if AI ever builds cities
        break;
      }

      // === TRADE & PATROL ===
      case 'trade_escort': {
        if (game.cities.length === 0) break;
        const fc = game.factionCities[commit.factionId];
        if (!fc) break;
        const pc = game.cities[0];
        const midCol = Math.floor((fc.col + pc.col) / 2);
        const midRow = Math.floor((fc.row + pc.row) / 2);
        for (const unit of factionUnits.slice(0, 1)) {
          moveAIUnitToward(unit, midCol, midRow);
        }
        break;
      }

      // === ECONOMIC COMMITMENTS ===
      case 'tribute_payment': {
        // AI pays tribute to player each turn
        const amount = commit.goldPerTurn || 3;
        game.gold += amount;
        if (commit.turnsLeft % 10 === 0) addEvent(faction.name + ' pays tribute: +' + amount + ' gold', 'gold');
        break;
      }
      case 'joint_research': {
        // Combined science output — already applied as a one-time boost when commitment starts
        // Tracked via commit._scienceAdded so we can reverse on expiry
        break;
      }

      // === INTER-FACTION DIPLOMACY ===
      case 'make_peace_with': {
        // AI makes peace with another AI faction
        const targetFid = commit.target;
        if (targetFid && game.relationships[targetFid] !== undefined) {
          // Gradually improve inter-faction relationship (simulated)
          if (game.factionStats[targetFid]) {
            game.factionStats[targetFid].military = Math.max(5, (game.factionStats[targetFid].military || 10) + 1);
          }
        }
        if (commit.turnsLeft === commit._initialTurns - 1) {
          addEvent(faction.name + ' declares peace with ' + (FACTIONS[targetFid]?.name || 'a rival'), 'diplomacy');
        }
        break;
      }
      case 'wage_war_on': {
        // AI faction wages war on another AI faction (reduces target's stats)
        const targetFid = commit.target;
        if (targetFid && game.factionStats[targetFid]) {
          const ts = game.factionStats[targetFid];
          ts.military = Math.max(2, ts.military - 1);
          ts.gold = Math.max(0, ts.gold - 3);
          if (Math.random() < 0.1) ts.population = Math.max(200, ts.population - 100);
        }
        if (commit.turnsLeft % 5 === 0) {
          addEvent(faction.name + ' wages war against ' + (FACTIONS[commit.target]?.name || 'a rival'), 'combat');
        }
        break;
      }
    }
  }
}

export function processAITurns() {
  processAICommitments();
  if (!game.aiFactions) game.aiFactions = {};
  if (!game.aiFactionCities) game.aiFactionCities = {};

  // --- City HP Healing ---
  for (const [fid, fc] of Object.entries(game.factionCities)) {
    if (fc.hp !== undefined && fc.hp < CITY_DEFENSE.BASE_HP) {
      const healAmt = (fc._lastAttackedTurn && game.turn - fc._lastAttackedTurn <= 1)
        ? CITY_DEFENSE.HP_HEAL_PER_TURN : CITY_DEFENSE.HP_HEAL_NOT_ATTACKED;
      fc.hp = Math.min(CITY_DEFENSE.BASE_HP, fc.hp + healAmt);
    }
  }
  if (game.aiFactionCities) {
    for (const [fid, cities] of Object.entries(game.aiFactionCities)) {
      for (const ec of cities) {
        if (ec.hp !== undefined && ec.hp < CITY_DEFENSE.BASE_HP) {
          const healAmt = (ec._lastAttackedTurn && game.turn - ec._lastAttackedTurn <= 1)
            ? CITY_DEFENSE.HP_HEAL_PER_TURN : CITY_DEFENSE.HP_HEAL_NOT_ATTACKED;
          ec.hp = Math.min(CITY_DEFENSE.BASE_HP, ec.hp + healAmt);
        }
      }
    }
  }

  // --- AI Economy, Improvements, City Founding ---
  for (const [fid, fc] of Object.entries(game.factionCities)) {
    const traits = FACTION_TRAITS[fid] || { archetype:'balanced', expansion:0.5, military:0.5, culture:0.5, science:0.5, diplomacy:0.5, espionage:0.3, improvePriority:['farm','mine','road'], settlerThreshold:2000, patrolRange:5, warThreshold:-30 };
    if (!game.aiFactions[fid]) game.aiFactions[fid] = { lastImproved: 0, cities: 1 };
    const ai = game.aiFactions[fid];

    // AI improves tiles around their city
    if (game.turn > ai.lastImproved + Math.floor(3 / (traits.expansion + 0.3))) {
      const rad = fc.borderRadius || 2;
      const candidates = [];
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          const nr = fc.row + dr, nc = ((fc.col + dc) % MAP_COLS + MAP_COLS) % MAP_COLS;
          if (nr < 0 || nr >= MAP_ROWS) continue;
          if (hexDistance(nc, nr, fc.col, fc.row) > rad) continue;
          const t = game.map[nr][nc];
          if (t.base === 'ocean' || t.base === 'coast' || t.base === 'lake' || t.feature === 'mountain') continue;
          if (t.improvement || t.road) continue;
          if (nc === fc.col && nr === fc.row) continue;
          candidates.push({ col: nc, row: nr, tile: t });
        }
      }
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        const impType = traits.improvePriority.find(imp => {
          const def = TILE_IMPROVEMENTS[imp];
          if (!def) return false;
          if (imp === 'road' && pick.tile.road) return false;
          if (def.validOn && !def.validOn.includes(pick.tile.base) && !(def.validOn.includes('hills') && pick.tile.feature === 'hills')) return false;
          if ((pick.tile.base === 'ocean' || pick.tile.base === 'coast') && imp !== 'fishing_boats') return false;
          return true;
        }) || 'farm';
        if (TILE_IMPROVEMENTS[impType]) {
          if (impType === 'road') pick.tile.road = true;
          else pick.tile.improvement = impType;
          fc.improvements = (fc.improvements || 0) + 1;
          ai.lastImproved = game.turn;
        }
      }
    }

    // Also improve around AI expansion cities
    const expCities = game.aiFactionCities[fid] || [];
    for (const ec of expCities) {
      if (Math.random() > 0.3) continue;
      const erad = ec.borderRadius || 1;
      for (let dr = -erad; dr <= erad; dr++) {
        for (let dc = -erad; dc <= erad; dc++) {
          const nr = ec.row + dr, nc = ((ec.col + dc) % MAP_COLS + MAP_COLS) % MAP_COLS;
          if (nr < 0 || nr >= MAP_ROWS) continue;
          if (hexDistance(nc, nr, ec.col, ec.row) > erad) continue;
          const t = game.map[nr][nc];
          if (t.improvement || t.road || t.base === 'ocean' || t.base === 'coast' || t.base === 'lake' || t.feature === 'mountain') continue;
          if (nc === ec.col && nr === ec.row) continue;
          if (Math.random() < 0.5) { t.improvement = 'farm'; ec.improvements = (ec.improvements || 0) + 1; break; }
        }
      }
    }

    // AI pop growth — tall factions grow existing cities faster
    const isTall = traits.expansion <= 0.4;
    const tallGrowthBonus = isTall ? 1.6 : 1.0;
    fc.population = (fc.population || 1000) + Math.floor((40 + 20 * traits.expansion) * tallGrowthBonus);
    for (const ec of expCities) ec.population = (ec.population || 500) + Math.floor((20 + 10 * traits.expansion) * tallGrowthBonus);

    // Tall factions expand borders faster on existing cities
    if (isTall) {
      if (fc.borderRadius < 4 && fc.population > 1200 + ((fc.borderRadius || 2) - 2) * 600) fc.borderRadius = Math.min(4, (fc.borderRadius || 2) + 1);
      for (const ec of expCities) {
        if (ec.borderRadius < 3 && ec.population > 600) ec.borderRadius = Math.min(3, (ec.borderRadius || 1) + 1);
      }
    }

    // AI city founding (must stay on main continent)
    // maxCities derived from expansion personality
    const maxExpansionCities = traits.expansion >= 0.8 ? 5 : traits.expansion >= 0.6 ? 4 : traits.expansion >= 0.5 ? 3 : traits.expansion >= 0.4 ? 2 : 1;
    const currentExpCities = (game.aiFactionCities[fid] || []).length;
    // Expansionist factions lower settler threshold faster and spawn settlers more often
    const settlerChance = traits.expansion >= 0.6 ? traits.expansion * 0.18 : traits.expansion * 0.12;
    const effectiveThreshold = traits.expansion >= 0.6 ? traits.settlerThreshold * 0.8 : traits.settlerThreshold;
    if (currentExpCities < maxExpansionCities && fc.population >= effectiveThreshold && Math.random() < settlerChance) {
      let bestSpot = null, bestDist = 0;
      for (let att = 0; att < 80; att++) {
        const rc = Math.floor(Math.random() * MAP_COLS), rr = Math.floor(Math.random() * MAP_ROWS);
        const t = game.map[rr][rc];
        if (t.base === 'ocean' || t.base === 'coast' || t.base === 'lake' || t.feature === 'mountain') continue;
        // Must be on the main continent
        if (game.continentId && game.mainContinent >= 0 && game.continentId[rr][rc] !== game.mainContinent) continue;
        const dist = hexDistance(rc, rr, fc.col, fc.row);
        if (dist < 5 || dist > 12) continue;
        let tooClose = false;
        for (const c of game.cities) { if (hexDistance(rc, rr, c.col, c.row) < 4) { tooClose = true; break; } }
        if (!tooClose) for (const [of2, ofc] of Object.entries(game.factionCities)) { if (hexDistance(rc, rr, ofc.col, ofc.row) < 5) { tooClose = true; break; } }
        if (!tooClose) for (const [of2, ecs] of Object.entries(game.aiFactionCities)) { for (const ec of ecs) { if (hexDistance(rc, rr, ec.col, ec.row) < 4) { tooClose = true; break; } } if (tooClose) break; }
        if (tooClose) continue;
        if (dist > bestDist) { bestDist = dist; bestSpot = { col: rc, row: rr }; }
      }
      if (bestSpot) {
        const names = ['Dun Mora','Kethara','Valdris','Ashenmire','Sunspire','Thornkeep','Greyvault','Windmere','Stonehallow','Duskfall','Embercrest','Frosthold','Ashwick','Grimholt','Ravenmoor','Irondale'];
        const used = [...Object.values(game.factionCities).map(c => c.name)];
        for (const ecs of Object.values(game.aiFactionCities)) for (const ec of ecs) used.push(ec.name);
        const avail = names.filter(n => !used.includes(n));
        const nm = avail.length > 0 ? avail[Math.floor(Math.random() * avail.length)] : FACTIONS[fid].name + ' Colony';
        if (!game.aiFactionCities[fid]) game.aiFactionCities[fid] = [];
        game.aiFactionCities[fid].push({ name: nm, col: bestSpot.col, row: bestSpot.row, color: fc.color, hp: 80, population: 500, borderRadius: 1, improvements: 0, owner: fid });
        fc.population -= 400;
        ai.cities = (ai.cities || 1) + 1;
        const gNbs = getHexNeighbors(bestSpot.col, bestSpot.row);
        const open = gNbs.find(nb => isTilePassable(game.map[nb.row][nb.col]) && !getUnitAt(nb.col, nb.row));
        if (open) game.units.push(createUnit('warrior', open.col, open.row, fid));
        if (game.fogOfWar[bestSpot.row] && game.fogOfWar[bestSpot.row][bestSpot.col]) {
          addEvent(FACTIONS[fid].name + ' founded ' + nm + '!', 'diplomacy');
        }
      }
    }
    if (!isTall) {
      if (fc.borderRadius < 3 && fc.population > 1500 + ((fc.borderRadius || 2) - 2) * 1000) fc.borderRadius = Math.min(3, (fc.borderRadius || 2) + 1);
      for (const ec of expCities) {
        if (ec.borderRadius < 2 && ec.population > 800) ec.borderRadius = 2;
      }
    }
  }

  // --- AI Unit Movement (personality-driven) ---
  for (const unit of game.units) {
    if (unit.owner === 'player') continue;
    const ut = UNIT_TYPES[unit.type];
    if (!ut) continue;
    unit.moveLeft = ut.movePoints;
    if (unit.fortified && unit.hp < 100) unit.hp = Math.min(100, unit.hp + 10);
    if (unit.alert) {
      const nearby = game.units.find(u => u.owner === 'player' && hexDistance(u.col, u.row, unit.col, unit.row) <= 3);
      if (nearby) { unit.alert = false; unit.sleeping = false; }
    }
    if (unit.sleeping || unit.fortified) continue;
    const factionCity = game.factionCities[unit.owner];
    if (!factionCity) continue;
    const traits = FACTION_TRAITS[unit.owner] || { patrolRange: 5, warThreshold: -30, military: 0.5 };
    const distToCity = hexDistance(unit.col, unit.row, factionCity.col, factionCity.row);
    const rel = game.relationships[unit.owner] || 0;
    const atWar = game.aiCommitments && game.aiCommitments.some(c => c.factionId === unit.owner && c.type === 'war');

    // AI engages nearby barbarians based on military trait
    let engagedBarb = false;
    if (traits.military > 0.3 && game.barbarianCamps) {
      const nearBarb = game.units.find(u => u.owner === 'barbarian' && hexDistance(u.col, u.row, unit.col, unit.row) <= 3);
      if (nearBarb && Math.random() < traits.military) {
        moveAIUnitToward(unit, nearBarb.col, nearBarb.row);
        if (hexDistance(unit.col, unit.row, nearBarb.col, nearBarb.row) <= 1 && unit.moveLeft > 0) {
          resolveCombat(unit, nearBarb);
        }
        engagedBarb = true;
      }
      // Militaristic factions also attack barbarian camps
      if (!engagedBarb && traits.military > 0.6) {
        const nearCamp = game.barbarianCamps.find(bc => !bc.destroyed && hexDistance(bc.col, bc.row, unit.col, unit.row) <= 4);
        if (nearCamp && Math.random() < traits.military * 0.3) {
          moveAIUnitToward(unit, nearCamp.col, nearCamp.row);
          if (hexDistance(unit.col, unit.row, nearCamp.col, nearCamp.row) <= 1) {
            nearCamp.strength -= Math.floor(ut.combat * 0.5);
            if (nearCamp.strength <= 0) {
              nearCamp.destroyed = true;
              game.units = game.units.filter(u => !(u.owner === 'barbarian' && hexDistance(u.col, u.row, nearCamp.col, nearCamp.row) <= 2));
              if (game.fogOfWar[nearCamp.row] && game.fogOfWar[nearCamp.row][nearCamp.col]) {
                addEvent((FACTIONS[unit.owner]?.name || unit.owner) + ' destroyed a barbarian camp!', 'combat');
              }
            }
          }
          engagedBarb = true;
        }
      }
    }
    if (engagedBarb) { unit.moveLeft = 0; continue; }

    // Hostile toward player
    if (rel < traits.warThreshold || atWar) {
      let nearP = null, nearD = Infinity;
      for (const pu of game.units) {
        if (pu.owner !== 'player') continue;
        const d = hexDistance(pu.col, pu.row, unit.col, unit.row);
        if (d < nearD) { nearD = d; nearP = pu; }
      }
      const aggRange = atWar ? 14 : Math.floor(6 + traits.military * 4);
      if (nearP && nearD <= aggRange) {
        moveAIUnitToward(unit, nearP.col, nearP.row);
        const adj = game.units.find(u => u.owner === 'player' && hexDistance(u.col, u.row, unit.col, unit.row) <= 1);
        if (adj && unit.moveLeft > 0) {
          const result = resolveCombat(unit, adj);
          if (result.defenderDied) addEvent(`${(FACTIONS[unit.owner]?.name || unit.owner)}'s ${ut.name} destroyed your ${UNIT_TYPES[adj.type].name}!`, 'combat');
          else if (!result.attackerDied) addEvent(`${(FACTIONS[unit.owner]?.name || unit.owner)}'s forces attacked!`, 'combat');
        }
        unit.moveLeft = 0; continue;
      }
    }

    // Patrol with personality range
    const pr = traits.patrolRange || 5;
    if (distToCity > pr) {
      moveAIUnitToward(unit, factionCity.col, factionCity.row);
    } else {
      const nbs = getHexNeighbors(unit.col, unit.row);
      const valid = nbs.filter(nb => isTilePassable(game.map[nb.row][nb.col]) && !getUnitAt(nb.col, nb.row) && hexDistance(nb.col, nb.row, factionCity.col, factionCity.row) <= pr + 1);
      if (valid.length > 0 && Math.random() < 0.5) {
        const t = valid[Math.floor(Math.random() * valid.length)];
        unit.col = t.col; unit.row = t.row;
      }
    }
    unit.moveLeft = 0;
    if (game.fogOfWar[unit.row] && game.fogOfWar[unit.row][unit.col] && !game.metFactions[unit.owner]) discoverFaction(unit.owner, 'encounter');
  }

  // --- City Ranged Strikes (Civ-style) ---
  // Capital cities fire at nearby player units
  for (const [fid, fc] of Object.entries(game.factionCities)) {
    if (!fc.hp || fc.hp <= 0) continue;
    const range = CITY_DEFENSE.RANGED_STRIKE_RANGE;
    let bestTarget = null, bestDist = Infinity;
    for (const pu of game.units) {
      if (pu.owner !== 'player') continue;
      const d = hexDistance(pu.col, pu.row, fc.col, fc.row);
      if (d <= range && d < bestDist) { bestDist = d; bestTarget = pu; }
    }
    if (bestTarget) {
      const strikeDmg = Math.max(3, Math.floor(CITY_DEFENSE.RANGED_STRIKE_STRENGTH * (fc.hp / CITY_DEFENSE.BASE_HP)));
      bestTarget.hp -= strikeDmg;
      const puType = UNIT_TYPES[bestTarget.type];
      if (game.fogOfWar[fc.row] && game.fogOfWar[fc.row][fc.col]) {
        addEvent(fc.name + ' bombards your ' + (puType ? puType.name : 'unit') + '! (-' + strikeDmg + ' HP)', 'combat');
      }
      if (bestTarget.hp <= 0) {
        game.units = game.units.filter(u => u.id !== bestTarget.id);
        addEvent('Your ' + (puType ? puType.name : 'unit') + ' destroyed by ' + fc.name + "'s defenses!", 'combat');
      }
    }
  }
  // Expansion cities also fire ranged strikes
  if (game.aiFactionCities) {
    for (const [fid, cities] of Object.entries(game.aiFactionCities)) {
      for (const ec of cities) {
        if (!ec.hp || ec.hp <= 0) continue;
        const range = CITY_DEFENSE.RANGED_STRIKE_RANGE;
        let bestTarget = null, bestDist = Infinity;
        for (const pu of game.units) {
          if (pu.owner !== 'player') continue;
          const d = hexDistance(pu.col, pu.row, ec.col, ec.row);
          if (d <= range && d < bestDist) { bestDist = d; bestTarget = pu; }
        }
        if (bestTarget) {
          const strikeDmg = Math.max(2, Math.floor(CITY_DEFENSE.RANGED_STRIKE_STRENGTH * 0.7 * ((ec.hp || 80) / CITY_DEFENSE.BASE_HP)));
          bestTarget.hp -= strikeDmg;
          const puType = UNIT_TYPES[bestTarget.type];
          if (game.fogOfWar[ec.row] && game.fogOfWar[ec.row][ec.col]) {
            addEvent(ec.name + ' bombards your ' + (puType ? puType.name : 'unit') + '! (-' + strikeDmg + ' HP)', 'combat');
          }
          if (bestTarget.hp <= 0) {
            game.units = game.units.filter(u => u.id !== bestTarget.id);
            addEvent('Your ' + (puType ? puType.name : 'unit') + ' destroyed by ' + ec.name + "'s defenses!", 'combat');
          }
        }
      }
    }
  }

  // --- Militaristic factions spawn units ---
  for (const [fid, fc] of Object.entries(game.factionCities)) {
    const traits = FACTION_TRAITS[fid] || { military: 0.5 };
    const fUnits = game.units.filter(u => u.owner === fid);
    const maxU = 3 + Math.floor(traits.military * 5) + Math.floor(game.turn / 15);
    if (fUnits.length < maxU && Math.random() < 0.08 + traits.military * 0.06) {
      const nbs = getHexNeighbors(fc.col, fc.row);
      const open = nbs.find(nb => isTilePassable(game.map[nb.row][nb.col]) && !getUnitAt(nb.col, nb.row));
      if (open) {
        const types = traits.military > 0.7 ? ['warrior','spearman','archer','chariot'] : ['warrior','scout','slinger'];
        game.units.push(createUnit(types[Math.floor(Math.random() * types.length)], open.col, open.row, fid));
      }
    }
  }

  // --- Dynamic Barbarian Spawning & Growth ---
  processBarbarianTurns();
}

// ============================================
// DYNAMIC BARBARIAN SYSTEM
// ============================================
export function processBarbarianTurns() {
  if (!game.barbarianCamps) game.barbarianCamps = [];

  // Ensure barbarian camps exist early for demo engagement
  if (game.turn >= 3 && game.barbarianCamps.filter(bc => !bc.destroyed).length === 0) {
    // Force-spawn a camp on the main continent
    for (let att = 0; att < 200; att++) {
      const c = 2 + Math.floor(Math.random() * (MAP_COLS - 4));
      const r = 2 + Math.floor(Math.random() * (MAP_ROWS - 4));
      const tile = game.map[r][c];
      if (tile.base === 'ocean' || tile.base === 'coast' || tile.base === 'lake' || tile.feature === 'mountain') continue;
      // Must be on the main continent
      if (game.continentId && game.mainContinent >= 0 && game.continentId[r][c] !== game.mainContinent) continue;
      let minDist = Infinity;
      for (const city of game.cities) minDist = Math.min(minDist, hexDistance(c, r, city.col, city.row));
      for (const fc of Object.values(game.factionCities)) minDist = Math.min(minDist, hexDistance(c, r, fc.col, fc.row));
      if (minDist < 4) continue;
      game.barbarianCamps.push({
        id: 'barb_forced_' + game.barbarianCamps.length,
        col: c, row: r,
        strength: 10,
        population: 100,
        destroyed: false,
        specialUnit: null,
        spawnedTurn: game.turn,
        raidTimer: 3,
        disposition: -10,
        tributePaid: 0,
        pacified: false,
      });
      const nbs = getHexNeighbors(c, r);
      for (const nb of nbs) {
        if (isTilePassable(game.map[nb.row][nb.col]) && !getUnitAt(nb.col, nb.row)) {
          game.units.push(createUnit('warrior', nb.col, nb.row, 'barbarian'));
          break;
        }
      }
      break;
    }
  }


  // Spawn new camps in remote areas every 6 turns
  const spawnInterval = 6;
  if (game.turn % spawnInterval === 0 && game.barbarianCamps.filter(bc => !bc.destroyed).length < 6 + Math.floor(game.turn / 20)) {
    for (let att = 0; att < 100; att++) {
      const c = 2 + Math.floor(Math.random() * (MAP_COLS - 4));
      const r = 2 + Math.floor(Math.random() * (MAP_ROWS - 4));
      const tile = game.map[r][c];
      if (tile.base === 'ocean' || tile.base === 'coast' || tile.base === 'lake' || tile.feature === 'mountain') continue;
      // Must be on the main continent
      if (game.continentId && game.mainContinent >= 0 && game.continentId[r][c] !== game.mainContinent) continue;
      // Must be REMOTE — far from all cities
      let minDist = Infinity;
      for (const city of game.cities) minDist = Math.min(minDist, hexDistance(c, r, city.col, city.row));
      for (const fc of Object.values(game.factionCities)) minDist = Math.min(minDist, hexDistance(c, r, fc.col, fc.row));
      if (game.aiFactionCities) for (const ecs of Object.values(game.aiFactionCities)) for (const ec of ecs) minDist = Math.min(minDist, hexDistance(c, r, ec.col, ec.row));
      if (minDist < 4) continue; // Too close to civilization
      // Not too close to existing barb camps
      const nearCamp = game.barbarianCamps.some(bc => !bc.destroyed && hexDistance(c, r, bc.col, bc.row) < 4);
      if (nearCamp) continue;

      // Determine camp type with specialist units
      const specialRoll = Math.random();
      let specialUnit = null;
      if (specialRoll < 0.15) specialUnit = 'horse_raider';
      else if (specialRoll < 0.25) specialUnit = 'berserker';
      else if (specialRoll < 0.30) specialUnit = 'war_drummer';
      else if (specialRoll < 0.33) specialUnit = 'shaman';

      game.barbarianCamps.push({
        id: 'barb_' + game.turn + '_' + game.barbarianCamps.length,
        col: c, row: r,
        strength: 8 + Math.floor(Math.random() * 12),
        population: 100,
        destroyed: false,
        specialUnit: specialUnit,
        spawnedTurn: game.turn,
        raidTimer: 0,
        disposition: -10,
        tributePaid: 0,
        pacified: false,
      });

      // Spawn initial garrison
      const nbs = getHexNeighbors(c, r);
      let spawned = 0;
      for (const nb of nbs) {
        if (spawned >= 1) break;
        if (isTilePassable(game.map[nb.row][nb.col]) && !getUnitAt(nb.col, nb.row)) {
          game.units.push(createUnit('warrior', nb.col, nb.row, 'barbarian'));
          spawned++;
        }
      }
      if (game.fogOfWar[r] && game.fogOfWar[r][c]) {
        addEvent('Barbarian encampment spotted in the wilderness!', 'combat');
      }
      break;
    }
  }

  // Existing camps grow and spawn raiders
  for (const camp of game.barbarianCamps) {
    if (camp.destroyed) continue;
    if (camp.pacified) continue; // Pacified camps don't spawn raiders

    // Growth
    camp.population += 20;
    if (camp.population > 300) camp.strength = Math.min(30, camp.strength + 1);

    // Spawn units — more frequent as camp grows
    const barbUnits = game.units.filter(u => u.owner === 'barbarian' && hexDistance(u.col, u.row, camp.col, camp.row) <= 5);
    const maxBarbs = 2 + Math.floor(camp.population / 200);
    camp.raidTimer++;

    if (barbUnits.length < maxBarbs && camp.raidTimer >= (6 - Math.min(3, Math.floor(camp.population / 300)))) {
      const nbs = getHexNeighbors(camp.col, camp.row);
      const open = nbs.find(nb => isTilePassable(game.map[nb.row][nb.col]) && !getUnitAt(nb.col, nb.row));
      if (open) {
        // Spawn specialist or regular unit
        if (camp.specialUnit && Math.random() < 0.35) {
          // Specialist barbarian unit
          const spec = BARBARIAN_UNITS[camp.specialUnit];
          const u = createUnit('warrior', open.col, open.row, 'barbarian');
          u.barbSpecial = camp.specialUnit;
          u.type = 'warrior'; // Base type for movement
          u.combat = spec.combat;
          u.barbName = spec.name;
          u.barbIcon = spec.icon;
          if (spec.movePoints) u.moveLeft = spec.movePoints;
          game.units.push(u);
        } else {
          game.units.push(createUnit('warrior', open.col, open.row, 'barbarian'));
        }
        camp.raidTimer = 0;
      }
    }
  }

  // Barbarian unit AI — raid nearby, wander toward settlements
  for (const unit of game.units) {
    if (unit.owner !== 'barbarian') continue;
    const ut = UNIT_TYPES[unit.type] || { movePoints: 2 };
    unit.moveLeft = unit.barbSpecial === 'horse_raider' ? 3 : ut.movePoints;

    if (unit.hp < 100 && unit.barbSpecial === 'shaman') unit.hp = Math.min(100, unit.hp + 10);

    // Find nearest target (player or AI unit/city)
    let nearTarget = null, nearDist = Infinity;
    for (const u of game.units) {
      if (u.owner === 'barbarian' || u.owner === unit.owner) continue;
      const d = hexDistance(u.col, u.row, unit.col, unit.row);
      if (d < nearDist) { nearDist = d; nearTarget = { col: u.col, row: u.row, unit: u }; }
    }

    if (nearTarget && nearDist <= 5) {
      // Move toward and attack
      moveAIUnitToward(unit, nearTarget.col, nearTarget.row);
      if (nearTarget.unit && hexDistance(unit.col, unit.row, nearTarget.unit.col, nearTarget.unit.row) <= 1 && unit.moveLeft > 0) {
        // Berserker special: +50% attack
        const origCombat = unit.combat;
        if (unit.barbSpecial === 'frenzy' || unit.barbSpecial === 'berserker') unit.combat = Math.floor((unit.combat || 20) * 1.5);
        const result = resolveCombat(unit, nearTarget.unit);
        unit.combat = origCombat;
        if (result.defenderDied && nearTarget.unit.owner === 'player') {
          addEvent('Barbarians destroyed your ' + (UNIT_TYPES[nearTarget.unit.type]?.name || 'unit') + '!', 'combat');
        }
      }
    } else {
      // Wander randomly
      const nbs = getHexNeighbors(unit.col, unit.row);
      const valid = nbs.filter(nb => isTilePassable(game.map[nb.row][nb.col]) && !getUnitAt(nb.col, nb.row));
      if (valid.length > 0 && Math.random() < 0.6) {
        const t = valid[Math.floor(Math.random() * valid.length)];
        unit.col = t.col; unit.row = t.row;
      }
    }
    unit.moveLeft = 0;
  }

  // War Drummer inspire: adjacent barbarians get combat bonus (handled in combat)
  // Shaman heal: adjacent barbarians heal
  for (const unit of game.units) {
    if (unit.owner !== 'barbarian' || unit.barbSpecial !== 'shaman') continue;
    for (const ally of game.units) {
      if (ally.owner !== 'barbarian' || ally === unit) continue;
      if (hexDistance(ally.col, ally.row, unit.col, unit.row) <= 1 && ally.hp < 100) {
        ally.hp = Math.min(100, ally.hp + 10);
      }
    }
  }
}

export function moveAIUnitToward(unit, targetCol, targetRow) {
  const neighbors = getHexNeighbors(unit.col, unit.row);
  let best = null, bestDist = hexDistance(unit.col, unit.row, targetCol, targetRow);

  for (const nb of neighbors) {
    const tile = game.map[nb.row][nb.col];
    if (!isTilePassable(tile)) continue;
    if (getUnitAt(nb.col, nb.row)) continue;
    const d = hexDistance(nb.col, nb.row, targetCol, targetRow);
    if (d < bestDist) {
      bestDist = d;
      best = nb;
    }
  }

  if (best) {
    unit.col = best.col;
    unit.row = best.row;
  }
}
