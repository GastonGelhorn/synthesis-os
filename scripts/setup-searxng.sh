#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  SearXNG Setup for SynthesisOS
#  Run: bash scripts/setup-searxng.sh
# ═══════════════════════════════════════════════════════════

set -e

CONTAINER_NAME="searxng-synthesis"
PORT=8080

echo "Setting up SearXNG for SynthesisOS..."

# Stop existing container if running
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Stopping existing container '${CONTAINER_NAME}'..."
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
fi

# Create settings directory
SETTINGS_DIR="$(pwd)/.searxng"
mkdir -p "$SETTINGS_DIR"

# Write settings.yml with JSON format enabled
cat > "$SETTINGS_DIR/settings.yml" << 'YAML'
use_default_settings: true

search:
  formats:
    - html
    - json
  default_lang: "en"
  autocomplete: "google"

server:
  secret_key: "synthesisos-searxng-secret-key-2024"
  limiter: false
  image_proxy: true

engines:
  - name: google
    engine: google
    shortcut: g
    disabled: false
  - name: duckduckgo
    engine: duckduckgo
    shortcut: ddg
    disabled: false
  - name: bing
    engine: bing
    shortcut: b
    disabled: false
  - name: wikipedia
    engine: wikipedia
    shortcut: w
    disabled: false
YAML

echo "Settings written to ${SETTINGS_DIR}/settings.yml"

# Run SearXNG container
echo "Starting SearXNG container on port ${PORT}..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -p "${PORT}:8080" \
  -v "${SETTINGS_DIR}/settings.yml:/etc/searxng/settings.yml:ro" \
  --restart unless-stopped \
  searxng/searxng

echo "Waiting for SearXNG to start..."
sleep 5

# Test the JSON API
echo "Testing JSON API..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/search?q=test&format=json" 2>/dev/null || echo "000")

if [ "$RESPONSE" = "200" ]; then
    echo "SearXNG is running and JSON format is enabled!"
    echo ""
    echo "   URL: http://localhost:${PORT}"
    echo "   Test: curl 'http://localhost:${PORT}/search?q=bitcoin+price&format=json' | python3 -m json.tool | head -30"
    echo ""
    echo "SynthesisOS is ready to search. Run 'npm run dev' in apps/desktop/"
else
    echo "SearXNG returned HTTP ${RESPONSE}. It may still be starting up."
    echo "   Wait 10 seconds and try: curl 'http://localhost:${PORT}/search?q=test&format=json'"
    echo "   Check logs: docker logs ${CONTAINER_NAME}"
fi
