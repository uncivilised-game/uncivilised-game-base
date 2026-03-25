#!/bin/sh
# Vercel build script — skips esbuild if game.js was pre-built with diplomacy
if grep -q 'Diplomacy plugin loaded' game.js 2>/dev/null; then
  echo 'Using pre-built game.js (diplomacy included)'
else
  npm run build
fi

mkdir -p .vercel-static
cp index.html about.html waitlist.html tile-world-preview.html game.js resource-icons.js style.css .vercel-static/
cp -r assets .vercel-static/assets
