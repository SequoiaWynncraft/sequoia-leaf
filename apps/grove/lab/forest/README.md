# The Forest (design spike)

The guild's shared world in Sequoia Grove: a side-on pixel panorama of the valley, where every
member's tree stands round the guild's Great Sequoia. Drag or swipe to pan, about five desktop
screens wide. Built on the pixel glade's engine (`../pixel/`), imported read-only, in the same
palette, light model and HUD language. Plain TypeScript and a canvas, no dependencies.

## Run

From `apps/grove`:

```sh
bun lab/forest/index.html --port 5194
```

Screenshots: `lab/forest/shoot.sh <outdir> < shots.txt`, one `<name> <width> <height> <query>` per
line (the final set is in `/tmp/leafgame2/shots/forest/final.txt`). Taps and drags as a player
makes them: `bun lab/pixel/drive.ts "<url>?debug" <outdir> <steps.json>`; with `?debug` the page
exposes `window.forest` and `window.artToCss(x, y)` so a driver can find the HUD's buttons.

## URL parameters

| Parameter                    | Meaning                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `time=dusk\|day\|night`      | Dusk is the signature                                                                                                                 |
| `season=normal\|winter`      | Snow, snow-capped crowns, fairy lights in the Great Sequoia, a frozen pond                                                            |
| `at=`                        | Camera: `heart`, `swamp`, `pond`, `campfire`, `stall`, `gate`, `meadow`, or a world x                                                 |
| `event=raid\|war\|levelup`   | Plays a guild moment on load; `et=` is seconds into it, for stills                                                                    |
| `anniversary`                | The crab rave at the pond                                                                                                             |
| `me=`                        | Whose tree "Find my tree" finds (default `Wrenfeather`)                                                                               |
| `tip=<name>`, `look=<place>` | A member's or a place's tooltip open on load (`look=rules`, `rollcall`, `no8`, `stall`, `farm`, `swamp`, `great`, `door`, `campfire`) |
| `still`, `t=`                | Freeze the clock (at `t` seconds) for exact screenshots                                                                               |
| `debug`                      | The debug strip: Raid, War, Level up, Rave                                                                                            |
| `perf`                       | Mean and worst frame time in `document.body.dataset.renderMs` / `worstMs`, build time in `buildMs`                                    |
| `bare`                       | No HUD                                                                                                                                |

Keys: `r` raid, `w` war, `l` level up, `a` crab rave, `f` find my tree, arrows pan, `Esc` closes a
tooltip.

## The valley, west to east

The Swamp (a misty floodplain, still pools with reflections, drowned trees, reeds, the duck family,
the weathered sign and the old banner, and crab No. 08, who never left) · the newest saplings ·
the pond with the crab colony, its rules ("2 NO CRABELLIONS") and its roll call (No. 08: `?`) ·
older trees · **the Great Sequoia** with the root office door, the squirrel and the guild's
lanterns · the campfire clearing (three glorps and the grove cat, who tells a dad joke when
tapped) · Cinfy's stall and the vault · older, then newer trees · the gate with its "Do Not The
Farm" sign · the meadow. The Fruma ridge runs along the eastern skyline with a gold pennant for
each territory.

## How it's made

- **Parallax layers, painted once.** Sky, the Fruma ridge, three depths of wild forest, the three
  rows of member trees (back, mid, front) and a fern foreground. Each is an indexed `Surface`
  painted at startup, just wide enough for the camera's range. Every place has a nominal world x.
  A layer at depth `f` draws it at `(X - cx) * f + W / 2`, so when the camera centres on a
  place, all its layers line up (`world.ts`). Each frame copies the visible slice of each layer;
  rows that are solid ground are copied with one `TypedArray.set`.
- **Member trees** come from `growTree` itself. Each is drawn once at its own size, its canopy
  shifted toward the guild's gold as its level rises, given its own shade of green, and shrunk for
  its row (back ½, mid ⅔, front 1) by area sampling in palette space: the most-covered ramp wins
  and its levels are averaged. Lit crowns are restored afterwards, so a far tree keeps its shading
  (`grove.ts`). Old fire scars become charred bark rather than black doorways at that size.
- **Where trees stand.** Each row's members are dealt to the two sides of the heart in tenure
  order and spread out to the valley's edges: oldest nearest, newest outermost. Spacing is uneven
  and now and then two friends stand side by side. Small trees mostly stand in front and big ones
  behind, as a guild photo is arranged, with exceptions. Then each tree is moved the least it must
  be to keep clear of the guild's places and of other trees. Seedlings scatter in depth, so new
  growth never stands in a line. Only the three newest members keep the glade's stake and tag
  ("just planted"). In a crowd, mounds and stakes read as a nursery, or as plots.
- **The Great Sequoia** is drawn with the engine's `drawTrunk` and `renderPad`: a broad concave
  flare into the ground, five steep limbs that bend outward and vanish into their clouds, a
  canopy band the trunk rises into (shaded beneath), a needle carpet, low roots, and the root
  office door. Lanterns hang from hooks under the limbs and the canopy's edge; spare hooks take
  each raid's new lantern (`great.ts`).
- **Water** is painted as one marker index. Each frame, every marker pixel is filled with what
  stands above its pool's far shore, mirrored, stretched and darkened, with drifting glints, so
  lanterns and the rising raid lantern show in the pond (`water.ts`). In winter it's ice.
- **Mist** is long horizontal streaks, after the welcome scenes, drifting at slightly different
  speeds per row. It's teal over the Swamp (the members' "Fogbound Sequoias") and the valley's own
  lavender elsewhere. The teal comes from the palette's spare `RARITY` ramp, loaded by passing the
  mist colour as `buildLut`'s rarity argument: no palette edit.
- **Signs** use a tiny 3x5 capital font in palette indices (`font3.ts`). Their full text is in
  the Minecraft-style tooltip.
- **The HUD** uses `../pixel/hud.ts`'s `Canvas`, `drawText` and the mod's `PixelArt` panels: the
  header, the event feed chip (two lines on a phone), "Find my tree" (bottom centre on a phone,
  bottom right on a wide screen), Minecraft tooltips with an 8x8 player head (`heads.ts`, generic
  faces made up per member), the GG card with big two-pixel Minecraft numerals, the raid lantern's
  name label and the cat's speech bubble. A phone's view drops 18 rows and the ground runs on
  below the world, so the button sits on grass, not on the campfire.

## Guild moments (`events.ts`)

Each is a function of seconds since it began, so any frame is exact and the camera glides as part
of it. Lights are drawn in the world, between the layers at their parallax, never over the HUD.

- **Raid**: the camera finds the party (you and the three trees nearest yours), their trees
  shimmer with a sweeping gold band, a wisp of light rises from each and crosses the forest to the
  campfire, the four circle and merge in a flash into one gold-dressed lantern labelled with the
  four names, which rises and hangs in the Great Sequoia and stays.
- **War**: the camera goes to the Fruma ridge, a new banner rises out of the ridge and unfurls
  under a pillar of light, and falling leaves gather into **S E Q**, glow, hold and let go.
- **Level up**: two gnome heralds pop up at the roots and sound their trumpets, the GG card
  appears ("No gg left behind"), and lanterns lift from the Great Sequoia's branches, drifting out
  into the open sky on either side and up out of sight.
- **Anniversary**: the crabs dance on the beat under a string of party lights, a glitter ball,
  coloured beams and two searchlights, with a "SEQ IS 4!" banner and confetti.

## What's copied from `../pixel/`, and why

`../pixel/` is imported read-only. These small pieces weren't exported, so they're copied:

- the sky's gradient, cloud streaks and moon (`sky.ts`, from `backdrop.ts`'s `drawSky`,
  `cloudStreak`, `drawMoon`);
- the welcome far-forest `spire` (`scenery.ts`, from `backdrop.ts`);
- the shape of `tree.ts`'s `drawLimb` and `roots` (rewritten in `great.ts` for a much larger tree).

Imported as is: `growTree`, `blitPad`, `STAGE_OF_LEVEL`, `drawTrunk`, `renderPad`, `snowCap`,
`buildLut`, `compose`, `Surface`, `Light`, `fromRows`, `hash3`, `noise1`, `Rng`, the fire, smoke,
embers, fairy lights and squirrel from `life.ts`/`sprites.ts`, and the HUD primitives from
`hud.ts`.

## The cast

`../sprites/cast.ts` didn't exist when this was built. `cast.ts` holds forest-scale placeholders:
colony crabs (idle, step, claws-up, blink), Cinfy (a nervous hamster treasurer in round spectacles
and a bow tie, clutching the ledger, eyes darting, a bead of sweat), a gnome herald with a
trumpet, three glorps, the duck family, the grove cat and the owl. It's the adapter: when the
shared cast lands, re-export its frames under these names and every motion keeps working.

## Render cost

Mean and worst ms to draw a frame of art (`?perf`, headless Chromium on this machine; "4x" is
Chromium's CPU throttling, roughly a mid phone):

| View                       | Art size | Mean | Worst | 4x mean | 4x worst |
| -------------------------- | -------- | ---- | ----- | ------- | -------- |
| Desktop, heart, dusk       | 360x225  | 2.04 | 2.6   |         |          |
| Phone 390x844              | 98x211   | 1.35 | 2.7   | 3.75    | 10.4     |
| Phone, level up at night   | 98x211   |      |       | 4.79    | 10.8     |
| Desktop, level up at night | 360x225  | 2.58 | 4.3   |         |          |
| Desktop, raid              | 360x225  |      |       | 8.48    | 14.2     |
| Ultrawide 2560x1080, raid  | 512x216  | 2.72 | 5.4   |         |          |

Building the world (layers, 70 trees, the Great Sequoia) takes about 105 ms once (about 350 ms
at 4x).
