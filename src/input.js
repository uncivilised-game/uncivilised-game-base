import { MAP_COLS, MAP_ROWS, HEX_SIZE, SQRT3, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, DRAG_THRESHOLD, SAVE_KEY } from './constants.js';
import { game, canvas, ctx, miniCanvas, canvasW, canvasH, gameZoom, setGameZoom, isDragging, setIsDragging, hasDragged, setHasDragged, dragStartX, dragStartY, camStartX, camStartY, setDragState, hoveredHex, setHoveredHex, safeStorage, API, setGame } from './state.js';
import { hexToPixel, pixelToHex } from './hex.js';
import { render, resizeCanvas, centerCameraOnCity, computeVisibility } from './render.js';
import { handleHexClick, selectUnit, deselectUnit, selectNextUnit, autoSelectNext } from './units.js';
import { endTurn } from './turn.js';
import { togglePanel, closeAllPanels, renderBuildPanel, renderResearchPanel, renderUnitsPanel, toggleCivicsPanel, toggleVictoryPanel } from './ui-panels.js';
import { renderDiplomacyPanel } from './diplomacy.js';
import { updateUI } from './leaderboard.js';
import { addEvent, showToast } from './events.js';

// ============================================
// CAMERA HELPERS
// ============================================

export function clampCamera() {
  if (!canvasW || !canvasH) return;
  const totalW = MAP_COLS * HEX_SIZE * SQRT3;
  const totalH = MAP_ROWS * HEX_SIZE * 1.5 + HEX_SIZE;
  const viewW = canvasW / gameZoom;
  const viewH = canvasH / gameZoom;
  // If the view is larger than the map, center it
  if (viewW >= totalW) {
    game.cameraX = (totalW - viewW) / 2;
  } else {
    // Small padding to avoid showing edge of map
    game.cameraX = Math.max(-HEX_SIZE, Math.min(totalW - viewW + HEX_SIZE, game.cameraX));
  }
  if (viewH >= totalH) {
    game.cameraY = (totalH - viewH) / 2;
  } else {
    game.cameraY = Math.max(-HEX_SIZE, Math.min(totalH - viewH + HEX_SIZE, game.cameraY));
  }
}

export function zoomAtCenter(delta) {
  // Zoom keeping the center of the screen fixed in world space
  const cx = canvasW / 2;
  const cy = canvasH / 2;
  // World position at screen center
  const worldX = game.cameraX + cx / gameZoom;
  const worldY = game.cameraY + cy / gameZoom;

  setGameZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, gameZoom + delta)));

  // Reposition camera so same world point is at screen center
  game.cameraX = worldX - cx / gameZoom;
  game.cameraY = worldY - cy / gameZoom;
  clampCamera();
  render();
}

export function panCameraTo(col, row) {
  const pos = hexToPixel(col, row);
  game.cameraX = pos.x - (canvasW / gameZoom) / 2;
  game.cameraY = pos.y - (canvasH / gameZoom) / 2;
  clampCamera();
}

// ============================================
// INPUT HANDLER REGISTRATION
// ============================================

export function initInputHandlers() {
  // ---- Canvas mouse handlers ----

  canvas.addEventListener('mousedown', (e) => {
    setIsDragging(true);
    setHasDragged(false);
    setDragState(true, false, e.clientX, e.clientY, game.cameraX, game.cameraY);
  });

  canvas.addEventListener('mousemove', (e) => {
    // Always update hovered hex for tooltips
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / gameZoom + game.cameraX;
    const py = (e.clientY - rect.top) / gameZoom + game.cameraY;
    setHoveredHex(pixelToHex(px, py));

    if (isDragging) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      // Only start camera pan after passing the drag threshold
      if (!hasDragged && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) {
        render();
        return;
      }
      setHasDragged(true);
      game.cameraX = camStartX - dx / gameZoom;
      game.cameraY = camStartY - dy / gameZoom;
      clampCamera();
    }
    render();
  });

  canvas.addEventListener('mouseup', (e) => {
    const wasClick = !hasDragged && hoveredHex;
    const clickCol = hoveredHex?.col;
    const clickRow = hoveredHex?.row;
    // Reset drag state BEFORE handling click — if handleHexClick errors,
    // isDragging must not stay stuck at true (causes camera-follows-cursor bug)
    setIsDragging(false);
    setHasDragged(false);
    if (wasClick) {
      handleHexClick(clickCol, clickRow);
    }
  });

  canvas.addEventListener('mouseleave', () => { setIsDragging(false); setHasDragged(false); setHoveredHex(null); render(); });

  // ---- Block browser zoom but allow in-game zoom ----

  // 1. Ctrl/Cmd + scroll outside the canvas — block browser zoom
  //    (Canvas wheel handler below does its own preventDefault + in-game zoom)
  document.addEventListener('wheel', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.target !== canvas) {
      e.preventDefault();
    }
  }, { passive: false });

  // 2. Ctrl/Cmd + Plus/Minus/Zero keyboard zoom
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
      e.preventDefault();
    }
    // Enter key ends the turn (unless typing in an input/textarea, or game not active)
    if (e.key === 'Enter' && !e.target.closest('input, textarea, [contenteditable]')) {
      // Don't fire on title screen or when panels are open that might use Enter
      if (game && game.turn !== undefined && document.getElementById('game-screen')?.classList.contains('active')) {
        e.preventDefault();
        endTurn();
      }
    }
  });

  // 3. Safari gesture events — use for in-game zoom instead of just blocking
  let gestureStartZoom = 1;
  document.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    gestureStartZoom = gameZoom;
  }, { passive: false });
  document.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    if (!game) return;
    // e.scale is the cumulative pinch scale factor (1.0 = no change)
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, gestureStartZoom * e.scale));
    if (newZoom !== gameZoom) {
      // Zoom toward screen center
      const cx = canvasW / 2;
      const cy = canvasH / 2;
      const worldX = game.cameraX + cx / gameZoom;
      const worldY = game.cameraY + cy / gameZoom;
      setGameZoom(newZoom);
      game.cameraX = worldX - cx / gameZoom;
      game.cameraY = worldY - cy / gameZoom;
      clampCamera();
      render();
    }
  }, { passive: false });
  document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

  // ---- Canvas wheel (zoom + horizontal pan) ----

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!game) return;
    // Mac trackpad pinch sends ctrlKey + deltaY for zoom (Chrome synthesizes ctrlKey)
    const isPinchZoom = e.ctrlKey && !e.metaKey;
    const isHorizontalPan = !isPinchZoom && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5;

    if (isHorizontalPan) {
      game.cameraX += e.deltaX / gameZoom;
      clampCamera();
    } else {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const worldX = game.cameraX + mouseX / gameZoom;
      const worldY = game.cameraY + mouseY / gameZoom;

      let rawDelta;
      if (isPinchZoom) {
        // Trackpad pinch: deltaY is in pixels, can be large — use gentle scaling
        rawDelta = -e.deltaY * 0.005;
      } else {
        // Mouse wheel: use fixed step
        rawDelta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      }
      const zoomDelta = Math.max(-0.08, Math.min(0.08, rawDelta));
      setGameZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, gameZoom + zoomDelta)));

      game.cameraX = worldX - mouseX / gameZoom;
      game.cameraY = worldY - mouseY / gameZoom;
      clampCamera();
    }
    render();
  }, { passive: false });

  // ---- Touch support ----

  let touchStartX = 0, touchStartY = 0, touchHasDragged = false;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchStartX = t.clientX; touchStartY = t.clientY;
      setDragState(isDragging, hasDragged, dragStartX, dragStartY, game.cameraX, game.cameraY);
      touchHasDragged = false;
    }
  });
  let lastPinchDist = 0;
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      // Pinch to zoom
      touchHasDragged = true;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (lastPinchDist > 0) {
        const delta = dist - lastPinchDist;
        if (Math.abs(delta) > 2) {
          setGameZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, gameZoom + delta * 0.005)));
          clampCamera();
          render();
        }
      }
      lastPinchDist = dist;
      return;
    }
    lastPinchDist = 0;
    const t = e.touches[0];
    const tdx = t.clientX - touchStartX;
    const tdy = t.clientY - touchStartY;
    // Apply drag threshold for touch as well
    if (!touchHasDragged && Math.abs(tdx) + Math.abs(tdy) < DRAG_THRESHOLD) return;
    touchHasDragged = true;
    game.cameraX = camStartX - tdx / gameZoom;
    game.cameraY = camStartY - tdy / gameZoom;
    clampCamera();
    render();
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    lastPinchDist = 0;
    // Tap detection — if no drag happened, treat as a click
    if (!touchHasDragged && e.changedTouches.length > 0) {
      const t = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      const px = (t.clientX - rect.left) / gameZoom + game.cameraX;
      const py = (t.clientY - rect.top) / gameZoom + game.cameraY;
      const hex = pixelToHex(px, py);
      if (hex) handleHexClick(hex.col, hex.row);
    }
    touchHasDragged = false;
  });

  // ---- Mini-map click navigation ----

  miniCanvas.addEventListener('click', (e) => {
    const rect = miniCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const totalW = MAP_COLS * HEX_SIZE * SQRT3;
    const totalH = MAP_ROWS * HEX_SIZE * 1.5;
    game.cameraX = (mx / miniCanvas.width) * totalW - canvasW / 2;
    game.cameraY = (my / miniCanvas.height) * totalH - canvasH / 2;
    clampCamera();
    render();
  });

  // ---- Button event handlers ----

  // Close chat panel (diplomacy conversation)
  document.getElementById('chat-close').addEventListener('click', () => {
    document.getElementById('chat-panel').style.display = 'none';
  });

  document.getElementById('btn-new-game').addEventListener('click', () => window.startNewGame());
  document.getElementById('btn-continue').addEventListener('click', () => window.continueGame());
  document.getElementById('btn-end-turn').addEventListener('click', endTurn);
  document.getElementById('btn-diplomacy-list').addEventListener('click', () => togglePanel('diplomacy-panel'));
  document.getElementById('btn-build').addEventListener('click', () => togglePanel('build-panel'));
  document.getElementById('btn-research').addEventListener('click', () => togglePanel('research-panel'));
  document.getElementById('btn-units').addEventListener('click', () => togglePanel('units-panel'));
  document.getElementById('btn-civics').addEventListener('click', () => { if (typeof toggleCivicsPanel === 'function') toggleCivicsPanel(); });
  document.getElementById('btn-victory').addEventListener('click', () => { if (typeof toggleVictoryPanel === 'function') toggleVictoryPanel(); });
  document.getElementById('btn-menu').addEventListener('click', () => {
    closeAllPanels();
    document.getElementById('game-screen').classList.remove('active');
    document.getElementById('title-screen').classList.add('active');
    // Show continue button if there's a save
    try {
      const raw = safeStorage.getItem(SAVE_KEY);
      if (raw && JSON.parse(raw).game_state) {
        document.getElementById('btn-continue').style.display = 'block';
      }
    } catch(e) {}
  });
  document.getElementById('btn-new-game-end').addEventListener('click', () => window.startNewGame());

  // ---- Window resize ----

  window.addEventListener('resize', () => {
    if (document.getElementById('game-screen').classList.contains('active')) {
      resizeCanvas();
      render();
    }
  });
}
