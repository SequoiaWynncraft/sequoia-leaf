# The Little Raid: the game with no screen in it

A board-and-shop auto battler for the guild. It is a tabletop game played on a great stump at the
edge of town: carved figures of forest spirits on a hex board cut into the rings of the wood. The
member buys figures from a rolling stall, seats them, and watches them fight by themselves through
"a little raid" of fifteen rooms.

Everything in this package (`@sequoia-leaf/raid`) is the game itself: what is in it, how a fight
goes, how a run goes, a bot that can play it, what lasts between runs, the table as Leaf plays it,
and saving. None of it touches the page: it is type-checked without the page's library or Bun's.
Leaf (the play service in `apps/api`) and the battler's page (`apps/battler`) both import it,
through `index.ts`.

```sh
bun test                                         # the rules, checked against their own sentences
bun review/balance.ts 200 0                      # 200 runs for each bot habit on the first trail
```

## The rules as built

**The board.** Hexes in offset rows, seven across. Each party has four rows; pushed together for a
fight they make a board seven by eight, front lines touching. A place on a party's own half is a
_seat_ (`row * 7 + col`, row 0 the front line); a hex in a fight is a _cell_ (`row * 7 + col`, rows
counted from the far side). `seatCell(side, seat)` turns one into the other. There is a bench of
nine.

**A run.** Fifteen rooms in three wings of five: trouble, trouble, spar, spar, boss; spar, trouble,
spar, spar, boss; spar, spar, trouble, spar, and The Crab Nobody Counted. Each room is planning with
no clock, then the fight, then the takings. Winning or losing, the party moves on to the next room;
only the last room is fought again until it is won or the party goes home.

**Resolve.** Twenty. A lost room costs 2 and 1 more for each enemy still standing, never more than 7. A draw costs 2. At 0 the run ends. Clearing room fifteen wins it.

**Acorns.** The run starts with 2. After every room: 4, 1 more for a win, and 1 for every 10 held
before the room paid, up to 5.

**Streaks.** The run counts rooms won in a row and rooms lost in a row (`run.streak`: above 0 for
wins, below 0 for losses). A win after a loss, or a loss after a win, starts a new streak of 1; a
draw makes it 0. After every room, counting that room, a streak of 3 or 4 pays 1 acorn more and 5
or more pays 2, the same for wins and losses (`streakAcorns` in `content/rooms.ts`). The base pay went from 5 to 4 when streaks came in, so a
run pays about the same as before: 200 runs a habit on the first trail beat the last boss 23.6% of
the time without streaks and 23.8% with them.

- The stall shows 5 figures. A figure costs its tier, 1 to 5. One rustle a room is free; more cost 2. The stall can be held as it is for the next room.
- Selling returns the price at one star, and one or two acorns less than was paid for a merged
  figure (two stars: 3 x tier - 1; three: 9 x tier - 2). What it held goes back to the item bench.
  The last figure cannot be sold.
- 4 acorns buy 4 experience; every room gives 2 for nothing. Leaving levels 1 to 7 takes 2, 2, 6,
  10, 18, 28 and 40. The level is how many figures may be fielded, up to 8.
- The stall's odds by level, tiers 1 to 5 out of a hundred: 100/0/0/0/0, 80/20, 65/30/5,
  50/33/15/2, 35/35/22/8, 24/32/28/14/2, 17/26/31/21/5, 12/20/30/28/10.
- The run opens on a pick of one from three one-acorn figures.

**Stars.** Three of the same figure with the same stars, anywhere on the board and bench, become
one with a star more at once; the one furthest forward stays. Two stars is x1.8 health and attack,
three is x3.24, and every ability has its own numbers for each star. With a full bench a figure can
still be bought if it completes three. Items the merged copies held go to the survivor while it has
room (two loose components forge, as they would if handed over), and the rest go back to the item
bench.

**Figures.** Twenty-eight, in five tiers of 7, 7, 6, 5 and 3. Each has health, attack, attacks a
second, reach in hexes, armour, ward, a mana bar and one ability. Each has one kin and one calling;
the three dearest carry a third trait.

| Tier | Figure           | Kin     | Calling        | Health | Attack | Reach | Ability (one star)                                                                                                                                    |
| ---- | ---------------- | ------- | -------------- | ------ | ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Emberkit         | Ember   | Fang           | 270    | 30     | 1     | **Do Not Move The Fire.** A spark jumps from its fire: 75 magic damage to its target and to whoever is standing behind it.                            |
| 1    | Mossmote         | Moss    | Mender         | 250    | 20     | 3     | **Cushion.** Tucks a cushion round whoever in the party is most hurt: a shield of 110 for 4 seconds.                                                  |
| 1    | Moth             | Mist    | Sage           | 230    | 22     | 3     | **Wing Dust.** Shakes its wings over its target: 80 magic damage to it and to every enemy touching it.                                                |
| 1    | Worm             | Burrow  | Sneak          | 260    | 28     | 1     | **Under And Up.** Goes under and comes up beside the enemy furthest away, biting it for 90 physical damage.                                           |
| 1    | Twig Finch       | Feather | Slinger        | 230    | 26     | 3     | **Seed Volley.** Spits 3 seeds at its target, 34 physical damage each.                                                                                |
| 1    | Crab #7          | Crab    | Fang           | 300    | 26     | 1     | **Pinch.** Pinches its target and does not let go: 85 physical damage, and it is stunned for 1.5 seconds.                                             |
| 1    | Barrow Gnome     | Gnome   | Bulwark        | 320    | 20     | 1     | **Upend The Barrow.** Tips the barrow over and gets behind it: a shield of 120 for 4 seconds, and 40 physical damage to every enemy touching it.      |
| 2    | Kettle           | Ember   | Mender         | 330    | 24     | 3     | **Tea.** Pours a cup for whoever in the party is most hurt: 150 health back.                                                                          |
| 2    | Slug             | Moss    | Bulwark        | 430    | 24     | 1     | **Slime.** Slimes every enemy touching it: 60 magic damage, and they are 30% slower for 3 seconds.                                                    |
| 2    | Glorp            | Mist    | Bulwark        | 400    | 28     | 1     | **A Bit Comes Off.** A bit comes off: a Glorplet with 200 health and 24 attack joins the fight beside it.                                             |
| 2    | Chickaree        | Burrow  | Slinger        | 290    | 34     | 3     | **Cone From Above.** Lobs a cone at the enemy furthest away: 120 physical damage, and it is stunned for 1 second.                                     |
| 2    | Dusk Jay         | Feather | Fang           | 340    | 36     | 1     | **Flurry.** Loses its temper: attacks 60% faster for 4 seconds.                                                                                       |
| 2    | Crab #12         | Crab    | Slinger        | 300    | 32     | 3     | **Skipping Stone.** Skims a pebble at its target for 95 physical damage; it skips on to 2 more enemies close by.                                      |
| 2    | Lantern Gnome    | Gnome   | Sage           | 280    | 24     | 3     | **Who Goes There.** Holds the lantern up at the 3 nearest enemies: 90 magic damage each.                                                              |
| 3    | Leafling         | Moss    | Sage           | 420    | 30     | 3     | **Proper Instruction.** Tells the 2 friends nearest it how to do things properly: +22% attack for the rest of the fight.                              |
| 3    | Cinder Newt      | Ember   | Sage           | 440    | 34     | 2     | **Warm Breath.** Breathes out over its target: 150 magic damage to every enemy in a cone two hexes deep.                                              |
| 3    | Drizzle Frog     | Mist    | Slinger        | 400    | 44     | 3     | **One Big Drop.** Spits one big drop at its target: 190 magic damage, and it is 30% slower for 3 seconds.                                             |
| 3    | Rock             | Burrow  | Bulwark        | 820    | 0      | 1     | **It Is A Rock.** Does nothing, pointedly. For 4 seconds it takes 40% less from every hit, and whoever attacks it up close stubs a toe for 45 damage. |
| 3    | Gnome In A Bush  | Gnome   | Sneak          | 400    | 42     | 1     | **It Was A Bush.** Jumps out at its target: 160 physical damage, and half as much again if it was busy with somebody else.                            |
| 3    | Crab #23         | Crab    | Mender         | 430    | 28     | 2     | **Plasters.** Hands out plasters to the 2 most hurt in the party: 140 health back each.                                                               |
| 4    | Badger           | Burrow  | Fang           | 720    | 58     | 1     | **Clear The Sett.** Turns right round with its claws out: 170 physical damage to every enemy touching it, and it heals for 30% of what lands.         |
| 4    | Fog Owl          | Feather | Sneak          | 560    | 62     | 1     | **Out Of The Fog.** Swoops onto the enemy furthest away: 240 physical damage, and it is stunned for 1.5 seconds.                                      |
| 4    | Reed Heron       | Feather | Slinger        | 540    | 64     | 4     | **One Long Stab.** Stabs straight through its target: 220 physical damage to every enemy on a line 5 hexes long.                                      |
| 4    | Crab #40         | Crab    | Bulwark        | 850    | 40     | 1     | **Hold The Line.** Gets in everybody's way: a shield of 300 for 4 seconds, and every enemy within two hexes has to attack it for 3 seconds.           |
| 4    | Apothecary Gnome | Gnome   | Mender         | 540    | 34     | 3     | **Tonic For Everyone.** A spoonful each for itself and every friend within two hexes: 180 health back, and 25% faster attacks for 4 seconds.          |
| 5    | Greg             | Moss    | Bulwark + Greg | 880    | 54     | 1     | **Greg Sits Down.** Greg sits down. Every enemy within two hexes takes 200 magic damage and is stunned for 1.25 seconds.                              |
| 5    | Orphion          | Mist    | Fang + Sage    | 700    | 62     | 1     | **Antlers Ring.** Its gold antlers ring: 160 magic damage to every enemy within two hexes, and the whole party attacks 12% faster for 4 seconds.      |
| 5    | Hearth Cat       | Ember   | Sneak + Fang   | 700    | 66     | 1     | **Off The Table.** Looks at its target, then bats it off its hex: 240 physical damage, knocked back 2 hexes, stunned for 1.5 seconds.                 |

**A banner's member.** Each pull banner has one more figure, which is a guild member
(`content/members.ts`: `MEMBER_IDS`, by the banner's id). It is a figure like any other, at five
acorns, and not one of the twenty-eight (`FIGURE_IDS`): the main way's stall never offers it, no
regular brings it, a board holding it is not met on the main way, and the almanac does not count
it. Only a run with the member's own figures sells it, to a member who has pulled it (below). Its
name in the rules is "A guild member"; the page gives it the member's name and their picture.

| Tier | Figure         | Kin     | Calling | Health | Attack | Reach | Ability (one star)                                                                                                                                          |
| ---- | -------------- | ------- | ------- | ------ | ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5    | A guild member | Feather | Mender  | 640    | 46     | 3     | **On My Way.** Runs over to the friend who is most hurt and stands by them: 260 health back for the friend, and a shield of 180 for 4 seconds on them both. |

It comes up on a free hex touching the friend, the one furthest from the enemy nearest them; with
no free hex it stays where it is, and with nobody else left it heals and shields itself. Measured
as the twenty-eight were (first trail): alone at one, two and three stars it wins 17%, 26% and 51%
of the fifteen rooms (Greg 15, 32, 60; Orphion 14, 32, 51; the Hearth Cat 15, 26, 41); swapped for
the cheapest figure of 5,089 boards the bots set out with, those are won 70% of the time with it
at one star and 88% at two (Greg 77 and 93, Orphion 71 and 91, the Hearth Cat 71 and 89; 63%
without); and in 3,200 runs with it on the stall, fights with it fielded are won 15 points more
often than the same rooms without regard to it (Greg 19, Orphion 8, the Hearth Cat 7).

**Traits.** A trait switches on when the party fields enough _different_ figures that carry it;
copies of one figure count once, however many emblems they hold. A figure carries its own traits
and the kin of any emblem it holds. Every kin has four members, one of them at one acorn and one at
two, so any kin can be started in the first rooms.

| Trait   | Steps   | What it does at its first step                                                                                                                                                            |
| ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ember   | 2, 4    | Ember figures' attacks and abilities leave a burn: 2% of health a second for 4 seconds. Healing on the burning is 40% weaker.                                                             |
| Moss    | 2, 4    | The whole party regrows 1.2% of its health every second.                                                                                                                                  |
| Mist    | 2, 4    | The whole party gains 20 ward, and 12 attacks in every hundred slip past it.                                                                                                              |
| Burrow  | 2, 4    | Burrow figures dig in: +15 armour. The first time one drops under half health it gets 10% of its health back and takes 25% less from attacks and abilities for 2 seconds, still fighting. |
| Feather | 2, 4    | Feather figures attack 5% faster after every attack, up to 10 times over.                                                                                                                 |
| Crab    | 2, 4, 5 | Roll call: when the fight starts, an Uncounted Crab turns up beside your crabs, as starry as the best of them.                                                                            |
| Gnome   | 2, 4    | Gnome figures have 10% more health. After every room, won or lost, the gnomes find 1 more acorn.                                                                                          |
| Bulwark | 2, 4, 6 | Bulwarks gain 10 armour.                                                                                                                                                                  |
| Fang    | 2, 4, 6 | Fangs gain 12% attack, and 10 more of their attacks in a hundred land hard, for half as much again.                                                                                       |
| Slinger | 2, 4    | Slingers reach 1 hex further, and each attack on the same target does 7% more than the last, up to 6 times over.                                                                          |
| Sage    | 2, 4    | Sages' abilities are 25% stronger, and each of their attacks gives 3 more mana.                                                                                                           |
| Mender  | 2, 4    | Menders' healing and shields count for 20% more.                                                                                                                                          |
| Sneak   | 2, 4    | When the fight starts, Sneaks leap to the enemy's back row, and their first 2 attacks do 40% more.                                                                                        |
| Greg    | 1       | After every fight Greg is in, he has eaten something: +3% health for good, up to 10 times.                                                                                                |

The second steps: Ember burns from the whole party's hits and hotter; Moss regrows more; Mist gives
more ward and more slips; Burrow digs deeper; Feather quickens more; Crab's uncounted crab is a big
one, and at five crabs (which takes a Crab emblem) a big one and a small one come; Gnomes have 20%
more health and find 3 after a win and 2 after a loss; Bulwark gives the rest of the party armour
too; and so on. `traitText(id, step)` gives the sentence for any step.

**The fight.** A clock of 20 steps a second, decided entirely by the two parties and a seed: the
same setup gives the same fight, event for event. Setting out locks both boards, draws the fight's
seed from the run's stream and works the fight out to its end there and then; the run keeps how it
came out (`run.fight`), and the takings are paid from that. In a step, things in flight land; once a second
burns, regrowth and dusk tick; then everyone still up has a turn, the two sides alternating: use the
ability if the mana bar is full, else attack whoever they are after if in reach, else walk one hex
toward them round whoever is in the way.

**Who a figure goes for.** Whoever is taunting it; else whoever it is already on, while that one is
in reach; else, picking anew, the enemy with the lowest distance less _draw_, ties going to the one
really nearer and then to the hex that comes first for its side. Every figure has a draw, a whole
number: +1 for a Bulwark, -1 for a Sneak, +1 for each Stump Shield it holds, never above +2 or below
-1 (`drawOf`); the forest's own carry no calling and have 0. So a tank one hex further off than
somebody else is a tie, which the nearer one wins, and at the same distance the tank is picked. An
ability aimed at "its target" goes for the same one; abilities that say "nearest", "furthest" or
"most hurt" pick as they say.

- Physical damage meets armour and magic meets ward: damage x 100 / (100 + defence). True damage
  meets nothing. Damage is rounded to whole numbers, never less than 1.
- Mana: 10 for each attack made, and up to 10 for each hit taken (more for bigger hits). Burns and
  dusk fill nobody's mana.
- An attack from more than a hex away is thrown and lands two steps a hex later; if its target has
  fallen by then it drops. Many abilities travel the same way.
- Statuses: burn (a share of health every second, weaker healing meanwhile), stun, slow, shield,
  taunt, hidden (underground: nothing reaches it), haste, braced (the Rock's).
- After 30 seconds dusk falls: every second everyone loses 3% of their health more than the second
  before, so it always ends. At 45 seconds it would be a draw; both sides falling in the same step
  is a draw too.

**Items.** Five components, one stat each. Any two handed to the same figure become one of fifteen
finished items with both stats and an effect. A figure holds three. Trouble rooms give a pick of one
component from three when won and from two when lost; a beaten boss gives two picks.

Emblems are a third sort of item, one for each kin, and a charm boon is the only way to get one. An
emblem has the charm's id, name and quip, no stats and no effect of its own: whoever holds it is of
that kin as well, in the count and in the fight (a Feather emblem quickens its holder, a Crab
emblem's holder answers roll call as a crab). It takes one of the three places and never forges, so
components still pair up beside it. It is not given to a figure of its kin already (`already_kin`:
"It is of that kin already."). Selling the holder, or a merge with no room for it, puts it back on
the item bench like any other item.

| Item               | Made of             | What it does                                                                                                                                          |
| ------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thorn              |                     | +15% attack.                                                                                                                                          |
| Plume              |                     | +15% attack speed.                                                                                                                                    |
| Glowcap            |                     | +20 ability power.                                                                                                                                    |
| Bark               |                     | +20 armour and +20 ward.                                                                                                                              |
| Chestnut           |                     | +15% health.                                                                                                                                          |
| Blackthorn Sprig   | Thorn + Thorn       | +30% attack. Its attacks go through 40% of the target's armour.                                                                                       |
| Wasp-Tail Dart     | Thorn + Plume       | +15% attack, +15% attack speed. Every 3rd attack lands twice.                                                                                         |
| Glowthorn          | Thorn + Glowcap     | +15% attack, +20 ability power. Each attack gives 5 more mana.                                                                                        |
| Hedgehog Coat      | Thorn + Bark        | +15% attack, +20 armour and +20 ward. Whoever attacks it up close takes magic damage worth 3% of the wearer's health.                                 |
| Conker On A String | Thorn + Chestnut    | +15% attack, +15% health. Its attacks swing on into one more enemy beside the target, for 50% as much.                                                |
| Hummingbird Charm  | Plume + Plume       | +30% attack speed. Reaches 1 hex further.                                                                                                             |
| Moth Lantern       | Plume + Glowcap     | +15% attack speed, +20 ability power. Starts every fight with its mana bar 50% full.                                                                  |
| Quilted Vest       | Plume + Bark        | +15% attack speed, +20 armour and +20 ward. 20 attacks in every hundred slip past it.                                                                 |
| Honey Cake         | Plume + Chestnut    | +15% attack speed, +15% health. Its attacks heal it for 20% of the damage they do.                                                                    |
| Fairy Ring         | Glowcap + Glowcap   | +40 ability power. Every time it uses its ability, the ones after are 20 ability power stronger.                                                      |
| Lichen Locket      | Glowcap + Bark      | +20 ability power, +20 armour and +20 ward. When it uses its ability it shields itself for 15% of its health, for 4 seconds.                          |
| Stewpot            | Glowcap + Chestnut  | +20 ability power, +15% health. Every 3 seconds it serves whoever in the party is most hurt: 5% of their health back.                                 |
| Stump Shield       | Bark + Bark         | +40 armour and +40 ward. +1 draw. No attack lands hard on it, and stuns on it last a quarter as long.                                                 |
| Hollow Log         | Bark + Chestnut     | +20 armour and +20 ward, +15% health. Once a fight, when it drops under 40% health, it climbs inside: a shield worth 30% of its health for 5 seconds. |
| Winter Hoard       | Chestnut + Chestnut | +30% health. Regrows 2% of its health every second.                                                                                                   |

**Boons.** After room 2 and after each of the first two bosses: one of three, with one free redraw.
A charm is only offered for a kin the party owns one of, and never more than one charm in a three.
Each charm puts its emblem on the item bench, for one figure to hold.

| Boon                  | What it does                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Deep Pockets          | Savings pay an acorn for every 5 held instead of every 10, and can reach 6 a room instead of 5.                  |
| A Regular             | The stallholder knows you: 1 more free rustle every room.                                                        |
| Quick Study           | Every room teaches 4 experience instead of 2.                                                                    |
| Windfall              | 10 acorns, now.                                                                                                  |
| A Basket On The Stump | Somebody left 2 item components for you. Nobody says who.                                                        |
| A Wider Stall         | The stall shows 6 figures instead of 5.                                                                          |
| Haggler               | The first figure you buy each room costs 2 acorns less.                                                          |
| Second Wind           | The first of your figures to fall each fight gets back up, once, with 40% of its health.                         |
| Head Start            | Your figures start every fight with 25 more mana.                                                                |
| An Extra Chair        | You may field 1 more figure than your level.                                                                     |
| Warm Blanket          | 4 resolve back now, and every room you lose costs 1 less.                                                        |
| Small Fry             | Your one- and two-acorn figures have 18% more health and attack.                                                 |
| Tidy Formation        | Figures that start in your front row have 25 more armour; figures that start in your back row attack 15% faster. |
| Coal On A String      | An emblem for one figure to hold: it is an Ember as well, and counts as one more Ember.                          |
| Pocket Moss           | An emblem for one figure to hold: it is a Moss as well, and counts as one more Moss.                             |
| Jar Of Fog            | An emblem for one figure to hold: it is a Mist as well, and counts as one more Mist.                             |
| A Small Hole          | An emblem for one figure to hold: it is a Burrow as well, and counts as one more Burrow.                         |
| Lucky Feather         | An emblem for one figure to hold: it is a Feather as well, and counts as one more Feather.                       |
| Roll Call Sheet       | An emblem for one figure to hold: it is a Crab as well, and counts as one more Crab.                             |
| Spare Hat             | An emblem for one figure to hold: it is a Gnome as well, and counts as one more Gnome.                           |

**Sparring.** A sparring room is fought against a party one of the regulars at the table brought
(`REGULARS` in `content/rooms.ts`: Greg, the Hearth Cat, a Barrow Gnome, Crab #7, Orphion
and a Moth, each one of the battler's own figures), or against the board another member fought
that room with. `sparParty(seed, room, trail)` makes a regular's up: a regular, a taste for one kin and one calling, a level and a number of acorns to have spent by that room, stars bought with what is left,
and items. It brings only what a member at its level could have found: figures of a cost the stall
offers at that level, as often as it offers them, and a second or third star only where the stall
offers that cost at least 12 or 30 times in a hundred. It gives back a `Party`, which is plain data (`isParty` checks one that has been stored
or sent) and is exactly what a fight takes.

A member's fight at a sparring room leaves the party it was decided from (side 0 of its setup) for
other members to meet there (`Done.keep`, at `boardSlot`: `board:<trail>:<room>`, the room's place
in `ROOMS`), the newest over the older. A run with the member's own figures leaves and meets its
boards apart (`own:<trail>:<room>`), with their levels; a board met on the main way never has a
level, nor a banner's member: one that holds one is not met. A guest's leaves nothing, and trouble and bosses keep
nothing. A `take` that moves the run on to a sparring room (`takenTo`: a lost last room is fought
again, and a run whose takings end it moves nowhere) asks Leaf for a board left there (`meets`),
and Leaf hands it one, picked by its dice, with the member's Leaf id, their name, and how many
members left one there (`Ctx.met`, `of`). The regular is one of that crowd: one draw from the room's
own stream (`opposition`) makes the foe the member's board `of` times in `of + 1`, and the regular's
otherwise, so the run's stream moves the same either way and the regular's party for a seed is
the one it always was. Only a board a member could have fielded is met (`boardMet`: one to nine of
the stall's own figures, as `isParty` reads them); anything else is the regular. Across the table
it is `{ who: <their name>, by: <their id>, title: "their board at this room" }`, with its figures
and fight boons, at plain might. A party with `by` is never a regular's, whatever its name
(`regularOf`). The same member may be met in several rooms, whatever the board's age or strength,
and beating one pays as beating a regular does.

**Trouble and bosses.** The forest's own figures are never on the stall. Each trouble room has two
plans and draws one.

| Trouble                   | Health | Attack | Trick                                                                                                                                                                                                                          |
| ------------------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gnat                      | 110    | 14     | None.                                                                                                                                                                                                                          |
| Bramble                   | 300    | 20     | Whoever attacks it up close takes 10 damage.                                                                                                                                                                                   |
| Wasp                      | 150    | 30     | Stings its target: 50 damage that no armour stops.                                                                                                                                                                             |
| Puddle                    | 480    | 18     | Splashes every enemy touching it: 40 magic damage, and they are 30% slower for 3 seconds.                                                                                                                                      |
| Toadstool                 | 260    | 24     | When it falls it puffs spores: 70 magic damage to every enemy within two hexes.                                                                                                                                                |
| Gust                      | 240    | 22     | Blows its target back 2 hexes: 50 magic damage, and it is 30% slower for 2 seconds. Unless it is a Rock.                                                                                                                       |
| Magpie                    | 300    | 34     | Flies to your back row when the fight starts. Pecks its target for 90 physical damage, and half as much again if it is holding anything shiny.                                                                                 |
| Mud                       | 700    | 30     | Squelches: 60 magic damage to every enemy touching it, and they are stuck for 1 second.                                                                                                                                        |
| Counted Crab              | 380    | 30     | Starts the fight inside its shell: a shield of 120 that lasts until it is broken.                                                                                                                                              |
| Old Bramble               | 1500   | 52     | Whoever attacks it up close takes 12 damage. Puts out a runner: a Bramble Runner sprouts beside the nearest enemy, at most 3 at a time.                                                                                        |
| The Magpie With The Hoard | 1950   | 72     | Swoops on whoever is holding the most shiny things: 230 physical damage, and they are stunned for 1.5 seconds.                                                                                                                 |
| The Crab Nobody Counted   | 5400   | 130    | Starts inside a shell worth 800. Gets crabbier: +15% attack for the rest of the fight, and a pinch of 320 physical damage across a cone two hexes deep. At half health it calls the roll: 2 more crabs nobody counted turn up. |

**Trails.** Three difficulties of the same run: The Easy Way, The Brambly Way, The Long Way Round.
A later trail adds figures to the forest's plans, makes its bosses a little stronger, and gives the
sparring partners more to spend and more items. The rules do not change.

**Between runs** (`outside.ts`). A run pays Coins when it ends, however it ends: 16 for every room
won, 50 for every boss beaten, 120 for winning, and a quarter or a half more on the harder trails.
A whole raid on the first trail is 510. The almanac remembers which figures have been fielded and
taken to three stars, which items forged, which traits switched all the way on, which bosses beaten
and the furthest room met on each trail. None of it changes a fight or the stall: all twenty-eight
figures can be offered to everyone from their first run (`STALL_POOL`). The next trail opens when the
last is cleared.

**Two ways to set out.** `start` says which: with all figures (what everything above describes), or
with `own: true` the figures the member has pulled at the Grove. The first never reads anything a
member owns: not the stall, not the odds, not a number.

A run with the member's own figures writes down their roster as it starts (`run.own`, `Roster`):
each figure they have pulled and its level, copies pulled less one, 6 at most (`LEVELS`). Leaf tells
the table what was pulled as awards (`rosterOf`: `pull:figure:<id>` is the figure, and
`copies:figure:<id>:<n>` its nth copy; `pull:headliner:<banner>` and `copies:headliner:<banner>:<n>`
are that banner's member). The run keeps that roster to its end, whatever is pulled
meanwhile. A member who has pulled no figure is refused (`nothing_pulled`).

- The stall sells every one-acorn figure, and above one acorn only the figures in the roster
  (`stallPool`), a banner's member among them (`figuresFor`). The odds by level are the table's, with the share of a cost the roster has nothing
  of going to the others (`stallOdds`). The opening pick is from the one-acorn figures.
- A level is 3% more health and attack, 18% at most, on that figure wherever it stands in the run;
  a one-acorn figure not pulled is level 0. It multiplies with stars and with what items add, and
  it is not a star. Each figure of a party carries its level (`Placed.level`, absent for 0), so a
  fight says the same thing every time it is played from its setup.
- Sparring partners, the forest and the bosses are as on the main way.
- It pays Coins as any run does, and is written nowhere else: not into the almanac, so it carves
  no trophy, moves no standing and opens no trail (a trail is open to it once the main way has
  opened it). Its log lines carry `own: true`, and add nothing to the Tally's counters.

`TableView.roster` is the roster a run would start with now, for the front page and the almanac.

## Chance

Every draw a run makes comes from its stream (`run.rng`, core's `rng.ts`): the first picks, the stall, who
waits in each room (a trouble plan, or a regular's party), the components and boons on offer, each
fight's seed. `run.seed` is only where the stream started (the bot's own habits are drawn from it).
At Leaf's table there is a stream of the table's own too, from which each new run's seed is drawn,
and Leaf's dice for each command (`Ctx.seed`) are stirred into both before the command draws
anything, so nothing a command draws can be worked out beforehand from what the player has seen.

## The table, as Leaf plays it (`game.ts`)

`RAID` is the game's `Game` (`packages/core/src/play.ts`), for Leaf's play service. Its state, the
`Table`, is the run in hand (or none), the almanac, the looks (`content/looks.ts`), the trail picked
on the front page, the number of runs begun, and the table's stream. One command for each thing a
player does (`RaidCommand`): `start` (a run on a trail, with all figures or with `own` the member's own; a run in hand is put down first, as walking
home, once it has fought a room), `trail` (pick the trail to set out on next), `look` (put an owned look on the table;
a look is owned when bought with `buyLook`, or won as a pull's prize: `advance` adds each
`pull:look:<id>` among the player's awards to the looks owned, and takes no Leaf),
`choose`, `redraw`, `buy`, `sell`, `move`, `bench`, `rustle`, `hold`, `xp`, `give`, `fight`
(boards locked, the fight decided; its note carries both boards, the seed and the outcome), `take`
and `abandon`. A run that has fought no room yet is never put down: `start` and `abandon` then leave
it as it is, drawing, paying and logging nothing, so that an opening cannot be drawn again for free.
A refusal is a code (`REFUSALS` in `run.ts`, `TABLE_REFUSALS`), and `refusalText`
gives the sentence the page shows.

A run that ends (won, lost, or walked home from) is written into the almanac and let go of, and
pays its Coins as one change keyed `run:<number>`. Commands log `raid_started` (trail), `raid_room`
(room, kind, won, resolve left, the fight's seconds, and `met`, the member's Leaf id, for a room
fought against another member's board) and `raid_ended` (trail, rooms won, how it ended, Coins
paid).

A member's `fight` at a sparring room keeps the board it was decided from for other members
(`Done.keep`), and a `take` into a sparring room meets another member's (`RAID.meets`, `Ctx.met`):
see Sparring above. Leaf keeps the boards and picks one; the rules only leave one and check the one
they are handed.

What the page is shown (`TableView`) is the table without its streams, the run's seed, or what the
picks waiting behind the first will offer. `readView` and `readNotes` (`wire.ts`) read what Leaf
sends back into these types, field by field. `predict` works out on the page's copy the commands
that draw nothing (`PREDICTED`: moving, benching, selling, handing over, holding the stall, buying, experience), exactly
as Leaf will; `planCommands` has the bot plan a room on the page's copy and gives back the commands
it would send. `encodeTable` and `decodeTable` are the table as Leaf stores it.

## What is where

| File                   | What it holds                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `content/figures.ts`   | The 28 figures, the forest's trouble and bosses, and the summoned: names, numbers, ability sentences, quips           |
| `content/members.ts`   | The banners' members: for each pull banner, a figure that is a guild member                                           |
| `content/traits.ts`    | Kins and callings: steps, sentences, numbers                                                                          |
| `content/items.ts`     | Components, finished items, emblems, what forges into what, how a figure holds them                                   |
| `content/boons.ts`     | The boons                                                                                                             |
| `content/rooms.ts`     | Acorns, levels, stall odds, the fight's clock, the fifteen rooms and their plans, sparring strength, trails, regulars |
| `content/keepsakes.ts` | The payout                                                                                                            |
| `content/advice.ts`    | What kind of fighter each calling makes and where it stands, and three finished items that suit each figure           |
| `hex.ts`               | The board: cells and seats, distance, neighbours, lines, cones, rings, finding a way round                            |
| `party.ts`             | A party as plain data, and trait counting                                                                             |
| `fight/types.ts`       | What a figure in a fight looks like, and the events a step gives back                                                 |
| `fight/core.ts`        | The verbs: hurt, heal, shield, stun, slow, burn, taunt, hide, leap, knock back, summon                                |
| `fight/abilities.ts`   | Each ability, written with those verbs                                                                                |
| `fight/engine.ts`      | Seating, traits and items switching on, the clock, the end                                                            |
| `formation.ts`         | A plain way of seating a party, used by the bot and the sparring partners                                             |
| `spar.ts`              | The regulars' parties for sparring                                                                                    |
| `foe.ts`               | Who waits in a room: the forest's trouble, a regular's party, or another member's board                               |
| `run.ts`               | The run and every action on it                                                                                        |
| `save.ts`              | A run read back from plain data: shape first, then today's numbers                                                    |
| `outside.ts`           | Payout, almanac, trails                                                                                               |
| `content/looks.ts`     | How the table may look: cloths, lanterns, bases                                                                       |
| `game.ts`              | The table as Leaf plays it: state, commands, what the page is shown, predictions                                      |
| `wire.ts`              | Reading Leaf's view and notes back                                                                                    |
| `tally.ts`             | What every figure did in a fight, read from its events                                                                |
| `bot.ts`               | A player with habits                                                                                                  |
| `index.ts`             | Everything a screen needs, in one place                                                                               |
| `testkit.ts`           | Helpers for the tests only                                                                                            |

Tuning the game is editing the files in `content/`. The sentences shown to players are built from
the same numbers the fight reads (`abilityText`, `traitText`, `itemText`, `boonText`), so a changed
number changes its sentence with it. Every ability, trait step, item and boon is said twice: the
sentence in the guild's voice, which the almanac shows, and a short form for the cards on the table
(`abilityShort`, `traitShort`, `itemShort`, `boonShort`): effects and numbers only, a fragment or two
of at most 48 characters ("Shield 210 for 4s. 70 physical to adjacent enemies."). A test holds every
short form to that, and to using only numbers its long sentence has for the same stars.

`content/advice.ts` is read by the cards only. Each calling has a role and a place, and its draw if
it has one ("Tank · front row · draws fire", "Assassin · leaps to their back row · slips notice");
a figure's draw has a name and a tip for its chip (`drawName`, `drawTip`); and each figure has three
finished items that suit it,
chosen by its calling first (tanks Bark and Chestnut, fighters and assassins Thorn with Chestnut or
Plume, ranged Thorn and Plume, casters and healers Glowcap) and then by its ability.

## Driving it from a screen

A run is a plain object. Every action takes it, and either changes it and gives back
`{ ok: true, notes }` or leaves it alone and gives back `{ ok: false, code, why }`, a code and a
sentence to show the player. Notes say what happened, in order, naming figures by their own number in the run
(`piece`), so a screen can animate each one: `bought`, `merged`, `sold`, `moved`, `rustled`,
`level`, `gave`, `acorns`, `resolve`, `choice`, `room`, `over` and so on (see `Note` in `run.ts`).

```ts
import * as raid from "@sequoia-leaf/raid";

let almanac = raid.newAlmanac();
const run = raid.startRun(seed, { trail: 0 });

// Where the run stands is one value, run.stage: planning (with the picks waiting, the first up),
// fighting (with the fight Leaf decided), or over (and how). While a pick waits (raid.picksOf(run)),
// nothing else is allowed until it is settled.
raid.choose(run, 1);

// Planning. Read the run to draw it: run.stall, run.bench, run.board, run.items, run.acorns,
// run.foe (who is waiting), raid.traitsNow(run), raid.priceOf(run, i), raid.fieldCap(run).
const bought = raid.buy(run, 0);
if (!bought.ok) say(bought.why); // "Not enough acorns."
raid.move(run, { on: "bench", at: 0 }, { on: "board", at: 3 });
raid.giveItem(run, 0, { on: "board", at: 3 });

// The fight. beginFight decides it and hands over the setup; the screen plays it at its own pace.
const begun = raid.beginFight(run);
if (begun.ok) {
  const fight = raid.openFight(begun.setup);
  play(fight.opening); // traits switching on, summons, leaps
  while (!fight.over) {
    const events = raid.stepFight(fight); // one twentieth of a second
    play(events); // and read fight.units for where everyone is, health, mana, shields
    await nextStep();
  }
}
// The takings, paid from the fight as it was decided, so this may be called at any time after
// beginFight: that is all "skip" is.
const taken = raid.takeTakings(run);

if (run.stage.phase === "over") {
  const summary = raid.summariseRun(run);
  const paid = raid.payout(summary); // Coins
  const recorded = raid.recordRun(almanac, summary); // .news says what is new
  almanac = recorded.almanac;
}
```

**What a fight gives a renderer.** `fight.units` is everyone who has been in the fight, by `id`:
`kind`, `side`, `stars`, `cell`, `alive`, `hp`, `maxHp`, `shield`, `mana`, `manaFull`, `items`, and
the times each status runs until (`stunUntil` and the like, in steps, against `fight.tick`). The
events of a step (`FightEvent` in `fight/types.ts`) are plain objects:

- `move` (from, to, how many steps it takes), `leap` (a Sneak's opening leap, an ability, or being
  knocked back)
- `swing` (an attack up close; its `hit` follows), `shot` (something thrown: from, to, steps in the
  air, whether it is an attack or part of an ability)
- `hit` (who, by whom, how much, how much of it a shield took, what it was before armour, ward and
  bracing, physical, magic or true, where it came from, whether it landed hard, health and shield
  after), `slip`
- `cast` (whose ability, its name and shape, the hexes it covers, who it is aimed at, steps before
  it lands). An ability that spreads out from its owner names every hex it reaches, its own first;
  a Toadstool's spores are said as a `cast` too, straight after its `fall`
- `heal`, `shield`, `status` (on and off), `boost`, `item` (an item doing its trick)
- `fall`, `rise` (Second Wind), `summon`, `trait`, `dusk`, `end`

Headless Chromium draws about a frame a second, so a screen should keep its own handle for stepping
by hand; the fight needs nothing for that, since it only moves when `stepFight` is called.

**The tally.** `tally(events, ids)` reads a fight's events (the opening and the steps so far, or a
whole fight's) and gives back, for every figure, the damage it dealt as physical, magic and true;
the health it lost and what was kept off it (turned away by armour, ward and bracing, or soaked by
a shield); the health and shields it gave, to others or itself; how many it felled; and whether it
still stands. What a summoned figure did counts for whoever summoned it, so a Glorplet has no entry
of its own. `partsOf(did, "damage" | "tanked" | "healing")` gives the parts a bar is drawn in.

**Reading it back.** A run is kept as the plain data it is. `checkRun(v)` reads it back in two
layers: first the shape (figures, items and boons the content has, numbers that are numbers, parts
that agree), refusing anything else with a reason; then today's numbers, refusing nothing: xp past a
step makes its levels, the stall and the bench are today's size, a figure holds what one may hold
now and the rest goes to the item bench, and what the run drew and no longer reads is laid out
afresh (`layOutAfresh`). A run kept by an older game is brought up to date as it is read: a field it
did not keep yet gets what a new run starts with, a charm taken when charms counted for their kin
gets its emblem on the item bench (once), and a stored party's old `charms` is let be. A table of
version 1 kept where its run stood as a phase, the picks, two flags and the fight beside them; it
reads as one `stage`. A fight in progress keeps its setup and the outcome Leaf decided, read as it
was kept. The last fight fought is kept as its setup (`run.last`), so it can be played again to be
looked back on. `stored/` holds tables as Leaf stores them, frozen; `stored.test.ts` fails if a
change stops one reading.

## Trying the numbers

`review/balance.ts` plays whole runs with the bot under different habits (sensible, a saver who
levels, a roller who chases stars, one fond of each kin and each calling, and a careless one) and
prints how far each gets, how every room and every trouble plan goes, and how traits, figures, items
and boons do against the same rooms without them. Its `suits` section plays a sample of the fights
again with each figure given each finished item, and lists for every figure the items that helped it
most and least beside the three a card recommends; none of those is among a figure's three worst. The bot is a rough player: it seats by a plain
rule and does not look at what it is about to fight.

Where the numbers stood when this was written, 300 runs a habit, with the draw rule in:

| Trail              | Habit                          | Left wing 1 | Left wing 2 | Met the last boss | Beat it   |
| ------------------ | ------------------------------ | ----------- | ----------- | ----------------- | --------- |
| The Easy Way       | sensible                       | 100%        | 99%         | 52%               | 29%       |
|                    | saver who levels               | 100%        | 85%         | 33%               | 11%       |
|                    | roller who chases stars        | 100%        | 92%         | 59%               | 16%       |
|                    | fond of one kin (seven bots)   | 100%        | 90 to 100%  | 31 to 59%         | 17 to 39% |
|                    | fond of one calling (six bots) | 100%        | 89 to 98%   | 36 to 59%         | 18 to 34% |
|                    | careless                       | 95%         | 0%          | 0%                | 0%        |
| The Brambly Way    | sensible                       | 100%        | 84%         | 21%               | 5%        |
|                    | careless                       | 87%         | 0%          | 0%                | 0%        |
| The Long Way Round | sensible                       | 100%        | 47%         | 6%                | 0%        |
|                    | careless                       | 65%         | 0%          | 0%                | 0%        |

On the first trail the rooms are won, by everyone who is trying, at 100, 97, 99, 88 and 98% in the
first wing; 86, 79, 67, 57 and 74% in the second; 43, 45, 54 and 33% in the third; and the last
boss at 35% a try. A fight lasts 16.1 seconds on average, dusk falls in 7% of them, and draws are
too rare to show (0% when rounded).

Against the same rooms without regard to them, every one- to four-acorn figure wins within 6 points
of the rest except Crab #40 (+11); the three five-acorn figures are +12 to +17. Every kin's and
calling's first step is within 4 points; of the second steps Sneak (+13), Crab (+11) and Mender
(+9) do best and Ember and Slinger (-4) worst; the third steps of Bulwark and Fang were
seen too seldom to judge. Every finished item is within 6. The kin whose fond bot does best is
Crab (39% of runs won) and worst is Ember (17%). These figures lean on who chooses what: a party
that can afford a five-acorn figure is usually already doing well.

When the draw rule came in, the Bulwark and Sneak bots each gained 6 points of runs won; Bulwark's
armour went from 20, 45 and 80 (and 15 and 30 for the rest of the party) to 10, 30 and 60 (10 and
20), and Sneak's first hits from 50% and 80% more to 40% and 70%, which brought each back within 3.
The Burrow bot then won 50% of its runs, behind a Rock that took every hit. Burrow's armour went
from 15 and 25 to 15 and 20, and what a figure comes up with from 20% and 30% of its health to 15%
at both steps, while the second step keeps it under for 4 seconds rather than 2 (which cuts both
ways: a Rock underground stands in front of nobody). That brought it to 34%, and moved no other bot
by more than 1.

## Where this differs from the brief

- Losing a room moves on to the next one rather than replaying it; only the last room is repeated.
- Every kin has exactly four members, so a kin's second step needs all four, or three and an emblem
  held by a figure of another kin; and Crab's third step at five needs all four crabs and a Crab
  emblem on another figure.
  Bulwark and Fang have six members and a third step at six; the other callings stop at four.
- Burrow's dig is on the way down, not at the start: a Burrow figure digs in the first time it
  drops under half health. It stays where it is and keeps fighting: it used to go to ground, which
  took the party's front line away just when it was needed.
- A beaten boss gives two component picks, since otherwise a run forges three items at most.
- Two loose components that meet on one figure in a merge forge without being asked.
- Deep Pockets pays interest on every 5 acorns and raises the cap to 6, rather than only raising
  the cap, which nobody in a fifteen-room run saves enough to reach.
- A sparring partner's party is made directly from a budget for that room, not by playing a bot
  through the rooms before it.
- Trail-two and trail-three numbers are a first guess from bots; nobody has played them.
