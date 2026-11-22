#!/bin/sh
# Builds the town and the games into one folder, for Leaf on this machine to serve under /play:
#
#   sh review/build.sh <public-dir> [standin]
#
# then, from the repository's root, `bun apps/api/test/play.ts <port> <public-dir>`. With `standin`,
# `review/standin/` (a page that only speaks to the town) stands where the Works would be and The
# Little Raid is left out, to show a door opening and a door that will not.
set -e
out="$1"
[ -n "$out" ] || { echo "usage: sh review/build.sh <public-dir> [standin]" >&2; exit 2; }
cd "$(dirname "$0")/.."
rm -rf "$out"
bun build index.html --outdir "$out/town" --minify
if [ "$2" = "standin" ]; then
  bun build review/standin/index.html --outdir "$out/works" --minify
else
  for game in works battler; do
    (cd "../$game" && bun build index.html --outdir "$out/$game" --minify)
  done
fi
