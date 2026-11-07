#!/usr/bin/env bash
# Visual check in Orca's built-in browser.
# usage: scripts/shot.sh <page-id> <out.png> [js-to-run-first]
# Get a page id with: orca tab create --url http://localhost:5173/ --json  (result.browserPageId)
set -euo pipefail
PAGE=$1; OUT=$2; JS=${3:-}
[ -n "$JS" ] && { orca eval --page "$PAGE" --expression "$JS" --json >/dev/null; sleep 2; }
orca screenshot --page "$PAGE" --json | python3 -c "import sys,json,base64; open('$OUT','wb').write(base64.b64decode(json.load(sys.stdin)['result']['data']))"
