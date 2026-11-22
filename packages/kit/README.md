# The kit

The look and the plumbing every part of the guild's game shares, so the town and the games in it
read as one thing: the Minecraft font and a reading face beside it, the dusk palette, one card for
anything to explain itself, wooden frames and buttons drawn as pixel
art, the tools for drawing sprites in code, the member's character from their skin, the sounds, the
one purse, and finding out whether the game is being played on the guild's own server.

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
  a very large window. Write sizes as `calc(var(--u) * n)` and frames and letters stay on whole
  pixels.
- **Letters.** Two faces. The Minecraft font is for names, titles, numbers, buttons, chips and
  small capital labels: it is drawn ten pixels to the em, so it is sharp at ten units and soft at
  anything in between. Use `--t-m` (the usual size) for nearly everything, `--t-l` and `--t-xl`
  for titles and `--t-s` for small capital labels (`k-label`); `k-name` is a thing's name, bold
  and gold. Words that are read (a line about a thing, a role, a tip, a note) are in Inter, the
  face the guild's website sets its body text in, at `--t-r` (14 pixels at the usual size):
  class `k-read`, with `b` inside it bold. The second line under a name (`k-d`), a tip's words,
  somebody speaking (`k-say`) and a page's paragraphs (`k-paper p`) are in it already; inside
  them a title, label, chip, button or amount keeps the pixel font, and `k-pix` asks for it.
  Avoid other sizes. On a canvas, `text.ts` writes in the pixel font; wait for `fontsReady()`
  first.
- **Colours.** `palette.ts` holds the ramps, and the stylesheet has the same colours as `--k-…`
  variables. Art is drawn from these and nothing else; light comes from the upper left, and every
  sprite has a one-pixel dark edge.
- **Leaf is green.** Spending Leaf is always the green button (`k-btn leaf`) and Leaf amounts are
  always the pale green, so the precious currency is never spent by surprise.
- **The town's own are marked.** Whoever lives in the game and is not a member (a keeper, a cat,
  a gnome, a regular at the battler's table) has its name in that pale green with the small acorn
  before it: `folkName(name)` on a page, `acornPicture()` and `FOLK_COLOUR` beside letters on a
  canvas (`mark.ts`). A member's name is cream (`k-member` on a title).

## The pieces (`src/kit.css`)

| Class                                                                 | What it is                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `k-panel`, with `k-head` and `k-body`                                 | The big wooden frame; its title sits on a band of roof shingles      |
| `k-plaque`                                                            | A thin wooden edge for small things over the world (purse, dock)     |
| `k-card` (`lit`, `done`)                                              | A row or tile standing up from a panel; also works as a button       |
| `k-slot` (`lit`)                                                      | A hollow that holds one thing; as a button, one of a row to choose   |
| `k-paper`                                                             | A page: letters, notes, anything read like a sheet                   |
| `k-say` (`left`)                                                      | Somebody speaking                                                    |
| `k-tip` (`k-float`)                                                   | A one-line hint while pointing at a thing (`tip.ts` places it)       |
| `k-info` (`pinned`, `sheet`), `k-thing`                               | A thing's card, and the small picture of a thing (`card.ts`)         |
| `k-btn` (`wood`, `plum`, `leaf`, `coral`, `sm`, `icon`, `wide`)       | A button on its lip; gold is the main action                         |
| `k-tabs`                                                              | A row of buttons where one is chosen (`aria-selected="true"`)        |
| `k-i k-i-<name>`                                                      | A pixel icon; `--s` makes it larger by whole steps                   |
| `k-cur` (`leaf`)                                                      | An amount of Leaf or Coins                                           |
| `k-bar` (`leaf`, `coral`)                                             | How far along something is: `<div class="k-bar"><i style="--v:40%">` |
| `k-chip` (`lit`)                                                      | A small tag                                                          |
| `k-toast` (`leaf`, `coral`, `rose`, `alone`)                          | A line of news; `alone`, over the whole page at the top              |
| `k-title`, `k-name`, `k-label`, `k-d`, `k-read`, `k-pix`, `k-dim`     | Words: titles, names, small labels, second lines, reading, pixel     |
| `k-folk`, `k-member`                                                  | A name of the town's own (leaf green, the acorn first); a member's   |
| `k-over`                                                              | Words written straight over the world, with a dark edge              |
| `k-scrim`, `k-rise`, `k-row`, `k-col`, `k-wrap`, `k-grow`, `k-scroll` | Laying things out                                                    |
| `k-shut`                                                              | The card a page shows instead of itself when it will not open        |

The frames and icons are drawn in `tools/frames.ts` as rows of letters and written into
`src/frames.css` as small pictures (`bun run frames`); add a frame or an icon there.

## The modules (`src/`)

| File          | What it holds                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `palette.ts`  | The colour ramps                                                                                   |
| `pix.ts`      | Pixel-art tools: rectangles, pictures typed as rows of letters, outlines, ellipses                 |
| `util.ts`     | Canvases, numbers, repeatable noise                                                                |
| `text.ts`     | Words on a canvas in the font                                                                      |
| `signs.ts`    | A speech bubble and a key prompt drawn on a canvas, and breaking words into lines                  |
| `tip.ts`      | Tips: `tip(el, title, text)` shows a one-line hint on hover, focus and long press                  |
| `card.ts`     | Cards: how anything in any game says what it is (below)                                            |
| `mark.ts`     | The mark of the town's own: a name in leaf green after the acorn, on a page or a canvas            |
| `skin.ts`     | A walking figure and a face from a block-game skin sheet, or from a made-up look                   |
| `sound.ts`    | Small sounds made from tones and hiss; `sfx` is the shared set, one mute for all                   |
| `dom.ts`      | `el`, `icon`, `amount` and a few more for building the interface                                   |
| `purse.ts`    | Leaf and Coins, shared by every page of the game and kept in step between them                     |
| `pursebar.ts` | The purse as a page shows it, its numbers rolling; things that fly across it; a closed Leaf button |
| `shell.ts`    | How a game that is a place in the town and the town speak to each other                            |
| `postcard.ts` | What a game leaves for the town to read about it while nobody is in it                             |
| `net.ts`      | Everything asked of the world outside the page: the server, storage, the address                   |
| `live.ts`     | Where the game is being played, who the member is, and the cards for when it is shut or let go of  |
| `cloud.ts`    | Keeping what the games keep on the member's account, when the game is live                         |
| `keep.ts`     | Writing the game into the browser; a page that has let go of it (`stopped()`) writes none of it    |
| `presence.ts` | Telling the server where in the game the member is, and hearing who else is about                  |
| `realtime.ts` | Being in a live room on Leaf: who is there, and where each is to be drawn now (`joinLive`)         |
| `emotes.ts`   | The emotes others see (wave, cheer, laugh, heart): their pictures, for the page and a canvas       |
| `standin.ts`  | A stand-in server, storage and live connection (`FakeSocket`) for tests; no page loads it          |

`tools/drive.ts` drives a built page in headless Chromium and takes screenshots; its header says how.

## Cards

Anything shown or named in any of the games explains itself the same way, in `card.ts`.

**What a game gives it.** Each kind of thing is registered once, `register(kind, describe)`, where
`describe(id)` gives a description or null; from then on a thing is named by a reference,
`"kind:id"` (`"item:gear"`, `"trait:ember"`). A description has a `name` and, all optional, an
`icon` (a canvas, fitted to its slot by whole steps, or a kit icon), a `tag` under the name, an
`aside` at the right of the head (a price, stars), `chips` (labelled, each optionally a
reference, and optionally a `hint`: a tip on it saying what it means), `stats` (label and value, three to a row, each optionally `raised` or `lowered`),
`blocks` (a bold title, a note at its right, words in the reading face; `line` puts them on one
line, `lit` picks one out), `rows` (a small capital label and things, as icon and name, as
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
click elsewhere or Escape puts it away. With a finger a tap pins it (a long press, on a target
that acts) as a sheet along the bottom with a close button; a tap elsewhere puts it away. A thing
named inside an open card is followed instead: its card takes the place, with a back arrow. One
card is up at a time. The keyboard: a focused target shows its card and Enter pins it. While the
game drags something it calls `hold(true)`, and no card opens until `hold(false)`; `show(ref)`
still shows what letting go would do. `watch(fn)` tells a game what is pointed at and what is
pinned; `refresh()` draws the card again from a fresh description, and `settle()` puts it back
beside its target after the page has been laid out again. A passing card whose target leaves the
page goes with it.

The rules of all that (`Deck`, `partsOf`) touch no page and are tested in `card.test.ts`.

## Live, on the guild's server

The same pages play with a made-up guild anywhere, and as a real member when the guild's own
server (Leaf) serves them. Every page awaits `start()` (`live.ts`) before anything else. It asks
`GET /v1/game/hello` on the page's own origin: anything but its answer means there is no server,
and nothing below happens. With a server it asks `GET /v1/game/me`:

- **Known.** The game is live, as that member. The purse keeps a ledger from then on
  (`fromLedger`): its Leaf is the number the server gives and nothing else, `grant` does nothing,
  `spend("leaf", …)` refuses, and `leafOpen()` is false. Every Leaf button is passed to
  `closeLeaf`, which shows it closed with the tip "Leaf spending opens after the play-test." A
  page that is the whole window listens to the member's own events (`followLeaf`) and asks for
  the Leaf number again whenever one arrives.
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

**Saves** (`cloud.ts`). What the games keep is text in the browser under a few names; `SLOTS`
says which slot on the server each name belongs to (`purse`, `town`, `works`, `raid`). The
sound setting and each game's view settings are in none, and stay in the browser. Before a page
reads anything it `pull`s its slots, which writes the server's copy into the browser; if the
browser last held another member's game (or nobody's), the names in every slot are cleared
first. After that the page looks once a second for changed text, and sends a changed slot at
most every five seconds, with the version it last read and the time it changed (`saved_at`). On
a conflict it fetches the slot and keeps whichever was saved later. On the town's `closing`, when
the page is put away or hidden, it runs whatever the page asked to run first (`before`) and sends
at once. With the made-up guild none of this fetches anything.

Every page writes what it keeps through `keepText` (`keep.ts`), never straight into storage.
Once a page has pulled, each write first makes sure the browser's game is still its member's.
When another member's page has taken the browser over (or the server answers `not_you`), the
page stops (`stopped()`) before it loads again, and writes nothing more, not even as it goes, so
nothing it still holds lands under the other member's names. A test in `keep.test.ts` holds
every file in the kit and the games to this.

**Who is here** (`presence.ts`). A live page says where the member is (`here("town" | "camp" |
"works" | "table")`) and whether their character stays in town after they go (`stay(on)`, true
until told otherwise), every half minute and at once when either changes; the answer, everybody
seen lately and those gone in the last day who stay (`Resting`, with when each was last seen),
goes to whoever `hearPresent`s. Each says whether they are a guest. Each call says too what the
page is on (`device()` in `live.ts`: a phone when its window was under 700 CSS pixels wide at
sign-in, else a desktop), for the staff's record of who played. While the page is in a live room of
the place it is at (`realtime.ts` says so at each welcome), the room keeps where the member is, and
the half-minute call only asks who is about (`GET`); a change of staying is still told.

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
newest while they were moving, and never on the way across a jump. With the made-up guild it
opens nothing, and nobody is ever there. Drawing the others is the page's.
Once a connection has let go for good, `letGoCard(why, signIn, again)` puts the
kit's card for it over the page, which plays on beneath: "Playing somewhere
else" with "Play here" (`again`, to take the room back), or the "Signed out"
card, whose button goes to sign in.

All of it reaches the server through `net.ts`, which tests replace with `standin.ts`; the tests
read the server's own contract files (`contracts/leaf-api-v1.json`, `contracts/leaf-game-v1.json`).
