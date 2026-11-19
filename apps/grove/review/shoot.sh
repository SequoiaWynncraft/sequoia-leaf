#!/usr/bin/env bash
# Usage: review/shoot.sh <page.html> <out.png> [width] [height] [scale] [suffix]. Builds the page with Bun, serves it, and screenshots it in headless Chromium.
# A suffix such as "?still#shop" opens a particular screen, frozen.
set -euo pipefail
cd "$(dirname "$0")"
page=$1; out=$2; w=${3:-1400}; h=${4:-900}; scale=${5:-1}; suffix=${6:-}
rm -rf .build && bun build "$page" --outdir .build --minify >/dev/null
port=$((4300 + RANDOM % 500))
bun -e "Bun.serve({ port: $port, fetch: (r) => { const p = new URL(r.url).pathname; const f = Bun.file('.build' + (p === '/' ? '/$(basename "$page")' : p)); return f.size ? new Response(f) : new Response('', { status: 404 }); } })" &
server=$!
trap 'kill $server 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -sf "localhost:$port/" >/dev/null && break; sleep 0.1; done
chromium --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor="$scale" --window-size="$w,$h" --virtual-time-budget=4000 --screenshot="$out" "http://localhost:$port/$suffix" 2>/dev/null
