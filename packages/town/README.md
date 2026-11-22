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
| `game.ts`      | The state, the commands, what happens by itself, what the page is shown, keeping it          |
| `stats.ts`     | What a person's card says of their camp                                                      |

## The state

A member's `Town`: the missing crab's sightings (and Leaf's clock when it was last spotted), the
UTC days the chest last paid and the member was last welcomed, Leaf's clock when they were last
here (`seenAt`), how far their own news has been told (`cursor`), whether their character stays in
town, the camp, the caller waiting at it (`visit`), when the next caller sets out (`nextCall`), and
Leaf's stream (`rng`) and counter (`made`). The camp holds the pet chosen first, the things standing
(each with an id of its own, `n`, made from `made` and never used again), the tray, the parcels by
the trail, the letters, how many callers were greeted and which trophies have been handed over.

A new member's camp is the one every member starts with (`NEW_CAMP`), and the first caller sets out
46 to 76 seconds after it is made.

## What happens by itself

`advance` does two things at Leaf's clock. Each award the member holds (`Ctx.awards`) that brings
a camp thing the camp has not had goes by the trail as a parcel and is noted in `earned`, while the
trail has room: a trophy (the award is the thing's id), a pull's thing (`pull:thing:<id>`), and a
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

| `do`           | Fields            | What it does                                                                                                                | Refused with                                                     |
| -------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `welcome`      | `cursor`          | Posts the mail while away (below); the member is welcomed today and here now; takes `cursor` if it is further on            |                                                                  |
| `here`         | `cursor`          | The member is here now; takes `cursor` if it is further on                                                                  |                                                                  |
| `openChest`    |                   | 3 Coins, once a UTC day                                                                                                     | `opened_today`                                                   |
| `spotCrab`     |                   | One more sighting, at most once in 5 seconds                                                                                | `too_soon`                                                       |
| `buy`          | `stall`, `thing`  | The thing goes by the trail; takes the stall's price                                                                        | `not_for_sale`, `trail_full` (200 waiting), `plenty` (999 of it) |
| `choosePet`    | `pet`             | The first pet                                                                                                               | `pet_chosen`                                                     |
| `greet`        | `visit`           | The caller waiting, by id: counted, what they brought posted, and gone                                                      | `no_such_visit`                                                  |
| `readMail`     |                   | Every letter read                                                                                                           |                                                                  |
| `takePresent`  | `letter`, `x y t` | The present set down there if it may stand there, else into the tray                                                        | `no_present`, `plenty` (the present stays in its letter)         |
| `clearLetters` |                   | Letters read and emptied are thrown out                                                                                     |                                                                  |
| `unpack`       | `x y t`           | The first parcel, set down there if it may stand there, else into the tray                                                  | `no_parcel`                                                      |
| `setOut`       | `thing`, `x y t`  | One out of the tray, there                                                                                                  | `not_in_tray`, `full` (300 standing), where it may not stand     |
| `move`         | `n`, `x y t`      | Moves and turns a thing                                                                                                     | `no_such_thing`, where it may not stand                          |
| `putAway`      | `n`               | Into the tray                                                                                                               | `no_such_thing`, `rooted` (the cabin, the mailbox, the signpost) |
| `toggle`       | `n`               | A lantern post or candle stump lit or dark; a paper lantern, pane or pennant the next of five colours; a gnome turned round | `no_such_thing`, `nothing_to_toggle`                             |
| `stay`         | `on`              | Whether the member's character stays in town after they go                                                                  |                                                                  |

Where a thing may not stand is said as `off` (in the trees), `trail`, `taken`, `shut` (it would
shut the cabin's door, the mailbox or the signpost off from the trail) or `cannot_turn` (it does
not turn that way). A command refused changes nothing.

`takePresent` and `unpack` answer `{ t: "landed", thing, n }` or `{ t: "tray", thing }`; the rest
answer no notes. `buy` takes the price (keyed `buy:<n>`) and `openChest` pays 3, `free`, keyed by
the UTC day. A thing bought, a pet chosen and a trophy unpacked are logged (`town_bought`,
`town_pet`, `town_trophy`).

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
what stands there, each thing in its own state, and the pet chosen first; the letters, parcels,
tray, caller and counters are left out (empty, or 0), and the arrival letter says nothing.

## Keeping it

`encodeTown` and `decodeTown`: Leaf's stored text, read back with every field's type checked but
trusting that each thing stands where it may (each change was checked when it was made), in
about 0.04 ms for the largest camp.
