#!/bin/bash
# Watchdog for icloud-photos.sh: sends one ntfy push when icloudpd is not running (e.g. after a reboot) or is
# waiting for the Apple ID password (expired login), and stays quiet until it is fixed. Run from a systemd timer.
set -euo pipefail
# shellcheck source=/dev/null
source "$HOME/.config/claude-watchos-icloud.env"
ALERTED="$HOME/.cache/claude-watchos-icloud.alerted"
mkdir -p "$(dirname "$ALERTED")"

problem=""
if ! tmux has-session -t icloudpd 2>/dev/null || ! pgrep -u "$USER" -f "icloudpd --username" >/dev/null; then
  problem="iCloud Fotos no está corriendo en elite (¿se reinició?). Entra por SSH y corre: tmux new -s icloudpd ~/claude-watchOS/tools/elite/icloud-photos.sh"
elif tmux capture-pane -p -t icloudpd | tail -n 5 | grep -q "Password for"; then
  problem="iCloud Fotos pide tu contraseña de Apple ID en elite. Entra por SSH y corre: tmux attach -t icloudpd"
fi

if [ -z "$problem" ]; then
  rm -f "$ALERTED"
elif [ ! -f "$ALERTED" ]; then
  curl -fsS -H "Title: claude-watchOS" -d "$problem" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null
  touch "$ALERTED"
fi
