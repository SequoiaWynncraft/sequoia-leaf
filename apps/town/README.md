# Guild Town

One of four home screens built side by side for the guild's cosy browser game. In this one the member
logs in as their own block-game character, standing in a small town in a clearing among giant
redwoods at dusk, seen from above like an old farming or monster-catching RPG. Every part of the
game is a place in the town, and guild-mates are walking about in it.

```sh
bun run dev      # with hot reload
bun run build    # dist/
```

To play as a real skin, put a 64x64 skin sheet at `dist/skins/player.png` after building (it is
never kept in the repository); without one the player gets a made-up skin. `review/build.sh` builds
and copies the test skin in one go.

## What is in it

- **Arrival.** The member walks in through the gate with the last of the sun behind them, and a card
  says what happened while they were away. Putting it away pays the Leaf and Coins into the purse.
- **The town.** A map a little larger than the screen, with a camera that follows. Walk with WASD or
  the arrow keys, or tap a spot and the character finds a way round things; hold and drag to steer.
  Buildings, trunks and the pond are solid.
- **Places.** The Treasury (Cinfy behind the counter), the quest board, the market stalls, the Works
  (chimney, belt, crates), the campfire and its log seats, the crab pond, and the gate with the
  signpost to "Your camp". Tap a place, or walk up and press E, to open its panel; a prompt shows
  when the player is standing at one. The dock along the bottom opens any of them at once, and the
  character walks there meanwhile.
- **Guild-mates.** Nine made-up members go between the places on errands of their own, sit by the
  fire, mind a stall, and say things. Tapping one shows a card.
- **The guild, live.** Every twenty seconds or so: a raid party musters at the gate and leaves, comes
  back and hangs a lantern in the tree, the guild takes a territory and the banner goes up the pole,
  somebody levels. The feed in the corner says so in a line.
- **Touching things.** Lantern posts, mushrooms, flowers, ferns, the great trunks, the fire, the
  water, the crabs, the strings of lights and the sky all do something when tapped, with a sound.
  One crab is never at roll call; it is hiding somewhere in town, and runs when found.

Everything in the panels is stand-in content, and nothing talks to a server. The Works panel shows
the real factory from `../works/` when that is served beside the town, and a note when it is not.

## How it is put together

The town is drawn small, one art pixel to a pixel, with dusk laid over it and each lamp and fire
cutting a soft hole in the dusk; that picture is blown up to the screen by a whole number, and the
words (names, speech, the prompt) are written over it at the screen's own sharpness. All of the art
is drawn in code when the page loads: `src/ground.ts` paints the floor, the sunset and the trunks a
pixel at a time, and `src/sprites.ts` builds the shops and the small things from rectangles and
from pictures typed out as rows of letters. Characters come from skin sheets (`src/skin.ts`): the
head is kept pixel for pixel and the body under it is drawn at half size.

| File                        | What it holds                                                         |
| --------------------------- | --------------------------------------------------------------------- |
| `src/main.ts`               | Who is here, keys and fingers, the camera, the loop                   |
| `src/world.ts`              | The map: paths, pond, what is solid, finding a way, where places are  |
| `src/town.ts`               | The furniture, what each thing does when touched, the parts that move |
| `src/actors.ts`             | Walking, sitting, speaking; how guild-mates choose what to do         |
| `src/events.ts`             | The live guild moments                                                |
| `src/scene.ts`              | Drawing a frame                                                       |
| `src/ui.ts`                 | The purse, dock, feed, cards and panels                               |
| `src/cast.ts`               | The made-up guild and what they say                                   |
| `src/audio.ts`, `src/fx.ts` | Small sounds, and sparks, leaves and rising words                     |

## Looking at it from outside

`window.town` has handles for taking pictures of it: `skip(seconds)` runs the clock on, `enter()`
puts the arrival card away, `visit(place)` and `open(panel)` open things, `tp(x, y)` moves the
player, `happen("raidOut" | "raidBack" | "land" | "level")` sets off a guild moment, and
`page(x, y)` turns a point in the town into a point on the page. `?sheet=big`, `?sheet=small`,
`?sheet=ground` and `?sheet=sky` show the art on its own. The step lists in `review/` drive the
tour the screenshots came from, with the driver in `../works/review/drive.ts`.
