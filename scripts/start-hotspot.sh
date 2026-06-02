#!/usr/bin/env bash
# One-shot: bring up an offline WiFi hotspot on this Steam Deck and
# (optionally) run the ai-cards Node server pointing at it. Phones
# scan a printed QR to join the WiFi, then scan a second QR (or
# navigate to 10.42.0.1:3001/upload) to upload card photos.
#
# Hostapd handles AP mode (NetworkManager's wpa_supplicant AP mode
# was unreliable with iOS in testing — wouldn't complete association.
# Hostapd + a real US regdom in the beacons works.)
#
# Usage:
#   bash scripts/start-hotspot.sh             # hotspot only
#   bash scripts/start-hotspot.sh --serve     # hotspot + Node server
#   bash scripts/start-hotspot.sh --qr        # print QRs only, no nmcli/hostapd
#   bash scripts/start-hotspot.sh stop        # tear everything down
#
# npm run wifi is wired to `--serve`.

set -e

SSID="bidwhist"
PASSWORD="whisted!"
HOTSPOT_IP="10.42.0.1"
HOTSPOT_CIDR="10.42.0.1/24"
DHCP_RANGE="10.42.0.10,10.42.0.254,12h"
PORT="3001"

HOSTAPD_CONF="/tmp/hostapd-bidwhist.conf"
HOSTAPD_LOG="/tmp/hostapd-bidwhist.log"
DNSMASQ_LEASES="/tmp/dnsmasq-bidwhist.leases"
DNSMASQ_PID="/tmp/dnsmasq-bidwhist.pid"
SERVER_LOG="/tmp/ai-cards-server.log"

# ---------- arg parsing ----------
SERVE_FLAG=""
QR_ONLY=""
STOP=""
for arg in "$@"; do
  case "$arg" in
    --serve)       SERVE_FLAG=1 ;;
    --qr|--qr-only) QR_ONLY=1 ;;
    stop|--stop)   STOP=1 ;;
    *) echo "Unknown arg: $arg (use --serve, --qr, or stop)" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QR_DIR="$REPO_ROOT/scripts/qr"

# ---------- stop mode ----------
if [[ -n "$STOP" ]]; then
  echo "Stopping hostapd, dnsmasq, restoring NM management of wlan0..."
  sudo pkill -f "hostapd.*$HOSTAPD_CONF" 2>/dev/null || true
  sudo pkill -f "dhcp-leasefile=$DNSMASQ_LEASES" 2>/dev/null || true
  sudo ip addr flush dev wlan0 2>/dev/null || true
  sudo ip link set wlan0 down 2>/dev/null || true
  sudo nmcli device set wlan0 managed yes 2>/dev/null || true
  echo "Done."
  exit 0
fi

# ---------- sanity ----------
if ! command -v qrencode >/dev/null 2>&1; then
  echo "Error: qrencode not installed. sudo pacman -S qrencode" >&2
  exit 1
fi

mkdir -p "$QR_DIR"

# ---------- WiFi-join QR (always print) ----------
wifi_escape() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//;/\\;}"; s="${s//,/\\,}"; s="${s//:/\\:}"; s="${s//\"/\\\"}"
  printf '%s' "$s"
}
WIFI_PAYLOAD="WIFI:T:WPA;S:$(wifi_escape "$SSID");P:$(wifi_escape "$PASSWORD");;"
WIFI_PNG="$QR_DIR/wifi-qr.png"
qrencode -t PNG -s 10 -o "$WIFI_PNG" "$WIFI_PAYLOAD"

echo
echo "================== WiFi join QR =================="
echo "  SSID:      $SSID"
echo "  Password:  $PASSWORD"
echo "  PNG:       $WIFI_PNG"
echo "==================================================="
qrencode -t ANSIUTF8 "$WIFI_PAYLOAD"
echo

if [[ -n "$QR_ONLY" ]]; then
  echo "QR-only mode — not bringing up the hotspot."
  exit 0
fi

# ---------- need sudo for everything below ----------
sudo -v

# ---------- install hostapd if missing ----------
if ! command -v hostapd >/dev/null 2>&1; then
  echo "Installing hostapd (will toggle SteamOS read-only)..."
  sudo steamos-readonly disable
  sudo pacman -Sy --noconfirm hostapd
  sudo steamos-readonly enable
fi
if ! command -v dnsmasq >/dev/null 2>&1; then
  echo "Installing dnsmasq..."
  sudo steamos-readonly disable
  sudo pacman -Sy --noconfirm dnsmasq
  sudo steamos-readonly enable
fi

# ---------- regulatory domain ----------
sudo iw reg set US
# Persist (iOS needs a country IE in beacons; defaults to "world"=00 otherwise).
if ! grep -q '^WIRELESS_REGDOM="US"' /etc/conf.d/wireless-regdom 2>/dev/null; then
  sudo tee /etc/conf.d/wireless-regdom >/dev/null <<'EOF'
WIRELESS_REGDOM="US"
EOF
fi

# ---------- tear down any prior state ----------
sudo nmcli connection down Hotspot 2>/dev/null || true
for s in $(nmcli -t -f NAME connection show 2>/dev/null | grep -E '^Hotspot(-[0-9]+)?$' || true); do
  sudo nmcli connection delete "$s" 2>/dev/null || true
done
sudo pkill -f "hostapd.*$HOSTAPD_CONF" 2>/dev/null || true
sudo pkill -9 dnsmasq 2>/dev/null || true
sleep 1
sudo nmcli device set wlan0 managed no
sudo ip link set wlan0 down 2>/dev/null || true
sudo ip addr flush dev wlan0 2>/dev/null || true
sudo ip link set wlan0 up
sudo ip addr add "$HOTSPOT_CIDR" dev wlan0

# ---------- hostapd config ----------
sudo tee "$HOSTAPD_CONF" >/dev/null <<EOF
interface=wlan0
driver=nl80211
country_code=US
ieee80211d=1
hw_mode=g
channel=6
ssid=$SSID
auth_algs=1
wpa=2
wpa_passphrase=$PASSWORD
wpa_key_mgmt=WPA-PSK
wpa_pairwise=CCMP
rsn_pairwise=CCMP
ignore_broadcast_ssid=0
EOF

# ---------- start hostapd in background ----------
sudo touch "$HOSTAPD_LOG"
sudo chmod 666 "$HOSTAPD_LOG"
sudo bash -c "setsid hostapd -t '$HOSTAPD_CONF' >'$HOSTAPD_LOG' 2>&1 &"
sleep 3
if ! pgrep -f "hostapd.*$HOSTAPD_CONF" >/dev/null; then
  echo "!!! hostapd failed to start. Log:"
  cat "$HOSTAPD_LOG"
  exit 1
fi
echo "hostapd running (pid $(pgrep -f "hostapd.*$HOSTAPD_CONF" | head -1))"

# ---------- start dnsmasq in background ----------
# Note: NO --log-facility (dnsmasq drops privs to 'nobody' and can't write
# our /tmp log file). Logs go to syslog/journald instead.
sudo bash -c "dnsmasq \
  --interface=wlan0 \
  --bind-interfaces \
  --listen-address=$HOTSPOT_IP \
  --dhcp-range=$DHCP_RANGE \
  --dhcp-leasefile='$DNSMASQ_LEASES' \
  --pid-file='$DNSMASQ_PID' \
  --conf-file=/dev/null \
  --no-hosts --no-resolv --log-dhcp"
sleep 1
if ! pgrep -f "dhcp-leasefile=$DNSMASQ_LEASES" >/dev/null; then
  echo "!!! dnsmasq failed to start. Recent journal:"
  journalctl -t dnsmasq -n 20 --no-pager 2>/dev/null || true
  exit 1
fi
echo "dnsmasq running (pid $(pgrep -f "dhcp-leasefile=$DNSMASQ_LEASES" | head -1))"

# ---------- cleanup trap ----------
cleanup() {
  echo
  echo "Tearing down hotspot..."
  sudo pkill -f "hostapd.*$HOSTAPD_CONF" 2>/dev/null || true
  sudo pkill -f "dhcp-leasefile=$DNSMASQ_LEASES" 2>/dev/null || true
  sudo ip addr flush dev wlan0 2>/dev/null || true
  sudo ip link set wlan0 down 2>/dev/null || true
  sudo nmcli device set wlan0 managed yes 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

# ---------- upload-URL QR ----------
UPLOAD_URL="http://$HOTSPOT_IP:$PORT/upload"
UPLOAD_PNG="$QR_DIR/upload-url-qr.png"
qrencode -t PNG -s 10 -o "$UPLOAD_PNG" "$UPLOAD_URL"
echo
echo "================ Upload page QR =================="
echo "  URL:  $UPLOAD_URL"
echo "  PNG:  $UPLOAD_PNG"
echo "==================================================="
qrencode -t ANSIUTF8 "$UPLOAD_URL"
echo
echo "Open big versions:  xdg-open '$WIFI_PNG'   xdg-open '$UPLOAD_PNG'"
echo
echo "================================================================"
echo "  Commands"
echo "================================================================"
echo "  Start (hotspot + server):  npm run wifi"
echo "  Stop everything:           npm run wifi:stop      (or Ctrl-C this terminal)"
echo "  Print WiFi QR only:        npm run wifi:qr"
echo
echo "  DHCP lease watch:          journalctl -ft dnsmasq-dhcp"
echo "  hostapd debug log:         tail -f $HOSTAPD_LOG"
echo "  server log:                tail -f $SERVER_LOG"
echo "================================================================"
echo

# ---------- (optional) start server ----------
if [[ -n "$SERVE_FLAG" ]]; then
  export HOTSPOT_SSID="$SSID"
  export HOTSPOT_PASSWORD="$PASSWORD"
  export GAME_MODE_HOST_URL="$UPLOAD_URL"
  : > "$SERVER_LOG"
  echo "Starting Node server on :$PORT (logs: terminal + $SERVER_LOG). Ctrl-C tears it all down."
  cd "$REPO_ROOT"
  npm run server 2>&1 | tee "$SERVER_LOG"
else
  echo "Hotspot is up (no --serve). Run 'npm run server' in another terminal,"
  echo "or 'npm run wifi:stop' to tear the hotspot down. Ctrl-C also tears down."
  # Wait forever so the trap fires on Ctrl-C.
  while true; do sleep 60; done
fi
