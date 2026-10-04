#!/usr/bin/env bash
# Make the HTTPS certificate Table Cam needs for the phone's live camera.
#
# iOS Safari only gives a web page the camera over HTTPS. This creates a
# small local CA plus a server certificate for this machine's LAN
# addresses, in ./certs/ (gitignored). The server picks them up on its
# next start and serves https://<host>:3443/table.
#
#   bash scripts/make-table-cert.sh                 # this machine's IPs + hostname
#   bash scripts/make-table-cert.sh 192.168.12.1    # extra names/IPs to include
#
# On each iPhone, once (optional — without it Safari shows a warning you
# can tap through each visit):
#   1. Open http://<host>:3001/table-ca.crt in Safari -> Allow -> Close
#   2. Settings > General > VPN & Device Management > install the profile
#   3. Settings > General > About > Certificate Trust Settings > enable it
set -euo pipefail

cd "$(dirname "$0")/.."
DIR="${TABLE_CERT_DIR:-certs}"
mkdir -p "$DIR"
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

# Subject alternative names: localhost, hostname(.local), every IPv4.
SANS="DNS:localhost,IP:127.0.0.1"
HOST="$(hostname 2>/dev/null || echo steamdeck)"
SANS="$SANS,DNS:$HOST,DNS:$HOST.local"
IPS="$( (hostname -I 2>/dev/null || true) | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)"
for ip in $IPS; do SANS="$SANS,IP:$ip"; done
for extra in "$@"; do
  if [[ "$extra" =~ ^[0-9.]+$ ]]; then SANS="$SANS,IP:$extra"; else SANS="$SANS,DNS:$extra"; fi
done

if [ ! -f "$DIR/table-ca.key" ]; then
  openssl genrsa -out "$DIR/table-ca.key" 2048 2>/dev/null
  openssl req -x509 -new -key "$DIR/table-ca.key" -sha256 -days 3650 \
    -subj "/CN=ai-cards Table Cam local CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out "$DIR/table-ca.crt"
  echo "Created CA: $DIR/table-ca.crt"
fi

openssl genrsa -out "$DIR/table-server.key" 2048 2>/dev/null
openssl req -new -key "$DIR/table-server.key" -subj "/CN=$HOST" -out "$DIR/table-server.csr"
# iOS rejects server certificates valid for more than 825 days.
openssl x509 -req -in "$DIR/table-server.csr" -CA "$DIR/table-ca.crt" -CAkey "$DIR/table-ca.key" \
  -CAcreateserial -days 820 -sha256 -out "$DIR/table-server.crt" \
  -extfile <(printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n" "$SANS") 2>/dev/null
rm -f "$DIR/table-server.csr"
chmod 600 "$DIR"/*.key

echo "Server certificate for: $SANS"
echo "Restart the server (npm run server); Table Cam is then at https://<host>:${HTTPS_PORT:-3443}/table"
