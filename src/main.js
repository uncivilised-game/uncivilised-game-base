/*
 * UNCIVILIZED — The Ancient Era
 * Main entry point — wires all modules together
 */

// --- Side-effect imports (run on load) ---
import './state.js';       // initializes safeStorage, visitor ID, canvas refs
import './assets.js';      // preloads terrain tiles, portraits, improvement images
import './_diplomacy-plugin.gen.js'; // auto-generated: loads diplomacy plugin if available

// --- Module imports ---
import { SAVE_KEY, GAME_VERSION } from './constants.js';
import {
  game, setGame, setNextUnitId, safeStorage, API, initCanvasRefs,
  currentCompetition, activeGameRecord, CITY_WALL_DEFAULTS
} from './state.js';
import { setRenderCallback } from './assets.js';
import { render, resizeCanvas, centerCameraOnCity, computeVisibility } from './render.js';
import { initInputHandlers, clampCamera, zoomAtCenter, panCameraTo } from './input.js';
import { createUnit, selectUnit, deselectUnit, selectNextUnit, autoSelectNext, handleHexClick, applyPromotion, computeMoveRange, computeAttackRange, moveUnitTo, placeFactionCities } from './units.js';
import { resolveCombat, getUnitAt, getPlayerUnitAt, getEnemyUnitAt, getCityAt, showBattlePanel, attackFactionCity, attackExpansionCity } from './combat.js';
import { endTurn, showTurnSummary, showGameOver } from './turn.js';
import { togglePanel, closeAllPanels, renderBuildPanel, startBuild, cancelProduction, startWonderBuild, renderResearchPanel, startResearch, setTechGoal, clearTechGoal, renderUnitsPanel, recruitUnit, renderCivicsPanel, toggleCivicsPanel, renderVictoryPanel, toggleVictoryPanel, checkVictoryConditions, showSelectionPanel, hideSelectionPanel, showCityPanel, showTileInfo, showCombatResult, showDeleteConfirm, ensureVictoryPanel, ensureCivicsPanel, computeCityYields, showGiftUnitPanel, giftUnit } from './ui-panels.js';
import { renderDiplomacyPanel, renderDiplomacyList, openChat, sendChatMessage, getRelationLabel, establishTradeRoute, cancelTradeRoute, processCharacterAction, isDiplomacyLoaded } from './diplomacy-api.js';
import { applyGameMod, showModBanner, getModCombatBonus, getModYieldBonus } from './diplomacy-api.js';
import { processAITurns, processBarbarianTurns, processAICommitments, moveAIUnitToward } from './diplomacy-api.js';
import { getAvailableImprovements, startImprovement, cancelImprovement, processImprovements, getImprovementYields, showWorkerActions, showSettlerActions, canFoundCityAt, processUnitWaypoint, moveTowardWaypoint, getWaypointPath } from './improvements.js';
import { addEvent, logAction, showToast, showCompletionNotification, generateFactionIntelReports, generateRumours, showIntelNotification, countPlayerTerritory, getGameLogSummary } from './events.js';
import { showGreatPersonNotification, useGreatPerson, showPantheonPicker } from './buildings.js';
import { updateUI, updateEnvoyUI, showLeaderboard, showUsernamePrompt, initUsernameUI, submitToLeaderboard, fetchCurrentCompetition, checkSessionLimit, registerActiveGame, incrementSession, sbFetch } from './leaderboard.js';
import { migrateTiles, restoreMods, autoSave, loadGame } from './save-load.js';
import { MINOR_FACTION_TYPES, generateMinorFactions, interactWithMinorFaction } from './minor-factions.js';
import { updateRankingsHUD, toggleRankingsDropdown, renderRankingsDropdown } from './rankings.js';
import { toggleFeedbackChat, sendFeedback, startAnimLoop } from './feedback.js';
import { revealAround, discoverVisibleFactions, discoverFaction, scanForFirstContact, triggerFirstContactGreeting } from './discovery.js';
import { generateMap, getTileYields, getTileName, getTileMoveCost, isTilePassable, initFactionStats, updateFactionStats, getPlayerStats, getComparisonData, getUnmetFactions } from './map.js';
import { hexToPixel, pixelToHex, drawHex, getHexNeighbors, hexDistance, createFogOfWar } from './hex.js';
import { MAP_COLS, MAP_ROWS, BASE_TERRAIN } from './constants.js';
import { drawDetailedHex } from './terrain-render.js';

// --- Log diplomacy module status ---
if (!isDiplomacyLoaded()) {
  console.log('%c[Uncivilized] Running without diplomacy module — AI leaders will not respond', 'color: #888');
}

// --- Wire up lazy render callback for asset preloader ---
setRenderCallback(render);

// --- Initialize canvas refs (DOM must be ready) ---
initCanvasRefs();

// --- Expose globals needed by HTML onclick handlers ---
window.showLeaderboard = showLeaderboard;
window.showUsernamePrompt = showUsernamePrompt;
window.sendFeedback = sendFeedback;
window.toggleFeedbackChat = toggleFeedbackChat;
window.toggleRankingsDropdown = toggleRankingsDropdown;
window.togglePanel = togglePanel;
window.openChat = openChat;
window.startBuild = startBuild;
window.startResearch = startResearch;
window.startWonderBuild = startWonderBuild;
window.startImprovement = startImprovement;
window.cancelImprovement = cancelImprovement;
window.recruitUnit = recruitUnit;
window.setTechGoal = setTechGoal;
window.interactWithMinorFaction = interactWithMinorFaction;
window.selectUnit = selectUnit;
window.panCameraTo = panCameraTo;
window.handleHexClick = handleHexClick;
window.applyPromotion = applyPromotion;
window.cancelProduction = cancelProduction;
window.hideSelectionPanel = hideSelectionPanel;
window.establishTradeRoute = establishTradeRoute;
window.cancelTradeRoute = cancelTradeRoute;
window.clearTechGoal = clearTechGoal;
window.showWorkerActions = showWorkerActions;

// --- Expose testing/debug functions ---
window.resolveCombat = resolveCombat;
window.attackFactionCity = attackFactionCity;
window.attackExpansionCity = attackExpansionCity;
window.showBattlePanel = showBattlePanel;
window.createUnit = createUnit;
window.endTurn = endTurn;
window.processAITurns = processAITurns;
window.showGiftUnitPanel = showGiftUnitPanel;
window.giftUnit = giftUnit;

// --- createInitialState (here to avoid circular deps between map.js and units.js) ---
function createInitialState() {
  const { map, riverPaths } = generateMap();
  const continentId = Array.from({ length: MAP_ROWS }, () => new Int16Array(MAP_COLS).fill(-1));
  const continentSizes = [];
  let nextContinent = 0;
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (continentId[r][c] >= 0) continue;
      const tile = map[r][c];
      if (tile.base === 'ocean' || tile.base === 'coast' || tile.base === 'lake') continue;
      const cid = nextContinent++;
      continentId[r][c] = cid;
      let size = 1;
      const bfsQ = [{ col: c, row: r }];
      let qi = 0;
      while (qi < bfsQ.length) {
        const cur = bfsQ[qi++];
        for (const nb of getHexNeighbors(cur.col, cur.row)) {
          if (continentId[nb.row][nb.col] >= 0) continue;
          const nt = map[nb.row][nb.col];
          if (nt.base === 'ocean' || nt.base === 'coast' || nt.base === 'lake') continue;
          continentId[nb.row][nb.col] = cid;
          size++;
          bfsQ.push(nb);
        }
      }
      continentSizes.push({ id: cid, size });
    }
  }
  continentSizes.sort((a, b) => b.size - a.size);
  const mainContinent = continentSizes.length > 0 ? continentSizes[0].id : -1;

  let startCol = Math.floor(MAP_COLS / 2), startRow = Math.floor(MAP_ROWS / 2);
  let bestScore = -1;
  for (let radius = 0; radius < Math.max(MAP_COLS, MAP_ROWS) / 2; radius++) {
    for (let r = Math.max(5, Math.floor(MAP_ROWS/2) - radius); r <= Math.min(MAP_ROWS - 5, Math.floor(MAP_ROWS/2) + radius); r++) {
      for (let c = Math.max(5, Math.floor(MAP_COLS/2) - radius); c <= Math.min(MAP_COLS - 5, Math.floor(MAP_COLS/2) + radius); c++) {
        if (Math.abs(r - MAP_ROWS/2) !== radius && Math.abs(c - MAP_COLS/2) !== radius) continue;
        if (mainContinent >= 0 && continentId[r][c] !== mainContinent) continue;
        const t = map[r][c].base;
        if (t !== 'plains' && t !== 'grassland') continue;
        if (map[r][c].feature === 'mountain') continue;
        const nbs = getHexNeighbors(c, r);
        let landCount = 0;
        for (const nb of nbs) {
          const nt = map[nb.row][nb.col].base;
          if (nt !== 'ocean' && nt !== 'coast') landCount++;
        }
        if (landCount > bestScore) {
          bestScore = landCount;
          startCol = c; startRow = r;
          if (landCount >= 6) { radius = MAP_COLS; r = MAP_ROWS; break; }
        }
      }
    }
  }

  const factionCities = placeFactionCities(map, startCol, startRow, continentId, mainContinent);

  const startingUnits = [];
  const startNeighbors = getHexNeighbors(startCol, startRow);
  const landNeighbors = startNeighbors.filter(nb => {
    const tile = map[nb.row][nb.col];
    const bi = BASE_TERRAIN[tile.base];
    return bi && bi.movable && tile.feature !== 'mountain';
  });
  const pos1 = landNeighbors[0] || { col: startCol, row: startRow };
  const pos2 = landNeighbors[1] || { col: startCol, row: startRow };
  startingUnits.push(createUnit('warrior', pos1.col, pos1.row, 'player'));
  startingUnits.push(createUnit('scout', pos2.col, pos2.row, 'player'));
  startingUnits.push(createUnit('worker', startCol, startRow, 'player'));

  const factionUnits = [];
  for (const [fid, fc] of Object.entries(factionCities)) {
    const neighbors = getHexNeighbors(fc.col, fc.row);
    let placed = 0;
    for (const nb of neighbors) {
      if (placed >= 2) break;
      const tile = map[nb.row][nb.col];
      const bInfo = BASE_TERRAIN[tile.base];
      if (!bInfo.movable) continue;
      const unitType = placed === 0 ? 'warrior' : 'archer';
      factionUnits.push(createUnit(unitType, nb.col, nb.row, fid));
      placed++;
    }
  }

  return {
    turn: 1,
    gold: 50, goldPerTurn: 5,
    science: 0, sciencePerTurn: 3,
    food: 0, foodPerTurn: 4,
    production: 0, productionPerTurn: 3,
    culture: 0, military: 10, defense: 5, population: 1000,
    cities: [{ name: 'Capital', col: startCol, row: startRow, buildings: [], population: 1000, borderRadius: 2, cultureAccum: 0, ...CITY_WALL_DEFAULTS }],
    factionCities: factionCities,
    map: map,
    riverPaths: riverPaths,
    techs: ['agriculture', 'mining'],
    currentResearch: null, researchProgress: 0,
    buildings: [], currentBuild: null, buildProgress: 0,
    currentUnitBuild: null, unitBuildProgress: 0,
    units: [...startingUnits, ...factionUnits],
    barbarianCamps: [],
    continentId: continentId, mainContinent: mainContinent,
    aiFactions: {}, aiFactionCities: {},
    selectedUnitId: null,
    relationships: {
      emperor_valerian: 0, shadow_kael: -10, merchant_prince_castellan: 10,
      pirate_queen_elara: -20, commander_thane: 5, rebel_leader_sera: 0,
    },
    activeAlliances: {}, activeTrades: {}, tradeDeals: {}, marriages: {}, defensePacts: {},
    conversationHistories: {},
    envoys: 1, maxEnvoys: 1, envoySpentThisTurn: {}, messagesThisTurn: 0,
    openBorders: {}, embargoes: {}, ceasefires: {}, vassals: {}, nonAggressionPacts: {},
    metFactions: {}, factionStats: {},
    appliedMods: [], combatBonuses: [], yieldBonuses: [],
    activeEvents: [], minorFactions: [],
    recentEvents: [], gameLog: [],
    aiCommitments: [], aiWonders: {},
    fogOfWar: createFogOfWar(startCol, startRow),
    cameraX: 0, cameraY: 0, selectedHex: null,
    score: 0, gameId: Date.now(), factionsEliminated: 0,
    government: 'chiefdom', governmentCooldown: 0,
    wonders: [], currentWonderBuild: null, wonderBuildProgress: 0,
    tradeRoutes: [], maxTradeRoutes: 1, happiness: 5,
    civics: [], currentCivic: null, civicProgress: 0, culturePerTurn: 1,
    greatPeopleProgress: { science: 0, production: 0, gold: 0, military: 0, culture: 0 },
    greatPeopleEarned: [], pantheon: null, religion: null,
  };
}

// --- Register all event listeners ---
initInputHandlers();

// --- Wire up all .panel-close buttons (delegated handler) ---
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.panel-close');
  if (!btn) return;
  const panel = btn.closest('.panel');
  if (panel) panel.style.display = 'none';
});

// --- startNewGame / continueGame ---
async function startNewGame() {
  const playerName = safeStorage.getItem('uncivilised_username');
  if (!playerName) {
    showSignupModal();
    return;
  }
  // Server-side access gate
  try {
    const gateRes = await fetch(API + '/api/verify-access', {
      headers: { 'x-player-name': playerName },
    });
    const gateData = await gateRes.json();
    if (!gateData.allowed) {
      if (gateData.reason === 'waitlisted') {
        alert('You\'re on the waitlist. We\'ll email you when a spot opens.');
      } else if (gateData.reason === 'not_verified') {
        alert('Please check your email and click the verification link first.');
      } else {
        showSignupModal();
      }
      return;
    }
  } catch (_) {
    // Network error — fail open
  }
  if (playerName && currentCompetition) {
    const check = await checkSessionLimit(playerName);
    if (!check.allowed) {
      alert(check.reason || 'Session limit reached for this competition.');
      return;
    }
    if (check.existing) {
      const resume = confirm('You have an active game in "' + currentCompetition.name + '" (Session ' + check.sessionsUsed + '/3, Turn ' + (check.existing.turn || 1) + '). Starting a new game will end it. Continue?');
      if (!resume) return;
      await sbFetch('active_games?id=eq.' + check.existing.id, {
        method: 'PATCH',
        body: JSON.stringify({ finished: true }),
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {});
    }
  }

  setNextUnitId(1);
  setGame(createInitialState());
  const eventLog = document.getElementById('event-log-messages');
  if (eventLog) eventLog.innerHTML = '';
  closeAllPanels();
  document.getElementById('title-screen').classList.remove('active');
  document.getElementById('game-screen').classList.add('active');
  document.getElementById('btn-end-turn').disabled = false;
  document.getElementById('btn-end-turn').style.opacity = '1';
  resizeCanvas();
  centerCameraOnCity();
  updateUI();
  render();
  addEvent('Your civilization begins!', 'gold');
  try {
    const sessRes = await fetch(API + '/api/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-visitor-id': (safeStorage.getItem('uncivilised_visitor_id') || 'anon-' + Date.now()) },
      body: JSON.stringify({ game_mode: 'single_player' })
    });
    if (sessRes.ok) {
      const sessData = await sessRes.json();
      if (sessData.session_id) window._gameSessionId = sessData.session_id;
    }
  } catch(e) {}
  if (currentCompetition) addEvent('Competition: ' + currentCompetition.name, 'diplomacy');
  addEvent('Explore the map \u2014 beware of foreign patrols', 'diplomacy');
  addEvent('Scout and Warrior ready for orders', 'combat');
  generateMinorFactions(game.map);
  scanForFirstContact();
  setTimeout(() => selectNextUnit(), 300);
  if (!game.currentResearch) {
    game.currentResearch = 'writing';
    game.researchProgress = 0;
    addEvent('Researching: Writing', 'science');
  }
  if (playerName) await registerActiveGame(playerName);
  await autoSave();
}

async function continueGame() {
  const playerName = safeStorage.getItem('uncivilised_username');
  if (!playerName) {
    showSignupModal();
    return;
  }
  try {
    const gateRes = await fetch(API + '/api/verify-access', {
      headers: { 'x-player-name': playerName },
    });
    const gateData = await gateRes.json();
    if (!gateData.allowed) {
      alert('Access not available. Check your email or sign up.');
      return;
    }
  } catch (_) {}
  if (playerName && currentCompetition) {
    const check = await checkSessionLimit(playerName);
    if (!check.allowed) {
      alert(check.reason || 'Session limit reached for this competition.');
      return;
    }
    if (check.existing) {
      await incrementSession(check.existing);
    }
  }

  const loaded = await loadGame();
  if (loaded) {
    document.getElementById('title-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    resizeCanvas();
    updateUI();
    try {
      render();
    } catch (e) {
      console.error('Render failed on load:', e);
      alert('Save data appears corrupted. Please start a new game.');
      document.getElementById('game-screen').classList.remove('active');
      document.getElementById('title-screen').classList.add('active');
      return;
    }
    addEvent('Game loaded \u2014 welcome back', '');
    if (activeGameRecord && currentCompetition) addEvent('Session ' + activeGameRecord.sessions_used + '/3 for ' + currentCompetition.name, 'gold');
  } else {
    // Save not found — clean up stale active_games record so player isn't stuck
    if (currentCompetition) {
      const check = await checkSessionLimit(playerName);
      if (check.existing) {
        await sbFetch('active_games?id=eq.' + check.existing.id, {
          method: 'PATCH',
          body: JSON.stringify({ finished: true }),
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});
      }
    }
    alert('No saved game found. Please start a new game.');
  }
}

// Expose for input.js and HTML
window.startNewGame = startNewGame;
window.continueGame = continueGame;

// --- Expose for testing ---
window.render_game_to_text = () => {
  if (!game) return JSON.stringify({ state: 'title_screen' });
  return JSON.stringify({
    turn: game.turn,
    gold: game.gold,
    military: game.military,
    population: game.population,
    techs: game.techs.length,
    buildings: game.buildings.length,
    units: game.units.filter(u => u.owner === 'player').length,
    enemyUnits: game.units.filter(u => u.owner !== 'player').length,
    score: game.score,
    relationships: game.relationships,
    currentResearch: game.currentResearch,
    currentBuild: game.currentBuild,
    metFactions: Object.keys(game.metFactions || {}),
    logEntries: (game.gameLog || []).length,
    factionStats: Object.keys(game.factionStats || {}).length,
  });
};

window.advanceTime = (ms) => {
  const turns = Math.max(1, Math.round(ms / 1000));
  for (let i = 0; i < turns; i++) endTurn();
};

// --- Auth flow functions ---
function showSignupModal() {
  closeAuthModals();
  document.getElementById('signup-modal').style.display = 'flex';
  document.getElementById('signup-username').focus();
  // Update subtitle with remaining spots
  fetchSpotsRemaining().then(data => {
    const sub = document.getElementById('signup-subtitle');
    if (sub && data.remaining > 0) sub.textContent = data.remaining.toLocaleString() + ' spots left in the first wave';
    else if (sub) sub.textContent = 'Join the waitlist for the next wave';
  });
}

function showSigninModal() {
  closeAuthModals();
  document.getElementById('signin-modal').style.display = 'flex';
  document.getElementById('signin-username').focus();
}

function closeAuthModals() {
  ['signup-modal', 'signin-modal', 'success-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

async function fetchSpotsRemaining() {
  try {
    const res = await fetch(API + '/api/spots-remaining');
    if (res.ok) return await res.json();
  } catch (e) {}
  return { total: 1000, active: 0, remaining: 1000 };
}

async function updateSpotsCounter() {
  const data = await fetchSpotsRemaining();
  const counter = document.getElementById('spots-counter');
  const numEl = document.getElementById('spots-number');
  const barEl = document.getElementById('spots-bar-fill');
  const textEl = numEl?.parentElement;
  if (counter) counter.style.display = 'block';
  if (data.remaining <= 0) {
    // All spots taken — show waitlist count
    if (barEl) barEl.style.width = '0%';
    try {
      const wlRes = await fetch(API + '/api/waitlist/count');
      if (wlRes.ok) {
        const wlData = await wlRes.json();
        const wlCount = wlData.count || 0;
        const totalPlayers = wlData.total_players || 0;
        let html = '';
        if (totalPlayers > 0) html += '<strong>' + totalPlayers.toLocaleString() + '</strong> players joined';
        if (wlCount > 0) html += (html ? ' · ' : '') + '<strong>' + wlCount.toLocaleString() + '</strong> on the waiting list';
        if (textEl) textEl.innerHTML = html || '<strong>Join the waiting list</strong>';
      } else if (textEl) {
        textEl.innerHTML = '<strong>Join the waiting list</strong>';
      }
    } catch (e) {
      if (textEl) textEl.innerHTML = '<strong>Join the waiting list</strong>';
    }
  } else {
    if (numEl) numEl.textContent = data.remaining.toLocaleString();
    if (barEl) barEl.style.width = Math.max(2, (data.remaining / data.total) * 100) + '%';
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const btn = document.getElementById('signup-submit');
  const errEl = document.getElementById('signup-error');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Signing up...';

  const username = document.getElementById('signup-username').value.trim();
  const email = document.getElementById('signup-email').value.trim();

  try {
    const res = await fetch(API + '/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email }),
    });
    const data = await res.json();
    if (!data.success) {
      errEl.textContent = data.error || 'Signup failed';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign Up';
      return;
    }

    // Save username locally
    safeStorage.setItem('uncivilised_username', username);

    closeAuthModals();

    // Show success modal
    const content = document.getElementById('success-content');
    if (data.status === 'active') {
      content.innerHTML = '<div class="auth-success-icon">\u2694\uFE0F</div>'
        + '<h2 class="auth-success-title">You\'re In!</h2>'
        + '<p class="auth-success-msg">Check your email for a link to start playing.<br>Welcome to the first 1,000, <strong>' + username + '</strong>.</p>'
        + '<button class="btn btn-primary auth-success-btn" onclick="closeAuthModals()">Got It</button>';
    } else {
      content.innerHTML = '<div class="auth-success-icon">\u23F3</div>'
        + '<h2 class="auth-success-title">You\'re on the List</h2>'
        + '<p class="auth-success-msg">All spots are taken right now. You\'re <strong>#' + data.position + '</strong> on the waitlist.<br>We\'ll email you when a spot opens up.</p>'
        + '<button class="btn btn-primary auth-success-btn" onclick="closeAuthModals()">Got It</button>';
    }
    document.getElementById('success-modal').style.display = 'flex';
    updateSpotsCounter();
    refreshAuthUI();
  } catch (err) {
    errEl.textContent = 'Network error. Try again.';
    errEl.style.display = 'block';
  }
  btn.disabled = false;
  btn.textContent = 'Sign Up';
}

async function handleSignin(e) {
  e.preventDefault();
  const btn = document.getElementById('signin-submit');
  const errEl = document.getElementById('signin-error');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  const username = document.getElementById('signin-username').value.trim();

  try {
    const res = await fetch(API + '/api/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();
    if (!data.success) {
      errEl.textContent = data.error || 'Sign in failed';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign In';
      return;
    }

    safeStorage.setItem('uncivilised_username', data.username);
    closeAuthModals();
    refreshAuthUI();

    if (data.status === 'waitlisted') {
      showStatusMessage('You\'re still on the waitlist. We\'ll email you when a spot opens.');
    } else if (data.status === 'pending_verification') {
      showStatusMessage('Check your email and click the verification link to start playing.');
    }
  } catch (err) {
    errEl.textContent = 'Network error. Try again.';
    errEl.style.display = 'block';
  }
  btn.disabled = false;
  btn.textContent = 'Sign In';
}

function showStatusMessage(msg) {
  const el = document.getElementById('auth-status-msg');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
}

function playerSignOut() {
  safeStorage.removeItem('uncivilised_username');
  refreshAuthUI();
}

async function refreshAuthUI() {
  const username = safeStorage.getItem('uncivilised_username');
  const guestBtns = document.getElementById('auth-buttons-guest');
  const playerBtns = document.getElementById('auth-buttons-player');
  const usernameBar = document.getElementById('username-bar');
  const usernameDisplay = document.getElementById('username-display');
  const statusMsg = document.getElementById('auth-status-msg');
  if (statusMsg) statusMsg.style.display = 'none';

  if (!username) {
    // Guest state
    if (guestBtns) guestBtns.style.display = 'flex';
    if (playerBtns) playerBtns.style.display = 'none';
    if (usernameBar) usernameBar.style.display = 'none';
    return;
  }

  // Signed in — check access
  if (usernameBar) usernameBar.style.display = 'block';
  if (usernameDisplay) usernameDisplay.textContent = username;

  try {
    const res = await fetch(API + '/api/verify-access', {
      headers: { 'x-player-name': username },
    });
    const data = await res.json();
    if (data.allowed) {
      // Active + verified — show play buttons
      if (guestBtns) guestBtns.style.display = 'none';
      if (playerBtns) playerBtns.style.display = 'flex';

      // Check for saved game
      let hasSave = false;
      try {
        const raw = safeStorage.getItem(SAVE_KEY);
        if (raw) { const d = JSON.parse(raw); if (d.game_state) hasSave = true; }
      } catch (_) {}
      if (!hasSave) {
        try {
          const sr = await fetch(API + '/api/load', {
            headers: { 'x-visitor-id': safeStorage.getItem('uncivilised_visitor_id') || 'anonymous' },
          });
          const sd = await sr.json();
          if (sd.found) hasSave = true;
        } catch (_) {}
      }
      if (hasSave) {
        document.getElementById('btn-continue').style.display = 'block';
      }
    } else {
      // Not allowed — show guest buttons + reason
      if (guestBtns) guestBtns.style.display = 'flex';
      if (playerBtns) playerBtns.style.display = 'none';
      if (data.reason === 'waitlisted') {
        showStatusMessage('You\'re on the waitlist. We\'ll email you when a spot opens.');
      } else if (data.reason === 'not_verified') {
        showStatusMessage('Check your email and click the verification link to start playing.');
      }
    }
  } catch (_) {
    // Network error — fail open, show play buttons
    if (guestBtns) guestBtns.style.display = 'none';
    if (playerBtns) playerBtns.style.display = 'flex';
  }
}

async function handleTokenVerification() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) return;

  // Clean the URL
  window.history.replaceState({}, '', window.location.pathname);

  try {
    const res = await fetch(API + '/api/verify-token/' + encodeURIComponent(token));
    const data = await res.json();
    if (data.success && data.username) {
      safeStorage.setItem('uncivilised_username', data.username);
      if (data.can_play) {
        showStatusMessage('Email verified! You\'re ready to play, ' + data.username + '.');
      } else {
        showStatusMessage('Email verified! You\'re on the waitlist \u2014 we\'ll notify you when a spot opens.');
      }
    }
  } catch (_) {}
}

// Expose auth functions for HTML onclick
window.showSignupModal = showSignupModal;
window.showSigninModal = showSigninModal;
window.closeAuthModals = closeAuthModals;
window.handleSignup = handleSignup;
window.handleSignin = handleSignin;
window.playerSignOut = playerSignOut;

// --- Initialization ---
(async function init() {
  await fetchCurrentCompetition();

  // Handle email verification token in URL
  await handleTokenVerification();

  // Fetch and display spots remaining
  updateSpotsCounter();

  // Refresh auth UI based on stored credentials
  await refreshAuthUI();

  if (currentCompetition) {
    const hint = document.querySelector('.title-hint');
    if (hint) {
      const ends = new Date(currentCompetition.ends_at);
      const now = new Date();
      const daysLeft = Math.max(0, Math.ceil((ends - now) / (1000*60*60*24)));
      hint.innerHTML = '\u{1F3C6} <strong style="color:#c9a84c">' + currentCompetition.name + '</strong> \u2014 ' + daysLeft + ' days left \u00b7 3 sessions per game<br><span style="color:var(--color-text-faint)">Forge alliances. Betray empires. Rewrite history.</span>';
    }
  }
})();
