import { GREAT_PEOPLE_TYPES, PANTHEONS, WONDERS, BUILDINGS, TECHNOLOGIES, UNIT_TYPES } from './constants.js';
import { game } from './state.js';
import { addEvent, logAction, showToast, showCompletionNotification } from './events.js';
import { render } from './render.js';
import { getHexNeighbors } from './hex.js';
import { isTilePassable } from './map.js';
import { getUnitAt } from './combat.js';
import { createUnit } from './units.js';
import { updateUI } from './leaderboard.js';

export function showGreatPersonNotification(gp) {
  showCompletionNotification('greatperson', gp.icon + ' ' + gp.name, gp.effect);
  if (typeof showToast === 'function') showToast('\u2B50 Great Person!', gp.name + ' has appeared!');
}

export function useGreatPerson(gpEntry, gpDef) {
  if (gpEntry.used) return;
  gpEntry.used = true;
  switch (gpDef.effectType) {
    case 'instant_research':
      if (game.currentResearch) {
        const tdata = TECHNOLOGIES.find(t => t.id === game.currentResearch);
        if (tdata) {
          game.techs.push(game.currentResearch);
          addEvent(gpDef.icon + ' ' + gpDef.name + ' completed ' + tdata.name + '!', 'science');
          game.currentResearch = null;
          game.researchProgress = 0;
        }
      } else {
        game.science += 50;
        addEvent(gpDef.icon + ' ' + gpDef.name + ' granted +50 Science', 'science');
      }
      break;
    case 'instant_production':
      if (game.currentBuild) {
        const bd = BUILDINGS.find(b => b.id === game.currentBuild);
        if (bd) {
          game.buildings.push(game.currentBuild);
          const eff = bd.effect;
          if (eff.food) game.foodPerTurn += eff.food;
          if (eff.gold) game.goldPerTurn += eff.gold;
          if (eff.science) game.sciencePerTurn += eff.science;
          if (eff.military) game.military += eff.military;
          if (eff.defense) game.defense += eff.defense;
          if (eff.production) game.productionPerTurn += eff.production;
          if (eff.culture) game.culture += eff.culture;
          addEvent(gpDef.icon + ' ' + gpDef.name + ' completed ' + bd.name + '!', 'gold');
          game.currentBuild = null;
          game.buildProgress = 0;
        }
      } else if (game.currentWonderBuild) {
        const wd = WONDERS.find(w => w.id === game.currentWonderBuild);
        if (wd) {
          game.wonders.push(game.currentWonderBuild);
          const eff = wd.effect;
          if (eff.gold) game.goldPerTurn += eff.gold;
          if (eff.science) game.sciencePerTurn += eff.science;
          if (eff.production) game.productionPerTurn += eff.production;
          if (eff.culture) game.culture += eff.culture;
          // Apply special wonder effects
          if (eff.freeUnit) {
            const city = game.cities[0];
            if (city) {
              const neighbors = getHexNeighbors(city.col, city.row);
              for (const nb of neighbors) {
                const tile = game.map[nb.row][nb.col];
                if (!isTilePassable(tile)) continue;
                if (getUnitAt(nb.col, nb.row)) continue;
                const freeU = createUnit(eff.freeUnit, nb.col, nb.row, 'player');
                game.units.push(freeU);
                addEvent('Free ' + UNIT_TYPES[eff.freeUnit].name + ' from ' + wd.name + '!', 'gold');
                break;
              }
            }
          }
          if (eff.growthBonus) game.foodPerTurn += 2;
          if (eff.sightBonus) {
            for (const u of game.units) { if (u.owner === 'player') u.sightBonus = (u.sightBonus || 0) + eff.sightBonus; }
          }
          addEvent(gpDef.icon + ' ' + gpDef.name + ' completed ' + wd.name + '!', 'gold');
          game.currentWonderBuild = null;
          game.wonderBuildProgress = 0;
        }
      } else {
        game.productionPerTurn += 3;
        addEvent(gpDef.icon + ' ' + gpDef.name + ' boosted production +3', 'gold');
      }
      break;
    case 'gold_bonus':
      game.gold += 100;
      addEvent(gpDef.icon + ' ' + gpDef.name + ' granted +100 Gold!', 'gold');
      break;
    case 'combat_bonus':
      game.activeEvents.push({ type: 'combat_boost', name: 'Great General', bonus: 5, turnsLeft: 10 });
      addEvent(gpDef.icon + ' ' + gpDef.name + ': All units +5 combat for 10 turns!', 'combat');
      break;
    case 'found_religion':
      if (!game.religion) {
        game.religion = { name: 'The Faith', founded: game.turn };
        addEvent(gpDef.icon + ' ' + gpDef.name + ' founded a Religion!', 'gold');
      } else {
        game.culture += 30;
        addEvent(gpDef.icon + ' ' + gpDef.name + ' granted +30 Culture', 'gold');
      }
      break;
    case 'golden_age':
      game.culture += 50;
      game.activeEvents.push({ type: 'golden_age', name: 'Golden Age', turnsLeft: 5 });
      addEvent(gpDef.icon + ' ' + gpDef.name + ': +50 Culture, Golden Age for 5 turns!', 'gold');
      break;
  }
  updateUI();
}

// ============================================
// PANTHEON PICKER
// ============================================
export function showPantheonPicker() {
  if (game.pantheon) return;
  let overlay = document.getElementById('pantheon-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'pantheon-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:500;display:flex;align-items:center;justify-content:center';

  const box = document.createElement('div');
  box.style.cssText = 'background:#1a1a2e;border:2px solid #60a0ff;border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;color:#e0e0e0';
  box.innerHTML = '<h2 style="color:#60a0ff;margin:0 0 6px 0;font-size:18px">\u{1F54C} Choose a Pantheon</h2><p style="color:#888;font-size:12px;margin-bottom:16px">Your people seek divine guidance. Choose a pantheon belief that will guide your civilization.</p>';

  for (const p of PANTHEONS) {
    const btn = document.createElement('div');
    btn.style.cssText = 'padding:12px;margin-bottom:8px;background:rgba(96,160,255,0.06);border:1px solid rgba(96,160,255,0.2);border-radius:8px;cursor:pointer;transition:background 0.2s';
    btn.onmouseover = function() { this.style.background = 'rgba(96,160,255,0.15)'; };
    btn.onmouseout = function() { this.style.background = 'rgba(96,160,255,0.06)'; };
    btn.innerHTML = '<div style="font-size:14px;font-weight:600;color:#60a0ff;margin-bottom:4px">' + p.icon + ' ' + p.name + '</div><div style="font-size:12px;color:#aaa">' + p.desc + '</div>';
    btn.addEventListener('click', ((pid) => () => {
      game.pantheon = pid;
      const pd = PANTHEONS.find(x => x.id === pid);
      addEvent('\u{1F54C} Pantheon chosen: ' + pd.icon + ' ' + pd.name, 'gold');
      // Apply immediate effects
      if (pid === 'goddess_of_wisdom') game.sciencePerTurn += 2;
      overlay.remove();
      updateUI();
    })(p.id));
    box.appendChild(btn);
  }

  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
