import { MAX_TURNS, UNIT_TYPES, BUILDINGS, TECHNOLOGIES, CIVICS, GOVERNMENTS, WONDERS, FACTIONS, FACTION_TRAITS, GREAT_PEOPLE_TYPES, LUXURY_RESOURCES, RESOURCES, MAP_COLS, MAP_ROWS, UNIT_MAINTENANCE, WALL_HP, TILE_IMPROVEMENTS, CITY_DEFENSE, DISTRICTS, UNREST, ZOC_EXEMPT_CLASSES, UNIT_RESOURCE_REQUIREMENTS } from './constants.js';
import { game, safeStorage, API } from './state.js';
import { hexDistance, getHexNeighbors } from './hex.js';
import { getTileYields, updateFactionStats, initFactionStats, isResourceRevealed, hasResourceAccess } from './map.js';
import { processAITurns, processBarbarianTurns, processAICommitments } from './diplomacy-api.js';
import { processImprovements, getImprovementYields, getAvailableImprovements, startImprovement } from './improvements.js';
import { addEvent, logAction, showToast, showCompletionNotification, generateFactionIntelReports, generateRumours, showIntelNotification, countPlayerTerritory, showWonderScoopedNotification, triggerEureka, triggerInspiration } from './events.js';
import { processAIWonderTurns, cancelAIWonderBuilders, processAIDistrictTurns } from './ai.js';
import { processEmbassyTurn, onRumourRevealed, ensureEmbassyState } from './embassy.js';
import { render, markVisibilityDirty } from './render.js';
import { checkVictoryConditions, hideSelectionPanel, closeAllPanels, placePlayerDistrict, findDistrictPlacement, openGovernmentPanel, isGovernmentUnlocked } from './ui-panels.js';
import { updateUI, updateEnvoyUI, submitToLeaderboard, showLeaderboard } from './leaderboard.js';
import { showGreatPersonNotification, useGreatPerson, showPantheonPicker } from './buildings.js';
import { discoverVisibleFactions, revealAround } from './discovery.js';
import { processUnitWaypoint } from './improvements.js';
import { isTilePassable } from './map.js';
import { getUnitAt, processZOCCaptures } from './combat.js';
import { decayReputation, detectContradictions, updateReputation, ensureReputationState } from './reputation.js';
import { createUnit, selectUnit, autoSelectNext, isTerritoryBlocked, getTileOwner } from './units.js';
import { autoSave } from './save-load.js';
import { clampCamera } from './input.js';
import { processAIDiplomacy, resetTurnActions, processAITradeIncome } from './ai-diplomacy.js';
import { calculateCityHousing, getHousingGrowthModifier } from './housing.js';

// --- Per-City Amenity Helpers ---

function getAmenityStatus(balance) {
  if (balance >= 2) return 'ECSTATIC';
  if (balance === 1) return 'HAPPY';
  if (balance === 0) return 'CONTENT';
  if (balance === -1) return 'DISPLEASED';
  if (balance === -2) return 'UNHAPPY';
  return 'REVOLT_RISK'; // -3 or worse
}

function getAmenityMod(balance) {
  if (balance >= 2) return 0.10;   // +10% production and growth
  if (balance === 1) return 0.05;  // +5% production and growth
  if (balance === 0) return 0;     // no modifier
  if (balance === -1) return -0.05; // -5% production and growth
  if (balance === -2) return -0.10; // -10% production and growth
  return -0.25; // -3 or worse: -25% production and growth
}

function areCitiesRoadConnected(c1, c2) {
  const dist = hexDistance(c1.col, c1.row, c2.col, c2.row);
  if (dist <= 1) return true; // Adjacent cities are always connected
  if (dist > 30) return false; // Too far for road connection
  let roadCount = 0;
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (game.map[r][c].road) {
        const d1 = hexDistance(c, r, c1.col, c1.row);
        const d2 = hexDistance(c, r, c2.col, c2.row);
        if (d1 + d2 <= dist + 2) roadCount++;
      }
    }
  }
  return roadCount >= dist * UNREST.ROAD_COVERAGE_THRESHOLD;
}

function distributeLuxuries(cities, luxuryTypes) {
  for (const city of cities) {
    city.amenityFromLuxuries = 0;
  }
  for (const _lux of luxuryTypes) {
    // Sort cities by current running amenity balance (lowest first = neediest)
    const sorted = [...cities].sort((a, b) => {
      const balA = (a.amenityFromLuxuries + a.amenityFromBuildings + a.amenityFromAlliance) - a.amenityRequired;
      const balB = (b.amenityFromLuxuries + b.amenityFromBuildings + b.amenityFromAlliance) - b.amenityRequired;
      return balA - balB;
    });
    const count = Math.min(4, sorted.length);
    for (let i = 0; i < count; i++) {
      sorted[i].amenityFromLuxuries += 1;
    }
  }
}

function calculateCityAmenities(events) {
  // 1. Collect unique luxury resource types in player territory
  const luxuryTypesInTerritory = new Set();
  for (const city of game.cities) {
    const br = city.borderRadius || 2;
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (hexDistance(c, r, city.col, city.row) <= br) {
          const t = game.map[r][c];
          if (t.resource && LUXURY_RESOURCES.includes(t.resource)) {
            luxuryTypesInTerritory.add(t.resource);
          }
        }
      }
    }
  }

  // 2. Calculate amenity requirements per city: 1 amenity per 2 citizens above base 2
  for (const city of game.cities) {
    const citizenCount = Math.floor((city.population || 1000) / 200);
    city.amenityRequired = Math.max(0, Math.floor((citizenCount - 2) / 2));
    city.amenityFromLuxuries = 0;
    city.amenityFromBuildings = 0;
    city.amenityFromAlliance = 0;
  }

  // 3. Building amenities: Arena/Garden/Temple each provide +1 to all cities
  const amenityBuildings = ['arena', 'garden', 'temple'];
  for (const city of game.cities) {
    for (const bid of amenityBuildings) {
      if (game.buildings.includes(bid)) {
        city.amenityFromBuildings += 1;
      }
    }
  }

  // 4. Alliance bonus: +1 to capital only
  if (Object.keys(game.activeAlliances).length > 0 && game.cities.length > 0) {
    game.cities[0].amenityFromAlliance = 1;
  }

  // 5. Distribute luxury amenities (each unique type -> +1 to up to 4 neediest cities)
  distributeLuxuries(game.cities, luxuryTypesInTerritory);

  // 6. Calculate unrest penalties per city
  const capital = game.cities[0]; // First city is always the capital
  const cityCount = game.cities.length;
  for (const city of game.cities) {
    city.unrestFromEmpireSize = 0;
    city.unrestFromDistance = 0;
    city.unrestFromCapture = 0;
    city.unrestGarrisonBonus = 0;

    // Empire size penalty: -1 per city beyond FREE_CITIES
    if (cityCount > UNREST.FREE_CITIES) {
      city.unrestFromEmpireSize = UNREST.EMPIRE_SIZE_PENALTY * (cityCount - UNREST.FREE_CITIES);
    }

    // Distance from capital penalty: -1 per DISTANCE_DIVISOR hexes
    if (capital && (city.col !== capital.col || city.row !== capital.row)) {
      const dist = hexDistance(city.col, city.row, capital.col, capital.row);
      city.unrestFromDistance = -Math.floor(dist / UNREST.DISTANCE_DIVISOR);
    }

    // Captured city penalty
    if (city.captured) {
      city.unrestFromCapture = UNREST.CAPTURED_PENALTY;
    }

    // Garrison bonus: fortified military unit in the city
    const garrison = game.units.find(u =>
      u.col === city.col && u.row === city.row &&
      u.owner === 'player' && u.fortified &&
      UNIT_TYPES[u.type] && !ZOC_EXEMPT_CLASSES.includes(UNIT_TYPES[u.type].class)
    );
    if (garrison) {
      city.unrestGarrisonBonus = UNREST.GARRISON_BONUS;
    }

    // Road connection bonus: connected to capital via roads
    city.roadConnected = false;
    city.amenityFromRoad = 0;
    if (capital && city !== capital) {
      if (areCitiesRoadConnected(city, capital)) {
        city.roadConnected = true;
        city.amenityFromRoad = UNREST.ROAD_CONNECTION_BONUS;
      }
    }
  }

  // 7. Calculate final balance, status, and modifier per city
  let totalBalance = 0;
  for (const city of game.cities) {
    const totalAmenities = city.amenityFromLuxuries + city.amenityFromBuildings + city.amenityFromAlliance + (city.amenityFromRoad || 0);
    const totalUnrest = city.unrestFromEmpireSize + city.unrestFromDistance + city.unrestFromCapture + city.unrestGarrisonBonus;
    city.amenityBalance = totalAmenities - city.amenityRequired + totalUnrest;
    city.amenityStatus = getAmenityStatus(city.amenityBalance);
    city.amenityMod = getAmenityMod(city.amenityBalance);
    totalBalance += city.amenityBalance;
  }

  // 8. Rebellion: REVOLT_RISK cities may rebel and become barbarian
  for (let i = game.cities.length - 1; i >= 0; i--) {
    const city = game.cities[i];
    if (city.amenityStatus !== 'REVOLT_RISK') continue;

    // Garrison reduces rebellion chance
    const hasGarrison = city.unrestGarrisonBonus > 0;
    let rebellionChance = hasGarrison ? UNREST.REBELLION_GARRISON_CHANCE : UNREST.REBELLION_BASE_CHANCE;

    // Suppression bonuses from recaptured rebel cities
    const suppressed = game.rebellionsSuppressed || 0;
    if (suppressed > 0) {
      if (city.rebellionSuppressed) {
        // This city was recaptured: 50% reduction + 10% per other suppression
        rebellionChance *= 0.5 * Math.pow(0.9, suppressed - 1);
      } else {
        // Other cities: 10% reduction per suppression
        rebellionChance *= Math.pow(0.9, suppressed);
      }
    }

    if (Math.random() >= rebellionChance) continue;

    // Capital cannot rebel — spawn a rebel unit instead
    if (i === 0) {
      const neighbors = getHexNeighbors(city.col, city.row);
      for (const nb of neighbors) {
        const tile = game.map[nb.row]?.[nb.col];
        if (!tile || !isTilePassable(tile)) continue;
        if (getUnitAt(nb.col, nb.row)) continue;
        const rebel = createUnit('warrior', nb.col, nb.row, 'barbarian');
        game.units.push(rebel);
        events.push(`Rebels have risen in ${city.name}!`);
        addEvent(`Rebels have risen in ${city.name}!`, 'combat');
        break;
      }
      continue;
    }

    // Non-capital city: full rebellion — becomes a barbarian camp
    const cityName = city.name;
    const cityCol = city.col;
    const cityRow = city.row;
    const cityPop = city.population || 500;

    // Remove city from player
    game.cities.splice(i, 1);
    game.population -= cityPop;
    game.score = Math.max(0, game.score - 20);

    // Create a barbarian camp at the city location
    game.minorFactions.push({
      id: `rebel_${cityName}_${game.turn}`,
      type: 'barbarian_camp',
      col: cityCol,
      row: cityRow,
      strength: 15 + Math.floor(Math.random() * 10),
      gold: 10 + Math.floor(Math.random() * 20),
      disposition: -20,
      interacted: false,
      defeated: false,
      converted: false,
      convertedRole: null,
    });

    // Spawn barbarian military units to defend the rebel city
    const militaryTypes = Object.entries(UNIT_TYPES)
      .filter(([, u]) => u.class === 'melee' || u.class === 'cavalry' || u.class === 'anti-cav')
      .map(([k]) => k);
    let spawned = 0;
    const spawnTiles = [{ col: cityCol, row: cityRow }, ...getHexNeighbors(cityCol, cityRow)];
    for (const tile of spawnTiles) {
      if (spawned >= UNREST.REBEL_UNIT_COUNT) break;
      const mapTile = game.map[tile.row]?.[tile.col];
      if (!mapTile || !isTilePassable(mapTile)) continue;
      if (getUnitAt(tile.col, tile.row)) continue;
      const rebelType = militaryTypes[Math.floor(Math.random() * militaryTypes.length)];
      const rebel = createUnit(rebelType, tile.col, tile.row, 'barbarian');
      rebel.fortified = true;
      game.units.push(rebel);
      spawned++;
    }

    events.push(`\u{1F525} ${cityName} has fallen into rebellion!`);
    addEvent(`\u{1F525} ${cityName} has fallen into rebellion! The city is lost!`, 'combat');
    showToast('Rebellion!', `${cityName} has rebelled and is now under barbarian control!`);
  }

  // Keep game.happiness as a summary value for backward compat (UI top bar, save compat)
  game.happiness = game.cities.length > 0 ? Math.round(totalBalance / game.cities.length) : 0;
}

let _processingTurn = false;
let _hasReportedTurnError = false; // rate-limit: one auto-report per game session

function reportTurnError(section, turn, error) {
  if (_hasReportedTurnError) return;
  _hasReportedTurnError = true;
  try {
    fetch(API + '/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-visitor-id': safeStorage.getItem('uncivilised_visitor_id') || '',
      },
      body: JSON.stringify({
        message: `[AUTO] Turn ${turn} error in "${section}": ${String(error)}. Stack: ${error?.stack?.split?.('\n')?.slice(0, 4)?.join(' | ') || 'N/A'}`,
        visitor_id: safeStorage.getItem('uncivilised_visitor_id') || null,
        player_name: safeStorage.getItem('uncivilised_username') || null,
        game_state: {
          turn, gold: game.gold, military: game.military,
          population: game.population, score: game.score,
          cities: game.cities?.length, units: game.units?.filter(u => u.owner === 'player')?.length,
        },
      }),
    }).catch(() => {}); // fire-and-forget
  } catch (_) { /* never let reporting itself break anything */ }
}

function continueAfterVictory() {
  game.gameOver = false;
  game.postVictoryPlay = true;
  document.getElementById('game-over').style.display = 'none';
  const btn = document.getElementById('btn-end-turn');
  if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
}

function endTurn() {
  if (!game || (game.turn > MAX_TURNS && !game.postVictoryPlay) || game.gameOver) return;
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

  // --- Reset player unit move points and process waypoints ---
  // Done BEFORE AI processing so an AI error can't block player movement reset
  for (const unit of game.units) {
    if (unit.owner !== 'player') continue;
    const ut = UNIT_TYPES[unit.type];
    const didIdleLastTurn = unit.moveLeft === ut.movePoints;
    unit.moveLeft = ut.movePoints;
    unit.hasAttackedThisTurn = false;

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
      } else if (didIdleLastTurn) {
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

    // Alert: wake up if threat detected nearby
    if (unit.alert) {
      const ALERT_RANGE = 4;
      let wakeReason = '';

      // 1. Enemy or barbarian unit within alert range
      const nearbyEnemy = game.units.find(u =>
        u.owner !== 'player' && u.owner !== unit.owner &&
        hexDistance(u.col, u.row, unit.col, unit.row) <= ALERT_RANGE
      );
      if (nearbyEnemy) {
        const enemyType = UNIT_TYPES[nearbyEnemy.type];
        const ownerName = FACTIONS[nearbyEnemy.owner]?.name || nearbyEnemy.owner;
        wakeReason = `spotted ${ownerName} ${enemyType?.name || 'unit'} nearby!`;
      }

      // 2. New enemy expansion city founded within alert range
      if (!wakeReason) {
        for (const [fid, cities] of Object.entries(game.aiFactionCities || {})) {
          for (const ec of cities) {
            if (hexDistance(ec.col, ec.row, unit.col, unit.row) <= ALERT_RANGE) {
              const fName = FACTIONS[fid]?.name || fid;
              wakeReason = `${fName} founded a city nearby!`;
              break;
            }
          }
          if (wakeReason) break;
        }
      }

      // 3. Barbarian camp within alert range
      if (!wakeReason && game.barbarianCamps) {
        const nearbyCamp = game.barbarianCamps.find(bc =>
          !bc.destroyed && hexDistance(bc.col, bc.row, unit.col, unit.row) <= ALERT_RANGE
        );
        if (nearbyCamp) {
          wakeReason = 'barbarian camp detected nearby!';
        }
      }

      // 4. War declared against player this turn
      if (!wakeReason) {
        const newWar = (game.aiWars || []).find(w =>
          w.defender === 'player' && w.startTurn === game.turn
        );
        if (newWar) {
          const aggressorName = FACTIONS[newWar.attacker]?.name || newWar.attacker;
          wakeReason = `${aggressorName} declared war!`;
        }
      }

      if (wakeReason) {
        unit.alert = false;
        unit.sleeping = false;
        addEvent(`${ut.name} woke up — ${wakeReason}`, 'combat');
      }
    }
  }

  // --- Auto-discover factions whose cities/units are in revealed tiles ---
  discoverVisibleFactions();

  // --- Process AI (wrapped so failures don't block player turn) ---
  try {
    processAITurns();
  } catch (e) { console.error('Error in processAITurns:', e); }
  try {
    processZOCCaptures();
  } catch (e) { console.error('Error in processZOCCaptures:', e); }
  try {
    processAIWonderTurns();
  } catch (e) { console.error('Error in processAIWonderTurns:', e); }
  try {
    processAIDistrictTurns();
  } catch (e) { console.error('Error in processAIDistrictTurns:', e); }

  // --- AI-to-AI diplomacy (rule-based negotiations between AI factions) ---
  resetTurnActions();
  try {
    processAIDiplomacy();
    processAITradeIncome();
  } catch (e) { console.error('Error in AI diplomacy:', e); }

  // --- Eject any units trespassing after diplomacy changes (peace, expired borders) ---
  try {
    ejectTrespassingUnits();
  } catch (e) { console.error('Error ejecting trespassing units:', e); }

  // --- Player turn processing (resilient — errors won't block turn advancement) ---
  let _turnSection = '';
  try {

  _turnSection = 'income';
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

  _turnSection = 'amenities';
  // --- Per-City Amenity System ---
  calculateCityAmenities(events);


  _turnSection = 'resources';
  // --- Tile yields + resource bonuses from territory (respects city border radius) ---
  let resBonus = { food: 0, gold: 0, prod: 0 };
  const countedTiles = new Set(); // avoid double-counting tiles in overlapping city borders
  for (const city of game.cities) {
    const bRadius = city.borderRadius || 2;
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (hexDistance(c, r, city.col, city.row) <= bRadius) {
          const tileKey = r * MAP_COLS + c;
          if (countedTiles.has(tileKey)) continue;
          countedTiles.add(tileKey);
          const tile = game.map[r][c];
          // Collect gold from tile improvements and terrain features
          const tileYields = getTileYields(tile);
          if (tileYields.gold > 0) resBonus.gold += tileYields.gold;
          // Resource bonuses (food/prod) — kept separate from tile yields
          if (tile.resource && RESOURCES[tile.resource] && isResourceRevealed(tile.resource)) {
            const bonus = RESOURCES[tile.resource].bonus;
            if (bonus.food) resBonus.food += bonus.food;
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

  _turnSection = 'population';
  // --- Food & Population (per-city growth) ---
  for (const city of game.cities) {
    if (!city.food) city.food = 0;
    // Calculate food for this city based on its tiles
    const cityFood = game.foodPerTurn / game.cities.length; // Split evenly for now
    city.food += cityFood;
    // Growth threshold scales with city population
    const growthThreshold = 15 + Math.floor((city.population || 1000) / 500);
    // Apply per-city amenity modifier to growth
    // NOTE: If Housing (Task 09) is implemented, housing modifier should be applied as a separate multiplier here
    let growthMod = 1.0 + (city.amenityMod || 0);

    // Apply housing growth modifier
    const { housing } = calculateCityHousing(city);
    const housingMod = getHousingGrowthModifier(housing, city.population || 1000);
    growthMod *= housingMod;

    if (growthMod > 0 && city.food * growthMod >= growthThreshold) {
      city.food = 0;
      city.population = (city.population || 1000) + 100;
      game.population += 100;
      events.push(city.name + ' grew! (pop ' + city.population + ')');
    } else if (housingMod === 0) {
      // Stagnant — food doesn't accumulate past threshold
      city.food = Math.min(city.food, growthThreshold - 1);
    }
  }

  _turnSection = 'walls';
  // --- Wall repair: +5 HP per turn if not attacked for 2 turns ---
  for (const city of game.cities) {
    // Initialize wall fields if building walls was just completed
    if ((city.buildings || []).includes('walls') && !city.wallMaxHP) {
      city.wallMaxHP = WALL_HP.ancient_walls;
      if (city.wallHP === undefined) city.wallHP = WALL_HP.ancient_walls;
    }
    if (city.wallHP !== undefined && city.wallMaxHP > 0 && city.wallHP < city.wallMaxHP) {
      const lastAttacked = city.wallLastAttackedTurn || -99;
      if (game.turn - lastAttacked >= 2) {
        const oldWallHP = city.wallHP;
        city.wallHP = Math.min(city.wallMaxHP, city.wallHP + 5);
        if (city.wallHP > oldWallHP) {
          events.push(city.name + ' walls repaired (+' + (city.wallHP - oldWallHP) + ' wall HP)');
        }
      }
    }
  }
  // Wall repair for faction cities
  if (game.factionCities) {
    for (const fc of Object.values(game.factionCities)) {
      if (fc.wallHP !== undefined && fc.wallMaxHP > 0 && fc.wallHP < fc.wallMaxHP) {
        const lastAttacked = fc.wallLastAttackedTurn || -99;
        if (game.turn - lastAttacked >= 2) {
          fc.wallHP = Math.min(fc.wallMaxHP, fc.wallHP + 5);
        }
      }
    }
  }
  // Wall repair for AI expansion cities
  if (game.aiFactionCities) {
    for (const cities of Object.values(game.aiFactionCities)) {
      for (const ec of cities) {
        if (ec.wallHP !== undefined && ec.wallMaxHP > 0 && ec.wallHP < ec.wallMaxHP) {
          const lastAttacked = ec.wallLastAttackedTurn || -99;
          if (game.turn - lastAttacked >= 2) {
            ec.wallHP = Math.min(ec.wallMaxHP, ec.wallHP + 5);
          }
        }
      }
    }
  }

  // --- Player City Ranged Strikes ---
  // Player cities fire at nearby non-player units (same as AI cities do)
  if (game.cities) {
    for (const city of game.cities) {
      if (!city.hp || city.hp <= 0) continue;
      const range = CITY_DEFENSE.RANGED_STRIKE_RANGE;
      let bestTarget = null, bestDist = Infinity;
      // Find closest non-player unit within range
      for (const unit of game.units) {
        if (unit.owner === 'player') continue;
        const d = hexDistance(unit.col, unit.row, city.col, city.row);
        if (d <= range && d < bestDist) { bestDist = d; bestTarget = unit; }
      }
      if (bestTarget) {
        // Damage scales with city HP, base is RANGED_STRIKE_STRENGTH
        const cityHPRatio = city.hp !== undefined ? city.hp / CITY_DEFENSE.BASE_HP : 1;
        let strikeDmg = Math.max(3, Math.floor(CITY_DEFENSE.RANGED_STRIKE_STRENGTH * cityHPRatio));
        // Add wall bonus if city has walls
        if (city.wallHP !== undefined && city.wallHP > 0) {
          strikeDmg += 5;
        }
        bestTarget.hp -= strikeDmg;
        const targetType = UNIT_TYPES[bestTarget.type];
        const targetName = targetType ? targetType.name : 'unit';
        addEvent(city.name + ' bombards the ' + targetName + '! (-' + strikeDmg + ' HP)', 'combat');
        if (bestTarget.hp <= 0) {
          game.units = game.units.filter(u => u.id !== bestTarget.id);
          addEvent('Enemy ' + targetName + ' destroyed by ' + city.name + "'s defenses!", 'combat');
        }
      }
    }
  }

  _turnSection = 'improvements';
  // --- Process tile improvements ---
  processImprovements();

  _turnSection = 'production';
  // --- Production (Buildings OR Units — one at a time) ---
  let prodThisTurn = game.productionPerTurn + resBonus.prod;
  // Government production bonuses
  if (game.government === 'oligarchy' && GOVERNMENTS.oligarchy) {
    // Oligarchy: +30% building production
    if (game.currentBuild) prodThisTurn = Math.floor(prodThisTurn * 1.3);
  }
  // Amenity production modifier (average across all cities since production is global)
  if (game.cities.length > 0) {
    const avgAmenityMod = game.cities.reduce((sum, c) => sum + (c.amenityMod || 0), 0) / game.cities.length;
    if (avgAmenityMod !== 0) prodThisTurn = Math.floor(prodThisTurn * (1 + avgAmenityMod));
  }
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
      // Initialize wall HP when walls building completes
      if (game.currentBuild === 'walls') {
        const buildCity = game.cities[0]; // Primary city for global builds
        if (buildCity) {
          buildCity.wallMaxHP = WALL_HP.ancient_walls;
          buildCity.wallHP = WALL_HP.ancient_walls;
          buildCity.wallLastAttackedTurn = -99;
        }
      }
      events.push(`${bdata.name} completed!`);
      addEvent(`${bdata.name} completed!`, 'gold');
      const completedBuildId = game.currentBuild;
      game.currentBuild = null;
      game.buildProgress = 0;
      showCompletionNotification('building', bdata.name, bdata.desc);
      if (typeof showToast === 'function') showToast('\u{1F3D7} Building Complete', bdata.name + ' constructed!');

      // --- Eureka/Inspiration triggers for buildings ---
      if (completedBuildId === 'barracks') triggerEureka('iron_working');
      if (completedBuildId === 'arena') triggerInspiration('games_recreation');
      // state_workforce: building in 2 cities (approximated: have 2+ cities and 2+ buildings)
      if (game.cities.length >= 2 && game.buildings.length >= 2) triggerInspiration('state_workforce');
      // drama_poetry: monument in 2 cities (approximated: have monument and 2+ cities)
      if (completedBuildId === 'monument' && game.cities.length >= 2) triggerInspiration('drama_poetry');
      // recorded_history: library in 2 cities (approximated: have library and 2+ cities)
      if (completedBuildId === 'library' && game.cities.length >= 2) triggerInspiration('recorded_history');
    }
  } else if (game.currentUnitBuild) {
    game.unitBuildProgress += prodThisTurn;
    const ut = UNIT_TYPES[game.currentUnitBuild];
    // Substitute mechanic: check resource access for cost/stat penalties
    const resReq = UNIT_RESOURCE_REQUIREMENTS[game.currentUnitBuild];
    const hasResource = resReq ? hasResourceAccess(resReq.resource, 'player') : true;
    const effectiveCost = hasResource ? ut.cost : Math.ceil(ut.cost * resReq.costMultiplier);
    if (ut && game.unitBuildProgress >= effectiveCost) {
      // Place unit near the city that started the build (fallback to any city with room)
      const buildCityIdx = game.unitBuildCityIdx || 0;
      const cityOrder = [...game.cities];
      // Put the build city first, then try others
      if (buildCityIdx > 0 && buildCityIdx < cityOrder.length) {
        const buildCity = cityOrder.splice(buildCityIdx, 1)[0];
        cityOrder.unshift(buildCity);
      }
      let placed = false;
      let placedCity = null;
      for (const city of cityOrder) {
        const neighbors = getHexNeighbors(city.col, city.row);
        for (const nb of neighbors) {
          const tile = game.map[nb.row][nb.col];
          if (!isTilePassable(tile)) continue;
          if (getUnitAt(nb.col, nb.row)) continue;
          const newUnit = createUnit(game.currentUnitBuild, nb.col, nb.row, 'player');
          newUnit.moveLeft = 0;
          // Apply substitute penalties if no resource access
          if (!hasResource && resReq) {
            newUnit.combat = Math.max(0, (newUnit.combat || ut.combat) - resReq.combatPenalty);
            if (resReq.rangedPenalty && newUnit.rangedCombat) newUnit.rangedCombat = Math.max(0, newUnit.rangedCombat - resReq.rangedPenalty);
            if (resReq.movePenalty) newUnit.movePoints = Math.max(1, (newUnit.movePoints || ut.movePoints) - resReq.movePenalty);
            newUnit.substitute = true;
          }
          game.units.push(newUnit);
          game.military += Math.floor(ut.combat / 4);
          placed = true;
          placedCity = city;
          break;
        }
        if (placed) break;
      }
      if (placed) {
        if (game.currentUnitBuild === 'settler') {
          game.population = Math.max(500, game.population - 500);
          if (placedCity) placedCity.population = Math.max(500, (placedCity.population || game.population) - 500);
        }
        const subLabel = (!hasResource && resReq) ? ` (substitute — no ${RESOURCES[resReq.resource]?.name || resReq.resource})` : '';
        events.push(`${ut.name} trained!${subLabel}`);
        addEvent(`${ut.name} trained in ${placedCity ? placedCity.name : 'city'}!${subLabel}`, 'combat');
        game.currentUnitBuild = null;
        game.unitBuildProgress = 0;
        game.unitBuildCityIdx = 0;
        showCompletionNotification('unit', ut.name, ut.desc);
        if (typeof showToast === 'function') showToast('\u2694 Unit Ready', ut.name + ' trained!' + subLabel);
      } else {
        addEvent(`${ut.name} ready but no room — clear tiles near city`, 'combat');
        game.unitBuildProgress = effectiveCost;
      }
    }
  } else if (game.currentDistrictBuild) {
    game.districtBuildProgress += prodThisTurn;
    const ddata = DISTRICTS[game.currentDistrictBuild];
    if (!ddata) { game.currentDistrictBuild = null; game.districtBuildProgress = 0; game.districtBuildTarget = null; }
    else if (game.districtBuildProgress >= ddata.cost) {
      // District completed — place it on the map
      let target = game.districtBuildTarget;
      // Re-validate: if the target tile already has a district, find a new spot
      if (target && game.map[target.row] && game.map[target.row][target.col] &&
          game.map[target.row][target.col].district) {
        target = findDistrictPlacement(game.currentDistrictBuild);
      }
      if (target && game.map[target.row] && game.map[target.row][target.col]) {
        placePlayerDistrict(game.currentDistrictBuild, target);
      }
      events.push(ddata.icon + ' ' + ddata.name + ' district completed!');
      addEvent(ddata.icon + ' ' + ddata.name + ' district completed!', 'gold');
      showCompletionNotification('district', ddata.name, ddata.desc);
      if (typeof showToast === 'function') showToast('\u{1F3D8} District Complete', ddata.name + ' district placed!');
      game.currentDistrictBuild = null;
      game.districtBuildProgress = 0;
      game.districtBuildTarget = null;
    }
  } else if (game.currentWonderBuild) {
    // Check if another faction already completed this wonder (AI scooped it)
    if (game.builtWonders[game.currentWonderBuild]) {
      const scoopedW = WONDERS.find(w => w.id === game.currentWonderBuild);
      const ownerFid = game.builtWonders[game.currentWonderBuild];
      const ownerName = FACTIONS[ownerFid] ? FACTIONS[ownerFid].name : ownerFid;
      const refundGold = Math.floor(game.wonderBuildProgress * 0.5);
      game.gold += refundGold;
      showWonderScoopedNotification(scoopedW ? scoopedW.name : game.currentWonderBuild, ownerName, refundGold);
      game.currentWonderBuild = null;
      game.wonderBuildProgress = 0;
    } else {
      game.wonderBuildProgress += prodThisTurn;
      const wdata = WONDERS.find(w => w.id === game.currentWonderBuild);
      if (wdata && game.wonderBuildProgress >= wdata.cost) {
        game.wonders.push(game.currentWonderBuild);
        game.builtWonders[game.currentWonderBuild] = 'player';
        const eff = wdata.effect;
        if (eff.food) game.foodPerTurn += eff.food;
        if (eff.gold) game.goldPerTurn += eff.gold;
        if (eff.science) game.sciencePerTurn += eff.science;
        if (eff.production) game.productionPerTurn += eff.production;
        if (eff.culture) game.culture += eff.culture;
        events.push(wdata.icon + ' ' + wdata.name + ' completed!');
        addEvent(wdata.icon + ' ' + wdata.name + ' completed!', 'gold');
        // Cancel AI factions building the same wonder and refund them
        cancelAIWonderBuilders(game.currentWonderBuild, 'player');
        game.currentWonderBuild = null;
        game.wonderBuildProgress = 0;
        showCompletionNotification('wonder', wdata.name, wdata.desc);
        showToast('\u{1F3DB} Wonder Complete', wdata.name + ' has been built!');
        // --- Eureka: complete a wonder triggers engineering ---
        triggerEureka('engineering');
      }
    }
  }

  _turnSection = 'research';
  // --- Research ---
  if (game.currentResearch) {
    game.researchProgress += game.sciencePerTurn;
    const tdata = TECHNOLOGIES.find(t => t.id === game.currentResearch);
    if (!tdata) { game.currentResearch = null; game.researchProgress = 0; }
    else if (game.researchProgress >= tdata.cost) {
      const completedTechId = game.currentResearch;
      // Snapshot unlocked governments before adding tech
      const govsBefore = new Set(Object.keys(GOVERNMENTS).filter(gid => isGovernmentUnlocked(gid)));
      game.techs.push(completedTechId);
      events.push(`${tdata.name} discovered!`);
      addEvent(`Technology: ${tdata.name} discovered!`, 'science');
      game.currentResearch = null;
      game.researchProgress = 0;
      // Show completion notification with prompt
      showCompletionNotification('research', tdata.name, tdata.desc);
      if (typeof showToast === 'function') showToast('\u{1F4A1} Research Complete', tdata.name + ' researched!');
      // Check if this tech unlocked a new government
      for (const [gid, gov] of Object.entries(GOVERNMENTS)) {
        if (gid === game.government) continue;
        if (!govsBefore.has(gid) && isGovernmentUnlocked(gid)) {
          showToast('\u{1F3DB} New Government', (gov.icon || '') + ' ' + gov.name + ' is now available!', 5000);
          addEvent('New government unlocked: ' + gov.name, 'gold');
          setTimeout(() => openGovernmentPanel(), 600);
        }
      }

      // --- Reveal strategic resources gated by this tech ---
      const newlyRevealed = Object.entries(RESOURCES)
        .filter(([, res]) => res.revealedBy === completedTechId)
        .map(([resId]) => resId);
      if (newlyRevealed.length > 0) {
        if (!game.revealedResources) game.revealedResources = [];
        const now = Date.now();
        for (const resId of newlyRevealed) {
          if (!game.revealedResources.includes(resId)) game.revealedResources.push(resId);
          let depositCount = 0;
          for (let r = 0; r < MAP_ROWS; r++) {
            for (let c = 0; c < MAP_COLS; c++) {
              const tile = game.map[r][c];
              if (tile.resource === resId) {
                tile._revealedAt = now; // trigger reveal animation
                depositCount++;
              }
            }
          }
          const resName = RESOURCES[resId].name;
          if (typeof showToast === 'function') showToast('\u{26CF}\u{FE0F} Resource Discovered', `Research complete: ${tdata.name} \u{2014} ${resName} deposits revealed! (${depositCount} deposits found)`);
          addEvent(`Research complete: ${tdata.name} \u{2014} ${resName} deposits revealed! (${depositCount} deposits found)`, 'science');
        }
      }
    }
  }

  _turnSection = 'culture';
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
  // District culture bonuses
  if (game.playerDistricts) {
    for (const did of game.playerDistricts) {
      const dd = DISTRICTS[did];
      if (dd && dd.yields && dd.yields.culture) cpt += dd.yields.culture;
    }
    // Add adjacency culture bonuses from placed districts
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const tile = game.map[r][c];
        if (tile.district && game.playerDistricts.includes(tile.district)) {
          const dd = DISTRICTS[tile.district];
          if (dd && dd.adjacency) {
            const nbs = getHexNeighbors(c, r);
            for (const nb of nbs) {
              const nt = game.map[nb.row] && game.map[nb.row][nb.col];
              if (!nt) continue;
              for (const [adjType, yields] of Object.entries(dd.adjacency)) {
                if (!yields.culture) continue;
                let match = false;
                if (adjType === 'mountain' && nt.feature === 'mountain') match = true;
                else if (adjType === 'woods' && (nt.feature === 'woods' || nt.feature === 'rainforest')) match = true;
                else if (adjType === 'natural_wonder' && nt.naturalWonder) match = true;
                if (match) cpt += yields.culture;
              }
            }
          }
        }
      }
    }
  }
  game.culturePerTurn = cpt;
  game.culture += cpt;

  // --- Civic progression ---
  if (game.currentCivic) {
    game.civicProgress += game.culturePerTurn;
    const cdata = CIVICS.find(c => c.id === game.currentCivic);
    if (cdata && game.civicProgress >= cdata.cost) {
      // Snapshot unlocked governments before adding civic
      const govsBefore = new Set(Object.keys(GOVERNMENTS).filter(gid => isGovernmentUnlocked(gid)));
      game.civics.push(game.currentCivic);
      events.push('Civic: ' + cdata.name + ' adopted!');
      addEvent('Civic: ' + cdata.name + ' adopted!', 'gold');
      // Check if unlocks pantheon
      if (cdata.unlocks && cdata.unlocks.includes('pantheon') && !game.pantheon) {
        setTimeout(() => showPantheonPicker(), 500);
      }
      // Check if this civic unlocked a new government
      for (const [gid, gov] of Object.entries(GOVERNMENTS)) {
        if (gid === game.government) continue;
        if (!govsBefore.has(gid) && isGovernmentUnlocked(gid)) {
          showToast('\u{1F3DB} New Government', (gov.icon || '') + ' ' + gov.name + ' is now available!', 5000);
          addEvent('New government unlocked: ' + gov.name, 'gold');
          setTimeout(() => openGovernmentPanel(), 600);
        }
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

  _turnSection = 'great_people';
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


  _turnSection = 'diplomacy_upkeep';
  // --- Alliance upkeep ---
  for (const [cid, alliance] of Object.entries(game.activeAlliances)) {
    if (game.turn >= alliance.startTurn + alliance.turns) {
      delete game.activeAlliances[cid];
      addEvent(`Alliance with ${FACTIONS[cid]?.name || cid} expired`, 'diplomacy');
      updateReputation(cid, 'alliance_honoured', `Alliance with ${FACTIONS[cid]?.name || cid} honoured to completion`);
    }
  }

  // --- Trade deal processing ---
  for (const [cid, deal] of Object.entries(game.tradeDeals)) {
    if (game.turn >= deal.startTurn + deal.duration) {
      delete game.tradeDeals[cid];
      addEvent(`Trade deal with ${FACTIONS[cid]?.name || cid} expired`, 'gold');
      updateReputation(cid, 'trade_deal_honoured', `Trade deal with ${FACTIONS[cid]?.name || cid} honoured to completion`);
      continue;
    }
    // Parse and apply trade effects per turn
    const receives = String(deal.playerReceives || '');
    if (receives.includes('gold')) { const m = receives.match(/(\d+)/); if (m) game.gold += parseInt(m[1]) || 0; }
    if (receives.includes('science')) { const sciAmt = parseInt(receives.match(/(\d+)/)?.[1]) || 2; game.researchProgress = (game.researchProgress || 0) + sciAmt; }
    if (receives.includes('military')) { game.military += 1; }
    // One-time technology grant (safe to check every turn — tech already owned is skipped)
    if (receives.includes('tech')) {
      const techMatch = receives.match(/tech(?:nology)?[:\s]+(\w+)/i);
      if (techMatch) {
        const techId = techMatch[1];
        if (!game.techs.includes(techId)) {
          game.techs.push(techId);
          const tdata = TECHNOLOGIES.find(t => t.id === techId);
          addEvent(`Received technology: ${tdata?.name || techId} from trade agreement`, 'science');
        }
      }
    }
    // Deduct what player gives
    const gives = String(deal.playerGives || '');
    if (gives.includes('gold')) { const m = gives.match(/(\d+)/); if (m) game.gold -= Math.min(game.gold, parseInt(m[1]) || 0); }
    if (gives.includes('science')) { const sciAmt = parseInt(gives.match(/(\d+)/)?.[1]) || 2; game.researchProgress = Math.max(0, (game.researchProgress || 0) - sciAmt); }
  }

  // --- Defense pact upkeep ---
  for (const [cid, pact] of Object.entries(game.defensePacts)) {
    if (game.turn >= pact.startTurn + pact.duration) {
      delete game.defensePacts[cid];
      game.defense = Math.max(0, game.defense - 3);
      addEvent(`Defense pact with ${FACTIONS[cid]?.name || cid} expired`, 'diplomacy');
      updateReputation(cid, 'defense_pact_honoured', `Defense pact with ${FACTIONS[cid]?.name || cid} honoured`);
    }
  }

  // --- Road trade income between cities ---
  if (game.cities.length > 1) {
    let roadTradeGold = 0;
    for (let i = 0; i < game.cities.length; i++) {
      for (let j = i + 1; j < game.cities.length; j++) {
        if (areCitiesRoadConnected(game.cities[i], game.cities[j])) {
          roadTradeGold += 3;
          if (game.turn % 10 === 1) addEvent('Trade route: ' + game.cities[i].name + ' \u2194 ' + game.cities[j].name + ' (+3 gold)', 'gold');
        }
      }
    }
    // Bonus gold for each city road-connected to the capital
    for (let i = 1; i < game.cities.length; i++) {
      if (game.cities[i].roadConnected) {
        roadTradeGold += UNREST.ROAD_TRADE_GOLD;
      }
    }
    if (roadTradeGold > 0) game.gold += roadTradeGold;
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

  _turnSection = 'diplomacy_bonds';
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

  _turnSection = 'faction_systems';
  // --- Update faction AI economies ---
  updateFactionStats();

  // --- AI unit spawning (same costs as player) ---
  processAIUnitSpawning();

  // --- AI worker auto-improve & settler auto-found ---
  processAIWorkerImprovements();

  // --- Embassy turn processing (gossip accumulation) ---
  ensureEmbassyState();
  processEmbassyTurn();

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
      addEvent(`Open borders with ${FACTIONS[cid]?.name || cid} expired`, 'diplomacy');
      // Eject units that are now trespassing
      ejectTrespassingUnits(cid);
    }
  }

  // --- Embargo upkeep ---
  for (const [cid, emb] of Object.entries(game.embargoes || {})) {
    if (game.turn >= emb.startTurn + emb.duration) {
      delete game.embargoes[cid];
      addEvent(`Embargo against ${FACTIONS[cid]?.name || cid} lifted`, 'diplomacy');
    } else {
      // Embargoes reduce target's trade income (simulated)
      game.relationships[cid] = (game.relationships[cid] || 0) - 2;
    }
  }

  // --- Ceasefire upkeep ---
  for (const [cid, cf] of Object.entries(game.ceasefires || {})) {
    if (game.turn >= cf.startTurn + cf.duration) {
      delete game.ceasefires[cid];
      addEvent(`Ceasefire with ${FACTIONS[cid]?.name || cid} expired`, 'diplomacy');
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
      addEvent(`Non-aggression pact with ${FACTIONS[cid]?.name || cid} expired`, 'diplomacy');
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

  _turnSection = 'auto_management';
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

  // Player unit purchases are manual only — no auto-buy

  _turnSection = 'fog_and_score';
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

  _turnSection = 'reputation';
  // --- Reputation decay & contradiction detection ---
  ensureReputationState();
  decayReputation();
  detectContradictions();

  } catch (e) {
    console.error(`[endTurn] Error in "${_turnSection}" (turn ${game.turn}):`, e);
    logAction('error', `Turn ${game.turn} processing failed in: ${_turnSection}`, {
      section: _turnSection, turn: game.turn,
      error: String(e),
      stack: e?.stack?.split?.('\n')?.slice(0, 4)?.join(' | '),
    });
    // Silently report to feedback endpoint for triage
    reportTurnError(_turnSection, game.turn, e);
  }

  // ALWAYS advance the turn — even if processing above errored.
  // Before this fix, any exception in the ~700 lines above would silently
  // prevent game.turn++ while AI actions still executed, giving AI factions
  // extra moves on every failed click (#157).
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
  game.gameOver = true;
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
    <div style="text-align:center;margin-top:12px;display:flex;gap:8px;justify-content:center">
      <button id="btn-show-leaderboard-end" class="btn btn-secondary" style="font-size:12px;padding:6px 14px">\u{1F3C6} Leaderboard</button>
      <button id="btn-continue-after-victory" class="btn btn-primary" style="font-size:12px;padding:6px 14px">\u25B6 Continue Playing</button>
    </div>
  `;
  closeAllPanels();
  document.getElementById('game-over').style.display = 'block';

  // Submit to leaderboard — skip if already submitted during post-victory play
  if (!game.postVictoryPlay) {
    const savedUsername = safeStorage.getItem('uncivilised_username');
    const playerName = savedUsername || ('Player_' + String(Math.floor(Math.random() * 9000) + 1000));
    submitToLeaderboard(playerName, victory);
  }

  document.getElementById('btn-show-leaderboard-end').addEventListener('click', () => showLeaderboard());
  document.getElementById('btn-continue-after-victory').addEventListener('click', () => continueAfterVictory());
}

// ============================================
// AI UNIT SPAWNING (same costs as player)
// ============================================

function processAIUnitSpawning() {
  for (const [fid, fc] of Object.entries(game.factionCities)) {
    const stats = game.factionStats?.[fid];
    if (!stats) continue;
    const traits = FACTION_TRAITS[fid] || {};

    const factionUnits = game.units.filter(u => u.owner === fid);
    const workerCount = factionUnits.filter(u => u.type === 'worker').length;
    const settlerCount = factionUnits.filter(u => u.type === 'settler').length;
    const militaryCount = factionUnits.filter(u => UNIT_TYPES[u.type]?.combat > 0).length;

    const spawnTile = findSpawnTile(fc.col, fc.row, fid);
    if (!spawnTile) continue;

    // Worker spawning (cost: 30, max 1 at a time)
    if (workerCount === 0 && stats.gold >= UNIT_TYPES.worker.cost) {
      stats.gold -= UNIT_TYPES.worker.cost;
      game.units.push(createUnit('worker', spawnTile.col, spawnTile.row, fid));
      continue;
    }

    // Settler spawning (cost: 60, pop >= threshold, -500 pop, max 1 expansion city)
    const expansionCities = game.aiFactionCities[fid] || [];
    const settlerThreshold = traits.settlerThreshold || 2000;
    if (settlerCount === 0 && expansionCities.length < 1 &&
        stats.population >= settlerThreshold &&
        stats.gold >= UNIT_TYPES.settler.cost) {
      stats.gold -= UNIT_TYPES.settler.cost;
      stats.population -= 500;
      fc.population = Math.max(500, (fc.population || 1000) - 500);
      game.units.push(createUnit('settler', spawnTile.col, spawnTile.row, fid));
      continue;
    }

    // Military unit spawning (same gold-buy cost as player: 2x unit cost)
    // AI can have max ~4 military units (similar to player early-game capacity)
    if (militaryCount < 4 && stats.gold >= 40) {
      let unitType = 'warrior';
      const cost = UNIT_TYPES[unitType].cost;
      // Same 2x gold-buy cost as the player auto-buy system
      if (stats.gold >= cost * 2) {
        stats.gold -= cost * 2;
        const milSpawn = findSpawnTile(fc.col, fc.row, fid);
        if (milSpawn) {
          game.units.push(createUnit(unitType, milSpawn.col, milSpawn.row, fid));
        }
      }
    }
  }
}

function findSpawnTile(col, row, factionId) {
  const neighbors = getHexNeighbors(col, row);
  for (const nb of neighbors) {
    const tile = game.map[nb.row]?.[nb.col];
    if (!tile) continue;
    if (!isTilePassable(tile)) continue;
    if (getUnitAt(nb.col, nb.row)) continue;
    return nb;
  }
  return null;
}

// ============================================
// AI WORKER AUTO-IMPROVEMENTS & SETTLER AUTO-FOUND
// ============================================

function processAIWorkerImprovements() {
  // AI workers auto-improve
  const aiWorkers = game.units.filter(u => u.type === 'worker' && u.owner !== 'player');
  for (const worker of aiWorkers) {
    if (worker.sleeping) continue;
    if (worker.buildCharges !== undefined && worker.buildCharges <= 0) continue;

    const fid = worker.owner;
    const traits = FACTION_TRAITS[fid] || {};
    const priority = traits.improvePriority || ['farm', 'mine', 'road'];

    if (tryAIImprove(worker, priority)) continue;
    moveAIWorkerTowardWork(worker, fid, priority);
  }

  // AI settlers auto-found
  const aiSettlers = game.units.filter(u => u.type === 'settler' && u.owner !== 'player');
  for (const settler of aiSettlers) {
    const fid = settler.owner;
    if (canAIFoundCityAt(settler.col, settler.row, fid)) {
      foundAICity(settler, fid);
    } else {
      moveAISettlerTowardSite(settler, fid);
    }
  }
}

function tryAIImprove(worker, priority) {
  const tile = game.map[worker.row]?.[worker.col];
  if (!tile || tile.improvement || tile.road || tile.improvementBuilder) return false;
  const isCity = game.cities.some(c => c.col === worker.col && c.row === worker.row) ||
    Object.values(game.factionCities).some(fc => fc.col === worker.col && fc.row === worker.row);
  if (isCity) return false;
  // Can only improve within own territory
  const owner = getTileOwner(worker.col, worker.row);
  if (owner !== worker.owner) return false;

  for (const impId of priority) {
    const imp = TILE_IMPROVEMENTS[impId];
    if (!imp) continue;
    if (impId !== 'road' && tile.improvement === impId) continue;
    if (impId === 'road' && tile.road) continue;
    if (imp.validOn && !imp.validOn.includes(tile.base) && !(imp.validOn.includes('hills') && tile.feature === 'hills')) continue;
    if (imp.validFeature && !imp.validFeature.includes(tile.feature)) continue;
    if (imp.requiresRiver && !tile.hasRiver) continue;
    if (imp.requiresResource && (!tile.resource || !imp.requiresResource.includes(tile.resource))) continue;
    if ((tile.base === 'ocean' || tile.base === 'coast' || tile.base === 'lake') && impId !== 'fishing_boats') continue;
    if (tile.feature === 'mountain') continue;
    if (imp.terraform) continue;

    startImprovement(worker.id, impId);
    return true;
  }
  return false;
}

function moveAIWorkerTowardWork(worker, fid, priority) {
  if (worker.moveLeft <= 0) return;
  const cities = [];
  if (game.factionCities[fid]) cities.push(game.factionCities[fid]);
  if (game.aiFactionCities[fid]) cities.push(...game.aiFactionCities[fid]);

  let bestTile = null, bestDist = Infinity;
  for (const city of cities) {
    const radius = city.borderRadius || 2;
    for (const nb of getHexNeighbors(city.col, city.row)) {
      const t = game.map[nb.row]?.[nb.col];
      if (!t || t.improvement || t.road || t.improvementBuilder) continue;
      if (!isTilePassable(t)) continue;
      if (t.feature === 'mountain') continue;
      if (cities.some(c => c.col === nb.col && c.row === nb.row)) continue;
      if (hexDistance(nb.col, nb.row, city.col, city.row) > radius) continue;
      const dist = hexDistance(worker.col, worker.row, nb.col, nb.row);
      if (dist < bestDist) { bestDist = dist; bestTile = nb; }
    }
  }

  if (bestTile && bestDist > 0) {
    const neighbors = getHexNeighbors(worker.col, worker.row);
    let closest = null, closestDist = bestDist;
    for (const nb of neighbors) {
      const t = game.map[nb.row]?.[nb.col];
      if (!t || !isTilePassable(t)) continue;
      if (getUnitAt(nb.col, nb.row)) continue;
      if (isTerritoryBlocked(worker, nb.col, nb.row)) continue;
      const d = hexDistance(nb.col, nb.row, bestTile.col, bestTile.row);
      if (d < closestDist) { closestDist = d; closest = nb; }
    }
    if (closest) { worker.col = closest.col; worker.row = closest.row; worker.moveLeft--; }
  }
}

function canAIFoundCityAt(col, row, fid) {
  const tile = game.map[row]?.[col];
  if (!tile) return false;
  if (tile.base === 'ocean' || tile.base === 'coast' || tile.base === 'lake') return false;
  if (tile.feature === 'mountain') return false;
  // Cannot found city in another faction's or the player's territory
  const owner = getTileOwner(col, row);
  if (owner && owner !== fid) return false;
  for (const city of game.cities) {
    if (hexDistance(col, row, city.col, city.row) < 4) return false;
  }
  for (const fc of Object.values(game.factionCities)) {
    if (hexDistance(col, row, fc.col, fc.row) < 4) return false;
  }
  for (const cities of Object.values(game.aiFactionCities || {})) {
    for (const ec of cities) {
      if (hexDistance(col, row, ec.col, ec.row) < 4) return false;
    }
  }
  return true;
}

function foundAICity(settler, fid) {
  const faction = FACTIONS[fid];
  const factionName = faction ? faction.name : 'Unknown';
  const cityNames = ['Outpost', 'Forward Camp', 'Frontier', 'Haven', 'Garrison', 'Reach'];
  const existing = (game.aiFactionCities[fid] || []).map(c => c.name);
  const available = cityNames.filter(n => !existing.includes(factionName + ' ' + n));
  const cityName = available.length > 0
    ? factionName + ' ' + available[Math.floor(Math.random() * available.length)]
    : factionName + ' Colony';

  if (!game.aiFactionCities[fid]) game.aiFactionCities[fid] = [];
  game.aiFactionCities[fid].push({
    name: cityName, col: settler.col, row: settler.row,
    color: faction?.color || '#888', hp: 100, population: 500,
    borderRadius: 1, improvements: 0, wallHP: 0, wallMaxHP: 0, wallLastAttackedTurn: -99,
  });

  game.units = game.units.filter(u => u.id !== settler.id);
  if (game.metFactions?.[fid]) {
    addEvent(`${factionName} founded ${cityName}!`, 'world');
  }
}

function moveAISettlerTowardSite(settler, fid) {
  if (settler.moveLeft <= 0) return;
  const capital = game.factionCities[fid];
  if (!capital) return;

  let bestSite = null, bestScore = -Infinity;
  for (let attempt = 0; attempt < 50; attempt++) {
    const c = Math.max(0, Math.min(MAP_COLS - 1, capital.col + Math.floor(Math.random() * 16) - 8));
    const r = Math.max(0, Math.min(MAP_ROWS - 1, capital.row + Math.floor(Math.random() * 12) - 6));
    if (!canAIFoundCityAt(c, r, fid)) continue;
    const dist = hexDistance(c, r, capital.col, capital.row);
    if (dist < 5 || dist > 12) continue;
    let landNbs = 0;
    for (const nb of getHexNeighbors(c, r)) {
      const t = game.map[nb.row]?.[nb.col]?.base;
      if (t && t !== 'ocean' && t !== 'coast') landNbs++;
    }
    const score = landNbs * 5 - Math.abs(dist - 8) + Math.random() * 3;
    if (score > bestScore) { bestScore = score; bestSite = { col: c, row: r }; }
  }

  if (bestSite) settler._targetSite = bestSite;
  const target = settler._targetSite;
  if (!target) return;

  const neighbors = getHexNeighbors(settler.col, settler.row);
  let closest = null, closestDist = hexDistance(settler.col, settler.row, target.col, target.row);
  for (const nb of neighbors) {
    const t = game.map[nb.row]?.[nb.col];
    if (!t || !isTilePassable(t)) continue;
    if (getUnitAt(nb.col, nb.row)) continue;
    if (isTerritoryBlocked(settler, nb.col, nb.row)) continue;
    const d = hexDistance(nb.col, nb.row, target.col, target.row);
    if (d < closestDist) { closestDist = d; closest = nb; }
  }
  if (closest) { settler.col = closest.col; settler.row = closest.row; settler.moveLeft--; }
}

// ============================================
// EJECT TRESPASSING UNITS
// ============================================

/**
 * Eject all units that are trespassing in foreign territory they no longer
 * have permission to be in (e.g. open borders expired, peace signed).
 * Called with a specific factionId when a bilateral agreement changes,
 * or with no argument to do a full sweep.
 */
function ejectTrespassingUnits(factionId) {
  const unitsToEject = [];

  for (const unit of game.units) {
    // Only check units involved with this faction, or all if no factionId given
    if (factionId) {
      // When open borders with factionId expire:
      // - eject AI faction's units from player territory
      // - eject player's units from AI faction's territory
      if (unit.owner !== factionId && unit.owner !== 'player') continue;
    }
    if (isTerritoryBlocked(unit, unit.col, unit.row)) {
      unitsToEject.push(unit);
    }
  }

  for (const unit of unitsToEject) {
    const target = findNearestValidTile(unit);
    if (target) {
      unit.col = target.col;
      unit.row = target.row;
      unit.moveLeft = 0;
      const unitName = UNIT_TYPES[unit.type]?.name || unit.type;
      if (unit.owner === 'player') {
        addEvent(`${unitName} ejected from foreign territory`, 'diplomacy');
      }
    }
  }
}

/**
 * Find the nearest passable tile that the unit is allowed to be on.
 * Searches outward in rings from the unit's current position.
 */
function findNearestValidTile(unit) {
  const visited = new Set();
  const queue = [{ col: unit.col, row: unit.row }];
  visited.add(`${unit.col},${unit.row}`);

  while (queue.length > 0) {
    const cur = queue.shift();
    const nbs = getHexNeighbors(cur.col, cur.row);
    for (const nb of nbs) {
      const key = `${nb.col},${nb.row}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const tile = game.map[nb.row]?.[nb.col];
      if (!tile || !isTilePassable(tile)) continue;
      // Check if this tile is valid for the unit (not blocked by territory)
      if (!isTerritoryBlocked(unit, nb.col, nb.row)) {
        // Also make sure no enemy military unit is here
        const occupant = game.units.find(u =>
          u.col === nb.col && u.row === nb.row && u.id !== unit.id && u.owner !== unit.owner
        );
        if (!occupant) return nb;
      }
      queue.push(nb);
    }
  }
  return null;
}

export { endTurn, showTurnSummary, showGameOver, continueAfterVictory, processAIUnitSpawning, processAIWorkerImprovements, calculateCityAmenities, getAmenityStatus, getAmenityMod, areCitiesRoadConnected, ejectTrespassingUnits };
