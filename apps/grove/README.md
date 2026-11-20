# Sequoia Grove client

The game client for the website and the Discord Activity: one page, pixel scenes on canvases, menus in
HTML. Plain TypeScript, no framework. The design is in `design/README.md`.

## Run

From `apps/grove`:

```sh
GROVE_ART=/path/to/assets/grove bun run art   # copy the art bundle in (once, and after it changes)
bun run dev             # serve it while you work, with the bundle (PORT=3100)
bun run build           # build it into dist/, the bundle in dist/grove-art/
bun test                # the decoder, the loop choice, the rules, the model and the palette
```

Routes are hashes. Scenes: `#glade` (your tree), `#forest` (the guild's valley), `#campfire` (the
Activity). Menus, over the live scene: `#cones`, `#rates`, `#spirits`, `#shop`, `#rings`, `#great`,
`#leafle`.

## The art bundle

The glade is drawn by the same mechanism as the guild's welcome messages. The welcome authoring
package in sequoia-backend (`assets/welcome/authoring`, `grove/bundle.py`) renders it offline into a
bundle: GIF loops in the welcome's own encoding, 1-bit masks, sprite sheets and a `manifest.json`.
The bundle is generated, about 15 MB, and is committed nowhere.

`bun run art` (`scripts/art.ts`) copies it from `$GROVE_ART` (by default
`../../../sequoia-backend/assets/grove`, a sequoia-backend checkout beside this one) into
`public/grove-art/`, which the dev server serves, and into `dist/grove-art/` when there is a build;
`bun run build` copies `public/grove-art/` into the build. Both are ignored by git. The page fetches
the bundle from `grove-art/` beside it, or from wherever `?art=` points.

## How the glade is drawn

The glade is a fixed 256x144 picture, drawn at a whole number of device pixels per art pixel and
never smoothed (`src/bundle/fit.ts`). On a wide screen it is the largest scale that fits, centred,
with the tree's foot kept clear of the hotbar; the page round it takes a colour from the loop's own
edges, sunk into the HUD's dark. On a phone in portrait it fills the height above the hotbar and the
screen shows a crop of it centred on the tree.

Each frame (`src/scenes/glade/glade.ts`) is composed as the Rust welcome renderer composes one:

1. The loop for the tree: `glade/L<level>-v<variant>-<season>-<dusk|night>.gif`, 160 frames at 100
   ms with the forest, the tree, the hearth and the ambient life baked in. The variant is a stable
   hash of the member (`seed`) mod 3; the light is night from 20:00 to 06:00 by the member's clock,
   dusk otherwise.
2. The glade's moments, drawn in the welcome's vocabulary and colours (`src/bundle/palette.ts`, from
   the welcome's `design.json`; moonlit at night unless they give light): the welcome's sparkles,
   firefly motes, falling leaves, puffs and drops; the cast's and props' sheets (`cast/`, `props/`)
   for the spirits, the companion, the gnome heralds, the cone and the raid water; the welcome's
   aurora (`effects/`) for the rare cones. A character with no sheet in the bundle is not drawn.
3. The near layer back in front: every pixel of `glade/near-<season>.png` is copied back from the
   decoded frame, so the giant trunks, canopy and ferns pass in front of everything.
4. What stands over the world (the tool in hand, a reveal's dark and flash), then the HUD on its
   own grid.

Taps on the tree use its mask (`glade/L…-tree.png`); rain lands on its top edge. A level-up swaps
to the next level's loop (fetched and decoded while the heralds play) under a burst of sparkles and
gold motes.

`src/bundle/gif.ts` is a small GIF decoder (LZW, palettes, transparency, every disposal) with no
dependencies. A loop (`loop.ts`) parses at once and composites its frames lazily: the first frame
as soon as the bytes are in, the rest in the time each frame leaves over, so decoding never stalls
the frame loop. Only the loops in use stay cached; steady state is one buffer copy per frame plus
the effects. `src/bundle/art.ts` fetches everything through handles the frame loop reads without
waiting.

The forest and the Campfire still draw with the procedural engine below; they move onto the bundle
next, through the same loader (`manifest.other` keeps their sections) and compositor.

## Layout

| Folder        | What's in it                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `src/bundle/` | the art bundle: `art` (loader), `gif`, `loop`, `manifest`, `cast` (sheets), `picture`, `fit`, `palette` |
| `src/engine/` | `raster` (16-bit indexed surfaces, light, `compose`), `palette`, `rng`, `view` (grids), fonts           |
| `src/art/`    | the forest's and the Campfire's procedural art: tree, foliage, bark, `sprites`, `life`, `cast/`         |
| `src/scenes/` | `glade/`, `forest/`, `campfire/`, and `reveal/` (the cone reveal's timings and cards)                   |
| `src/ui/`     | `hud.ts` (the canvas HUD in the mod's style), `dock.ts`, `menus/`, `styles.css`                         |
| `src/game/`   | `rules` (odds, pity, prices, catalogue), `spirits` (the book), `state` (the model), `params`            |
| `src/main.ts` | the router: canvases, the frame loop, transitions, menus, the dock                                      |
| `scripts/`    | `art.ts` (`bun run art`)                                                                                |
| `review/`     | `shoot.sh` and `shots.txt` (screenshots), `drive.ts` and `clickthrough.json` (scripted taps)            |

## One palette (the forest and the Campfire)

Every pixel is a 16-bit palette index, `ramp * 8 + level`, recoloured per time of day and season by
one table (`buildLut`). World ramps are 0 to 31; the cast draws in character ramps 32 to 63, each a
twin of a world ramp with the same dusk colours but lit as a character (lighter at night, tinted
rather than stepped by firelight), plus the cast's own sage, teal, purple, pearl, gold and leaf.
Characters are blitted straight into the scene in drawing order and composed in the same pass; a
rarity's coloured light touches the world only. The HUD's and the menus' small sprites still use it.

## The model

`src/game/state.ts` is the whole prototype state (Leaf, Bloom, care charges, banked cones, pity,
spirits and bonds, companion, purchases, pruning, watering, Leafle), kept in localStorage under
`sequoia-grove:v1`. Its actions are pure functions, tested in `test/`. `?reset` starts afresh. The
numbers that tune the game live in `src/game/rules.ts`.

## URL parameters

| Parameter                                          | Where    | Meaning                                                           |
| -------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| `art=`                                             | all      | Where the art bundle is (default `grove-art/` beside the page)    |
| `time=dusk\|day\|night`, `season=winter`           | all      | The light and season; the glade follows the clock without `time=` |
| `still`, `t=`                                      | all      | Freeze the clock at `t` seconds                                   |
| `perf`                                             | all      | Mean and worst render ms in `document.body.dataset`               |
| `bare`                                             | all      | No HUD or dock                                                    |
| `debug`                                            | all      | The forest's event buttons; `window.grove` for drivers            |
| `reset`                                            | all      | Start the saved state afresh                                      |
| `level=1..13`, `seed=`, `xp=`                      | glade    | Your tree's level and variant (`seed`); the XP bar                |
| `scene=cone\|cone10`, `conet=`, `rank=`, `verdant` | glade    | A cone opening (or ten) on load                                   |
| `groot=N`, `levelup`, `greet`, `nogreet`           | glade    | Raids watering the tree; the level-up ceremony; the greeting      |
| `tool=`, `care=`, `caret=`                         | glade    | A tool in hand; care under way                                    |
| `at=`, `event=raid\|war\|levelup`, `et=`           | forest   | Camera place; a guild moment and how far into it                  |
| `anniversary`, `me=`, `tip=`, `look=`              | forest   | The crab rave; whose tree; a tooltip open on load                 |
| `camp=normal\|pip\|phone`                          | campfire | Force a layout (by default the window picks it)                   |
| `burn=`, `rank=`, `joke`                           | campfire | A cone this many seconds into burning; the cat's joke             |

`time=day` is dusk in the glade, which has only dusk and night loops.

## Screenshots and taps

```sh
review/shoot.sh /tmp/shots < review/shots.txt
bun run build && bun review/serve.ts dist 5600 &
bun review/drive.ts "http://localhost:5600/?debug&nogreet&reset#glade" /tmp/drive review/clickthrough.json
```

`shoot.sh` builds once, links in `public/grove-art/`, and screenshots each `<name> <width> <height>
<query#route>` line in headless Chromium (`BUDGET=` ms of virtual time each; a rare cone's aurora
may want 6000). `drive.ts` taps as a player does over the DevTools protocol; see its header for the
steps.
