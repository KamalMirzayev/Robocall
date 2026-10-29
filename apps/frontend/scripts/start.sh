#!/bin/bash
# Loads .env.<NODE_ENV> then .env.local (if present) so PORT can be set per
# environment instead of hardcoded in package.json.
set -e
cd "$(dirname "$0")/.."

for f in ".env.${NODE_ENV:-development}" ".env.local"; do
  if [ -f "$f" ]; then
    set -a
    . "./$f"
    set +a
  fi
done

# Use the Next.js node entrypoint directly to avoid relying on executable
# bits of node_modules/.bin/next in locked-down environments.
exec node node_modules/next/dist/bin/next start -p "${PORT:-3001}"
