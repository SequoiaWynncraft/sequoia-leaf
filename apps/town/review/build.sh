#!/bin/sh
# Builds the town into dist/ and puts the test skin beside it (never into the repository).
#
# The games are pages of their own beside the town (../works/, ../battler/). For looking at the
# town alone, their builds are copied in under dist/ when they exist, so that one folder can be
# served. `sh review/build.sh standin` puts a page that only speaks to the town where the Works
# would be, and leaves the other game out, to show a door opening and a door that will not.
set -e
cd "$(dirname "$0")/.."
rm -rf dist
bun build index.html --outdir dist --minify
mkdir -p dist/skins
[ -f "$HOME/.cache/grove-blocks/skins/notes.png" ] && cp "$HOME/.cache/grove-blocks/skins/notes.png" dist/skins/player.png
if [ "$1" = "standin" ]; then
  bun build review/standin/index.html --outdir dist/works --minify
else
  for game in works battler; do
    [ -f "../$game/dist/index.html" ] && cp -r "../$game/dist" "dist/$game"
  done
fi
exit 0
