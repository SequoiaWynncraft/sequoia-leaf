# Sequoia Grove (block prototype)

A first look at the Leaf game as a block game: a redwood glade at dusk, built from 16x16 tiles on
boxes, in the welcome scenes' colours. This is a prototype of the look and the engine, not yet a
game: there is no play, no account and no server in it.

```sh
bun run dev                         # the glade, with hot reload
bun run build                       # dist/
bun review/atlas.ts out.png 4       # every tile on one sheet, each shown 3x3
bun review/bench.ts out.png 6 bark_m planks_m log_top   # chosen drawings repeated, with their numbers
bun review/drive.ts http://grove.test/ shots steps.json dist   # screenshots in headless Chromium
```

`?scene=camp` (the default) is the campfire at nightfall; `?scene=glade` is the first glade with the
giant tree; `?scene=board` is the material board (below). `?view=hero|close|side|tall` picks a camera and `?night=0..1` the hour. Drag to look
round, scroll or pinch to zoom.

## The one rule

Everything in the world is a 16x16 tile on a box. Consistency comes from that rule and from one
light model, not from matching a painting by hand.

- `src/art/tiles.ts`: every texture, each a small function from a pixel to one of the welcome
  forest's colours. A new look is a new function here.
- `src/art/macro.ts`: textures that run across blocks. Bark, moss, foliage and the bare floor are
  each one drawing several blocks wide, cut into tiles, so nothing repeats block by block. Also the
  ragged moss laid over a seam between two kinds of ground, moss at a trunk's foot, and the small
  things on the floor (needles, clover, pebbles, cones).
- `src/art/materials.ts`: what things are built of: bark, logs, sawn boards, stone, roof slates,
  the crate, the ladder, the window. See "Drawing a material".
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

## Drawing a material

The first wood was noise in dark, saturated reds, and it read as brickwork. What replaced it follows
how hand-drawn 16px block textures are built, measured on openly licensed packs (studied for
technique, never copied):

- **A ramp, not a colour.** Six or seven steps that turn as they lighten: plum in the deepest
  furrow, tan on a lit edge. Saturation near 0.5 at most (0.15 for stone), and light enough that the
  scene's own shading has room to work: the lightest step near 0.6 luminance, the darkest near 0.12.
- **Shapes with a light side.** A bark ridge has a lit left edge, a body of fibres and a shaded
  right edge. A board has a lit lip, two rows of grain and a seam. A stone has a rim. Nothing is
  speckle.
- **Runs, not pixels.** Grain and fibres are runs several pixels long. `review/bench.ts` prints the
  share of pixels with no neighbour of their own colour; a material should stay under about 5%
  (a hand-drawn tile with fine rings may run higher).
- **Wider than a block.** Every material is a drawing two or four blocks wide, so a board end or a
  stone does not come round again on the next block. Stairs, slabs and posts wear the same drawing.
- **Small things by hand.** A tile whose shape matters (the log end) is sixteen rows of sixteen
  letters, each a colour of the ramp, so a ring can be moved a pixel.

The way to work: draw, look at it repeated on the bench, then look at the board in the game, by
day and by firelight, before it goes into a scene.

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
