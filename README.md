# sequoia-leaf

The service behind Leaf, the Sequoia guild currency, and the game built on it.
Members earn Leaf from guild activity such as raids and wars, and spend it.

It is one Bun process with a SQLite database file, written in TypeScript with
[Effect](https://effect.website). Bun is the whole toolchain: runtime, package
manager, formatter (`bun fmt`), type checker (`bun check`), test runner and the
SQLite driver, which the code reaches through Effect's SQL client
(`@effect/sql-sqlite-bun`). Linting is oxlint with type-aware rules.

## Status

Live at `https://leaf.seqwawa.com` since 16 November 2026, on the Sequoia
server. It reads sequoia-backend's player credit feed every minute, pays Leaf
and XP for raids and wars, runs quests on top of them, and pays Leaf for each
level a member reaches: a tenth of the XP the level took. Signed-in members
can read their balance, level and quests. There is no way to spend Leaf yet
and there are no staff endpoints.

It also serves the guild's browser game, Guild Town, at `/play/town/`, and the
routes only the game uses. Anyone signed in may play it: members, and guests
who are not in the guild. The game shows a member's Leaf; no route lets it
spend or pay any, and a guest has none.

## Getting started

```sh
mise install     # install the pinned bun
bun install
bun run verify   # format check, lint, typecheck and test
bun fmt          # format everything
bun run dev      # run the server at http://localhost:3000, restarting on changes
```

The server is configured with environment variables:

| Variable                      | Default                    | What it is                                              |
| ----------------------------- | -------------------------- | ------------------------------------------------------- |
| `PORT`                        | `3000`                     | The port to listen on.                                  |
| `DATABASE_PATH`               | `data/leaf.db`             | The SQLite file. It is created when missing.            |
| `BACKUP_DIR`                  | `backups` beside the file  | Where snapshots of the database are written.            |
| `BACKEND_URL`                 | `https://api.seqwawa.com`  | sequoia-backend, for the credit feed and session check. |
| `BACKEND_INTERNAL_TOKEN`      | none                       | sequoia-backend's `APP_INTERNAL_API_TOKEN`.             |
| `SIERRA_URL`                  | none                       | Sierra's internal API, for the awards feed.             |
| `LEAF_RATES_WEBHOOK_URL`      | none                       | A Discord webhook where Leaf keeps its rate card.       |
| `BACKUP_S3_ENDPOINT`          | none                       | The S3 endpoint snapshots are copied to.                |
| `BACKUP_S3_BUCKET`            | none                       | The bucket there.                                       |
| `BACKUP_S3_ACCESS_KEY_ID`     | none                       | A key that may write to that bucket.                    |
| `BACKUP_S3_SECRET_ACCESS_KEY` | none                       | Its secret.                                             |
| `PUBLIC_ORIGIN`               | `https://leaf.seqwawa.com` | The origin Leaf's own pages are served from.            |
| `PUBLIC_DIR`                  | none                       | The built game pages to serve under `/play`.            |
| `GAME_SIGN_IN_URL`            | see below                  | Where the game sends a member to sign in.               |
| `GAME_LEAF_SPENDING`          | `false`                    | Whether the game may offer to spend Leaf.               |

Without `BACKEND_INTERNAL_TOKEN` the server answers requests but does not read
the credit feed, which is what local development wants. Without `SIERRA_URL` it
does not read the awards feed, and achievement milestones pay nothing. Without
`LEAF_RATES_WEBHOOK_URL` it keeps no rate card in Discord. Without all four
`BACKUP_S3_*` variables, snapshots stay on the machine. Without `PUBLIC_DIR`
there is no `/play` and nothing at `/`; the image sets it.

`PUBLIC_ORIGIN` must be an `http` or `https` origin with nothing after the
host and port, such as `https://leaf.seqwawa.com`; anything else stops the
server at start with an error that names the variable but not its value.

`GAME_SIGN_IN_URL` defaults to the website's sign-in,
`https://api.seqwawa.com/auth/web/start?return_to=`; the game adds its own
address after `return_to=`. Only `GET /v1/game/hello` reads `GAME_LEAF_SPENDING`.

## Layout

| Path                  | What it is                                                           |
| --------------------- | -------------------------------------------------------------------- |
| `packages/core`       | The rules of the game as pure functions and types. No I/O.           |
| `apps/api`            | The server, on Effect: the HTTP API, database and feed syncs.        |
| `apps/api/migrations` | The database schema, as Effect migrations applied in order at start. |
| `apps/town`           | Guild Town, the browser game's home screen.                          |
| `apps/works`          | The Works, a game in the town.                                       |
| `apps/battler`        | The Little Raid, a game in the town.                                 |
| `packages/kit`        | What the town and its games share: look, sound and plumbing.         |
| `Dockerfile`          | The production image, with the game's pages built into it.           |

## How Leaf is earned

sequoia-backend records raids and wars. Its `/internal/player-credits` endpoint
lists who took part in each one. The server reads it on a schedule:

- Every minute it reads the events since its last run, once they are 30 seconds
  old, and records each player's part as an activity together with the Leaf it
  pays. The rates are in `packages/core/src/rules.ts`.
- At minute 17 of every hour it re-reads the last week instead, to pick up
  credits that appear late, such as a war scored afterwards or a name matched
  to a player afterwards.

Each credit carries the backend's event id and the player's UUID, so reading
the same events again pays nothing twice. Nothing that happened before the
first run is ever credited.

A raid pays each member for their share of the party's season rating, which
the backend works out: the rating the guild message reports, divided by the
number of members it names, rounded down. Until 2026-11-19 it gave every member
the whole party's rating; see [Correcting raid shares](#correcting-raid-shares-2026-11-19).

### Achievement milestones

Sierra, in sequoia-backend, runs the guild's achievement ladders and records an
award when a member reaches a milestone. Its `/internal/v1/achievements/awards`
lists them, and the server reads it on the same schedule as the credit feed.

Only what members do for the guild pays: the raid ladders, which count guild
raids, and the guild war ladder. Each tier pays its own amount, from 250 Leaf
for Bronze to 20,000 for Mythril, set in `packages/core/src/rules.ts`.
Profession, role and badge ladders pay nothing. Each award pays once, keyed by
Sierra's award id, and milestones reached before the feed's first run pay
nothing.

## Quests

Every member has three quest slots. The templates and rewards are in
`packages/core/src/rules.ts`.

- **Daily.** One becomes available each UTC day, and up to three bank up, so
  playing every third day loses nothing. Finishing one starts the next banked
  one at once. There are no streaks.
- **Weekly.** One per week, Monday to Monday in UTC. It expires with the week.
- **Timed.** The same quest for the whole guild, open for two hours from 00:00,
  04:00, 08:00, 12:00, 16:00 and 20:00 UTC, so there is a two-hour gap between
  them. It pays more than a daily for less time to do it in. The timed
  templates take turns in a fixed order, so two windows in a row never share one.
  The first window opened at 04:00 UTC on 19 November 2026; none comes before it,
  even for an activity reported late.
- **Repeatable.** Finishing one unlocks the next. Off for now: the default rules
  have no repeatable templates, and the ones open when timed quests began were
  dropped. Nothing counts toward them, even an activity reported late.

A member can **reroll** their daily or weekly: swap the quest in progress for a
different one from the same slot. Each slot's first reroll of the UTC day is
free and each one after costs 100 Leaf (`reroll` in `rules.ts`). The new quest
counts from the moment of the reroll and ends when the old one would have; the
old one's progress is lost, and a raid or war from before the reroll that is
counted late counts toward neither. A rerolled daily is the same banked daily.
Finished quests and timed quests, which the whole guild shares, can't be rerolled.

A quest asks for one or two of these. Most ask for two, raids or wars, as in
"Complete 3 NOL raids or 9 wars", so raiders and warrers can both finish them.
Each keeps its own progress, and whichever is met first finishes the quest. A
war goal asks three wars for each raid the quest is worth, because a war takes
about a third of a raid's time.

| Objective       | Example                    | What counts                                                  |
| --------------- | -------------------------- | ------------------------------------------------------------ |
| `raids`         | "Complete 2 raids"         | Every raid, or only one named raid ("Complete 3 NOL raids"). |
| `wars`          | "Take part in 2 wars"      | Every war the member took part in.                           |
| `season_rating` | "Earn 1,000 season rating" | Each war's season rating, and their share of each raid's.    |

A quest counts the activities the credit sync records, in the same database
transaction that records them, and a finished quest pays its Leaf and XP in
that transaction too. Between activities and rerolls nothing is written: what a
member sees is calculated from their last stored state.

## API

Responses are JSON with `snake_case` fields. Errors are `{ "code", "message" }`,
including 404 `not_found` for a route that does not exist and 500
`internal_error` for a failure nothing expected, which is logged with its
cause. The one exception is a body sent with a `Content-Type` other than JSON,
which gets a plain 415.

A route reads at most 16 KiB of a request's body, and answers a longer one
with 413 `body_too_large` without reading it; only saves may be longer (see
[The game's routes](#the-games-routes)). The server itself takes no body over
1 MiB.

Every answer carries `X-Content-Type-Options: nosniff`, so browsers never take
it for another type than the one it was sent as. Every answer but the game's
pages, the JSON, the skins and the streams, also carries
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`: a
browser that opens one loads and runs nothing with it, and no page may frame
it (`API_POLICY` in `apps/api/src/http/headers.ts`).

The routes are declared once, as an Effect `HttpApi` in
`apps/api/src/api/api.ts`, with the shape of every answer and error in
`schemas.ts` and `errors.ts` beside it. The server implements that declaration,
and `GET /openapi.json` serves the OpenAPI document generated from it.

| Route                            | What it returns                                            |
| -------------------------------- | ---------------------------------------------------------- |
| `GET /healthz`                   | `{ "status": "ok" }`                                       |
| `GET /v1/me`                     | The signed-in member's Leaf, XP and level.                 |
| `GET /v1/me/quests`              | Their quests, banked dailies and recently finished quests. |
| `POST /v1/me/quests/{id}/reroll` | Swaps one of their quests for another.                     |
| `GET /v1/me/events`              | What happened to them recently, oldest first.              |
| `GET /v1/me/events/stream`       | The same events as they happen, as server-sent events.     |
| `GET /openapi.json`              | This API as an OpenAPI document.                           |

The game has routes of its own under `/v1/game/`; see [The game's routes](#the-games-routes).

`/v1/me` and `/v1/game` routes take a Sequoia session, the token
sequoia-backend issued, in one of two ways:

- **`Authorization: Bearer`**, as the mod sends the one it already holds for the backend.
- **The website's cookie, `seq_session`**, as a browser sends it. The website
  sets it for the whole `seqwawa.com` domain when a member signs in, so it
  reaches Leaf's own pages too. A request with the cookie whose method is not
  `GET` or `HEAD` must carry an `Origin` header equal to `PUBLIC_ORIGIN`, or it
  gets 403 `bad_origin` and changes nothing: another site can make a browser
  send the cookie, but not with Leaf's origin. Leaf sends no CORS headers, so
  only its own pages can read its answers.

A request with both is let in by its Bearer header when that would let it in on
its own, and is otherwise judged by the cookie alone. Either way, the server
asks sequoia-backend who the session belongs to, and remembers a confirmed
session for a minute (up to 2,000 sessions). `/v1/me` lets in only current
guild members (and website admins), and refuses anyone else with 403
`not_a_member`. `/v1/game` lets in anyone signed in: whoever is neither a
member nor an admin plays as a guest (see [The game's routes](#the-games-routes)).

A request that carries the `seq_session` cookie more than once gets 401
`unauthorized`, Bearer header or not, and the backend is not asked about it. A
browser sends two when another `seqwawa.com` site has set a cookie of that
name beside the website's, which could sign the game in as someone else;
signing in on the website again sets things right.

Each quest in `/v1/me/quests` lists its `goals`, every way to finish it, each
with its own `type`, `raid`, `title`, `progress` and `target`. Its `objective`,
`progress` and `target` repeat the goal nearest to being met, for clients that
show one bar.

Each quest in its `quests` also has `reroll_leaf`: what rerolling it costs now,
0 when it is free, or null when it can't be rerolled.

`POST /v1/me/quests/{id}/reroll`, with the quest's `id` such as `daily:4` and
the body `{ "leaf": n }`, the `reroll_leaf` the member was shown and agreed to
pay, first counts what was just played, as `?sync=1` does, so a quest just
finished is paid rather than swapped. It answers `{ "leaf", "spent", "quest" }`:
the balance after it, what it cost, and the new quest in the shape `quests`
uses. A body without a whole `leaf` of 0 or more gets 400 `invalid_cost`. It
refuses with 409 and one of these codes, changing nothing:

- `not_current`: that quest is no longer in its slot. It was finished or
  swapped since, or the same request was sent twice.
- `not_rerollable`: a finished or timed quest.
- `cost_changed`: rerolling it costs something other than `leaf` now, such as
  after another reroll of the slot today. Leaf never charges more, or less,
  than the member agreed to.
- `insufficient_leaf`: the balance doesn't cover the cost.

Its `timed` says when the open timed quest ends (`ends_at`, null between
windows) and when the next one opens (`next_at`).

`GET /v1/me/quests?sync=1` reads the credit feed first, at most once every 15
seconds, so a raid that just finished shows up without waiting for the next
scheduled run.

### The contract clients test against

`contracts/leaf-api-v1.json` holds what the routes above answer for one member
after a day of play: raids, a defence, a war, a milestone, a level, finished
quests and a reroll. `apps/api/test/contract.test.ts` makes those calls on the
real routes and fails when the answers differ from the file, so the file is
always what Leaf sends, including the order of each list.

Clients test against a copy of the file instead of answers written by hand,
which is how the mod once read `GET /v1/me/events`, oldest first, as newest
first. After changing what a route sends:

1. `cd apps/api && WRITE_CONTRACTS=1 bun test test/contract.test.ts` writes it again.
2. Copy it to the mod's `src/test/resources/contracts/leaf-api-v1.json` and run
   the mod's tests, which read it.

CI's `contract-copies` job compares the file with the copy on Sequoia-mod's
`main` and fails while they differ, so merge the mod's copy with or before the
change here.

The game's routes have their own file, `contracts/leaf-game-v1.json`, written
by `apps/api/test/game-contract.test.ts` from one member's day of play with
another member, the same way. No other repository keeps a copy, so changing it
needs no change elsewhere first: `cd apps/api && WRITE_CONTRACTS=1 bun test
test/game-contract.test.ts` writes it again. It has every answer except the
skin, which is a picture.

### Events

An event is something a client would want to show when it happens. Each one is
written in the same transaction as the change it reports, and has an id that
only grows.

| Type               | When                        | `data`                                                                                     |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------ |
| `leaf_earned`      | A raid or war paid Leaf.    | `source`, `leaf`, `xp`, `detail`, `occurred_at`, and for a war `in_claim`                  |
| `quest_completed`  | A quest finished and paid.  | `quest`, in the shape `/v1/me/quests` uses                                                 |
| `quest_rerolled`   | The member swapped a quest. | `replaced` and `quest`, the old and the new, and `leaf`, what it cost                      |
| `level_up`         | XP reached a new level.     | `level`, and `leaf`, what the levels reached paid                                          |
| `achievement_paid` | A milestone paid Leaf.      | `award_id`, `ladder`, `milestone`, `tier`, `threshold`, `label`, `leaf`, `xp`, `earned_at` |

`detail` is the raid's name or the territory fought over. `occurred_at` is when
the raid or war was played, which can be well before the event: a credit that
appears late is paid, and reported, when it appears. `in_claim` is `true` for a
war over a territory in Sequoia's claim, a defence, which pays twice as much per
war point; `false` for an FFA war or a snipe; and left out when the backend
could not tell.

`GET /v1/me/events` answers `{ "events": [{ "id", "type", "created_at", "data" }] }`,
oldest first. With `?after=<id>` it lists up to 100 events after that id; without,
the newest 50. Ids only grow, so a client that orders events itself should order
them by id.

`GET /v1/me/events/stream` is a server-sent event stream. Every message has
the event's id as `id`, its type as `event`, and the same JSON object as above
as `data`. To show a pop-up when a quest completes, keep this stream open and
react to `quest_completed`.

- A client that sends no position gets only what happens from then on.
- The stream opens with a frame that has only an `id`, the position it starts
  from, so a client whose stream ends before any event arrives still knows
  where to resume.
- A client that reconnects sends the last id it saw as the `Last-Event-ID`
  header, or as `?after=<id>`, and first gets everything it missed. Browsers'
  `EventSource` does this by itself.
- The server closes a stream after 15 minutes. Reconnect the same way; this is
  when the session is checked again.
- A member may have six streams open at once, this one and the guild's
  (below) together. Opening a seventh closes their oldest.
- A stream carries a comment line every 20 seconds to keep the connection
  open. Ignore lines that start with `:`.

### The game's routes

| Route                              | What it returns                                                       |
| ---------------------------------- | --------------------------------------------------------------------- |
| `GET /v1/game/hello`               | Where to sign in, and whether Leaf may be spent. Needs no session.    |
| `GET /v1/game/me`                  | The player, their rank, Leaf, XP, level, and their newest event's id. |
| `GET /v1/game/saves`               | The player's saves: each slot's version and when it was written.      |
| `GET /v1/game/saves/{slot}`        | One save, with what it holds.                                         |
| `PUT /v1/game/saves/{slot}`        | Writes one.                                                           |
| `GET /v1/game/skins/{uuid}`        | A player's skin sheet, as a PNG.                                      |
| `GET /v1/game/guild/events`        | What happened across the guild, oldest first.                         |
| `GET /v1/game/guild/events/stream` | The same as it happens, as server-sent events.                        |
| `PUT /v1/game/presence`            | Says where in the game the player is; lists who is there and resting. |

Every one but `hello` takes a session, as above, and lets in anyone signed in,
member of the guild or not. Someone who is neither a member nor a website admin
plays as a **guest**: they have saves, skins and presence like a member, but no
Leaf, XP, quests or news, and the guild's events (and their stream) refuse them
with 403 `members_only`. The mod's routes, `/v1/me` and those under it, still
let in only members.

`GET /v1/game/hello` answers `{ "sign_in", "leaf_spending" }`: `GAME_SIGN_IN_URL`
and `GAME_LEAF_SPENDING`. A page that gets it knows it is on a live server.

`GET /v1/game/me` answers `{ "player": { "id", "username" }, "rank", "guest",
"leaf", "xp", "level", "event_cursor" }`. `rank` is the member's guild rank as
the guild writes it, such as `Captain`, or null for a guest or a website admin
who is not in the guild. `level` is as `/v1/me` has it. `event_cursor` is the id
of the member's newest event, 0 when they have none, from which to read
`/v1/me/events?after=` on their next visit. For a guest, `guest` is true,
`leaf` and `xp` are 0, `level` is a new member's and `event_cursor` is 0, and
nothing is read from the ledger or the events: a former member's old Leaf is
not shown to them while they are a guest.

**Saves.** Each player has a save in each of four slots, `purse`, `town`,
`works` and `raid` (`SAVE_SLOTS` in `packages/core/src/saves.ts`). A save is a
JSON object of at most 256 KiB as JSON text; Leaf stores it as it comes and
reads nothing in it. It is not the ledger: one row per slot, overwritten in
place, with no history. Each save records whether a guest wrote it; whenever
any save is written, guests' saves not written for 90 days are removed.
Members' saves are never removed.

- `GET /v1/game/saves/{slot}` answers `{ "slot", "version", "updated_at", "data" }`,
  or 404 `no_save` for a slot never written.
- `PUT /v1/game/saves/{slot}` takes `{ "player", "version", "data" }`, where
  `player` is the id of the member the page believes it is (from
  `/v1/game/me`), and `version` is the version last read, 0 for none. A save
  whose `player` is not the session's member gets 409 `not_you` and changes
  nothing: the page was left open as someone else, and should load again. It is
  written only while `version` is still the stored version, as the next one,
  and answers `{ "version", "updated_at" }`. Otherwise it gets 409
  `version_conflict` and changes nothing: read the save again. A write that
  would be taken, but comes less than 2 seconds after the slot was last
  written, gets 429 `slow_down` and changes nothing: send it again in a few
  seconds. A slot that is
  not one gets 400 `invalid_slot`; a body that is not a save, or `data` that is
  not an object, 400 `invalid_save`; a save over 256 KiB, 413 `save_too_large`.
  A body over twice that is not read at all.

**Skins.** `GET /v1/game/skins/{uuid}` takes a Minecraft UUID with or without
dashes, or gets 400 `invalid_uuid`. It serves only the skins of players Leaf
knows: the player asking, anyone with an account in the ledger, and anyone
whose game said where they were in the last day, guests too (see Presence). Any other
player gets 404 `no_skin`, and Mojang is not asked about them.

Leaf asks Mojang's session server for the player's profile and fetches the
skin it names, but only from `textures.minecraft.net/texture/<hex>`, over HTTPS
(Mojang writes these addresses with `http:`). Each request to Mojang has five
seconds. A skin must be a PNG of at most 64 KiB whose header says it is 64 by
64 pixels, or 64 by 32 as older skins are; Leaf keeps and serves its bytes up
to the end of its last chunk, and nothing after them. Requests for one player
that arrive together share one fetch.

Leaf keeps the skin in the database for a day; when Mojang can't be reached,
it serves the one it kept, however old. A player in a default skin, one Mojang
does not know, or one whose skin Leaf has never been able to get gets 404
`no_skin`. After Mojang had no skin for a player, or could not be asked, Leaf
does not ask about them again for an hour. Each time Leaf keeps a new skin, it
removes those nobody asked for in 30 days. A skin is sent with
`Cache-Control: private, max-age=86400`.

**The guild's events** are the events above of every member, read from the
same table, of three types only, with what they paid cut out:

| Type               | `data`                                                     |
| ------------------ | ---------------------------------------------------------- |
| `leaf_earned`      | `source`, `detail`, `occurred_at`, and `in_claim` if known |
| `level_up`         | `level`                                                    |
| `achievement_paid` | `label`, `tier`                                            |

Each is `{ "id", "type", "created_at", "player": { "id", "username" }, "data" }`.
`GET /v1/game/guild/events` lists the newest 50, or with `?after=<id>` up to 200
after that id. The stream behaves exactly as the member's own does, from where
it starts to when it closes, and counts toward the same six. All open guild
streams are fed by one look at the database every two seconds, not one each.
Raid party members' events share a `detail` and an `occurred_at`.

A member's name is the one the backend gave when they last opened
`/v1/game/me` as a member, or else the one Mojang gives. Leaf asks Mojang only about
players it knows, as for skins. It keeps the names it learns, and each time it
learns a new one, removes those nobody asked for in 30 days. An event whose
member no one can name yet, because Mojang can't be reached, is left out.

**Presence.** `PUT /v1/game/presence` takes `{ "place", "stay" }`: `place` is
one of `town`, `camp`, `works` and `table`, and `stay`, true or false and true
when left out, says whether the player's character may stay in town, dozing,
for a day after they go. Anything else gets 400 `invalid_place`. It records
both, with whether the player is a guest, and answers `{ "present": [{ "id",
"username", "place", "guest" }], "resting": [{ "id", "username", "place",
"guest", "seen_at" }] }`: `present` is the 50 seen most recently of everyone
whose game said where they were in the last 90 seconds, the player included,
in name order; `resting` is those last seen between 90 seconds and a day ago
whose `stay` was true, newest first, at most 24. A game that says where it is
less than 5 seconds after it last did is answered the lists, but nothing is
written. Players not seen for a day are forgotten.

### Live: players in the same place, as it happens

`GET /v1/game/live?v=2&room=<kind>` (`livePath` in core) is a WebSocket into a
room. Players in the same room see each other move as it happens, and see who
comes, goes and does what. Anyone the game's
routes let in may open it, members and guests alike. The wire is
`packages/core/src/live.ts`, shared by Leaf and the game; the server is
`apps/api/src/live`; the game's side is `packages/kit/src/realtime.ts`.

**Players, not connections.** Leaf keeps who is in which room by player, in one
place (`Live`), and a connection is only the way through to them. A player's
second connection (another tab, another device) takes over their place and
closes the first; nobody else sees them go. A player whose connection drops
stands still where they were for ten seconds, and keeps their place if they come
back in that time; otherwise they leave. Their allowances are the player's too,
and Leaf keeps them until they have filled up again, so neither reconnecting
nor leaving refills them. Moves come only from the player's present connection,
in the order it sent them.

**Opening it.** The session comes as the cookie or a Bearer header, checked as
for the game's routes. With the cookie, the request must carry `Origin` equal to
`PUBLIC_ORIGIN`, though it is a `GET`: a page on another site can open a
WebSocket to Leaf, and the browser would send the cookie with it. Before the
upgrade it is refused as the API refuses: 401 `unauthorized`, 403 `bad_origin`,
503 `identity_unavailable`, 400 `unsupported_version` (no `v`, or another),
`unknown_room` (no `room`, or not one of `ROOMS`) or `not_websocket`; 429 `slow_down` for a player who opens connections too often
(ten at once, then one every ten seconds, each counted); and 503 `live_full` past
1000 players. A player's place among them is taken, and held, before the socket
is opened, so that no two can take the last one. Once it is open, it becomes the
player's connection and puts them in the room in one step: Leaf's `welcome` is
the first thing it says, and nothing of any room reaches it before. A connection lasts only as long as its session: Leaf asks about it
again every 30 seconds (as every request does, through the minute it remembers
a confirmed session), and closes it as signed out once it has ended.

**Frames.** Binary frames carry motion, little-endian:

| Frame    | From | Bytes               | Holds                                                                                                                 |
| -------- | ---- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Move     | game | 23                  | `1`, `seq` u16 (counting up, wrapping), then a motion: `x`, `y`, `vx`, `vy` f32, `facing`, `pose`, `flags`, `jump` u8 |
| Snapshot | Leaf | 15, and 24 a player | `2`, `tick` u32, `time` f64 (Leaf's clock, ms), `count` u16, then per player `id` u16, `seq` u16, a motion            |

Motion is state: each frame is all of where a player is, and only the newest
counts. Positions are in the room's units and kept inside it; speeds are kept
below 1024 a second. `flags` bit 0 says the player is moving. `jump` counts the
times they did not walk where they are, so that the game draws them there at
once, not on the way, whenever it changes: the game counts its own player's
(a door, being set down), and Leaf counts what everybody else is shown, one up
whenever the game's count changes and at the first move of each new connection
(which may count from anywhere). The other bits of
`flags`, `facing` and `pose` are the game's, passed on as they come. Leaf sends
a room's snapshot once a tick, only when somebody's motion changed, with only
those who changed, made once and sent to everyone in the room.

Text frames are JSON with a `t`:

| From | `t`       | Holds                                                                                                              |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| game | `join`    | `room`: moves to a room of that kind on the open connection, leaving the other; in one of that kind, greets again. |
| game | `leave`   |                                                                                                                    |
| game | `act`     | `kind` and `arg`, one of `ACTS` in core (an emote: `wave`, `cheer`, ...). Nothing else is passed on.               |
| game | `ping`    | `c`: the game's clock.                                                                                             |
| Leaf | `welcome` | `v`, `you` (the player's number in the room), `room` (with its copy: `town/1`), `hz`, `time`, `roster`             |
| Leaf | `joined`  | `member`: `{ id, player, name, rank, guest }`                                                                      |
| Leaf | `left`    | `id`                                                                                                               |
| Leaf | `act`     | `id`, `kind`, `arg`                                                                                                |
| Leaf | `pong`    | `c` as it came, and `s`: Leaf's clock                                                                              |
| Leaf | `error`   | `code`: `unknown_room`, `not_in_room` or `bad_act`                                                                 |

A `welcome` is followed at once by a snapshot of everybody's motion, so a
newcomer sees where everyone already is. A player whose name or rank changed
since they came in (their new connection says so) leaves and comes back, so that
everybody sees them as they are. Actions come only from a list so that
nothing a player types, not even a word spelt out, reaches anybody else.

**Rooms.** `ROOMS` in `packages/core/src/live.ts` lists the kinds, each with its
size and how many fit in one copy (the town: 512 by 352, 32). A player is put in
the first copy with space, or a new one (`town/2`); a copy closes when its last
player leaves. Rooms live in memory, in the one process.

**Limits.** No frame over 4 KiB (Bun closes the connection, 1009). Text frames
over 512 characters are not read. A player may send 30 moves a second (bursts of 40),
8 texts a second (20), and 3 actions a second (6); more is dropped, as is
anything that cannot be read, and a player who keeps it up (200 such frames,
forgiven at one a second) has the connection closed. A client a megabyte behind
is cut off by Bun; Bun pings every connection, and one silent for a minute is
closed. Nothing is compressed.

**Closing.** Why a connection closed is its close code, and nothing else
(`CLOSE` in core):

| Code | Why                                                         | The game                   |
| ---- | ----------------------------------------------------------- | -------------------------- |
| 1000 | The game closed it.                                         |                            |
| 1008 | It sent too much Leaf could not read, or too much too fast. | Reconnects.                |
| 1009 | A frame over 4 KiB.                                         | Reconnects.                |
| 1012 | Leaf is stopping, as in a deploy.                           | Reconnects in a moment.    |
| 4001 | The player opened the game live somewhere else.             | Does not reconnect.        |
| 4003 | The player's session ended.                                 | Does not, until signed in. |

When Leaf stops, every connection is closed with 1012 before the HTTP server
stops: production and the tests both serve Leaf with `serveLeaf` in `app.ts`,
which puts the live rooms' farewell on top of the server. The game reconnects to
the new container after half a second or so, joins its room again, and says where
its player is again, as a jump.

Once a minute while anybody is about, Leaf logs a `live` line: players, how many
are connected, who is in which room, and how many frames came in and were dropped.

**What it is not, yet.** Positions are the game's to say, inside the room:
right for walking about together, never for anything that pays or wins. Fights
and rewards will need commands Leaf checks and outcomes Leaf decides. A room is
found by its kind; camps and tables will need copies addressed by who they
belong to, and a moment the whole town sees (a pull at the tree) will need to
reach every copy of the town. One process holds every room; a second would need
each copy owned by one of them. A change to the wire goes with a new
`LIVE_VERSION`, and pages built for the old one need a way to load again.

**How long it takes.** From a player moving to another player seeing it: up to
50 ms waiting for the game's next send (starting, stopping and jumping go at
once), the network there, up to 33 ms waiting for Leaf's tick, the network back,
and then the 100 ms the game draws others behind Leaf's clock, which absorbs the
network's unevenness. `bun apps/api/test/live-load.ts [players] [seconds]` runs
the real app with that many players walking about the town at the game's pace,
and times every move from its sender to each other player receiving it (not to
the screen). On the development machine, with the server and every player in one
process: 32 players, every move seen by all 31 others, 17 ms at the median and
35 ms at worst, 15 KiB a second to each player; 128 players in four copies of
the town, 19 ms and 38 ms, 19% of one core for everything.

## The game's pages

When `PUBLIC_DIR` is set, the server serves its contents under `/play`, with
`index.html` for a directory, and `GET /` sends the browser to `/play/town/`.
The town frames its games from `/play/works/` and `/play/battler/`, beside it.
A path that is not a file there gets the JSON 404 like any other.

Every page and file there is sent with a `Content-Security-Policy` that lets it
load and frame only what Leaf serves, talk only to Leaf, and be framed only by
Leaf's own pages; it allows the pages' inline styles, pictures drawn in the
page, and the font built into their styles. A `<base>` may point only at Leaf,
a form may be sent only to Leaf, and no plugin content loads (`PAGE_POLICY` in
`apps/api/src/http/pages.ts`). The pages themselves are sent with
`Cache-Control: no-cache`, and their scripts and styles, whose names carry a
hash of what they hold (`index-<hash>.js`), are kept for a year. Which of the
two a file gets is decided by its path alone, never by the query.

The `Dockerfile` builds the three apps with `bun build index.html --minify`,
each into `/app/public/<app>`, in a stage of its own, and the image sets
`PUBLIC_DIR=/app/public`.

### Trying the game on this machine

```sh
for app in town works battler; do (cd apps/$app && bun build index.html --outdir /tmp/play/$app --minify); done
bun apps/api/test/play.ts 4000 /tmp/play
```

This runs the real app at `http://127.0.0.1:4000/play/town/`, on a database in
memory, with the tests' stand-ins for the backend, Sierra and Mojang, so nothing
leaves the machine. It first plays a day: a member called Tester raids, wars,
finishes and rerolls quests, reaches a level and a dozen milestones, beside four
other members who raid and war with them and on their own. Two of the four are
then in the game (Birchwood in town, Mossling at the table) and stay so, and
two left a while ago and doze in town (Fernhollow three hours ago, Quillon
forty minutes ago, last at the Works). Pebblefoot, who is not in the guild, is
in town too, as a guest. Birchwood and Pebblefoot are in the town's live room
as well (`/v1/game/live`), walking about it: Birchwood round the square, and
Pebblefoot from spot to spot.

- The cookie `seq_session=tester` is Tester's session; any other, or none, is
  signed out. `/sign-in?return_to=<address>` sets it and goes back, as the
  website's sign-in does, and it is the `sign_in` that `hello` gives.
  `/sign-out?return_to=<address>` clears it.
- `PUBLIC_ORIGIN` is `http://127.0.0.1:4000`.
- `--guest`: Tester is signed in but not in the guild, so they play as a guest.
- `--down`: the backend can't be asked who Tester is, so they answer 503.
- `--busy`: every minute a few of the four finish a raid together, for the guild's news.

## Rules the code is built on

1. **Leaf moves only through the ledger.** Every change to a balance is one
   row in `ledger_entries`, written with `postEntry`. Nothing else writes to
   `accounts`; a database trigger keeps it equal to the sum of the entries.
2. **The ledger is append-only.** Mistakes are corrected with a reversal entry,
   never by editing or deleting.
3. **Every write names the fact it records.** An idempotency key identifies the
   real-world event, such as one raid completion for one player, so a retry or
   a repeated report can never pay twice.
4. **Leaf is a whole number.** Use the `Leaf` type for amounts.
5. **A player is a Minecraft UUID.** Use `PlayerId`. Usernames and Discord IDs
   can change; never use them as keys.
6. **Numbers that tune the game are data, not code.** Rates, prices and odds
   live in one place, not as literals scattered through handlers.
7. **Error responses are `{ "code", "message" }`.** Clients branch on `code`.
   JSON field names are `snake_case`, as in the other Sequoia services.
8. **Trust comes from the server.** Never credit Leaf on the word of a game
   client alone.
9. **Rules live in `packages/core`, I/O lives in `apps/api`.** Anything that
   decides an amount, an outcome or whether an action is allowed is a pure
   function in `core`, with a test beside it. The `apps/api` tests run against
   a real SQLite database in memory, with the production migrations; the
   database is never mocked.
10. **Writes that belong together share a transaction.** An activity, the Leaf
    it pays and the quest progress it causes are written by one
    `sql.withTransaction`, so none of them exists without the others.

## Deploying

Merging to `main` deploys. Coolify on the Sequoia server builds the
`Dockerfile` and replaces the running container; the app is `sequoia-leaf-prod`
in the `sequoia-leaf` project. The server applies new migrations when it
starts, before it takes requests.

A migration is a file in `apps/api/migrations` named `NNNN_name.ts` whose
default export is an Effect that runs its statements one `sql` call each: the
SQLite client runs a single statement per call, so a script of several is cut
short silently. Effect's migrator applies the ones a database has not seen, in
order, in one transaction, and records them in `effect_sql_migrations`.
`0010_schema.ts` is the whole schema as of migration 10, which every running
database had reached when the earlier migrations were folded into it; a new
database starts there. Changes go in `0011_name.ts` and up.

The app's settings and the DNS record are written down in [`infra/`](infra/)
as OpenTofu configuration. What the Coolify app is set up with:

- **A volume at `/data`** (`leaf-data`), which holds the database and survives
  deploys. The image runs as an unprivileged user that owns `/data`.
- **`PUBLIC_DIR`**, set by the image. `PUBLIC_ORIGIN` and `GAME_SIGN_IN_URL`
  are left at their defaults, which are production's.
- **`BACKEND_URL=http://sequoia-backend:8081`**, the backend's address on the
  server's private Docker network, so the credit feed and session checks never
  leave the machine.
- **`BACKEND_INTERNAL_TOKEN`**, the backend's `APP_INTERNAL_API_TOKEN`.
  Sierra takes the same token.
- **`SIERRA_URL=http://sequoia-sierra:8082`**, Sierra's internal API on the
  same network, for the awards feed.
- **`LEAF_RATES_WEBHOOK_URL`**, a webhook in the Branchmasters' #lets-go-gambling.
  At each start Leaf builds a rate card from the rules it runs with, posts it
  there once and edits that message whenever the card changes (it remembers the
  message in `announcements`). Add a line to `RULE_CHANGES` in
  `packages/core/src/rules.ts` with each change to the rates, so the card says
  what changed. Like the other secrets, it is set by hand in Coolify, runtime
  only, and kept out of `infra/`.
- **The network alias `sequoia-leaf`**, so other services on the server can
  reach it at `http://sequoia-leaf:3000`.
- **The domain `https://leaf.seqwawa.com`**. Its DNS record points straight at
  the server and is not proxied by Cloudflare; the certificate comes from
  Let's Encrypt.

The server logs one JSON object per line to stdout, which Coolify shows as the
app's logs: `started`, each run of a feed sync with what it recorded
(`credit_sync`, `achievement_sync`), each `snapshot`, and every error with its
cause. On SIGTERM it finishes the requests in flight, for up to eight seconds,
closes the database and exits 0.

During a deploy the old and the new container run side by side for a few
seconds on the same database file. That is safe: SQLite locks the file between
them, and the credit sync's lease lets only one of them read the feed.
Otherwise the service is built to run as a single instance.

To run the image anywhere else:

```sh
docker build --tag sequoia-leaf .
docker run --publish 3000:3000 --volume leaf-data:/data --env BACKEND_INTERNAL_TOKEN=... sequoia-leaf
```

## Backups

Every six hours the server writes a snapshot, a complete copy of the database
consistent as of one moment, to `/data/backups`, and keeps the newest 28, which
is a week. A snapshot is an ordinary SQLite file. To restore one, stop the app
in Coolify, copy the snapshot over `/data/leaf.db`, delete `leaf.db-wal` and
`leaf.db-shm` beside it, and start the app.

When the four `BACKUP_S3_*` variables are set, each new snapshot is also
copied off the server to that bucket. A failed copy is tried again ten minutes
later. Only the newest snapshot is copied, so if the bucket is unreachable for
longer than six hours, the snapshots taken meanwhile are skipped, apart from
the last. Leaf never deletes anything in the bucket; give it a rule that
deletes old copies. The local snapshots protect against a bad deploy, the
copies against losing the server.

To restore from the bucket, download a copy with any S3 client, or from the
Cloudflare dashboard for R2, and restore it as above.

## Corrections in the ledger

Two corrections were run by hand on 2026-11-19 and their code removed afterwards
(see sequoia-leaf#18 and #23). Their entries stay in the ledger, with memos that
name them:

- **Raid shares** (#18): the credit feed had paid each raid member the whole
  party's rating. Overpaid raids were reversed (`undo:raid:<completion>:<player>`)
  and the member's share paid in their place (`raid:<completion>:<player>:share`);
  levels the lower XP no longer reached were reversed (`undo:level:<player>:<level>`),
  so reaching one again pays it again (`level:<player>:<level>:2`).
- **Guild shares** (#23): the feed had split each raid's rating among allies in
  the party too. Members were paid the rest of their share
  (`raid:<completion>:<player>:guild-share`), and every earn of the 16 players who
  were never in Sequoia was reversed (`undo:<key>`).
