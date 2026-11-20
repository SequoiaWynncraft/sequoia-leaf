# Sequoia Grove (block prototype)

A first look at the Leaf game as a block game: a redwood glade at dusk, built from 16x16 tiles on
boxes, in the welcome scenes' colours. This is a prototype of the look and the engine, not yet a
game: there is no play, no account and no server in it.

```sh
bun run dev                         # the glade, with hot reload
bun run build                       # dist/
bun review/atlas.ts out.png 4       # every tile on one sheet, each shown 3x3
bun review/drive.ts http://grove.test/ shots steps.json dist   # screenshots in headless Chromium
```

`?view=hero|tree|deck|floor|tall` picks a camera. Drag to look round, scroll or pinch to zoom.

## The one rule

Everything in the world is a 16x16 tile on a box. Consistency comes from that rule and from one
light model, not from matching a painting by hand.

- `src/art/tiles.ts`: every texture, each a small function from a pixel to one of the welcome
  forest's colours. A new look is a new function here.
- `src/engine/blocks.ts`: the block registry. A block is data: its tiles, its shape (cube, boxes,
  crossed sheets, fence), the light it gives.
- `src/engine/world.ts`: the grid of blocks, and the light flooded through it from the sky and
  from every lamp. `sun()` says how much of the low sun reaches a point.
- `src/engine/mesh.ts`: turns the grid into triangles. Each corner carries sky light, lamp light,
  sunlight and how tucked into a corner it is, so soft shading comes free with every build.
- `src/engine/render.ts`: three.js. One shader for all blocks, a pixel-art sky worked out in
  screen cells (bands, streak clouds, stars, three rows of far spruces), fog, fireflies.
- `src/gen/sequoia.ts`: grows a sequoia of any age from a few numbers.
- `src/gen/glade.ts`: the prototype's world: the giant, its house and bridge, the forest round it.

## Not done

Lint does not pass yet (the repository forbids non-null assertions and this was written fast).
No tests. No characters, no interface, no saving, no editing of the world.
