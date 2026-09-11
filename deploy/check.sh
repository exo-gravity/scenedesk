#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
./node_modules/.bin/tsc -p deploy/tsconfig.json
node --import tsx --test deploy/tests/*.test.ts
