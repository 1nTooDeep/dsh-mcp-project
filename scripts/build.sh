#!/bin/bash
# Build: compile src/ -> lib/ with the DSH runtime's own types on the module path.
# Resolution order:
#   1. DSH_RUNTIME_NODE_MODULES (a node_modules directory containing @deepseek-ai/dsh-mcp-client)
#   2. the node_modules tree behind the `dsh` executable on PATH
#   3. DSH_CHECKOUT/node_modules
#   4. any npx cache with @deepseek-ai/dsh-mcp-client
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

find_tsc() {
  for candidate in \
    "${TSC:-}" \
    "$ROOT/node_modules/.bin/tsc" \
    "${DSH_CHECKOUT:-}/node_modules/.bin/tsc" \
    "$(command -v tsc 2>/dev/null || true)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then echo "$candidate"; return 0; fi
  done
  find "$HOME/.npm/_npx" -path '*/node_modules/typescript/bin/tsc' -type f 2>/dev/null | head -1
}

find_runtime() {
  if [ -n "${DSH_RUNTIME_NODE_MODULES:-}" ] && [ -d "$DSH_RUNTIME_NODE_MODULES/@deepseek-ai/dsh-mcp-client" ]; then
    echo "$DSH_RUNTIME_NODE_MODULES"; return 0
  fi
  if command -v dsh >/dev/null 2>&1; then
    local p
    p="$(readlink -f "$(command -v dsh)")"
    while [ "$p" != "/" ] && [ "$(basename "$p")" != "node_modules" ]; do p="$(dirname "$p")"; done
    if [ -d "$p/@deepseek-ai/dsh-mcp-client" ]; then echo "$p"; return 0; fi
  fi
  if [ -n "${DSH_CHECKOUT:-}" ] && [ -d "$DSH_CHECKOUT/node_modules/@deepseek-ai/dsh-mcp-client" ]; then
    echo "$DSH_CHECKOUT/node_modules"; return 0
  fi
  find "$HOME/.npm/_npx" -path '*/node_modules/@deepseek-ai/dsh-mcp-client/package.json' -type f 2>/dev/null \
    | sed 's#/@deepseek-ai/dsh-mcp-client/package.json##' | head -1
}

TS="$(find_tsc)"
RUNTIME="$(find_runtime)"
if [ -z "$TS" ] || [ ! -x "$TS" ]; then
  echo "build: tsc not found (set TSC=/path/to/tsc)" >&2
  exit 1
fi
if [ -z "$RUNTIME" ] || [ ! -d "$RUNTIME/@deepseek-ai/dsh-mcp-client" ]; then
  echo "build: DSH runtime node_modules not found (set DSH_RUNTIME_NODE_MODULES)" >&2
  exit 1
fi

echo "=== Linking runtime modules from $RUNTIME ==="
mkdir -p node_modules
rm -rf node_modules/@deepseek-ai node_modules/@types node_modules/yaml node_modules/.bin
ln -s "$RUNTIME/@deepseek-ai" node_modules/@deepseek-ai
[ -d "$RUNTIME/@types" ] && ln -s "$RUNTIME/@types" node_modules/@types
[ -d "$RUNTIME/yaml" ] && ln -s "$RUNTIME/yaml" node_modules/yaml
if [ -d "$RUNTIME/typescript" ]; then
  mkdir -p node_modules/.bin
  ln -sf "$RUNTIME/typescript/bin/tsc" node_modules/.bin/tsc
fi

echo "=== Compiling src -> lib with $TS ==="
"$TS" -p tsconfig.json
echo "=== Build complete ==="
