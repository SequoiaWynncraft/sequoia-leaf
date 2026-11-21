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

The rules are in `src/game/`, with a README of their own that says what is in the game and how a
fight and a run go. Nothing in there touches the page. Everything else here is the screen.

## What is on the screen

- **The table.** The top of the stump seen close: its rings, the board in two halves of four rows,
  a bench of nine hollows along the near edge, two lantern posts, moss and ferns at the rim, the
  clearing and the far trunks behind, and dusk over all of it with the lanterns' light cut out. In
  a sparring room the guild-mate who brought the party sits across the table; two more watch from
  logs where the window is wide enough.
- **The figures.** Every one of the twenty-eight, the forest's trouble and bosses, and the few that
  are only ever summoned, each as its own small picture with a base the colour of what it costs and
  its stars over its head. They breathe, turn to whoever they are fighting, lunge, recoil, strike a
  pose of their own to use an ability, and tip over.
- **Planning.** A figure may be dragged (mouse or finger) from the stall to the bench or the board,
  about the board and bench, onto another to change places, and onto the stall to sell it; the
  stall says what it would pay. Everything may be done by tapping instead: tap a figure, then tap
  where it goes; tap an offer to buy it; tap an item, then the figure to hold it. Hexes light for
  where a held figure may go, and a column of pips beside the front line shows how many may be
  fielded.
- **What things are.** Every thing on the table is a card in the kit's one card system
  (`card.ts`): resting the mouse on anything shows its card, clicking pins it, and a finger taps it
  open as a sheet along the bottom (on the stall and the rack, where a tap buys or picks up, a
  finger kept on it asks instead). A thing named inside a card (a trait chip, an item, a figure in
  a trait's roster) opens its own card in the same place, with a back arrow. Cards say things in a
  few words, in the reading face, numbers in bold gold, heals and shields in green, and physical,
  magic and true damage each in a colour of its own. A figure's card has its picture, name, stars and price, what kind of fighter it is and where
  it stands ("Tank · front row"), its kin and calling as chips with the party's count, its numbers
  (green where an item, a trait or a boon raises one, coral where something lowers it), its
  ability, what it holds and three finished items that suit it (lit if the rack has one, or both
  its halves). A trait's card has its steps (the one reached lit, the next saying how many more)
  and every figure that carries it, cheapest first: lit if fielded, tagged if on the bench or the
  stall, a dark outline with what opens it if not opened yet. An item's card has what it adds, what
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
- **Items.** Components and finished items sit on a rack. Every figure shows what it holds as a
  row of up to three small pictures under its base (under its health bar in a fight), on both sides
  of the table, following it about and falling with it: a finished item has a gold edge, a loose
  component the plain dark one, each on a small dark tile; pointing at one shows that item's card.
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
  rise from whoever is hit. A panel keeps count of who has done most. Afterwards the room's pay is
  counted out: acorns fly to the purse, savings an acorn at a time.
- **A boss** is not announced: it walks in from the trees, slowly, before the rest of its party.
- **The end of a run** is a page of paper: the rooms, the party that got there, anything opened
  (the dark outline turns into the figure), what is new in the almanac, and the Coins paid into the
  member's purse. Then again, or back to town.
- **Round the game.** A front page (carry on, or which way to set out; the almanac; how to play;
  table looks; leave the table). The almanac shows every figure, trait and item met so far and how
  far each trail has been walked. Table looks are the one thing Leaf buys here: a cloth under the
  board, a different lantern, different bases; each is shown before it is bought and changes
  nothing but the picture.
- **First time.** One nudge at a time, in the place it matters: a hand points, one line says what
  to do, and it is gone for good once the thing has been done.

## What it keeps

Three texts in the browser, each with a version on it:

- the run in progress (`raid.run.v1`, the rules' own `saveRun`), written after every action and
  offered again on the front page; a run saved in the middle of a fight comes back at the start of
  that fight, which plays out the same;
- the almanac (`raid.almanac.v1`, the rules' own `saveAlmanac`);
- the member's prefs (`raid.prefs.v1`, `src/screen/keep.ts`): the looks bought and worn, the speed
  fights are watched at, the trail last walked, the nudges already given.

Leaf and Coins are the kit's one purse. A finished run pays its Coins in with `earn`; a look takes
its Leaf with `spend`, where Leaf may be spent.

## In the town's frame

The page says `ready` once it has drawn, sends `news` for a boss seen off, a raid cleared and a
first three-star figure, asks to `leave` from "Leave the table" and "Back to town", and saves when
the town says `closing`. It leaves the town a postcard (`postcard` in `src/screen/logic.ts`: a raid
under way, and every boss ever beaten) whenever that changes.

On the guild's own server the page first awaits the kit's `start()` and pulls its saves (the
`purse` and `raid` slots, and `town` too when opened on its own), shows the looks' Buy buttons
closed, and says the member is at the table; the kit's README says how.

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

| File                                | What it holds                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/main.ts`                       | Puts the parts together; speaks to the town                                                      |
| `src/game/`                         | The rules (see its README)                                                                       |
| `src/screen/state.ts`               | The run, the almanac, the prefs and what is on screen; every action goes through `act`           |
| `src/screen/flow.ts`                | What happens when: sitting down, setting out, the fight, counting out the takings, the end       |
| `src/screen/stage.ts`               | The canvases, the size of an art pixel, where the board sits, the clock                          |
| `src/screen/geometry.ts`            | Where hexes, seats and bench hollows are, and which is under a point                             |
| `src/screen/scene.ts`               | Drawing a frame: the board, lit hexes, who is waiting across it, the party, the fight            |
| `src/screen/pawns.ts`               | The party's figures on board and bench; buying, selling and three-become-one acted out           |
| `src/screen/hand.ts`                | Dragging and tapping, and asking what a thing is                                                 |
| `src/screen/light.ts`               | Which trait is lit (pointed at, or clicked and kept), and how that shows on a figure             |
| `src/screen/rich.ts`                | The words on a card sorted for colouring: numbers, heals and shields, kinds of damage            |
| `src/screen/fightview.ts`           | The fight played from the rules' events                                                          |
| `src/screen/fx.ts`                  | Sparks, rings, rising words, things that fly, "in a moment"                                      |
| `src/screen/logic.ts`               | Small questions asked of a run: where a figure may go, what an item would make, the next nudge   |
| `src/screen/keep.ts`                | Prefs and looks, and reading and writing what is kept                                            |
| `src/screen/sounds.ts`              | The table's sounds, made from the kit's tones                                                    |
| `src/screen/signals.ts`             | Small happenings more than one part answers: an acorn landing, a star                            |
| `src/screen/handle.ts`              | `window.raid`, for looking at the game from outside                                              |
| `src/screen/art/figures.ts`         | Every figure, typed out as rows of letters                                                       |
| `src/screen/art/sprites.ts`         | Those rows baked into pictures: standing, breathing, casting, tipped over; bases and stars       |
| `src/screen/art/icons.ts`           | A small picture for every trait, item, boon, kind of room and button                             |
| `src/screen/art/table.ts`           | The painted table, the halves of the board, the looks                                            |
| `src/screen/art/mates.ts`, `pal.ts` | The guild-mates at the table; the letters' colours, and the colours that mean something          |
| `src/screen/ui/table.ts`            | The interface round the table: purse, track, traits, rack, stall, buttons, the fight's count     |
| `src/screen/held.ts`                | What a figure holds: where the row of small pictures under its base goes, drawing it, hitting it |
| `src/screen/ui/cards.ts`            | What each thing says about itself, registered with the kit's cards, and the references to them   |
| `src/screen/ui/lit.ts`              | Which trait the cards have pointed at or pinned, and marking the chips and the stall for it      |
| `src/screen/ui/picks.ts`            | Three cards to choose from                                                                       |
| `src/screen/ui/pages.ts`            | The front page, the almanac, how to play, table looks, the end of a run                          |
| `src/screen/ui/nudge.ts`            | The first-time nudges                                                                            |

`geometry.ts`, `logic.ts`, `keep.ts`, `light.ts` and `rich.ts` have tests beside them.

## Looking at it from outside

A headless browser draws about a frame a second, so the page puts a handle on `window.raid`:
`hold(true)` stops the clock so that only `skip(seconds)` and `tick(steps)` move it; `fresh()` is a
new member; `start(seed, trail)` begins a run; `bot(rooms)` has the rules' bot play whole rooms
unseen and `plan()` has it plan the room that is up; `to("boon" | "component" | "boss" | "lastboss"
| "end" | "front")` plays on to a moment worth looking at; `fight()` sets out; `busy()` runs a fight
on to a moment with an ability's hexes lit and something in the air; `party()` lists the party's
figures by number for `grab(id, x, y)`, `tap(id)`, `hover(itemAt, id)`, `hand(itemAt, id)` and
`drop()`; `acorns(n)`, `give(kind)`, `offer(at, kind)`, `item(id)` and `strip()` stage a moment (a merge, an
item to forge, empty hands); `at(id)` and `heldAt(id, i)` say where a figure and what it holds are
on the page, and `rack()` and `held()` what is on the rack and in every hand; `page(id)` opens a page; `arrive()` has whoever is waiting walk in again;
`taught()` counts every nudge as given; `state()` says where things stand; `bench()` times a frame.

`?sheet` in the address shows every figure on one sheet with its name.

The lists in `review/` are the tours the screenshots came from, for the kit's driver:

```sh
bun run build
bun ../../packages/kit/tools/drive.ts "http://raid.test/" <out-dir> review/tour-desktop.json dist
bun ../../packages/kit/tools/drive.ts "http://raid.test/" <out-dir> review/tour-phone.json dist
bun ../../packages/kit/tools/drive.ts "http://raid.test/?sheet" <out-dir> review/sheet.json dist
```

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
