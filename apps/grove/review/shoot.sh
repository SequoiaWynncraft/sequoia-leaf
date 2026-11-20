#!/usr/bin/env bash
# Usage: review/shoot.sh <outdir> < shots.txt
# Builds the client once, serves it, and screenshots each line of stdin in headless Chromium:
#   <name> <width> <height> <query-and-hash>      e.g.  glade-l8 1440 900 ?level=8&still#glade
# Lines starting with # are skipped. BUDGET sets Chromium's virtual time budget (ms, default 4000).
set -euo pipefail
cd "$(dirname "$0")/.."
out=$(realpath -m "$1")
build="$out/.build"
mkdir -p "$out"
rm -rf "$build"
bun build index.html --outdir "$build" --minify >/dev/null
# The art bundle (`bun run art`), served beside the page.
[ -d public/grove-art ] && ln -s "$PWD/public/grove-art" "$build/grove-art"
port=$((5400 + RANDOM % 400))
bun review/serve.ts "$build" "$port" &
server=$!
trap 'kill $server 2>/dev/null' EXIT
for _ in $(seq 1 50); do curl -sf "localhost:$port/" >/dev/null && break; sleep 0.1; done
while read -r name width height query; do
  [ -z "${name:-}" ] && continue
  case "$name" in \#*) continue ;; esac
  profile=$(mktemp -d)
  chromium --headless=new --use-angle=gl --ignore-gpu-blocklist --hide-scrollbars --user-data-dir="$profile" \
    --force-device-scale-factor=1 --window-size="$width,$height" \
    --virtual-time-budget="${BUDGET:-4000}" --screenshot="$out/$name.png" \
    "http://localhost:$port/${query:-}" 2>/dev/null >/dev/null || echo "failed: $name" >&2
  rm -rf "$profile"
  [ -f "$out/$name.png" ] || echo "missing: $name" >&2
  echo "$out/$name.png"
done
