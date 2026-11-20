# Sequoia Grove client

The game client for the website and the Discord Activity: one page, pixel scenes on canvases, menus in
HTML. Plain TypeScript, no framework. The design is in `design/README.md`.

## Run

From `apps/grove`:

```sh
GROVE_ART=/path/to/assets/grove bun run art   # copy the art bundle in (once, and after it changes)
bun run dev             # serve it while you work, with the bundle (PORT=3100)
bun run build           # build it into dist/, the bundle in dist/grove-art/
bun test                # the decoder, the manifest, the forest's camera and spots, the seats, the rules, the model
```

Routes are hashes. Scenes: `#glade` (your tree), `#forest` (the guild's valley), `#campfire` (the
Activity). Menus, over the live scene: `#cones`, `#rates`, `#spirits`, `#shop`, `#rings`, `#great`,
`#leafle`.

## The art bundle

Every scene is drawn by the same mechanism as the guild's welcome messages. The welcome authoring
package in sequoia-backend (`assets/welcome/authoring`, `grove/bundle.py`) renders the glade, the
Campfire and the Forest offline into a bundle: GIF loops in the welcome's own encoding, still
parallax layers and tree atlases, 1-bit masks, the cast's and props' sprite sheets and a
`manifest.json`. The client never redraws the world: it composes the bundle's pictures and draws
only small effects over them, in the welcome's palette. The bundle is generated, about 20 MB, and
is committed nowhere.

`bun run art` (`scripts/art.ts`) copies it from `$GROVE_ART` (by default
`../../../sequoia-backend/assets/grove`, a sequoia-backend checkout beside this one) into
`public/grove-art/`, which the dev server serves, and into `dist/grove-art/` when there is a build;
`bun run build` copies `public/grove-art/` into the build. Both are ignored by git. The page fetches
the bundle from `grove-art/` beside it, or from wherever `?art=` points.

## How the glade is drawn

The glade (like every scene) is a fixed 256x144 picture, drawn at a whole number of device pixels per art pixel and
never smoothed (`src/bundle/fit.ts`). On a wide screen it is the largest scale that fits, centred,
with the tree's foot kept clear of the hotbar; the page round it takes a colour from the loop's own
edges, sunk into the HUD's dark. On a phone in portrait it fills the height above the hotbar and the
screen shows a crop of it centred on the tree.

Each frame (`src/scenes/glade/glade.ts`) is composed as the Rust welcome renderer composes one:

1. The loop for the tree: `glade/L<level>-v<variant>-<season>-<dusk|night>.gif`, 160 frames at 100
   ms with the forest, the tree, the hearth and the ambient life baked in. The variant is a stable
   hash of the member (`seed`) mod 3; the light is night from 20:00 to 06:00 by the member's clock,
   dusk otherwise.
2. The glade's moments, drawn in the welcome's vocabulary (`src/bundle/vocabulary.ts`) and colours
   (`src/bundle/palette.ts`, from the welcome's `design.json`; moonlit at night unless they give
   light): the welcome's sparkles, firefly motes, falling leaves, puffs and drops; the cast's and props' sheets (`cast/`, `props/`)
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

## How the Forest is drawn

The Forest (`src/scenes/forest/`) is the bundle's valley (`grove/forest.py`): ground 1024 pixels wide
and 144 tall. Along it stand the Swamp memorial at the west end, the Great Sequoia at the heart
(512), the crab pond (736), the stall (the Trading Post) and the "Do Not The Farm" sign at the gate
(905). It has no loop; its still layers slide at their depths as the camera pans (`valley.ts`): a
layer at depth f is `256 + 768f` wide and starts `(cx - 128)f` pixels in, for a camera centred on
ground x `cx` from 128 to 896. Each frame (`forest.ts`):

1. `far` (the drawn far valley and its sky, opaque, depth 0.5), the guild's sun pennant waving on its
   ridge (the manifest's `pennant`), and a war's pennant raised on another ridge top;
2. `ground` (depth 1), with the lanterns hung in the Great Sequoia's canopy on the manifest's
   `hooks` (where its underside has open air);
3. the members' trees from the two row atlases (`trees-<row>-<season>-<ambiance>.png`, boxes in
   `index-<season>`), the back row standing on row 117 and the front on 128;
4. the crabs, the moments and the ambient life (`moments.ts`);
5. `near` (depth 1.3): ferns, and the welcome's giant trunks at the valley's ends;
6. falling leaves and snow, then the HUD (`hud.ts`).

Members stand on the manifest's spots, which run nearest the heart first: the highest trees take
the nearest, the older member first among equals, so the same roster always lands the same way
(`plant`). The bundle has 31 spots: none in the pond, none where a tree could reach over the sign,
and none where a tree would cover the Swamp or the stall. The prototype's 70 members show their 31
highest. A tree is tapped by its own pixels in the atlas.

The Great Sequoia opens its menu (`#great`) and its hollow leads to the Campfire. The Swamp ("Held
for two years"), the pond, a crab, No. 08, the stall ("Trading Post · coming soon", where a member
marketplace will live) and the sign have tooltips. Each place answers taps in its box from the
manifest's `places`, and the crabs amble on its `crabs` spots: the client measures none of them
itself. A phone sees a crop of the picture that slides on past the camera's range, so it reaches
the valley's ends too.

Moments, in the welcome's vocabulary with the bundle's props: a raid lights the party's four trees,
and their lights drift to the Great Sequoia and become one `lantern` hanging there; a war win
raises a second sun `pennant` on the far ridge (the manifest's `ridge`, in the far layer's pixels)
while falling leaves spell S E Q; a guild level-up lifts
`sky-lantern`s; the anniversary's `crab` and `crab-08` dance at the pond under fairy lights.
Fireflies (not in winter), falling leaves and snow (in winter) are the ambient life.

## How the Campfire is drawn

The Campfire (`src/scenes/campfire/`) plays `campfire/campfire-<season>-<ambiance>.gif`, the
welcome's clearing with the drawn fire ring, two seat logs and the grove cat asleep on its stump,
composed as the glade is, with the glade's near masks. Everyone in the call sits on the manifest's
`seats` in order (the logs' seat points, then the standing spots; `seats.ts`), as their companion
spirit facing the fire (those right of it mirrored), warmed by it, idle with a happy hop now and then, a nametag just over each head in the HUD (the cast's
`head` row), clear of the others and of the screen's sides. The burn queue's `cone` is thrown from
the burner's paws into the `fire`, where it sinks behind the ring's front stones (the `front` mask)
and opens as the glade's cones do, and the spirit lands on the manifest's `landing`, clear of every
seat. A tap on the `cat` gives a dad joke, in a bubble that keeps off the nametags.

`normal` shows the whole picture; `phone` a crop centred on the fire; `pip` (Discord's 320x180) a
close crop round the fire at three pixels a pixel, with whose cone it is and what came out.

## The light and the season

Every scene follows the member's clock (night from 20:00 to 06:00) unless `?time=` says, and is
winter from December 1 to the end of February by the local date unless `?season=` says.

## The cast in the HUD and the menus

Cards, the ten-cone grid, picture in picture, the spirit book, the banner, the rate card and the
Treasury show each spirit as its idle frame from `cast/`, scaled by whole pixels (`Canvas.frame`,
`ui/menus/portraits.ts`). The names and book lines are data (`src/game/cast.ts`).

## Layout

| Folder        | What's in it                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/bundle/` | the art bundle: `art` (loader), `gif`, `loop`, `manifest`, `cast` (sheets), `picture`, `fit`, `palette`, `vocabulary` |
| `src/engine/` | what the HUD and menus build on: `view` (grids), `rng`, `dither`, the Minecraft font                                  |
| `src/scenes/` | `glade/`, `forest/`, `campfire/`, and `reveal/` (the cone reveal's timings and cards)                                 |
| `src/ui/`     | `hud.ts` (the canvas HUD in the mod's style), `dock.ts`, `menus/`, `styles.css`                                       |
| `src/game/`   | `rules` (ranks, odds, pity, prices, catalogue), `cast`, `spirits` (the book), `stages`, `state`, `params`             |
| `src/main.ts` | the router: canvases, the frame loop, transitions, menus, the dock                                                    |
| `scripts/`    | `art.ts` (`bun run art`)                                                                                              |
| `review/`     | `shoot.sh` and `shots.txt` (screenshots), `drive.ts` and `clickthrough.json` (scripted taps)                          |

## The model

`src/game/state.ts` is the whole prototype state (Leaf, Bloom, care charges, banked cones, pity,
spirits and bonds, companion, purchases, pruning, watering, Leafle), kept in localStorage under
`sequoia-grove:v1`. Its actions are pure functions, tested in `test/`. `?reset` starts afresh. The
numbers that tune the game live in `src/game/rules.ts`.

## URL parameters

| Parameter                                                      | Where    | Meaning                                                        |
| -------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| `art=`                                                         | all      | Where the art bundle is (default `grove-art/` beside the page) |
| `time=dusk\|day\|night`, `season=normal\|winter`               | all      | The light and season; by default the clock and the date        |
| `still`, `t=`                                                  | all      | Freeze the clock at `t` seconds                                |
| `perf`                                                         | all      | Mean and worst render ms in `document.body.dataset`            |
| `bare`                                                         | all      | No HUD or dock                                                 |
| `debug`                                                        | all      | The forest's event buttons; `window.grove` for drivers         |
| `reset`                                                        | all      | Start the saved state afresh                                   |
| `level=1..13`, `seed=`, `xp=`                                  | glade    | Your tree's level and variant (`seed`); the XP bar             |
| `scene=cone\|cone10`, `conet=`, `rank=`, `verdant`             | glade    | A cone opening (or ten) on load                                |
| `groot=N`, `levelup`, `greet`, `nogreet`                       | glade    | Raids watering the tree; the level-up ceremony; the greeting   |
| `tool=`, `care=`, `caret=`                                     | glade    | A tool in hand; care under way                                 |
| `at=heart\|swamp\|pond\|stall\|gate\|west\|east` or a ground x | forest   | Where the camera looks                                         |
| `event=raid\|war\|levelup`, `et=`                              | forest   | A guild moment and how far into it                             |
| `anniversary`, `me=`, `tip=`                                   | forest   | The crab rave; whose tree is yours; a member's tooltip open    |
| `look=great\|hollow\|swamp\|pond\|no8\|stall\|farm`            | forest   | A place's tooltip open on load                                 |
| `camp=normal\|pip\|phone`                                      | campfire | Force a layout (by default the window picks it)                |
| `burn=`, `rank=`, `joke`                                       | campfire | A cone this many seconds into burning; the cat's joke          |

`time=day` is dusk: the bundle has dusk and night. With `?debug`, the forest's buttons (and the
keys `r`, `w`, `l`, `a`) play a raid, a war win, a level-up and the rave; `f` finds your tree.

## Screenshots and taps

```sh
review/shoot.sh /tmp/shots < review/shots.txt
bun run build && bun review/serve.ts dist 5600 &
bun review/drive.ts "http://localhost:5600/?debug&nogreet&reset#glade" /tmp/drive review/clickthrough.json
```

`shoot.sh` builds once, links in `public/grove-art/`, and screenshots each `<name> <width> <height>
<query#route>` line in headless Chromium (`BUDGET=` ms of virtual time each; a rare cone's aurora
may want 6000). Virtual time can outrun image decoding, so a sprite strip may be missing from a
still; `drive.ts` with a `["wait", 2500]` step before its `shot` waits in real time. `drive.ts` taps as a player does over the DevTools protocol; see its header for the
steps.
