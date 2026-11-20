#!/usr/bin/env bash
# Usage: lab/blocks/shoot.sh <outdir>  < shots.txt
# Builds the blocks lab once, serves it, and screenshots each stdin line:
#   <name> <width> <height> <query>     e.g.  l8-dusk 1440 900 ?level=8&time=dusk&still
# Headless Chromium renders WebGL on the GPU through ANGLE over GL.
set -euo pipefail
cd "$(dirname "$0")"
out=$(realpath -m "$1")
build=$(mktemp -d /tmp/grove-blocks-build.XXXXXX)
mkdir -p "$out"
bun build index.html sheet.html --outdir "$build" --minify >/dev/null
port=$((5400 + RANDOM % 400))
bun -e "Bun.serve({ port: $port, fetch: (r) => { const p = new URL(r.url).pathname; const f = Bun.file('$build' + (p === '/' ? '/index.html' : p === '/sheet' ? '/sheet.html' : p)); return f.size ? new Response(f) : new Response('', { status: 404 }); } })" &
server=$!
trap 'kill $server 2>/dev/null; rm -rf "$build"' EXIT
for _ in $(seq 1 50); do curl -sf "localhost:$port/" >/dev/null 2>&1 && break; sleep 0.1; done
while read -r name width height query; do
  [ -z "${name:-}" ] && continue
  case "$name" in \#*) continue ;; esac
  chromium --headless=new --use-angle=gl --ignore-gpu-blocklist --enable-gpu-rasterization \
    --hide-scrollbars --force-device-scale-factor=1 --window-size="$width,$height" \
    --virtual-time-budget="${BUDGET:-5000}" --screenshot="$out/$name.png" \
    "http://localhost:$port/$query" 2>/dev/null >/dev/null || echo "failed: $name" >&2
  echo "$out/$name.png"
done
