# Sequoia Grove client

The game client for the website and the Discord Activity: one page, pixel scenes on canvases, menus in
HTML. Plain TypeScript, no framework. The design is in `design/README.md`.

## Run

From `apps/grove`:

```sh
bun index.html          # serve it while you work (bun run dev)
bun run build           # build it into dist/
bun test                # the rules, the model and the palette
```

Routes are hashes. Scenes: `#glade` (your tree), `#forest` (the guild's valley), `#campfire` (the
Activity). Menus, over the live scene: `#cones`, `#rates`, `#spirits`, `#shop`, `#rings`, `#great`,
`#leafle`.

## Layout

| Folder        | What's in it                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `src/engine/` | `raster` (16-bit indexed surfaces, light, `compose`), `palette`, `rng`, `view` (grids), fonts   |
| `src/art/`    | the tree, foliage, bark, the glade's props and life (`sprites`, `life`), and the cast (`cast/`) |
| `src/scenes/` | `glade/`, `forest/`, `campfire/`, and `reveal/` (the cone reveal and ten cones both reuse)      |
| `src/ui/`     | `hud.ts` (the canvas HUD in the mod's style), `dock.ts`, `menus/`, `styles.css`                 |
| `src/game/`   | `rules` (odds, pity, prices, catalogue), `spirits` (the book), `state` (the model), `params`    |
| `src/main.ts` | the router: canvases, the frame loop, transitions, menus, the dock                              |
| `review/`     | `shoot.sh` and `shots.txt` (screenshots), `drive.ts` and `clickthrough.json` (scripted taps)    |

## One palette

Every pixel is a 16-bit palette index, `ramp * 8 + level`, recoloured per time of day and season by
one table (`buildLut`). World ramps are 0 to 31; the cast draws in character ramps 32 to 63, each a
twin of a world ramp with the same dusk colours but lit as a character (lighter at night, tinted
rather than stepped by firelight), plus the cast's own sage, teal, purple, pearl, gold and leaf.
Characters are blitted straight into the scene in drawing order and composed in the same pass; a
rarity's coloured light touches the world only.

## The model

`src/game/state.ts` is the whole prototype state (Leaf, Bloom, care charges, banked cones, pity,
spirits and bonds, companion, purchases, pruning, watering, Leafle), kept in localStorage under
`sequoia-grove:v1`. Its actions are pure functions, tested in `test/`. `?reset` starts afresh. The
numbers that tune the game live in `src/game/rules.ts`.

## URL parameters

| Parameter                                          | Where    | Meaning                                                      |
| -------------------------------------------------- | -------- | ------------------------------------------------------------ |
| `time=dusk\|day\|night`, `season=winter`           | all      | The light and season                                         |
| `still`, `t=`                                      | all      | Freeze the clock at `t` seconds                              |
| `perf`                                             | all      | Mean and worst render ms in `document.body.dataset`          |
| `bare`                                             | all      | No HUD or dock                                               |
| `debug`                                            | all      | The forest's event buttons; `window.grove` for drivers       |
| `reset`                                            | all      | Start the saved state afresh                                 |
| `level=1..13`, `seed=`, `xp=`                      | glade    | Your tree: stage, gold canopy, zoom; the XP bar              |
| `scene=cone\|cone10`, `conet=`, `rank=`, `verdant` | glade    | A cone opening (or ten) on load                              |
| `groot=N`, `levelup`, `greet`, `nogreet`           | glade    | Raids watering the tree; the level-up ceremony; the greeting |
| `tool=`, `care=`, `caret=`, `sheet`                | glade    | A tool in hand; care under way; the sprite sheet             |
| `at=`, `event=raid\|war\|levelup`, `et=`           | forest   | Camera place; a guild moment and how far into it             |
| `anniversary`, `me=`, `tip=`, `look=`              | forest   | The crab rave; whose tree; a tooltip open on load            |
| `camp=normal\|pip\|phone`                          | campfire | Force a layout (by default the window picks it)              |
| `burn=`, `rank=`, `joke`                           | campfire | A cone this many seconds into burning; the cat's joke        |

## Screenshots and taps

```sh
review/shoot.sh /tmp/shots < review/shots.txt
bun build index.html --outdir /tmp/grove-build && bun review/serve.ts /tmp/grove-build 5600 &
bun review/drive.ts "http://localhost:5600/?debug&nogreet&reset#glade" /tmp/drive review/clickthrough.json
```

`shoot.sh` builds once and screenshots each `<name> <width> <height> <query#route>` line in headless
Chromium. `drive.ts` taps as a player does over the DevTools protocol; see its header for the steps.
