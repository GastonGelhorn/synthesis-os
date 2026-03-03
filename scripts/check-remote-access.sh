#!/bin/bash
# ─────────────────────────────────────────────────────────────
# SynthesisOS — Remote Access Diagnostics & Setup
# Run from repo root:  bash scripts/check-remote-access.sh
# Use --force-cert to regenerate certificates even if they exist.
# ─────────────────────────────────────────────────────────────

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

FORCE_CERT=false
if [[ "${1:-}" == "--force-cert" ]]; then
    FORCE_CERT=true
fi

APP_ID="com.synthesis.synthesis-os"
APP_DATA_DIR="$HOME/Library/Application Support/$APP_ID"
TLS_DIR="$APP_DATA_DIR/tls"
CERT_FILE="$TLS_DIR/cert.pem"
KEY_FILE="$TLS_DIR/key.pem"
HTTP_PORT=3939
HTTPS_PORT=3940
ENV_FILE="$(dirname "$0")/../apps/desktop/.env"

echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}  SynthesisOS Remote Access Diagnostics${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""

# ── 1. Detect local IP ──────────────────────────────────────
echo -e "${CYAN}[1/6] Detecting local IP...${NC}"
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
if [ -z "$LOCAL_IP" ]; then
    echo -e "${RED}  ✗ Could not detect local IP. Are you connected to WiFi?${NC}"
    exit 1
fi
echo -e "${GREEN}  ✓ Local IP: ${LOCAL_IP}${NC}"
echo ""

# ── 2. Check HTTP backend ───────────────────────────────────
echo -e "${CYAN}[2/6] Checking HTTP backend (port $HTTP_PORT)...${NC}"
if curl -s --connect-timeout 3 "http://localhost:$HTTP_PORT/api/auth/setup-status" > /dev/null 2>&1; then
    echo -e "${GREEN}  ✓ HTTP backend is running on port $HTTP_PORT${NC}"
    HTTP_OK=true
else
    echo -e "${RED}  ✗ HTTP backend NOT reachable on port $HTTP_PORT${NC}"
    echo -e "${YELLOW}    → Make sure SynthesisOS.app is open on this Mac${NC}"
    HTTP_OK=false
fi
echo ""

# ── 3. Generate / verify TLS certificates ────────────────────
echo -e "${CYAN}[3/6] Checking TLS certificates...${NC}"
NEEDS_CERT=false

if [ "$FORCE_CERT" = true ]; then
    echo -e "${YELLOW}  ⚠ --force-cert: regenerating certificates${NC}"
    NEEDS_CERT=true
elif [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    # Verify IP coverage
    CERT_HAS_IP=true
    if ! openssl x509 -in "$CERT_FILE" -noout -text 2>/dev/null | grep -q "$LOCAL_IP"; then
        echo -e "${YELLOW}  ⚠ Certificate does NOT include $LOCAL_IP${NC}"
        CERT_HAS_IP=false
        NEEDS_CERT=true
    fi
    # Verify validity dates
    if [ "$CERT_HAS_IP" = true ]; then
        NOT_BEFORE=$(openssl x509 -in "$CERT_FILE" -noout -startdate 2>/dev/null | sed 's/notBefore=//')
        NOT_AFTER=$(openssl x509 -in "$CERT_FILE" -noout -enddate 2>/dev/null | sed 's/notAfter=//')
        # Check if cert is currently valid
        if openssl x509 -in "$CERT_FILE" -noout -checkend 0 2>/dev/null; then
            echo -e "${GREEN}  ✓ Cert valid: $NOT_BEFORE → $NOT_AFTER${NC}"
            echo -e "${GREEN}  ✓ Cert covers IP $LOCAL_IP${NC}"
        else
            echo -e "${YELLOW}  ⚠ Certificate expired or not yet valid ($NOT_BEFORE → $NOT_AFTER)${NC}"
            NEEDS_CERT=true
        fi
    fi
else
    echo -e "${YELLOW}  ⚠ TLS certificates not found${NC}"
    NEEDS_CERT=true
fi

if [ "$NEEDS_CERT" = true ]; then
    echo -e "${CYAN}    Generating self-signed certificate with openssl...${NC}"
    mkdir -p "$TLS_DIR"

    # Remove old certs + rcgen fingerprint
    rm -f "$CERT_FILE" "$KEY_FILE" "$TLS_DIR/sans.txt"

    SAN_CONF=$(mktemp)
    cat > "$SAN_CONF" <<SANEOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_ca

[dn]
CN = SynthesisOS Dev TLS

[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical, digitalSignature, keyCertSign
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = $LOCAL_IP
SANEOF

    openssl req -x509 -newkey rsa:2048 \
        -keyout "$KEY_FILE" \
        -out "$CERT_FILE" \
        -days 825 -nodes \
        -config "$SAN_CONF" 2>/dev/null
    rm -f "$SAN_CONF"

    # Write IP fingerprint so Rust doesn't overwrite our cert
    echo "$LOCAL_IP" > "$TLS_DIR/sans.txt"

    if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
        NOT_BEFORE=$(openssl x509 -in "$CERT_FILE" -noout -startdate 2>/dev/null | sed 's/notBefore=//')
        NOT_AFTER=$(openssl x509 -in "$CERT_FILE" -noout -enddate 2>/dev/null | sed 's/notAfter=//')
        echo -e "${GREEN}  ✓ Certificate generated (openssl)${NC}"
        echo -e "${GREEN}    SANs: localhost, 127.0.0.1, $LOCAL_IP${NC}"
        echo -e "${GREEN}    Valid: $NOT_BEFORE → $NOT_AFTER${NC}"
    else
        echo -e "${RED}  ✗ Failed to generate certificate${NC}"
    fi
fi
echo ""

# ── 4. Check HTTPS backend ──────────────────────────────────
echo -e "${CYAN}[4/6] Checking HTTPS backend (port $HTTPS_PORT)...${NC}"
if curl -sk --connect-timeout 3 "https://localhost:$HTTPS_PORT/api/auth/setup-status" > /dev/null 2>&1; then
    echo -e "${GREEN}  ✓ HTTPS backend is running on port $HTTPS_PORT${NC}"
    HTTPS_OK=true
else
    echo -e "${YELLOW}  ⚠ HTTPS backend NOT reachable on port $HTTPS_PORT${NC}"
    if [ "$NEEDS_CERT" = true ]; then
        echo -e "${YELLOW}    → Certs were regenerated. Restart the app for HTTPS to start.${NC}"
    fi
    HTTPS_OK=false
fi
echo ""

# ── 5. Update .env ───────────────────────────────────────────
echo -e "${CYAN}[5/6] Updating .env file...${NC}"
NEW_BASE="https://${LOCAL_IP}:${HTTPS_PORT}"

CURRENT_BASE=""
if [ -f "$ENV_FILE" ]; then
    CURRENT_BASE=$(grep -o 'VITE_API_BASE=.*' "$ENV_FILE" 2>/dev/null | sed 's/VITE_API_BASE=//' || true)
fi

if [ "$CURRENT_BASE" = "$NEW_BASE" ]; then
    echo -e "${GREEN}  ✓ .env already correct: VITE_API_BASE=$NEW_BASE${NC}"
else
    echo "VITE_API_BASE=$NEW_BASE" > "$ENV_FILE"
    echo -e "${GREEN}  ✓ Updated .env: VITE_API_BASE=$NEW_BASE${NC}"
    if [ -n "$CURRENT_BASE" ]; then
        echo -e "${YELLOW}    (was: $CURRENT_BASE)${NC}"
    fi
fi
echo ""

# ── 6. iPad setup instructions ──────────────────────────────
echo -e "${CYAN}[6/6] iPad Setup${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}Mac IP:${NC}   ${GREEN}$LOCAL_IP${NC}"
echo -e "  ${CYAN}HTTP:${NC}     $([ "$HTTP_OK" = true ] && echo -e "${GREEN}✓ :$HTTP_PORT${NC}" || echo -e "${RED}✗ :$HTTP_PORT${NC}")"
echo -e "  ${CYAN}HTTPS:${NC}    $([ "$HTTPS_OK" = true ] && echo -e "${GREEN}✓ :$HTTPS_PORT${NC}" || echo -e "${YELLOW}⚠ :$HTTPS_PORT (restart app)${NC}")"
echo ""

if [ "$NEEDS_CERT" = true ] || [ "$HTTPS_OK" = false ]; then
    echo -e "${YELLOW}  Run these commands:${NC}"
    echo ""
    echo -e "    ${GREEN}cd apps/desktop && npm run build && npm run dev:tauri${NC}"
    echo ""
fi

echo -e "${CYAN}  iPad certificate install (required once):${NC}"
echo ""
echo -e "    1. On iPad Safari, go to:"
echo -e "       ${GREEN}http://${LOCAL_IP}:${HTTP_PORT}/api/cert.pem${NC}"
echo -e "    2. Tap ${YELLOW}Allow${NC} when prompted to download the profile."
echo -e "    3. Go to ${YELLOW}Settings → General → VPN & Device Management${NC}"
echo -e "       Tap the ${YELLOW}SynthesisOS Dev TLS${NC} profile → ${YELLOW}Install${NC}"
echo -e "    4. Go to ${YELLOW}Settings → General → About → Certificate Trust Settings${NC}"
echo -e "       Enable full trust for ${YELLOW}SynthesisOS Dev TLS${NC}"
echo -e "    5. Open Safari: ${GREEN}https://${LOCAL_IP}:${HTTPS_PORT}${NC}"
echo ""
