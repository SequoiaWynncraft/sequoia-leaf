# Pixel glade

The player's glade in Sequoia Grove as 2D pixel art, in the family of Sierra's welcome scenes:
the purple-amber dusk, redwood framing, a valley receding in teal mist, ferns, mushrooms,
fireflies and small critters. Plain TypeScript and a canvas 2D renderer, no framework. The guild's
cast (gnomes, spirits, the Mossmote) comes from `../sprites/cast.ts`.

## Run

From `apps/grove`:

```sh
bun lab/pixel/index.html --port 5191
```

Screenshots: `lab/pixel/shoot.sh <outdir> < shots.txt`, one `<name> <width> <height> <query>`
per line. Taps as a player makes them: `bun lab/pixel/drive.ts <url> <outdir> <steps.json>`
(Chromium over the DevTools protocol).

## URL parameters

| Parameter                   | Meaning                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `level=1..13`               | SEQ level: the tree's stage, the canopy's gold and how close the camera is  |
| `seed=`                     | The player; varies the tree within its stage (default `sequoia`)            |
| `time=dusk\|day\|night`     | Dusk is the signature                                                       |
| `season=normal\|winter`     | Winter adds snow, caps and fairy lights                                     |
| `still`, `t=`               | Freeze the clock at `t` seconds; events below start at 0, so `t` is into it |
| `scene=glade\|cone\|cone10` | `cone` opens a cone on load (`conet=` its second); `cone10` opens ten       |
| `rank=`, `verdant`          | The cone's rarity (`Leafkin` to `Yggdrasil`; the best of ten), shiny mark   |
| `groot=N`                   | N guild raids today: the tree is rained on and drinks once for each         |
| `levelup`                   | The ceremony from `level - 1` to `level`                                    |
| `xp=0..1`                   | Progress through the level, for the XP bar (default 0.64)                   |
| `greet`, `nogreet`          | The daily greeting toast: on by default when live, only with `greet` still  |
| `tool=water\|shears\|mist`  | Starts with a tool in hand                                                  |
| `care=…`, `caret=`          | A care action already under way, for stills                                 |
| `sheet`                     | The hand-drawn glade sprites, large, for review                             |
| `perf`                      | Mean render time in `document.body.dataset.renderMs`                        |

Keys: `1` to `3` pick a tool, `Esc` puts it down, `c` opens a cone, `g` rains three groots.

## What happens in the glade

- **The world opens as your tree grows.** The world's canvas is short at level 1 (big pixels,
  the camera close in a nook between the redwoods, a sliver of valley) and grows taller each
  level until the whole valley is in view at level 6 (`artHeight` in `layout.ts`). A seedling
  stands in a bed of dark soil in a shaft of evening light, with two motes keeping it company.
- **The far valley** (`backdrop.ts`): violet ridges stepping down toward a lake, with level banks
  of teal mist between them, torn into wisps at the top, paler with distance ("Fogbound
  Sequoias"). Only the nearest ridge shows treetops; the lake glints (`life.ts`).
- **Stages** (`tree.ts`): seedling 1–2, sapling 3–4, young 5, mature 6–8, ancient 9–12, giant 13.
  The mature tree has a bare cinnamon trunk with a flared foot, a narrow crown of clumped masses
  on short drooping limbs with trunk showing between them, and a rounded top.
- **The canopy turns gold** from summer green at level 1 through autumn to the guild's gold
  (#C1A66E) at 13: hand-picked ramps blended per level (`canopyRamp`, `canopyGold` in
  `palette.ts`), so the crown is recoloured through its ramp, never tinted.
- **The HUD** (`hud.ts`) lives on its own grid, so it stays one size at every zoom (finer on a
  phone in portrait): the level badge after the mod's level medal with the stage's name and a
  segmented XP bar at top left, the Leaf balance at top right, and one slate panel at the bottom
  with Bloom along its top and the hotbar under it. Popups use the mod's milestone style.
- **Raids water your tree** (`groot.ts`): a small cloud gathers over the crown, rain falls on it
  alone, and the crown drinks once per groot, each filling a segment of Bloom.
- **Level-up** (`levelup.ts`): the cast's gnome heralds march in and toot ta, ta, taaa; light
  climbs the tree; on a flash the world opens and the new tree rises from its foot; a GG card.
- **Cone reveal** (`cone.ts`): each rank has its own beat, from Leafkin's pop to Yggdrasil, which
  stops the world before an aurora in the rank's colour (`aurora.ts`, Dryad and up) and the Great
  Sequoia's answering beam. Each rank gives a different cast spirit (the White Fox for
  Yggdrasil); the tooltip card shows its portrait, number and book line (`card.ts`).
- **Ten cones** (`cone10.ts`): ten leaves fall from the tree, turn their rank's colour halfway
  down, flip into cards in a row, then fly into a summary grid with the rarest lifted and lit.
- **Small life and lore** (`critters.ts`): the "Do Not The Farm" sign by the gate with its little
  farm, the Mossmote patrolling it, and the daily greeting toast.

## How the art is made

- **Indexed, then lit.** Everything draws palette indices (`ramp * 8 + level`) into one surface,
  never colours. Each time of day and season maps indices to colours (`palette.ts`), so dusk,
  day, night and winter are one drawing in four lights. All 32 ramps are taken; MIST shares ramp 0
  with transparency, so it has levels 1 to 7 (draw it with `mist(level)`). Warm light is a second
  buffer of steps 0 to 3; a rare cone's coloured light is a third.
- **The cast is laid over the glade.** Cast sprites use their own palette (`../sprites/
palette-cast.ts`), so they are drawn into a cast surface and laid over the composed frame with
  the cast's colour table; `actors.ts` is the only file that reads `../sprites/`.
- **Hand-placed pixels** for everything with a face: the Chickaree, the crab, the cone, the
  lantern, the seedlings, the 16×16 tools and the sign's carved letters.
- **Art-directed rules** for the big natural shapes, seeded so a seed always draws the same glade.
- **Motion** is periodic functions of time (`life.ts`), so a still is exact and nothing drifts.
- **Two grids.** `main.ts` draws the world at its level's zoom and the HUD at its own scale, each
  scaled by whole device pixels with nearest filtering; taps are given to the scene in both.

## For the forest (`../forest/`): the tree's API

`growTree(level, seedText, x, foot, season, pruned)` and `Tree` are unchanged; everything new is
optional.

- `growTree(..., options?: GrowOptions)`: `options.gold` overrides the crown's gold (0 summer
  green to 1 the guild's gold) instead of the level's.
- `Tree.gold?: number`: how gold the crown is. Pass it to `buildLut(time, season, rarity,
tree.gold)` to give FOLI those colours; without it, `buildLut` keeps the spike's foliage.
- The crown's sunlit tips are now FOLI 7 (they turn gold with the crown) rather than OLIVE 6.
- `STAGE_OF_LEVEL` now puts mature at 6–8 and ancient at 9–12; `STAGE_TITLE` names the stages.
- `Surface.overlay(top, fromRow?)` can start at a row (the level-up's growth).
