# Main Street

One of four prototypes for the guild's home screen: what a member sees and does the moment they log
in. In this one, home is a single long street on the forest floor, seen from the side, running
between giant redwood trunks at dusk. The member arrives as their own block-game character and
strolls it. Everything the game offers is a door, a stall or a spot along the way, and guild-mates
are strolling there too.

```sh
bun run dev      # with hot reload
bun run build    # dist/
```

To walk it as yourself, put a 64x64 skin at `dist/skins/player.png` after building; without one the
member is drawn from a made-up skin. `?name=Someone` in the address puts a name on the plate.

## Walking it

- **A/D or the arrow keys** stroll; **click or tap** a spot to walk there; **drag** (or scroll) to
  look along the street. Space hops.
- At a door a prompt appears: **E**, or a tap on the place, opens its panel. Esc closes it.
- The **dock** along the bottom opens any place's panel at once and walks the member there, so an
  errand is one tap. Keys 1 to 7 do the same.
- Nearly everything answers a touch: lanterns and banners say who they were hung for, trunks drop
  needles, the pond plops, ferns rustle, mushrooms bounce, guild-mates show a card.

From left to right the street holds the signpost to **Your camp**, the **quest board**, the
**Treasury** (Cinfy leans out of the round door), two **market** stalls, the **campfire**, **the
Works**, and the **crab pond**. One crab is always missing from the roll; it is usually hiding
somewhere along the street.

## What is real and what is stand-in

Nothing here talks to a server. The purse, the quests, the listings, the guild-mates and what the
guild does every twenty seconds or so (a raid lights a lantern, a won territory hangs a banner,
someone levels up) are all invented in `src/data.ts` and `src/main.ts`. The handles are made up.

The Works panel shows the real factory from `../works/` when that app is served beside this one,
and a small moving stand-in when it is not; on a phone it only offers the link to its own tab.

## How it is put together

Everything is drawn in code on one canvas: no image files and no dependencies.

- `src/art.ts`: the guild's colours and the few pixel tools everything is painted with.
- `src/scene.ts`: the sky, the far forest, the trunks and the ground, each painted once into a long
  canvas and then slid past the others at its own speed for depth.
- `src/places.ts`: the shops, painted onto the street; the parts that move come back as sprites.
- `src/skin.ts`: people. A skin sheet is cut into a body in profile with the head turned toward us.
- `src/world.ts`: the plan of the street: where each place is, where one stands to use it.
- `src/data.ts`: everything said and sold.
- `src/sound.ts`: small sounds made from tones and hiss; silent until the first touch.
- `src/ui.ts`: the page over the picture: purse, feed, dock, panels, cards.
- `src/main.ts`: the street alive: camera, walkers, events, and what answers a touch.

`window.hub` is a handle for looking at it from outside (headless browsers draw about one frame a
second): `hub.jump(seconds)` runs the street on, `hub.tp(x)` moves the member, `hub.open(place)`
opens a panel, `hub.event("raid" | "land" | "level")` makes the guild do something.
