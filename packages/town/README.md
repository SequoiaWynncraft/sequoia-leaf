# The town and the camp, as rules

The town's and the member's camp's rules (`@sequoia-leaf/town`), with no page in them: plain data
and plain functions, type-checked without the page's library or Bun's. `TOWN` (`game.ts`) is the
`Game` Leaf's play service holds each member's town with. The town's page (`apps/town`) reads
Leaf's view of it (`readView`, `readNotes`), works out with the same rules what a command does to
its copy (`predict`), and imports the catalogue, the mailbox, the town's own and a camp's rules
from here.

```sh
bun test
```

| File           | What it is                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------- |
| `things.ts`    | Every thing a camp can hold: name, kind, the ground it takes, how it turns                   |
| `catalogue.ts` | The stalls and their prices in Coins, and the presents                                       |
| `folk.ts`      | The town's own: who each is and what they say; who calls at a camp, their notes and presents |
| `mail.ts`      | The mailbox: twelve letters, and which make room for the next                                |
| `camp.ts`      | What may stand where in a camp, turning, the tray, who lives there, the new camp, an old one |
| `clock.ts`     | The town by the clock: the town's own, the crabs, members, the stump's board, the moments    |
| `game.ts`      | The state, the commands, what happens by itself, what the page is shown, keeping it          |
| `stats.ts`     | What a person's card says of their camp                                                      |

## The state

A member's `Town`: the missing crab's sightings (and Leaf's clock when it was last spotted), the
UTC days the chest last paid and the member was last welcomed, Leaf's clock when they were last
here (`seenAt`), how far their own news has been told (`cursor`), whether their character stays in
town, the camp, the caller waiting at it (`visit`), when the next caller sets out (`nextCall`), and
Leaf's stream (`rng`) and counter (`made`). The camp holds the pet chosen first, the things standing
(each with an id of its own, `n`, made from `made` and never used again), the tray (everything the
member has that is not set out; a player reads "Storage"), which arrivals in it are new to them
(`fresh`, oldest first, and `looked`, how many arrivals they have looked at in all), the letters, how many callers were greeted and which trophies have been handed
over. Nothing stands in a camp that its member did not set there: whatever they get goes into the
tray, new, by `store` (`camp.ts`).

A new member's camp is the one every member starts with (`NEW_CAMP`), and the first caller sets out
46 to 76 seconds after it is made.

## What happens by itself

`advance` does two things at Leaf's clock. Each award the member holds (`Ctx.awards`) that brings
a camp thing the camp has not had goes into the tray and is noted in `earned`: a trophy (the award is the thing's id), a pull's thing (`pull:thing:<id>`), and a
banner's headliner (`pull:headliner:<banner>`), which brings that banner's statue
(`statue-<banner>`). Each comes once, however many copies a pull gave. When `nextCall` has come, the caller still waiting leaves (what they
brought is posted if the box has room), and the next sets out: one of four, bringing a present
two times in five and a note seven times in ten; `nextCall` is drawn again, 46 to 76 seconds on.
One caller at most each call, however long nobody was here.

Draws come from the state's stream, not stirred with each call's dice, so the same state at the
same moment always comes to the same caller and the same arrival letter: the page is shown both
before they are greeted or put away.

## Commands

Things are named by id, never by a place in a list. Where a thing goes is proposed by the page (a
square, `x` and `y`, and a turn, `t`) and checked here.

| `do`           | Fields           | What it does                                                                                                                         | Refused with                                                     |
| -------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `welcome`      | `cursor`         | Posts the mail while away (below); the member is welcomed today and here now; takes `cursor` if it is further on                     |                                                                  |
| `here`         | `cursor`         | The member is here now; takes `cursor` if it is further on                                                                           |                                                                  |
| `openChest`    |                  | 3 Coins, once a UTC day                                                                                                              | `opened_today`                                                   |
| `spotCrab`     |                  | One more sighting, once for each place the crab hides (60 seconds of Leaf's clock, `stretchOf`)                                      | `too_soon`                                                       |
| `buy`          | `stall`, `thing` | The thing goes into the tray, new; takes the stall's price                                                                           | `not_for_sale`, `plenty` (999 of it)                             |
| `choosePet`    | `pet`            | The first pet                                                                                                                        | `pet_chosen`                                                     |
| `greet`        | `visit`          | The caller waiting, by id: counted, what they brought posted, and gone                                                               | `no_such_visit`                                                  |
| `readMail`     |                  | Every letter read                                                                                                                    |                                                                  |
| `takePresent`  | `letter`         | The present goes into the tray, new                                                                                                  | `no_present`, `plenty` (the present stays in its letter)         |
| `clearLetters` |                  | Letters read and emptied are thrown out                                                                                              |                                                                  |
| `looked`       | `through`        | The member has looked at every arrival up to that one (`looked` and what was new, as their page had them): what came after stays new |                                                                  |
| `setOut`       | `thing`, `x y t` | One out of the tray, there                                                                                                           | `not_in_tray`, `full` (300 standing), where it may not stand     |
| `move`         | `n`, `x y t`     | Moves and turns a thing                                                                                                              | `no_such_thing`, where it may not stand                          |
| `putAway`      | `n`              | Into the tray                                                                                                                        | `no_such_thing`, `rooted` (the cabin, the mailbox, the signpost) |
| `toggle`       | `n`              | A lantern post or candle stump lit or dark; a paper lantern, pane or pennant the next of five colours; a gnome turned round          | `no_such_thing`, `nothing_to_toggle`                             |
| `stay`         | `on`             | Whether the member's character stays in town after they go                                                                           |                                                                  |

Where a thing may not stand is said as `off` (in the trees), `trail`, `taken`, `shut` (it would
shut the cabin's door, the mailbox or the signpost off from the trail) or `cannot_turn` (it does
not turn that way). A command refused changes nothing.

No command answers with notes. `buy` takes the price (keyed `buy:<n>`) and `openChest` pays 3,
`free`, keyed by the UTC day. A thing bought and a pet chosen are logged (`town_bought`,
`town_pet`).

## The town by the clock

`clock.ts` answers, for a seed and a moment of Leaf's clock, where each of the town's own and each
crab is. The seed is the room's name (`seedOf`); every roll stirs in the UTC day its turn is due
on. Time is cut into turns that begin a few seconds late by their own roll, so nothing is stepped
and nothing is kept: any page, and Leaf, gets the same answer for the same moment.

- `folkAt(seed, who, now)`: where it set out from, where it is going, when it set out, what it
  does there, and the line it is saying. Pipwick goes round the crabs, the board and the gate
  (24, 24 and 17 seconds a turn, up to 3 late); Fika between the Works' door and the fire (32
  seconds, up to 5 late); each turn is at one of the spots for it (`SPOTS`). Sootpaw naps in turns
  of 22 seconds (up to 6 late), and 3 naps in 10 end with 5 to 9 seconds awake. The rest keep to
  their posts. Every 4.5 seconds (up to 1.7 late) one of those at its post and awake says a line
  for 2.8 seconds.
- `crabAt(seed, n, now)`: how far from home a crab was and is going, as shares of its reach, and
  when it set out: every 5.5 seconds, up to 3 late.
- `hiding(seed, now)`: where the missing crab hides. One place for each 60 seconds (`STRETCH`),
  never the same place twice running; `stretchOf(now)` is which 60 seconds, and `spotCrab` counts
  one sighting in each.
- `boardAt(seed, now)`: the hex each of the five figures on the stump's board is on while
  somebody is at it, and the one moved this turn: one every 2.1 seconds (up to 0.8 late) to a free
  hex beside its own. After 32 moves they are taken back, last first, so the board is `SET_OUT`
  again every 64 turns and never jumps.

What follows from what Leaf said is here too, as functions of that and the clock:

- `standOf(id, at)`: the spot a member at the Works or the table stands at, by their account.
  `dozing(resting, free)`: the seat of each member who dozes, of the seats nobody awake sits on:
  whoever has been gone longest chooses first, the first seat left for where they were, never one
  left for the member. `SITS_AFTER` (120 seconds after Leaf last saw them) is when a member gone
  from a game sits down, or goes. `zAt` is when a dozer last breathed out a "z" (one every 2
  seconds, up to 0.8 late).
- `homecoming(seed, at, i, now)`: the walk the `i`th of a raid party home since `at` is on: in
  through the gate, the first on to the lantern tree, and out again, to the timetable `HOME`.
- `bannerAt(wars, now)`: whose banner flies and how far up the pole: the last war's by when each
  happened (`later`), of those the town has begun to stage.
- `stagedBy(count, whens, now)`: how many of a day's raids or wars the town has staged: Leaf's
  count of the day, less those still to come.

The page walks the way between two spots at the figure's pace; its test checks that every walk
fits its turn on the town's ground.

## The arrival letter

From `seenAt` and Leaf's clock: a first visit brings Tindra's mushroom; an hour or more away, a
line and a letter from one of the town's own (`WHILE_AWAY`); six hours or more, a caller's letter
with a present too. The page is shown it as `arrival` (a first visit, a new UTC day, how long away,
the lines, the letters), worked out by the same function `welcome` posts with.

## What the page is shown

The state without `rng` and `nextCall`, and with `arrival`. The counter (`made`) is shown, so that
a thing the page sets down is given the id Leaf will give it. `readView` and `readNotes` read what
Leaf sends back into these types. `predict(view, command, now)` does a command to the page's copy
with the same rules, and gives the copy after it and its notes, or the refusal; it gives null for
the four commands only Leaf can answer (`ASKED`: `welcome`, `greet`, `openChest`, `buy`), whose
letters or Coins are Leaf's to say.

## Where a camp stands

`standing`: the things set out, with the callers greeted and the crab's sightings beside it, for
a person's card and the camps a signpost lists.

## A visit

`visit` (`visitView`): what another player is given of a camp, in the page's own shape. It holds
what stands there, each thing in its own state, and the pet chosen first; the letters, tray,
caller and counters are left out (empty, or 0), and the arrival letter says nothing.

## Keeping it

`encodeTown` and `decodeTown`: Leaf's stored text, read back with every field's type checked but
trusting that each thing stands where it may (each change was checked when it was made), in
about 0.04 ms for the largest camp. A camp stored before everything went into the tray may have
parcels waiting by its trail (`parcels`): it reads with them in the tray, new.
