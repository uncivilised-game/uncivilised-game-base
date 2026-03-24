import { BASE_COLORS } from './constants.js';
import { tilesLoaded } from './state.js';
import { drawHex } from './hex.js';
import { getTerrainTileImage } from './utils.js';

export function drawDetailedHex(ctx, sx, sy, tile, size) {
  const s = size;

  // 1) Flat base fill — use feature colour if available, else base terrain
  const dt = tile.feature || tile.base;
  const col = BASE_COLORS[dt] || BASE_COLORS[tile.base];
  if (!col) return;

  drawHex(ctx, sx, sy, s + 0.5);
  ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
  ctx.fill();

  // 2) Overlay terrain tile art if loaded
  if (tilesLoaded) {
    const tileImg = getTerrainTileImage(tile);
    if (tileImg && tileImg.complete && tileImg.naturalWidth > 0) {
      ctx.save();
      drawHex(ctx, sx, sy, s + 0.5);
      ctx.clip();
      ctx.globalAlpha = 0.48;
      const ds = s * 1.32;
      ctx.drawImage(tileImg, sx - ds, sy - ds, ds * 2, ds * 2);
      ctx.globalAlpha = 1.0;
      ctx.restore();
    }
  }
}
