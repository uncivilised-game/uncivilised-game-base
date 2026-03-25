import { MAP_COLS, MAP_ROWS, BASE_TERRAIN, UNIT_TYPES, RESOURCES, TECHNOLOGIES, BUILDINGS } from './constants.js';
import { game } from './state.js';
import { hexDistance, getHexNeighbors } from './hex.js';
import { isTilePassable } from './map.js';
import { createUnit } from './units.js';
import { addEvent, logAction, showToast } from './events.js';
import { render } from './render.js';
import { revealAround } from './discovery.js';
import { getUnitAt } from './combat.js';
import { updateUI } from './leaderboard.js';
import { BARBARIAN_UNITS } from './constants.js';

const MINOR_FACTION_TYPES = {
  barbarian_camp: {
    name: 'Barbarian Camp',
    icon: '\u{1F3D5}',
    color: '#8b4513',
    actions: ['raid', 'recruit', 'spy_mission', 'bribe', 'destroy'],
    desc: 'A fortified encampment of raiders and outlaws',
  },
  mystic_sect: {
    name: 'Mystic Sect',
    icon: '\u{1F52E}',
    color: '#6a3d9a',
    actions: ['commune', 'trade_knowledge', 'seek_prophecy', 'recruit_sage'],
    desc: 'An ancient order of seers and mystics',
  },
  nomadic_tribe: {
    name: 'Nomadic Tribe',
    icon: '\u{1F42A}',
    color: '#b8860b',
    actions: ['trade', 'hire_scouts', 'exchange_maps', 'feast'],
    desc: 'Wandering herders and traders of the frontier',
  },
};

function generateMinorFactions(map) {
  if (!game.minorFactions) game.minorFactions = [];
  const numCamps = 3 + Math.floor(Math.random() * 3); // 3-5 barbarian camps
  const numMystic = 1 + Math.floor(Math.random() * 2); // 1-2 mystic sects
  const numNomad = 2 + Math.floor(Math.random() * 2);  // 2-3 nomadic tribes

  const placements = [
    ...Array(numCamps).fill('barbarian_camp'),
    ...Array(numMystic).fill('mystic_sect'),
    ...Array(numNomad).fill('nomadic_tribe'),
  ];

  for (const type of placements) {
    for (let att = 0; att < 50; att++) {
      const c = 2 + Math.floor(Math.random() * (MAP_COLS - 4));
      const r = 2 + Math.floor(Math.random() * (MAP_ROWS - 4));
      const tile = map[r][c];
      if (tile.base === 'ocean' || tile.base === 'coast' || tile.base === 'lake' || tile.feature === 'mountain') continue;
      // Must be on the main continent
      if (game.continentId && game.mainContinent >= 0 && game.continentId[r][c] !== game.mainContinent) continue;
      // Not too close to player start or faction cities
      const tooClose = game.cities.some(city => hexDistance(c, r, city.col, city.row) < 4) ||
        Object.values(game.factionCities).some(fc => hexDistance(c, r, fc.col, fc.row) < 4) ||
        game.minorFactions.some(mf => hexDistance(c, r, mf.col, mf.row) < 3);
      if (tooClose) continue;

      game.minorFactions.push({
        id: `${type}_${game.minorFactions.length}`,
        type: type,
        col: c,
        row: r,
        strength: 5 + Math.floor(Math.random() * 15), // 5-20
        gold: 10 + Math.floor(Math.random() * 30),
        disposition: type === 'barbarian_camp' ? -10 : type === 'nomadic_tribe' ? 10 : 5,
        interacted: false,
        defeated: false,
        converted: false, // barbarians: converted to work for player
        convertedRole: null, // spy, pirate, raider
      });
      break;
    }
  }
}

function interactWithMinorFaction(mfId) {
  const mf = game.minorFactions.find(m => m.id === mfId);
  if (!mf || mf.defeated) return;

  const mfType = MINOR_FACTION_TYPES[mf.type];
  if (!mfType) return;

  // Build interaction panel
  const panel = document.getElementById('tile-info');
  const title = document.getElementById('tile-info-title');
  const body = document.getElementById('tile-info-body');

  title.textContent = `${mfType.icon} ${mfType.name}`;

  let html = `<p style="color:var(--color-text-muted);margin-bottom:8px">${mfType.desc}</p>`;
  html += `<p>Strength: ${mf.strength} | Gold: ${mf.gold} | Disposition: ${mf.disposition > 0 ? 'Friendly' : mf.disposition < -5 ? 'Hostile' : 'Wary'}</p>`;

  if (mf.converted) {
    html += `<p style="color:#6aab5c">Converted: serving as ${mf.convertedRole}</p>`;
  }

  html += '<div class="minor-actions">';

  if (mf.type === 'barbarian_camp' && !mf.converted) {
    // Pay Tribute
    const tributeCost = 15 + Math.floor(mf.strength);
    html += `<button class="minor-btn" onclick="minorAction('${mfId}','bribe')" ${game.gold < tributeCost ? 'disabled style="opacity:0.5"' : ''}>\u{1F4B0} Pay Tribute (${tributeCost}g) — Prevent raids, improve relations</button>`;
    // Befriend
    if (mf.disposition >= 0) {
      html += `<button class="minor-btn" onclick="minorAction('${mfId}','befriend')" ${game.gold < 25 ? 'disabled style="opacity:0.5"' : ''}>\u{1F91D} Befriend (25g) — Build lasting alliance</button>`;
    } else {
      html += `<button class="minor-btn" disabled style="opacity:0.4">\u{1F91D} Befriend — Disposition too low (need Neutral)</button>`;
    }
    // Hire Mercenaries
    html += `<button class="minor-btn" onclick="minorAction('${mfId}','recruit')" ${game.gold < 30 ? 'disabled style="opacity:0.5"' : ''}>\u{2694} Hire Mercenaries (30g) — Recruit warriors to your cause</button>`;
    // Convert to Spies/Raiders
    html += `<button class="minor-btn minor-btn-special" onclick="minorAction('${mfId}','convert_spy')" ${game.gold < 40 || mf.disposition < 5 ? 'disabled style="opacity:0.5"' : ''}>\u{1F50D} Convert to Spies (40g) — They spy for you</button>`;
    html += `<button class="minor-btn minor-btn-special" onclick="minorAction('${mfId}','convert_raider')" ${game.gold < 35 || mf.disposition < 0 ? 'disabled style="opacity:0.5"' : ''}>\u{1F3F4} Convert to Raiders (35g) — They raid enemy trade</button>`;
    // Demand Departure
    const canDemand = game.military >= mf.strength * 2;
    html += `<button class="minor-btn minor-btn-danger" onclick="minorAction('${mfId}','demand')" ${!canDemand ? 'disabled style="opacity:0.5"' : ''}>\u{1F4E2} Demand Departure (Military: ${game.military}/${mf.strength * 2} needed)</button>`;
    // Convert to Settlement
    const convertCost = 100 + mf.strength * 5;
    const canConvert = mf.disposition >= 30 && game.gold >= convertCost && game.population >= 500;
    html += `<button class="minor-btn minor-btn-special" onclick="minorAction('${mfId}','convert_city')" ${!canConvert ? 'disabled style="opacity:0.5"' : ''}>\u{1F3F0} Convert to Settlement (${convertCost}g + 500 pop)</button>`;
    // Destroy
    html += `<button class="minor-btn minor-btn-danger" onclick="minorAction('${mfId}','destroy')">\u{1F525} Destroy Camp — Gain gold, remove threat</button>`;
  } else if (mf.type === 'mystic_sect') {
    html += `<button class="minor-btn" onclick="minorAction('${mfId}','commune')">\u{1F52E} Commune with Seers — Gain prophecy</button>`;
    html += `<button class="minor-btn" onclick="minorAction('${mfId}','trade_knowledge')">\u{1F4DA} Trade Knowledge (15g) — +Science</button>`;
    html += `<button class="minor-btn" onclick="minorAction('${mfId}','seek_prophecy')">\u{2728} Seek Prophecy (25g) — Reveal map area</button>`;
    html += `<button class="minor-btn minor-btn-special" onclick="minorAction('${mfId}','recruit_sage')">\u{1F9D9} Recruit Sage (50g) — +3 science/turn</button>`;
  } else if (mf.type === 'nomadic_tribe') {
    html += `<button class="minor-btn" onclick="minorAction('${mfId}','trade')">\u{1F4E6} Trade Goods (10g) — Gain resources</button>`;
    html += `<button class="minor-btn" onclick="minorAction('${mfId}','hire_scouts')">\u{1F441} Hire Scouts (20g) — Reveal nearby area</button>`;
    html += `<button class="minor-btn" onclick="minorAction('${mfId}','exchange_maps')">\u{1F5FA} Exchange Maps (15g) — Mutual map reveal</button>`;
    html += `<button class="minor-btn" onclick="minorAction('${mfId}','feast')">\u{1F356} Hold Feast (25g) — +Population, +Culture</button>`;
  }

  html += '</div>';
  body.innerHTML = html;
  panel.style.display = 'block';
}

// ============================================
// Barbarian Camp Interactions (AI-spawned camps from processBarbarianTurns)
// ============================================
function interactWithBarbarianCamp(campId) {
  const bc = game.barbarianCamps.find(c => c.id === campId);
  if (!bc || bc.destroyed) return;

  // Initialize disposition if missing (legacy camps)
  if (bc.disposition === undefined) bc.disposition = -10;
  if (bc.tributePaid === undefined) bc.tributePaid = 0;

  const panel = document.getElementById('tile-info');
  const title = document.getElementById('tile-info-title');
  const body = document.getElementById('tile-info-body');

  const specUnit = bc.specialUnit ? BARBARIAN_UNITS[bc.specialUnit] : null;
  const campName = specUnit ? specUnit.name + ' Camp' : 'Barbarian Camp';
  title.textContent = `\u{1F3D5} ${campName}`;

  const dispLabel = bc.disposition >= 20 ? 'Friendly' : bc.disposition >= 0 ? 'Neutral' : bc.disposition >= -10 ? 'Wary' : 'Hostile';
  const dispColor = bc.disposition >= 20 ? '#6aab5c' : bc.disposition >= 0 ? '#aab0a8' : bc.disposition >= -10 ? '#ddc060' : '#d9534f';

  let html = `<p style="color:var(--color-text-muted);margin-bottom:8px">A fortified encampment of raiders and outlaws. Strength: ${bc.strength}</p>`;
  html += `<p>Disposition: <span style="color:${dispColor}">${dispLabel} (${bc.disposition})</span></p>`;

  if (bc.subjugated) {
    html += `<p style="color:#c9a84c;margin:8px 0">\u{1F3F0} This camp has been converted into your settlement.</p>`;
    html += '</div>';
    body.innerHTML = html;
    panel.style.display = 'block';
    return;
  }

  html += '<div class="minor-actions" style="display:flex;flex-direction:column;gap:6px;margin-top:8px">';

  // 1. Pay Tribute — prevent raids, improve disposition
  const tributeCost = 15 + Math.floor(bc.strength);
  html += `<button class="minor-btn" onclick="barbCampAction('${campId}','tribute')" ${game.gold < tributeCost ? 'disabled style="opacity:0.5"' : ''}>`;
  html += `\u{1F4B0} Pay Tribute (${tributeCost}g) — Prevent raids, improve relations</button>`;

  // 2. Befriend — requires positive disposition, costs gold, unlocks trade
  if (bc.disposition >= 0) {
    const befriendCost = 25;
    html += `<button class="minor-btn" onclick="barbCampAction('${campId}','befriend')" ${game.gold < befriendCost ? 'disabled style="opacity:0.5"' : ''}>`;
    html += `\u{1F91D} Befriend (${befriendCost}g) — Build lasting alliance</button>`;
  } else {
    html += `<button class="minor-btn" disabled style="opacity:0.4">\u{1F91D} Befriend — Disposition too low (need Neutral)</button>`;
  }

  // 3. Hire Mercenaries — costs gold, get a warrior
  const hireCost = 30;
  html += `<button class="minor-btn" onclick="barbCampAction('${campId}','hire')" ${game.gold < hireCost ? 'disabled style="opacity:0.5"' : ''}>`;
  html += `\u{2694}\u{FE0F} Hire Mercenaries (${hireCost}g) — Recruit a warrior to your cause</button>`;

  // 4. Demand Departure — requires high military, hostile act
  const demandPower = game.military;
  const canDemand = demandPower >= bc.strength * 2;
  html += `<button class="minor-btn minor-btn-danger" onclick="barbCampAction('${campId}','demand')" ${!canDemand ? 'disabled style="opacity:0.5"' : ''}>`;
  html += `\u{1F4E2} Demand Departure (Military: ${demandPower}/${bc.strength * 2} needed) — Force them to leave</button>`;

  // 5. Convert to Settlement — very expensive, requires high disposition
  const convertGoldCost = 100 + bc.strength * 5;
  const canConvert = bc.disposition >= 30 && game.gold >= convertGoldCost && game.population >= 500;
  const convertReqs = [];
  if (bc.disposition < 30) convertReqs.push(`Disposition 30+ (have ${bc.disposition})`);
  if (game.gold < convertGoldCost) convertReqs.push(`${convertGoldCost}g (have ${game.gold})`);
  if (game.population < 500) convertReqs.push(`500 pop (have ${game.population})`);
  html += `<button class="minor-btn minor-btn-special" onclick="barbCampAction('${campId}','convert_city')" ${!canConvert ? 'disabled style="opacity:0.5"' : ''}>`;
  html += `\u{1F3F0} Convert to Settlement (${convertGoldCost}g + 500 pop)`;
  if (convertReqs.length > 0) html += `<br><small style="color:#d9534f">Requires: ${convertReqs.join(', ')}</small>`;
  html += `</button>`;

  // 6. Raid / Attack — direct combat
  html += `<button class="minor-btn minor-btn-danger" onclick="barbCampAction('${campId}','attack')">`;
  html += `\u{1F525} Attack Camp — Destroy and loot (need adjacent unit)</button>`;

  html += '</div>';
  body.innerHTML = html;
  panel.style.display = 'block';
}

window.barbCampAction = function(campId, action) {
  const bc = game.barbarianCamps.find(c => c.id === campId);
  if (!bc || bc.destroyed) return;

  if (bc.disposition === undefined) bc.disposition = -10;
  if (bc.tributePaid === undefined) bc.tributePaid = 0;

  switch (action) {
    case 'tribute': {
      const cost = 15 + Math.floor(bc.strength);
      if (game.gold < cost) { addEvent('Not enough gold to pay tribute.', 'gold'); return; }
      game.gold -= cost;
      bc.disposition += 10;
      bc.tributePaid += cost;
      bc.raidTimer = 0; // Reset raid timer — they won't attack for a while
      addEvent(`\u{1F4B0} Paid ${cost}g tribute to barbarian camp. They pause their raids.`, 'diplomacy');
      showToast('Tribute Paid', 'The barbarians accept your gold and stand down.');
      break;
    }
    case 'befriend': {
      if (game.gold < 25) { addEvent('Not enough gold.', 'gold'); return; }
      if (bc.disposition < 0) { addEvent('The barbarians are too hostile. Pay tribute first.', 'diplomacy'); return; }
      game.gold -= 25;
      bc.disposition += 15;
      // Befriended camps stop spawning raiders
      if (bc.disposition >= 20) {
        bc.pacified = true;
        game.goldPerTurn += 1;
        addEvent('\u{1F91D} The barbarians consider you a friend! They offer trade (+1 gold/turn) and cease hostilities.', 'diplomacy');
        showToast('Camp Befriended', 'Barbarians are now friendly and trade with you.');
      } else {
        addEvent('\u{1F91D} Relations with the barbarian camp improve.', 'diplomacy');
      }
      break;
    }
    case 'hire': {
      if (game.gold < 30) { addEvent('Not enough gold.', 'gold'); return; }
      game.gold -= 30;
      // Find a spot near the player's capital to place the unit
      const city = game.cities[0];
      if (!city) { addEvent('You need a city to recruit mercenaries.', 'combat'); return; }
      const nb = getHexNeighbors(city.col, city.row).find(n =>
        n.row >= 0 && n.row < MAP_ROWS && n.col >= 0 && n.col < MAP_COLS &&
        isTilePassable(game.map[n.row][n.col]) && !getUnitAt(n.col, n.row)
      );
      if (!nb) { addEvent('No room near your city for mercenaries.', 'combat'); return; }
      // Chance of specialist unit from this camp
      const spec = bc.specialUnit ? BARBARIAN_UNITS[bc.specialUnit] : null;
      if (spec && Math.random() < 0.5) {
        const u = createUnit('warrior', nb.col, nb.row, 'player');
        u.barbSpecial = bc.specialUnit;
        u.combat = spec.combat;
        u.barbName = spec.name;
        u.barbIcon = spec.icon;
        game.units.push(u);
        addEvent(`\u{2694}\u{FE0F} Hired ${spec.name} mercenary! (${spec.desc})`, 'combat');
      } else {
        game.units.push(createUnit('warrior', nb.col, nb.row, 'player'));
        addEvent('\u{2694}\u{FE0F} Hired barbarian mercenaries!', 'combat');
      }
      bc.strength = Math.max(1, bc.strength - 3);
      bc.disposition += 5;
      break;
    }
    case 'demand': {
      const power = game.military;
      if (power < bc.strength * 2) {
        addEvent(`Your military (${power}) is not intimidating enough. Need ${bc.strength * 2}.`, 'combat');
        return;
      }
      // Success — camp disperses
      bc.destroyed = true;
      const lootGold = Math.floor(bc.strength * 1.5) + 10;
      game.gold += lootGold;
      // Remove barbarian units near this camp
      game.units = game.units.filter(u => !(u.owner === 'barbarian' && hexDistance(u.col, u.row, bc.col, bc.row) <= 3));
      addEvent(`\u{1F4E2} The barbarians flee before your might! +${lootGold}g recovered.`, 'combat');
      showToast('Camp Dispersed', 'Your military strength forced the barbarians to abandon their camp.');
      break;
    }
    case 'convert_city': {
      const goldCost = 100 + bc.strength * 5;
      if (bc.disposition < 30) { addEvent('The barbarians don\'t trust you enough. Befriend them first (disposition 30+).', 'diplomacy'); return; }
      if (game.gold < goldCost) { addEvent(`Not enough gold. Need ${goldCost}g.`, 'gold'); return; }
      if (game.population < 500) { addEvent('Not enough population to settle here. Need 500.', 'diplomacy'); return; }
      game.gold -= goldCost;
      game.population -= 500;
      bc.destroyed = true;
      bc.subjugated = true;
      // Remove barbarian units near this camp
      game.units = game.units.filter(u => !(u.owner === 'barbarian' && hexDistance(u.col, u.row, bc.col, bc.row) <= 3));
      // Create a new player city at this location
      const cityNames = ['New Hope', 'Frontier Post', 'Barbarian\'s Rest', 'Converted Hold', 'Outland Keep', 'March\'s End'];
      const cityName = cityNames[Math.floor(Math.random() * cityNames.length)];
      game.cities.push({
        col: bc.col, row: bc.row, name: cityName, owner: 'player',
        population: 500, buildings: [], isCapital: false, founded: game.turn,
      });
      game.goldPerTurn += 2;
      game.sciencePerTurn += 1;
      addEvent(`\u{1F3F0} Barbarian camp converted to settlement "${cityName}"! The former raiders join your civilization.`, 'diplomacy');
      showToast('Settlement Founded!', `${cityName} rises where barbarians once camped.`);
      break;
    }
    case 'attack': {
      // Check for adjacent player unit
      const adjUnits = game.units.filter(u => u.owner === 'player' && hexDistance(u.col, u.row, bc.col, bc.row) <= 1);
      if (adjUnits.length === 0) {
        addEvent('You need a military unit adjacent to the camp to attack it.', 'combat');
        return;
      }
      const attacker = adjUnits[0];
      const attackerType = UNIT_TYPES[attacker.type];
      // Simple combat resolution vs camp strength
      const atkPower = attackerType.combat + (attacker.combat || 0);
      const defPower = bc.strength;
      const damage = Math.max(5, Math.floor((atkPower / (atkPower + defPower)) * 40));
      const retaliation = Math.max(5, Math.floor((defPower / (atkPower + defPower)) * 30));
      bc.strength -= damage;
      attacker.hp -= retaliation;
      if (bc.strength <= 0) {
        bc.destroyed = true;
        const lootGold = 15 + Math.floor(Math.random() * 20);
        game.gold += lootGold;
        game.units = game.units.filter(u => !(u.owner === 'barbarian' && hexDistance(u.col, u.row, bc.col, bc.row) <= 2));
        addEvent(`\u{1F525} Barbarian camp destroyed! +${lootGold}g looted.`, 'combat');
        showToast('Camp Destroyed', 'Your warriors razed the barbarian camp!');
      } else {
        addEvent(`\u{2694}\u{FE0F} Attacked barbarian camp (${damage} dmg dealt, ${retaliation} taken). Camp strength: ${bc.strength}`, 'combat');
      }
      if (attacker.hp <= 0) {
        game.units = game.units.filter(u => u !== attacker);
        addEvent(`Your ${attackerType.name} was killed attacking the camp!`, 'combat');
      }
      bc.disposition -= 15; // Attacking makes them hostile
      break;
    }
  }

  updateUI();
  render();
  // Refresh the panel if camp still exists
  if (!bc.destroyed) interactWithBarbarianCamp(campId);
  else { document.getElementById('tile-info').style.display = 'none'; }
};

export { MINOR_FACTION_TYPES, generateMinorFactions, interactWithMinorFaction, interactWithBarbarianCamp };

window.minorAction = function(mfId, action) {
  const mf = game.minorFactions.find(m => m.id === mfId);
  if (!mf) return;
  const mfType = MINOR_FACTION_TYPES[mf.type];

  switch (action) {
    case 'bribe': {
      const tributeCost = 15 + Math.floor(mf.strength);
      if (game.gold < tributeCost) { addEvent('Not enough gold to pay tribute.', 'gold'); return; }
      game.gold -= tributeCost;
      mf.disposition += 10;
      addEvent(`\u{1F4B0} Paid ${tributeCost}g tribute to ${mfType.name}: relations improved`, 'diplomacy');
      showToast('Tribute Paid', 'The barbarians accept your gold.');
      break;
    }
    case 'recruit': {
      if (game.gold < 30) { addEvent('Not enough gold.', 'gold'); return; }
      game.gold -= 30;
      const city = game.cities[0];
      if (city) {
        const nb = getHexNeighbors(city.col, city.row).find(n => isTilePassable(game.map[n.row][n.col]) && !getUnitAt(n.col, n.row));
        if (nb) {
          const nearCamp = game.barbarianCamps ? game.barbarianCamps.find(bc => bc.id === mfId || hexDistance(bc.col, bc.row, mf.col, mf.row) <= 2) : null;
          const spec2 = nearCamp && nearCamp.specialUnit ? BARBARIAN_UNITS[nearCamp.specialUnit] : null;
          if (spec2 && Math.random() < 0.5) {
            const u = createUnit('warrior', nb.col, nb.row, 'player');
            u.barbSpecial = nearCamp.specialUnit;
            u.combat = spec2.combat;
            u.barbName = spec2.name;
            u.barbIcon = spec2.icon;
            game.units.push(u);
            addEvent('Hired ' + spec2.name + ' mercenary! (' + spec2.desc + ')', 'combat');
          } else {
            game.units.push(createUnit('warrior', nb.col, nb.row, 'player'));
            addEvent('Hired barbarian mercenaries!', 'combat');
          }
        }
      }
      mf.strength = Math.max(0, mf.strength - 5);
      break;
    }
    case 'convert_spy': {
      if (game.gold < 40) { addEvent('Not enough gold.', 'gold'); return; }
      if (mf.disposition < 5) { addEvent('Barbarians are too hostile to convert. Bribe them first.', 'diplomacy'); return; }
      game.gold -= 40;
      mf.converted = true;
      mf.convertedRole = 'spy network';
      revealAround(mf.col, mf.row, 6);
      game.sciencePerTurn += 1;
      addEvent('\u{1F50D} Barbarian camp converted to spy network! +1 science/turn, area revealed', 'diplomacy');
      break;
    }
    case 'convert_raider': {
      if (game.gold < 35) { addEvent('Not enough gold.', 'gold'); return; }
      if (mf.disposition < 0) { addEvent('Barbarians are too hostile. Bribe them first.', 'diplomacy'); return; }
      game.gold -= 35;
      mf.converted = true;
      mf.convertedRole = 'trade raiders';
      game.goldPerTurn += 2;
      addEvent('\u{1F3F4} Barbarians now raid enemy trade routes! +2 gold/turn', 'gold');
      break;
    }
    case 'befriend': {
      if (game.gold < 25) { addEvent('Not enough gold.', 'gold'); return; }
      if (mf.disposition < 0) { addEvent('The barbarians are too hostile. Pay tribute first.', 'diplomacy'); return; }
      game.gold -= 25;
      mf.disposition += 15;
      if (mf.disposition >= 20) {
        game.goldPerTurn += 1;
        addEvent('\u{1F91D} The barbarians consider you a friend! They offer trade (+1 gold/turn) and cease hostilities.', 'diplomacy');
        showToast('Camp Befriended', 'Barbarians are now friendly and trade with you.');
      } else {
        addEvent('\u{1F91D} Relations with the barbarian camp improve.', 'diplomacy');
      }
      break;
    }
    case 'demand': {
      if (game.military < mf.strength * 2) {
        addEvent(`Your military (${game.military}) is not intimidating enough. Need ${mf.strength * 2}.`, 'combat');
        return;
      }
      mf.defeated = true;
      const lootGold = Math.floor(mf.strength * 1.5) + 10;
      game.gold += lootGold;
      addEvent(`\u{1F4E2} The barbarians flee before your might! +${lootGold}g recovered.`, 'combat');
      showToast('Camp Dispersed', 'Your military strength forced the barbarians to abandon their camp.');
      break;
    }
    case 'convert_city': {
      const convertCost = 100 + mf.strength * 5;
      if (mf.disposition < 30) { addEvent('The barbarians don\'t trust you enough. Befriend them first (disposition 30+).', 'diplomacy'); return; }
      if (game.gold < convertCost) { addEvent(`Not enough gold. Need ${convertCost}g.`, 'gold'); return; }
      if (game.population < 500) { addEvent('Not enough population. Need 500.', 'diplomacy'); return; }
      game.gold -= convertCost;
      game.population -= 500;
      mf.defeated = true;
      const cityNames = ['New Hope', 'Frontier Post', 'Barbarian\'s Rest', 'Converted Hold', 'Outland Keep', 'March\'s End'];
      const cityName = cityNames[Math.floor(Math.random() * cityNames.length)];
      game.cities.push({
        col: mf.col, row: mf.row, name: cityName, owner: 'player',
        population: 500, buildings: [], isCapital: false, founded: game.turn,
      });
      game.goldPerTurn += 2;
      game.sciencePerTurn += 1;
      addEvent(`\u{1F3F0} Barbarian camp converted to settlement "${cityName}"! The former raiders join your civilization.`, 'diplomacy');
      showToast('Settlement Founded!', `${cityName} rises where barbarians once camped.`);
      break;
    }
    case 'destroy': {
      const playerMilitary = game.military;
      if (playerMilitary < mf.strength) {
        addEvent(`Your forces are not strong enough to destroy this camp (need ${mf.strength} military).`, 'combat');
        return;
      }
      game.gold += mf.gold;
      game.military -= Math.floor(mf.strength / 3);
      mf.defeated = true;
      addEvent('\u{1F525} Barbarian camp destroyed! +' + mf.gold + ' gold', 'combat');
      break;
    }
    case 'commune': {
      const prophecies = [
        'The seers speak of a great war approaching from the east...',
        'The mystics sense a golden age on the horizon if you pursue knowledge...',
        'The oracle warns: beware the one who smiles while sharpening a blade...',
        'The spirits reveal: an untapped resource lies near flowing water...',
        'The stars foretell: your next alliance will shape the fate of nations...',
      ];
      game.culture += 2;
      addEvent('\u{1F52E} Prophecy: "' + prophecies[Math.floor(Math.random() * prophecies.length)] + '" (+2 culture)', 'diplomacy');
      break;
    }
    case 'trade_knowledge': {
      if (game.gold < 15) { addEvent('Not enough gold.', 'gold'); return; }
      game.gold -= 15;
      game.sciencePerTurn += 1;
      mf.gold += 15;
      addEvent('\u{1F4DA} Traded with mystics: +1 science/turn', 'science');
      break;
    }
    case 'seek_prophecy': {
      if (game.gold < 25) { addEvent('Not enough gold.', 'gold'); return; }
      game.gold -= 25;
      const rc = Math.floor(Math.random() * MAP_COLS);
      const rr = Math.floor(Math.random() * MAP_ROWS);
      revealAround(rc, rr, 5);
      addEvent('\u{2728} The mystics reveal hidden lands!', 'diplomacy');
      break;
    }
    case 'recruit_sage': {
      if (game.gold < 50) { addEvent('Not enough gold.', 'gold'); return; }
      game.gold -= 50;
      game.sciencePerTurn += 3;
      mf.interacted = true;
      addEvent('\u{1F9D9} Sage recruited! +3 science/turn permanently', 'science');
      break;
    }
    case 'trade': {
      if (game.gold < 10) { addEvent('Not enough gold.', 'gold'); return; }
      game.gold -= 10;
      game.food += 8;
      const bonusGold = Math.floor(Math.random() * 10) + 5;
      game.gold += bonusGold;
      addEvent('\u{1F4E6} Traded with nomads: +8 food, +' + bonusGold + ' gold', 'gold');
      mf.disposition += 5;
      break;
    }
    case 'hire_scouts': {
      if (game.gold < 20) { addEvent('Not enough gold.', 'gold'); return; }
      game.gold -= 20;
      revealAround(mf.col, mf.row, 5);
      addEvent('\u{1F441} Nomad scouts reveal the surrounding territory!', 'diplomacy');
      break;
    }
    case 'exchange_maps': {
      if (game.gold < 15) { addEvent('Not enough gold.', 'gold'); return; }
      game.gold -= 15;
      const city = game.cities[0];
      if (city) {
        const midCol = Math.floor((city.col + mf.col) / 2);
        const midRow = Math.floor((city.row + mf.row) / 2);
        revealAround(midCol, midRow, 4);
        revealAround(mf.col, mf.row, 3);
      }
      addEvent('\u{1F5FA} Exchanged maps with nomads \u2014 new territory revealed!', 'diplomacy');
      break;
    }
    case 'feast': {
      if (game.gold < 25) { addEvent('Not enough gold.', 'gold'); return; }
      game.gold -= 25;
      game.population += 200;
      game.culture += 3;
      mf.disposition += 10;
      addEvent('\u{1F356} Grand feast with nomads! +200 population, +3 culture', 'diplomacy');
      break;
    }
  }

  updateUI();
  render();
  // Refresh the panel if camp still exists, close it if defeated/destroyed
  if (mf.defeated) {
    document.getElementById('tile-info').style.display = 'none';
  } else {
    interactWithMinorFaction(mfId);
  }
};
