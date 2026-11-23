# The Little Raid

The guild's auto battler: a board-and-shop game played with carved figures of forest spirits on a
hex board cut into the great stump at the edge of Guild Town. The member buys figures from a
rolling stall, seats them, and watches them fight by themselves through a little raid of fifteen
rooms. It is a place in the town (the town shows it in a frame over itself) and plays just the
same opened alone.

```sh
bun run dev      # with hot reload
bun run build    # dist/
bun test         # the rules, and the screen's own small questions
```

The rules are the package `@sequoia-leaf/raid` (`packages/raid`), with a README of their own that
says what is in the game and how a fight and a run go; Leaf plays the same package. Nothing in there
touches the page. Everything here is the screen.

The table is Leaf's. The run in hand, the almanac, the looks and the trail picked live on the
guild's server, in its play service (see the repository's README), and the page holds a copy to
draw from and sends every move there as a command. Opened where no Leaf answers, the page shows the
kit's card: "The table needs the guild's server."

## What is on the screen

- **The table.** The top of the stump seen close: its rings, the board in two halves of four rows,
  a bench of nine hollows along the near edge, two lantern posts, moss and ferns at the rim, the
  clearing and the far trunks behind, and dusk over all of it with the lanterns' light cut out. In
  a sparring room the regular who brought the party sits across the table, one of the battler's
  own figures drawn twice the size (Greg, the Hearth Cat, a Barrow Gnome, Crab #7, Orphion
  or a Moth), with a plate beside it that reads "Greg brought Mist Fangs", its name in the kit's
  leaf green with the acorn; two other regulars watch from logs where the window is wide enough.
- **The figures.** Every one of the twenty-eight, the forest's trouble and bosses, and the few that
  are only ever summoned, each as its own small picture with a base the colour of what it costs and
  its stars over its head. They breathe, turn to whoever they are fighting, lunge, recoil, strike a
  pose of their own to use an ability, and tip over.
- **Planning.** A figure may be dragged (mouse or finger) from the stall to the bench or the board,
  about the board and bench, onto another to change places, and onto the stall to sell it; the
  stall says what it would pay. Everything may be done by tapping instead: tap a figure, then tap
  where it goes; tap an offer to buy it; tap an item, then the figure to hold it. Hexes light for
  where a held figure may go, and a column of pips beside the front line shows how many may be
  fielded. Two fingers on the stall at once are two taps, and an offer let go over the offer it was
  picked from is a tap that slipped, and buys.
- **What things are.** Every thing on the table is a card in the kit's one card system
  (`card.ts`): resting the mouse on anything shows its card, clicking pins it, and a finger taps it
  open as a sheet above the stall (on the stall, the rack, a figure of the party's and the pick
  cards, where a tap buys, picks up or chooses, a finger kept on it asks instead). A thing named inside a card (a trait chip, an item, a figure in
  a trait's roster) opens its own card in the same place, with a back arrow. Cards say things in a
  few words, in the reading face, numbers in bold gold, heals and shields in green, and physical,
  magic and true damage each in a colour of its own. A figure's card has its picture, name, stars and price, what kind of fighter it is and where
  it stands ("Tank · front row · draws fire"), its kin and calling as chips with the party's count,
  a chip after them when its draw is not 0 ("Draws fire", "Draws fire ×2", "Slips notice", with a
  tip saying enemies pick it as if it stood a hex nearer or further), its numbers
  (green where an item, a trait or a boon raises one, coral where something lowers it), its
  ability, what it holds and three finished items that suit it (lit if the rack has one, or both
  its halves). A trait's card has its steps (the one reached lit, the next saying how many more),
  for the Bulwark and the Sneak first a line saying how they draw, and every figure that carries it,
  cheapest first: lit if fielded, tagged if on the bench or the stall. An item's card has what it adds, what
  it does and what it is made of; a component's has what it makes with each other half (that
  half's picture, an arrow, the finished item), the ones whose other half the party holds first,
  lit and tagged "have", as on the pick of a component. There are cards for a boon, a room on the track, the
  purse and the level too. The almanac's cards add the long sentence and the flavour line.
- **Traits.** A strip of chips, one for every trait the party has any of, with how many and how
  many the next step needs. When a step switches on the chip lights, the figures of that trait hop,
  and it says so. Pointing at a chip (in the strip, or on a figure's card) lights the trait: its
  figures on the board, the bench, the stall and across the table get a gold outline and hop once,
  and everyone else dims a little. A trait's card pinned open (a click or a tap) keeps it lit until
  the card is put away (a click elsewhere, Escape, the chip again), and so does a figure's card
  followed to from it. The cards say what is pointed at and pinned (`watch`); `ui/lit.ts` turns
  that into the trait that is lit.
- **Three become one.** The two that go hop onto the one that stays, it flashes, its new star pops
  with a ring and a run of notes; three stars is a larger ring, more sparks and a bell.
- **Acorns.** The purse shows the number and a row of piles, one for every ten held, lit as they
  fill, with what they will pay next room. Experience is a bar under the level. Rustle (free once a
  room), hold the stall, level up, set out.
- **Items.** Components, finished items and emblems sit on a rack. An emblem (what a charm boon
  gives) is drawn as its kin's sign; its card says its name, that its holder is of that kin too,
  and the kin as a chip, and a figure holding one has that kin among its chips and lights with it.
  Every figure shows what it holds as a row of up to three small pictures under its base (under its
  health bar in a fight), on both sides of the table, following it about and falling with it: a
  finished item or an emblem has a gold edge, a loose component the plain dark one, each on a small
  dark tile; pointing at one shows that item's card.
  The row is never wider than a hex, so it never reaches a neighbour on its row, and it is drawn
  with its figure, so a nearer figure stands in front of it. While a component is in the hand
  (carried or tapped), every figure holding its other half shows what the two would make, faint,
  over its head, and held over one a card says it by name.
- **Picks.** The first figure, a component, a boon: three cards over the board, with the one redraw
  for boons. What is taken flies to where it lives.
- **The fight.** Played from the rules' own steps at 1x, 2x or 4x, or skipped to its end. The two
  halves of the board slide together with a clack, traits switch on one after another, late crabs
  turn up and Sneaks leap; then each thing the rules say happened is shown on the board: things
  thrown fly (a seed, a pebble, a cone, a cup of tea), the hexes an ability covers light outward
  from the caster, shields settle, burns lick, the stunned see stars, heals rise as motes, numbers
  rise from whoever is hit. The lower panel is the tally meanwhile: "You" on the left and the other
  party on the right, a row for each figure (its small picture, its name, a bar and a number), sorted
  by the tab chosen and sliding into new places as that changes, six to a side and more scrolling.
  **Damage** draws each bar in physical coral, magic rose and true cream; **Tanked** in what got
  through (coral) and what armour, ward and shields kept off (grey); **Healing** in health given
  back (green) and shields (gold). Every bar on a tab is to one scale and the row with the most
  carries a star; what a summoned figure did is its summoner's. On an upright phone it shows one
  party at a time, with a "You / Them" switch beside the speeds.
- **After the fight** the tally rises over the table as a sheet titled with how it went and how long
  it took ("Room won · 14 s"), and the room's pay is counted out beside it, a line at a time, while
  acorns fly to the purse; "Carry on" goes on to planning (or to the end of the raid). While
  planning, "Last fight" by the room track opens the same sheet again until the next fight.
- **A boss** is not announced: it walks in from the trees, slowly, before the rest of its party.
- **The end of a run** is a page of paper: the rooms, the party that got there, what is new in the
  almanac, and the Coins paid into the member's purse. Then again, or back to town.
- **Round the game.** A front page (a line saying everyone plays with the same figures here; carry
  on, or which way to set out; the almanac; how to play; table looks; leave the table). Every one of
  the twenty-eight figures can be at the stall for everyone from the first run. The almanac shows
  every figure, trait and item met so far, which figures reached three stars, and how far each trail
  has been walked. Table looks are the one thing Leaf buys here: a cloth under the
  board, a different lantern, different bases; each is shown before it is bought and changes
  nothing but the picture.
- **First time.** One nudge at a time, in the place it matters: a hand points, one line says what
  to do, and it is gone for good once the thing has been done.

## What Leaf keeps, and what the browser keeps

Leaf keeps the table (`GET` and `POST /v1/game/play/raid`, through the kit's `play.ts`). The page
opens it as Leaf has it, and a run in hand is offered again on the front page, on any device; a run
left in the middle of a fight comes back at that fight, which plays out the same from the setup
Leaf kept; the last fight's setup is kept too, so "Last fight" plays it again after a reload.

Every move is a command (`src/screen/state.ts`):

- Moving, benching, swapping, selling, handing over an item, holding the stall, buying and
  experience are worked out on the page's copy by the shared rules (the package's `predict`) and
  shown at once, and sent. One Leaf turns down is taken back, and the member hears why.
- Rustling, the picks, setting out and the takings wait for Leaf, which draws what they draw (the
  stall, the picks, the fight's seed); while Leaf takes more than 150 ms, the thing asked for shows
  the kit's waiting look. Until Leaf answers, nothing else is done: the stall and its buttons dim,
  and a tap or a drag gets the refusal sound (a figure hops back). Setting out, Leaf locks both
  boards and decides the fight; the page plays the same fight from the setup and seed in Leaf's
  answer.
- Whenever Leaf's state is not what the page was showing (the member played on in another page, a
  guess was wrong, something was changed by hand), the page takes Leaf's and draws again.

Coins shown are the kit's purse's, which are Leaf's, the same number the town and the Works show;
the purse asks Leaf again when a run has paid. A finished or abandoned run pays them on Leaf. Leaf
is the kit's purse too, from the guild's ledger. A look's Buy button sends `buyLook`, which Leaf
does by taking the look's price from the ledger, and the purse then asks Leaf for the Leaf again;
for a guest, or while Leaf's spending is off (`leafOpen()`), the button is closed.

The browser keeps only the member's view settings (`raid.prefs.v1`, `src/screen/keep.ts`): the
speed fights are watched at and the first-time nudges already given.

## In the town's frame

The page says `ready` once it has drawn, sends `news` for a boss seen off, a raid cleared and a
first three-star figure, and asks to `leave` from "Leave the table" and "Back to town". It leaves
the town a postcard (`postcard` in `src/screen/logic.ts`: a raid under way, and every boss ever
beaten) whenever that changes.

The page first awaits the kit's `start()` (who the member is), then opens the table from Leaf, and
says the member is at the table; signed out, it shows the kit's card for that.

## How it is put together

The table is drawn small, one art pixel to a pixel, and blown up to the window by a whole number
(three on a usual desktop window, two on a phone held upright). The painted table is made once for
the size of the window and kept; each frame draws it, then the two halves of the board, then
everyone standing on it from far to near. Words over it (numbers, ability names) are written on
the enlarged picture in the kit's font. A second canvas lies over the whole interface for the few
things that cross it: a figure in the hand, acorns on their way to the purse. Everything that is
not the table is built from the kit's classes; `raid.css` only says where things go, with one
arrangement for a wide window and another for a phone held upright.

The clock only moves in the stage's `tick`, and a fight's clock is counted from it, so everything
timed can be stepped by hand.

| File                          | What it holds                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/main.ts`                 | Puts the parts together; speaks to the town                                                      |
| `@sequoia-leaf/raid`          | The rules, and the table as Leaf plays it (`packages/raid`, with its README)                     |
| `src/screen/state.ts`         | The page's copy of Leaf's table and what is on screen; every move is a command (`doNow`, `ask`)  |
| `src/screen/flow.ts`          | What happens when: sitting down, setting out, the fight, counting out the takings, the end       |
| `src/screen/stage.ts`         | The canvases, the size of an art pixel, where the board sits, the clock                          |
| `src/screen/geometry.ts`      | Where hexes, seats and bench hollows are, and which is under a point                             |
| `src/screen/scene.ts`         | Drawing a frame: the board, lit hexes, who is waiting across it, the party, the fight            |
| `src/screen/pawns.ts`         | The party's figures on board and bench; buying, selling and three-become-one acted out           |
| `src/screen/hand.ts`          | Dragging and tapping, and asking what a thing is                                                 |
| `src/screen/light.ts`         | Which trait is lit (pointed at, or clicked and kept), and how that shows on a figure             |
| `src/screen/rich.ts`          | The words on a card sorted for colouring: numbers, heals and shields, kinds of damage            |
| `src/screen/fightview.ts`     | The fight played from the rules' events                                                          |
| `src/screen/fx.ts`            | Sparks, rings, rising words, things that fly, "in a moment"                                      |
| `src/screen/logic.ts`         | Small questions asked of a run: where a figure may go, what an item would make, the next nudge   |
| `src/screen/keep.ts`          | The view settings kept in the browser                                                            |
| `src/screen/sounds.ts`        | The table's sounds, made from the kit's tones                                                    |
| `src/screen/signals.ts`       | Small happenings more than one part answers: an acorn landing, a star                            |
| `src/screen/handle.ts`        | `window.raid`, for looking at the game from outside                                              |
| `@sequoia-leaf/figures`       | The figures' pictures, which the town draws too (`packages/figures`, with its README)            |
| `src/screen/art/icons.ts`     | A small picture for every trait, item, boon, kind of room and button                             |
| `src/screen/art/table.ts`     | The painted table, the halves of the board, the looks                                            |
| `src/screen/art/pal.ts`       | A colour for each trait                                                                          |
| `src/screen/ui/table.ts`      | The interface round the table: purse, track, traits, rack, stall, buttons, the fight's panel     |
| `src/screen/ui/tally.ts`      | The tally as rows and bars, two parties side by side (one at a time on a phone), with its tabs   |
| `src/screen/ui/fightsheet.ts` | The sheet of a fight that is over: after it with the takings and "Carry on", or "Last fight"     |
| `src/screen/held.ts`          | What a figure holds: where the row of small pictures under its base goes, drawing it, hitting it |
| `src/screen/ui/cards.ts`      | What each thing says about itself, registered with the kit's cards, and the references to them   |
| `src/screen/ui/lit.ts`        | Which trait the cards have pointed at or pinned, and marking the chips and the stall for it      |
| `src/screen/ui/picks.ts`      | Three cards to choose from                                                                       |
| `src/screen/ui/pages.ts`      | The front page, the almanac, how to play, table looks, the end of a run                          |
| `src/screen/ui/nudge.ts`      | The first-time nudges                                                                            |

`geometry.ts`, `logic.ts`, `keep.ts`, `light.ts` and `rich.ts` have tests beside them.

## Looking at it from outside

A headless browser draws about a frame a second, so the page puts a handle on `window.raid`:
`hold(true)` stops the clock so that only `skip(seconds)` and `tick(steps)` move it. Whatever plays
goes to Leaf as commands, so these give back promises: `start(seed, trail)` begins a run; `bot(rooms)`
has the rules' bot play whole rooms unseen and `plan()` has it plan the room that is up (the bot plans
on the page's copy and sends what it would do, `planCommands`); `to("boon" | "component" | "boss" |
"lastboss" | "end" | "front")` plays on to a moment worth looking at; `fight()` sets out;
`settled()` waits until Leaf has answered everything sent; `send(command)` sends one as the page
would. `fresh()` (a new member), `start` from a chosen seed, `acorns(n)`, `give(kind)`, `offer(at,
kind)`, `item(id)` and `strip()` stage a moment play does not reach (a merge, an item to forge,
empty hands): they ask the play server the tours run against (`apps/api/test/play.ts`, at
`/test/play/raid`), and on the guild's own Leaf, which has no such route, do nothing. `busy()` runs
a fight on to a moment with an ability's hexes lit and something in the air; `party()` lists the
party's figures by number for `grab(id, x, y)`, `tap(id)`, `hover(itemAt, id)`, `hand(itemAt, id)`
and `drop()`; `at(id)` and `heldAt(id, i)` say where a figure and what it holds are on the page,
and `rack()` and `held()` what is on the rack and in every hand; `page(id)` opens a page;
`arrive()` has whoever is waiting walk in again; `taught()` counts every nudge as given; `state()`
says where things stand (the Coins too); `bench()` times a frame; `carry()` presses "Carry on",
`last()` opens or puts away "Last fight", and `tally(measure, side)` chooses a tab of the tally and,
on a phone, a party. `copy()` is the page's own copy of the run and `leaf()` the copy of Leaf's
table it draws from, to change by hand and see Leaf's next answer put it back; `redraw()` draws the
table from them.

`?sheet` in the address shows every figure on one sheet with its name.

The lists in `review/` are the tours the screenshots came from. `review/tour.ts` runs one against a
play server of its own: it builds the page, starts `apps/api/test/play.ts` on a free port with
`--dice 1` (so the tour plays the same game every time), signs in as its Tester and has the kit's
driver go through the steps:

```sh
bun review/tour.ts review/tour-desktop.json <out-dir>
bun review/tour.ts review/tour-phone.json <out-dir>
bun review/tour.ts review/sheet.json <out-dir> sheet
```

`review/feel.json` and `review/feel-phone.json` go through who gets hit, what everyone did and the
open table: the front page, a Bulwark's card with its draw chip and tip, a fight with each of the
tally's three tabs, the sheet after a lost room and a won one, and "Last fight" while planning.

`review/kit-cards.json` and `review/kit-cards-phone.json` go through what the kit's cards brought:
a board with figures holding nothing, one component and three items, a held item's card, a card
followed to with its back arrow, a trait pinned with its figures lit, what a component would make,
the component pick with an item's card from a "makes" line, and a fight. `review/cards.json` and
`review/cards-phone.json` go through the cards: a figure at one and two
stars, one holding items, one on the stall, a trait pointed at and clicked, a figure opened from a
trait's card, items, a boon pick. `review/trait-hover.json` points at a trait's chip through the
moments a card used to go missing (a click on the chip, the stall changing size, the strip drawn
again under the pointer, just after a drag, the first room with a nudge up) and prints whether the
card is up after each.

`review/balance.ts` plays whole runs with bots of different habits and prints how far each gets
(`bun review/balance.ts 200 0`); it is the rules' gauge and has nothing to do with the screen. Its
`suits` section is how the items a card recommends were checked.

## Where the shape comes from

A stall phase and then a fight that plays itself, a hex board, traits, three of a kind becoming one
stronger, and items made of two halves are the genre's. Nothing of any other game's content is
here: the figures, the trouble, the abilities, the items, the boons, the words and the numbers are
the guild's own.
