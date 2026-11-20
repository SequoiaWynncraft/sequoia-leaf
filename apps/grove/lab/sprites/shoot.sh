#!/usr/bin/env bash
# Usage: lab/sprites/shoot.sh <outdir>  < shots.txt
# Builds the cast's contact sheet once, serves it, and screenshots each line of stdin:
#   <name> <width> <height> <query>        e.g.  lineup 1600 900 ?view=lineup&still&t=1
# As lab/pixel/shoot.sh, for this folder.
set -euo pipefail
cd "$(dirname "$0")"
out=$(realpath -m "$1")
build="$out/.build"
mkdir -p "$out"
rm -rf "$build"
bun build index.html --outdir "$build" --minify >/dev/null
port=$((5800 + RANDOM % 400))
bun -e "Bun.serve({ port: $port, fetch: (r) => { const p = new URL(r.url).pathname; const f = Bun.file('$build' + (p === '/' ? '/index.html' : p)); return f.size ? new Response(f) : new Response('', { status: 404 }); } })" &
server=$!
trap 'kill $server 2>/dev/null' EXIT
for _ in $(seq 1 50); do curl -sf "localhost:$port/" >/dev/null && break; sleep 0.1; done
while read -r name width height query; do
  [ -z "${name:-}" ] && continue
  case "$name" in \#*) continue ;; esac
  profile=$(mktemp -d)
  chromium --headless=new --use-angle=gl --ignore-gpu-blocklist --hide-scrollbars --user-data-dir="$profile" \
    --force-device-scale-factor=1 --window-size="$width,$height" \
    --virtual-time-budget="${BUDGET:-3000}" --screenshot="$out/$name.png" \
    "http://localhost:$port/$query" 2>/dev/null >/dev/null || echo "failed: $name" >&2
  rm -rf "$profile"
  [ -f "$out/$name.png" ] || echo "missing: $name" >&2
  echo "$out/$name.png"
done
