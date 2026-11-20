# The cast (design spike)

Every character in Sequoia Grove as hand-placed pixels in the pixel glade's own format: the glorps,
the forest critters, the raid spirits, the golden-antlered white fox, the gnome herald and Cinfy.
Plain TypeScript; the engine is imported read-only from `../pixel/`.

## Run

From `apps/grove`:

```sh
bun lab/sprites/index.html --port 5193
```

Screenshots: `lab/sprites/shoot.sh <outdir> < shots.txt`, one `<name> <width> <height> <query>` per
line, as `lab/pixel/shoot.sh`.

## URL parameters

| Parameter                             | Meaning                                                               |
| ------------------------------------- | --------------------------------------------------------------------- |
| `view=sheet`                          | Every animation at 1x, 3x and 6x, and the happy burst at 3x (default) |
| `view=frames`                         | Every frame of every animation, still, at `scale=` (default 4)        |
| `view=portraits`                      | The portraits on the mod's slate card at 1x, 2x and 3x                |
| `view=lineup`, `view=silhouette`      | The cast in a line on the glade at true size, shown at `scale=` (3)   |
| `light=dusk,day,night,winter,firelit` | Which lights to show; `firelit` is night by the campfire              |
| `only=glorp,crab`                     | Only these ids                                                        |
| `still`, `t=`                         | Freeze the clock (at `t` seconds)                                     |

## Files

- `cast.ts`: the registry (`CAST`, `castMember(id)`) and every sprite's export.
- `glorps.ts`, `critters.ts`, `raid.ts`, `legend.ts`, `folk.ts`: the art, one character per pixel.
- `kit.ts`: frames with ground points, row edits, the confetti burst, chalk digits.
- `palette-cast.ts`: the cast's palette (below).
- `sheet.ts`, `index.html`: the contact sheet.

## The registry

```ts
interface CastMember {
  id: string; // "glorp", "crab-08", "white-fox"
  name: string; // "Glorp", "Crab No. 08", "The White Fox"
  line: "glorp" | "critter" | "raid" | "legend" | "folk";
  note: string; // one line for the spirit book
  idle: Frame[]; // glade size, 2 to 4 drawings with holds, looping
  happy: Frame[]; // the affectionate explosion, played once
  portrait: Sprite; // 32 by 32
  poses: Record<string, Frame[]>; // rave, sleep, march, raise, toot, sweat, eat
}
interface Frame {
  sprite: Sprite;
  ms: number; // how long it holds
  ax: number; // the ground point: draw at (x - ax, y - ay)
  ay: number;
}
```

Frames of different sizes line up because each knows its ground point; `frameAt(frames, ms)` picks
the one showing. A happy frame is wider than the spirit (the confetti), and its ground point says
where the spirit stands in it.

## The cast's palette (an extension to `../pixel/palette.ts`)

The glade's 256 indices (`ramp * 8 + level`, one byte) are all in use: every one of its 32 ramps is
drawn with. The spirits need colours it does not have: a glorp green, the guild's teal, Sequoia
purple, a cool white for the fox and the owl, a metal gold for antlers and the trumpet, and the
welcome scenes' leaf green. So the cast has its own palette, as 16-bit consoles kept one palette for
the background and another for sprites.

- **Same format.** Cast sprites are ordinary engine `Sprite`s, built with `fromRows` and legends of
  `ix(ramp, level)`.
- **Same characters.** Every engine ramp keeps its number and its dusk colours, graded for day and
  night exactly as `palette.ts` grades the Chickaree and the crab, and tinted by warm light the same
  way. Emitters (fire, glow, stars, fairy lights, rarity) are copied from the glade's own table, so
  the fox's tail and antler tips glow at night as the campfire does.
- **New ramps where the cast never draws.** `C.SAGE`, `C.TEAL`, `C.VIOLET`, `C.PEARL`, `C.GOLD` and
  `C.LEAF` reuse the numbers of the sky, haze and far-forest ramps, which no character uses.

To use it in the glade: blit cast sprites into a second `Surface`, then
`composeCast(glade, cast, light, gladeLut, buildCastLut(time, season), out)` in place of `compose`.
Glade layers that pass in front of a spirit (front ferns, the canopy) call `occlude(cast, front)`.
**A cast sprite must never be blitted into the glade's own surface**: its sage would draw as sky.

The other way to get here is a 16-bit index in the engine (`Uint16Array` surfaces, 64 ramps). That
is the cleaner long-term fix and a small change in `raster.ts` and `palette.ts`, but it is the
other artist's file to change.

## How the art is drawn

- Selective outlines: each colour's own darkest shade on the shadow side and along the ground, a
  lighter one where the light catches an edge. No black lines.
- Light from the upper left, as the glade's sprites; highlights in clusters, never a ring of
  shading round the edge.
- Portraits began as a Scale2x of the glade sprite and were then redrawn by hand at one-pixel detail
  (eyes, rims, fur, scales); the fox, Emberkit and crab portraits are drawn from scratch.
