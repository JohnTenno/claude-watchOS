#!/bin/bash
# Re-signs claude-watchOS with xtool and reinstalls it on the Apple Watch over Wi-Fi, through a
# RemoteXPC tunnel to the paired iPhone, when its free-account profile is about to expire.
# Runs on the relay host from a systemd timer; FORCE=1 renews regardless of the expiry date.
set -euo pipefail

: "${IPHONE_UDID:?set IPHONE_UDID to the UDID of the paired iPhone}"
WORK_DIR="${WORK_DIR:-$HOME/watch-install}"
DAYS_BEFORE="${DAYS_BEFORE:-2}"
ATTEMPTS="${ATTEMPTS:-3}"
PYTHON="$WORK_DIR/venv313/bin/python"
XTOOL="${XTOOL:-$HOME/.local/bin/xtool}"
BASE_APP="$WORK_DIR/ClaudeWatchOS.app"    # build from the Mac; xtool re-signs a fresh copy each time
INSTALLED_APP="$WORK_DIR/resign/ClaudeWatchOS.app"
STATE="$WORK_DIR/state"

log() { echo "$(date -Is) $*"; }

days_left() {
  local expiry
  expiry=$(openssl smime -verify -noverify -inform DER -in "$INSTALLED_APP/embedded.mobileprovision" 2>/dev/null \
    | grep -A1 "<key>ExpirationDate</key>" | grep -oE "[0-9]{4}-[0-9-]+T[0-9:]+Z") || return 1
  echo $(( ($(date -d "$expiry" +%s) - $(date +%s)) / 86400 ))
}

cd "$WORK_DIR"
if [ "${FORCE:-0}" != 1 ] && left=$(days_left) && [ "$left" -gt "$DAYS_BEFORE" ]; then
  log "profile still valid for $left days; nothing to do"
  exit 0
fi

# The tunnel needs root for its TUN interface; its PID file lets us stop exactly that process.
TUNNEL_LOG="$WORK_DIR/tunnel.log"
TUNNEL_PID="$WORK_DIR/tunnel.pid"
stop_tunnel() { [ -f "$TUNNEL_PID" ] && sudo -n kill "$(cat "$TUNNEL_PID")" 2>/dev/null; rm -f "$TUNNEL_PID"; }
trap stop_tunnel EXIT
stop_tunnel
sudo -n setsid sh -c 'echo $$ > "$1"; shift; exec env HOME="$0" "$@"' "$HOME" "$TUNNEL_PID" \
  "$PYTHON" -m pymobiledevice3 remote start-tunnel -t wifi -p tcp --udid "$IPHONE_UDID" --script-mode \
  > "$TUNNEL_LOG" 2>&1 < /dev/null &
rsd=""
for _ in $(seq 1 60); do
  rsd=$(grep -E "^[0-9a-f:]+ [0-9]+$" "$TUNNEL_LOG" | tail -1 || true)
  [ -n "$rsd" ] && break
  sleep 1
done
[ -n "$rsd" ] || { log "iPhone not reachable over Wi-Fi: $(tail -1 "$TUNNEL_LOG")"; exit 1; }
log "tunnel up ($rsd)"

for attempt in $(seq 1 "$ATTEMPTS"); do
  rm -rf "$WORK_DIR/work" && mkdir "$WORK_DIR/work" && cp -a "$BASE_APP" "$WORK_DIR/work/"
  # shellcheck disable=SC2086 # $rsd is "HOST PORT"
  if "$XTOOL" dev sign-watch "$WORK_DIR/work/ClaudeWatchOS.app" --device-info "$STATE/watch-device.json" \
     && "$PYTHON" "$WORK_DIR/watch_device.py" --state-directory "$STATE" --rsd $rsd \
          --install "$WORK_DIR/work/ClaudeWatchOS.app"; then
    rm -rf "$WORK_DIR/resign" && mkdir "$WORK_DIR/resign" && mv "$WORK_DIR/work/ClaudeWatchOS.app" "$WORK_DIR/resign/"
    log "renewed and installed; profile valid for $(days_left) days"
    exit 0
  fi
  log "attempt $attempt failed; the Watch may be asleep"
  sleep 20
done
log "renewal failed after $ATTEMPTS attempts"
exit 1
