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
# Browser-only flags for an ephemeral CI profile and test CA. Decoder isolation is unchanged.
"$browser" --headless --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --ignore-certificate-errors --user-data-dir="$directory/chrome-profile" \
  --virtual-time-budget=15000 --dump-dom https://localhost:4338/__smoke/contract.html \
  >"$directory/browser-contract-dom.html" 2>"$directory/browser-contract.log"
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8"); if(!s.includes("<pre id=\"result\">SCENEDESK_BROWSER_CONTRACT_PASSED</pre>")) process.exit(1)' "$directory/browser-contract-dom.html"
printf '%s\n' '{"status":"ok","originalBrowserContractCompiler":true,"identity":"unauthenticated_discovery_only","paidProvidersEnabled":false}'
