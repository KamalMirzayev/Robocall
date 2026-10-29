#!/bin/bash
# Loads .env.<NODE_ENV> then .env.local (if present) so PORT can be set per
# environment instead of hardcoded in package.json. See docs/DEV_PROD_PORTS.md.
set -e
cd "$(dirname "$0")/.."

for f in ".env.${NODE_ENV:-development}" ".env.local"; do
  if [ -f "$f" ]; then
    set -a
    . "./$f"
    set +a
  fi
done

exec next dev --hostname 0.0.0.0 -p "${PORT:-3001}"
