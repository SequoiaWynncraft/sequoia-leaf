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
bun test         # the arrival letter, the town's own, what goes by Leaf's clock on the town's ground, the guild live, strings of lights tied at both ends, the town live, what a touch means
```

The town always plays on Leaf: on a developer's machine that is `apps/api/test/play.ts` (the
repository's README, and "Looking at it from outside" below). Anywhere without Leaf the kit's card
says so.

## What is in the town

- **Arrival.** The member walks in through the gate with the last of the sun behind them, and a
  letter says what happened while they were away, a line at a time: their own news with the guild
  and the Leaf the ledger has already paid for it, what the town's own did (Leaf's `arrival`), what
  is waiting in the Works' till, and the crab still missing. Putting it away is Leaf's `welcome`,
  which posts what the town's own left in the camp's mailbox. There is a letter on a first visit,
  on the first visit of a UTC day, and otherwise only if the member's news paid Leaf; a reload
  before it is put away shows the same letter. A page loaded again in the same tab within ten
  minutes of the last one going puts the member back where they stood in town, facing as they
  were, instead of at the gate (`town.stood.v1` in the tab's own storage, written as the page goes).
- **The town.** A map a little larger than the screen, with a camera that follows. Walk with WASD
  or the arrow keys, or tap a spot and the character finds a way round things; hold and drag to
  steer. Buildings, trunks and the pond are solid.
- **Places.** The Treasury (Cinfy behind the counter), the Grove (below), the quest board, the Tally, the market stalls, the
  Works (chimney, belt, crates, and a bench by the door), the great stump where The Little Raid is
  played, the campfire and its log seats, the crab pond, and the gate with the signpost to "Your
  camp". Tap a place or its prompt, walk on into it, or walk up and press E (or Enter), to open
  its panel; a prompt shows when the member is standing at one. The dock
  along the bottom opens any of them at once, the character walks there meanwhile, and the slot
  for the place they are standing at is lit.
- **The quest board.** Two tabs: the quests, and "News", the ten newest notes on what has changed
  in the game (`notes.json`, newest first). Every quest Leaf sends (`GET /v1/me/quests`), open and
  just finished, is a note; the panel scrolls when they do not fit. A quest says what it asks with
  the Leaf it pays beside it, and has a bar and count for each way to finish it Leaf sends (raids
  or wars, side by side). At its foot an open quest says its kind as the mod names them (Daily,
  Weekly, Timed, Endless) and when it ends, in the member's own time, and one Leaf lets the member
  swap has a Reroll button there with what it costs (`reroll_leaf`): a free one
  goes at once, one that costs Leaf asks to be pressed again. `POST /v1/me/quests/{id}/reroll`
  sends the cost shown; the new quest takes the old one's place from Leaf's answer and the purse
  shows the Leaf left, or the note says why Leaf refused, in Leaf's words. One reroll is on its way
  at a time. The board shows a "!" while there is news the member has
  not opened; the id of the newest note they opened is kept in the browser under `town.notes.seen`. The panel opens on "News" while there is unread news, and on
  the quests otherwise.
- **The Tally** (`tally.ts`, `tallyui.ts`, `tallyart.ts`, `tally.css`). A board built as the quest
  board is (`noticeBoard` in `sprites.ts`) with the top three pinned to it as a podium, on the lawn
  between the fire and the pond, across the fire from the quest board. There the town keeps count:
  Leaf's leaderboards (`GET /v1/game/tally/{board}/{period}`; the boards are `TALLY_BOARDS` in core). Its panel lists
  the boards by group (the guild, the Works, The Little Raid, the town) beside the board chosen, or,
  where the panel is narrow, behind "Boards". A board is for this week or all time (tabs; a board
  kept for all time only has the one): the top three stand on plinths, each face as the town draws
  it, with name and score (where the board is too narrow for three names side by side, the three
  are rows beside their plinths), places 4 to 10 are rows under them, and the member's own place is
  pinned at the foot when they are on the board but not in its top ten. A tie shares a place;
  guests are marked "Guest". Choosing anybody shows their card. A board is read when chosen and each
  minute while it stays open; it rises as it comes, a note a place. Until the member first opens
  the Tally its board carries a mark (`town.tally.seen` in the browser), and the first time, first
  place lands with a fanfare.
- **The market.** Three stalls sell things for a camp, for Coins: lamps and oddments (kept by
  Sootpaw, asleep on the counter until somebody shops), seats, rugs and flags (Bramblewick), and
  plants, fences and paths (Tindra). Nothing sells out and nothing rotates; each row says how many
  the member has. Buying asks Leaf, which takes the price.
- **What things are.** A thing for a camp (a market row, the tray, a thing set out in the camp
  while decorating or pointed at in it, a present, a trophy on the shelf) is a card in the kit's
  one card system (`card.ts`, registered in `cards.ts`): its picture, name and kind, what it does
  when touched, how many the member has, and where it comes from (the stall and its price, a
  present, or what wins it). A stall in a card is a
  card of its own, with everything it sells. Pointing shows the card, clicking the picture or the
  name pins it, a finger kept on a thing in the camp pins it as a sheet. People keep their own
  card (below), and the town's other things their one-line hint. What is bought is in the camp's
  Storage at once: its picture goes from the stall's button to the camp's button in the dock.
- **The Treasury.** Cinfy sells the guild's two paid requests, an aspect request and a tome
  request, for the Leaf the backend asks (3,000 each). The page asks Leaf
  (`GET /v1/game/requests`), which asks the backend as the member: each row has its price on a
  button, or in its place why the member cannot buy it, in the backend's words. The button asks to
  be pressed again before it buys; a tome's first press opens a field for what the tome is for.
  `POST /v1/game/requests` buys it: the backend takes the Leaf from the guild's ledger, and the row
  says where the request stands in the queue and the purse shows the Leaf left. Refused, it says
  why; with no answer, it says to check the queue in Discord, and does not send it again. A guest
  sees the two rows without buttons and one line saying who they are for.
- **Doors into the games.** The Works and The Little Raid are games of their own. Each has a card
  that says what is waiting there and a button to go in; walking on into the Works' doorway, or
  sitting down on one of the logs at the stump, goes in without the card. The doors of the Works
  part and the member steps into the light (at the stump the lantern burns up), the view closes
  in on the spot, and the game opens out of it over the whole town. Coming back runs the other way.
- **The town's own** (`folk.ts`, in `packages/town`). Everybody who lives in the town and is not a member is drawn as
  one of the town's own sprites, never with a skin: Cinfy the keeper, a gnome in a gold hat behind
  the Treasury's counter; Sootpaw, a black cat, mostly asleep on the lamp stall; Bramblewick and
  Tindra, gnomes in red and green hats behind the other two stalls; Pipwick, a gnome in a blue hat,
  going round the crab pond (counting), the quest board (reading) and the gate (minding it);
  Mossback, a green glorp on a stump by the fire, who says "glorp."; Fika, a ginger cat,
  curled up by the fire and then on the Works' doorstep; and the crabs in the pond. The cats, the
  glorp and the fox are the camp's pets in their coats, and the gnomes the Works' gatherer with a
  two-step waddle (`folkart.ts`). Each one's name plate is the kit's leaf green with the acorn
  before it (`@sequoia-leaf/kit/mark.ts`); members' plates are cream. Tapping one shows its card:
  its name with the mark, what it is ("Stallkeeper, and a gnome"), what it is doing, a wave, and
  the way to its stall or the Treasury. They talk, greet whoever walks by, and cheer when the guild does.
- **One town for everybody** (`clock.ts`, in `packages/town`). Where each of the town's own and each
  crab is, what it is doing and what it says to itself is worked out from two things every page has
  the same: the room's name with the UTC day, and Leaf's clock (`G.now`, from the room's
  `serverNow`; a page in no room goes by its own). Nothing is stepped from frame to frame and
  nothing is sent, so every page in the room shows Pipwick at the same spot of the same errand
  saying the same line, and a page that opens in the middle of his walk puts him part-way along it.
  The clock says where somebody set out from, where to and when; the page walks the way between
  the two along the town's paths at the figure's own pace (`byClock` in `actors.ts`). Nobody of
  them waits for anybody or goes round anybody: somebody standing on a spot of theirs is drawn
  beside them. What answers a player is still worked out on each page, from where the players
  are: a word for somebody walking by (the same word on each page), a crab edging away from feet,
  a napper woken by a touch, a hop at a cheer.
  The same goes for what follows from what Leaf said: where members in the games stand and those
  gone doze (**Who is here**), and a raid party home or a war (**The guild's news**), each from
  Leaf's list or the event's own time. And for the stump's board: while somebody is at it (a
  player sitting there, or a member Leaf lists at the table) a carved figure goes to a free hex
  beside its own every 2.1 seconds (`boardAt`), the moves taken back after 32 so that it is set out
  again every 64; with nobody at it, it is set out. A knock on the stump makes them all jump.
- **Members.** Real members in the game are about the town, live, where they really are, and those
  who have gone in the last day doze in town (both below). A member's card has their
  name and rank, and for one dozing, how long ago they dozed off. A name shows only over somebody
  who is near the member, pointed at, speaking, or just arrived, and no two name plates ever
  overlap. A member can stand behind something tall and be hidden by it: that is how the town is
  drawn, and a place to hide. Of
  everybody a touch is on, in front or behind, it means the one whose middle is nearest; a finger
  is on a figure from 10 pixels across, the mouse from 7.
- **Nobody inside anybody** (`apart.ts`). A figure is drawn 10 pixels across and as tall as its pose
  (`headOf`: 21 standing, 19 sitting facing us, 16 sitting side on or facing away); two overlapping
  by over a third of the smaller are on top of one another (`crowds`). A walk the member is sent on in
  town (to a tapped spot or a place)
  ends where it was going, or, with somebody standing or sitting still there, at the nearest place
  to it that is on top of nobody and a straight walk from it, 21 pixels away at most (`stopAt`,
  `beside`). The end is looked at again all along the walk's last stretch. A seat somebody stands
  or sits on is not free, tapped or chosen as the nearest; somebody who finds their seat taken when
  they get there goes to the next free one, or, with none, stays standing.
  Other players walk where their own pages send them, so members standing or sitting still on top
  of one another anyway (the member, live players, those visiting or dozing) are drawn apart, the
  same on every page. In turn, whoever sits first and then by account: somebody on top of nobody
  before them stays where they are, and each of the rest is drawn at the nearest place round where
  they are themselves that is on top of nobody drawn, 21 pixels away at most. Somebody walking is
  drawn where they are. Only the drawing moves, 50 pixels a second, as they stop or set off; a touch
  finds them where they are drawn.
- **Coming in**, the feed counts everybody else in town, members and guests together: "You are
  home. 3 are in town.", "1 is in town.", or "The town is quiet."
- **Touching things.** Lantern posts, mushrooms, flowers, ferns, the great trunks, the fire, the
  water, the crabs, the pieces on the stump's board, the strings of lights and the sky all do
  something when tapped, with a sound. Pointing at a thing whose meaning is not plain (or keeping
  a finger on it) says what it is. One crab is never at roll call; it hides in one of nine places
  in town for 60 seconds by Leaf's clock, the same place on every page, and then in another. Each
  member can find it there once: touched, it runs off on that member's page and is gone for them
  until the 60 seconds are up, and is counted as their sighting; on the others' pages it only hops
  and stays to be found. Leaf works out which 60 seconds it is from its own clock.
- **Every touch is seen** (`touchThing` in `town.ts`). Each touch on a thing, a tap on a crab's tile
  or the roll called at the pond, a log on the fire, goes through one place by the thing's name:
  its kind and the point on it (`post:174,100`, `water:404,295`), a crab's number (`crab:3`), or
  `roll`. It answers on the member's page and is told to the room, which passes it to every other
  page there; each plays the same answer from the name, and its sound only if the thing is on the
  screen. The town stands the same on every page, so a name means the same thing on each. What a
  touch does for the member alone stays theirs: the walk to a door and its card, the chest's
  present, a seat, the stall chosen, crab No. 7 counted. Lamps, flowers and crabs stir as any
  player walks by.

## What is in the camp

The town's gate and its signpost open the camp's card, as any place does, and "Go home" on it goes; a
touch on the way through the gate, or walking on into it, goes without the card.
Night closes in on them as they walk off, everything the lamps do not reach first and then the
lamps; the camp's lamps and fire come up out of the dark first, and the night lifts on them walking
in off the trail. The trail between the two lantern posts on the camp's east side goes back, the same four ways.

- **The place.** A small clearing at the same dusk, a little larger than a screen: a cabin, a fire
  ring with two log seats, a mailbox, a signpost, a trophy shelf, a lantern post, and room. The
  earth is trodden bare in off the trail, round the fire and up to the cabin door, wherever those
  are standing. The member walks, sits on anything that can be sat on, and touches things as in
  town.
- **Who lives there.** A glorp (Glape), a ginger cat (Erm) and a small white fox with gold antlers
  (Snowdrop). The member chooses one the first time they come home. The next moves in when
  twenty-four things are set out in the camp, and the other when the member has greeted three of
  the town's own who dropped by (touching one greets it); whichever happens first brings the next
  one in line (`petsOf`, in `packages/town`). They wander,
  come to see whoever arrives, and answer a touch each in their own way. Nobody is bought.
- **Decorating.** The hammer in the corner turns it on. Everything in the camp can be dragged
  somewhere else, with the mouse or a finger: it lifts, snaps to a soft grid of eight-pixel
  squares, and shows the ground it would take. Green corners mean it may go there; coral corners
  and a mark over it mean it may not, and letting go then puts it back and says why. Things may
  not go on top of each other, on the trail, or anywhere that would shut the cabin's door, the
  mailbox or the signpost off from the trail. What lies flat (rugs, paths, a ring of mushrooms) is
  walked over, and other things may stand on it. The cabin, the mailbox and the signpost may be
  moved but stay out. R turns, Delete puts away, Escape is done. Every change is a command to Leaf
  (below).
- **Storage.** Everything the member has that is not set out (`camp.tray` in the code; a player
  reads "Storage"). Nothing stands in a camp that its member did not set there: a thing bought, a
  thing won and a present taken out of a letter each go into Storage (`store` in
  `packages/town`). It is the sheet along the bottom while decorating: a bar with what is in hand
  (Rotate, for things that turn, and Put away) or its name, and under it everything stored, by
  kind, each with its picture, its name and how many, in a list that scrolls. Tapping one sets it
  out near the member, in hand; a thing dragged onto the sheet is put away. The camera keeps the
  member above the sheet (`covered` in `hud.ts`). What has come since the member last looked is
  new (`camp.fresh`, which Leaf keeps): the hammer carries how many, the camp's card in town says
  so, and the things are marked "New" in the list. Opening Storage is looking (`looked`): the
  marks stay until it is shut.
- **Things.** 104 of them (`things.ts`, in `packages/town`), in nine kinds, each drawn in the town's way and
  nearly all doing something when touched: a lantern goes out and lights, a wind chime rings, the
  music box plays its tune, Worm looks out of Worm's pot, and something in the barrel looks back.
  They come from the market for Coins, from the games as trophies that
  cannot be bought (a carved figure for each boss beaten in The Little Raid, a model of each
  capstone built in the Works), from pulls as prizes, and from the town's own as small presents.
  A pull's prize is a **character**: one of The Little Raid's figures, drawn with the raid's own
  pictures from `packages/figures` (`character` in `campart.ts`), on 3 squares of ground. Set out, it
  breathes as it does on the raid's table, and the one that flies hovers (`stepLive` in
  `camptouch.ts`); "Rotate" mirrors it, and touched it hops and says its line from the raid.
  A banner's headliner brings a statue of that member (`statues.ts`): Leaf says who
  (`GET /v1/game/banners`), the thing is called "Statue of NAME", and its picture is their own
  figure facing us, every colour turned to marble by its lightness, on the fox statue's plinth
  (`carve` in `campart.ts`). Every page asks, so a visitor sees whose it is. A member may have as
  many as 999 of any one thing, standing and stored together; with that many the market sells no
  more of it (and takes nothing), a present of it stays in its letter, and a prize of it is not
  kept. As many as three hundred things may be set out in a camp; with that many standing, nothing
  more comes out of Storage until something is put away.
- **The cabin.** Walking up to its door opens the member's own things: their rank, level and week
  with the guild, a switch, "Leave my character in town when I go" (on until turned off, kept in
  Leaf's town and said with where they are as `stay`), "Copy link to my camp" (the page's address
  with `?camp=<their id>`, for pasting in chat; "Link copied" for two seconds), the trophies they
  have won, and who lives with them and what would bring the next. In town the member's face in the
  corner shows the rank and the week and points here.
- **The mailbox.** Notes and small presents from the town's own who came by while the member was
  away or in town, read as letters on paper. Its flag is up and it glows while there is a letter
  unread or a present not yet taken out. Taking a present out sends it hopping from the box to a
  spot beside it. The town's signpost at the gate has a mark over it while something is waiting.
  It holds twelve letters, and makes room by throwing out the oldest already dealt with, then the
  oldest with nothing inside; a present is never thrown out, so while the box is full of presents
  no more letters are left, and the feed says so. Under the letters, its visitors
  (`mailbox.ts`, `GET /v1/game/camps/visitors`): who likes the camp, newest first, and who stayed
  in it this week, each with their face, opening their card.
- **The town's own dropping by.** Leaf sends them: every 46 to 76 seconds Pipwick, Fika,
  Mossback or Orphion sets out for the camp and waits there (`visit`), until greeted or until
  the next one comes. While the member is in their camp the page asks Leaf for the town every half
  minute, so a caller walks in off the trail, says hello in its own voice, settles by the fire (the
  gnome standing, the others curled up) and says a thing or two now and then. Touching one greets
  it: it answers, and goes, by way of the mailbox when it brought a note or a present. One who goes
  because the next has come does the same; with the box full of presents the feed says so.
- **The signpost** (`signpost.ts`, the list in `camps.ts`). The same at every camp: Home (when
  away), Town, then every camp Leaf lists (`GET /v1/game/camps`) but the member's own and the one
  they stand in, each owner's face and name, its likes and things set out, and "Go". A field finds
  camps by name as it is typed in, and two tabs order them: "Most liked" (the first time; a tie
  goes to more set out, then the name) or "Most set out". The list scrolls on its own under them,
  and a row is made once and brought up to date in place, so a button keeps the keyboard.
- **Somebody else's camp.** Reached from that list, from "Visit camp" on a person's card (in Who
  is about, or in the Works' Top yards, which leaves for the town with `?camp=<player>`), or by
  opening the page with `?camp=<player>` (the member's own id opens their own). `leaf.ts` opens
  it from Leaf as a visitor is given it (`openCamp`, the visit route), beside the member's own
  town, and from then until the member leaves `visiting()` says whose camp it is and `shown()` is
  theirs: the same scene draws it, with their pets in a colour of their own and a roof of their
  own. Everything stands and answers a touch, and a thing's card opens; nothing can be changed:
  `doNow` and `ask` refuse, and there is no cabin, mailbox, Storage, caller or decorating. Under the
  top bar a strip says whose camp it is, with its likes (a heart and a count, pressed while the
  member likes it, named "Like" or "Liked"), "Next camp" (the next in the signpost's order last
  chosen, never the member's own, round from the last to the first) and "My camp"; under 560
  pixels the last two are their pictures alone and the name gives way. "Go" and "Next camp" walk
  straight on to the next camp. Their camp is read again every half minute, and as the tab comes
  back, but not once the member is walking off from it. The first time anybody likes the member's
  camp, the feed says so ("Mossback likes your camp."). Nothing to visit puts the page
  behind the kit's card, "No camp to visit", with "My camp".
- **The guild, live.** The same moments reach a camp, as each begins by Leaf's clock (`cue`, as in
  town: none from before the page was there): a line in the feed, a paper lantern going up
  beyond the trees (and over the clearing, where the far trees are out of sight) when a raid comes
  home, a pennant on the cabin roof for land taken, and whoever is there, pets included, hopping.
  The town carries on quietly meanwhile, so the party is gone or back and the banner is up when
  the member returns.

## What is in the Grove

The Grove (the standing stone among young redwoods, west of the quest board) is where the guild's
pulls are made. A tap on it, its E prompt and its dock button open its card ("Go in", and whose
banner is open until when); walking on into it goes straight in. Night closes in as on the way to
the camp, and lifts on the Grove's own picture, which takes the whole page; "Back to town" or
Escape goes back the same way. The picture is composed for a frame (640 by 360 art pixels, or 360 by
640 in an upright window) shown as large as the window allows, in the middle of the window's foot;
the clearing is painted on from the frame to the window's edges, and "Back to town", the Leaf,
Skip and the pools are at the window's top. An art pixel is seldom a whole number of device pixels, so the
picture is drawn enlarged by the next whole number up and the browser brings it down smoothly
(`fit` in `grovescene.ts`). The pulls are Leaf's (`@sequoia-leaf/pulls`): the page reads them on
each way in, draws Leaf's view, and sends `pull` and `exchange`. Who headlines the banners is asked
on each way in while Leaf has named nobody, and the pulls again when a banner is due to open or end.

- **The banner.** The first thing seen is the pool on show: a banner that is open and has a
  headliner (their figure from their own skin, their name, and when it ends), with the always-open
  pool, "Evergreen", on a tab beside it; with no such banner, Evergreen alone, with its three top
  figures standing in the clearing. Who a banner's headliner is comes from Leaf
  (`GET /v1/game/banners`), and nothing about them is in the page.
- **Pulling.** "Pull 1" and "Pull 10" say their price in Leaf and ask to be pressed twice. While a
  free pull waits, one pull is "Free pull". With too little Leaf, with Leaf's spending off, or for
  a guest, a button is shut and a press says why. Leaf takes the Leaf; the page only asks for the
  number again.
- **The ceremony** plays what Leaf answered. Night falls on the clearing, a drop of light lands on
  the path, a light for each pull rises among the trees and flares in its prize's colour, and the
  sky shows the best tier: green by day for filler, gold for mid, an aurora for top. Then each
  prize is shown in its tier's light: its own picture (a figure of the raid as the camp draws it,
  breathing once it is lit; a headliner walks in as the town's people walk), its name, its rarity
  in the rarity's colour, what it is, whether it is new, the
  Seeds it gave, and for a banner's top prize how its 50/50 fell. Ten pulls end on all ten set out
  in the clearing, the rarest in front. A filler prize gives way to the next by itself; at a
  mid-tier or top prize among several the ceremony's clock stands once its reveal is done
  (`timeline` and `ticked` in `pulls.ts`), the prize and the sky going on moving, until "Next", a
  tap on the picture or a key goes on. Skip (or a tap, Space or the right arrow) goes on to the
  next prize; held, to the end, past every wait. Every beat has its sound.
- **The count towards a top prize** is on the banner ("34 of 80"), and after a lost 50/50 the line
  under it names who the next top prize is.
- **The panel** has three tabs: every prize of the pool by rarity with its chance and how many of
  each the member has, with the rules in numbers written from the rules' own table (`RATES`)
  behind its "?"; the
  Seeds and each mid-tier prize they buy; and the last 200 pulls, among them the things and looks
  that pulls gave before they gave figures.

The Grove is in one state at a time (`groveState` in `pulls.ts`): arriving, at the banner, a
command sent and not yet answered, a ceremony, a ceremony's end, or leaving. A pull or an exchange is
sent only at the banner and at a ceremony's end, one at a time; whatever cannot be used in the state
is inert, and leaving is only from the banner, once the stage takes the walk. A button asking to be
pressed again asks for its own pool and count, and stops asking when the pool or the state changes.
What Leaf refuses is said in one line under the pools. A pull whose answer was lost on the way is
sent again with the same id (the kit's `play.ts`), so it is made once and shown when Leaf is reached.

## What Leaf keeps

The member's town and camp are Leaf's (`leaf.ts`, its rules in `packages/town`): the camp, its
mail, the crab's sightings, the days the chest last paid and the member was last welcomed, when
they were last here, how far their own news has been told, and whether their character stays. The
page opens it from Leaf, holds a copy to draw from, and sends what the member does as commands,
each thing named by its id. What the shared rules can work out (setting out, moving, turning,
putting away, a present taken, Storage looked in, a lantern lit, the mail read, the crab spotted,
a pet chosen, staying in town) is shown at once and sent; what only Leaf can answer (the letter
put away, a caller greeted, the chest, buying) is shown when Leaf answers, and nothing more is done
meanwhile. Where a thing taken out of Storage is set down is worked out by the page and checked by
the rules.
Whenever Leaf's town is not what the page shows, the page takes Leaf's and draws again. Every five
minutes while the page is in view, and as it is put away, the page tells Leaf the member is still
here. While a game is open over the town, the town tells Leaf nothing; it says the member is here as
the game opens and as they come back. Only view settings are kept in the browser: the sound, the newest note read.

Leaf and Coins are the kit's one purse (`@sequoia-leaf/kit/purse.ts`), shared with every game, and
both are Leaf's: the town asks Leaf for the Coins after a purchase or the chest, when a game in its
frame closes, and when its page comes back into view.

Trophies come from Leaf too: what the member wins in The Little Raid or builds in the Works is an
award Leaf keeps, and it goes into the camp's Storage; the feed says what was won.

## Where the guild comes from

Everything about the guild is asked for through `guild.ts` (answered by `live.ts`): who the
member is, what has just happened out in the guild, the quests and how far along they are, the
member's news since the town last told them any, which real members are in the game just now, and
which have gone in the last day and doze in town. The town's own, and what is for sale, are the
town's rules' (`folk.ts` and `catalogue.ts`, in `packages/town`).

## Opening

The town's front door is `open.ts`. It awaits the kit's `start()` before anything is read (the
kit's README says how it finds out where it is), opens the member's town from Leaf, fetches what
`live.ts` needs (their quests, their newest news for the week's counts, and their news since Leaf's
town says it was last told), and only then loads the town. If there is no Leaf, the member is
signed out or not let in, the server is in trouble, or the town Leaf keeps will not read, the kit's
card says so and the town is not loaded.

- **The member.** Their name, their rank as the guild writes it (capitalised; an unknown one as it
  comes; none at all is "Friend"), their level, and their own skin from `/v1/game/skins/<id>`
  (a made-up look until it loads). The week's counts come from their newest news.
- **Leaf.** The purse's Leaf is the guild's ledger's and changes only when the ledger does: a
  request bought at the Treasury is paid there, by the backend, and the purse shows the balance
  Leaf answers with.
- **The board.** The member's real quests, those open and those just finished: the title, the
  nearest goal's progress, the Leaf it pays, and for the timed one when it ends. They pay by
  themselves, so there is nothing to claim: a finished one says "Paid".
- **The member's news in the letter.** What happened to the member since the town last told them
  (raids with their Leaf summed, wars, quests finished, the level reached, milestones), each with
  the Leaf already paid. Where the news was told up to goes to Leaf's town (`cursor`) when the
  letter is put away and with each `here`, and moves on as the member's own news arrives while
  they are in town, so that the next letter does not tell it again. On a first visit it starts
  from the member's newest news, so the letter tells none of it.
- **The guild's news.** The town reads the guild's 50 newest events as it opens and listens from
  there. Members paid for the same raid at the same moment are one party, and it is staged from
  its own time by Leaf's clock, the same second on every page: it begins 6 seconds after Leaf wrote
  the first of them down (Leaf's stream looks every 2, so every page has heard). Nobody walks in
  for it: the town cheers 1.5 seconds in and the feed names them and the raid, and a lantern goes
  up in the tree 8.5 seconds in; it is over at 23 (`HOME`). Whoever of it is in town already (the
  member, live, busy at one of the games) hops where they are, and whoever dozes sleeps through
  it; nobody else of it is drawn. A page that opens in the middle puts everything where it is by then, and plays only what
  is still to come (`cue` in `game.ts`: what is seen or heard once is played at its moment of
  Leaf's clock, and not if the page was not there for it); one that opens after sees what it left.
  What it left is Leaf's to say, which has every event: with the newest events come how many
  raids and wars the guild finished in the UTC day, each once, by when each happened, and the last
  territory fought at, by when the war happened. The page adds what it hears after by the same
  rule (a raid or war it has not heard of is one more in the day it happened; a war that happened
  later is the last), so a page open all day and one just opened show the same. The tree holds
  one lantern for each raid today, the newest seven, each in the next place round it, and says
  how many there are; the banner is the last territory's, in its own colours, with a streamer for
  each war today. The feed says only what its events do: "Alice and Bob fought at Detlas.", never
  who won. A guest is given none of the guild's news, so sees none of this. A
  milestone is a line in the feed, and so is a level: the
  member's own always, anybody else's only at a multiple of five. The member is "You", and no line
  says how much Leaf anybody was paid (`news.ts` has every line). The feed takes these lines one at
  a time, twenty seconds apart, oldest first, and drops one that has waited five minutes; what
  happens in the world for them (the cheer, the lantern, the banner) does not wait.
- **The town and the camps, live** (`players.ts`, its rules in `motion.ts`). The page is in one of
  Leaf's live rooms at a time, the one for the place on the stage (`liveAt`): `town` in town, and in
  a camp that camp's own (`camp:<owner>`, the member's at home or anybody's they visit). The
  connection is made once (the kit's `joinLive`): going from place to place goes from room to room
  on it (`go`), the Grove steps out of every room, and nothing is opened again; with a game open (a
  page of its own) the connection is closed, and coming out opens it again. In a camp, whoever
  else is there is drawn as in town, with the camp's things, walking its ground, coming in off the
  trail behind the great tree as the member does; when the owner changes the camp, Leaf tells its
  room, and a visitor's page reads it again at once. The member's figure moves from their own input at once, as
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
- **The connection.** While it is down, the town plays on; once it has been down two seconds a
  small "Reconnecting…" sits by the purse, so that a blip is not announced, and after five seconds
  the others fade away until the room welcomes the page again. When Leaf restarts (a deploy) every
  page is told to come back at once, and they come back within a second or two in no order: whoever
  is not in the room yet when this page is welcomed into it stands where they were, in town as far
  as everything else on the page goes, for up to five seconds (`REJOIN_FOR`), and is the same figure
  when they are back, put where they are now; whoever is not back by then goes. Told the
  member opened the game live somewhere else, the kit's card "Playing somewhere else" says this
  page has let go of the town, with "Play here", which takes the room back; told their session has
  ended, the kit's "Signed out" card.
- **Who is here.** The town says where the member is (the town, the camp, the Grove, or nowhere
  while a game is open, which says its own place) and whether their character stays, and hears who
  else is in the game and who has gone in the last day and stays. It goes on asking every half
  minute in the live room too, though Leaf writes where the member is from the room, and at once
  whenever the room says who is where has changed: that answer is how it hears who rests and who is
  at the Works, the stump or the Grove. Where each person is, is worked out in one place
  (`where.ts`), one record for each by their id, from the live room and Leaf's list by Leaf's
  clock, and everything else reads it: "Who is about" and the number on its button, the figures in
  town and every card. Somebody Leaf last saw 90 seconds ago is gone from then on every page at
  once, as Leaf's own visits have them. Up to twelve of those in the game are about as visitors
  (`visitors.ts`) in their own skins, each at a spot of their own (`spots.ts`), busy at it in place:
  at the Works working at a crate beside them (hammering it, then lifting it and turning to us to
  look it over, setting it down and standing a moment, a round of 9 seconds of their own by Leaf's
  clock), at the raid table sitting at the stump over its board, in the Grove standing facing its
  stone while a soft light rises from it now and then; those in town are there live instead, and
  nobody drawn live, fading away included, is a visitor or a dozer as well. Nobody at their own
  camp. Each place has spots laid by hand (the Works five, along its front and by the crate pile,
  none on the bench, in the doorway or where the town's own stand at the door; the stump four round
  it; the Grove four before the stone), and past those further ones a step out, worked out once the
  town stands: on open ground, on top of nobody's spot, seat or post and of no thing's foot, and
  behind nothing that would hide them. A member's spot is the one their account wants among those
  laid by hand, or the next free one, and they keep it for as long as they stay; nobody is given a
  spot somebody has. They never speak, and their card has only their name and rank; a guest's says
  "Guest". Up to twelve of the others gone in the last day, most recent first, may doze on a seat (`dozing`): on
  a log at the fire, on the garden bench or the bench by the Works' door, or at the stump for
  somebody from the table; never the member's own, and nobody last at their camp. Each has a seat
  of their own, the one their account wants most, unless somebody gone longer wants it too, and
  whoever has none then takes a seat left over, gone longest first; so somebody coming or going
  moves nobody on a seat of their own. Nobody awake sits down on a dozer (`seatFree`), and a seat a
  player or one of the town's own sits on is passed over. Dozers have their eyes closed, a "z"
  drifting up every 2 seconds, and never speak or move. A visitor who goes stays on their feet in
  their spot until 120 seconds after Leaf last saw them (Leaf lists them as gone at 90, and by 120
  every page has asked), and is then on their seat if they stay and have one, or gone.

  **Nobody drawn from Leaf's list walks.** Only those who move their own figure (the member, the
  players live in town) and the town's own do. Somebody comes by fading in where they are put (in
  half a second, `FADE`), goes by fading out where they are, and is put somewhere else (from their
  spot to their seat, from one seat to another) by fading out there and then in at the new place.
  A list that changes often (somebody with the Works open on one page and the town on another) only
  ever fades them, never walks them about. Leaf keeps somebody in one place too: while a game's
  page of theirs keeps saying where they are, a town room on another of their pages does not take
  them out of the game (`apps/api/src/activity/visits.ts`); the town's page says it itself as they
  come out of a game, which moves them at once.

- **Who is about** (`aboutui.ts`, its rules in `about.ts`). A small wooden button beside the purse
  (under it where the screen is too narrow) with two heads and how many are in the game now, the
  member too, opens a panel that lists them: **In town**, everybody in the live room with the
  member, the member first and marked "you" (out of the room, whoever the guild says is in town); **Elsewhere**, in the game but not in town, "at the Works", "at the
  raid table", "in the Grove" or "in their camp"; and **Seen lately**, those gone in the last day who stay, newest
  first, with how long ago in the words the dozers' cards use ("3 hours ago"). Each has their
  face, name, and rank or "Guest"; the guild's lists say no ranks, so somebody never seen in the
  room has their rank only if they are a guest. A part with nobody in it is left out; with nobody
  but the member it says "Only you, for now." It keeps up with the room as it changes, and with the
  guild's lists as they come, every half minute. It is sorted when it is opened, and while it stays
  open its order holds (`held`): whoever has left a part stays listed in it, dimmed, with where they
  are now ("Guest · just now", "at the Works"), and whoever is new to the panel goes to the end of
  their part. It holds one row for each player, by id, so nobody is ever listed twice. Choosing somebody in town puts the panel away and
  shows where they are for three seconds: a ring at their feet and their name over them, the view
  staying where it is unless they would be out of it, when it glides to them and back. On an
  upright phone the panel is the bottom sheet the others are. The button is there only in town. A
  person's card shows how long they have played all games together and been AFK in them, what they
  stand at in the Works, The Little Raid and their camp (things set out, Coins spent, callers
  greeted, the crab spotted), and how long they have played each and been AFK in it, and for somebody else "Find in town" (somebody drawn
  here), "Visit yard" and "Visit camp" (somebody with one).

- **Away.** Somebody in the game who has done nothing for five minutes is away: Leaf's own rule,
  the one that counts their time AFK (`away` in `@sequoia-leaf/core`). Leaf's list says when each
  of those in the game last did something (`acted_at`), and the page takes it as later when it sees
  them move somewhere, emote or touch something in the room, which Leaf counts too; and Leaf tells
  every room when somebody away does something again. So they stop being away the moment they act,
  on every page. "Who is about" says it under their name ("Captain · away for 20 minutes", "at the
  Works · away for 5 minutes"), and so does their card in town, under their rank, with where they
  are when it is not the town ("At the raid table, away for 7 minutes"); nothing for somebody just
  about the town. In town they have sat down where they are and nodded off, as the dozers do: facing
  us unless they sat on a seat, eyes closed, a "z" now and then, the same moments on every page,
  wherever they are (in town live, or in their spot at the Works, at the stump or before the
  Grove's stone, their crate beside them at the Works); the moment they move or do anything they
  are up and about again. Nobody walking has the "z": somebody away on their way to their spot
  nods off once they are there.
- **A guest.** Somebody signed in who is not in the guild plays the same town, with none of the
  guild's own: `prepare()` fetches nothing, and nothing only a member may ask (`/v1/me...`, the
  guild's news) is asked. The purse shows only Coins and every Leaf button says "Leaf is earned by
  raiding with Sequoia."; the board holds one note ("Quests are for members of Sequoia. Raid with
  the guild and yours appear here."); the letter has no news of theirs;
  their card says "Guest of the guild" with no ranks and no week. Visitors and dozers who are
  guests look like anybody else, with "Guest" for a rank.

What each game says is waiting behind its door, and what is waiting in the Works' till, come from
the postcard each game leaves for the town (`games.ts`).

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

`main.ts` is a stage, and the town, the camp and the Grove are scenes on it. `main.ts` owns the
canvas, the camera, the keys and fingers, the loop, the walk from one place to another, and the way
into a game and back; everything else it asks of a `Scene` (`stage.ts`). Where the stage is, is one
value (`screen.ts`): a place played in, night falling on the member walking off, night lifting on
them walking in, or the view closing in on a game's door, the game open, and the view opening out.
Only `next` moves it, and `main.ts` does what each change means in one place: which scene is on,
where the member is said to be, the town's live room, the loop. Every way to go somewhere, from any
panel or button, is `hooks.go` (`game.ts`), which the stage answers: a walk off is taken whenever the
member may act, and one asked while night lifts turns into night falling from where it is. One camp
scene shows the member's own camp and anybody else's.

While a game is open the loop is stopped: nothing is stepped or drawn and nothing makes a sound,
and it picks up where it was when the game is put away. While the member is in a camp the town is
not stepped either; what the guild does meanwhile is applied to it without ceremony.

| File                                  | What it holds                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/open.ts`                         | The front door: who the member is, their town from Leaf, the guild's news, then the town        |
| `src/main.ts`                         | The stage: canvas, camera, keys and fingers, the loop, the walk between places                  |
| `src/stage.ts`                        | What the stage asks of a scene, and a scene of the stage                                        |
| `src/screen.ts`                       | Where the stage is, as one value, and the one function that moves it                            |
| `src/review.ts`                       | `window.town`: handles for the tours and the console, the town's own among them                 |
| `src/touch.ts`                        | What a tap, the pointer, the key and the member's feet mean, in the town and in a camp          |
| `src/townscene.ts`                    | The town as a scene: who is here, taps, getting about, going into games and to the camp         |
| `src/campscene.ts`                    | A camp as a scene: laying it out, who is there, taps, decorating, visiting                      |
| `src/grovescene.ts`                   | The Grove as a scene: Leaf's pulls, the ceremony's clock and its sound                          |
| `src/grovepicture.ts`                 | The Grove's picture: the banner, the tell, a reveal and the end picture, drawn from the time    |
| `src/grovestage.ts`                   | The Grove's clearing, painted with the town's painters in three lights                          |
| `src/groveui.ts`                      | The Grove's words and buttons, and its panel of prizes, Seeds and history                       |
| `src/pulls.ts`                        | What the Grove says and counts: a prize's name, a reveal's words, the chances, the rules        |
| `src/grid.ts`                         | Ground to walk on: which squares are solid, and the way round them                              |
| `src/world.ts`                        | The town's map: paths, pond, what is solid, where places are                                    |
| `src/leaf.ts`                         | The member's town and camp on Leaf: the copy, commands done at once or asked, keeping Leaf told |
| `src/town.ts`, `src/camptouch.ts`     | What each thing does when touched, and the parts that move                                      |
| `src/townart.ts`                      | The town built from its sprites, and its moving parts drawn each frame                          |
| `src/props.ts`                        | Things that stand and can be touched                                                            |
| `src/actors.ts`, `src/pets.ts`        | Walking, sitting, speaking; the town's own put where Leaf's clock has them; the pets            |
| `src/folkart.ts`                      | How each of the town's own is drawn (never a skin)                                              |
| `src/events.ts`                       | What of the guild's moments is played once, each at its time: the fanfare, the cheer, the line  |
| `src/draw.ts`                         | Drawing a frame of any place; name plates and speech; the round hole a door closes to           |
| `src/hud.ts`                          | The purse, corner, feed, dock, panel and cards, shared by both places                           |
| `src/ui.ts`, `src/campui.ts`          | The town's panels and arrival letter; the camp's panels and Storage                             |
| `src/signpost.ts`, `src/camps.ts`     | The ways between camps: the signpost, the strip's like and "Next camp"; Leaf's list of camps    |
| `src/mailbox.ts`                      | The mailbox: the letters, and who likes the camp and stayed in it                               |
| `src/cards.ts`                        | What camp things and stalls say about themselves, as kit cards                                  |
| `src/doors.ts`                        | A game in a frame: opening it, hearing it, the note when it will not open                       |
| `src/games.ts`                        | The games that are places, and what each says is waiting                                        |
| `src/guild.ts`, `src/live.ts`         | The questions asked of the guild, and the guild's server answering them                         |
| `src/news.ts`                         | The feed's line for each of the guild's moments, and their pace                                 |
| `src/visitors.ts`                     | Real members put where Leaf's list and clock have them: visiting, dozing, home from a raid      |
| `src/players.ts`, `src/motion.ts`     | The town and the camps live: in a room, everybody else drawn from it, emotes; its rules         |
| `src/crowd.ts`                        | Everybody in a place on top of one another drawn apart, as they meet and part                   |
| `src/apart.ts`                        | Back where the member stood after a reload; members on one spot drawn a step apart              |
| `src/aboutui.ts`, `src/about.ts`      | Who is about: the button and its panel; who goes in which part, and the words                   |
| `src/where.ts`                        | Where everybody else is, one record each, from the room and Leaf's list: what everything reads  |
| `src/spots.ts`                        | A spot of their own for each member busy at a game, kept while they stay; what they do there    |
| `src/letter.ts`                       | Putting the arrival letter together from Leaf's arrival and the member's news                   |
| `src/fx.ts`                           | Sparks, leaves and rising words                                                                 |
| `src/sprites.ts`, `src/ground.ts`     | The town's art                                                                                  |
| `src/campart.ts`, `src/campground.ts` | The camp's art: the cabin, every thing, the pets, the clearing's floor                          |
| `src/statues.ts`                      | Whose statue each banner's is: its name and its figure, from Leaf                               |
| `src/campsfx.ts`                      | The camp's own sounds                                                                           |

The catalogue of camp things (`things.ts`), what is for sale (`catalogue.ts`), the mailbox
(`mail.ts`), the town's own (`folk.ts`), what goes by Leaf's clock (`clock.ts`), a
camp's rules (`camp.ts`) and the town's commands (`game.ts`) are in `packages/town`, the rules Leaf plays the town by; the page imports them from
there and works out with them what it shows at once. `grid.ts`, `letter.ts`, `games.ts`, `live.ts`,
`news.ts`, `motion.ts`, `apart.ts`, `about.ts`, `where.ts` and `spots.ts` have no page in them, and tests beside them (`motion.test.ts`
plays Leaf's side of a live connection with the kit's stand-in socket); `folk.test.ts` also reads
every file of the three games to check that nothing but members is drawn from a skin,
`touch.ts` has tests for what a touch means, and `props.ts` for when a member is hidden and what
is left out of the thing in front.

## The games beside it

The games are pages of their own, served beside the town: `../works/index.html` and
`../battler/index.html`. A game speaks to the town with the kit's `shell.ts`: `ready` once it has
drawn, `leave` to come back, `news` for a line in the feed; the town says `closing` just before it
puts the game away. A game that has not said `ready` within a few seconds, or whose page is not
there, gets a note and a way back; one that says it later opens over the note.

## Looking at it from outside

`window.town` has handles for taking pictures of it: `about()` opens "Who is about", `found()` says
who chosen there is being shown, `skip(seconds)` runs the clock on, `hold(true)`
stops the clock so that only `skip` moves it, `enter()` puts the arrival letter away, `visit(place)`
and `open(panel)` open things in town, `tp(x, y)` moves the member in town, `walk(x, y)` walks them
to a point, `emote(kind)` makes an emote, `players()` says where everybody else in the live room
would be drawn this moment, `told()` what the room was last told of the member and when, `link()`
how the live connection is, `inside(game)` goes through a door, `door()` says how far that has
got, `leave()` comes back, `kept()` gives the town as the page shows it (Leaf's copy), `again()`
asks Leaf for it again (after staging something), `who()` says where each of the town's own is and
what it is doing and `crabs()` where each crab is and whether it is running off, both by Leaf's
clock at the moment they are asked (neither `skip` nor `hold` moves that clock; held, the picture
stays as it was last put), `visitors()` says which real members are in town, where, what each is
doing, whether they are dozing on a seat or nodded off in their spot, walking or carrying a crate, and the spot they have, `spots()` every spot at the games (laid by hand or further out), `board()` which hex each figure on the stump is on and whether
anybody is at it, and `moments()` how many lanterns hang, whose banner flies and the last cheers
played with when each was, all three by Leaf's clock too, `where()` says which place is on and how dark the walk has got, `purse()` says what the
purse holds, `page(x, y)` turns a point in the place that is on into a point on the page, and
`prompt()` says where the prompt is on the page while it is up.

`window.town.camp` is the same for camps: `go()` walks out of town to the member's camp, `town()`
and `home()` walk back, `greet(n)` touches the nth of whoever has dropped by, `walk("cabin" |
"mailbox" | "signpost" | "trail")` walks up to a place and uses it, `decorate(on)`, `take(id)` sets
a thing out of Storage, `grab(n)`, `dragTo(cx, cy)` and `drop()` move a thing by its id and by
squares, `hand()` says what is held and whether it may go where it is, `things()` (each with its
id), `pets()` and `guests()` say what is there, `pet(n)` touches one, and `choose(kind)` picks who
lives there first.

`window.town.grove` is the same for the Grove: `go()` goes in, `state()` says its state, the
ceremony's time, beats and waits and Leaf's view, `jump(t)` moves the ceremony's
clock (with `hold(true)`, a still of any moment), `pool(id)` shows a pool, and `again()` asks Leaf
for the pulls again.

`?sheet=big`, `?sheet=small`, `?sheet=ground` and `?sheet=sky` show the town's art on its own, and
`?sheet=camp` every camp thing with its name. `?zoom=2` draws a place smaller, to see more of it.

The step lists in `review/` drive the tours the screenshots came from, with the driver in
`packages/kit/tools/drive.ts`, against Leaf on this machine, from the repository's root:

```sh
sh apps/town/review/build.sh ~/play
bun apps/api/test/play.ts 4000 ~/play --dice 3
bun packages/kit/tools/drive.ts "http://127.0.0.1:4000/sign-in?return_to=http%3A%2F%2F127.0.0.1%3A4000%2Fplay%2Ftown%2F" <out-dir> apps/town/review/tour.json
```

Moments play does not reach quickly are staged through `POST /test/play/town` (`stage-town.ts`:
a new member's town, a lived-in camp, a Storage of many kinds, a caller waiting, a time away, a
full mailbox, Coins to shop with, prizes won). `tour.json` and `tour-phone.json`, each on a play
server just started, stage a new member's town with Coins and go from the arrival letter through
a stall, the camp's card, the camp with one new thing in Storage and then eleven (ten prizes
staged), Storage opened, a thing taken out and placed, one put away, a caller greeted, a present
taken out of its letter, and a Storage of sixty kinds scrolled, to a reload that finds the same
camp, at 1280x760 and 390x844. `second-page-b.json` waits in the camp while `second-page-a.json`, started
some twenty seconds later, puts a lantern out: the first shows the change at its next look at
Leaf. `about.json` and `about-phone.json` are "Who is about" at 1280x760 and 390x844 (with
`--crowd 6`): the button, the panel, somebody on the screen chosen, and somebody off it, the view
there and back. `doors.json` is the way into a game and the note when one is missing (built with
`standin`, which puts `review/standin/`, a page that only speaks to the town, where the Works would
be and leaves The Little Raid out), `gate.json` the town to the camp and back each of the four
ways, `reactions.json` the things that answer a touch, `arrive-phone.json` the arrival on a phone,
and `camp-things.json` (opened with `?sheet=camp`) the sheet of every thing. `reconnect.ts` (`bun
apps/town/review/reconnect.ts`) times the town's page coming back into its room after Leaf
restarts.
