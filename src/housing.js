import { MAP_COLS, MAP_ROWS } from './constants.js';
import { game } from './state.js';
import { hexDistance, getHexNeighbors } from './hex.js';

/**
 * Housing system — limits city population growth.
 *
 * Housing sources:
 *   City Center (base):       +2
 *   Adjacent to river:        +3
 *   Adjacent to lake/coast:   +1  (only if no river)
 *   Granary building:         +2
 *   Walls (any tier):         +1
 *   Garden building:          +1
 *   Each farm in territory:   +0.5
 *
 * Growth penalty (effectivePop = floor(population / 500)):
 *   Housing >= Pop + 1  → 100% growth
 *   Housing == Pop       → 50% growth
 *   Housing == Pop - 1   → 25% growth
 *   Housing <  Pop - 1   → 0% growth (stagnant)
 */

export function calculateCityHousing(city) {
  const sources = [];
  let housing = 2;
  sources.push({ label: 'City Center', value: 2 });

  // Check adjacent tiles (within 1 hex) for freshwater
  let hasRiver = false;
  let hasLakeOrCoast = false;
  const neighbors = getHexNeighbors(city.col, city.row);
  const tilesToCheck = [{ col: city.col, row: city.row }, ...neighbors];
  for (const nb of tilesToCheck) {
    const t = game.map[nb.row]?.[nb.col];
    if (!t) continue;
    if (t.hasRiver) hasRiver = true;
    if (t.base === 'lake' || t.base === 'coast') hasLakeOrCoast = true;
  }
  if (hasRiver) {
    housing += 3;
    sources.push({ label: 'River', value: 3 });
  } else if (hasLakeOrCoast) {
    housing += 1;
    sources.push({ label: 'Lake/Coast', value: 1 });
  }

  // Buildings (use global buildings list since buildings aren't per-city yet)
  const buildings = city.buildings || game.buildings || [];
  if (buildings.includes('granary')) {
    housing += 2;
    sources.push({ label: 'Granary', value: 2 });
  }
  if (buildings.includes('walls') || buildings.includes('fortress')) {
    housing += 1;
    sources.push({ label: 'Walls', value: 1 });
  }
  if (buildings.includes('garden')) {
    housing += 1;
    sources.push({ label: 'Garden', value: 1 });
  }

  // Farms in city territory
  const br = city.borderRadius || 2;
  let farmCount = 0;
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (hexDistance(c, r, city.col, city.row) <= br) {
        const tile = game.map[r][c];
        if (tile.improvement === 'farm') farmCount++;
      }
    }
  }
  if (farmCount > 0) {
    const farmHousing = farmCount * 0.5;
    housing += farmHousing;
    sources.push({ label: `Farms (${farmCount})`, value: farmHousing });
  }

  return { housing, sources };
}

export function getHousingGrowthModifier(housing, population) {
  const pop = Math.floor(population / 500);
  const diff = housing - pop;
  if (diff >= 1) return 1.0;
  if (diff === 0) return 0.5;
  if (diff === -1) return 0.25;
  return 0;
}
