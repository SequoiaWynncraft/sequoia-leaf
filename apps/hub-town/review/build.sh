#!/bin/sh
# Builds the town into dist/ and puts the test skin beside it (never into the repository).
set -e
cd "$(dirname "$0")/.."
rm -rf dist
bun build index.html --outdir dist --minify
mkdir -p dist/skins
[ -f "$HOME/.cache/grove-blocks/skins/notes.png" ] && cp "$HOME/.cache/grove-blocks/skins/notes.png" dist/skins/player.png
exit 0
