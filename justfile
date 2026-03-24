set fallback := true

# Build the game.js bundle from src/ modules
build:
    npm run build

# Watch for changes and rebuild automatically
watch:
    npm run watch

# Start local dev server with auto-rebuild
dev:
    npm run watch &
    python server.py

# Clean build artifacts
clean:
    rm -f game.js game.js.map
