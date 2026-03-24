import { FACTIONS, FACTION_TRAITS } from './constants.js';
import { game } from './state.js';
import { getComparisonData } from './map.js';

export function updateRankingsHUD() {
  let hud = document.getElementById('rankings-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'rankings-hud';
    document.getElementById('game-main').appendChild(hud);
    // Auto-create dropdown (open by default)
    let dd = document.getElementById('rankings-dropdown');
    if (!dd) { dd = document.createElement('div'); dd.id = 'rankings-dropdown'; dd.style.display = 'block'; document.getElementById('game-main').appendChild(dd); }
  }
  const data = typeof getComparisonData === 'function' ? getComparisonData() : [];
  if (data.length <= 1) {
    hud.innerHTML = '<div class="rhud-header" onclick="toggleRankingsDropdown()"><span class="rhud-rank">#1</span> <span class="rhud-label">Rankings</span> <span class="rhud-arrow">\u25BC</span></div>';
    return;
  }
  data.sort((a, b) => (b.stats.score || 0) - (a.stats.score || 0));
  const pi = data.findIndex(e => e.isPlayer);
  const rank = pi >= 0 ? pi + 1 : '?';
  const leader = data[0];
  const pScore = data[pi]?.stats?.score || 0;
  let html = '<div class="rhud-header" onclick="toggleRankingsDropdown()">';
  html += '<span class="rhud-rank">#' + rank + '</span>';
  html += '<span class="rhud-label">' + (rank === 1 ? 'Leading' : leader.name.split(' ').pop() + ' leads') + '</span>';
  html += '<span class="rhud-score">' + pScore + 'pts</span>';
  html += '<span class="rhud-arrow">\u25BC</span></div>';
  hud.innerHTML = html;
  // Always render dropdown content (open by default)
  const dd = document.getElementById('rankings-dropdown');
  if (dd) renderRankingsDropdown(data);
}

export function toggleRankingsDropdown() {
  let dd = document.getElementById('rankings-dropdown');
  if (!dd) { dd = document.createElement('div'); dd.id = 'rankings-dropdown'; document.getElementById('game-main').appendChild(dd); }
  if (dd.style.display === 'block') { dd.style.display = 'none'; }
  else { dd.style.display = 'block'; const data = typeof getComparisonData === 'function' ? getComparisonData() : []; data.sort((a, b) => (b.stats.score || 0) - (a.stats.score || 0)); renderRankingsDropdown(data); }
}

export function renderRankingsDropdown(data) {
  const dd = document.getElementById('rankings-dropdown');
  if (!dd) return;
  const arcIcons = { militaristic: '\u2694', expansionist: '\u{1F30D}', cultural: '\u{1F3AD}', diplomatic: '\u{1F91D}' };
  let html = '';
  data.forEach((e, i) => {
    const rel = !e.isPlayer && game.relationships[e.factionId] !== undefined ? game.relationships[e.factionId] : null;
    const rc = rel !== null ? (rel > 20 ? 'rel-friendly' : rel < -20 ? 'rel-hostile' : 'rel-neutral') : '';
    const traits = !e.isPlayer && FACTION_TRAITS[e.factionId] ? FACTION_TRAITS[e.factionId] : null;
    const arc = traits ? (arcIcons[traits.archetype] || '') : '';
    html += '<div class="rdd-row ' + (e.isPlayer ? 'rdd-player' : '') + '" ' + (!e.isPlayer ? 'onclick="togglePanel(\'diplomacy-panel\')"' : '') + '>';
    html += '<span class="rdd-pos">' + (i+1) + '</span>';
    html += '<span class="rdd-color" style="background:' + (e.color || 'var(--color-gold)') + '"></span>';
    html += '<span class="rdd-name">' + (e.isPlayer ? '\u{1F451} ' : '') + e.name + '</span>';
    if (arc) html += '<span class="rdd-arc" title="' + (traits?.archetype || '') + '">' + arc + '</span>';
    html += '<span class="rdd-score">' + (e.stats.score || 0) + '</span>';
    if (rel !== null) html += '<span class="rdd-rel ' + rc + '">' + (rel > 0 ? '+' : '') + rel + '</span>';
    html += '</div>';
  });
  dd.innerHTML = html;
}
