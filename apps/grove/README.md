# Sequoia Grove (block prototype)

A first look at the Leaf game as a block game: a redwood glade at dusk, built from 16x16 tiles on
boxes, in the welcome scenes' colours. This is a prototype of the look and the engine, not yet a
game: there is no play, no account and no server in it.

```sh
bun run dev                         # the glade, with hot reload
bun run build                       # dist/
bun review/atlas.ts out.png 4       # every tile on one sheet, each shown 3x3
bun review/drawn.ts out.png         # check the hand-drawn tiles and write them to a sheet
bun review/drive.ts http://grove.test/ shots steps.json dist   # screenshots in headless Chromium
```

`?scene=camp` (the default) is the campfire at nightfall; `?scene=glade` is the first glade with the
giant tree; `?scene=board` is the material board (below). `?view=hero|close|side|tall` picks a camera and `?night=0..1` the hour. Drag to look
round, scroll or pinch to zoom.

## The one rule

Everything in the world is a 16x16 tile on a box. Consistency comes from that rule, from one
set of hand-drawn tiles and from one light model.

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

Every block shows one 16x16 tile, as a block game does; where a block has several drawings
(`grass_top1`, `log2`), each block in the world wears one by where it stands.

- `src/art/drawn.ts`: the game's own tiles, drawn pixel by pixel as sixteen rows of sixteen
  letters with a colour key each: the lawn, dirt, the forest floor, redwood bark and its sawn end,
  sequoia foliage, seat logs, planks, the roof, cobblestone, bricks, the barrel, the window, the
  ladder, wool, grass tufts, fern, flowers and mushrooms. No other pack's art is in the game. They aim at the
  flat, friendly look of the classic block-game packs and copy none of them.
  `bun review/drawn.ts out.png` checks them (shape, palette, seams) and writes a sheet.
- `src/art/tiles.ts`: registers them, and draws the few things the game shapes its own way:
  the lantern, the flame, the banner, the string lights.

Natural ground is never tiled. The lawn, the forest floor, the path and bare earth are coloured
pixel by pixel by where each pixel lies in the world (`GROUNDS` in `src/art/tiles.ts`, the shader in
`render.ts`): a fine grain that never repeats, gathered into small clumps and wider patches, using
the colours of that ground's drawn tile in the shares the drawing gave them. Far off, the grain
gives way to the patches so nothing shimmers. On top of that the meadow is kept off the grid the way
block games do it: every plant is nudged off the middle of its block and some are mirrored, wild
grass sits lower on some blocks than others, and the lawn's colour drifts slowly from place to place.

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
- Foliage is one material lit one way: a solid mass whose gaps are painted as deep shade, with
  softer face shading than a wall, light coming through from behind, a slow sway, and a green that
  drifts smoothly across a crown.

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
