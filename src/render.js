import { HEX_SIZE, SQRT3, MAP_COLS, MAP_ROWS, BASE_TERRAIN, TERRAIN_FEATURES, RESOURCES, UNIT_TYPES, FACTIONS, NATURAL_WONDERS, TILE_IMPROVEMENTS, UNIT_SPRITE_MAP, ZOOM_MIN, ZOOM_MAX, CITY_DEFENSE, BARBARIAN_UNITS, BUILDINGS, WONDERS, WALL_HP } from './constants.js';
import { game, canvas, ctx, miniCanvas, miniCtx, canvasW, canvasH, setCanvasSize, gameZoom, setGameZoom, hoveredHex, LOCKED_DPR, tilesLoaded, TERRAIN_TILE_IMAGES, IMPROVEMENT_IMAGES, unitAtlas, animRunning } from './state.js';
import { hexToPixel, pixelToHex, drawHex, getHexNeighbors, hexDistance } from './hex.js';
import { valueNoise, fbmNoise, rgbStr, adjustBrightness, hexToRgba, getTerrainTileImage } from './utils.js';
import { drawDetailedHex } from './terrain-render.js';
import { getTileYields, getTileName, getTileMoveCost, isResourceRevealed, crossesRiver, roadBridgesRiver } from './map.js';
import { computeMoveRange, computeRiverCrossings, computeAttackRange, getEnemyZOCHexes } from './units.js';
import { getUnitAt, getCityAt } from './combat.js';
import { getWaypointPath } from './improvements.js';
import { getRelationLabel } from './diplomacy-api.js';
import { MINOR_FACTION_TYPES } from './minor-factions.js';
import { drawResourceIcon } from './resource-icons.js';

function resizeCanvas() {
  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;
  setCanvasSize(w, h);
  canvas.width = w * LOCKED_DPR;
  canvas.height = h * LOCKED_DPR;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(LOCKED_DPR, 0, 0, LOCKED_DPR, 0, 0);
}

function centerCameraOnCity() {
  if (!game || !game.cities.length) return;
  if (!canvasW || !canvasH || !gameZoom || !isFinite(gameZoom)) return;
  const city = game.cities[0];
  const pos = hexToPixel(city.col, city.row);
  game.cameraX = pos.x - (canvasW / gameZoom) / 2;
  game.cameraY = pos.y - (canvasH / gameZoom) / 2;
  // Inline clamp (can't import from input.js — circular dep)
  const totalW = MAP_COLS * HEX_SIZE * SQRT3;
  const totalH = MAP_ROWS * HEX_SIZE * 1.5 + HEX_SIZE;
  const viewW = canvasW / gameZoom;
  const viewH = canvasH / gameZoom;
  if (viewW >= totalW) { game.cameraX = (totalW - viewW) / 2; }
  else { game.cameraX = Math.max(-HEX_SIZE, Math.min(totalW - viewW + HEX_SIZE, game.cameraX)); }
  if (viewH >= totalH) { game.cameraY = (totalH - viewH) / 2; }
  else { game.cameraY = Math.max(-HEX_SIZE, Math.min(totalH - viewH + HEX_SIZE, game.cameraY)); }
}

let _visibilityDirty = true;

/** Mark visibility for recomputation (call after units move, cities change, etc.) */
function markVisibilityDirty() { _visibilityDirty = true; }

function computeVisibility() {
  if (!_visibilityDirty && game.visibleTiles) return;
  _visibilityDirty = false;

  // Create fresh visibility grid each computation
  const visible = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(false));

  // Player cities grant vision — bounded to radius
  for (const city of game.cities) {
    const radius = 5 + Math.floor((city.borderRadius || 2));
    const rMin = Math.max(0, city.row - radius - 1);
    const rMax = Math.min(MAP_ROWS, city.row + radius + 2);
    const cMin = Math.max(0, city.col - radius - 1);
    const cMax = Math.min(MAP_COLS, city.col + radius + 2);
    for (let r = rMin; r < rMax; r++) {
      for (let c = cMin; c < cMax; c++) {
        if (hexDistance(c, r, city.col, city.row) <= radius) {
          visible[r][c] = true;
          // Also ensure fog of war is revealed (safety net)
          game.fogOfWar[r][c] = true;
        }
      }
    }
  }

  // Player units grant vision — bounded columns too
  for (const unit of game.units) {
    if (unit.owner !== 'player') continue;
    const sightRange = unit.type === 'scout' ? 4 : 3;
    const rMin = Math.max(0, unit.row - sightRange - 1);
    const rMax = Math.min(MAP_ROWS, unit.row + sightRange + 2);
    const cMin = Math.max(0, unit.col - sightRange - 1);
    const cMax = Math.min(MAP_COLS, unit.col + sightRange + 2);
    for (let r = rMin; r < rMax; r++) {
      for (let c = cMin; c < cMax; c++) {
        if (hexDistance(c, r, unit.col, unit.row) <= sightRange) {
          visible[r][c] = true;
          // Also ensure fog of war is revealed (safety net — prevents
          // black tiles adjacent to units regardless of how they got there)
          game.fogOfWar[r][c] = true;
        }
      }
    }
  }

  // Converted barbarian camps (spy network) grant vision — bounded columns too
  if (game.minorFactions) {
    for (const mf of game.minorFactions) {
      if (mf.converted && mf.convertedRole === 'spy network') {
        const cMin = Math.max(0, mf.col - 7);
        const cMax = Math.min(MAP_COLS, mf.col + 8);
        for (let r = Math.max(0, mf.row - 6); r < Math.min(MAP_ROWS, mf.row + 7); r++) {
          for (let c = cMin; c < cMax; c++) {
            if (hexDistance(c, r, mf.col, mf.row) <= 6) {
              visible[r][c] = true;
            }
          }
        }
      }
    }
  }

  game.visibleTiles = visible;
}

function render() {
  if (!game) return;
  // Reset transform unconditionally — prevents accumulated scale from corrupted
  // frames where ctx.restore() was skipped due to an exception.
  ctx.setTransform(LOCKED_DPR, 0, 0, LOCKED_DPR, 0, 0);
  // Sanitize camera state — prevent NaN/Infinity from corrupting the frame
  if (!isFinite(game.cameraX)) game.cameraX = 0;
  if (!isFinite(game.cameraY)) game.cameraY = 0;
  computeVisibility();
  // Ensure canvas dimensions are set before rendering
  if (!canvasW || !canvasH) resizeCanvas();
  // Fill entire canvas with fog-of-war color (prevents black edges at zoom)
  ctx.fillStyle = '#0a0c0b';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Sanitize zoom — clamp to valid range to prevent runaway scaling
  if (!isFinite(gameZoom) || gameZoom < ZOOM_MIN || gameZoom > ZOOM_MAX) {
    setGameZoom(1.0);
  }

  // Apply zoom — wrapped in try/finally to guarantee restore() runs
  ctx.save();
  try {
  ctx.scale(gameZoom, gameZoom);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const camX = game.cameraX;
  const camY = game.cameraY;
  const viewW = canvasW / gameZoom;
  const viewH = canvasH / gameZoom;

  const startCol = Math.max(0, Math.floor((camX - HEX_SIZE * 2) / (HEX_SIZE * SQRT3)));
  const endCol = Math.min(MAP_COLS, Math.ceil((camX + viewW + HEX_SIZE * 2) / (HEX_SIZE * SQRT3)));
  const startRow = Math.max(0, Math.floor((camY - HEX_SIZE * 2) / (HEX_SIZE * 1.5)));
  const endRow = Math.min(MAP_ROWS, Math.ceil((camY + viewH + HEX_SIZE * 2) / (HEX_SIZE * 1.5)));

  const moveRange = computeMoveRange();
  const riverCrossings = computeRiverCrossings();
  const attackRange = computeAttackRange();
  // ZOC overlay: show enemy ZOC hexes when a player unit is selected
  const zocHexes = game.selectedUnitId ? getEnemyZOCHexes('player') : null;

  // Draw hex tiles
  for (let r = startRow; r < endRow; r++) {
    for (let c = startCol; c < endCol; c++) {
      const tile = game.map[r][c];
      const pos = hexToPixel(c, r);
      const sx = pos.x - camX;
      const sy = pos.y - camY;

      if (sx < -HEX_SIZE * 2 || sx > viewW + HEX_SIZE * 2) continue;
      if (sy < -HEX_SIZE * 2 || sy > viewH + HEX_SIZE * 2) continue;

      const revealed = game.fogOfWar[r][c];

      if (!revealed) {
        drawHex(ctx, sx, sy, HEX_SIZE - 1);
        ctx.fillStyle = '#0a0c0b';
        ctx.fill();
        continue;
      }

      // Canvas terrain rendering — flat base + tile art overlay
      drawDetailedHex(ctx, sx, sy, tile, HEX_SIZE);

      // Shroud: explored but not currently visible
      const isVisible = game.visibleTiles && game.visibleTiles[r] && game.visibleTiles[r][c];
      if (!isVisible) {
        ctx.save();
        drawHex(ctx, sx, sy, HEX_SIZE - 1);
        ctx.fillStyle = 'rgba(8, 10, 12, 0.45)';
        ctx.fill();
        ctx.restore();
      }

      // Grid lines removed for seamless terrain

      // Resource indicator with detailed canvas-drawn icon (hidden if unrevealed strategic)
      if (tile.resource && RESOURCES[tile.resource] && isResourceRevealed(tile.resource)) {
        // Reveal animation glow (fades over 2 seconds)
        if (tile._revealedAt) {
          const elapsed = Date.now() - tile._revealedAt;
          if (elapsed < 2000) {
            const alpha = 0.6 * (1 - elapsed / 2000);
            ctx.save();
            ctx.beginPath();
            ctx.arc(sx, sy, HEX_SIZE * 0.6, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 215, 0, ${alpha})`;
            ctx.fill();
            ctx.restore();
          } else {
            tile._revealedAt = null; // animation done
          }
        }
        drawResourceIcon(ctx, sx, sy + 1, tile.resource, 10);
      }


      // Natural wonder indicator
      if (tile.naturalWonder) {
        const nwDef = NATURAL_WONDERS.find(n => n.id === tile.naturalWonder);
        if (nwDef) {
          ctx.beginPath();
          ctx.arc(sx, sy - 8, 11, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,215,0,0.7)';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = nwDef.color;
          ctx.font = 'bold 13px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(nwDef.icon, sx, sy - 8);
          ctx.textBaseline = 'alphabetic';
        }
      }

      // Tribal village sprite
      if (game.tribalVillages) {
        const village = game.tribalVillages.find(v => v.col === c && v.row === r && !v.discovered);
        if (village) {
          const villageImg = IMPROVEMENT_IMAGES['tribal_village'];
          if (villageImg && villageImg.complete && villageImg.naturalWidth > 0) {
            ctx.save();
            // Clip to hex shape
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const angle = Math.PI / 180 * (60 * i - 30);
              const hx = sx + HEX_SIZE * Math.cos(angle);
              const hy = sy + HEX_SIZE * Math.sin(angle);
              if (i === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
            ctx.clip();
            const imgS = HEX_SIZE * 1.0;
            ctx.drawImage(villageImg, sx - imgS / 2, sy - imgS / 2, imgS, imgS);
            ctx.restore();
          }
        }
      }

      // Draw tile improvements as images
      if (tile.improvement) {
        const impImg = IMPROVEMENT_IMAGES[tile.improvement];
        if (impImg && impImg.complete && impImg.naturalWidth > 0) {
          ctx.save();
          ctx.globalAlpha = 0.75;
          const impS = HEX_SIZE * 2.3;
          ctx.drawImage(impImg, sx - impS/2, sy - impS/2, impS, impS);
          ctx.globalAlpha = 1.0;
          ctx.restore();
        }
      }
      if (tile.road) {
        const roadImg = IMPROVEMENT_IMAGES['road'];
        if (roadImg && roadImg.complete && roadImg.naturalWidth > 0) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          const rS = HEX_SIZE * 2.2;
          ctx.drawImage(roadImg, sx - rS/2, sy - rS/2, rS, rS);
          ctx.globalAlpha = 1.0;
          ctx.restore();
        }
      }
      // Show improvement in progress (circular progress indicator)
      if (tile.improvementBuilder) {
        const impDef = TILE_IMPROVEMENTS[tile.improvementBuilder.improvementId];
        const totalTurns = impDef ? impDef.turns : 3;
        const prog = 1 - (tile.improvementBuilder.turnsLeft / totalTurns);
        // Progress ring
        ctx.strokeStyle = 'rgba(201,168,76,0.8)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sx, sy, HEX_SIZE * 0.35, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * prog);
        ctx.stroke();
        // Background ring
        ctx.strokeStyle = 'rgba(201,168,76,0.15)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, HEX_SIZE * 0.35, 0, Math.PI * 2);
        ctx.stroke();
        // Turns remaining label
        ctx.fillStyle = '#c9a84c';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tile.improvementBuilder.turnsLeft + 't', sx, sy);
        ctx.textBaseline = 'alphabetic';
      }

      // City territory with cultural borders
      for (const city of game.cities) {
        const bRadius = city.borderRadius || 2;
        const dist = hexDistance(c, r, city.col, city.row);
        if (dist <= bRadius) {
          // Subtle territory fill
          drawHex(ctx, sx, sy, HEX_SIZE - 1);
          ctx.fillStyle = 'rgba(201,168,76,0.06)';
          ctx.fill();
          // Draw border edge on outermost ring
          if (dist === bRadius) {
            const nbs = getHexNeighbors(c, r);
            for (const nb of nbs) {
              if (hexDistance(nb.col, nb.row, city.col, city.row) > bRadius) {
                // This edge faces outside territory — draw border segment
                const nbPos = hexToPixel(nb.col, nb.row);
                const edx = (nbPos.x - (sx + camX)) * 0.48;
                const edy = (nbPos.y - (sy + camY)) * 0.48;
                ctx.strokeStyle = 'rgba(201,168,76,0.6)';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(sx + edx - edy * 0.5, sy + edy + edx * 0.5);
                ctx.lineTo(sx + edx + edy * 0.5, sy + edy - edx * 0.5);
                ctx.stroke();
              }
            }
          }
        }
      }

      // Faction territory with borders
      for (const [fid, fc] of Object.entries(game.factionCities)) {
        if (!fc.color) continue;
        const dist = hexDistance(c, r, fc.col, fc.row);
        if (dist <= 2) {
          drawHex(ctx, sx, sy, HEX_SIZE - 1);
          ctx.fillStyle = hexToRgba(fc.color, 0.05);
          ctx.fill();
          if (dist === 2) {
            drawHex(ctx, sx, sy, HEX_SIZE - 1);
            ctx.strokeStyle = hexToRgba(fc.color, 0.25);
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }

      // Move range highlight (yellow for river crossings, green for normal)
      if (moveRange) {
        const key = `${c},${r}`;
        if (moveRange.has(key)) {
          const isRiverCross = riverCrossings && riverCrossings.has(key);
          drawHex(ctx, sx, sy, HEX_SIZE - 1);
          ctx.fillStyle = isRiverCross ? 'rgba(220,200,60,0.25)' : 'rgba(80,220,120,0.22)';
          ctx.fill();
          ctx.strokeStyle = isRiverCross ? 'rgba(220,200,60,0.75)' : 'rgba(80,220,120,0.65)';
          ctx.lineWidth = 2;
          ctx.stroke();
          if (isRiverCross) {
            // Dashed inner stroke for river crossing tiles
            ctx.setLineDash([4, 3]);
            drawHex(ctx, sx, sy, HEX_SIZE - 4);
            ctx.strokeStyle = 'rgba(220,180,40,0.5)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.setLineDash([]);
          } else {
            drawHex(ctx, sx, sy, HEX_SIZE - 4);
            ctx.strokeStyle = 'rgba(80,220,120,0.25)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      // Attack range highlight (red)
      if (attackRange) {
        const key = `${c},${r}`;
        if (attackRange.has(key)) {
          drawHex(ctx, sx, sy, HEX_SIZE - 1);
          ctx.fillStyle = 'rgba(220,60,60,0.2)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(220,60,60,0.6)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Zone of Control overlay (red tint on hexes adjacent to enemy military units)
      if (zocHexes) {
        const key = `${c},${r}`;
        if (zocHexes.has(key) && !(moveRange && moveRange.has(key)) && !(attackRange && attackRange.has(key))) {
          drawHex(ctx, sx, sy, HEX_SIZE - 1);
          ctx.fillStyle = 'rgba(180,40,40,0.12)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(180,40,40,0.35)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Yield indicators when hex is selected
      if (game.selectedHex && game.selectedHex.col === c && game.selectedHex.row === r) {
        const yields = getTileYields(tile);
        const yieldParts = [];
        if (yields.food > 0) yieldParts.push({ val: yields.food, color: '#6aab5c' });
        if (yields.prod > 0) yieldParts.push({ val: yields.prod, color: '#d4945a' });
        if (yields.gold > 0) yieldParts.push({ val: yields.gold, color: '#c9a84c' });
        if (yieldParts.length > 0) {
          const totalW = yieldParts.length * 14;
          let ox = sx - totalW / 2;
          ctx.font = 'bold 10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (const yp of yieldParts) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.beginPath(); ctx.arc(ox + 7, sy - HEX_SIZE + 4, 6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = yp.color;
            ctx.fillText(yp.val, ox + 7, sy - HEX_SIZE + 5);
            ox += 14;
          }
          ctx.textBaseline = 'alphabetic';
        }
      }
    }
  }

  // Draw faction cities
  for (const [fid, fc] of Object.entries(game.factionCities)) {
    const pos = hexToPixel(fc.col, fc.row);
    const sx = pos.x - camX;
    const sy = pos.y - camY;
    if (game.fogOfWar[fc.row] && game.fogOfWar[fc.row][fc.col]) {
      const fcVisible = game.visibleTiles && game.visibleTiles[fc.row] && game.visibleTiles[fc.row][fc.col];
      ctx.save();
      if (!fcVisible) ctx.globalAlpha = 0.4;
      // City circle
      ctx.beginPath();
      ctx.arc(sx, sy, 11, 0, Math.PI * 2);
      ctx.fillStyle = fc.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // City name
      ctx.fillStyle = '#fff';
      ctx.font = '600 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 3;
      ctx.fillText(fc.name, sx, sy - 16);
      ctx.shadowBlur = 0;
      // Capital star icon
      ctx.fillStyle = '#1a1400';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u2605', sx, sy + 1);
      ctx.textBaseline = 'alphabetic';
      // Show wall HP bar (grey/blue, above city HP bar)
      if (fc.wallHP !== undefined && fc.wallMaxHP > 0) {
        const hpW = 22;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(sx - hpW/2, sy + 11, hpW, 3);
        ctx.fillStyle = fc.wallHP > fc.wallMaxHP * 0.5 ? '#7090b0' : fc.wallHP > fc.wallMaxHP * 0.25 ? '#a0a060' : '#d09050';
        ctx.fillRect(sx - hpW/2, sy + 11, hpW * (fc.wallHP / fc.wallMaxHP), 3);
      }
      // Show city HP bar if damaged
      if (fc.hp !== undefined && fc.hp < CITY_DEFENSE.BASE_HP) {
        const hpW = 22;
        const hpY = (fc.wallHP !== undefined && fc.wallMaxHP > 0) ? sy + 15 : sy + 14;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(sx - hpW/2, hpY, hpW, 3);
        ctx.fillStyle = fc.hp > 50 ? '#6aab5c' : fc.hp > 25 ? '#ddc060' : '#d9534f';
        ctx.fillRect(sx - hpW/2, hpY, hpW * (fc.hp / CITY_DEFENSE.BASE_HP), 3);
      }
      ctx.restore();
    }
  }
  // Draw AI expansion cities
  if (game.aiFactionCities) {
    for (const [fid, cities] of Object.entries(game.aiFactionCities)) {
      for (const aic of cities) {
        if (!game.fogOfWar[aic.row] || !game.fogOfWar[aic.row][aic.col]) continue;
        if (game.visibleTiles && !(game.visibleTiles[aic.row] && game.visibleTiles[aic.row][aic.col])) continue;
        const ap = hexToPixel(aic.col, aic.row);
        const ax = ap.x - camX, ay = ap.y - camY;
        // Territory
        const br = aic.borderRadius || 1;
        for (let dr = -br; dr <= br; dr++) {
          for (let dc = -br; dc <= br; dc++) {
            const nr = aic.row + dr, nc = ((aic.col + dc) % MAP_COLS + MAP_COLS) % MAP_COLS;
            if (nr < 0 || nr >= MAP_ROWS || hexDistance(nc, nr, aic.col, aic.row) > br) continue;
            const bp = hexToPixel(nc, nr);
            ctx.fillStyle = (aic.color || '#888') + '18';
            drawHex(ctx, bp.x - camX, bp.y - camY, HEX_SIZE - 1); ctx.fill();
          }
        }
        ctx.beginPath(); ctx.arc(ax, ay, 9, 0, Math.PI * 2);
        ctx.fillStyle = aic.color || '#888'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = '600 8px sans-serif'; ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 2;
        ctx.fillText(aic.name, ax, ay - 13); ctx.shadowBlur = 0;
        // Show wall HP bar for expansion city
        if (aic.wallHP !== undefined && aic.wallMaxHP > 0) {
          const hpW = 22;
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(ax - hpW/2, ay + 11, hpW, 3);
          ctx.fillStyle = aic.wallHP > aic.wallMaxHP * 0.5 ? '#7090b0' : aic.wallHP > aic.wallMaxHP * 0.25 ? '#a0a060' : '#d09050';
          ctx.fillRect(ax - hpW/2, ay + 11, hpW * (aic.wallHP / aic.wallMaxHP), 3);
        }
        // Show expansion city HP bar if damaged
        if (aic.hp !== undefined && aic.hp < CITY_DEFENSE.BASE_HP) {
          const hpW = 22;
          const hpY = (aic.wallHP !== undefined && aic.wallMaxHP > 0) ? ay + 15 : ay + 14;
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(ax - hpW/2, hpY, hpW, 3);
          ctx.fillStyle = aic.hp > 50 ? '#6aab5c' : aic.hp > 25 ? '#ddc060' : '#d9534f';
          ctx.fillRect(ax - hpW/2, hpY, hpW * (aic.hp / CITY_DEFENSE.BASE_HP), 3);
        }
      }
    }
  }

  // Draw barbarian camps
  if (game.barbarianCamps) {
    for (const bc of game.barbarianCamps) {
      if (bc.destroyed) continue;
      if (!game.fogOfWar[bc.row] || !game.fogOfWar[bc.row][bc.col]) continue;
      if (game.visibleTiles && !(game.visibleTiles[bc.row] && game.visibleTiles[bc.row][bc.col])) continue;
      const bp = hexToPixel(bc.col, bc.row);
      const bx = bp.x - camX, by = bp.y - camY;
      // Camp circle with red tint
      ctx.beginPath(); ctx.arc(bx, by, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#6b2020'; ctx.fill();
      ctx.strokeStyle = '#d44'; ctx.lineWidth = 1.5; ctx.stroke();
      // Skull icon
      ctx.fillStyle = '#ff6644'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('\u{1F3D5}', bx, by);
      // Label
      ctx.fillStyle = '#d9534f'; ctx.font = '600 8px sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 2;
      let campLabel = 'Barbarian Camp';
      if (bc.specialUnit) { const su = BARBARIAN_UNITS[bc.specialUnit]; if (su) campLabel = su.name + ' Camp'; }
      ctx.fillText(campLabel, bx, by - 14);
      // Strength bar
      const maxStr = 30; const strPct = Math.min(1, bc.strength / maxStr);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx - 12, by + 13, 24, 3);
      ctx.fillStyle = strPct > 0.5 ? '#d9534f' : '#ff8844'; ctx.fillRect(bx - 12, by + 13, 24 * strPct, 3);
      ctx.shadowBlur = 0;
    }
  }


  // Draw rivers as smooth bezier curves through tile centers (matching preview tool)
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const riverBaseWidth = 1.0;
  const tension = 0.3;

  if (game.riverPaths && game.riverPaths.length > 0) {
    // Map pixel width for detecting horizontal wrap-around
    const mapPixelW = HEX_SIZE * SQRT3 * MAP_COLS;

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
        // Skip segments that wrap around the map horizontally
        if (Math.abs(p0.x - p1.x) > mapPixelW * 0.5) continue;
        const progress = i / (pts.length - 1);
        const width = riverBaseWidth * (0.5 + progress * 2.2) * (HEX_SIZE / 36);

        // Build bezier curve segment (fall back to straight line if neighbors wrap)
        const halfMap = mapPixelW * 0.5;
        const useBezier = i > 0 && i < pts.length - 2
          && Math.abs(pts[i - 1].x - p0.x) < halfMap
          && Math.abs(pts[i + 2].x - p1.x) < halfMap;
        function drawBezierSeg() {
          ctx.beginPath();
          if (useBezier) {
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

      // Delta/fan at river mouth
      if (river.length > 2) {
        const lastSeg = river[river.length - 1];
        const lastTile = game.map[lastSeg.r] && game.map[lastSeg.r][lastSeg.c];
        if (lastTile && (lastTile.base === 'ocean' || lastTile.base === 'coast' || lastTile.base === 'lake')) {
          const last = pts[pts.length - 1], prev = pts[pts.length - 2];
          // Skip delta if it wraps around the map
          if (Math.abs(last.x - prev.x) > mapPixelW * 0.5) continue;
          const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
          const fan = HEX_SIZE * 0.4;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(last.x + Math.cos(angle + 0.5) * fan, last.y + Math.sin(angle + 0.5) * fan);
          ctx.lineTo(last.x + Math.cos(angle - 0.5) * fan, last.y + Math.sin(angle - 0.5) * fan);
          ctx.closePath();
          ctx.fillStyle = 'rgba(25,90,150,0.35)';
          ctx.fill();
        }
      }
    }
  }
  ctx.restore();

  // Draw subtle hex grid borders (matching preview tool)
  for (let r = startRow; r < endRow; r++) {
    for (let c = startCol; c < endCol; c++) {
      if (!game.fogOfWar[r][c]) continue;
      const pos = hexToPixel(c, r);
      const bx = pos.x - camX, by = pos.y - camY;
      if (bx < -HEX_SIZE * 2 || bx > viewW + HEX_SIZE * 2) continue;
      if (by < -HEX_SIZE * 2 || by > viewH + HEX_SIZE * 2) continue;
      drawHex(ctx, bx, by, HEX_SIZE - 0.5);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }

  // Draw waypoint paths for selected unit
  if (game.selectedUnitId) {
    const selUnit = game.units.find(u => u.id === game.selectedUnitId);
    if (selUnit && selUnit.waypoint) {
      const wpPath = getWaypointPath(selUnit);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(201,168,76,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const startPos = hexToPixel(selUnit.col, selUnit.row);
      ctx.moveTo(startPos.x - camX, startPos.y - camY);
      for (const p of wpPath) {
        const pp = hexToPixel(p.col, p.row);
        ctx.lineTo(pp.x - camX, pp.y - camY);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Draw destination marker
      const wp = selUnit.waypoint;
      const wpPos = hexToPixel(wp.col, wp.row);
      const wpsx = wpPos.x - camX, wpsy = wpPos.y - camY;
      ctx.beginPath();
      ctx.arc(wpsx, wpsy, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(201,168,76,0.7)';
      ctx.fill();
      ctx.strokeStyle = '#c9a84c';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Draw minor factions
  if (game.minorFactions) {
    for (const mf of game.minorFactions) {
      if (mf.defeated) continue;
      if (!game.fogOfWar[mf.row] || !game.fogOfWar[mf.row][mf.col]) continue;
      if (game.visibleTiles && !(game.visibleTiles[mf.row] && game.visibleTiles[mf.row][mf.col])) continue;
      const pos = hexToPixel(mf.col, mf.row);
      const sx = pos.x - camX, sy = pos.y - camY;
      const mfType = MINOR_FACTION_TYPES[mf.type];
      if (!mfType) continue;
      // Draw camp icon
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.fillStyle = mf.converted ? 'rgba(106,171,92,0.8)' : mfType.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(mfType.icon, sx, sy);
      ctx.textBaseline = 'alphabetic';
    }
  }

  // Draw player cities
  for (const city of game.cities) {
    const pos = hexToPixel(city.col, city.row);
    const sx = pos.x - camX;
    const sy = pos.y - camY;

    ctx.beginPath();
    ctx.arc(sx, sy, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#c9a84c';
    ctx.fill();
    ctx.strokeStyle = '#f0ebe0';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#1a1400';
    ctx.font = 'bold 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u2605', sx, sy + 1);
    ctx.textBaseline = 'alphabetic';

    // Construction progress ring
    let buildPct = 0;
    let ringColor = '#4ade80'; // green for buildings
    if (game.currentBuild) {
      const bdata = BUILDINGS.find(b => b.id === game.currentBuild);
      if (bdata && bdata.cost > 0) buildPct = Math.min(game.buildProgress / bdata.cost, 1);
    } else if (game.currentUnitBuild) {
      const ut = UNIT_TYPES[game.currentUnitBuild];
      if (ut && ut.cost > 0) buildPct = Math.min(game.unitBuildProgress / ut.cost, 1);
      ringColor = '#60a5fa'; // blue for units
    } else if (game.currentWonderBuild) {
      const wd = WONDERS.find(w => w.id === game.currentWonderBuild);
      if (wd && wd.cost > 0) buildPct = Math.min(game.wonderBuildProgress / wd.cost, 1);
      ringColor = '#c084fc'; // purple for wonders
    }
    if (buildPct > 0) {
      const ringRadius = 16;
      const startAngle = -Math.PI / 2; // start at top
      const endAngle = startAngle + (2 * Math.PI * buildPct);
      // Background track
      ctx.beginPath();
      ctx.arc(sx, sy, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 3;
      ctx.stroke();
      // Progress arc
      ctx.beginPath();
      ctx.arc(sx, sy, ringRadius, startAngle, endAngle);
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    ctx.fillStyle = '#c9a84c';
    ctx.font = '700 11px Inter, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 3;
    ctx.fillText(city.name, sx, sy - 18);
    ctx.shadowBlur = 0;

    // Dual HP bars for player cities with walls
    if (city.wallHP !== undefined && city.wallMaxHP > 0) {
      const hpW = 22;
      // Wall HP bar (grey/blue)
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(sx - hpW/2, sy + 17, hpW, 3);
      ctx.fillStyle = city.wallHP > city.wallMaxHP * 0.5 ? '#7090b0' : city.wallHP > city.wallMaxHP * 0.25 ? '#a0a060' : '#d09050';
      ctx.fillRect(sx - hpW/2, sy + 17, hpW * (city.wallHP / city.wallMaxHP), 3);
      // City HP bar (green) below wall bar
      if (city.hp !== undefined && city.hp < CITY_DEFENSE.BASE_HP) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(sx - hpW/2, sy + 21, hpW, 3);
        ctx.fillStyle = city.hp > 50 ? '#6aab5c' : city.hp > 25 ? '#ddc060' : '#d9534f';
        ctx.fillRect(sx - hpW/2, sy + 21, hpW * (city.hp / CITY_DEFENSE.BASE_HP), 3);
      }
    } else if (city.hp !== undefined && city.hp < CITY_DEFENSE.BASE_HP) {
      // No walls — just city HP bar
      const hpW = 22;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(sx - hpW/2, sy + 17, hpW, 3);
      ctx.fillStyle = city.hp > 50 ? '#6aab5c' : city.hp > 25 ? '#ddc060' : '#d9534f';
      ctx.fillRect(sx - hpW/2, sy + 17, hpW * (city.hp / CITY_DEFENSE.BASE_HP), 3);
    }
  }

  // Draw units
  const pulseT = (Date.now() % 1500) / 1500;
  const pulseAlpha = 0.4 + 0.6 * Math.abs(Math.sin(pulseT * Math.PI));
  const pulseRadius = 13 + 3 * Math.abs(Math.sin(pulseT * Math.PI));

  for (const unit of game.units) {
    if (!game.fogOfWar[unit.row] || !game.fogOfWar[unit.row][unit.col]) continue;
    // Hide non-player units in explored-but-not-visible areas
    if (unit.owner !== 'player' && game.visibleTiles && !(game.visibleTiles[unit.row] && game.visibleTiles[unit.row][unit.col])) continue;
    const pos = hexToPixel(unit.col, unit.row);
    const sx = pos.x - camX;
    const sy = pos.y - camY;
    const ut = UNIT_TYPES[unit.type];
    if (!ut) continue;
    const isSelected = game.selectedUnitId === unit.id;
    const isPlayer = unit.owner === 'player';
    const exhausted = unit.moveLeft <= 0;
    const globalAlpha = (!isSelected && exhausted && isPlayer) ? 0.45 : 1.0;

    ctx.save();
    ctx.globalAlpha = globalAlpha;

    // Unit vertical offset — shift down to avoid overlapping city icons
    const uy = sy + 12;

    // Pulsing selection ring
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(sx, uy, pulseRadius, 0, Math.PI * 2);
      ctx.strokeStyle = isPlayer ? `rgba(201,168,76,${pulseAlpha})` : `rgba(220,60,60,${pulseAlpha})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Determine unit colors based on owner
    let discBg, borderColor, iconColor;
    if (isPlayer) {
      discBg = isSelected ? '#f0ebe0' : 'rgba(20,20,20,0.75)';
      borderColor = isSelected ? '#c9a84c' : '#c9a84c';
      iconColor = isSelected ? '#1a1400' : '#c9a84c';
    } else {
      // Faction units — use faction color
      const faction = FACTIONS[unit.owner];
      const fColor = faction ? faction.unitColor : '#888';
      discBg = isSelected ? fColor : 'rgba(20,20,20,0.75)';
      borderColor = fColor;
      iconColor = isSelected ? '#1a1400' : fColor;
    }

    // Unit disc
    ctx.beginPath();
    ctx.arc(sx, uy, 11, 0, Math.PI * 2);
    ctx.fillStyle = discBg;
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    ctx.stroke();

    // Faction color band at bottom of unit disc (for non-player units)
    if (!isPlayer) {
      const faction = FACTIONS[unit.owner];
      if (faction) {
        ctx.beginPath();
        ctx.arc(sx, uy, 11, Math.PI * 0.3, Math.PI * 0.7);
        ctx.strokeStyle = faction.color;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }

    // Unit icon — sprite atlas with emoji fallback
    const spriteInfo = UNIT_SPRITE_MAP[unit.type];
    if (spriteInfo && unitAtlas.complete && unitAtlas.naturalWidth > 0) {
      const drawSize = 22;
      ctx.save();
      // Clip to unit disc for clean edges
      ctx.beginPath();
      ctx.arc(sx, uy, 10, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(unitAtlas,
        spriteInfo.x, spriteInfo.y, spriteInfo.w, spriteInfo.h,
        sx - drawSize / 2, uy - drawSize / 2, drawSize, drawSize);
      ctx.restore();
    } else {
      // Fallback to emoji
      ctx.fillStyle = iconColor;
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ut.icon, sx, uy);
      ctx.textBaseline = 'alphabetic';
    }

    // HP bar (always show for enemy, show for player if damaged)
    if (unit.hp < 100 || !isPlayer) {
      const barW = 18;
      const barH = 3;
      const bx = sx - barW / 2;
      const by = uy + 14;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = unit.hp > 50 ? '#6aab5c' : unit.hp > 25 ? '#d4b45a' : '#c45c4a';
      ctx.fillRect(bx, by, barW * (unit.hp / 100), barH);
    }

    // Status icons (fortified/sleeping/alert)
    if (unit.fortified) {
      ctx.fillStyle = '#5b8dd9';
      ctx.font = '8px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('\u{1F6E1}', sx + 12, uy - 8);
    } else if (unit.sleeping) {
      ctx.fillStyle = '#8a8578';
      ctx.font = '8px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('\u{1F4A4}', sx + 12, uy - 8);
    }

    // Move points indicator for selected player unit
    if (isSelected && isPlayer) {
      ctx.fillStyle = unit.moveLeft > 0 ? '#6aab5c' : '#c45c4a';
      ctx.font = '600 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${unit.moveLeft}\u26A1`, sx, uy + 22);
    }

    ctx.restore();
  }

  // Hovered hex highlight
  if (hoveredHex) {
    const pos = hexToPixel(hoveredHex.col, hoveredHex.row);
    const sx = pos.x - camX;
    const sy = pos.y - camY;
    const hKey = `${hoveredHex.col},${hoveredHex.row}`;
    const isMovable = moveRange && moveRange.has(hKey);
    const isAttackable = attackRange && attackRange.has(hKey);

    if (isAttackable) {
      drawHex(ctx, sx, sy, HEX_SIZE - 1);
      ctx.fillStyle = 'rgba(255,60,60,0.3)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,100,100,0.9)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      canvas.style.cursor = 'crosshair';
    } else if (isMovable) {
      drawHex(ctx, sx, sy, HEX_SIZE - 1);
      ctx.fillStyle = 'rgba(80,255,120,0.3)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,255,200,0.9)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      canvas.style.cursor = 'pointer';
    } else {
      drawHex(ctx, sx, sy, HEX_SIZE - 1);
      ctx.strokeStyle = 'rgba(201,168,76,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      const unitHere = getUnitAt(hoveredHex.col, hoveredHex.row);
      const cityHere = getCityAt(hoveredHex.col, hoveredHex.row);
      canvas.style.cursor = (unitHere || cityHere) ? 'pointer' : 'default';
    }
    // Draw hover tooltip
    if (game.fogOfWar[hoveredHex.row] && game.fogOfWar[hoveredHex.row][hoveredHex.col]) {
      drawHoverTooltip(ctx, sx, sy, hoveredHex.col, hoveredHex.row, camX, camY);
    }
  } else {
    canvas.style.cursor = 'default';
  }

  // Selected hex highlight
  if (game.selectedHex && !game.selectedUnitId) {
    const pos = hexToPixel(game.selectedHex.col, game.selectedHex.row);
    const sx = pos.x - camX;
    const sy = pos.y - camY;
    drawHex(ctx, sx, sy, HEX_SIZE);
    ctx.strokeStyle = '#c9a84c';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  } finally {
    ctx.restore(); // End zoom transform
  }
  renderMiniMap();
}

function renderMiniMap() {
  const mw = miniCanvas.width;
  const mh = miniCanvas.height;
  miniCtx.fillStyle = '#0a0c0b';
  miniCtx.fillRect(0, 0, mw, mh);

  const scaleX = mw / MAP_COLS;
  const scaleY = mh / MAP_ROWS;

  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (!game.fogOfWar[r][c]) continue;
      const tile = game.map[r][c];
      const bt = BASE_TERRAIN[tile.base];
      if (!bt) continue;
      let color = bt.baseColor;
      if (tile.feature === 'mountain') color = '#5a5a5e';
      if (tile.feature === 'woods' || tile.feature === 'rainforest') color = '#2a5a2a';
      // Dim explored-but-not-visible tiles on minimap
      const vis = game.visibleTiles && game.visibleTiles[r] && game.visibleTiles[r][c];
      if (!vis) {
        const cr = parseInt(color.slice(1,3),16), cg = parseInt(color.slice(3,5),16), cb = parseInt(color.slice(5,7),16);
        color = 'rgb(' + Math.floor(cr*0.5) + ',' + Math.floor(cg*0.5) + ',' + Math.floor(cb*0.5) + ')';
      }
      miniCtx.fillStyle = color;
      miniCtx.fillRect(c * scaleX, r * scaleY, scaleX + 0.5, scaleY + 0.5);
    }
  }

  // Player cities
  for (const city of game.cities) {
    miniCtx.fillStyle = '#c9a84c';
    miniCtx.fillRect(city.col * scaleX - 1.5, city.row * scaleY - 1.5, 4, 4);
  }

  // Player units
  for (const unit of game.units) {
    if (unit.owner !== 'player') continue;
    miniCtx.fillStyle = '#c9a84c';
    miniCtx.fillRect(unit.col * scaleX - 0.5, unit.row * scaleY - 0.5, 2, 2);
  }

  // Faction cities
  for (const [fid, fc] of Object.entries(game.factionCities)) {
    if (game.fogOfWar[fc.row] && game.fogOfWar[fc.row][fc.col]) {
      miniCtx.fillStyle = fc.color;
      miniCtx.fillRect(fc.col * scaleX - 1, fc.row * scaleY - 1, 3, 3);
    }
  }

  // Enemy units on minimap (only if in active vision)
  for (const unit of game.units) {
    if (unit.owner === 'player') continue;
    if (!game.visibleTiles || !game.visibleTiles[unit.row] || !game.visibleTiles[unit.row][unit.col]) continue;
    const faction = FACTIONS[unit.owner];
    miniCtx.fillStyle = faction ? faction.color : '#f44';
    miniCtx.fillRect(unit.col * scaleX - 0.5, unit.row * scaleY - 0.5, 2, 2);
  }

  // Viewport rect
  const totalW = MAP_COLS * HEX_SIZE * SQRT3;
  const totalH = MAP_ROWS * HEX_SIZE * 1.5;
  const vx = (game.cameraX / totalW) * mw;
  const vy = (game.cameraY / totalH) * mh;
  const vw = ((canvasW / gameZoom) / totalW) * mw;
  const vh = ((canvasH / gameZoom) / totalH) * mh;
  miniCtx.strokeStyle = 'rgba(201,168,76,0.6)';
  miniCtx.lineWidth = 1;
  miniCtx.strokeRect(vx, vy, vw, vh);
}

function drawHoverTooltip(ctx, hexScreenX, hexScreenY, col, row, camX, camY) {
  const tile = game.map[row][col];
  const unitHere = getUnitAt(col, row);
  const cityHere = getCityAt(col, row);

  // Build tooltip lines
  const lines = [];
  const icons = [];

  // Terrain info
  const tileName = getTileName(tile);
  lines.push({ text: tileName, bold: true, color: '#e8e8ec' });

  // Yields
  const yields = getTileYields(tile);
  const yieldParts = [];
  if (yields.food > 0) yieldParts.push(`${yields.food} Food`);
  if (yields.prod > 0) yieldParts.push(`${yields.prod} Prod`);
  if (yields.gold > 0) yieldParts.push(`${yields.gold} Gold`);
  if (yieldParts.length) lines.push({ text: yieldParts.join('  '), color: '#aab0a8' });

  // Improvement info
  if (tile.improvement && TILE_IMPROVEMENTS[tile.improvement]) {
    const imp = TILE_IMPROVEMENTS[tile.improvement];
    lines.push({ text: `${imp.icon} ${imp.name}`, bold: true, color: '#c9a84c' });
  }
  if (tile.road) lines.push({ text: '\u{1F6E4}\uFE0F Road (half move cost)', color: '#8a7a5a' });
  if (tile.improvementBuilder) {
    const bImp = TILE_IMPROVEMENTS[tile.improvementBuilder.improvementId];
    if (bImp) lines.push({ text: `Building: ${bImp.name} (${tile.improvementBuilder.turnsLeft} turns)`, color: '#ddc060' });
  }

  // River bonus
  if (tile.hasRiver) lines.push({ text: 'River (+1 Gold, fresh water, crossing costs all MP, -5 combat attacking across)', color: '#5baad9' });

  // Move cost
  const moveCost = getTileMoveCost(tile);
  if (moveCost < 99) {
    lines.push({ text: `Move: ${moveCost} MP`, color: '#8a9080' });
  } else {
    lines.push({ text: 'Impassable', color: '#d9534f' });
  }

  // Resource (hidden if unrevealed strategic)
  if (tile.resource && RESOURCES[tile.resource] && isResourceRevealed(tile.resource)) {
    const res = RESOURCES[tile.resource];
    const cat = res.category || 'bonus';
    const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
    lines.push({ text: `${res.name} (${catLabel})`, color: res.color });
    const bonusParts = [];
    if (res.bonus.food) bonusParts.push(`+${res.bonus.food} Food`);
    if (res.bonus.prod) bonusParts.push(`+${res.bonus.prod} Prod`);
    if (res.bonus.gold) bonusParts.push(`+${res.bonus.gold} Gold`);
    if (res.bonus.culture) bonusParts.push(`+${res.bonus.culture} Culture`);
    if (bonusParts.length) lines.push({ text: '  ' + bonusParts.join(', '), color: '#aab0a8' });
  }

  // City info
  if (cityHere) {
    lines.push({ text: '', color: '' }); // spacer
    if (cityHere.owner === 'player') {
      lines.push({ text: `\u{1F3F0} ${cityHere.name} (Your City)`, bold: true, color: '#c9a84c' });
      lines.push({ text: `Pop: ${(cityHere.population || game.population).toLocaleString()}`, color: '#aab0a8' });
      if (game.buildings.length) lines.push({ text: `Buildings: ${game.buildings.length}`, color: '#aab0a8' });
    } else {
      const faction = FACTIONS[cityHere.owner];
      if (faction) {
        const met = game.metFactions && game.metFactions[cityHere.owner];
        lines.push({ text: `\u{1F3F0} ${cityHere.name}`, bold: true, color: faction.color });
        lines.push({ text: cityHere.owner === 'barbarian' ? 'Barbarian Camp' : (met ? faction.name : 'Unknown Civilization'), color: '#aab0a8' });
        if (met) {
          const rel = game.relationships[cityHere.owner] || 0;
          const relLabel = getRelationLabel(rel);
          lines.push({ text: `${relLabel.text} (${rel > 0 ? '+' : ''}${rel})`, color: relLabel.cls === 'relation-hostile' ? '#d9534f' : relLabel.cls === 'relation-friendly' ? '#6aab5c' : relLabel.cls === 'relation-allied' ? '#c9a84c' : '#aab0a8' });
        }
      }
    }
  }

  // Unit info (only show non-player units if tile is in active vision)
  const tileVisible = game.visibleTiles && game.visibleTiles[row] && game.visibleTiles[row][col];
  if (unitHere && (unitHere.owner === 'player' || tileVisible)) {
    lines.push({ text: '', color: '' }); // spacer
    const ut = UNIT_TYPES[unitHere.type];
    const isPlayer = unitHere.owner === 'player';
    if (isPlayer) {
      lines.push({ text: `${ut.icon} ${ut.name} (Yours)`, bold: true, color: '#c9a84c' });
    } else {
      const faction = FACTIONS[unitHere.owner];
      const met = game.metFactions && game.metFactions[unitHere.owner];
      const isBarbarian = unitHere.owner === 'barbarian';
      const ownerName = isBarbarian ? (unitHere.barbName || 'Barbarian') : (met && faction ? faction.name : 'Unknown');
      const unitColor = isBarbarian ? '#d9534f' : (faction ? faction.unitColor : '#d9534f');
      lines.push({ text: `${ut.icon} ${ut.name} (${ownerName})`, bold: true, color: unitColor });
    }
    lines.push({ text: `HP: ${unitHere.hp}/100  Combat: ${ut.combat}${ut.rangedCombat ? '  Ranged: ' + ut.rangedCombat : ''}`, color: unitHere.hp > 60 ? '#6aab5c' : unitHere.hp > 30 ? '#ddc060' : '#d9534f' });
    lines.push({ text: `Moves: ${unitHere.moveLeft}/${ut.movePoints}  Class: ${ut.class}`, color: '#8a9080' });
    if (unitHere.fortified) lines.push({ text: 'Fortified (+20% def, +10 HP/turn)', color: '#5baad9' });
    // Show healing status
    if (unitHere.hp < 100 && unitHere.owner === 'player') {
      const inCity = game.cities.some(c => c.col === unitHere.col && c.row === unitHere.row);
      if (inCity) lines.push({ text: 'Healing in city (+20 HP/turn)', color: '#6aab5c' });
      else if (unitHere.fortified) lines.push({ text: 'Healing while fortified (+10 HP/turn)', color: '#6aab5c' });
      else lines.push({ text: 'Resting heals +5 HP/turn (don\'t move)', color: '#8a9a80' });
    }
    if (unitHere.sleeping) lines.push({ text: 'Sleeping', color: '#8a8a8a' });
    if (unitHere.alert) lines.push({ text: 'Alert (will wake if enemy nearby)', color: '#ddc060' });
  }

  if (lines.length === 0) return;

  // Measure tooltip dimensions
  ctx.save();
  const padding = 8;
  const lineH = 16;
  const font = '12px Inter, sans-serif';
  const boldFont = 'bold 12px Inter, sans-serif';
  ctx.font = font;

  let maxW = 0;
  for (const l of lines) {
    ctx.font = l.bold ? boldFont : font;
    const w = ctx.measureText(l.text).width;
    if (w > maxW) maxW = w;
  }

  const tipW = maxW + padding * 2;
  const tipH = lines.length * lineH + padding * 2;

  // Position: offset from hex, keep on screen
  let tipX = hexScreenX + HEX_SIZE + 8;
  let tipY = hexScreenY - tipH / 2;

  // Clamp to canvas bounds
  if (tipX + tipW > canvasW - 10) tipX = hexScreenX - tipW - HEX_SIZE - 8;
  if (tipY < 10) tipY = 10;
  if (tipY + tipH > canvasH - 10) tipY = canvasH - tipH - 10;

  // Background
  ctx.fillStyle = 'rgba(12, 14, 16, 0.92)';
  ctx.strokeStyle = 'rgba(201, 168, 76, 0.35)';
  ctx.lineWidth = 1;
  const r = 6;
  ctx.beginPath();
  ctx.moveTo(tipX + r, tipY);
  ctx.lineTo(tipX + tipW - r, tipY);
  ctx.quadraticCurveTo(tipX + tipW, tipY, tipX + tipW, tipY + r);
  ctx.lineTo(tipX + tipW, tipY + tipH - r);
  ctx.quadraticCurveTo(tipX + tipW, tipY + tipH, tipX + tipW - r, tipY + tipH);
  ctx.lineTo(tipX + r, tipY + tipH);
  ctx.quadraticCurveTo(tipX, tipY + tipH, tipX, tipY + tipH - r);
  ctx.lineTo(tipX, tipY + r);
  ctx.quadraticCurveTo(tipX, tipY, tipX + r, tipY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Text
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.text) continue; // spacer
    ctx.font = l.bold ? boldFont : font;
    ctx.fillStyle = l.color || '#e8e8ec';
    ctx.fillText(l.text, tipX + padding, tipY + padding + i * lineH + lineH / 2);
  }

  ctx.restore();
}

export { render, resizeCanvas, centerCameraOnCity, computeVisibility, markVisibilityDirty, renderMiniMap, drawHoverTooltip };
