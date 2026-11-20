#!/usr/bin/env bash
# Usage: lab/blocks/console.sh "<query>"  — builds, loads the page headless and prints the browser console.
set -euo pipefail
cd "$(dirname "$0")"
build=$(mktemp -d /tmp/grove-blocks-console.XXXXXX)
bun build index.html --outdir "$build" >/dev/null
port=$((5800 + RANDOM % 100))
bun -e "Bun.serve({ port: $port, fetch: (r) => { const p = new URL(r.url).pathname; const f = Bun.file('$build' + (p === '/' ? '/index.html' : p)); return f.size ? new Response(f) : new Response('', { status: 404 }); } })" &
server=$!
trap 'kill $server 2>/dev/null; rm -rf "$build"' EXIT
sleep 0.6
timeout 40 chromium --headless=new --use-angle=gl --ignore-gpu-blocklist --enable-logging=stderr --v=0 --window-size=800,600 \
  --virtual-time-budget="${BUDGET:-3000}" --screenshot=/tmp/grove-console.png "http://localhost:$port/${1:-}" 2>&1 |
  grep -v -E "^\[[0-9:./]+:(WARNING|ERROR):(chrome|ui|components|media|net)" | grep -v Fontconfig || true
