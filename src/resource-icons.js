// ============================================
// DETAILED RESOURCE ICON RENDERER
// Hand-drawn canvas icons for each resource
// ============================================

import { RESOURCES } from './constants.js';

export function drawResourceIcon(ctx, sx, sy, resourceId, size) {
  const s = size || 10;
  ctx.save();

  // Background circle with shadow
  ctx.beginPath();
  ctx.arc(sx, sy, s + 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(sx, sy, s + 1, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(20,18,15,0.85)';
  ctx.fill();

  const res = RESOURCES[resourceId];
  if (!res) { ctx.restore(); return; }

  // Category ring color
  const cat = res.category || 'bonus';
  let ringColor;
  if (cat === 'strategic') ringColor = 'rgba(180,80,80,0.9)';
  else if (cat === 'luxury') ringColor = 'rgba(180,140,60,0.9)';
  else ringColor = 'rgba(120,160,120,0.8)';

  ctx.beginPath();
  ctx.arc(sx, sy, s + 1, 0, Math.PI * 2);
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Draw specific icon
  switch (resourceId) {
    case 'iron': drawIronIcon(ctx, sx, sy, s); break;
    case 'gold_ore': drawGoldOreIcon(ctx, sx, sy, s); break;
    case 'horses': drawHorsesIcon(ctx, sx, sy, s); break;
    case 'gems': drawGemsIcon(ctx, sx, sy, s); break;
    case 'wheat': drawWheatIcon(ctx, sx, sy, s); break;
    case 'stone': drawStoneIcon(ctx, sx, sy, s); break;
    case 'fish': drawFishIcon(ctx, sx, sy, s); break;
    case 'spices': drawSpicesIcon(ctx, sx, sy, s); break;
    case 'silk': drawSilkIcon(ctx, sx, sy, s); break;
    case 'copper': drawCopperIcon(ctx, sx, sy, s); break;
    case 'marble': drawMarbleIcon(ctx, sx, sy, s); break;
    case 'incense': drawIncenseIcon(ctx, sx, sy, s); break;
    case 'ivory': drawIvoryIcon(ctx, sx, sy, s); break;
    case 'dyes': drawDyesIcon(ctx, sx, sy, s); break;
    case 'furs': drawFursIcon(ctx, sx, sy, s); break;
    case 'salt': drawSaltIcon(ctx, sx, sy, s); break;
    case 'obsidian': drawObsidianIcon(ctx, sx, sy, s); break;
    case 'jade': drawJadeIcon(ctx, sx, sy, s); break;
    case 'wine': drawWineIcon(ctx, sx, sy, s); break;
    case 'cotton': drawCottonIcon(ctx, sx, sy, s); break;
    default:
      // Fallback: colored dot
      ctx.beginPath();
      ctx.arc(sx, sy, s * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = res.color;
      ctx.fill();
  }
  ctx.restore();
}

function drawIronIcon(ctx, sx, sy, s) {
  // Pickaxe / anvil shape
  const r = s * 0.7;
  // Anvil body
  ctx.fillStyle = '#8a8ea0';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.6, sy + r * 0.2);
  ctx.lineTo(sx + r * 0.6, sy + r * 0.2);
  ctx.lineTo(sx + r * 0.4, sy + r * 0.6);
  ctx.lineTo(sx - r * 0.4, sy + r * 0.6);
  ctx.closePath();
  ctx.fill();
  // Anvil top
  ctx.fillStyle = '#a0a4b4';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.8, sy - r * 0.1);
  ctx.lineTo(sx + r * 0.8, sy - r * 0.1);
  ctx.lineTo(sx + r * 0.6, sy + r * 0.2);
  ctx.lineTo(sx - r * 0.6, sy + r * 0.2);
  ctx.closePath();
  ctx.fill();
  // Sword on top
  ctx.strokeStyle = '#c0c4d0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy - r * 0.8);
  ctx.lineTo(sx, sy - r * 0.1);
  ctx.stroke();
  // Crossguard
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.35, sy - r * 0.3);
  ctx.lineTo(sx + r * 0.35, sy - r * 0.3);
  ctx.stroke();
  // Highlight
  ctx.fillStyle = 'rgba(200,210,230,0.3)';
  ctx.fillRect(sx - r * 0.15, sy - r * 0.7, r * 0.12, r * 0.5);
}

function drawGoldOreIcon(ctx, sx, sy, s) {
  const r = s * 0.7;
  // Gold nugget shape — irregular blob
  ctx.fillStyle = '#d4a520';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.3, sy - r * 0.5);
  ctx.quadraticCurveTo(sx + r * 0.1, sy - r * 0.7, sx + r * 0.5, sy - r * 0.3);
  ctx.quadraticCurveTo(sx + r * 0.7, sy + r * 0.1, sx + r * 0.3, sy + r * 0.5);
  ctx.quadraticCurveTo(sx - r * 0.1, sy + r * 0.7, sx - r * 0.5, sy + r * 0.3);
  ctx.quadraticCurveTo(sx - r * 0.6, sy - r * 0.2, sx - r * 0.3, sy - r * 0.5);
  ctx.closePath();
  ctx.fill();
  // Highlight
  ctx.fillStyle = '#f0d050';
  ctx.beginPath();
  ctx.arc(sx - r * 0.1, sy - r * 0.15, r * 0.25, 0, Math.PI * 2);
  ctx.fill();
  // Sparkle
  ctx.fillStyle = '#fff8d0';
  ctx.beginPath();
  ctx.arc(sx - r * 0.15, sy - r * 0.25, r * 0.08, 0, Math.PI * 2);
  ctx.fill();
  // Dark edge
  ctx.strokeStyle = '#a08010';
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function drawHorsesIcon(ctx, sx, sy, s) {
  const r = s * 0.75;
  // Horse head silhouette
  ctx.fillStyle = '#8b6240';
  ctx.beginPath();
  // Body/neck
  ctx.moveTo(sx - r * 0.3, sy + r * 0.6);
  ctx.quadraticCurveTo(sx - r * 0.5, sy + r * 0.1, sx - r * 0.3, sy - r * 0.3);
  // Head
  ctx.quadraticCurveTo(sx - r * 0.1, sy - r * 0.7, sx + r * 0.3, sy - r * 0.5);
  // Muzzle
  ctx.quadraticCurveTo(sx + r * 0.6, sy - r * 0.4, sx + r * 0.5, sy - r * 0.15);
  ctx.quadraticCurveTo(sx + r * 0.3, sy, sx + r * 0.1, sy + r * 0.1);
  // Chest
  ctx.quadraticCurveTo(sx, sy + r * 0.4, sx - r * 0.3, sy + r * 0.6);
  ctx.closePath();
  ctx.fill();
  // Ear
  ctx.fillStyle = '#7a5535';
  ctx.beginPath();
  ctx.moveTo(sx, sy - r * 0.55);
  ctx.lineTo(sx + r * 0.08, sy - r * 0.85);
  ctx.lineTo(sx + r * 0.2, sy - r * 0.5);
  ctx.closePath();
  ctx.fill();
  // Eye
  ctx.fillStyle = '#1a1008';
  ctx.beginPath();
  ctx.arc(sx + r * 0.15, sy - r * 0.3, r * 0.07, 0, Math.PI * 2);
  ctx.fill();
  // Mane highlight
  ctx.strokeStyle = '#a07850';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.15, sy - r * 0.5);
  ctx.quadraticCurveTo(sx - r * 0.35, sy - r * 0.15, sx - r * 0.3, sy + r * 0.1);
  ctx.stroke();
}

function drawGemsIcon(ctx, sx, sy, s) {
  const r = s * 0.65;
  // Diamond shape with facets
  // Main gem
  ctx.fillStyle = '#8b5fcf';
  ctx.beginPath();
  ctx.moveTo(sx, sy - r * 0.8);
  ctx.lineTo(sx + r * 0.6, sy - r * 0.15);
  ctx.lineTo(sx + r * 0.35, sy + r * 0.7);
  ctx.lineTo(sx - r * 0.35, sy + r * 0.7);
  ctx.lineTo(sx - r * 0.6, sy - r * 0.15);
  ctx.closePath();
  ctx.fill();
  // Top facet
  ctx.fillStyle = '#a580e0';
  ctx.beginPath();
  ctx.moveTo(sx, sy - r * 0.8);
  ctx.lineTo(sx + r * 0.6, sy - r * 0.15);
  ctx.lineTo(sx + r * 0.1, sy - r * 0.15);
  ctx.lineTo(sx, sy - r * 0.3);
  ctx.closePath();
  ctx.fill();
  // Left facet
  ctx.fillStyle = '#7048b0';
  ctx.beginPath();
  ctx.moveTo(sx, sy - r * 0.8);
  ctx.lineTo(sx - r * 0.6, sy - r * 0.15);
  ctx.lineTo(sx - r * 0.1, sy - r * 0.15);
  ctx.lineTo(sx, sy - r * 0.3);
  ctx.closePath();
  ctx.fill();
  // Sparkle
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(sx - r * 0.1, sy - r * 0.4, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
  // Edge
  ctx.strokeStyle = '#6040a0';
  ctx.lineWidth = 0.7;
  ctx.stroke();
}

function drawWheatIcon(ctx, sx, sy, s) {
  const r = s * 0.7;
  // Wheat stalk
  ctx.strokeStyle = '#b8942a';
  ctx.lineWidth = 1.2;
  // Main stem
  ctx.beginPath();
  ctx.moveTo(sx, sy + r * 0.8);
  ctx.quadraticCurveTo(sx + r * 0.05, sy, sx, sy - r * 0.3);
  ctx.stroke();
  // Grain kernels (alternating left-right)
  ctx.fillStyle = '#d4a830';
  const kernelPositions = [
    [-0.2, -0.55], [0.2, -0.45], [-0.2, -0.3], [0.2, -0.2], [-0.18, -0.05], [0.18, 0.05]
  ];
  for (const [kx, ky] of kernelPositions) {
    ctx.beginPath();
    ctx.ellipse(sx + r * kx, sy + r * ky, r * 0.12, r * 0.08, kx < 0 ? -0.4 : 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Top awns
  ctx.strokeStyle = '#c0a030';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(sx, sy - r * 0.3);
  ctx.lineTo(sx - r * 0.15, sy - r * 0.85);
  ctx.moveTo(sx, sy - r * 0.3);
  ctx.lineTo(sx + r * 0.15, sy - r * 0.85);
  ctx.moveTo(sx, sy - r * 0.3);
  ctx.lineTo(sx, sy - r * 0.9);
  ctx.stroke();
}

function drawStoneIcon(ctx, sx, sy, s) {
  const r = s * 0.7;
  // Stacked stone blocks
  // Bottom block
  ctx.fillStyle = '#7a7a7a';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.7, sy + r * 0.2);
  ctx.lineTo(sx + r * 0.7, sy + r * 0.2);
  ctx.lineTo(sx + r * 0.7, sy + r * 0.65);
  ctx.lineTo(sx - r * 0.7, sy + r * 0.65);
  ctx.closePath();
  ctx.fill();
  // Top block
  ctx.fillStyle = '#8e8e8e';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.5, sy - r * 0.3);
  ctx.lineTo(sx + r * 0.5, sy - r * 0.3);
  ctx.lineTo(sx + r * 0.5, sy + r * 0.2);
  ctx.lineTo(sx - r * 0.5, sy + r * 0.2);
  ctx.closePath();
  ctx.fill();
  // Cap stone
  ctx.fillStyle = '#a0a0a0';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.3, sy - r * 0.65);
  ctx.lineTo(sx + r * 0.3, sy - r * 0.65);
  ctx.lineTo(sx + r * 0.3, sy - r * 0.3);
  ctx.lineTo(sx - r * 0.3, sy - r * 0.3);
  ctx.closePath();
  ctx.fill();
  // Mortar lines
  ctx.strokeStyle = 'rgba(40,40,40,0.4)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.7, sy + r * 0.2);
  ctx.lineTo(sx + r * 0.7, sy + r * 0.2);
  ctx.moveTo(sx - r * 0.5, sy - r * 0.3);
  ctx.lineTo(sx + r * 0.5, sy - r * 0.3);
  ctx.moveTo(sx, sy + r * 0.2);
  ctx.lineTo(sx, sy + r * 0.65);
  ctx.stroke();
}

function drawFishIcon(ctx, sx, sy, s) {
  const r = s * 0.75;
  // Fish body
  ctx.fillStyle = '#4a9ad4';
  ctx.beginPath();
  ctx.moveTo(sx + r * 0.7, sy);
  ctx.quadraticCurveTo(sx + r * 0.3, sy - r * 0.5, sx - r * 0.2, sy - r * 0.3);
  ctx.quadraticCurveTo(sx - r * 0.5, sy - r * 0.15, sx - r * 0.5, sy);
  ctx.quadraticCurveTo(sx - r * 0.5, sy + r * 0.15, sx - r * 0.2, sy + r * 0.3);
  ctx.quadraticCurveTo(sx + r * 0.3, sy + r * 0.5, sx + r * 0.7, sy);
  ctx.closePath();
  ctx.fill();
  // Tail
  ctx.fillStyle = '#3a88c0';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.5, sy);
  ctx.lineTo(sx - r * 0.85, sy - r * 0.35);
  ctx.lineTo(sx - r * 0.6, sy);
  ctx.lineTo(sx - r * 0.85, sy + r * 0.35);
  ctx.closePath();
  ctx.fill();
  // Belly
  ctx.fillStyle = '#7abce8';
  ctx.beginPath();
  ctx.ellipse(sx + r * 0.1, sy + r * 0.05, r * 0.3, r * 0.12, 0.1, 0, Math.PI * 2);
  ctx.fill();
  // Eye
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(sx + r * 0.35, sy - r * 0.08, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.arc(sx + r * 0.37, sy - r * 0.08, r * 0.05, 0, Math.PI * 2);
  ctx.fill();
}

function drawSpicesIcon(ctx, sx, sy, s) {
  const r = s * 0.65;
  // Spice pile with small peppers/leaves
  // Bowl shape
  ctx.fillStyle = '#8b5e3a';
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.3, r * 0.7, r * 0.25, 0, 0, Math.PI);
  ctx.fill();
  // Spice mound
  ctx.fillStyle = '#d4743a';
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.1, r * 0.55, r * 0.35, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // Colored spice accents
  ctx.fillStyle = '#e0a030';
  ctx.beginPath();
  ctx.arc(sx - r * 0.2, sy, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c04020';
  ctx.beginPath();
  ctx.arc(sx + r * 0.15, sy - r * 0.05, r * 0.08, 0, Math.PI * 2);
  ctx.fill();
  // Small chili on top
  ctx.fillStyle = '#c83030';
  ctx.beginPath();
  ctx.moveTo(sx + r * 0.05, sy - r * 0.15);
  ctx.quadraticCurveTo(sx + r * 0.35, sy - r * 0.5, sx + r * 0.15, sy - r * 0.6);
  ctx.quadraticCurveTo(sx + r * 0.25, sy - r * 0.35, sx + r * 0.05, sy - r * 0.15);
  ctx.fill();
  // Stem
  ctx.strokeStyle = '#3a7a30';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(sx + r * 0.15, sy - r * 0.6);
  ctx.lineTo(sx + r * 0.2, sy - r * 0.75);
  ctx.stroke();
}

function drawSilkIcon(ctx, sx, sy, s) {
  const r = s * 0.7;
  // Silk fabric/ribbon flowing
  ctx.fillStyle = '#c495d9';
  // Main ribbon wave
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.7, sy - r * 0.2);
  ctx.bezierCurveTo(sx - r * 0.3, sy - r * 0.6, sx + r * 0.1, sy + r * 0.2, sx + r * 0.5, sy - r * 0.3);
  ctx.lineTo(sx + r * 0.7, sy - r * 0.1);
  ctx.bezierCurveTo(sx + r * 0.2, sy + r * 0.5, sx - r * 0.2, sy - r * 0.2, sx - r * 0.7, sy + r * 0.3);
  ctx.closePath();
  ctx.fill();
  // Shimmer highlight
  ctx.fillStyle = 'rgba(220,180,240,0.5)';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.4, sy - r * 0.15);
  ctx.bezierCurveTo(sx - r * 0.1, sy - r * 0.4, sx + r * 0.2, sy + r * 0.1, sx + r * 0.4, sy - r * 0.2);
  ctx.lineTo(sx + r * 0.3, sy - r * 0.05);
  ctx.bezierCurveTo(sx + r * 0.1, sy + r * 0.15, sx - r * 0.15, sy - r * 0.2, sx - r * 0.4, sy + r * 0.05);
  ctx.closePath();
  ctx.fill();
  // Edge lines
  ctx.strokeStyle = '#a070c0';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.7, sy - r * 0.2);
  ctx.bezierCurveTo(sx - r * 0.3, sy - r * 0.6, sx + r * 0.1, sy + r * 0.2, sx + r * 0.5, sy - r * 0.3);
  ctx.stroke();
}

function drawCopperIcon(ctx, sx, sy, s) {
  const r = s * 0.65;
  // Copper ingot / bar shape
  // Main ingot
  ctx.fillStyle = '#c87a3a';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.5, sy - r * 0.2);
  ctx.lineTo(sx + r * 0.5, sy - r * 0.2);
  ctx.lineTo(sx + r * 0.6, sy + r * 0.1);
  ctx.lineTo(sx + r * 0.4, sy + r * 0.55);
  ctx.lineTo(sx - r * 0.4, sy + r * 0.55);
  ctx.lineTo(sx - r * 0.6, sy + r * 0.1);
  ctx.closePath();
  ctx.fill();
  // Top face (3D effect)
  ctx.fillStyle = '#d89050';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.5, sy - r * 0.2);
  ctx.lineTo(sx + r * 0.5, sy - r * 0.2);
  ctx.lineTo(sx + r * 0.35, sy - r * 0.55);
  ctx.lineTo(sx - r * 0.35, sy - r * 0.55);
  ctx.closePath();
  ctx.fill();
  // Highlight
  ctx.fillStyle = 'rgba(240,180,100,0.4)';
  ctx.fillRect(sx - r * 0.2, sy - r * 0.4, r * 0.25, r * 0.15);
  // Edge
  ctx.strokeStyle = '#a06030';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.35, sy - r * 0.55);
  ctx.lineTo(sx + r * 0.35, sy - r * 0.55);
  ctx.lineTo(sx + r * 0.5, sy - r * 0.2);
  ctx.lineTo(sx + r * 0.6, sy + r * 0.1);
  ctx.lineTo(sx + r * 0.4, sy + r * 0.55);
  ctx.lineTo(sx - r * 0.4, sy + r * 0.55);
  ctx.lineTo(sx - r * 0.6, sy + r * 0.1);
  ctx.lineTo(sx - r * 0.5, sy - r * 0.2);
  ctx.lineTo(sx - r * 0.35, sy - r * 0.55);
  ctx.stroke();
}

function drawMarbleIcon(ctx, sx, sy, s) {
  const r = s * 0.7;
  // Polished block
  ctx.fillStyle = '#e8e4e0';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.55, sy - r * 0.4);
  ctx.lineTo(sx + r * 0.55, sy - r * 0.4);
  ctx.lineTo(sx + r * 0.55, sy + r * 0.5);
  ctx.lineTo(sx - r * 0.55, sy + r * 0.5);
  ctx.closePath();
  ctx.fill();
  // Top face
  ctx.fillStyle = '#f0ece8';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.55, sy - r * 0.4);
  ctx.lineTo(sx - r * 0.3, sy - r * 0.65);
  ctx.lineTo(sx + r * 0.7, sy - r * 0.65);
  ctx.lineTo(sx + r * 0.55, sy - r * 0.4);
  ctx.closePath();
  ctx.fill();
  // Grey veins
  ctx.strokeStyle = 'rgba(160,155,150,0.5)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.3, sy - r * 0.2);
  ctx.quadraticCurveTo(sx, sy + r * 0.1, sx + r * 0.3, sy - r * 0.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.1, sy + r * 0.1);
  ctx.quadraticCurveTo(sx + r * 0.2, sy + r * 0.3, sx + r * 0.4, sy + r * 0.15);
  ctx.stroke();
  // Highlight
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(sx - r * 0.4, sy - r * 0.55, r * 0.2, r * 0.1);
}

function drawIncenseIcon(ctx, sx, sy, s) {
  const r = s * 0.7;
  // Censer bowl
  ctx.fillStyle = '#8b6240';
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.35, r * 0.4, r * 0.2, 0, 0, Math.PI);
  ctx.fill();
  // Bowl body
  ctx.fillStyle = '#a07850';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.35, sy + r * 0.15);
  ctx.lineTo(sx + r * 0.35, sy + r * 0.15);
  ctx.lineTo(sx + r * 0.4, sy + r * 0.35);
  ctx.lineTo(sx - r * 0.4, sy + r * 0.35);
  ctx.closePath();
  ctx.fill();
  // Stand
  ctx.fillStyle = '#7a5535';
  ctx.fillRect(sx - r * 0.08, sy + r * 0.35, r * 0.16, r * 0.25);
  // Smoke wisps
  ctx.strokeStyle = 'rgba(200,200,210,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx, sy + r * 0.15);
  ctx.quadraticCurveTo(sx + r * 0.2, sy - r * 0.15, sx, sy - r * 0.4);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(200,200,210,0.35)';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.1, sy + r * 0.1);
  ctx.quadraticCurveTo(sx - r * 0.3, sy - r * 0.2, sx - r * 0.1, sy - r * 0.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + r * 0.1, sy + r * 0.1);
  ctx.quadraticCurveTo(sx + r * 0.25, sy - r * 0.3, sx + r * 0.15, sy - r * 0.6);
  ctx.stroke();
}

function drawIvoryIcon(ctx, sx, sy, s) {
  const r = s * 0.75;
  // Curved tusk
  ctx.fillStyle = '#f0e8d8';
  ctx.beginPath();
  ctx.moveTo(sx + r * 0.1, sy + r * 0.7);
  ctx.quadraticCurveTo(sx + r * 0.5, sy + r * 0.2, sx + r * 0.3, sy - r * 0.3);
  ctx.quadraticCurveTo(sx + r * 0.1, sy - r * 0.7, sx - r * 0.15, sy - r * 0.6);
  ctx.quadraticCurveTo(sx - r * 0.05, sy - r * 0.4, sx + r * 0.1, sy - r * 0.15);
  ctx.quadraticCurveTo(sx + r * 0.3, sy + r * 0.15, sx - r * 0.1, sy + r * 0.6);
  ctx.closePath();
  ctx.fill();
  // Highlight ridge
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(sx + r * 0.05, sy + r * 0.5);
  ctx.quadraticCurveTo(sx + r * 0.3, sy, sx + r * 0.05, sy - r * 0.45);
  ctx.stroke();
  // Base shadow
  ctx.strokeStyle = 'rgba(180,170,150,0.6)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.1, sy + r * 0.6);
  ctx.quadraticCurveTo(sx + r * 0.35, sy + r * 0.3, sx + r * 0.15, sy - r * 0.2);
  ctx.stroke();
}

function drawDyesIcon(ctx, sx, sy, s) {
  const r = s * 0.65;
  // Pot
  ctx.fillStyle = '#7a5a3a';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.4, sy - r * 0.1);
  ctx.lineTo(sx + r * 0.4, sy - r * 0.1);
  ctx.lineTo(sx + r * 0.3, sy + r * 0.6);
  ctx.lineTo(sx - r * 0.3, sy + r * 0.6);
  ctx.closePath();
  ctx.fill();
  // Pot rim
  ctx.fillStyle = '#8a6a4a';
  ctx.beginPath();
  ctx.ellipse(sx, sy - r * 0.1, r * 0.45, r * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  // Color splashes
  ctx.fillStyle = '#d04040';
  ctx.beginPath();
  ctx.arc(sx - r * 0.3, sy - r * 0.35, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3080d0';
  ctx.beginPath();
  ctx.arc(sx + r * 0.25, sy - r * 0.45, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d0c020';
  ctx.beginPath();
  ctx.arc(sx + r * 0.05, sy - r * 0.55, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
}

function drawFursIcon(ctx, sx, sy, s) {
  const r = s * 0.7;
  // Pelt shape
  ctx.fillStyle = '#8b6540';
  ctx.beginPath();
  ctx.moveTo(sx, sy - r * 0.7);
  ctx.quadraticCurveTo(sx + r * 0.5, sy - r * 0.5, sx + r * 0.6, sy - r * 0.1);
  ctx.quadraticCurveTo(sx + r * 0.7, sy + r * 0.3, sx + r * 0.4, sy + r * 0.6);
  ctx.quadraticCurveTo(sx + r * 0.1, sy + r * 0.7, sx - r * 0.1, sy + r * 0.6);
  ctx.quadraticCurveTo(sx - r * 0.5, sy + r * 0.5, sx - r * 0.6, sy + r * 0.1);
  ctx.quadraticCurveTo(sx - r * 0.6, sy - r * 0.4, sx, sy - r * 0.7);
  ctx.closePath();
  ctx.fill();
  // Lighter belly area
  ctx.fillStyle = '#a88060';
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.05, r * 0.3, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Fur texture lines
  ctx.strokeStyle = 'rgba(60,40,20,0.4)';
  ctx.lineWidth = 0.5;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(sx + i * r * 0.15, sy - r * 0.3);
    ctx.lineTo(sx + i * r * 0.12, sy + r * 0.3);
    ctx.stroke();
  }
}

function drawSaltIcon(ctx, sx, sy, s) {
  const r = s * 0.65;
  // Crystal pile — multiple angular crystals
  // Large center crystal
  ctx.fillStyle = '#e8e8f0';
  ctx.beginPath();
  ctx.moveTo(sx, sy - r * 0.7);
  ctx.lineTo(sx + r * 0.3, sy - r * 0.1);
  ctx.lineTo(sx + r * 0.15, sy + r * 0.3);
  ctx.lineTo(sx - r * 0.15, sy + r * 0.3);
  ctx.lineTo(sx - r * 0.3, sy - r * 0.1);
  ctx.closePath();
  ctx.fill();
  // Left crystal
  ctx.fillStyle = '#d8d8e4';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.4, sy - r * 0.3);
  ctx.lineTo(sx - r * 0.15, sy);
  ctx.lineTo(sx - r * 0.25, sy + r * 0.4);
  ctx.lineTo(sx - r * 0.55, sy + r * 0.2);
  ctx.closePath();
  ctx.fill();
  // Right crystal
  ctx.fillStyle = '#dcdce8';
  ctx.beginPath();
  ctx.moveTo(sx + r * 0.5, sy - r * 0.2);
  ctx.lineTo(sx + r * 0.55, sy + r * 0.25);
  ctx.lineTo(sx + r * 0.25, sy + r * 0.45);
  ctx.lineTo(sx + r * 0.2, sy + r * 0.05);
  ctx.closePath();
  ctx.fill();
  // Sparkle
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(sx - r * 0.05, sy - r * 0.35, r * 0.08, 0, Math.PI * 2);
  ctx.fill();
}

function drawObsidianIcon(ctx, sx, sy, s) {
  const r = s * 0.7;
  // Dark angular shard
  ctx.fillStyle = '#1a1a24';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.1, sy - r * 0.8);
  ctx.lineTo(sx + r * 0.35, sy - r * 0.2);
  ctx.lineTo(sx + r * 0.5, sy + r * 0.4);
  ctx.lineTo(sx + r * 0.1, sy + r * 0.7);
  ctx.lineTo(sx - r * 0.3, sy + r * 0.3);
  ctx.lineTo(sx - r * 0.4, sy - r * 0.3);
  ctx.closePath();
  ctx.fill();
  // Glossy highlight facet
  ctx.fillStyle = 'rgba(100,100,140,0.4)';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.1, sy - r * 0.8);
  ctx.lineTo(sx + r * 0.35, sy - r * 0.2);
  ctx.lineTo(sx + r * 0.1, sy + r * 0.1);
  ctx.lineTo(sx - r * 0.2, sy - r * 0.2);
  ctx.closePath();
  ctx.fill();
  // Sharp edge gleam
  ctx.strokeStyle = 'rgba(180,180,220,0.5)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.1, sy - r * 0.8);
  ctx.lineTo(sx + r * 0.35, sy - r * 0.2);
  ctx.stroke();
}

function drawJadeIcon(ctx, sx, sy, s) {
  const r = s * 0.65;
  // Carved oval pendant
  ctx.fillStyle = '#3a8a50';
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * 0.5, r * 0.65, 0, 0, Math.PI * 2);
  ctx.fill();
  // Inner ring carving
  ctx.strokeStyle = '#2a6a3a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * 0.3, r * 0.45, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Center hole
  ctx.fillStyle = '#1a4a28';
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * 0.12, r * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  // Highlight shimmer
  ctx.fillStyle = 'rgba(120,220,140,0.35)';
  ctx.beginPath();
  ctx.ellipse(sx - r * 0.15, sy - r * 0.2, r * 0.18, r * 0.12, -0.4, 0, Math.PI * 2);
  ctx.fill();
  // String/cord at top
  ctx.strokeStyle = '#8a7a60';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.15, sy - r * 0.65);
  ctx.quadraticCurveTo(sx, sy - r * 0.85, sx + r * 0.15, sy - r * 0.65);
  ctx.stroke();
}

function drawWineIcon(ctx, sx, sy, s) {
  const r = s * 0.7;
  // Amphora body
  ctx.fillStyle = '#b06040';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.15, sy - r * 0.5);
  ctx.quadraticCurveTo(sx - r * 0.45, sy - r * 0.1, sx - r * 0.35, sy + r * 0.35);
  ctx.quadraticCurveTo(sx - r * 0.2, sy + r * 0.65, sx, sy + r * 0.7);
  ctx.quadraticCurveTo(sx + r * 0.2, sy + r * 0.65, sx + r * 0.35, sy + r * 0.35);
  ctx.quadraticCurveTo(sx + r * 0.45, sy - r * 0.1, sx + r * 0.15, sy - r * 0.5);
  ctx.closePath();
  ctx.fill();
  // Neck
  ctx.fillStyle = '#a05838';
  ctx.fillRect(sx - r * 0.1, sy - r * 0.75, r * 0.2, r * 0.3);
  // Rim
  ctx.fillStyle = '#c07050';
  ctx.beginPath();
  ctx.ellipse(sx, sy - r * 0.75, r * 0.15, r * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  // Handles
  ctx.strokeStyle = '#905030';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.15, sy - r * 0.45);
  ctx.quadraticCurveTo(sx - r * 0.55, sy - r * 0.25, sx - r * 0.35, sy + r * 0.05);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + r * 0.15, sy - r * 0.45);
  ctx.quadraticCurveTo(sx + r * 0.55, sy - r * 0.25, sx + r * 0.35, sy + r * 0.05);
  ctx.stroke();
  // Highlight
  ctx.fillStyle = 'rgba(240,180,140,0.3)';
  ctx.fillRect(sx - r * 0.25, sy - r * 0.2, r * 0.12, r * 0.3);
}

function drawCottonIcon(ctx, sx, sy, s) {
  const r = s * 0.7;
  // Stem
  ctx.strokeStyle = '#5a7a40';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(sx, sy + r * 0.7);
  ctx.quadraticCurveTo(sx + r * 0.05, sy + r * 0.2, sx, sy);
  ctx.stroke();
  // Small leaves
  ctx.fillStyle = '#4a7a35';
  ctx.beginPath();
  ctx.moveTo(sx, sy + r * 0.15);
  ctx.quadraticCurveTo(sx - r * 0.3, sy + r * 0.05, sx - r * 0.15, sy + r * 0.3);
  ctx.quadraticCurveTo(sx - r * 0.05, sy + r * 0.2, sx, sy + r * 0.15);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(sx, sy + r * 0.15);
  ctx.quadraticCurveTo(sx + r * 0.3, sy + r * 0.05, sx + r * 0.15, sy + r * 0.3);
  ctx.quadraticCurveTo(sx + r * 0.05, sy + r * 0.2, sx, sy + r * 0.15);
  ctx.fill();
  // Cotton boll — fluffy white puffs
  ctx.fillStyle = '#f0ece8';
  ctx.beginPath();
  ctx.arc(sx, sy - r * 0.2, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx - r * 0.22, sy - r * 0.05, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + r * 0.22, sy - r * 0.05, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx - r * 0.1, sy - r * 0.38, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + r * 0.1, sy - r * 0.38, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  // Soft highlight
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(sx - r * 0.05, sy - r * 0.3, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
}
