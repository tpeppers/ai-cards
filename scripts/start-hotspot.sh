#!/usr/bin/env bash
# Start an offline ad-hoc WiFi hotspot on a Steam Deck (or any
# Linux box running NetworkManager) and optionally launch the
# game-mode server with the hotspot's credentials wired into the
# WiFi-QR-code endpoint.
#
# Steam Deck setup, one-time:
#   1. Switch to Desktop Mode.
#   2. Set a sudo password if you haven't:    passwd
#   3. Make sure NetworkManager is the active backend (default on
#      SteamOS).
#
# Usage:
#   ./scripts/start-hotspot.sh                           # random pw
#   ./scripts/start-hotspot.sh bidwhist hunter2          # custom
#   ./scripts/start-hotspot.sh bidwhist hunter2 --serve  # also launch
#                                                          npm run server
#
# Notes:
#   - nmcli device wifi hotspot disconnects any existing WiFi on the
#     adapter; that's the trade-off for offline play.
#   - The hotspot interface gets 10.42.0.1 by default on NM. Phones
#     joining will then resolve the host-url QR's LAN IP correctly.
#   - Stop with: nmcli connection down Hotspot
#                nmcli connection delete Hotspot
set -euo pipefail

SSID="${1:-bidwhist-table}"
PASSWORD="${2:-}"
SERVE_FLAG="${3:-}"

# Sanity-check nmcli is around.
if ! command -v nmcli >/dev/null 2>&1; then
  echo "Error: nmcli not found. Install NetworkManager (Steam Deck has it by default in Desktop Mode)." >&2
  exit 1
fi

# Generate a random 10-char hex password if none given.
if [[ -z "$PASSWORD" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    PASSWORD=$(openssl rand -hex 5)
  else
    PASSWORD=$(head -c 16 /dev/urandom | base64 | tr -d '/=+' | head -c 10)
  fi
fi

# Pick the first WiFi interface — usually wlan0 on the Deck.
IFACE=$(nmcli -t -f DEVICE,TYPE device | awk -F: '$2=="wifi"{print $1; exit}')
if [[ -z "$IFACE" ]]; then
  echo "Error: no WiFi interface found." >&2
  exit 1
fi

echo "Bringing up hotspot on $IFACE — SSID=$SSID, password=$PASSWORD"
sudo nmcli device wifi hotspot \
  ifname "$IFACE" \
  ssid "$SSID" \
  password "$PASSWORD"

# Show the LAN IP that's now bound to the hotspot interface so the
# user can verify the host-url QR will resolve.
HOTSPOT_IP=$(ip -4 -o addr show dev "$IFACE" | awk '{print $4}' | cut -d/ -f1 | head -n1 || true)
echo
echo "Hotspot is up."
echo "  SSID:        $SSID"
echo "  Password:    $PASSWORD"
echo "  Auth:        WPA"
echo "  Hotspot IP:  ${HOTSPOT_IP:-unknown}"
echo
echo "Export these into the server env so the Upload page shows the"
echo "join-WiFi QR code:"
echo "  export HOTSPOT_SSID='$SSID'"
echo "  export HOTSPOT_PASSWORD='$PASSWORD'"
echo

if [[ "$SERVE_FLAG" == "--serve" ]]; then
  export HOTSPOT_SSID="$SSID"
  export HOTSPOT_PASSWORD="$PASSWORD"
  # If we know the hotspot IP, override the host-url so the QR points
  # at it deterministically (the auto-detect picks the first non-internal
  # IPv4, which can pick a different interface if you're plugged into
  # ethernet too).
  if [[ -n "${HOTSPOT_IP:-}" ]]; then
    export GAME_MODE_HOST_URL="http://${HOTSPOT_IP}:3001/upload"
    echo "Set GAME_MODE_HOST_URL=$GAME_MODE_HOST_URL"
  fi
  echo "Starting server (Ctrl-C stops it; run 'nmcli connection down Hotspot' to drop the network)."
  cd "$(dirname "$0")/.."
  exec npm run server
fi
