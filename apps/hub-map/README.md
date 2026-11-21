# The Living Map

One of four home-screen prototypes for the guild's browser game. In this one the home screen is the
guild itself, drawn as a map: a pixel-art province at dusk, seen from high above, with a redwood
grove and the guild town at its heart. Every part of the game is a place on it, and what the guild
is doing right now is shown where it is happening.

```sh
bun run dev      # with hot reload
bun run build    # dist/
```

It looks for the member's own skin at `skins/player.png` beside the page and draws them from it;
without one they get a made-up skin like everyone else. Nothing talks to a server: the guild-mates,
the raids, the lands and the feed are all simulated in the page.

## What happens in it

- **Arriving.** The page opens on the whole province and replays what happened while the member was
  away as small bursts where each thing happened (two raids, a land won, the Works, visitors), then
  sums it up in a card. A tap skips to the card. "Good to be home" sends the Leaf and Coins to the
  purse and brings the map down to their camp.
- **The map.** Larger than the screen. Drag to move, wheel or pinch to zoom, arrow keys and `+`/`-`
  too. Lands the guild holds are lit and edged in gold with a banner; the wilds are dimmed; the
  rival company's are reddened. A few border lands change hands as the evening goes on.
- **People.** Guild-mates are pins with their faces from high up, and small walking figures when
  the map is close. They walk the roads: a party of four goes out to a raid gate, waits while a ring
  of dots fills, and comes home with a lantern that is hung on the rope across the plaza; scouts
  gather at a border land, a banner climbs its pole, and the guild's colour spreads across the land.
  Tap one for a card, and wave.
- **Places.** Tap a place, or a button in the dock, and the member's own pin walks there by road;
  its panel opens when they arrive. Treasury (Cinfy's shop: what is bought drops out of the sky at
  the camp or the pond), quest board, Market, the Works (links to `../works/`), campfire (sit, and
  small pictures to say things with), crab pond (roll call, one always missing, and it is hiding
  somewhere on the map), the member's camp (their profile), and the three raid gates.
- **The feed.** Down the right side, or along the bottom on a phone. Tapping an entry flies the map
  to where it happened.
- **Small things that answer.** Water ripples, trees shed leaves, the lantern rope jingles, the
  windmill spins up, the standing stones hum, the boat says ahoy, crabs hop and give their number.

## How it is put together

| File                                      | What is in it                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `src/world.ts`                            | The province as facts: nodes, roads, shortest ways, lands, places         |
| `src/terrain.ts`                          | Paints the whole map once at load, from noise and small drawn sprites     |
| `src/lands.ts`                            | The see-through layer that shows who holds what, and the spreading colour |
| `src/game.ts`                             | The guild's evening: members, walking, raids, scouts, crabs, the shop     |
| `src/view.ts`                             | The camera, and everything drawn each frame over the painted ground       |
| `src/ui.ts`                               | The purse, dock, feed, panels, cards and the welcome-home card            |
| `src/skins.ts`                            | Faces, small figures and portraits from a skin sheet; made-up skins       |
| `src/audio.ts`, `src/fx.ts`, `src/pix.ts` | Sounds made on the spot; sparks and flights; pixel pictures               |
| `src/main.ts`                             | Ties it together: the arrival, travel, touches, the frame loop            |

The simulation moves only by `update(dt)`, so it can be run forward from outside. For looking at it
in a headless browser, `window.hub` has `advance(seconds)`, `until(() => condition)`, `goTo(place)`,
`open(panel)`, `fly(x, y, zoom)`, `force(event)` and `tap(x, y)`.
