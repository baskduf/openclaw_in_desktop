#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <domain>"
  echo "Example: $0 claw.example.com"
  exit 1
fi

DOMAIN="$1"
CADDYFILE_SRC="$(dirname "$0")/Caddyfile.example"
CADDYFILE_TMP="/tmp/Caddyfile.openclaw"

if [[ ! -f "$CADDYFILE_SRC" ]]; then
  echo "Missing $CADDYFILE_SRC"
  exit 1
fi

sed "s/claw.example.com/${DOMAIN}/g" "$CADDYFILE_SRC" > "$CADDYFILE_TMP"

sudo mkdir -p /etc/caddy
sudo cp "$CADDYFILE_TMP" /etc/caddy/Caddyfile
sudo systemctl enable caddy
sudo systemctl restart caddy
sudo systemctl status caddy --no-pager

echo "Done. Test: https://${DOMAIN}/"
