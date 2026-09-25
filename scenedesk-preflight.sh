#!/usr/bin/env bash
# Scope selection and execution share the CI planner.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node scripts/preflight.mjs "$@"
