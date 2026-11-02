#!/bin/bash
# Keeps the last day of iCloud Photos (stills only) in server/session/icloud for the watch's photo grid.
# icloudpd needs the Apple ID password on every start, and the password is never stored, so this runs inside tmux:
#   tmux new -s icloudpd ~/claude-watchOS/tools/elite/icloud-photos.sh    (type the password, then Ctrl-b d)
# check-icloud-photos.sh (systemd timer) sends an ntfy push when it stops or asks for the password again,
# and this script sends one after each round that downloaded new photos.
# Config: ~/.config/claude-watchos-icloud.env with ICLOUD_USERNAME=<apple id> and NTFY_TOPIC=<topic>.
set -euo pipefail
# shellcheck source=/dev/null
source "$HOME/.config/claude-watchos-icloud.env"
# Over SSH the desktop keyring is locked; the password is typed at the console prompt instead.
export PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring
# Last day by default; an ISO date (SKIP_BEFORE=2026-10-30) keeps older photos deleted by hand from coming back.
SKIP_BEFORE="${SKIP_BEFORE:-1d}"
# The password prompt goes to /dev/tty, so piping the log below keeps it interactive.
"$HOME/.local/bin/icloudpd" --username "$ICLOUD_USERNAME" --cookie-directory "$HOME/.icloudpd" \
  --password-provider console --directory "$HOME/claude-watchOS/server/session/icloud" --folder-structure none \
  --size original --skip-videos --skip-live-photos --recent 20 --skip-created-before "$SKIP_BEFORE" \
  --file-match-policy name-id7 --watch-with-interval 60 --no-progress-bar --log-level info 2>&1 |
  while IFS= read -r line; do
    printf '%s\n' "$line"
    case "$line" in
      *"INFO     Downloaded "*) downloaded=$(( ${downloaded:-0} + 1 )) ;;
      # Each round ends with "Waiting for 60 sec..."; announce the round only if it brought new photos.
      *"Waiting for "*)
        if [ "${downloaded:-0}" -gt 0 ]; then
          [ "$downloaded" -eq 1 ] && msg="1 foto nueva lista para el reloj" || msg="$downloaded fotos nuevas listas para el reloj"
          curl -fsS -H "Title: claude-watchOS" -H "Tags: camera" -d "$msg" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null || true
        fi
        downloaded=0 ;;
    esac
  done
