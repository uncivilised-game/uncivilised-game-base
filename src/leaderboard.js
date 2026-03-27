// ============================================
// LEADERBOARD, COMPETITION & USERNAME SYSTEM
// ============================================

import { GAME_VERSION, MAX_TURNS, FACTIONS, TECHNOLOGIES, CIVICS, PANTHEONS, GOVERNMENTS } from './constants.js';
import { updateRankingsHUD } from './rankings.js';
import { game, safeStorage, API, SB_HEADERS, currentCompetition, setCurrentCompetition, activeGameRecord, setActiveGameRecord } from './state.js';
import { toggleCivicsPanel, toggleVictoryPanel } from './ui-panels.js';

function sbFetch(path, opts) {
  // Proxy all DB calls through our API to avoid exposing credentials client-side
  return fetch(API + '/api/db/' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
}

// Fetch the current active competition
async function fetchCurrentCompetition() {
  try {
    const now = new Date().toISOString();
    const res = await sbFetch('competitions?status=eq.active&starts_at=lte.' + now + '&ends_at=gte.' + now + '&order=starts_at.desc&limit=1');
    const data = await res.json();
    if (data.length > 0) { setCurrentCompetition(data[0]); return data[0]; }
    // If no active competition for right now, get the next upcoming one
    const upcoming = await sbFetch('competitions?status=eq.active&order=starts_at.asc&limit=1');
    const upData = await upcoming.json();
    if (upData.length > 0) { setCurrentCompetition(upData[0]); return upData[0]; }
  } catch (e) {}
  return null;
}

// Check if a player can start/continue a game in the current competition
async function checkSessionLimit(playerName) {
  if (!currentCompetition || !playerName) return { allowed: true, sessionsUsed: 0, reason: null };
  try {
    const res = await sbFetch('active_games?player_name=eq.' + encodeURIComponent(playerName) + '&competition_id=eq.' + currentCompetition.id + '&finished=eq.false&order=started_at.desc&limit=1');
    const rows = await res.json();
    if (rows.length === 0) return { allowed: true, sessionsUsed: 0, reason: null, existing: null };
    const ag = rows[0];
    if (ag.sessions_used >= ag.max_sessions) {
      return { allowed: false, sessionsUsed: ag.sessions_used, reason: 'You have used all ' + ag.max_sessions + ' sessions for this week\'s competition. Your game has been submitted.', existing: ag };
    }
    return { allowed: true, sessionsUsed: ag.sessions_used, existing: ag };
  } catch (e) { return { allowed: true, sessionsUsed: 0, reason: null }; }
}

// Register a new active game for competition tracking
async function registerActiveGame(playerName) {
  if (!currentCompetition || !playerName) return;
  try {
    const res = await sbFetch('active_games', {
      method: 'POST',
      body: JSON.stringify({
        player_name: playerName.substring(0, 20),
        competition_id: currentCompetition.id,
        game_id: game.gameId || Date.now(),
        sessions_used: 1,
        max_sessions: 3,
        turn: 1,
        score: 0,
      }),
    });
    const data = await res.json();
    if (data.length > 0) setActiveGameRecord(data[0]);
  } catch (e) {}
}

// Increment session count when resuming
async function incrementSession(existingRecord) {
  if (!existingRecord) return;
  try {
    await sbFetch('active_games?id=eq.' + existingRecord.id, {
      method: 'PATCH',
      body: JSON.stringify({
        sessions_used: (existingRecord.sessions_used || 0) + 1,
        last_session_at: new Date().toISOString(),
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    setActiveGameRecord({ ...existingRecord, sessions_used: (existingRecord.sessions_used || 0) + 1 });
  } catch (e) {}
}

// Update active game progress (called on auto-save)
async function updateActiveGameProgress() {
  if (!activeGameRecord || !game) return;
  try {
    await sbFetch('active_games?id=eq.' + activeGameRecord.id, {
      method: 'PATCH',
      body: JSON.stringify({ turn: game.turn, score: game.score }),
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {}
}

// Finish the active game (called on game over)
async function finishActiveGame() {
  if (!activeGameRecord) return;
  try {
    await sbFetch('active_games?id=eq.' + activeGameRecord.id, {
      method: 'PATCH',
      body: JSON.stringify({ finished: true, turn: game.turn, score: game.score }),
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {}
}

function submitToLeaderboard(playerName, victory) {
  const payload = {
    player_name: playerName.substring(0, 20),
    score: game.score,
    turns_played: game.turn - 1,
    victory_type: victory ? victory.type : 'none',
    factions_eliminated: game.factionsEliminated || 0,
    cities_count: game.cities.length,
    game_version: GAME_VERSION,
    competition_id: currentCompetition ? currentCompetition.id : null,
  };
  // Route through /api/leaderboard so the server can validate the score
  fetch(API + '/api/leaderboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
  finishActiveGame();
}

function showLeaderboard(tab) {
  let panel = document.getElementById('leaderboard-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'leaderboard-panel';
    panel.className = 'panel overlay-panel';
    panel.style.cssText = 'display:none;position:fixed;top:60px;left:20px;width:min(500px,90vw);max-height:calc(100vh - 140px);overflow-y:auto;background:var(--color-panel-bg,#1a1a2e);border:2px solid #c9a84c;border-radius:10px;padding:20px;z-index:500;color:#e0e0e0;font-size:13px';
    document.body.appendChild(panel);
  }
  panel.style.display = 'block';
  // Default to weekly if competition is currently running, otherwise all-time
  const now = new Date();
  const compActive = currentCompetition && new Date(currentCompetition.starts_at) <= now && new Date(currentCompetition.ends_at) >= now;
  const activeTab = tab || (compActive ? 'weekly' : 'alltime');
  const compName = currentCompetition ? currentCompetition.name : 'This Week';

  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
    '<h3 style="margin:0;color:#ffd700;font-size:16px">\u{1F3C6} Leaderboard</h3>' +
    '<button class="panel-close" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer" onclick="document.getElementById(\'leaderboard-panel\').style.display=\'none\'">\u2715</button></div>' +
    '<div id="lb-tabs" style="display:flex;gap:0;margin-bottom:12px;border-bottom:1px solid #333">' +
      '<button id="lb-tab-weekly" style="flex:1;padding:8px;border:none;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s;' + (activeTab === 'weekly' ? 'background:#c9a84c;color:#1a1400;' : 'background:transparent;color:#888;') + 'border-radius:4px 4px 0 0" onclick="showLeaderboard(\'weekly\')">' + compName + '</button>' +
      '<button id="lb-tab-alltime" style="flex:1;padding:8px;border:none;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s;' + (activeTab === 'alltime' ? 'background:#c9a84c;color:#1a1400;' : 'background:transparent;color:#888;') + 'border-radius:4px 4px 0 0" onclick="showLeaderboard(\'alltime\')">All Time</button>' +
    '</div>' +
    (activeTab === 'weekly' && currentCompetition ? '<p style="color:#888;font-size:11px;margin:0 0 8px;text-align:center">' + new Date(currentCompetition.starts_at).toLocaleDateString() + ' \u2014 ' + new Date(currentCompetition.ends_at).toLocaleDateString() + ' \u00b7 3 sessions per game</p>' : '') +
    '<div id="leaderboard-body" style="font-size:12px"><p style="color:#888">Loading...</p></div>';

  const body = document.getElementById('leaderboard-body');
  let query = 'leaderboard?select=*&order=score.desc&limit=50';
  if (activeTab === 'weekly' && currentCompetition) {
    query += '&competition_id=eq.' + currentCompetition.id;
  }

  sbFetch(query)
    .then(r => r.json())
    .then(entries => {
      if (!entries || entries.length === 0) {
        body.innerHTML = '<p style="color:#888;text-align:center">' + (activeTab === 'weekly' ? 'No entries this week yet. Be the first!' : 'No entries yet. Play a game!') + '</p>';
        return;
      }
      let html = '<table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:1px solid #444;color:#c9a84c">' +
        '<th style="padding:4px;text-align:left">#</th><th style="padding:4px;text-align:left">Player</th><th style="padding:4px;text-align:right">Score</th>' +
        '<th style="padding:4px;text-align:left">Victory</th><th style="padding:4px;text-align:right">Turns</th><th style="padding:4px;text-align:right">Date</th></tr></thead><tbody>';
      entries.forEach((e, i) => {
        const date = e.created_at ? new Date(e.created_at).toLocaleDateString() : '-';
        const medal = i === 0 ? '\u{1F947}' : i === 1 ? '\u{1F948}' : i === 2 ? '\u{1F949}' : '';
        const rowColor = i < 3 ? '#ffd700' : '#ccc';
        html += '<tr style="border-bottom:1px solid #2a2a3e"><td style="padding:3px;color:' + rowColor + '">' + medal + (i+1) + '</td><td style="padding:3px">' + e.player_name + '</td>' +
          '<td style="padding:3px;text-align:right;color:#ffd700">' + e.score + '</td><td style="padding:3px">' + (e.victory_type || '-') + '</td>' +
          '<td style="padding:3px;text-align:right">' + e.turns_played + '</td><td style="padding:3px;text-align:right;color:#888;font-size:11px">' + date + '</td></tr>';
      });
      html += '</tbody></table>';
      body.innerHTML = html;
    })
    .catch(() => { body.innerHTML = '<p style="color:#888;text-align:center">Could not load leaderboard.</p>'; });
}

// ============================================
// USERNAME SYSTEM (Supabase-backed)
// ============================================
function initUsernameUI() {
  const saved = safeStorage.getItem('uncivilised_username');
  const displayEl = document.getElementById('username-display');
  const btnEl = document.getElementById('btn-set-username');
  if (saved && displayEl && btnEl) {
    displayEl.textContent = '\u{2694} ' + saved;
    displayEl.style.display = 'inline';
    btnEl.textContent = 'Change';
  }
}

function showUsernamePrompt() {
  let modal = document.getElementById('username-modal');
  if (modal) { modal.style.display = 'flex'; return; }
  modal = document.createElement('div');
  modal.id = 'username-modal';
  modal.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;align-items:center;justify-content:center';
  const card = document.createElement('div');
  card.style.cssText = 'background:#1a1a2e;border:2px solid #c9a84c;border-radius:10px;padding:24px 32px;width:380px;max-width:90vw;color:#e0e0e0';
  const current = safeStorage.getItem('uncivilised_username') || '';
  card.innerHTML = `
    <h3 style="margin:0 0 4px;color:#ffd700;font-family:'Cormorant Garamond',serif;font-size:18px">Claim Your Name</h3>
    <p style="color:#888;font-size:12px;margin:0 0 14px">Your name appears on the global leaderboard. Letters, numbers, _ and - only. You can play without one.</p>
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <input id="username-input" type="text" value="${current}" placeholder="Enter username..." maxlength="20"
        style="flex:1;background:#0d0d1a;border:1px solid #333;color:#e0e0e0;padding:8px 12px;border-radius:4px;font-size:14px;outline:none">
      <button id="username-check-btn" style="background:#c9a84c;color:#1a1400;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600">Claim</button>
    </div>
    <div id="username-email-row" style="display:flex;gap:8px;margin-bottom:10px">
      <input id="username-email" type="email" placeholder="Email (optional \u2014 for recovery)"
        style="flex:1;background:#0d0d1a;border:1px solid #333;color:#e0e0e0;padding:6px 10px;border-radius:4px;font-size:12px;outline:none">
    </div>
    <div id="username-feedback" style="font-size:12px;min-height:18px;margin-bottom:10px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="username-skip-btn" style="background:none;border:1px solid #444;color:#888;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:12px">Play Without</button>
    </div>
  `;
  modal.appendChild(card);
  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  document.getElementById('username-skip-btn').addEventListener('click', () => { modal.style.display = 'none'; });

  document.getElementById('username-check-btn').addEventListener('click', async () => {
    const input = document.getElementById('username-input');
    const email = document.getElementById('username-email');
    const feedback = document.getElementById('username-feedback');
    const name = input.value.trim();
    if (!name || name.length < 2) { feedback.innerHTML = '<span style="color:#d9534f">Username must be at least 2 characters</span>'; return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) { feedback.innerHTML = '<span style="color:#d9534f">Letters, numbers, _ and - only</span>'; return; }
    feedback.innerHTML = '<span style="color:#888">Checking...</span>';
    try {
      const accessToken = safeStorage.getItem('uncivilised_access_token') || '';
      const res = await fetch(API + '/api/claim-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-access-token': accessToken },
        body: JSON.stringify({ username: name, email: email.value.trim() || null }),
      });
      const data = await res.json();
      if (data.success) {
        safeStorage.setItem('uncivilised_username', data.username);
        feedback.innerHTML = data.returning
          ? '<span style="color:#f0ad4e">Welcome back, ' + data.username + '!</span>'
          : '<span style="color:#5cb85c">\u2713 Username claimed: <strong>' + data.username + '</strong></span>';
        initUsernameUI();
        setTimeout(() => { modal.style.display = 'none'; }, 1200);
      } else {
        feedback.innerHTML = '<span style="color:#d9534f">' + (data.error || 'Could not claim username') + '</span>';
      }
    } catch (err) {
      // API unavailable — save locally
      safeStorage.setItem('uncivilised_username', name);
      feedback.innerHTML = '<span style="color:#5cb85c">\u2713 Username saved locally: <strong>' + name + '</strong></span>';
      initUsernameUI();
      setTimeout(() => { modal.style.display = 'none'; }, 1200);
    }
  });

  document.getElementById('username-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('username-check-btn').click();
  });
}

setTimeout(initUsernameUI, 100);

// ============================================
// UI UPDATES
// ============================================
function updateUI() {
  document.getElementById('stat-turn').innerHTML = `Turn <strong>${game.turn}</strong>/${MAX_TURNS}`;
  document.getElementById('stat-gold').querySelector('strong').textContent = game.gold;
  // BUG-03: Show research progress alongside science rate
  {
    const sciEl = document.getElementById('stat-science');
    if (sciEl) {
      let sciText = game.sciencePerTurn + ' /turn';
      if (game.currentResearch) {
        const tdata = TECHNOLOGIES.find(t => t.id === game.currentResearch);
        if (tdata) {
          const pct = Math.min(100, Math.floor(game.researchProgress / tdata.cost * 100));
          sciText += ' | ' + tdata.name + ' ' + pct + '%';
        }
      }
      sciEl.querySelector('strong').textContent = sciText;
    }
  }
  // BUG-04: Add food stat to top bar
  {
    let foodEl = document.getElementById('stat-food');
    if (!foodEl) {
      const statsBar = document.getElementById('stat-turn')?.parentElement;
      if (statsBar) {
        foodEl = document.createElement('span');
        foodEl.id = 'stat-food';
        foodEl.className = 'stat';
        foodEl.style.cssText = 'color:#6aab5c;margin-left:12px;font-size:12px';
        foodEl.innerHTML = '\u{1F33E} <strong></strong>';
        // Insert before the military stat
        const milEl = document.getElementById('stat-military');
        if (milEl) statsBar.insertBefore(foodEl, milEl);
        else statsBar.appendChild(foodEl);
      }
    }
    if (foodEl) {
      foodEl.querySelector('strong').textContent = game.foodPerTurn + ' food/turn';
    }
  }
  document.getElementById('stat-military').querySelector('strong').textContent = game.military;
  const unitsEl = document.getElementById('stat-units');
  if (unitsEl) unitsEl.querySelector('strong').textContent = game.units.filter(u => u.owner === 'player').length;
  // Show culture/turn and current civic in top bar
  let cultureEl = document.getElementById('stat-culture-turn');
  if (!cultureEl) {
    const statsBar = document.getElementById('stat-turn')?.parentElement;
    if (statsBar) {
      cultureEl = document.createElement('span');
      cultureEl.id = 'stat-culture-turn';
      cultureEl.className = 'stat';
      cultureEl.style.cssText = 'color:#e8a0ff;margin-left:12px;font-size:12px;cursor:pointer';
      cultureEl.title = 'Click to open Civics panel (C)';
      cultureEl.addEventListener('click', () => toggleCivicsPanel());
      statsBar.appendChild(cultureEl);
    }
  }
  if (cultureEl) {
    const cpt = game.culturePerTurn || 1;
    let civicStr = '';
    if (game.currentCivic) {
      const cd = CIVICS.find(c => c.id === game.currentCivic);
      if (cd) {
        const pct = Math.floor((game.civicProgress / cd.cost) * 100);
        civicStr = ' | ' + cd.name + ' ' + pct + '%';
      }
    }
    cultureEl.innerHTML = '\u{1F3A8} <strong>' + cpt + '</strong>/t' + civicStr;
  }
  // Show pantheon icon if selected
  let panthEl = document.getElementById('stat-pantheon');
  if (!panthEl && game.pantheon) {
    const statsBar = document.getElementById('stat-turn')?.parentElement;
    if (statsBar) {
      panthEl = document.createElement('span');
      panthEl.id = 'stat-pantheon';
      panthEl.className = 'stat';
      panthEl.style.cssText = 'color:#60a0ff;margin-left:8px;font-size:12px';
      statsBar.appendChild(panthEl);
    }
  }
  if (panthEl && game.pantheon) {
    const pd = PANTHEONS.find(p => p.id === game.pantheon);
    panthEl.textContent = pd ? pd.icon + ' ' + pd.name : '';
  }

  // Show happiness in top bar
  let hapEl = document.getElementById('stat-happiness');
  if (!hapEl) {
    const statsBar = document.getElementById('stat-turn')?.parentElement;
    if (statsBar) {
      hapEl = document.createElement('span');
      hapEl.id = 'stat-happiness';
      hapEl.className = 'stat';
      hapEl.style.cssText = 'margin-left:8px;font-size:12px;cursor:pointer';
      hapEl.title = 'Happiness — click for Victory panel (V)';
      hapEl.addEventListener('click', () => toggleVictoryPanel());
      statsBar.appendChild(hapEl);
    }
  }
  if (hapEl) {
    // Show worst amenity status across cities as the top-bar indicator
    const statuses = (game.cities || []).map(c => c.amenityStatus || 'CONTENT');
    const order = ['REVOLT_RISK', 'UNHAPPY', 'DISPLEASED', 'CONTENT', 'HAPPY', 'ECSTATIC'];
    let worst = 'CONTENT';
    for (const s of statuses) { if (order.indexOf(s) < order.indexOf(worst)) worst = s; }
    const emojiMap = { ECSTATIC: '\u{1F929}', HAPPY: '\u{1F600}', CONTENT: '\u{1F610}', DISPLEASED: '\u{1F61F}', UNHAPPY: '\u{1F621}', REVOLT_RISK: '\u{1F525}' };
    const colorMap = { ECSTATIC: '#40e040', HAPPY: '#60c060', CONTENT: '#c0c060', DISPLEASED: '#c0a040', UNHAPPY: '#c06040', REVOLT_RISK: '#e02020' };
    hapEl.textContent = (emojiMap[worst] || '\u{1F610}') + ' ' + worst;
    hapEl.style.color = colorMap[worst] || '#c0c060';
    hapEl.title = 'City Amenities — click for Victory panel (V)';
  }
  // Show trade routes in top bar
  let tradeEl = document.getElementById('stat-trade');
  if (!tradeEl && (game.tradeRoutes || []).length > 0) {
    const statsBar = document.getElementById('stat-turn')?.parentElement;
    if (statsBar) {
      tradeEl = document.createElement('span');
      tradeEl.id = 'stat-trade';
      tradeEl.className = 'stat';
      tradeEl.style.cssText = 'color:#c9a84c;margin-left:8px;font-size:12px';
      statsBar.appendChild(tradeEl);
    }
  }
  if (tradeEl) {
    tradeEl.textContent = '\u{1F6A2} ' + (game.tradeRoutes || []).length + '/' + (game.maxTradeRoutes || 1);
  }

  // Show government in top bar
  let govEl = document.getElementById('stat-government');
  if (!govEl) {
    const statsBar = document.getElementById('stat-turn')?.parentElement;
    if (statsBar) {
      govEl = document.createElement('span');
      govEl.id = 'stat-government';
      govEl.className = 'stat';
      govEl.style.cssText = 'color:#d4a0ff;margin-left:12px;font-size:12px';
      statsBar.appendChild(govEl);
    }
  }
  if (govEl && game.government) {
    const gov = GOVERNMENTS[game.government];
    govEl.textContent = (gov.icon || '\u{1F3DB}') + ' ' + gov.name;
  }

  updateEnvoyUI();
  updateRankingsHUD();
}

function updateEnvoyUI() {
  const el = document.getElementById('stat-envoys');
  if (el && game) {
    const envoys = game.envoys != null ? game.envoys : 3;
    const max = game.maxEnvoys || 3;
    el.querySelector('strong').textContent = `${envoys}/${max}`;
    // Visual warning when low
    el.style.opacity = envoys === 0 ? '0.5' : '1';
  }
}

export {
  sbFetch,
  fetchCurrentCompetition,
  checkSessionLimit,
  registerActiveGame,
  incrementSession,
  updateActiveGameProgress,
  finishActiveGame,
  submitToLeaderboard,
  showLeaderboard,
  initUsernameUI,
  showUsernamePrompt,
  updateUI,
  updateEnvoyUI
};
