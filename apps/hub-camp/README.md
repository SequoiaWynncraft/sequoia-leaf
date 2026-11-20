# Your Camp

One of four home screens built side by side for the guild's browser game. In this one the home
screen is a place that belongs to the member: their own camp in a small clearing under the
redwoods, at dusk, all on one screen. Nothing is walked to and nothing scrolls. Everything is a
thing in the camp, and you touch it.

```sh
bun run dev      # with hot reload
bun run build    # dist/
bunx tsc --noEmit -p .
```

The member's own skin is read from `skins/player.png` beside the page (a 64x64 sheet); without one
they wear a made-up skin. Add `?fresh` to the address to forget the saved camp and see a first
evening again, and `?sheet` to see every drawn thing enlarged on one page.

## What is in the camp

- **The mailbox** glows when there is news. Coming home, the member walks in, is greeted, and goes
  to it: that is the "while you were away" moment (Leaf from raids, Coins from the Works, who came
  by, what they left).
- **The cabin** (decorating, and the banner for the last territory won), **the campfire** (sit,
  emotes, add a log), **the workbench** with its small machine (the Works; it sets out coins on a
  tray while you are there), **the notice board** (quests), **the trophy shelf** (profile),
  **the signpost** (the Treasury, the Market, and visiting a guild-mate), **the pond** (the crab roll
  call; one is always unaccounted for, and it is hiding somewhere in the camp).
- **The member** idles, wanders, sits by the fire, and hurries to whatever is touched before its
  panel opens. **Pets** (a glorp, a ginger cat, a small white fox) live there and are pleased to be
  touched.
- **Guild-mates** drop by: they walk in off the trail, say something, sit a while, and leave a
  small present in the mailbox on the way out. Their faces along the top show who is here. The
  signpost leads to any of their camps, each laid out and decorated their own way.
- **Decorating** (the hammer): drag anything somewhere else, set out decorations from the tray,
  drop them back on the tray to put them away. The arrangement is remembered in the browser, one
  for a wide screen and one for an upright phone.
- **The guild, live**: every twenty seconds or so a raid finishes (a lantern drifts up behind the
  trees), a territory is won (a banner unrolls on the cabin) or someone levels up, and whoever is
  in the camp cheers.

Nothing here talks to a server. The mates, their lines, the shop, the quests, the market and the
guild's news are all made up in `src/content.ts`.

## How it is put together

The scene is drawn at a small size (about 430x250 on a desktop, 195x420 on a phone) and enlarged
by a whole number, so every pixel stays square. People are drawn from block-game skins, one skin
pixel to one scene pixel.

- `src/gfx.ts`: the palette, sprites written as rows of letters, noise.
- `src/sprites.ts`, `src/props.ts`: the small things by hand, the furniture by rule.
- `src/figure.ts`: skins cut into parts; standing, walking, sitting, waving, cheering.
- `src/backdrop.ts`: sky, forest and ground, painted once per window size; ground is coloured
  place by place from noise, not tiled.
- `src/world.ts`: what exists and what it does each frame; light (dusk multiplied over everything,
  warmth added where there is fire); what a touch does.
- `src/ui.ts`: the purse, panels, speech bubbles and the feed, as ordinary page elements.
- `src/sfx.ts`: every sound, from tones and hiss. Silent until the first touch.

`window.camp` is a small handle for checking the page from outside: `skip(seconds)` runs the
clock on, `use("board")` touches a thing, `event("raid")`, `visit("thistle")`, `decorate(true)`.
