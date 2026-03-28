import { MAP_COLS, MAP_ROWS, BASE_TERRAIN, TERRAIN_FEATURES, RESOURCES, TECHNOLOGIES, NATURAL_WONDERS, FACTIONS, FACTION_TRAITS, GOVERNMENTS, WONDERS } from './constants.js';
import { game } from './state.js';
import { hexDistance, getHexNeighbors } from './hex.js';
import { simplex } from './utils.js';
import { getImprovementYields } from './improvements.js';
import { getModYieldBonus } from './diplomacy-api.js';
import { addEvent } from './events.js';
import { countPlayerTerritory } from './events.js';

// ============================================
// MAP GENERATION
// ============================================

function generateMap() {
  const map = [];
  const seed = Math.random() * 1000;

  // ────────────────────────────────────────────────
  // HELPER: hex neighbors for map-gen (works before map array exists)
  // ────────────────────────────────────────────────
  function mgNeighbors(col, row) {
    const even = (row & 1) === 0;
    const dirs = even
      ? [[-1,-1],[0,-1],[-1,0],[1,0],[-1,1],[0,1]]
      : [[0,-1],[1,-1],[-1,0],[1,0],[0,1],[1,1]];
    const out = [];
    for (const [dc, dr] of dirs) {
      const nc = ((col + dc) % MAP_COLS + MAP_COLS) % MAP_COLS;
      const nr = row + dr;
      if (nr >= 0 && nr < MAP_ROWS) out.push({ col: nc, row: nr });
    }
    return out;
  }

  // ════════════════════════════════════════════════
  // PASS 1: TECTONIC PLATES (FreeCiv FRACTURE)
  // ════════════════════════════════════════════════
  const NUM_PLATES = 8 + Math.floor(Math.random() * 5); // 8-12
  const plateId   = Array.from({ length: MAP_ROWS }, () => new Int8Array(MAP_COLS).fill(-1));
  const plateBase = []; // base height per plate

  // Seed points
  const queue = [];
  for (let p = 0; p < NUM_PLATES; p++) {
    const sc = Math.floor(Math.random() * MAP_COLS);
    const sr = Math.floor(Math.random() * MAP_ROWS);
    plateId[sr][sc] = p;
    // ~82% continental plates (high), ~18% oceanic (low) — targets ~75% land for Pangaea-style map
    const isContinental = Math.random() < 0.82;
    plateBase.push(isContinental ? (0.44 + Math.random() * 0.22) : (0.08 + Math.random() * 0.18));
    queue.push({ col: sc, row: sr, plate: p });
  }

  // BFS flood fill – assign every tile to nearest plate
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    for (const nb of mgNeighbors(cur.col, cur.row)) {
      if (plateId[nb.row][nb.col] === -1) {
        plateId[nb.row][nb.col] = cur.plate;
        queue.push({ col: nb.col, row: nb.row, plate: cur.plate });
      }
    }
  }

  // Height map from plates + boundary ridges
  const height = Array.from({ length: MAP_ROWS }, () => new Float64Array(MAP_COLS));
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const pid = plateId[r][c];
      height[r][c] = plateBase[pid];
      // Boundary detection — if any neighbor belongs to a different plate, boost height
      for (const nb of mgNeighbors(c, r)) {
        if (plateId[nb.row][nb.col] !== pid) {
          // Mountain ridge at plate boundaries — reduced for fewer mountains
          height[r][c] += 0.15;
          break;
        }
      }
    }
  }

  // ════════════════════════════════════════════════
  // PASS 2: SMOOTH + NOISE
  // ════════════════════════════════════════════════
  // Two-pass box blur (approximates Gaussian)
  for (let pass = 0; pass < 2; pass++) {
    const tmp = Array.from({ length: MAP_ROWS }, () => new Float64Array(MAP_COLS));
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        let sum = height[r][c], cnt = 1;
        for (const nb of mgNeighbors(c, r)) {
          sum += height[nb.row][nb.col];
          cnt++;
        }
        tmp[r][c] = sum / cnt;
      }
    }
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) height[r][c] = tmp[r][c];
    }
  }

  // Add simplex noise for local variation
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const nx = c / MAP_COLS * 6;
      const ny = r / MAP_ROWS * 6;
      height[r][c] += simplex(nx + seed, ny + seed) * 0.12;
      height[r][c] += simplex(nx * 3 + seed + 77, ny * 3 + seed + 77) * 0.05;
    }
  }

  // Polar depression — push top/bottom rows toward ocean
  for (let r = 0; r < MAP_ROWS; r++) {
    const distFromEdge = Math.min(r, MAP_ROWS - 1 - r);
    if (distFromEdge < 2) {
      const factor = 0.5 + 0.5 * (distFromEdge / 2);
      for (let c = 0; c < MAP_COLS; c++) height[r][c] *= factor;
    }
  }

  // ════════════════════════════════════════════════
  // PASS 3: TEMPERATURE MAP (latitude-based)
  // ════════════════════════════════════════════════
  const temperature = Array.from({ length: MAP_ROWS }, () => new Float64Array(MAP_COLS));
  const equator = MAP_ROWS / 2;
  for (let r = 0; r < MAP_ROWS; r++) {
    const latFactor = 1.0 - Math.abs(r - equator) / equator; // 0 at poles, 1 at equator
    for (let c = 0; c < MAP_COLS; c++) {
      temperature[r][c] = latFactor;
      // High elevation reduces temperature
      if (height[r][c] > 0.5) temperature[r][c] -= (height[r][c] - 0.5) * 0.8;
      // Small noise variation
      temperature[r][c] += simplex(c / MAP_COLS * 4 + seed + 200, r / MAP_ROWS * 4 + seed + 200) * 0.08;
      temperature[r][c] = Math.max(0, Math.min(1, temperature[r][c]));
    }
  }

  // ════════════════════════════════════════════════
  // PASS 4: MOISTURE MAP
  // ════════════════════════════════════════════════
  const SEA_LEVEL = 0.38;
  const moisture = Array.from({ length: MAP_ROWS }, () => new Float64Array(MAP_COLS));

  // Base moisture from simplex noise
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const nx = c / MAP_COLS * 5;
      const ny = r / MAP_ROWS * 5;
      moisture[r][c] = 0.5 + simplex(nx + seed + 300, ny + seed + 300) * 0.35;
    }
  }

  // Ocean proximity bonus (BFS from ocean tiles)
  const oceanDist = Array.from({ length: MAP_ROWS }, () => new Int16Array(MAP_COLS).fill(9999));
  const odQueue = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (height[r][c] < SEA_LEVEL) {
        oceanDist[r][c] = 0;
        odQueue.push({ col: c, row: r });
      }
    }
  }
  qi = 0;
  while (qi < odQueue.length) {
    const cur = odQueue[qi++];
    const nd = oceanDist[cur.row][cur.col] + 1;
    if (nd > 8) continue;
    for (const nb of mgNeighbors(cur.col, cur.row)) {
      if (nd < oceanDist[nb.row][nb.col]) {
        oceanDist[nb.row][nb.col] = nd;
        odQueue.push(nb);
      }
    }
  }
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (oceanDist[r][c] < 9999) {
        moisture[r][c] += Math.max(0, (6 - oceanDist[r][c]) * 0.06);
      }
    }
  }

  // Rain shadow: eastward prevailing winds — tiles east of mountains get less moisture
  for (let r = 0; r < MAP_ROWS; r++) {
    let shadow = 0;
    for (let c = 0; c < MAP_COLS; c++) {
      if (height[r][c] > 0.68) shadow = 4; // mountain creates shadow
      else if (height[r][c] > 0.48) shadow = Math.max(shadow, 2);
      if (shadow > 0) {
        moisture[r][c] -= shadow * 0.05;
        shadow--;
      }
    }
  }

  // Clamp moisture
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      moisture[r][c] = Math.max(0, Math.min(1, moisture[r][c]));
    }
  }

  // ════════════════════════════════════════════════
  // PASS 5: TERRAIN ASSIGNMENT (FreeCiv rules)
  // ════════════════════════════════════════════════
  for (let r = 0; r < MAP_ROWS; r++) {
    const row = [];
    for (let c = 0; c < MAP_COLS; c++) {
      const h = height[r][c];
      const t = temperature[r][c];
      const m = moisture[r][c];
      let base, feature = null;

      if (h < SEA_LEVEL - 0.1) {
        base = 'ocean';
      } else if (h < SEA_LEVEL) {
        base = 'coast';
      } else {
        // Land tile — assign biome from temperature + moisture
        const frozen = t < 0.1;
        const cold   = t < 0.25;
        const hot    = t > 0.7;
        const dry    = m < 0.35;
        const wet    = m > 0.55;
        const vwet   = m > 0.7;
        const vdry   = m < 0.2;

        if (frozen) {
          base = dry ? 'snow' : 'tundra';
        } else if (cold) {
          base = dry ? 'tundra' : 'plains';
        } else if (hot && vdry) {
          base = 'desert'; // only very dry + hot = desert (reduces desert sprawl)
        } else if (hot) {
          base = dry ? 'plains' : 'grassland'; // hot+moderate = plains not desert
        } else {
          // Temperate — bias toward plains for larger open areas
          base = dry ? 'plains' : (wet ? 'grassland' : (Math.random() < 0.6 ? 'plains' : 'grassland'));
        }

        // Features from elevation and moisture — stricter thresholds for fewer mountains
        if (h > 0.75) {
          feature = 'mountain';
          base = 'plains'; // mountains always show as plains underneath
        } else if (h > 0.58) {
          feature = 'hills';
        } else if (!frozen) {
          if (hot && vwet && base === 'grassland' && Math.random() < 0.4) {
            feature = 'rainforest';
          } else if (wet && !hot && !dry && h < 0.6 && Math.random() < 0.5) {
            feature = 'woods';
          } else if (cold && wet && Math.random() < 0.55) {
            feature = 'woods';
          } else if (base === 'grassland' && h < 0.4 && m > 0.6 && Math.random() < 0.15) {
            feature = 'marsh';
          } else if (base === 'desert' && h < 0.42 && oceanDist[r][c] < 4 && Math.random() < 0.25) {
            feature = 'floodplains';
          }
        }
      }

      row.push({
        base, feature, resource: null,
        improvement: null, improvementProgress: 0, improvementBuilder: null,
        road: false, elevation: h, hasRiver: false, riverEdges: [], col: c, row: r,
        naturalWonder: null
      });
    }
    map.push(row);
  }


  // ════════════════════════════════════════════════
  // PASS 5b: LAKE GENERATION
  // ════════════════════════════════════════════════
  // Lakes form in inland low-elevation depressions to break up the Pangaea landmass
  const NUM_LAKES = 5 + Math.floor(Math.random() * 4); // 5-8 lakes
  const lakeTiles = new Set();

  for (let li = 0; li < NUM_LAKES; li++) {
    let bestCol = -1, bestRow = -1, bestScore = -1;
    for (let att = 0; att < 100; att++) {
      const rc = 4 + Math.floor(Math.random() * (MAP_COLS - 8));
      const rr = 4 + Math.floor(Math.random() * (MAP_ROWS - 8));
      const tile = map[rr][rc];
      if (tile.base === 'ocean' || tile.base === 'coast' || tile.base === 'lake') continue;
      if (tile.feature === 'mountain') continue;
      if (lakeTiles.has(rr * MAP_COLS + rc)) continue;
      const od = Math.min(oceanDist[rr][rc], 10);
      if (od < 3) continue;
      const score = od * 2 + (1 - height[rr][rc]) * 5 + moisture[rr][rc] * 3 + Math.random() * 2;
      if (score > bestScore) { bestScore = score; bestCol = rc; bestRow = rr; }
    }
    if (bestCol < 0) continue;

    const lakeSize = 2 + Math.floor(Math.random() * 5); // 2-6 tiles
    const lakeQueue = [{ col: bestCol, row: bestRow }];
    const lakeVisited = new Set();
    lakeVisited.add(bestRow * MAP_COLS + bestCol);
    const lakeCells = [{ col: bestCol, row: bestRow }];

    while (lakeCells.length < lakeSize && lakeQueue.length > 0) {
      let bestNb = null, bestH = 999;
      for (const cell of lakeQueue) {
        for (const nb of mgNeighbors(cell.col, cell.row)) {
          const key = nb.row * MAP_COLS + nb.col;
          if (lakeVisited.has(key) || lakeTiles.has(key)) continue;
          const nbTile = map[nb.row][nb.col];
          if (nbTile.base === 'ocean' || nbTile.base === 'coast' || nbTile.base === 'lake' || nbTile.feature === 'mountain') continue;
          if (height[nb.row][nb.col] < bestH) { bestH = height[nb.row][nb.col]; bestNb = nb; }
        }
      }
      if (!bestNb) break;
      lakeVisited.add(bestNb.row * MAP_COLS + bestNb.col);
      lakeCells.push(bestNb);
      lakeQueue.push(bestNb);
    }

    for (const cell of lakeCells) {
      map[cell.row][cell.col].base = 'lake';
      map[cell.row][cell.col].feature = null;
      map[cell.row][cell.col].resource = null;
      lakeTiles.add(cell.row * MAP_COLS + cell.col);
    }
  }

  // ════════════════════════════════════════════════
  // PASS 5c: MOUNTAIN PASS GENERATION
  // ════════════════════════════════════════════════
  // Prevent landlocked areas surrounded by mountains — BFS from edges/ocean,
  // then carve passes (mountain→hills) to connect isolated pockets.
  {
    const reachable = Array.from({ length: MAP_ROWS }, () => new Uint8Array(MAP_COLS));
    const passQueue = [];
    // Seed: edge tiles + ocean/coast tiles that aren't mountains
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const tile = map[r][c];
        const isEdge = (r === 0 || r === MAP_ROWS - 1 || c === 0 || c === MAP_COLS - 1);
        const isWater = (tile.base === 'ocean' || tile.base === 'coast');
        if ((isEdge || isWater) && tile.feature !== 'mountain') {
          reachable[r][c] = 1;
          passQueue.push({ col: c, row: r });
        }
      }
    }
    // BFS through non-mountain tiles
    let pqi = 0;
    while (pqi < passQueue.length) {
      const cur = passQueue[pqi++];
      for (const nb of mgNeighbors(cur.col, cur.row)) {
        if (reachable[nb.row][nb.col]) continue;
        if (map[nb.row][nb.col].feature === 'mountain') continue;
        reachable[nb.row][nb.col] = 1;
        passQueue.push(nb);
      }
    }
    // Carve passes for unreachable land
    for (let r = 1; r < MAP_ROWS - 1; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const tile = map[r][c];
        if (reachable[r][c] || tile.feature === 'mountain' || tile.base === 'ocean' || tile.base === 'coast') continue;
        // Unreachable land — find a mountain neighbor that borders reachable territory
        for (const nb of mgNeighbors(c, r)) {
          if (map[nb.row][nb.col].feature !== 'mountain') continue;
          const mnbs = mgNeighbors(nb.col, nb.row);
          if (mnbs.some(m => reachable[m.row][m.col])) {
            // Carve pass: mountain → hills
            map[nb.row][nb.col].feature = 'hills';
            height[nb.row][nb.col] = Math.min(height[nb.row][nb.col], 0.56);
            reachable[nb.row][nb.col] = 1;
            reachable[r][c] = 1;
            // BFS to mark newly reachable area
            const pq2 = [{ col: nb.col, row: nb.row }, { col: c, row: r }];
            let pq2i = 0;
            while (pq2i < pq2.length) {
              const p = pq2[pq2i++];
              for (const pn of mgNeighbors(p.col, p.row)) {
                if (reachable[pn.row][pn.col] || map[pn.row][pn.col].feature === 'mountain') continue;
                reachable[pn.row][pn.col] = 1;
                pq2.push(pn);
              }
            }
            break;
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════
  // PASS 6: RIVER GENERATION (center-line tracing with water-seeking pull)
  // ════════════════════════════════════════════════
  // Rivers trace paths through tile centers using a water-seeking algorithm,
  // then derive edge data for movement/combat mechanics.
  // River paths are stored in game.riverPaths for bezier curve rendering.

  const EVEN_DIRS = [[-1,-1],[0,-1],[-1,0],[1,0],[-1,1],[0,1]];
  const ODD_DIRS  = [[0,-1],[1,-1],[-1,0],[1,0],[0,1],[1,1]];

  function findNeighborDir(fromCol, fromRow, toCol, toRow) {
    const dirs = (fromRow & 1) === 0 ? EVEN_DIRS : ODD_DIRS;
    for (let d = 0; d < 6; d++) {
      const nc = ((fromCol + dirs[d][0]) % MAP_COLS + MAP_COLS) % MAP_COLS;
      const nr = fromRow + dirs[d][1];
      if (nc === toCol && nr === toRow) return d;
    }
    return -1;
  }

  // Seeded random for reproducible rivers
  let _riverSeed = Math.random() * 999999;
  function riverRand() {
    _riverSeed = (_riverSeed * 16807 + 0) % 2147483647;
    return (_riverSeed & 0x7fffffff) / 0x7fffffff;
  }

  function traceRiver(startC, startR, existingTiles) {
    const path = [{ c: startC, r: startR }];
    const visited = new Set([`${startC},${startR}`]);
    let c = startC, r = startR;

    // Find nearest ocean/coast for a gentle directional pull
    let nearWC = MAP_COLS / 2, nearWR = MAP_ROWS - 1, nearWD = Infinity;
    for (let rr = 0; rr < MAP_ROWS; rr++) {
      for (let cc = 0; cc < MAP_COLS; cc++) {
        const t = map[rr][cc];
        if (t && ['ocean', 'coast'].includes(t.base)) {
          const d = Math.sqrt((cc - startC) ** 2 + (rr - startR) ** 2);
          if (d < nearWD) { nearWD = d; nearWC = cc; nearWR = rr; }
        }
      }
    }

    for (let step = 0; step < 60; step++) {
      const cur = map[r] && map[r][c];
      if (!cur) break;
      if (step > 0 && ['ocean', 'coast', 'lake'].includes(cur.base)) break;

      const nb = mgNeighbors(c, r);
      let cands = [];

      const distToWater = Math.sqrt((nearWC - c) ** 2 + (nearWR - r) ** 2) || 1;
      const pullStrength = 0.04 + step * 0.004;

      for (const n of nb) {
        const nt = map[n.row] && map[n.row][n.col];
        if (!nt) continue;
        if (visited.has(`${n.col},${n.row}`)) continue;

        let score = -nt.elevation * 0.7; // downhill preference
        if (['ocean', 'coast'].includes(nt.base)) score += 2.5;
        if (nt.base === 'lake') score += 1.8;
        if (existingTiles.has(`${n.col},${n.row}`)) score -= 0.2;

        // Gentle pull toward nearest water
        const nDistToWater = Math.sqrt((nearWC - n.col) ** 2 + (nearWR - n.row) ** 2);
        score += (distToWater - nDistToWater) * pullStrength;

        // Randomness for meandering
        score += (riverRand() - 0.5) * 0.28;

        cands.push({ col: n.col, row: n.row, score, tile: nt });
      }
      if (!cands.length) break;
      cands.sort((a, b) => b.score - a.score);

      // 20% chance to pick second-best — creates bends
      const pick = (cands.length > 1 && riverRand() < 0.20) ? cands[1] : cands[0];
      c = pick.col; r = pick.row;
      path.push({ c, r });
      visited.add(`${c},${r}`);
      if (['ocean', 'coast', 'lake'].includes(pick.tile.base)) break;
    }
    return path;
  }

  // Collect river source candidates and select with spacing
  const riverSourceCandidates = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const t = map[r][c];
      if (t.feature === 'mountain') {
        riverSourceCandidates.push({ c, r, priority: t.elevation + riverRand() * 0.05 });
      } else if (t.feature === 'hills' && t.elevation > 0.5) {
        riverSourceCandidates.push({ c, r, priority: t.elevation + riverRand() * 0.03 });
      }
    }
  }
  riverSourceCandidates.sort((a, b) => b.priority - a.priority);

  const NUM_RIVERS = 6;
  const MIN_RIVER_DIST = 10;
  const selectedSources = [];
  for (const src of riverSourceCandidates) {
    if (selectedSources.length >= NUM_RIVERS) break;
    const tooClose = selectedSources.some(s => {
      const dx = s.c - src.c, dy = s.r - src.r;
      return Math.sqrt(dx * dx + dy * dy) < MIN_RIVER_DIST;
    });
    if (!tooClose) selectedSources.push(src);
  }

  const riverTiles = new Set();
  const riverPaths = []; // stored for bezier rendering

  for (const src of selectedSources) {
    const path = traceRiver(src.c, src.r, riverTiles);
    if (path.length < 3) continue;

    // Store path for rendering
    riverPaths.push(path);

    // Mark tiles and derive edge data for movement/combat
    for (let j = 0; j < path.length; j++) {
      const seg = path[j];
      const tile = map[seg.r] && map[seg.r][seg.c];
      if (!tile) continue;

      tile.hasRiver = true;
      tile.riverProgress = j / (path.length - 1);
      riverTiles.add(`${seg.c},${seg.r}`);

      // Derive riverEdges from consecutive path tiles
      if (j < path.length - 1) {
        const next = path[j + 1];
        const dirAB = findNeighborDir(seg.c, seg.r, next.c, next.r);
        if (dirAB >= 0) {
          if (!tile.riverEdges.includes(dirAB)) tile.riverEdges.push(dirAB);
          const nextTile = map[next.r] && map[next.r][next.c];
          if (nextTile) {
            const dirBA = (dirAB + 3) % 6;
            if (!nextTile.riverEdges.includes(dirBA)) nextTile.riverEdges.push(dirBA);
            nextTile.hasRiver = true;
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════
  // PASS 7: RESOURCE PLACEMENT (with spacing)
  // ════════════════════════════════════════════════
  const resourceAt = Array.from({ length: MAP_ROWS }, () => new Int8Array(MAP_COLS));

  function canPlaceResource(c, r) {
    // Ensure at least 2 tiles between resources
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const nr = r + dr, nc = ((c + dc) % MAP_COLS + MAP_COLS) % MAP_COLS;
        if (nr >= 0 && nr < MAP_ROWS && resourceAt[nr][nc]) return false;
      }
    }
    return true;
  }

  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const tile = map[r][c];
      if (tile.feature === 'mountain') continue;
      if (!canPlaceResource(c, r)) continue;

      const rng = Math.random();

      if (tile.base === 'ocean' && rng < 0.05) {
        tile.resource = 'fish';
        resourceAt[r][c] = 1;
      } else if (tile.base === 'coast' && rng < 0.07) {
        tile.resource = 'fish';
        resourceAt[r][c] = 1;
      } else if (tile.base !== 'ocean' && tile.base !== 'coast' && rng < 0.10) {
        const terrainResources = {
          plains:    ['wheat', 'horses', 'copper', 'iron', 'cotton', 'wine', 'salt'],
          grassland: ['wheat', 'horses', 'gems', 'dyes', 'ivory', 'jade'],
          desert:    ['gold_ore', 'gems', 'spices', 'copper', 'incense', 'salt', 'obsidian'],
          tundra:    ['iron', 'stone', 'gems', 'furs', 'marble'],
          snow:      ['iron'],
        };
        const opts = terrainResources[tile.base] || ['stone'];
        tile.resource = opts[Math.floor(Math.random() * opts.length)];

        if (tile.feature === 'woods' || tile.feature === 'rainforest') {
          tile.resource = ['spices', 'silk', 'iron', 'dyes', 'furs', 'ivory'][Math.floor(Math.random() * 6)];
        }
        if (tile.feature === 'hills') {
          tile.resource = ['iron', 'stone', 'gold_ore', 'copper', 'marble', 'obsidian', 'jade'][Math.floor(Math.random() * 7)];
        }
        resourceAt[r][c] = 1;
      }
    }
  }

  // ════════════════════════════════════════════════
  // Natural wonder placement (same logic as before)
  // ════════════════════════════════════════════════
  const placedNW = [];
  for (const nw of NATURAL_WONDERS) {
    if (placedNW.length >= 3) break;
    for (let attempt = 0; attempt < 120; attempt++) {
      const r = Math.floor(Math.random() * MAP_ROWS);
      const c = Math.floor(Math.random() * MAP_COLS);
      const t = map[r][c];
      if (!nw.terrain.includes(t.base)) continue;
      if (nw.feature && t.feature !== nw.feature) continue;
      if (!nw.feature && t.feature === 'mountain') continue;
      let tooClose = false;
      for (const prev of placedNW) {
        if (hexDistance(c, r, prev.col, prev.row) < 8) { tooClose = true; break; }
      }
      if (tooClose) continue;
      t.naturalWonder = nw.id;
      t.resource = null;
      placedNW.push({ col: c, row: r, id: nw.id });
      break;
    }
  }

  return { map, riverPaths };
}

// ============================================
// TRIBAL VILLAGE PLACEMENT
// ============================================
function placeTribalVillages(map, startPositions) {
  const villages = [];
  const count = 8 + Math.floor(Math.random() * 5); // 8-12 villages

  for (let attempt = 0; attempt < 500 && villages.length < count; attempt++) {
    const r = Math.floor(Math.random() * MAP_ROWS);
    const c = Math.floor(Math.random() * MAP_COLS);
    const tile = map[r][c];

    // Must be passable land
    const bInfo = BASE_TERRAIN[tile.base];
    if (!bInfo || !bInfo.movable) continue;
    if (tile.feature === 'mountain') continue;

    // No resource or natural wonder on this tile
    if (tile.resource || tile.naturalWonder) continue;

    // Minimum 6 hexes from any start position
    let tooCloseToStart = false;
    for (const sp of startPositions) {
      if (hexDistance(c, r, sp.col, sp.row) < 6) { tooCloseToStart = true; break; }
    }
    if (tooCloseToStart) continue;

    // Minimum 4 hexes from other villages
    let tooCloseToVillage = false;
    for (const v of villages) {
      if (hexDistance(c, r, v.col, v.row) < 4) { tooCloseToVillage = true; break; }
    }
    if (tooCloseToVillage) continue;

    villages.push({ col: c, row: r, discovered: false });
  }

  return villages;
}

// ============================================
// TERRAIN HELPERS
// ============================================
/**
 * Check whether a resource is revealed for the player (or a given revealed set).
 * Non-strategic resources (bonus, luxury) are always visible.
 * Strategic resources must be in game.revealedResources (or the supplied array).
 */
function isResourceRevealed(resourceId, revealedList) {
  const res = RESOURCES[resourceId];
  if (!res || res.category !== 'strategic') return true;
  if (!res.revealedBy) return true;
  const revealed = revealedList || (game && game.revealedResources) || [];
  return revealed.includes(resourceId);
}

function getTileYields(tile) {
  const bInfo = BASE_TERRAIN[tile.base];
  if (!bInfo) return { food: 0, prod: 0, gold: 0 };
  let food = bInfo.food, prod = bInfo.prod, gold = bInfo.gold;
  if (tile.feature && TERRAIN_FEATURES[tile.feature]) {
    const fInfo = TERRAIN_FEATURES[tile.feature];
    food += fInfo.food;
    prod += fInfo.prod;
    gold += fInfo.gold;
  }
  if (tile.hasRiver && tile.base !== 'ocean' && tile.base !== 'coast') {
    gold += 1; // Rivers add +1 gold in Civ 6
  }
  if (tile.resource && RESOURCES[tile.resource] && isResourceRevealed(tile.resource)) {
    const bonus = RESOURCES[tile.resource].bonus;
    if (bonus.food) food += bonus.food;
    if (bonus.prod) prod += bonus.prod;
    if (bonus.gold) gold += bonus.gold;
  }
  // Apply tile improvement yields
  const impYields = getImprovementYields(tile);
  food += impYields.food;
  prod += impYields.prod;
  gold += impYields.gold;

  // Apply mod yield bonuses from diplomatic agreements, including synonyms
  if (game && game.yieldBonuses) {
    const modBonus = getModYieldBonus(tile);
    const sumBonuses = (total, key) => total + (modBonus[key] || 0);
    food += ['food', 'crop', 'fruit', 'grain', 'harvest'].reduce(sumBonuses, 0);
    prod += ['prod', 'produce', 'product', 'production'].reduce(sumBonuses, 0);
    gold += ['gold'].reduce(sumBonuses, 0);
  }
  return { food, prod, gold };
}

function getTileMoveCost(tile) {
  // Roads halve movement cost (min 0.5)
  if (tile.road) {
    const baseCost = getTileBaseMoveCost(tile);
    return Math.max(0.5, baseCost * 0.5);
  }
  return getTileBaseMoveCost(tile);
}

function getTileBaseMoveCost(tile) {
  if (tile.feature === 'mountain') return 99; // impassable
  const bInfo = BASE_TERRAIN[tile.base];
  if (!bInfo || !bInfo.movable) return 99;
  let cost = bInfo.moveCost; // flat terrain = 1
  if (tile.feature && TERRAIN_FEATURES[tile.feature]) {
    const fCost = TERRAIN_FEATURES[tile.feature].moveCost;
    // Rough terrain costs: hills=2, woods=2, rainforest=2, marsh=2
    // Stacking: hills + woods/rainforest = 3 (very slow)
    cost = Math.max(cost, fCost);
    if (tile.feature === 'hills') {
      // Check for woods/rainforest on hills
      // In Civ, forested hills cost ALL movement
      cost = 2;
    }
  }
  return cost;
}

function isTilePassable(tile) {
  if (!tile || !BASE_TERRAIN[tile.base]) return false;
  if (tile.feature === 'mountain') return false;
  return BASE_TERRAIN[tile.base].movable;
}

// ────────────────────────────────────────────────
// RIVER CROSSING DETECTION (Civ-style edge rivers)
// ────────────────────────────────────────────────
// Direction arrays — must match getHexNeighbors / mgNeighbors order:
//   0=top-left, 1=top-right, 2=left, 3=right, 4=bottom-left, 5=bottom-right
const CROSS_EVEN_DIRS = [[-1,-1],[0,-1],[-1,0],[1,0],[-1,1],[0,1]];
const CROSS_ODD_DIRS  = [[0,-1],[1,-1],[-1,0],[1,0],[0,1],[1,1]];

/**
 * Returns the hex direction index (0-5) from (c1,r1) to adjacent (c2,r2).
 * Returns -1 if they are not neighbors.
 */
function getHexDirection(c1, r1, c2, r2) {
  const dirs = (r1 & 1) === 0 ? CROSS_EVEN_DIRS : CROSS_ODD_DIRS;
  for (let d = 0; d < 6; d++) {
    const nc = ((c1 + dirs[d][0]) % MAP_COLS + MAP_COLS) % MAP_COLS;
    const nr = ((r1 + dirs[d][1]) % MAP_ROWS + MAP_ROWS) % MAP_ROWS;
    if (nc === c2 && nr === r2) return d;
  }
  return -1;
}

/**
 * Returns true if moving from (fromCol,fromRow) to (toCol,toRow) crosses a river edge.
 * Both tiles must be valid and the 'from' tile must have a riverEdge in the direction of 'to'.
 */
function crossesRiver(fromCol, fromRow, toCol, toRow) {
  if (!game || !game.map) return false;
  const fromTile = game.map[fromRow] && game.map[fromRow][fromCol];
  if (!fromTile || !fromTile.hasRiver) return false;

  const d = getHexDirection(fromCol, fromRow, toCol, toRow);
  if (d < 0) return false;
  return fromTile.riverEdges.includes(d);
}

/** Alias for crossesRiver — checks if a river edge exists between two adjacent hexes. */
const hasRiverBetween = crossesRiver;

/**
 * Returns true if roads negate the river crossing penalty (road on both sides).
 */
function roadBridgesRiver(fromCol, fromRow, toCol, toRow) {
  if (!game || !game.map) return false;
  const fromTile = game.map[fromRow] && game.map[fromRow][fromCol];
  const toTile = game.map[toRow] && game.map[toRow][toCol];
  return fromTile && toTile && fromTile.road && toTile.road;
}

/** Alias for roadBridgesRiver — checks if roads bridge a river between two hexes. */
const hasRoadBridge = roadBridgesRiver;

function getTileName(tile) {
  const bt = BASE_TERRAIN[tile.base];
  const bName = bt ? bt.name : tile.base;
  if (tile.feature === 'mountain') return 'Mountain';
  if (tile.feature && TERRAIN_FEATURES[tile.feature]) {
    return `${bName} (${TERRAIN_FEATURES[tile.feature].name})`;
  }
  return bName;
}

// ============================================
// FACTION STATS
// ============================================

// Personality-driven starting stats per faction — single source of truth
const FACTION_DEFAULT_STATS = {
  emperor_valerian:          { gold: 60,  military: 18, science: 4, population: 1200, territory: 12, techs: 2, score: 40 },
  shadow_kael:               { gold: 45,  military: 12, science: 5, population: 900,  territory: 8,  techs: 3, score: 35 },
  merchant_prince_castellan: { gold: 80,  military: 8,  science: 3, population: 1100, territory: 10, techs: 2, score: 38 },
  pirate_queen_elara:        { gold: 55,  military: 15, science: 2, population: 800,  territory: 6,  techs: 1, score: 30 },
  commander_thane:           { gold: 40,  military: 22, science: 3, population: 1000, territory: 14, techs: 2, score: 42 },
  rebel_leader_sera:         { gold: 35,  military: 10, science: 4, population: 700,  territory: 5,  techs: 2, score: 28 },
};
const FACTION_DEFAULT_STATS_FALLBACK = { gold: 50, military: 10, science: 3, population: 1000, territory: 8, techs: 2, score: 30 };

function getDefaultFactionStats(factionId, turn = 1) {
  const p = FACTION_DEFAULT_STATS[factionId] || FACTION_DEFAULT_STATS_FALLBACK;
  return { ...p, lastUpdated: turn };
}

function initFactionStats(factionId) {
  if (!game.factionStats) game.factionStats = {};
  game.factionStats[factionId] = getDefaultFactionStats(factionId, game.turn);
}

function updateFactionStats() {
  if (!game.factionStats) game.factionStats = {};
  for (const [fid, stats] of Object.entries(game.factionStats)) {
    const traits = FACTION_TRAITS[fid] || { expansion:0.5, military:0.5, culture:0.5, science:0.5, diplomacy:0.5 };
    const gm = 0.8 + Math.random() * 0.4;
    stats.gold += Math.floor((4 + traits.diplomacy * 6) * gm);
    stats.military += Math.floor(traits.military * 3 * gm);
    stats.population += Math.floor((30 + traits.expansion * 40) * gm);
    stats.territory = Math.min(40, stats.territory + (Math.random() < 0.05 + traits.expansion * 0.1 ? 1 : 0));
    if (Math.random() < 0.03 + traits.science * 0.1) stats.techs++;
    stats.score = Math.floor(stats.gold * 0.1 + stats.military * 2 + stats.population * 0.01 + stats.techs * 10 + stats.territory * 3);
    if (Math.random() < 0.05) { stats.military = Math.max(5, stats.military - 3); stats.gold = Math.max(0, stats.gold - 15); }
    stats.lastUpdated = game.turn;

    // AI government adoption based on archetype
    if (!stats.government && game.turn >= 8) {
      const archTraits = FACTION_TRAITS[fid] || {};
      if (archTraits.military >= 0.7) stats.government = 'despotism';
      else if (archTraits.culture >= 0.7) stats.government = 'classical_republic';
      else if (archTraits.diplomacy >= 0.7) stats.government = 'oligarchy';
      else stats.government = ['despotism', 'classical_republic', 'oligarchy'][Math.floor(Math.random() * 3)];
    }
    // AI government bonuses applied to stats
    if (stats.government) {
      const gov = GOVERNMENTS[stats.government];
      if (gov && gov.bonuses) {
        if (gov.bonuses.scienceBonus) stats.techs += Math.random() < gov.bonuses.scienceBonus ? 1 : 0;
        if (gov.bonuses.foodBonus) stats.population += Math.floor(10 * gov.bonuses.foodBonus);
      }
    }
    // AI resource visibility — auto-reveal strategic resources as tech count grows
    if (!game.factionRevealedResources) game.factionRevealedResources = {};
    if (!game.factionRevealedResources[fid]) game.factionRevealedResources[fid] = [];
    const fRevealed = game.factionRevealedResources[fid];
    for (const [resId, res] of Object.entries(RESOURCES)) {
      if (res.revealedBy && !fRevealed.includes(resId)) {
        // Reveal when faction has enough techs (roughly matching when a player would get the tech)
        const techIndex = TECHNOLOGIES.findIndex(t => t.id === res.revealedBy);
        if (techIndex >= 0 && stats.techs > techIndex) {
          fRevealed.push(resId);
        }
      }
    }

    // AI wonder construction — chance to claim an unclaimed wonder
    if (game.turn >= 15 && Math.random() < 0.02) {
      if (!game.aiWonders) game.aiWonders = {};
      const available = WONDERS.filter(w => !game.completedWonders?.includes(w.id) && !game.aiWonders[w.id]);
      if (available.length > 0) {
        const pick = available[Math.floor(Math.random() * available.length)];
        game.aiWonders[pick.id] = fid;
        if (game.metFactions && game.metFactions[fid]) {
          addEvent('\u{1F3DB} ' + (FACTIONS[fid]?.name || fid) + ' has completed ' + pick.name + '!', 'world');
        }
      }
    }

  }
}

function getPlayerStats() {
  return {
    gold: game.gold,
    military: game.military,
    population: game.population,
    territory: countPlayerTerritory(),
    techs: game.techs.length,
    science: game.sciencePerTurn,
    score: game.score,
    units: game.units.filter(u => u.owner === 'player').length,
    buildings: game.buildings.length,
  };
}

function getComparisonData() {
  const playerStats = getPlayerStats();
  const entries = [{ factionId: 'player', id: 'player', name: 'Your Civilization', stats: playerStats, isPlayer: true }];
  for (const [fid, met] of Object.entries(game.metFactions || {})) {
    if (!FACTIONS[fid]) continue;
    const stats = game.factionStats[fid] || {};
    entries.push({ factionId: fid, id: fid, name: FACTIONS[fid].name, stats: stats, isPlayer: false, color: FACTIONS[fid].color });
  }
  return entries;
}

function getUnmetFactions(fromFactionId) {
  // Return factions that fromFaction knows about but player hasn't met
  const unmet = [];
  for (const fid of Object.keys(FACTIONS)) {
    if (fid === fromFactionId) continue;
    if (game.metFactions[fid]) continue;
    unmet.push(fid);
  }
  return unmet;
}

export {
  generateMap,
  getTileYields,
  getTileMoveCost,
  getTileBaseMoveCost,
  isTilePassable,
  crossesRiver,
  roadBridgesRiver,
  getTileName,
  getDefaultFactionStats,
  initFactionStats,
  updateFactionStats,
  getPlayerStats,
  getComparisonData,
  getUnmetFactions,
  placeTribalVillages,
  isResourceRevealed,
  getHexDirection,
  hasRiverBetween,
  hasRoadBridge
};
