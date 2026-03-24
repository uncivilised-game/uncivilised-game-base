#!/bin/bash
# Resilient dev server — auto-restarts on crash
# Usage: ./dev.sh

trap 'kill $(jobs -p) 2>/dev/null; exit' INT TERM

# Start esbuild watch in background
node esbuild.config.mjs --watch &
ESBUILD_PID=$!

echo "=== esbuild watch started (PID $ESBUILD_PID) ==="
echo "=== Starting server with auto-reload ==="

# Auto-restart loop for Python server
while true; do
    python3 server.py
    EXIT_CODE=$?
    echo ""
    echo "=== Server exited (code $EXIT_CODE). Restarting in 1s... ==="
    sleep 1
done
