# Guild Town

The home of the guild's cosy browser game. The member logs in as their own block-game character,
standing in a small town in a clearing among giant redwoods at dusk, seen from above like an old
farming or monster-catching RPG. Every part of the game is a place in the town, guild-mates are
walking about in it, and the other games are doors off it.

```sh
bun run dev      # with hot reload
bun run build    # dist/
bun test         # the rules: saving, the arrival letter, the made-up guild
```

To play as a real skin, put a 64x64 skin sheet at `dist/skins/player.png` after building (it is
never kept in the repository); without one the member gets a made-up skin. `review/build.sh` builds
and copies the test skin in one go.

## What is in it

- **Arrival.** The member walks in through the gate with the last of the sun behind them, and a
  letter says what happened while they were away, a line at a time. Putting it away pays the Leaf
  and Coins it lists into the purse. The letter is worked out from when they were last here: a
  reload before it is read shows the same letter, a reload after it finds nothing owed and no
  letter, and later the same day there is one only if something has come in since.
- **The town.** A map a little larger than the screen, with a camera that follows. Walk with WASD
  or the arrow keys, or tap a spot and the character finds a way round things; hold and drag to
  steer. Buildings, trunks and the pond are solid.
- **Places.** The Treasury (Cinfy behind the counter), the quest board, the market stalls, the
  Works (chimney, belt, crates), the great stump where The Little Raid is played, the campfire and
  its log seats, the crab pond, and the gate with the signpost to "Your camp". Tap a place, or walk
  up and press E, to open its panel; a prompt shows when the member is standing at one. The dock
  along the bottom opens any of them at once, the character walks there meanwhile, and the slot
  for the place they are standing at is lit.
- **Doors into the games.** The Works and The Little Raid are games of their own. Each has a card
  that says what is waiting there and a button to go in; walking on into the Works' doorway, or
  sitting down on one of the logs at the stump, goes in without the card. The doors of the Works
  part and the member steps into the light (at the stump the lantern burns up), the view closes
  in on the spot, and the game opens out of it over the whole town. Coming back runs the other way.
- **Guild-mates.** Nine made-up members go between the places on errands of their own, sit by the
  fire, mind a stall, stand round the stump watching a game, and say things. Tapping one shows a
  card. A name shows only over somebody who is near the member, pointed at, or speaking, and no
  two name plates ever overlap.
- **The guild, live.** Every twenty seconds or so: a raid party musters at the gate and leaves,
  comes back and hangs a lantern in the tree, the guild takes a territory and the banner goes up
  the pole, somebody levels. The feed in the corner says so in a line.
- **Touching things.** Lantern posts, mushrooms, flowers, ferns, the great trunks, the fire, the
  water, the crabs, the pieces on the stump's board, the strings of lights and the sky all do
  something when tapped, with a sound. Pointing at a thing whose meaning is not plain (or keeping
  a finger on it) says what it is. One crab is never at roll call; it is hiding somewhere in town,
  and runs when found.

## What it remembers

Leaf and Coins are the kit's one purse (`@sequoia-leaf/kit/purse.ts`), shared with every game: a
game in a frame that earns Coins moves the number in the town's corner.

The town keeps one small record in the browser (`save.ts` says what is in it): what the member
owns and has on, which quests they have claimed, how often they have spotted the missing crab, the
day they were last welcomed, the day the chest by the Treasury last had change in it, and when they
were last here. It has a version; text that is not a record of that version starts a new one, and
inside a record each part that makes no sense is put back to how a new member has it. The sound
setting is kept by the kit. `?fresh` in the address starts all of it over, once.

## Where the guild comes from

Everything that will one day come from the guild's server is asked for through `guild.ts`: who the
member is, who is in town and what each has gone off to do, what has just happened out in the
guild, the quests and how far along they are, what the Treasury and the stalls sell, and what
happened while the member was away. `madeup.ts` is the only thing that answers today. It invents
all of it, and keeps a memory of its own as a server would. Nothing talks to a network.

What each game says is waiting behind its door, and what the Works made while the member was away,
come from `games.ts`: one small function a game, returning a fixed line or a made-up figure until
the games can say for themselves.

## How it is put together

The town is drawn small, one art pixel to a pixel, with dusk laid over it and each lamp and fire
cutting a soft hole in the dusk; that picture is blown up to the screen by a whole number. The
words over it (name plates, speech, the prompt by a door) are written in the kit's font at a whole
number of screen pixels to each of the font's, once the font has loaded. All of the art is drawn
in code when the page loads: `ground.ts` paints the floor, the sunset and the trunks a pixel at a
time, and `sprites.ts` builds the shops and the small things from rectangles and from pictures
typed out as rows of letters. Characters come from skin sheets (the kit's `skin.ts`).

Everything that is not the world is built from the kit's classes (`ui.ts`); the style block in
`index.html` only says where things go.

`main.ts` is a stage, and the town is a scene on it. `main.ts` owns the canvas, the camera, the
keys and fingers, the loop, and the way into a game and back; everything else it asks of a `Scene`
(`stage.ts`). The town is the one scene there is (`townscene.ts`). A second one, such as the
member's camp, implements the same handful of calls and is put on with `stage.put(scene)`.

While a game is open the loop is stopped: the town is neither stepped nor drawn and makes no
sound, and picks up where it was when the game is put away.

| File                              | What it holds                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `src/main.ts`                     | The stage: canvas, camera, keys and fingers, the loop, the view closing in on a door   |
| `src/stage.ts`                    | What the stage asks of a scene, and a scene of the stage                               |
| `src/townscene.ts`                | The town as a scene: who is here, taps, getting about, going into games, what is kept  |
| `src/world.ts`                    | The map: paths, pond, what is solid, finding a way, where places are                   |
| `src/town.ts`                     | The furniture, what each thing does when touched, the parts that move                  |
| `src/actors.ts`                   | Walking, sitting, speaking; guild-mates going about what the guild says they are doing |
| `src/events.ts`                   | Staging the guild's moments in the town                                                |
| `src/draw.ts`                     | Drawing a frame; name plates and speech; the round hole the view closes to             |
| `src/ui.ts`                       | The purse, dock, feed, cards, panels and the arrival letter                            |
| `src/doors.ts`                    | A game in a frame: opening it, hearing it, the note when it will not open              |
| `src/games.ts`                    | The games that are places, and what each says is waiting                               |
| `src/guild.ts`, `src/madeup.ts`   | The questions asked of the guild, and the made-up guild that answers                   |
| `src/save.ts`, `src/keep.ts`      | The kept record and its rules; reading and writing it in the browser                   |
| `src/letter.ts`                   | Putting the arrival letter together from the time away                                 |
| `src/cast.ts`, `src/fx.ts`        | What people say; sparks, leaves and rising words                                       |
| `src/sprites.ts`, `src/ground.ts` | The art                                                                                |

`save.ts`, `letter.ts`, `madeup.ts` and `games.ts` have no page in them, and tests beside them.

## The games beside it

The games are pages of their own, served beside the town: `../works/index.html` and
`../battler/index.html`. A game speaks to the town with the kit's `shell.ts`: `ready` once it has
drawn, `leave` to come back, `news` for a line in the feed; the town says `closing` just before it
puts the game away. A game that has not said `ready` within a few seconds, or whose page is not
there, gets a note and a way back.

## Looking at it from outside

`window.town` has handles for taking pictures of it: `skip(seconds)` runs the clock on, `hold(true)`
stops the clock so that only `skip` moves it, `enter()` puts the arrival letter away, `visit(place)`
and `open(panel)` open things, `tp(x, y)` moves the member, `happen("raidOut" | "raidBack" | "land"
| "level")` sets off a guild moment, `inside(game)` goes through a door, `door()` says how far that
has got, `leave()` comes back, `kept()` shows the record as it would be saved, and `page(x, y)`
turns a point in the town into a point on the page. `?sheet=big`, `?sheet=small`, `?sheet=ground`
and `?sheet=sky` show the art on its own.

The step lists in `review/` drive the tours the screenshots came from, with the driver in
`../../packages/kit/tools/drive.ts`:

```sh
sh review/build.sh standin
bun ../../packages/kit/tools/drive.ts "http://town.test/?fresh" <out-dir> review/final.json dist
```

`final.json` is the whole town at three sizes, `doors.json` the way into a game and the note when
one is missing, `remember.json` what survives a reload, `reactions.json` the things that answer a
touch. `review/build.sh standin` puts `review/standin/` (a page that only speaks to the town)
where the Works would be and leaves The Little Raid out, so both kinds of door can be seen without
the games; without `standin` it copies the games' own builds in beside the town when they exist.
