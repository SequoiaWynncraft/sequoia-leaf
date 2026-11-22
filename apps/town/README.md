# Guild Town

The home of the guild's cosy browser game. The member logs in as their own block-game character,
standing in a small town in a clearing among giant redwoods at dusk, seen from above like an old
farming or monster-catching RPG. Every part of the game is a place in the town, the town's own
creatures and keepers live in it, real members are about in it when they are in the game (and doze
in it for a day after), and the other games are doors off it. Behind the town's gate is the
member's own camp.

```sh
bun run dev      # with hot reload
bun run build    # dist/
bun test         # the rules: saving, the arrival letter, the made-up guild, the town's own, the camp, the mailbox, parcels, strings of lights tied at both ends, the town live
```

To play as a real skin, put a 64x64 skin sheet at `dist/skins/player.png` after building (it is
never kept in the repository); without one the member gets a made-up skin. `review/build.sh` builds
and copies the test skin in one go.

## What is in the town

- **Arrival.** The member walks in through the gate with the last of the sun behind them, and a
  letter says what happened while they were away, a line at a time. Putting it away pays the Leaf
  and Coins it lists into the purse. The letter is worked out from when they were last here: a
  reload before it is read shows the same letter, a reload after it finds nothing owed and no
  letter, and later the same day there is one only if something has come in since.
- **The town.** A map a little larger than the screen, with a camera that follows. Walk with WASD
  or the arrow keys, or tap a spot and the character finds a way round things; hold and drag to
  steer. Buildings, trunks and the pond are solid.
- **Places.** The Treasury (Cinfy behind the counter), the quest board, the market stalls, the
  Works (chimney, belt, crates, and a bench by the door), the great stump where The Little Raid is
  played, the campfire and its log seats, the crab pond, and the gate with the signpost to "Your
  camp". Tap a place, or walk
  up and press E, to open its panel; a prompt shows when the member is standing at one. The dock
  along the bottom opens any of them at once, the character walks there meanwhile, and the slot
  for the place they are standing at is lit.
- **The market.** Three stalls sell things for a camp, for Coins: lamps and oddments (kept by
  Sootpaw, asleep on the counter until somebody shops), seats, rugs and flags (Bramblewick), and
  plants, fences and paths (Tindra). Nothing sells out and nothing rotates; each row says how many
  the member has.
- **What things are.** A thing for a camp (a market row, the tray, a thing set out in the camp
  while decorating or pointed at in it, a present, a trophy on the shelf) and a ware at the
  Treasury are cards in the kit's one card system (`card.ts`, registered in `cards.ts`): its
  picture, name and kind, what it does when touched, how many the member has, and where it comes
  from (the stall and its price, the Treasury, a present, or what wins it). A stall in a card is a
  card of its own, with everything it sells. Pointing shows the card, clicking the picture or the
  name pins it, a finger kept on a thing in the camp pins it as a sheet. People keep their own
  card (below), and the town's other things their one-line hint. What is bought leaves the stall as a parcel, up the path and out through
  the gate, and is waiting at the camp.
- **The Treasury.** Cinfy sells things to wear and a round of cocoa for Leaf, and a handful of fine
  pieces for a camp. They are as cosmetic as everything else there.
- **Doors into the games.** The Works and The Little Raid are games of their own. Each has a card
  that says what is waiting there and a button to go in; walking on into the Works' doorway, or
  sitting down on one of the logs at the stump, goes in without the card. The doors of the Works
  part and the member steps into the light (at the stump the lantern burns up), the view closes
  in on the spot, and the game opens out of it over the whole town. Coming back runs the other way.
- **The town's own** (`folk.ts`). Everybody who lives in the town and is not a member is drawn as
  one of the town's own sprites, never with a skin: Cinfy the keeper, a gnome in a gold hat behind
  the Treasury's counter; Sootpaw, a black cat, mostly asleep on the lamp stall; Bramblewick and
  Tindra, gnomes in red and green hats behind the other two stalls; Pipwick, a gnome in a blue hat,
  going round the crab pond (counting), the quest board (reading) and the gate (minding it);
  Mossback, a green glorp on a stump by the fire, who says "glorp."; Embertoe, a ginger cat,
  curled up by the fire and then on the Works' doorstep; and the crabs in the pond. The cats, the
  glorp and the fox are the camp's pets in their coats, and the gnomes the Works' gatherer with a
  two-step waddle (`folkart.ts`). Each one's name plate is the kit's leaf green with the acorn
  before it (`@sequoia-leaf/kit/mark.ts`); members' plates are cream. Tapping one shows its card:
  its name with the mark, what it is ("Stallkeeper, and a gnome"), what it is doing, a wave, and
  the way to its stall or the Treasury. They talk, greet the member, and cheer when the guild does.
- **Members.** Real members in the game are about the town (on the guild's own server, live,
  where they really are; below), and those who have gone in the last day doze in town (both below,
  and with the made-up guild its stand-ins, who stand about as visitors). A member's card has their
  name and rank, and for one dozing, how long ago they dozed off. A name shows only over somebody
  who is near the member, pointed at, speaking, or just arrived, and no two name plates ever
  overlap.
- **The guild, live.** With the made-up guild, every minute and a half or more (never sooner, of
  any kind, the town's own calling at the camp included): some of its stand-in members come home
  from a raid and hang a lantern in the tree, win a territory and the banner goes up the pole (at
  most once in five minutes), reach a level (at most once in ten) or a milestone. The feed in the
  corner says so in a line. Coming in,
  the feed counts everybody else in town, members and guests together: "You are home. 3 are in
  town.", "1 is in town.", or "The town is quiet."
- **Touching things.** Lantern posts, mushrooms, flowers, ferns, the great trunks, the fire, the
  water, the crabs, the pieces on the stump's board, the strings of lights and the sky all do
  something when tapped, with a sound. Pointing at a thing whose meaning is not plain (or keeping
  a finger on it) says what it is. One crab is never at roll call; it is hiding somewhere in town,
  and runs when found.

## What is in the camp

Walking on through the town's gate (or "Go home" on the gate's card) goes to the member's own camp.
Night closes in on them as they walk off, everything the lamps do not reach first and then the
lamps; the camp's lamps and fire come up out of the dark first, and the night lifts on them walking
in off the trail. Walking out past the two lantern posts on the camp's east side goes back.

- **The place.** A small clearing at the same dusk, a little larger than a screen: a cabin, a fire
  ring with two log seats, a mailbox, a signpost, a trophy shelf, a lantern post, and room. The
  earth is trodden bare in off the trail, round the fire and up to the cabin door, wherever those
  are standing. The member walks, sits on anything that can be sat on, and touches things as in
  town.
- **Who lives there.** A glorp (Glape), a ginger cat (Erm) and a small white fox with gold antlers
  (Snowdrop). The member chooses one the first time they come home. The next moves in when
  twenty-four things are set out in the camp, and the other when the member has greeted three of
  the town's own who dropped by (touching one greets it; a member who left presents at three camps
  before has theirs already); whichever happens first brings the next one in line. They wander,
  come to see whoever arrives, and answer a touch each in their own way. Nobody is bought.
- **Decorating.** The hammer in the corner turns it on. Everything in the camp can be dragged
  somewhere else, with the mouse or a finger: it lifts, snaps to a soft grid of eight-pixel
  squares, and shows the ground it would take. Green corners mean it may go there; coral corners
  and a mark over it mean it may not, and letting go then puts it back and says why. Things may
  not go on top of each other, on the trail, or anywhere that would shut the cabin's door, the
  mailbox or the signpost off from the trail. What lies flat (rugs, paths, a ring of mushrooms) is
  walked over, and other things may stand on it. The tray along the bottom has what is in hand
  (with Turn, for things that turn, and Put away) and everything put away; tapping one sets it out
  near the member, in hand. The cabin, the mailbox and the signpost may be moved but stay out. R
  turns, Delete puts away, Escape is done. Every change is kept.
- **Things.** Seventy-five of them (`things.ts`), in eight kinds, each drawn in the town's way and
  nearly all doing something when touched: a lantern goes out and lights, a wind chime rings, the
  music box plays its tune, Worm looks out of Worm's pot, and something in the barrel looks back.
  They come from the market for Coins, from the Treasury for Leaf, from the games as trophies that
  cannot be bought (a carved figure for each boss beaten in The Little Raid, a model of each
  capstone built in the Works), and from the town's own as small presents. Whatever is bought or won
  waits by the trail as a parcel, and the parcels open one after another when the member is in:
  each thing flies to a clear spot and lands. As many as two hundred parcels may wait; with that
  many by the trail the market and the Treasury sell nothing more (and take nothing) until some are
  unpacked, and a trophy waits in its game. A member may have as many as 999 of any one thing,
  standing, put away and waiting together; with that many the market and the Treasury sell no more
  of it (and take nothing), and a present or a trophy of it is not added. As many as three hundred
  things may be set out in a camp; with that many standing, nothing more comes out of the tray and
  a parcel or a present opens into the tray instead, until something is put away. A thing is in the
  camp, and kept, the moment its parcel opens; the flight is only how it is seen arriving.
- **The cabin.** Walking up to its door opens the member's own things: their rank, level and week
  with the guild, a switch, "Leave my character in town when I go" (on until turned off, kept in
  the record and sent to the guild's server as `stay`), what they are wearing (each thing put on or
  taken off), the trophies they have won, and who lives with them and what would bring the next. In town the member's face in the
  corner shows the rank and the week and points here.
- **The mailbox.** Notes and small presents from the town's own who came by while the member was
  away or in town, read as letters on paper. Its flag is up and it glows while there is a letter
  unread or a present not yet taken out. Taking a present out sends it hopping from the box to a
  spot beside it. The town's signpost at the gate has a mark over it while something is waiting.
  It holds twelve letters, and makes room by throwing out the oldest already dealt with, then the
  oldest with nothing inside; a present is never thrown out, so while the box is full of presents
  no more letters are left, and the feed says so.
- **The town's own dropping by.** Now and then Pipwick, Embertoe, Mossback or the White Fox walks
  in off the trail, says hello in its own voice, settles by the fire (the gnome standing, the
  others curled up), says a thing or two, and leaves, sometimes by way of the mailbox with a note
  and a present. Touching one greets it, and it answers. If the member is not there, it leaves
  what it brought and the feed says so.
- **The signpost.** The way back to town; down the trail, a note that members' camps are not
  there yet. The camp can still lay out and show somebody else's clearing (furnished from a name
  and a taste, with its own pets and roof, a note on the door when they are out, and one present to
  leave at their mailbox): that is `enter(owner)` with the guild's `camp(name)` in `campscene.ts`,
  `give` there, the `note` and `present` panels in `campui.ts`, and `layout` in `camp.ts`. Nothing
  reaches it, because the guild has no camp to give for anybody yet.
- **The guild, live.** The same moments reach a camp: a line in the feed, a paper lantern going up
  beyond the trees (and over the clearing, where the far trees are out of sight) when a raid comes
  home, a pennant on the cabin roof for land taken, and whoever is there, pets included, hopping.
  The town carries on quietly meanwhile, so the party is gone or back and the banner is up when
  the member returns.

## What it remembers

Leaf and Coins are the kit's one purse (`@sequoia-leaf/kit/purse.ts`), shared with every game: a
game in a frame that earns Coins moves the number in the town's corner.

The town keeps one small record in the browser (`save.ts` says what is in it): what the member
owns and has on, which quests they have claimed, how often they have spotted the missing crab, the
day they were last welcomed, the day the chest by the Treasury last had change in it, when they
were last here, how far their own news has been told (on the guild's server), whether their
character stays in town after they go, and their camp (what stands where and which way round,
what is in the tray, the parcels not yet opened, the letters, who was chosen first, how many of
the town's callers they have greeted, the presents once left at other camps and the trophies
already handed over). It has a version; text that is not a record of that version
starts a new one, and inside a record each part that makes no sense is put back to how a new
member has it. A record from before there were camps keeps what it had and gets a new camp; a
thing kept where it cannot stand goes into the tray instead of being lost. The sound setting is
kept by the kit. `?fresh` in the address starts all of it over, once.

## Where the guild comes from

Everything about the guild is asked for through `guild.ts`: who the member is, what has just
happened out in the guild, the quests and how far along they are, what the Treasury and each stall
sell and for how much, somebody's camp (nobody's yet), what a member may leave as a present, the
letters left while the member was away, which of the town's own looks in at the camp, which real
members are in the game just now, and which have gone in the last day and doze in town. With no
server `madeup.ts` invents all of it, and keeps a memory of its own as a server would: so that
visitors and dozers can be seen, it has four stand-in members with made-up looks (Quillfeather
and Fernwhistle in the game, Wrenly and Kestrelle gone a while). The town's own are not the
guild's: they are in `folk.ts`, the same everywhere.

## On the guild's own server

The town's front door is `open.ts`. It awaits the kit's `start()` before anything is read (the
kit's README says how it finds out where it is): with no server the town opens with the made-up
guild, exactly as above. On the guild's server it fetches the member's saved purse and town
(`purse` and `town` slots), then what `live.ts` needs (their quests, their newest news for the
week's counts, and their news since the town last told them any), and only then loads the town.
If the member is signed out, not a member, or the server is in trouble, the kit's card says so.
The town is not loaded at all, since it reads what the browser keeps the moment it loads.

From then on `live.ts` answers what is real and `madeup.ts` only what is not guild data (the wares,
the mail and calls of the town's own); beside the real guild it has no stand-ins, news, quests or
Leaf. `live.test.ts` holds the live guild to handing the town nobody the server did not name.

- **The member.** Their name, their rank as the guild writes it (capitalised; an unknown one as it
  comes; none at all is "Friend"), their level, and their own skin from `/v1/game/skins/<id>`
  (the made-up look if it will not load). The week's counts come from their newest news.
- **Leaf.** The purse's Leaf is the guild's ledger's and changes only when the ledger does. The
  Treasury's things and pieces are shown with closed buttons; nothing in town pays Leaf.
- **The board.** The member's real quests, those open and those just finished: the title, the
  nearest goal's progress, the Leaf it pays, and for the timed one when it ends. They pay by
  themselves, so there is nothing to claim: a finished one says "Paid".
- **The arrival letter.** Its paying lines are replaced by what happened to the member since the
  town last told them (raids with their Leaf summed, wars, quests finished, the level reached,
  milestones), each with the Leaf already paid, and putting it away pays nothing. The townsfolk's
  lines stay. Where the news was read up to is kept in the record (`cursor`) once the letter is
  put away, and moves on as the member's own news arrives while they are in town, so that the
  next letter does not tell it again. On a first visit the letter is a plain welcome.
- **The guild's news.** The town listens to the guild's events. Members paid for the same raid at
  the same moment are one party: they walk in through the gate (any of them in town already come
  over), the first hangs a lantern in the tree, and the feed names them and the raid. A war raises
  the banner for that territory, and the feed says only what its events do: "Alice and Bob fought at Detlas.", never who won. A milestone is a line in the feed, and so is a level: the
  member's own always, anybody else's only at a multiple of five. The member is "You", and no line
  says how much Leaf anybody was paid (`news.ts` has every line). The feed takes these lines one at
  a time, twenty seconds apart, oldest first, and drops one that has waited five minutes; what
  happens in the world for them (the party walking in, the lantern, the banner) does not wait.
- **The town, live** (`players.ts`, its rules in `motion.ts`). While the town is on the stage the
  page is in Leaf's live room `town` (the kit's `joinLive`); in the camp, or with a game open, it is
  not, and coming back joins again. The member's figure moves from their own input at once, as
  ever, and the room is told where it is as it goes: its feet, its speed, which way it faces,
  whether it walks or sits, and a jump whenever it is put somewhere without walking (back through
  the gate, out of the Works' doorway, `tp`). Everybody else in the room is drawn in their own
  skin exactly where the room says they are (`sample`), never walked anywhere by the town: legs
  going only while they move, seated where they sit (keeping that seat from anybody dozing or
  sitting down on top of them), put at a new place at once when they jump. Somebody who comes fades
  in at their first motion, and somebody who goes fades out, then dozes as below if the guild says
  they rest. Nobody is solid to anybody. Their card has their name, their rank or "Guest", and a
  "Wave", which turns the member to them and waves. The feed's "N are in town" counts the room.
- **Emotes.** In the live room, tapping the member's own figure opens a small plaque over their
  head with four emotes (wave, cheer, laugh, heart, the kit's `emotes.ts`); choosing one, the
  member hops once and its picture floats up from over their name for a moment and a half, and so
  does everybody's picture of them when the room tells them. Nothing typed is sent.
- **The connection.** While it is down, the town plays on and a small "Reconnecting…" sits by the
  purse; after five seconds the others fade away until the room welcomes the page again. Told the
  member opened the game live somewhere else, the kit's card "Playing somewhere else" says this
  page has let go of the town, with "Play here", which takes the room back; told their session has
  ended, the kit's "Signed out" card.
- **Who is here.** The town says where the member is (the town, the camp, or nowhere while a game
  is open, which says its own place) and whether their character stays, and hears who else is in
  the game and who has gone in the last day and stays. It goes on saying so every half minute in
  the live room too, though Leaf writes where the member is from the room: that answer is how it
  hears who rests and who is at the Works or the stump. Up to twelve of those in the game stand
  about as visitors (`visitors.ts`) in their own skins: by the Works' door, or watching at the
  stump, and with the made-up guild strolling in town; on the guild's own server those in town are
  there live instead, and nobody live is a visitor or a dozer as well. Nobody at their own camp.
  They come in through the gate, never speak, and their card has only their name and rank; a
  guest's says "Guest". Up to twelve of the others, most recent first, doze at a free seat
  for where they were (a log at the fire for the town, the log at the stump for the table, the bench
  by the Works' door for the Works, then whatever seat is free; never the member's own; nobody last
  at their camp): eyes closed, a "z" drifting up, never speaking or moving. A visitor who goes sits
  down to doze if they stay, and walks out through the gate if not; a dozer who comes back gets up.
- **What it remembers** goes to the member's account as well as the browser (the kit's
  `cloud.ts`). `?fresh` is ignored there.

- **A guest.** Somebody signed in who is not in the guild plays the same town, with none of the
  guild's own: `prepare()` fetches nothing, and nothing only a member may ask (`/v1/me...`, the
  guild's news) is asked. The purse shows only Coins and every Leaf button says "Leaf is earned by
  raiding with Sequoia."; the board holds one note ("Quests are for members of Sequoia. Raid with
  the guild and yours appear here."); the letter is the plain welcome with the townsfolk's lines;
  their card says "Guest of the guild" with no ranks and no week. Visitors and dozers who are
  guests look like anybody else, with "Guest" for a rank.

`review/live.ts` is a stand-in for the server, for looking at all of this without one: `bun
review/live.ts 8790` serves the built town and games under `/play/` with a made-up member called
Tester, five others about and three dozing; `GET /review/raid` brings a raid party home; `--signed-out`,
`--not-a-member` and `--down` show the cards. Its live room has nobody in it but the member, so
nobody is about in town there; the real app with a crowd walking about the live room is
`apps/api/test/play.ts` (the repository's README).

What each game says is waiting behind its door, what the Works made while the member was away, and
what the member has won in each game come from `games.ts`: one small function a game, returning a
fixed line or a made-up answer until the games can say for themselves.

## How it is put together

A place is drawn small, one art pixel to a pixel, with dusk laid over it and each lamp and fire
cutting a soft hole in the dusk; that picture is blown up to the screen by a whole number. The
words over it (name plates, speech, the prompt by a door) are written in the kit's font at a whole
number of screen pixels to each of the font's, once the font has loaded. All of the art is drawn
in code when the page loads: `ground.ts` and `campground.ts` paint the floors, the sunset and the
trunks a pixel at a time, and `sprites.ts` and `campart.ts` build the shops, the cabin and the
small things from rectangles and from pictures typed out as rows of letters. Characters come from
skin sheets (the kit's `skin.ts`).

Everything that is not the world is built from the kit's classes; the style block in `index.html`
only says where things go. `hud.ts` has what the town and the camp share (the purse, the corner
buttons, the feed, the dock, the panel's frame, a card for whoever was tapped), and `ui.ts` and
`campui.ts` say what each puts in them.

`main.ts` is a stage, and the town and the camp are scenes on it. `main.ts` owns the canvas, the
camera, the keys and fingers, the loop, the walk from one place to another, and the way into a
game and back; everything else it asks of a `Scene` (`stage.ts`). A scene is put on with
`stage.travel(scene, swap)`, which is the walk through the dark, or `stage.put(scene)`, at once.
One camp scene shows the member's own camp (or, one day, anybody else's).

While a game is open the loop is stopped: nothing is stepped or drawn and nothing makes a sound,
and it picks up where it was when the game is put away. While the member is in a camp the town is
not stepped either; what the guild does meanwhile is applied to it without ceremony.

| File                                  | What it holds                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/open.ts`                         | The front door: where the game is, the member's saves, then the town                    |
| `src/main.ts`                         | The stage: canvas, camera, keys and fingers, the loop, the walk between places          |
| `src/stage.ts`                        | What the stage asks of a scene, and a scene of the stage                                |
| `src/townscene.ts`                    | The town as a scene: who is here, taps, getting about, going into games and to the camp |
| `src/campscene.ts`                    | A camp as a scene: laying it out, who is there, taps, decorating, parcels, visiting     |
| `src/grid.ts`                         | Ground to walk on: which squares are solid, and the way round them                      |
| `src/world.ts`                        | The town's map: paths, pond, what is solid, where places are                            |
| `src/camp.ts`                         | A camp's rules: what may stand where, the tray, who lives there, somebody else's layout |
| `src/things.ts`                       | The catalogue of camp things: names, kinds, the ground each takes                       |
| `src/mail.ts`                         | The mailbox: letters, and when one is still waiting                                     |
| `src/town.ts`, `src/camptouch.ts`     | What each thing does when touched, and the parts that move                              |
| `src/props.ts`, `src/flights.ts`      | Things that stand and can be touched; things in the air                                 |
| `src/actors.ts`, `src/pets.ts`        | Walking, sitting, speaking; the town's own about their evening; the pets                |
| `src/folk.ts`, `src/folkart.ts`       | The town's own: who each is, its job and lines; how each is drawn (never a skin)        |
| `src/events.ts`                       | Staging the guild's moments in the town, or applying them quietly                       |
| `src/draw.ts`                         | Drawing a frame of any place; name plates and speech; the round hole a door closes to   |
| `src/hud.ts`                          | The purse, corner, feed, dock, panel and cards, shared by both places                   |
| `src/ui.ts`, `src/campui.ts`          | The town's panels and arrival letter; the camp's panels and tray                        |
| `src/cards.ts`                        | What camp things, Treasury wares and stalls say about themselves, as kit cards          |
| `src/doors.ts`                        | A game in a frame: opening it, hearing it, the note when it will not open               |
| `src/games.ts`                        | The games that are places, what each says is waiting, and what has been won in each     |
| `src/guild.ts`, `src/madeup.ts`       | The questions asked of the guild, and the made-up guild that answers                    |
| `src/live.ts`, `src/news.ts`          | The real guild's answers on its own server; the feed's line for each moment             |
| `src/visitors.ts`                     | Real members in the game, standing about the town, and those dozing in it               |
| `src/players.ts`, `src/motion.ts`     | The town live: in the room, everybody else drawn from it, emotes; its rules             |
| `src/save.ts`, `src/keep.ts`          | The kept record and its rules; reading and writing it in the browser                    |
| `src/record.ts`                       | The one record as it is held while the page is open                                     |
| `src/letter.ts`                       | Putting the arrival letter together from the time away                                  |
| `src/fx.ts`                           | Sparks, leaves and rising words                                                         |
| `src/sprites.ts`, `src/ground.ts`     | The town's art                                                                          |
| `src/campart.ts`, `src/campground.ts` | The camp's art: the cabin, every thing, the pets, the clearing's floor                  |
| `src/campsfx.ts`                      | The camp's own sounds                                                                   |

`grid.ts`, `camp.ts`, `things.ts`, `mail.ts`, `save.ts`, `letter.ts`, `madeup.ts`, `games.ts`,
`folk.ts`, `live.ts`, `news.ts` and `motion.ts` have no page in them, and tests beside them
(`motion.test.ts` plays Leaf's side of a live connection with the kit's stand-in socket); `folk.test.ts` also
reads every file of the three games to check that nothing but members is drawn from a skin. `record.ts` has tests too,
for what is sent to the camp.

## The games beside it

The games are pages of their own, served beside the town: `../works/index.html` and
`../battler/index.html`. A game speaks to the town with the kit's `shell.ts`: `ready` once it has
drawn, `leave` to come back, `news` for a line in the feed; the town says `closing` just before it
puts the game away. A game that has not said `ready` within a few seconds, or whose page is not
there, gets a note and a way back; one that says it later opens over the note.

## Looking at it from outside

`window.town` has handles for taking pictures of it: `skip(seconds)` runs the clock on, `hold(true)`
stops the clock so that only `skip` moves it, `enter()` puts the arrival letter away, `visit(place)`
and `open(panel)` open things in town, `tp(x, y)` moves the member in town, `walk(x, y)` walks them
to a point, `emote(kind)` makes an emote, `players()` says where everybody else in the live room
would be drawn this moment, `told()` what the room was last told of the member and when, `link()`
how the live connection is, `happen("raid" | "war" |
"level" | "milestone" | "call")` sets off one of the made-up guild's moments, `inside(game)` goes
through a door, `door()` says how far that has got, `leave()` comes back, `kept()` shows the record
as it would be saved, `who()` says where each of the town's own is and what it is doing,
`visitors()` says which real members are in town, where, and whether they are dozing, `where()` says which place is on and how dark the walk has got, `coins(n)` puts Coins in the purse for a tour that buys things (only with the made-up guild), and `page(x, y)` turns a
point in the place that is on into a point on the page.

`window.town.camp` is the same for camps: `go()` walks out of town to the member's camp, `town()`
and `home()` walk back, `visit(name)` would go to somebody else's (there is none yet), `greet(n)`
touches the nth of whoever has dropped by, `walk("cabin" | "mailbox" |
"signpost" | "trail")` walks up to a place and uses it, `decorate(on)`, `take(id)` sets a thing out
of the tray, `grab(n)`, `dragTo(cx, cy)` and `drop()` move the nth thing by squares, `hand()` says
what is held and whether it may go where it is, `things()`, `pets()` and `guests()` say what is
there, `pet(n)` touches one, and `choose(kind)` picks who lives there first.

`?sheet=big`, `?sheet=small`, `?sheet=ground` and `?sheet=sky` show the town's art on its own, and
`?sheet=camp` every camp thing with its name. `?zoom=2` draws a place smaller, to see more of it.

The step lists in `review/` drive the tours the screenshots came from, with the driver in
`../../packages/kit/tools/drive.ts`:

```sh
sh review/build.sh standin
bun ../../packages/kit/tools/drive.ts "http://town.test/?fresh" <out-dir> review/camp.json dist
```

`final.json` is the whole town at three sizes (the keepers at their stalls, Pipwick about, a
townsperson's card, a dozing member's card), `doors.json` the way into a game and the note when
one is missing, `remember.json` what survives a reload, `reactions.json` the things that answer a
touch. `camp.json` and `camp-phone.json` are the camp from the market to one of the town's own dropping
by, greeted, the signpost and back, at 1280x760 and 390x844 (the phone's with a finger), `camp-remember.json` the camp across a
reload, and `camp-things.json` (opened with `?sheet=camp`) the sheet of every thing.
`review/build.sh standin` puts `review/standin/` (a page that only speaks to the town) where the
Works would be and leaves The Little Raid out, so both kinds of door can be seen without the
games; without `standin` it copies the games' own builds in beside the town when they exist.
