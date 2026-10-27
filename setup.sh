#!/bin/bash
# Generates the shared secret token and the watch app's Config.swift.
# Usage: ./setup.sh https://your-mac.your-tailnet.ts.net
set -euo pipefail
cd "$(dirname "$0")"

URL="${1:-http://127.0.0.1:8787}"
TOKEN_FILE=server/token.txt

[ -f "$TOKEN_FILE" ] || openssl rand -hex 32 > "$TOKEN_FILE"
TOKEN=$(cat "$TOKEN_FILE")

cat > watch/ClaudeWatchOS/Config.swift <<EOF
import Foundation

enum Config {
    static let serverURL = URL(string: "${URL%/}")!
    static let token = "$TOKEN"
}
EOF

# Signing team: $DEVELOPMENT_TEAM, or the team (OU) of the first "Apple Development" certificate in the Keychain.
if [ -z "${DEVELOPMENT_TEAM:-}" ]; then
  DEVELOPMENT_TEAM=$(security find-certificate -c "Apple Development" -p 2>/dev/null \
    | openssl x509 -noout -subject 2>/dev/null | sed -n 's/.*OU *= *\([A-Z0-9]*\).*/\1/p')
fi
[ -n "$DEVELOPMENT_TEAM" ] || echo "Warning: no signing team found; set it in Xcode under Signing." >&2
export DEVELOPMENT_TEAM

(cd watch && xcodegen generate --quiet)
echo "Config written for $URL (team: ${DEVELOPMENT_TEAM:-none})"
