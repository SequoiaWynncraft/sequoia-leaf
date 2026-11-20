# Sequoia Grove (block prototype)

A first look at the Leaf game as a block game: a redwood glade at dusk, built from 16x16 tiles on
boxes, in the welcome scenes' colours. This is a prototype of the look and the engine, not yet a
game: there is no play, no account and no server in it.

```sh
bun run dev                         # the glade, with hot reload
bun run build                       # dist/
bun review/atlas.ts out.png 4       # every tile on one sheet, each shown 3x3
bun review/bench.ts out.png 6 log planks roof    # chosen tiles repeated, with their numbers
bun run pack                        # rebuild the tile data after changing assets/pack or tools/pack.ts
bun review/drive.ts http://grove.test/ shots steps.json dist   # screenshots in headless Chromium
```

`?scene=camp` (the default) is the campfire at nightfall; `?scene=glade` is the first glade with the
giant tree; `?scene=board` is the material board (below). `?view=hero|close|side|tall` picks a camera and `?night=0..1` the hour. Drag to look
round, scroll or pinch to zoom.

## The one rule

Everything in the world is a 16x16 tile on a box. Consistency comes from that rule, from one
texture pack and from one light model.

- `src/engine/blocks.ts`: the block registry. A block is data: its tiles, its shape (cube, boxes,
  crossed sheets, fence), the light it gives.
- `src/engine/world.ts`: the grid of blocks, and the light flooded through it from the sky and
  from every lamp. `sun()` says how much of the low sun reaches a point.
- `src/engine/mesh.ts`: turns the grid into triangles. Each corner carries sky light, lamp light,
  sunlight and how tucked into a corner it is, so soft shading comes free with every build.
- `src/engine/render.ts`: three.js. One shader for all blocks, a pixel-art sky worked out in
  screen cells (bands, streak clouds, stars, three rows of far spruces), fog, fireflies.
- `src/engine/actors.ts`: everything that moves, built of the same boxes and tiles at the same pixel
  size: people, the leafling pet, the cat, flames, banners, strings of lights. Each face takes the
  light of the air in front of it, so a figure by the fire is lit by it.
- `src/gen/camp.ts`: the campfire scene.
- `src/gen/board.ts`: the material board: every building material on one wall, in the game's own
  light, some of it by a fire.
- `src/gen/sequoia.ts`: grows a sequoia of any age from a few numbers.
- `src/gen/glade.ts`: the prototype's world: the giant, its house and bridge, the forest round it.

## Textures

The world wears **REFI Textures**, an openly licensed 16x16 pack drawn from scratch to recapture
the look of Minecraft (CC BY-SA 4.0; credits and terms in `assets/pack/LICENSE.md`). Each block
shows its one 16x16 tile, as a block game does, and a lawn's tiles are turned four ways.

- `assets/pack/`: the pack's PNGs, unchanged, only the ones the game uses.
- `tools/pack.ts` (`bun run pack`): builds `src/art/pack.gen.ts` from them. It names each tile for
  the game and makes a few from the pack's own: the grass block's side, a lighter and a darker
  spruce, the lit window. Adding a block's texture is copying a PNG in and adding a line there.
- `src/art/tiles.ts`: the pack's tiles, and the few things drawn here because the game shapes them
  its own way: the lantern, the flame, the banner, the string lights.

Anyone who ships the game must credit the pack; the licence covers the textures and what is made
from them, not the code.

## Light

- The world's light is two fields, sky and lamp, flooded through the cells. Light spreads to the
  cells beside a cell and diagonal to it, losing as much as the distance, so a lamp's pool is round.
- Every surface (a cube's face, a stair's step, a slab, a fence post) asks one function for the
  light at each of its corners: the four cells of air round the corner, blended by how near each
  is. So light and corner shading run smoothly from one surface to the next.
- The sun is tested with four rays from each cell of air beside a surface and blended the same way,
  so a shadow's edge is soft.
- The fire and the lanterns (a scene's eight strongest lamps) light each point by its distance and
  by how squarely the surface faces them, so a log's near side is bright and its far side is not.
  The flooded lamp light decides whether a lamp reaches a point at all, and adds a soft warm fill.
- Every tile has a relief: how each of its pixels leans and how smooth it is, read from the
  drawing itself (dark for a crack, light for a ridge) with a depth and a shine per material
  (`reliefTile` in `src/art/tiles.ts`). Lamps and the sun light each pixel by its lean, so a fire
  picks out every cobble and board, and smooth things (glass, a lantern) catch a glint.
- Night is a dim blue, so the warm light has something to stand against.
- Light in the air is not a sprite. Whatever gives light (flames, lantern glass, lit windows,
  bulbs, sparks) is marked in the picture's alpha; that part is blurred at three sizes and laid back
  over the picture, and the corners are drawn in a little.
- Foliage has gaps you can see through, faces kept one block into a crown so the gaps have depth,
  light coming through from behind, a slow sway, and greens that vary in broad patches.

## People

Everyone stands on one model, the Minecraft skin's: `skinned()` in `actors.ts` puts any 64x64 skin
on a figure, outer layer included. A member appears in their own skin. The grove's own people
(`src/art/skins.ts`: the keeper, the trader, the herald, the cook) are skins too, each an outfit
tailored into a sheet in code, plus the solid things a flat sheet cannot show: a staff, a pack, a
feather.

No member's skin is kept in this repository. The campfire loads `skins/notes.png` from beside the
page if it is there: copy one into `dist/skins/` after building. The game proper will get skins
from the Leaf server by player id.

## Not done

Lint does not pass yet (the repository forbids non-null assertions and this was written fast).
No tests. No interface, no saving, no editing of the world. Figures cast no shadows.
