# River System Upgrade: Edge-Based → Bezier Center-Line

**Purpose:** The current rivers use an old edge-based system that looks angular and mechanical. The preview tool (`tile-world-preview.html`) uses a center-line tracing algorithm with bezier curve rendering that produces smooth, natural-looking rivers. This document gives you the exact code to port that system into the game.

**3 files need changes:**
1. `src/map.js` — Replace river generation (PASS 6)
2. `src/render.js` — Replace river rendering
3. `src/main.js` — Store `riverPaths` in game state

After changes, run `npm run build` to rebundle.

---

## 1. src/map.js — Replace PASS 6 (River Generation)

Find the section starting with:
```js
  // PASS 6: RIVER GENERATION (edge-based, downhill flow)
```

And ending just before:
```js
  // ════════════════════════════════════════════════
  // PASS 7: RESOURCE PLACEMENT
```

**Delete that entire block** and replace with:

```js
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
```

Then find the line:
```js
  return map;
```

And change it to:
```js
  return { map, riverPaths };
```

---

## 2. src/render.js — Replace River Rendering

Find the section starting with:
```js
  // Draw edge-based rivers — rivers flow along hex borders (FreeCiv-style)
```

And ending at the matching `ctx.restore();` (about 100 lines later, just before the waypoint/unit path drawing code).

**Delete that entire block** and replace with:

```js
  // Draw rivers as smooth bezier curves through tile centers (matching preview tool)
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const riverBaseWidth = 1.0;
  const tension = 0.3;

  if (game.riverPaths && game.riverPaths.length > 0) {
    for (const river of game.riverPaths) {
      if (river.length < 2) continue;

      // Convert river path to screen coordinates
      const pts = river.map(seg => {
        const pos = hexToPixel(seg.c, seg.r);
        return { x: pos.x - camX, y: pos.y - camY };
      });

      // Check if any point of the river is visible (and tile is revealed)
      let anyVisible = false;
      for (let i = 0; i < river.length; i++) {
        const seg = river[i];
        if (game.fogOfWar[seg.r] && game.fogOfWar[seg.r][seg.c]) {
          const p = pts[i];
          if (p.x > -100 && p.x < canvasW + 100 && p.y > -100 && p.y < canvasH + 100) {
            anyVisible = true;
            break;
          }
        }
      }
      if (!anyVisible) continue;

      // Draw each segment with graduated width and bezier curves
      for (let i = 0; i < pts.length - 1; i++) {
        const seg = river[i];
        // Skip segments in fog
        if (!game.fogOfWar[seg.r] || !game.fogOfWar[seg.r][seg.c]) continue;
        // Skip drawing ON water tiles (river ends at water)
        const tile = game.map[seg.r] && game.map[seg.r][seg.c];
        if (tile && (tile.base === 'ocean' || tile.base === 'coast' || tile.base === 'lake')) continue;

        const p0 = pts[i], p1 = pts[i + 1];
        const progress = i / (pts.length - 1);
        const width = riverBaseWidth * (0.5 + progress * 2.2) * (HEX_SIZE / 36);

        // Build bezier curve segment
        function drawBezierSeg() {
          ctx.beginPath();
          if (i > 0 && i < pts.length - 2) {
            const prev = pts[i - 1], next2 = pts[i + 2];
            const cpx1 = p0.x + (p1.x - prev.x) * tension;
            const cpy1 = p0.y + (p1.y - prev.y) * tension;
            const cpx2 = p1.x - (next2.x - p0.x) * tension;
            const cpy2 = p1.y - (next2.y - p0.y) * tension;
            ctx.moveTo(p0.x, p0.y);
            ctx.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, p1.x, p1.y);
          } else {
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
          }
        }

        // Layer 1: Dark river edge
        drawBezierSeg();
        ctx.strokeStyle = 'rgba(15,50,80,0.7)';
        ctx.lineWidth = width + 2;
        ctx.stroke();

        // Layer 2: Main water colour (darkens toward mouth)
        const rb = Math.round(30 - progress * 15);
        const rg = Math.round(120 - progress * 30);
        const rr = Math.round(190 - progress * 40);
        drawBezierSeg();
        ctx.strokeStyle = `rgba(${rb},${rg},${rr},0.85)`;
        ctx.lineWidth = width;
        ctx.stroke();

        // Layer 3: Light specular highlight
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = `rgba(${rb + 60},${rg + 50},${rr + 30},0.25)`;
        ctx.lineWidth = Math.max(1, width * 0.35);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
```

---

## 3. src/main.js — Store riverPaths in Game State

Find this line (around line 85):
```js
  const map = generateMap();
```

Change to:
```js
  const { map, riverPaths } = generateMap();
```

Then find where the game state object is created (the big object literal with `map: map,`). Add `riverPaths` to it:
```js
    map: map,
    riverPaths: riverPaths,
```

---

## How to verify it worked

1. `npm run build`
2. Open the game, start a new game
3. Rivers should be smooth bezier curves (thin at mountain source, widening toward the ocean)
4. Compare visually against `tile-world-preview.html` — they should match
5. Movement still works: crossing a river costs all remaining MP, -5 attack across rivers (this uses `riverEdges` which are still derived from the path)

## Key differences from the old system

| | Old (edge-based) | New (center-line bezier) |
|---|---|---|
| **Path tracing** | Random walk downhill, 50 steps max | Water-seeking with coast pull, 60 steps, seeded RNG |
| **Source selection** | Random hills/mountains | Priority-sorted by elevation, MIN_RIVER_DIST=10 spacing |
| **Rendering** | Edge midpoints with quadratic curves per-tile | Continuous bezier curves through tile centers |
| **Width** | Fixed `1.5 + edges*0.5` | Graduated: thin at source → wide at mouth |
| **Visual layers** | 3-layer (dark edge / main / highlight) | Same 3-layer but with smooth color gradient |
| **Data stored** | `tile.riverEdges[]` only | `game.riverPaths[]` + `tile.riverEdges[]` (both) |
| **Game mechanics** | Unchanged | Unchanged — `crossesRiver()` still uses `riverEdges` |
