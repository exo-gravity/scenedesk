#!/usr/bin/env bash
set -euo pipefail
directory="$1"
browser="${SCENEDESK_SMOKE_CHROME:-}"
if [[ -z "$browser" ]]; then
  for candidate in google-chrome google-chrome-stable chromium chromium-browser '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; do
    if command -v "$candidate" >/dev/null 2>&1; then browser="$(command -v "$candidate")"; break; fi
  done
fi
if [[ -z "$browser" || ! -x "$browser" ]]; then
  echo 'CHROME_FOR_CONTRACT_SMOKE_REQUIRED: set SCENEDESK_SMOKE_CHROME to an installed Chrome/Chromium executable' >&2
  exit 1
fi
node --import tsx deploy/smoke/browser-contract.ts "$directory" "$browser"
