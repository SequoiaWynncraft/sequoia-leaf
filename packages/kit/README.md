# The kit

The look and the plumbing every part of the guild's game shares, so the town and the games in it
read as one thing: dark plum surfaces in steps, pixel-art frames that say what a thing is, buttons
whose colour says what they do, two faces, one card for anything to explain itself, the tools for
drawing sprites in code, the member's character from their skin, the sounds, the one purse, and
finding out whether the game is being played on the guild's own server.

```html
<link rel="stylesheet" href="../../packages/kit/src/kit.css" />
```

```ts
import { amount, el, icon } from "@sequoia-leaf/kit/dom.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
```

An app that uses it lists `"@sequoia-leaf/kit": "workspace:*"` in its dependencies.
`demo/index.html` shows every piece on one page (`bun build demo/index.html --outdir demo/dist`).

## The look, in short

- **Units.** Everything is sized in `--u`, one art pixel of the interface: two CSS pixels, three on
  a very large window. Write sizes as `calc(var(--u) * n)` and frames stay on whole pixels.
- **Darkness has steps.** The world is the picture. Over it a panel is near-black plum
  (`--k-plum`), a well inside it darker (`--k-deep`), a raised thing lighter (`--k-mid`), and
  `--k-ink` is the edge of everything. The brightest things on a screen are the frame of what
  matters, the button to press and the title: a screenshot turned grey still shows those three.
- **Frames say what a thing is,** and are made of the town's own materials. A timber frame, pegged
  at its joints, with a brass bracket on each corner is a panel, its title on shingles over an
  eave. A thin board with a brass nail in each corner is a sign, hung on ropes in the top bar. A
  board under a row of tools is a shelf, parchment with a turned-up corner a note, a thin wooden
  rim a tip. Five tier frames are for things that have a tier: stone, jade, sapphire, amethyst,
  gold, with a jewel on each corner that grows with the tier and a crest on top from the third.
  On a small screen (760 pixels wide or less, or 500 high) ornament thins before what it holds
  does: a panel's frame is two units thinner, without pegs, and signs hang on no ropes.
- **A button's colour says what it does.** Gold confirms. Blue shows or hides. Green buys or
  grows, and spending Leaf is always the green button (`leaf`). Wood is the plain button. Coral
  leaves or removes. Slate is quiet. Only what can be pressed has a bevel: a tag is flat.
- **Colour means one thing each.** Gold is Coins and the button that confirms, green is Leaf and
  growth, coral is health and leaving. `--k-tier-1` to `--k-tier-5` are the tiers' colours.
- **Letters.** Every text is set in one of five styles, whole `font` values on `:root`, and no rule
  names a face, a size or a weight of its own (`type.test.ts` holds that). Four are Minecraft, the
  guild's pixel face and the page's own, for everything that is not a sentence: `--f-head` (bold,
  30 pixels) for a title (`k-title big`, a panel's or a card's), `--f-name` (bold, 20) for a name,
  a number, an amount, a chip or a button (`k-name`, `k-title`, `k-pix`, `b`), `--f-ui` (regular, 20) for everything else, and it is what a page has with no class at all: a row of a list, a line
  somebody says, the feed, a hint of a few words; and `--f-small` (regular, 10) for a word or a
  number where 20 pixels cannot fit or would shout: a label over a group (`k-label`), the line
  over a title, a price under a tool, a tag (`k-s`). The fifth, `--f-read`, is Inter at 14 pixels,
  for a sentence or more that is read: what a thing does, a letter, a note, the how-to (`k-read`,
  `k-d`, `k-tip`, a `p` on paper). Minecraft is drawn ten pixels to the em and is sharp only at
  whole multiples of ten, so it has those three sizes and no others (20, 30 and 40 on a very large
  window). Nothing is written in capitals, and text is not made smaller to fit: the layout changes.
  What is more important than what is beside it is bold, larger, or brighter (`--k-cream`,
  `--k-dim`, `--k-faint`, `--k-gold`). Words drawn on a canvas in the world are Minecraft too
  (`text.ts`; wait for `fontsReady()` first).
- **Paper stays paper.** A letter, speech and a lesson are cream paper with dark ink (`k-paper`,
  `k-say`): what a character hands over. The frames are the interface.
- **The town's own are marked.** Whoever lives in the game and is not a member (a keeper, a cat,
  a gnome, a regular at the battler's table) has its name in pale green with the small acorn
  before it: `folkName(name)` on a page, `acornPicture()` and `FOLK_COLOUR` beside letters on a
  canvas (`mark.ts`). A member's name is cream.

## The pieces (`src/kit.css`)

| Class                                                                                            | What it is                                                           |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `k-panel`, with `k-head` and `k-body`                                                            | The timber frame; its title is on shingles, an eave under them       |
| `k-plaque` (`hung`)                                                                              | A sign, for small things over the world; `hung`, on ropes (below)    |
| `k-shelf`                                                                                        | A row of tools or places standing on a board (a dock)                |
| `k-tier-1` to `k-tier-5`, with `k-crest` inside                                                  | A thing with a tier, in its tier's frame (below)                     |
| `k-card` (`lit`, `chosen`, `locked`, `done`)                                                     | A row or tile standing up from a panel; also works as a button       |
| `k-slot` (`lit`)                                                                                 | A hollow that holds one thing; as a button, one of a row to choose   |
| `k-paper`                                                                                        | A page: letters, notes; in a panel it hangs on a brass nail          |
| `k-say` (`left`)                                                                                 | Somebody speaking                                                    |
| `k-tip` (`k-float`)                                                                              | A one-line hint while pointing at a thing (`tip.ts` places it)       |
| `k-info` (`pinned`, `sheet`), `k-thing`                                                          | A thing's card, and the small picture of a thing (`card.ts`)         |
| `k-btn` (`blue`, `green`, `leaf`, `wood`, `coral`, `slate`, `plum`; `sm`, `icon`, `wide`, `off`) | A button; with no colour named it is gold                            |
| `k-tabs`                                                                                         | Wooden tabs on a rail; one is chosen (`aria-selected="true"`)        |
| `k-i k-i-<name>`                                                                                 | A pixel icon; `--s` makes it larger by whole steps                   |
| `k-cur` (`leaf`)                                                                                 | An amount of Coins or Leaf; on a button, what it costs               |
| `k-bar` (`leaf`, `coral`)                                                                        | How far along something is: `<div class="k-bar"><i style="--v:40%">` |
| `k-chip` (`lit`)                                                                                 | A small flat tag; a trait or a kind is a hexagon badge (below)       |
| `k-toast` (`leaf`, `coral`, `rose`, `alone`)                                                     | A line of news; `alone`, over the whole page at the top              |
| `k-title` (`big`), `k-name`, `k-pix`, `k-label`, `k-s`, `k-d`, `k-read`, `k-dim`                 | Words: titles, names, small labels and words, what a thing does      |
| `k-folk`                                                                                         | A name of the town's own (leaf green, the acorn first)               |
| `k-over`                                                                                         | Words written straight over the world, with a dark edge              |
| `k-scrim`, `k-rise`, `k-row`, `k-col`, `k-wrap`, `k-grow`, `k-scroll`                            | Laying things out                                                    |
| `k-shut`                                                                                         | The card a page shows instead of itself when it will not open        |
| `k-wait`                                                                                         | Asked of Leaf, which is taking more than a moment (`waitingLook`)    |

**A tier's frame** is drawn over what it holds, so a picture that fills the thing does not cut into
its jewels; that takes the thing's `::after`, so the thing must not scroll itself (put what scrolls
inside it) and is at least 18 units each way. `--k-fill` is what is behind it (the panel's plum with
a glow of the tier's colour at the top, unless said), and `--k-tier` is the tier's colour for
whatever inside wants it. `<i class="k-crest"></i>` inside a thing of the third tier or above is
its crest; in the first two it shows nothing.

**A panel's frame and a shelf's** are timber, which cannot stretch: each is laid behind the thing by
its two pseudo-elements, corners as fixed pieces and edges repeating from the top left
(`repeating` in `tools/frames.ts` writes those rules). So neither has a pseudo-element to spare,
and neither may scroll itself: put what scrolls inside it.

**A sign's frame and a tip's** are the same shape as the brass frame, which either wears when it is
to be picked out: `border-image-source: var(--k-f-brass)`. A sign with `hung` hangs from the top of
the window on two ropes and makes room for them above itself: `--k-hang` long (nothing on a small
screen), or `--hang` where a sign hangs under another. A sign that is a button dips when pressed.

**A card** that is `lit` glows warm in a gold edge (owned, ready); the one `chosen` of several (or
`aria-selected`, `aria-pressed`) has the gold doubled; `locked` lies flat and dark. A `div` with
`k-label` is a label over a group in a list and sits on a brass rule; a `span` is only small words.

**A chip** that starts with a canvas (a trait's or a kind's own picture) wears it as a hexagon
badge with its name beside it; `--c` on the chip is the badge's colour. Any other chip is a flat
tag.

The frames and icons are drawn in `tools/frames.ts` as rows of letters and written into
`src/frames.css` as small pictures (`bun run frames`); add a frame or an icon there. Nothing is a
picture file.

## The modules (`src/`)

| File          | What it holds                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `palette.ts`  | The colour ramps                                                                                    |
| `pix.ts`      | Pixel-art tools: rectangles, pictures typed as rows of letters, outlines, ellipses                  |
| `util.ts`     | Canvases, numbers, repeatable noise                                                                 |
| `text.ts`     | Words on a canvas in the font                                                                       |
| `signs.ts`    | A speech bubble and a key prompt drawn on a canvas, and breaking words into lines                   |
| `tip.ts`      | Tips: `tip(el, title, text)` shows a one-line hint on hover, focus and long press                   |
| `card.ts`     | Cards: how anything in any game says what it is (below)                                             |
| `mark.ts`     | The mark of the town's own: a name in leaf green after the acorn, on a page or a canvas             |
| `skin.ts`     | A walking figure and a face from a block-game skin sheet, or from a made-up look                    |
| `sound.ts`    | Small sounds made from tones and hiss; `sfx` is the shared set, one mute for all                    |
| `dom.ts`      | `el`, `icon`, `amount`, `when` (draws a part again only when it changes) and a few more             |
| `purse.ts`    | Leaf and Coins, shared by every page of the game: both Leaf's, only shown                           |
| `pursebar.ts` | The purse as a page shows it, its numbers rolling; things that fly across it; a closed Leaf button  |
| `shell.ts`    | How a game that is a place in the town and the town speak to each other                             |
| `postcard.ts` | What a game leaves for the town to read about it while nobody is in it                              |
| `net.ts`      | Everything asked of the world outside the page: the server, storage, the address                    |
| `live.ts`     | Where the game is being played, who the member is, and the cards for when it is shut or let go of   |
| `play.ts`     | A game Leaf owns: its state from Leaf, commands to it, holding off, a waiting look while it answers |
| `keep.ts`     | Keeping view settings in the browser, or in the tab only                                            |
| `presence.ts` | Telling the server where in the game the member is, and hearing who else is about                   |
| `realtime.ts` | Being in a live room on Leaf: who is there, and where each is to be drawn now (`joinLive`)          |
| `emotes.ts`   | The emotes others see (wave, cheer, laugh, heart): their pictures, for the page and a canvas        |
| `standin.ts`  | A stand-in server, storage and live connection (`FakeSocket`) for tests; no page loads it           |

With a mouse, Chromium makes no click when what a press began on is replaced before the release, so
nothing is drawn again under a held mouse button: `when` waits for its next call after the button
lifts, and `unheld(fn)` (which `refresh()` uses) for the tick after the click.

A button that spends asks to be pressed again (`pressedTwice(key, redraw)`, drawn with `asking` and
`asksAgain`). The second press must be a new one: a key that was down at the first and has not come
up since (a held Enter saying itself again, `keys.ts`) does not make it. `unask()` stops the button
waiting at once, as four seconds left alone do.

`tools/drive.ts` drives a built page in headless Chromium and takes screenshots; its header says how.

## Cards

Anything shown or named in any of the games explains itself the same way, in `card.ts`.

**What a game gives it.** Each kind of thing is registered once, `register(kind, describe)`, where
`describe(id)` gives a description or null; from then on a thing is named by a reference,
`"kind:id"` (`"item:gear"`, `"trait:ember"`). A description has a `name` and, all optional, an
`icon` (a canvas, fitted to its slot by whole steps, or a kit icon), a `tag` under the name (read
as a sentence if it ends with a stop), an
`aside` at the right of the head (a price, stars), `chips` (labelled, each optionally a
reference, and optionally a `hint`: a tip on it saying what it means), `stats` (label and value,
three to a row, each optionally `raised` or `lowered`; with a text among them, a heading, they
are a sheet instead, a line each with the number at the right),
`blocks` (a bold title, a note at its right, words in the reading face; `line` puts them on one
line, `lit` picks one out), `rows` (a small label and things, as icon and name, as
pictures only, or as tiles; each may be lit, tagged, counted, given a note, locked with what opens
it, or drawn as "this, an arrow, that") and `actions` (buttons, shown only on a pinned card).

**How a thing becomes a target.** An element: `link(el, ref)`; with `{ acts: true }` for one that
does something of its own when clicked (buys, picks up), and `{ side: true }` for a card to its
side. `thing(ref)` is the standard small picture of a thing, icon and name, already linked: lists
of things are built from it. Something drawn on a canvas: the game hit-tests and calls
`point(ref | null, x, y, w, h)` as the pointer moves and `pick(ref | null, x, y, w, h)` on a click
or tap; `surface(canvas)` tells the cards a press there is the game's to read.

**How it behaves.** With a mouse, resting on a target shows its card beside it (above, else below,
else to a side, kept on screen); leaving hides it; a click pins it, and a click on it again, a
click elsewhere, its close button or Escape puts it away. With a finger a tap pins it (a long
press, on a target that acts) as a sheet along the bottom, above the game's own bar (each game sets
`--sheet-floor` to that bar's height); a tap elsewhere puts it away. Every pinned card has a close
button in its head, and the town puts any card away as it goes through a door. A thing named
inside an open card is followed instead: its card takes the place, with a back arrow. One card is
up at a time. The keyboard: a focused target shows its card and Enter pins it. While the game
drags something it calls `hold(true)`, and no card opens until `hold(false)`; `show(ref)` still
shows what letting go would do. `watch(fn)` tells a game what is pointed at and what is pinned;
`refresh()` draws the card again from a fresh description (under a held mouse button, once it
lifts), and `settle()` puts it back beside its target after the page has been laid out again. A
passing card, like a tip, goes when its target leaves the page or, unless the keyboard's focus
showed it, when the mouse is on something else, even if the target was drawn again under the mouse
and never had a `pointerleave` (`goesWith` in `tip.ts`).

The rules of all that (`Deck`, `partsOf`) touch no page and are tested in `card.test.ts`.

## Live, on the guild's server

Every page plays on the guild's own server (Leaf), and awaits `start()` (`live.ts`) before anything
else. It asks `GET /v1/game/hello` on the page's own origin: anything but its answer means there is
no Leaf, and the page shows `serverCard(line)` in its own words. With Leaf it asks
`GET /v1/game/me`:

- **Known.** The game is live, as that member. The purse's Leaf is the number the server gives
  (`fromLedger`) and nothing else: a page never takes Leaf itself. Only a game's command on Leaf
  takes Leaf: `leafOpen()` is true while hello's `leaf_spending` is (`leafSpending`) and the member
  is not a guest, and a page offers such a command only then; after one, it asks for the Leaf
  number again (`refreshLeaf`). Every other Leaf button is passed to `closeLeaf`, which always
  shows it closed, with the tip "Leaf spending opens after the play-test." while spending is off
  and "Leaf cannot be spent here yet." while it is on. A page that is the whole window listens to
  the member's own events (`followLeaf`) and asks for the Leaf number again whenever one arrives;
  the town asks too when a framed game closes.
- **Coins**, for a member or a guest alike, are Leaf's Coins ledger's (`fromLeaf`, with
  `/v1/game/me`'s `coins`), and nothing of them is kept in the browser. The games' commands pay and
  take them on Leaf. `refreshCoins()` asks Leaf for the balance again (one question at a time, once
  more if asked meanwhile): a game does when a command of its paid or took some, the town when a
  framed game closes and when its page comes back into view (`followCoins`). The town tells a game
  in its frame of a change to its Coins (`passCoins`, the shell's `{ town: "coins", coins }`), and a
  game shows a change it worked out itself at once (`heardCoins`) until Leaf answers. An answer
  asked for before such a change is let go, since it may not hold it.
- **Known as a guest** (`guest: true`: signed in, not in the guild). The game is live, as them,
  with no Leaf (`asGuest`): `leafShown()` is false, so no page shows a Leaf number, and every Leaf
  button's tip is "Leaf is earned by raiding with Sequoia." (`leafShut()`). `followLeaf` and
  `keepLeaf` listen to nothing, and no page asks `/v1/me...` or the guild's news.
- **Signed out (401).** The whole window goes to the `sign_in` address the server gave, with its
  own address on the end, and comes back. Refused again within a minute (the time it went is kept
  in the browser), or in a frame, it shows the "Signed out" card instead.
- **Not a member (403)**, from a server that lets in only members (the guild's own lets in guests),
  or **trouble (5xx, no answer)**: a card says so, with one button.

The cards are `shutCard`: a `k-paper` with a title, a line and one button, in place of the page.

**Games Leaf owns** (`play.ts`). A game on Leaf's play service keeps nothing of itself in the
browser: `openPlay(game, reader, { player })` fetches its state (`GET /v1/game/play/<game>`), read
into the game's own types by `reader` (a page built for older rules than Leaf's loads again), and
`send(command, predict)` gives the command an id, queues it and returns at once, with a promise of
Leaf's answer: what it did (the game's notes) or the code it was refused with. Commands go in
order, one request at a time, as many as are waiting in each (up to 32), and after a network
failure, or Leaf having trouble or asking to slow down, the same request goes again with the same
ids, so nothing is done twice; a request unanswered after ten seconds (`DEADLINE`) is let go and
counts as no answer. Each batch carries `player`, who the page believes it is; on
`not_you` (signed in as somebody else since) nothing more is sent and the page loads again. A state
Leaf cannot read (`state_unreadable`) stops the page with `unreadableCard()` ("Your game could not
be read. It has been kept; tell the guild."), sending nothing again. A 404 `not_found`, from a Leaf
without the play service during a deploy, is "not yet": the call goes again each second for 30
seconds (`NOT_YET`) before the page gives up for no server. As the page is hidden or put away,
what Leaf has not answered goes in a request that outlives the page. A page in view reads its state
after a minute without a call (`STILL_HERE`), so its copy is never long behind Leaf's, and as it
comes back (`outside.wake`), but for a game answered short, which asks for its own reads; a visit
does neither, nor does a page while `away()` (the town, while a game is open over it). Leaf counts a
player's time from where they are and what they do (`presence.ts`, the live rooms, their commands),
not from these.
`predict` is the copy after a command the shared rules can work out
without Leaf, shown at once; each answer's state takes the copy's place (with what is still waiting
worked out again on top), and `onState` tells the page when that is not what it was showing.
`refresh()` asks for the state again, one question at a time; its answer is let go if a command
was sent meanwhile, as that command's answer is newer. What ends the page at the opening (signed
out, a state Leaf cannot read, nothing to visit) ends it here too, told to `onTrouble`; any other
failure is let go, for the page to ask again. A game whose page keeps a copy of its own
(the Works) is answered short (`reader.short`): a batch's answer is not the state, `onAnswer` gives
it to the page with each command and its answer, and only a read takes the copy's place;
`refresh(differs)` says the tick at which the page found its copy not to be Leaf's, which Leaf
logs. A command only Leaf can answer is shown when Leaf answers, and `makeHold()` is the one rule for
holding off meanwhile: its answer may change what a later command means, so nothing more is done
until it comes, but a purchase may follow a purchase. `waitingLook(element, answer)` gives what was
asked for the waiting look (`k-wait`) once Leaf has taken more than 150 ms.

**Who is here** (`presence.ts`). A live page says where the member is (`here("town" | "camp" |
"works" | "table")`) every half minute and at once when it changes. Whether their character stays
in town after they go is the town's to say, from Leaf's town (`stay(on)`, told at once when it is
news); a page that has not been told says nothing of it, and Leaf keeps what it had. The answer, everybody
seen lately and those gone in the last day who stay (`Resting`, with when each was last seen),
goes to whoever `hearPresent`s. Each says whether they are a guest. Each call says too what the
page is on (`device()` in `live.ts`: a phone when its window was under 700 CSS pixels wide at
sign-in, else a desktop), for the staff's record of who played. While the page is in a live room of
the place it is at (`realtime.ts` says so at each welcome), the room keeps where the member is, and
the half-minute call only asks who is about (`GET`); a change of staying is still told. The room
says whenever who is where changes (`about`), and the page asks at once (`askAgain`), as it does at
each welcome. Answers are taken in the order they were asked for: one that comes after a later one
is dropped. Everybody listed says when Leaf last saw them (`seen`).

**Live** (`realtime.ts`). `joinLive(room, ears)` puts the player in one of Leaf's live rooms (the
wire and the rooms are in `@sequoia-leaf/core`'s `live.ts`) and keeps them there: the connection
is opened into the room (`livePath`, with the page's `device`), and after a drop it connects again
and says where the player is again. It waits a quarter of a second, then half (half to begin with
when Leaf said it is restarting, 1012), then a second each time for the first thirty seconds, two
for the next minute and five after that, each with up to a quarter more by chance (`retryAfter`).
When the page is shown again, gains focus or the network comes back (`wake` in `net.ts`), a try
waiting its turn goes at once, though never within a second of the last; an open connection is
pinged at once instead. An open connection on which nothing has come from Leaf for fifteen seconds,
with a ping out unanswered for five (`silent`), is closed and opened again. A browser cannot see why
a connection would not open, so after three tries in a row that did not, and every fifth after
that, it asks `GET /v1/game/me`: signed out (401), it lets go as below; anything else, or no
answer, and it keeps trying. Why a connection closed is its close code alone: told the player
opened the game live elsewhere, or their session ended, it lets go (`status("replaced")`,
`"signedout"`) and shows nobody any more. Each
connection learns the room afresh (who is there, their tracks, Leaf's clock), and its picture
replaces the old one only at its welcome, so nothing of one connection is mixed with another's.
`ears` hear the roster on each `welcome`, who `joined` and `left`, and each `act` (one of core's
`ACTS`). The page says where its player is with `move(step, jumped)` as often as it likes: it goes
at most 20 times a second and only when it changed; starting, stopping and a jump at once, even
with a move waiting its turn (`sendIn`), and the last change always. Each frame the page asks
`sample(id)` where somebody is to be drawn: their motion 100 ms behind Leaf's clock (learnt from
pings, by the quickest), between the snapshots either side, going on for up to 200 ms past the
newest while they were moving, and never on the way across a jump. Without Leaf it opens
nothing, and nobody is ever there. Drawing the others is the page's.
Once a connection has let go for good, `letGoCard(why, signIn, again)` puts the
kit's card for it over the page, which plays on beneath: "Playing somewhere
else" with "Play here" (`again`, to take the room back), or the "Signed out"
card, whose button goes to sign in.

All of it reaches the server through `net.ts`, which tests replace with `standin.ts`; the tests
read the server's own contract files (`contracts/leaf-api-v1.json`, `contracts/leaf-game-v1.json`).
