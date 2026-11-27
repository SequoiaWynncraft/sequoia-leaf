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
  own figures drawn twice the size (Greg, Vesta, Hodge, Nipper, Orphion
  or Moth), with a plate beside it that reads "Greg brought Mist Fangs", its name in the kit's
  leaf green with the acorn; two other regulars watch from logs where the window is wide enough.
- **The figures.** Every one of the twenty-eight, the forest's trouble and bosses, and the few that
  are only ever summoned, each as its own small picture with a base the colour of what it costs and
  its stars over its head. They breathe, turn to whoever they are fighting, lunge, recoil, strike a
  pose of their own to use an ability, and tip over.
- **Planning.** A figure may be dragged (mouse or finger) from the stall to the bench or the board,
  about the board and bench, onto another to change places, and onto the stall to sell it; the
  stall says what it would pay. With a Greg in the party, a figure carried from the bench finds the
  stall split in two: "Sell for +2" and beside it "Feed Greg +6%" (what that figure would add, said
  before it is let go; "Greg is full", and no target, at 40%). Let go there, it hops into Greg, he
  gulps and his number rises over him, and what it held flies to the rack (`ui/feedtarget.ts`); a
  bench figure's card has the same button beside Sell, for the keyboard and a finger. Everything may be done by tapping instead: tap a figure, then tap
  where it goes; tap an offer to buy it. Hexes light for
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
  it stands ("Tank · front row · draws fire"), its origin and class as chips with the party's count,
  a chip after them when its draw is not 0 ("Draws fire", "Draws fire ×2", "Slips notice", with a
  tip saying enemies pick it as if it stood a hex nearer or further), its numbers
  (green where an item, a trait or a boon raises one, coral where something lowers it), its
  ability, what it holds and three finished items that suit it. On one of the party's own while
  planning, each of the three is a line: lit with a "Make" button (or "Give", for one already on
  the rack) where it can be had now from the rack and what the figure holds, which makes it and
  hands it over in one press; else the pictures of the components still missing, "held", or "no
  room". On anybody else's, the three are pictures, lit where the rack could make one for it. A trait's card has its steps (the one reached lit, the next saying how many more),
  for the Bulwark and the Sneak first a line saying how they draw, and every figure that carries it,
  cheapest first: lit if fielded, tagged if on the bench or the stall. An item's card has what it adds, what
  it does and what it is made of; a component's has what it makes with each other half (that
  half's picture, an arrow, the finished item), the ones whose other half the party holds first,
  lit and tagged "have", as on the pick of a component. At the end of each "makes" line are the
  small pictures of the fielded figures that want that item (`making.ts`, `wanters`: it is one of
  the three that suit a figure on the board that does not hold it and has a place for it), and the
  lines somebody wants come before the rest; the pick of a component has them under its name too. There are cards for a boon, a room on the track, the
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
  gives) is drawn as its origin's sign; its card says its name, that its holder is of that origin
  too, and the origin as a chip, and a figure holding one has it among its chips and lights with it.
  Every figure shows what it holds as a row of up to three small pictures under its base (under its
  health bar in a fight), on both sides of the table, following it about and falling with it: a
  finished item or an emblem has a gold edge, a loose component the plain dark one, each on a small
  dark tile; pointing at one shows that item's card.
  The row is never wider than a hex, so it never reaches a neighbour on its row, and it is drawn
  with its figure, so a nearer figure stands in front of it.
- **Handing over and making items.** An item may be dragged onto a figure, and a component onto
  another component on the rack; or tapped, and then the figure or the other component tapped.
  While it is in the hand, the figures that could take it have brackets at their feet, every
  figure holding its other half shows what the two would make, faint, over its head, and the
  components it pairs with on the rack pulse. Over a figure or a pairing component (carried, or
  tapped as its aim), a tip says what letting go would do: the item the two would make, as its own
  card says it; or what the figure gets and how many of its 3 places are full then; or why it
  cannot (the refusal's own words). Carried, letting go does it; tapped, the tip's button does, or
  a second tap on the same aim. A mouse's click on an item pins its card beside the rack, and on a
  figure of the party's beside the board; a finger's tap pins none, since a sheet would cover the
  board where the next tap goes (a finger kept on the thing asks for its card). Two components on the rack become the finished item in the first
  one's place. Nothing is taken apart again. Let go anywhere else, nothing happens. The keyboard
  does the same with Enter on the rack's places, and with the buttons on a figure's card.
- **Who wants what.** While an item is in the hand, or pointed at or focused (on the rack, in a
  card, or a component on its pick), each fielded figure that wants it has a small heart beside its
  head; a place on the rack whose item somebody fielded wants has the same heart in its corner.
- **Picks.** The first figure, a component, a boon: three cards over the board, with the one redraw
  for boons. What is taken flies to where it lives.
- **The fight.** Played from the rules' own steps at 1x, 2x or 4x, or skipped to its end. The two
  halves of the board slide together with a clack, traits switch on one after another, late crabs
  turn up and Sneaks leap; then each thing the rules say happened is shown on the board, at the
  step the rules say: things thrown fly (an attack throws a small thing of the thrower's colour, an
  ability its own: a seed, a pebble, a cone, a cup of tea), the hexes an ability covers light
  outward from the caster, shields settle, burns lick, the stunned see stars, heals rise as motes,
  numbers rise from whoever is hit. The table looks a few steps ahead, so each blow has its lead-in:
  a figure draws back and lunges so that the blow peaks as its number shows, winds up before its
  ability goes off (each in a way of its own, with light gathering in), and sets off on a leap so
  that it comes down as its damage does. Each ability leaves its own mark and has its own sound.
  Figures squash and stretch as they hop, walk, land and are hit, take a sore edge when hit, and
  tumble off their base and go in a puff of their own when they fall. A Groot figure that will get
  back up lies where it fell instead, and its true form rises in five beats on the fight's clock
  (`risetime.ts`, `rising.ts`): it lies a moment, the table dims to its hex, its raid's ring draws
  round it a gold stud at a time while friends lean away, it stands in its new shape as the ring
  snaps shut with a bump and a low horn, and the ring stays faint under it until it falls again
  (`rings.ts`: eggshell for the Worm, strata for the Rock, a missing ring of static for Greg, a gold
  halo for Orphion, torn cloth for the Moth); it still stands if the fight ends first. Seqwawa never
  moves: its sprout shakes, roots run out along the hexes to every friend, wait coiled at the
  fallen one's hex, flash as it goes off and stand that one back up, and stay faint under those
  hexes for the fight (`roots.ts`). A hard hit, an ability that
  hits two or more and a fall hold the fight's clock a moment, and the big moments bump the board
  on the stump; both less at 2x, almost not at 4x, and no bump for a player whose system asks for
  less motion. The lower panel is the tally meanwhile: "You" on the left and the other
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
- **Round the game.** A front page that picks a way to play (`ui/modes.ts` is the table of them,
  `ui/front.ts` draws it). Along the top a strip for each run laid out, the run in hand and the
  endless run beside it: what it is (its trail, or its endless way), its room and health, End this
  raid (asked first, and saying how many rooms it is paid for) and Carry on; and the member's live
  table, started and not over, after them. Down the left the
  categories as large tabs (Normal, Endless, Versus), and under the chosen one its modes as cards;
  a mode the page cannot set out on yet (`setOut` null) is not shown, nor a category with none
  shown; the live tables (Versus) have a card of their own (`tables`, below). In the middle the chosen mode's card: its name, one sentence, a
  picture of the table as it is dressed (the words of every mode in its category laid in one
  place, so choosing between them moves nothing), its options, and its foot: Set out, or Carry on
  with its run laid out and New raid beside it once that run has fought a room, with a line under
  them saying why Set out is closed or what a new raid ends. On the right its board, a title and
  rows of a rank, a name and a number, the member's own lit (and under the list when below it);
  the trails' board is the guild's by bosses beaten, or the member's own records until it has
  anybody. Along the bottom the almanac, how to play, table looks and leave the table. On an
  upright phone it is the same, one part under another, the mode alone in its category not
  listed.
- **The endless ways** (`ui/endless.ts`, `ui/woods.ts`): the Wilds and the Deep Woods, under
  Endless, set out an endless run beside the run in hand, which is not touched. Their card says
  what grows after room 15 and what pays; the Deep Woods' also lists the rooms the member holds this
  week, and until they have set out there, that their board and name can be met there (Set out is
  the agreement). The Wilds' board is the deepest room won, ever or this week (two tabs); the Deep
  Woods' is this week's. When a room of the Deep Woods has been taken from the member since they
  last looked, the front page says so once, at the top: "Room 22 was taken from you by Birchwood."
  While the front page is up, the news, the rooms held and the board are read again every minute,
  and the page drawn again (the keyboard and the scroll where they were) only when one changed.
  At the table an endless run past room 15 has its room before the track's pips ("Room 23"; on a
  phone the number), the level's plaque says its chairs ("Chairs: 10") once a boss past room 15 has
  given one, a held room's card says who holds it, and a room the forest grows in says by how much
  ("+41% health and attack"). Its end page says how deep it went and the member's deepest.
  **The Wilds' rules** (`ui/wilds.ts`, `ui/rulecards.ts`, `closed.ts`, `ui/back.ts`): after each
  boss from room 5 the pick is two rule cards, each with a small picture of the board under it, and
  beside them the boss the next five rooms end with. The rule is on each of its rooms' cards; the
  hexes it closes are drawn on the board (a stump, a column grown over, Long Table's front rows bare
  while planning), in the fight as well; and in a fight under it, the rule is one line over the
  bench. Figures moved off a hex that closed are named in one line. Carry on with a run of the Wilds
  shows a card first: the room and the wing it ends, the rule, the boss waiting, the deepest room ever
  and the last room, with Carry on and Watch it again (the run's last fight, played on the table,
  then the room is planned as it was). The
  trails' options are the figures to set out with and the
  three trails (a radio group: the arrows choose; one not open yet can be chosen to look at, and
  then Set out says why it is closed), with what the chosen one is under them. Whatever is chosen,
  the card, the board and the button stay where they are: the words of every trail and of each way
  are laid in one place with only the chosen one shown. A member who has pulled a figure at the
  Grove chooses there between "All figures" and "Your figures"; the second says how many they
  have, what the stall sells, what a copy does and that such a raid is not counted. A member who
  has pulled none is not asked.
- **A level** (in a raid with the member's own figures) is a small green "Lv 3" on the stall's card,
  in the head of the figure's card with the line "Level 3: 9% more health and attack.", under the
  figure on the end page, and a small green number at the left of its base on
  the board and the bench. It is never drawn as a star. The almanac's tiles show the level of every
  figure pulled. While such a raid is in hand, a sign in the top bar says "Your figures" (and "All
  figures" on the main way, for a member who has both). A banner's member a member has pulled is a
  figure there too: wherever it shows it has that member's name and is drawn from their skin
  (`meetMember`; "A guild member", all of one dusk colour, until Leaf has said who), the front
  page counts it ("You have 14 of 29 figures"), and the almanac has a tile for it after the
  twenty-eight. Every one of
  the twenty-eight figures can be at the stall for everyone from the first run. The almanac shows
  every figure, trait and item met so far, which figures reached three stars, and how far each trail
  has been walked. Table looks are the one thing Leaf buys here: the place the
  table stands, a cloth under the board, a different lantern, different bases; each is shown
  before it is bought and changes nothing but the picture.
- **The guild hall.** The second place the table may stand, late at night: a long oak table where
  the stump is and of the same size, so the board, the bench, the lanterns (on iron stands on the
  table) and whoever sits round it are where they are in the clearing. Stone flags and a blue
  runner under it, the hearth lit on the far wall to the left, the moon through the windows to
  the right, the guild's banners. The fire, its sparks, the candle on the table, a moth at a
  lantern, the cat by the hearth and the dust in the moon move; nothing of it crosses the board.
- **First time.** One nudge at a time, in the place it matters: a hand points, one line says what
  to do, and it is gone for good once the thing has been done.

## A live table

Up to eight members at one table of the raid, on Leaf's clock (`/v1/game/sittings`, the rules'
`sitting/`): everyone on their own board through the same rooms, sparring rooms in pairs, a
carousel, regulars in the empty seats. The page is in `src/screen/live/`.

- **On the front page** (Versus, Live tables, `live/tables.ts` drawing what `live/listing.ts` knows): the tables open to sit at (who
  opened each, how many sat) with Sit down, and Open a table; once sat, the table's eight seats
  (an empty one says "A regular will sit here"), Start for whoever opened it and Leave for anyone;
  once started, Carry on and Leave (asked first: it is going out). The board is the
  member's record: played, won, in the first four. A table started is a strip along the top too,
  with Carry on, as a run in hand is; a member who closed the page finds it there again.
- **At the table** the shared table is driven by the seat's run as Leaf shows it (`live/seated.ts`
  sets `LIVE.seat` in `state.ts`, which then sends the member's commands to the sitting and draws
  their run; the front page lets it go; `live/seat.ts` draws the rest). Leaf's answer to a command
  touches the table only while the member is still at that seat (`ours`): one that comes after they
  stepped back is the line's alone, and the solo raid never hears of it. Planning predicts what the solo table predicts, and Leaf's
  answer wins. Set out is not there: the clock sets out. Along the top the clock (`live/hud.ts`):
  the stage, the seconds left of it counted to the sitting's own deadline, and under it whom the
  member faces or the carousel's turn. Down the right the players in seat order, each with a bar
  and a number of health, out ones with their place, the member's own lit; a click opens that
  player's board as it stood at the last lock. On an upright phone the clock and the players are
  one row of small chips over the board, with the clock's second line under it.
- **The fight** is played from the seat's own setup. The away seat of a sparring pair is the
  second side of the one fight the pair fights: `sides.ts` says so (`OWN.side`), the fight is
  drawn with the board turned round (`shownCell`, `FV.ours`) so the member's figures are on the
  near half and "You" in the tally, and it is played to the outcome turned back, as Leaf decided it.
  When the sitting goes on, what the room paid is said over the board (`paidLines`: how it went,
  health, acorns, a level), from the run before and after, as Leaf gives no notes for the clock's work.
- **The carousel** (`live/ring.ts`): nine figures in a ring over the far half, each with the
  component it holds; the ring is the member's to click when their turn is open, a figure taken is
  gone, and who took what shows by their row. During it the stall waits and no pick is up.
- **Going out** and **the end** are papers (`live/panels.ts`): the place, the Coins (the run's own
  payout, and what the purse took if less), watching on or leaving; and every place.
- **Being told**: the line (`live/line.ts`) reads the sitting with the `rev` it has at the stage's
  deadline, every 2 seconds while it is open or in a carousel, and as the page comes back; Leaf has
  no live room for sittings yet. An answer older than the revision the page holds (two reads
  crossing) is let go. Commands go in batches with ids, sent again as they were after a failure;
  putting the line away answers whatever still waits. Whenever Leaf's view shows the member
  without a seat (left in another tab, or the table closed before it started), the page lets the
  table go and shows the list, saying why. The first read of the list is tried again until Leaf
  answers it, and a list read asked before the member took up or let go of a table is not acted on.

`live/reads.ts` holds the small questions (the clock's words, the players' rows, the carousel's
turn, places in words), tested against sittings the rules play (`live/reads.test.ts`);
`live/line.test.ts`, `live/seated.test.ts` and `live/listing.test.ts` play the line, the seat and the card
against the kit's stand-in Leaf.

## What Leaf keeps, and what the browser keeps

Leaf keeps the table (`GET` and `POST /v1/game/play/raid`, through the kit's `play.ts`). The page
opens it as Leaf has it, and a run in hand is offered again on the front page, on any device; a run
left in the middle of a fight comes back at that fight, played from the setup Leaf kept to the
outcome Leaf kept; the last fight's setup is kept too, so "Last fight" plays it again after a
reload. A fight these rules would play otherwise than Leaf decided it (a page opened before a
deploy) is not shown: only how Leaf says it came out, and what it paid.

Every move is a command (`src/screen/state.ts`):

- Moving, benching, swapping, selling, handing over an item, making one on the rack, holding the
  stall, buying and experience are worked out on the page's copy by the shared rules (the package's `predict`) and
  shown at once, and sent. One Leaf turns down is taken back, and the member hears why.
- Rustling, the picks, setting out and the takings wait for Leaf, which draws what they draw (the
  stall, the picks, the fight's seed); while Leaf takes more than 150 ms, the thing asked for shows
  the kit's waiting look. Until Leaf answers, nothing else is done: the stall and its buttons dim,
  and a tap or a drag gets the refusal sound (a figure hops back). Setting out, Leaf locks both
  boards and decides the fight; the page plays the same fight from the setup and seed in Leaf's
  answer.
- Whenever Leaf's state is not what the page was showing (the member played on in another page, a
  guess was wrong, something was changed by hand), the page takes Leaf's and draws again.

What the table is showing is one value (`src/screen/screen.ts`): the front page, planning a room
(and whether "Last fight" is up), a fight being played, its takings being counted out, or how a run
ended; one pure `step` moves it, and `bun test` covers every move. A fight on screen is a playback
of its own (the run's number at the table, its room, its seed): it plays to its end whatever Leaf's
run does meanwhile, then the takings are asked for; taken on another page already, the table goes
on to the room Leaf's run is in. While the takings are counted, the purse, health and level show
what they were until their line is counted (`shownCounts`).

Coins shown are the kit's purse's, which are Leaf's, the same number the town and the Works show;
the purse asks Leaf again when a run has paid. A finished or abandoned run pays them on Leaf. Leaf
is the kit's purse too, from the guild's ledger. A look's Buy button sends `buyLook`, which Leaf
does by taking the look's price from the ledger, and the purse then asks Leaf for the Leaf again;
for a guest, or while Leaf's spending is off (`leafOpen()`), the button is closed.

The browser keeps only the member's view settings (`raid.prefs.v1`, `src/screen/keep.ts`): the
speed fights are watched at and the first-time nudges already given; and the newest of the member's
events already looked at for a room taken (`raid.taken.v1:<Leaf id>`, `ui/woods.ts`), so it is said
to them once, and another member on the same browser has their own.

The table keeps two runs, the run in hand and the endless run, and the page plays one at a time
(`S.slot`): every command for a run goes to that one (`endless: true` for the endless run). A
strip's Carry on sits down to its run; End this raid ends that one.

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

| File                          | What it holds                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/main.ts`                 | Puts the parts together; speaks to the town                                                           |
| `@sequoia-leaf/raid`          | The rules, and the table as Leaf plays it (`packages/raid`, with its README)                          |
| `src/screen/state.ts`         | The page's copy of Leaf's table; every move is a command (`doNow`, `ask`); `go` moves the screen      |
| `src/screen/screen.ts`        | What the table is showing, as one value, and the one function that moves it on                        |
| `src/screen/flow.ts`          | Acts out each move of the screen: sitting down, the fight, counting out the takings, the end          |
| `src/screen/stage.ts`         | The canvases, the size of an art pixel, where the board sits, the clock                               |
| `src/screen/geometry.ts`      | Where hexes, seats and bench hollows are, and which is under a point                                  |
| `src/screen/scene.ts`         | Drawing a frame: the board, lit hexes, who is waiting across it, the party, the fight                 |
| `src/screen/pawns.ts`         | The party's figures on board and bench; buying, selling and three-become-one acted out                |
| `src/screen/hand.ts`          | Dragging and tapping, and asking what a thing is                                                      |
| `src/screen/light.ts`         | Which trait is lit (pointed at, or clicked and kept), and how that shows on a figure                  |
| `src/screen/rich.ts`          | The words on a card sorted for colouring: numbers, heals and shields, kinds of damage                 |
| `src/screen/fightview.ts`     | The fight played on, and everyone in it drawn as they move, what flies, the health bars               |
| `src/screen/playback.ts`      | The rules' fight stepped to the shown clock, a copy run ahead for lead-ins, the hit-stop, budgets     |
| `src/screen/fightshow.ts`     | What each event looks like (a table by event), and the lead-in each blow gets                         |
| `src/screen/looks.ts`         | Each ability's look and sound as a table: wind-up, body, what it throws, its mark, its weight         |
| `src/screen/fightmarks.ts`    | Ground that slows or hurts, a line marked before it lands, a pull, a channel held in its pose         |
| `src/screen/marks.ts`         | Things thrown, as they fly; each ability's mark; the puff a fallen figure goes in                     |
| `src/screen/motion.ts`        | A figure's body at a moment: lunge, hurt, hop, walk, wind-up, tumble, as squash, lean and turn        |
| `src/screen/acting.ts`        | A person on a rig at a moment: the stance their body is in for what the fight is doing to them        |
| `src/screen/spells.ts`        | An ability that lands later, until it does: the dark, the seal, the thread, the corners, its landing  |
| `src/screen/hung.ts`          | When such an ability lands, counted from the step it went off, and whether its target is still there  |
| `src/screen/livery.ts`        | The colours anything of a figure's own is drawn in: a person's from their skin, on the palette        |
| `src/screen/board.ts`         | The fight on the table as it stands, which the three above keep                                       |
| `src/screen/fx.ts`            | Sparks, light gathering, rings, small pictures, streaks, rising words, things that fly, "in a moment" |
| `src/screen/logic.ts`         | Small questions asked of a run: where a figure may go, what an item would make, the next nudge        |
| `src/screen/keep.ts`          | The view settings kept in the browser                                                                 |
| `src/screen/sounds.ts`        | The table's sounds, made from the kit's tones                                                         |
| `src/screen/signals.ts`       | Small happenings more than one part answers: an acorn landing, a star                                 |
| `@sequoia-leaf/figures`       | The figures' pictures, which the town draws too (`packages/figures`, with its README)                 |
| `src/screen/art/icons.ts`     | A small picture for every trait, item, boon, kind of room and button, typed in `icons.txt`            |
| `src/screen/art/table.ts`     | The painted table, the halves of the board, the looks                                                 |
| `src/screen/art/place.ts`     | The second place the table may stand (the guild hall), what moves in it, and which place is painted   |
| `src/screen/art/pal.ts`       | A colour for each trait                                                                               |
| `src/screen/ui/table.ts`      | The interface round the table: purse, track, traits, rack, stall, buttons, the fight's panel          |
| `src/screen/ui/rooms.ts`      | The track's pips (an endless run's past room 15 too), each room's card, an endless run's chairs       |
| `src/screen/ui/tally.ts`      | The tally as rows and bars, two parties side by side (one at a time on a phone), with its tabs        |
| `src/screen/ui/fightsheet.ts` | The sheet of a fight that is over: after it with the takings and "Carry on", or "Last fight"          |
| `src/screen/held.ts`          | What a figure holds: where the row of small pictures under its base goes, drawing it, hitting it      |
| `src/screen/ui/cards.ts`      | What each thing says about itself, registered with the kit's cards, and the references to them        |
| `src/screen/ui/lit.ts`        | Which trait the cards have pointed at or pinned, and marking the chips and the stall for it           |
| `src/screen/ui/picks.ts`      | Three cards to choose from                                                                            |
| `src/screen/ui/modes.ts`      | The ways to play as a table: each mode's category, words, Set out, run and board; the foot it shows   |
| `src/screen/ui/front.ts`      | The front page: runs laid out, the categories and modes, the chosen mode's card, its board            |
| `src/screen/ui/endless.ts`    | The endless ways with no page in them: their names, boards from Leaf, rooms taken, the strip's line   |
| `src/screen/ui/woods.ts`      | The endless ways on the front page: boards and rooms held read from Leaf, a room taken said once      |
| `src/screen/ui/wilds.ts`      | The Wilds' rules in words: a rule's line, the wing and its boss, the card that picks a run back up    |
| `src/screen/ui/rulecards.ts`  | The Wilds' rules on the table: the pick's cards and boss, the line over the bench, figures moved off  |
| `src/screen/ui/back.ts`       | The card that picks a run of the Wilds back up, with Watch it again                                   |
| `src/screen/closed.ts`        | The hexes a rule closes drawn on the board, and each rule's small picture                             |
| `src/screen/ui/pages.ts`      | The pages over the table: the almanac, how to play, table looks                                       |
| `src/screen/ui/ended.ts`      | The end of a run: how far (or how deep), the party, what is new, what it paid, Again                  |
| `src/screen/ui/nudge.ts`      | The first-time nudges                                                                                 |
| `src/screen/sides.ts`         | Which side of a fight is the member's own (the away seat of a sparring pair is the second)            |
| `src/screen/live/`            | A live table: the line to Leaf, the seat, the clock and players, the carousel, the papers, the card   |

`geometry.ts`, `logic.ts`, `keep.ts`, `light.ts`, `rich.ts`, `playback.ts`, `ui/modes.ts`, `ui/endless.ts` and `ui/wilds.ts` have tests beside them;
`playback.test.ts` holds that the fight on the table, lead-ins, hit-stops and all, is the rules'
own, event for event, to the same end, at every speed.

Everything in a fight counts the fight's clock (the sparks too, through `fx.ts`'s `pace`), so 2x
and 4x speed it all up alike and a hit-stop holds it all. A banner's member is a person on a rig (`@sequoia-leaf/figures`, `rig.ts`), and
`acting.ts` has them act out what the fight says with their body: arms and legs swing as they walk,
an arm is drawn back and thrown out so that what they throw leaves their hand, they reel when hit,
sway when stunned and fall with their limbs going. An ability that lands later (`lands` in its look) has its
hexes marked until it does, and its mark, bump and stop then; meanwhile the table is dark but for a
pool of light round whoever it is for, a seal on the ground round them lights a stud at a time, a
thread runs to them from its owner's hand and gold corners close round them (`spells.ts`), all in
its owner's colours: a person's are the strongest tones of their skin as the palette has them
(`livery.ts`, the kit's `tones.ts`). It is timed from the step the rules say it went off
(`hung.ts`), and still lands when whoever it is for falls first. An ability's look is its entry in
`looks.ts` and, for its mark, in `MARKS` (`marks.ts`): a richer one is a mark of several layers
(pictures from `ROWS`, rings, bursts, streaks, as long as it likes) and its own `bump` and `stop`
in its look.

## Looking at it from outside

A headless browser draws about a frame a second, so the page puts a handle on `window.raid`:
`hold(true)` stops the clock so that only `skip(seconds)` and `tick(steps)` move it. Whatever plays
goes to Leaf as commands, so these give back promises: `start(seed, trail)` begins a run; `bot(rooms)`
has the rules' bot play whole rooms unseen and `plan()` has it plan the room that is up (the bot plans
on the page's copy and sends what it would do, `planCommands`), on whichever run the table plays;
`endless(way, room, acorns)` sets out on an endless run (staged in a room with every room before it
won), `sit(slot)` sits down to a run as a strip's Carry on does, and `woods(...)` has the play server
put the other members on the endless boards, have one hold a room of the Deep Woods, or take one
from the member; `to("boon" | "component" | "boss" |
"lastboss" | "end" | "front")` plays on to a moment worth looking at; `fight()` sets out;
`settled()` waits until Leaf has answered everything sent; `send(command)` sends one as the page
would. `fresh()` (a new member, who has pulled nothing), `pulled({ greg: 3 })` (copies pulled), `start` from a chosen seed (and `own`), `acorns(n)`, `give(kind)`, `offer(at,
kind)`, `item(id)` and `strip()` stage a moment play does not reach (a merge, an item to forge,
empty hands): they ask the play server the tours run against (`apps/api/test/play.ts`, at
`/test/play/raid`), and on the guild's own Leaf, which has no such route, do nothing. `busy()` runs
a fight on to a moment with an ability's hexes lit and something in the air; `party()` lists the
party's figures by number for `grab(id, x, y)`, `tap(id)`, `hover(itemAt, id)` (and `pair(itemAt,
rackAt)` over another place on the rack), `hand(itemAt, id)`
and `drop()`; `at(id)` and `heldAt(id, i)` say where a figure and what it holds are on the page,
and `rack()` and `held()` what is on the rack and in every hand; `page(id)` opens a page;
`arrive()` has whoever is waiting walk in again; `taught()` counts every nudge as given; `state()`
says where things stand (the Coins too); `bench()` times a frame; `carry()` presses "Carry on",
`last()` opens or puts away "Last fight", and `tally(measure, side)` chooses a tab of the tally and,
on a phone, a party. `watch(ours, theirs, stars, seed)` plays a fight of the figures named on the
table while planning (nothing goes to Leaf), `when(kind)` runs it on until a figure of that kind
uses its ability (or an event of that sort happens: `"swing"`, `"fall"`) and says the fight's clock
then, `until(step)` runs it on to a step, and `speed(s)` watches at 1x, 2x or 4x. `copy()` is the page's own copy of the run and `leaf()` the copy of Leaf's
table it draws from, to change by hand and see Leaf's next answer put it back; `redraw()` draws the
table from them.

The tours use a page of their own, `review/index.html`: the page that ships, with `window.raid` for
staging and looking at the game from outside (`review/handle.ts`), and with `?sheet` every figure on
one sheet with its name (`review/sheet.ts`) instead of the table. Nothing in `src/` imports from
`review/`, and the image leaves `review/` out.

The lists in `review/` are the tours the screenshots came from. `review/tour.ts` runs one against a
play server of its own: it builds the page, starts `apps/api/test/play.ts` on a free port with
`--dice 1` (so the tour plays the same game every time), signs in as its Tester and has the kit's
driver go through the steps on the tours' page:

```sh
bun review/tour.ts review/tour-desktop.json <out-dir>
bun review/tour.ts review/tour-phone.json <out-dir>
bun review/tour.ts review/sheet.json <out-dir> sheet
```

`review/standin.ts` puts `window.standin` beside the handle for looking at a banner's member:
`wear()` gives the first banner's member a mage's skin drawn by code (the play server's skins are
plain) or, given a skin sheet as a `data:` address, that skin, `seat(ours, theirs, stars, seed)` plays a fight with everyone seated where it says, and
`caught(kind)` says who that kind's last ability was for.

`review/feel.json` and `review/feel-phone.json` go through who gets hit, what everyone did and the
open table: the front page, a Bulwark's card with its draw chip and tip, a fight with each of the
tally's three tabs, the sheet after a lost room and a won one, and "Last fight" while planning.

`review/tables.json` and `review/tables-phone.json` go through a live table of the member and seven
regulars, with `window.tables` (`review/tables.ts`) moving Leaf's clock on the play server: the
Versus card, the table before it starts, the first carousel, planning with the players, the front
page after closing the page, a player's board, a sparring fight, the carousel on the member's
turn, going out, the end and the record after it.

`review/own.json` and `review/own-phone.json` go through a raid with the member's own figures: the
front page for a member who has pulled nothing and with each way chosen, the stall, bench and board
with levelled figures, a levelled two-star figure's card, the almanac, a fight and the end.

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

`packages/raid/review/balance.ts`, the rules' gauge, plays whole runs with bots of different habits;
its `suits` section is how the items a card recommends were checked.

## Where the shape comes from

A stall phase and then a fight that plays itself, a hex board, traits, three of a kind becoming one
stronger, and items made of two halves are the genre's. Nothing of any other game's content is
here: the figures, the trouble, the abilities, the items, the boons, the words and the numbers are
the guild's own.
