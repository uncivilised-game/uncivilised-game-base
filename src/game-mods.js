import { UNIT_TYPES, UNIT_UNLOCKS, BUILDINGS, TECHNOLOGIES, RESOURCES, FACTIONS } from './constants.js';
import { game } from './state.js';
import { addEvent, logAction } from './events.js';
import { render } from './render.js';
import { revealAround } from './discovery.js';
import { createUnit } from './units.js';
import { MAP_COLS, MAP_ROWS } from './constants.js';
import { getHexNeighbors } from './hex.js';
import { isTilePassable } from './map.js';
import { getUnitAt } from './combat.js';
import { appendChatAction } from './diplomacy.js';

function applyGameMod(mod, sourceCharacterId) {
  if (!mod || !mod.type) return;
  if (!game.appliedMods) game.appliedMods = [];

  const faction = FACTIONS[sourceCharacterId];
  const sourceName = faction ? faction.name : 'Unknown';
  let modDescription = '';
  let modIcon = '\u{1F527}';

  switch (mod.type) {
    case 'new_unit': {
      if (!mod.id || !mod.name) break;
      // Add to UNIT_TYPES dynamically
      if (!UNIT_TYPES[mod.id]) {
        UNIT_TYPES[mod.id] = {
          name: mod.name,
          cost: Math.max(20, Math.min(mod.cost || 50, 500)),
          combat: Math.max(5, Math.min(mod.combat || 20, 50)),
          rangedCombat: Math.max(0, Math.min(mod.rangedCombat || 0, 50)),
          range: Math.max(0, Math.min(mod.range || 0, 4)),
          movePoints: Math.max(1, Math.min(mod.movePoints || 2, 5)),
          icon: mod.icon || '\u{2694}',
          class: mod.class || 'melee',
          desc: mod.desc || `Unique unit from ${sourceName}`,
        };
        // Add to unit unlocks (available immediately since it's a diplomatic gift)
        UNIT_UNLOCKS[mod.id] = null;
        modDescription = `New unit unlocked: ${mod.name} (${mod.combat} combat, ${mod.cost}g)`;
        modIcon = mod.icon || '\u{2694}';
        appendChatAction(`${modIcon} ${sourceName} teaches you to train ${mod.name}!`);
      }
      break;
    }
    case 'new_building': {
      if (!mod.id || !mod.name) break;
      if (!BUILDINGS.find(b => b.id === mod.id)) {
        BUILDINGS.push({
          id: mod.id,
          name: mod.name,
          cost: mod.cost || 60,
          desc: mod.desc || `Building from ${sourceName}`,
          effect: mod.effect || {},
        });
        modDescription = `New building unlocked: ${mod.name}`;
        modIcon = '\u{1F3DB}';
        appendChatAction(`\u{1F3DB} ${sourceName} shares the design for ${mod.name}!`);
      }
      break;
    }
    case 'new_tech': {
      if (!mod.id || !mod.name) break;
      if (!TECHNOLOGIES.find(t => t.id === mod.id)) {
        TECHNOLOGIES.push({
          id: mod.id,
          name: mod.name,
          cost: mod.cost || 40,
          desc: mod.desc || `Knowledge from ${sourceName}`,
          unlocks: mod.unlocks || [],
        });
        modDescription = `New technology available: ${mod.name}`;
        modIcon = '\u{1F4DA}';
        appendChatAction(`\u{1F4DA} ${sourceName} reveals the secrets of ${mod.name}!`);
      }
      break;
    }
    case 'reveal_map': {
      const col = mod.col || Math.floor(MAP_COLS / 2);
      const row = mod.row || Math.floor(MAP_ROWS / 2);
      const radius = Math.min(mod.radius || 4, 8);
      revealAround(col, row, radius);
      modDescription = mod.reason || `Map area revealed`;
      modIcon = '\u{1F5FA}';
      appendChatAction(`\u{1F5FA} ${sourceName} shares intelligence: ${mod.reason || 'new territory revealed'}!`);
      break;
    }
    case 'stat_buff': {
      const stat = mod.stat;
      const amount = Math.max(0, Math.min(mod.amount || 5, 20));
      if (stat && game[stat] !== undefined) {
        game[stat] += amount;
        modDescription = `${mod.reason || stat}: +${amount}`;
        modIcon = '\u{2B06}';
        appendChatAction(`\u{2B06} ${mod.reason || `+${amount} ${stat}`} (from ${sourceName})`);
      } else if (stat === 'goldPerTurn') {
        game.goldPerTurn += amount;
        modDescription = `+${amount} gold per turn: ${mod.reason || ''}`;
        modIcon = '\u{1F4B0}';
        appendChatAction(`\u{1F4B0} +${amount} gold/turn from ${sourceName}!`);
      } else if (stat === 'sciencePerTurn') {
        game.sciencePerTurn += amount;
        modDescription = `+${amount} science per turn: ${mod.reason || ''}`;
        modIcon = '\u{1F52C}';
        appendChatAction(`\u{1F52C} +${amount} science/turn from ${sourceName}!`);
      } else if (stat === 'foodPerTurn') {
        game.foodPerTurn += amount;
        modDescription = `+${amount} food per turn: ${mod.reason || ''}`;
        modIcon = '\u{1F33E}';
        appendChatAction(`\u{1F33E} +${amount} food/turn from ${sourceName}!`);
      } else if (stat === 'productionPerTurn') {
        game.productionPerTurn += amount;
        modDescription = `+${amount} production per turn: ${mod.reason || ''}`;
        modIcon = '\u{2692}';
        appendChatAction(`\u{2692} +${amount} production/turn from ${sourceName}!`);
      }
      break;
    }
    case 'new_resource': {
      if (!mod.id || !mod.name) break;
      if (!RESOURCES[mod.id]) {
        RESOURCES[mod.id] = {
          name: mod.name,
          icon: mod.icon || '\u{2728}',
          color: mod.color || '#aaa',
          bonus: mod.bonus || { gold: 1 },
          category: mod.category || 'luxury',
        };
        // Place a few on the map near the player
        let placed = 0;
        for (const city of game.cities) {
          for (let r = Math.max(0, city.row - 5); r <= Math.min(MAP_ROWS - 1, city.row + 5) && placed < 3; r++) {
            for (let c = Math.max(0, city.col - 5); c <= Math.min(MAP_COLS - 1, city.col + 5) && placed < 3; c++) {
              const tile = game.map[r][c];
              if (!tile.resource && tile.base !== 'ocean' && tile.base !== 'coast' && tile.feature !== 'mountain' && Math.random() < 0.15) {
                tile.resource = mod.id;
                placed++;
              }
            }
          }
        }
        modDescription = `New resource discovered: ${mod.name} (${placed} deposits placed)`;
        modIcon = mod.icon || '\u{2728}';
        appendChatAction(`${modIcon} ${sourceName} reveals the location of ${mod.name} deposits!`);
      }
      break;
    }
    case 'gold_grant': {
      const amount = Math.min(mod.amount || 50, 300);
      game.gold += amount;
      modDescription = `+${amount} gold: ${mod.reason || ''}`;
      modIcon = '\u{1F4B0}';
      appendChatAction(`\u{1F4B0} ${sourceName} grants you ${amount} gold! ${mod.reason || ''}`);
      break;
    }
    case 'combat_bonus': {
      // Store persistent combat bonuses
      if (!game.combatBonuses) game.combatBonuses = [];
      const bonus = {
        targetClass: mod.target_class || 'all',
        bonus: Math.min(mod.bonus || 3, 10),
        reason: mod.reason || `Training from ${sourceName}`,
        source: sourceCharacterId,
      };
      game.combatBonuses.push(bonus);
      modDescription = `+${bonus.bonus} combat for ${bonus.targetClass} units: ${bonus.reason}`;
      modIcon = '\u{2694}';
      appendChatAction(`\u{2694} ${bonus.reason}: +${bonus.bonus} combat for ${bonus.targetClass} units!`);
      break;
    }
    case 'yield_bonus': {
      // Store persistent terrain yield bonuses
      if (!game.yieldBonuses) game.yieldBonuses = [];
      const yb = {
        terrain: mod.terrain || 'plains',
        bonus: mod.bonus || { food: 1 },
        reason: mod.reason || `Knowledge from ${sourceName}`,
        source: sourceCharacterId,
      };
      game.yieldBonuses.push(yb);
      const bonusParts = [];
      if (yb.bonus.food) bonusParts.push(`+${yb.bonus.food} food`);
      if (yb.bonus.gold) bonusParts.push(`+${yb.bonus.gold} gold`);
      if (yb.bonus.prod) bonusParts.push(`+${yb.bonus.prod} prod`);
      modDescription = `${yb.terrain} tiles: ${bonusParts.join(', ')} (${yb.reason})`;
      modIcon = '\u{1F33F}';
      appendChatAction(`\u{1F33F} ${yb.reason}: ${yb.terrain} tiles gain ${bonusParts.join(', ')}!`);
      break;
    }
    case 'spawn_units': {
      const unitType = mod.unit_type || 'warrior';
      const count = Math.min(mod.count || 1, 4);
      const city = game.cities[0];
      if (city && UNIT_TYPES[unitType]) {
        let spawned = 0;
        const ring1 = getHexNeighbors(city.col, city.row);
        const ring2 = [];
        for (const nb of ring1) {
          for (const nb2 of getHexNeighbors(nb.col, nb.row)) ring2.push(nb2);
        }
        for (const nb of [...ring1, ...ring2]) {
          if (spawned >= count) break;
          const tile = game.map[nb.row][nb.col];
          if (isTilePassable(tile) && !getUnitAt(nb.col, nb.row)) {
            const newUnit = createUnit(unitType, nb.col, nb.row, 'player');
            game.units.push(newUnit);
            spawned++;
          }
        }
        modDescription = `${spawned} ${UNIT_TYPES[unitType].name}(s) recruited: ${mod.reason || ''}`;
        modIcon = UNIT_TYPES[unitType].icon || '\u{2694}';
        appendChatAction(`${modIcon} ${sourceName} sends ${spawned} ${UNIT_TYPES[unitType].name}(s)! ${mod.reason || ''}`);
      }
      break;
    }
    case 'event': {
      const eventType = mod.event_type || 'golden_age';
      const duration = Math.min(mod.duration || 5, 15);
      if (!game.activeEvents) game.activeEvents = [];
      game.activeEvents.push({
        type: eventType,
        turnsLeft: duration,
        reason: mod.reason || `Event from ${sourceName}`,
        source: sourceCharacterId,
      });
      // Apply immediate effects
      if (eventType === 'golden_age') {
        game.goldPerTurn += 3;
        game.culture += 5;
        modDescription = `Golden Age! +3 gold/turn, +5 culture for ${duration} turns`;
        modIcon = '\u{2728}';
        appendChatAction(`\u{2728} A Golden Age begins! ${mod.reason || ''} (+3 gold/turn for ${duration} turns)`);
      } else if (eventType === 'military_drill') {
        game.military += 5;
        modDescription = `Military Drill: +5 military for ${duration} turns`;
        modIcon = '\u{1F3CB}';
        appendChatAction(`\u{1F3CB} Military drill begins! +5 military (${duration} turns)`);
      } else {
        modDescription = `Event: ${eventType} for ${duration} turns`;
        modIcon = '\u{1F3AD}';
        appendChatAction(`\u{1F3AD} ${mod.reason || eventType} begins!`);
      }
      break;
    }
    default:
      console.warn('Unknown game_mod type:', mod.type);
      return;
  }

  // Log the mod
  const modRecord = {
    turn: game.turn,
    source: sourceCharacterId,
    sourceName: sourceName,
    mod: mod,
    description: modDescription,
    icon: modIcon,
  };
  game.appliedMods.push(modRecord);
  logAction('mod', modDescription, { source: sourceCharacterId, modType: mod.type });
  addEvent(`\u{1F527} MOD: ${modDescription}`, 'diplomacy');

  // Show notification banner
  showModBanner(modIcon, modDescription, sourceName);
}

function showModBanner(icon, description, source) {
  // Create a temporary banner at the top of the game screen
  let banner = document.getElementById('mod-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'mod-banner';
    document.getElementById('game-main').appendChild(banner);
  }
  banner.innerHTML = `
    <div class="mod-banner-content">
      <span class="mod-banner-icon">${icon}</span>
      <div class="mod-banner-text">
        <strong>Game Modified</strong>
        <span>${description}</span>
        <span class="mod-banner-source">via ${source}</span>
      </div>
    </div>
  `;
  banner.className = 'mod-banner-show';

  // Auto-hide after 6 seconds
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => {
    banner.className = 'mod-banner-hide';
  }, 6000);
}

// Apply combat bonuses from mods in resolveCombat
function getModCombatBonus(unit) {
  if (!game.combatBonuses) return 0;
  let bonus = 0;
  const unitClass = UNIT_TYPES[unit.type]?.class || '';
  for (const cb of game.combatBonuses) {
    if (cb.targetClass === 'all' || cb.targetClass === unitClass) {
      bonus += cb.bonus;
    }
  }
  return bonus;
}

// Apply yield bonuses from mods
function getModYieldBonus(tile) {
  if (!game.yieldBonuses) return { food: 0, prod: 0, gold: 0 };
  let bonus = { food: 0, prod: 0, gold: 0 };
  for (const yb of game.yieldBonuses) {
    if (yb.terrain === tile.base || yb.terrain === tile.feature || yb.terrain === 'all') {
      if (yb.bonus.food) bonus.food += yb.bonus.food;
      if (yb.bonus.prod) bonus.prod += yb.bonus.prod;
      if (yb.bonus.gold) bonus.gold += yb.bonus.gold;
    }
  }
  return bonus;
}

export { applyGameMod, showModBanner, getModCombatBonus, getModYieldBonus };
