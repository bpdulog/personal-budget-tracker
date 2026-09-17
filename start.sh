#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PORT=5173

# Detect SSH connection server IP if running in an SSH session
SSH_SERVER_IP=""
if [ -n "$SSH_CONNECTION" ]; then
  SSH_SERVER_IP=$(echo "$SSH_CONNECTION" | awk '{print $3}')
fi

# Detect Tailscale IP
TAILSCALE_IP=""
if command -v tailscale >/dev/null 2>&1; then
  TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || true)
fi

# Detect primary LAN IP
LAN_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7}' | head -n1)
if [ -z "$LAN_IP" ]; then
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

echo "=========================================================="
echo "  Personal Budget Tracker"
echo "=========================================================="
echo ""
echo "Open in your browser:"
echo "  ➜ Local:                       http://localhost:${PORT}/"

if [ -n "$SSH_SERVER_IP" ]; then
  echo "  ➜ Remote (SSH interface):      http://${SSH_SERVER_IP}:${PORT}/"
fi
if [ -n "$TAILSCALE_IP" ] && [ "$TAILSCALE_IP" != "$SSH_SERVER_IP" ]; then
  echo "  ➜ Remote (Tailscale):          http://${TAILSCALE_IP}:${PORT}/"
fi
if [ -n "$LAN_IP" ] && [ "$LAN_IP" != "$SSH_SERVER_IP" ] && [ "$LAN_IP" != "$TAILSCALE_IP" ]; then
  echo "  ➜ Local Network:               http://${LAN_IP}:${PORT}/"
fi

echo ""
echo "Alternative: SSH Port Forwarding (from your local terminal):"
TARGET_HOST="${SSH_SERVER_IP:-${TAILSCALE_IP:-${LAN_IP:-server}}}"
echo "  ssh -L ${PORT}:localhost:${PORT} ${USER:-b}@${TARGET_HOST}"
echo "  Then open: http://localhost:${PORT}/"
echo "=========================================================="
echo ""

exec npm run dev
