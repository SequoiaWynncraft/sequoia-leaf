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
can read their balance, level and quests. There is no way to spend Leaf yet.
The one staff route is the record of who played the game
([below](#who-played-the-staffs-view)).

It also serves the guild's browser game, Guild Town, at `/play/town/`, and the
routes only the game uses. Anyone signed in may play it: members, and guests
who are not in the guild. The game shows a member's Leaf; no route lets it
spend or pay any, and a guest has none. The Little Raid, the Works and the
town with its camp are played on Leaf's play service, which owns their state.
Coins are a ledger of their own, the only Coins there are: the games' commands
pay into it and take from it.

## Getting started

```sh
mise install     # install the pinned bun
bun install
bun run verify   # format check, lint, typecheck and test
bun run ci       # CI's workflow, on this machine (see below)
bun fmt          # format everything
bun run dev      # run the server at http://localhost:3000, restarting on changes
```

`bun run ci` runs `.github/workflows/ci.yml` under [act](https://github.com/nektos/act), every
check in it, in about a minute. It needs `act` (pinned in `mise.toml`) and Docker or podman: it
uses `DOCKER_HOST` when set, else Docker's socket when you may write to it, else podman's
(`systemctl --user enable --now podman.socket`). On GitHub the workflow runs for pull requests
only, and checks only what the pull request changes.

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
| `GAME_LEAF_SPENDING`          | `false`                    | Whether a game's command may spend Leaf.                |

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
address after `return_to=`. `GAME_LEAF_SPENDING` is said by `GET /v1/game/hello`
and lets a game's command take Leaf (see the play service).

## Layout

| Path                  | What it is                                                                    |
| --------------------- | ----------------------------------------------------------------------------- |
| `packages/core`       | The rules of the game as pure functions and types. No I/O.                    |
| `packages/raid`       | The Little Raid's rules, which Leaf and the battler's page share.             |
| `packages/factory`    | The Works' rules on flat data, no screen in them; Leaf and the page use them. |
| `packages/town`       | The town's and the camp's rules and catalogue; the town page uses them.       |
| `packages/pulls`      | The pulls' rules: prizes, banners, odds and Seeds.                            |
| `apps/api`            | The server, on Effect: the HTTP API, database and feed syncs.                 |
| `apps/api/migrations` | The database schema, as Effect migrations applied in order at start.          |
| `apps/town`           | Guild Town, the browser game's home screen.                                   |
| `apps/works`          | The Works, a game in the town.                                                |
| `apps/battler`        | The Little Raid, a game in the town.                                          |
| `packages/kit`        | What the town and its games share: look, sound and plumbing.                  |
| `packages/figures`    | The raid's figures as pictures, for the raid's page and the town's.           |
| `Dockerfile`          | The production image, with the game's pages built into it.                    |

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
with 413 `body_too_large` without reading it. The server itself takes no body
over 1 MiB.

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
| `GET /v1/rates`                  | What Leaf pays and costs now. Needs no session.            |
| `GET /v1/me`                     | The signed-in member's Leaf, XP and level.                 |
| `GET /v1/me/quests`              | Their quests, banked dailies and recently finished quests. |
| `POST /v1/me/quests/{id}/reroll` | Swaps one of their quests for another.                     |
| `GET /v1/me/events`              | What happened to them recently, oldest first.              |
| `GET /v1/me/events/stream`       | The same events as they happen, as server-sent events.     |
| `GET /openapi.json`              | This API as an OpenAPI document.                           |

The game has routes of its own under `/v1/game/`; see [The game's routes](#the-games-routes).

`GET /v1/rates` is the rate card Leaf keeps in Discord, in the same words, for
seqwawa.com's guide to Leaf: `{ "title", "description", "sections": [{ "name",
"text" }], "changed_at" }`, one section a kind of earning or spending, its
`text` keeping the rate card's Discord `**` bold markers. It is made from the rules
Leaf runs with, so it changes only with a deploy, and may be kept five minutes.

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

CI compares the file with the copy on Sequoia-mod's `main` when a pull request
changes it, and fails while they differ, so merge the mod's copy with or before
the change here.

The game's routes have their own file, `contracts/leaf-game-v1.json`, written
by `apps/api/test/game-contract.test.ts` from one member's day of play with
another member, the same way. No other repository keeps a copy, so changing it
needs no change elsewhere first: `cd apps/api && WRITE_CONTRACTS=1 bun test
test/game-contract.test.ts` writes it again. It has every answer except the
skin, which is a picture.

sequoia-backend's routes (below) have `contracts/leaf-internal-v1.json`, written
by `apps/api/test/purchases.test.ts` the same way; the backend's tests read its
copy, `src/test/resources/contracts/leaf-internal-v1.json`, so copy it there
when it changes.

### sequoia-backend's routes: tome and aspect requests

Members buy tome and aspect requests with Leaf in the guild's request channel
(and on the website). sequoia-backend runs those queues and sets their price;
Leaf keeps the Leaf. These routes, under `/internal/v1`, are for the backend
alone: they take the internal token the two already share
(`BACKEND_INTERNAL_TOKEN`, the backend's `APP_INTERNAL_API_TOKEN`) as
`Authorization: Bearer`, and only from the server's private network
(`http://sequoia-leaf:3000`): a request that came through the public proxy, which
always adds `X-Forwarded-For`, gets 401 `unauthorized`, token or not.

| Route                                    | What it does                                                   |
| ---------------------------------------- | -------------------------------------------------------------- |
| `GET /internal/v1/players/{player}/leaf` | `{ "player_id", "balance" }`: a member's Leaf, 0 for none yet. |
| `PUT /internal/v1/purchases/{key}`       | Buys a request: `{ "player_id", "kind", "leaf" }`.             |
| `DELETE /internal/v1/purchases/{key}`    | Cancels one: refunds it if paid, and keeps it from being paid. |

- **Buying** takes `kind` `tome` or `aspect` and its price in Leaf, and answers
  `{ "key", "status": "paid", "balance" }` with the balance after it. The key is
  the backend's own (1 to 100 letters, digits and `_ . : -`), one per request,
  and makes the purchase happen once: sent again, it answers as before and
  charges nothing. It is one `request` spend in the ledger, keyed
  `purchase:<key>`, with "Tome request" or "Aspect request" as its memo. 409
  `insufficient_leaf` when the balance does not cover it, `key_in_use` when the
  key was used for another purchase (another player, kind or price), and
  `purchase_cancelled` when it was cancelled; 400 `invalid_purchase` or
  `invalid_key`. Nothing is charged with any of them.
- **Cancelling** a paid purchase reverses its spend (`refunded`), as an entry
  keyed `purchase-refund:<key>`, which no purchase's key can take: staff denied
  the request, or the backend could not record it. A key never paid is kept
  from ever being paid (`cancelled`, in `cancelled_purchases`): the backend
  cancels a purchase whose answer it did not hear, so one that reaches Leaf late
  is refused, not charged. Cancelling again changes nothing.

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

| Route                                | What it returns                                                       |
| ------------------------------------ | --------------------------------------------------------------------- |
| `GET /v1/game/hello`                 | Where to sign in, and whether Leaf may be spent. Needs no session.    |
| `GET /v1/game/me`                    | The player, their rank, Leaf, XP, level, newest event's id and Coins. |
| `GET /v1/game/skins/{uuid}`          | A player's skin sheet, as a PNG.                                      |
| `GET /v1/game/guild/events`          | What happened across the guild, oldest first.                         |
| `GET /v1/game/guild/events/stream`   | The same as it happens, as server-sent events.                        |
| `PUT /v1/game/presence`              | Says where in the game the player is; lists who is there and resting. |
| `GET /v1/game/presence`              | The same lists, saying nothing: for a page in a live room.            |
| `GET /v1/game/admin/activity`        | For the staff alone: who played, when, where and for how long.        |
| `GET /v1/game/play/{game}`           | The player's state in a game Leaf plays, as their page is shown it.   |
| `POST /v1/game/play/{game}`          | Does a batch of commands in that game, and answers what each did.     |
| `GET /v1/game/play/{game}/standings` | The game's board: the twenty highest, and the player's own place.     |
| `GET /v1/game/banners`               | Every pull banner, its dates, and its headliner's id and name.        |
| `GET /v1/game/requests`              | The Treasury's aspect and tome requests: their price, or why not.     |
| `POST /v1/game/requests`             | Buys one with Leaf, through the backend.                              |

Every one but `hello` takes a session, as above, and lets in anyone signed in,
member of the guild or not. Someone who is neither a member nor a website admin
plays as a **guest**: they have games, skins and presence like a member, but no
Leaf, XP, quests or news, and the guild's events (and their stream) refuse them
with 403 `members_only`. The mod's routes, `/v1/me` and those under it, still
let in only members.

The Treasury's routes ask sequoia-backend's reward queue (`/api/reward-queue`) as
the member, with their own session and the website's mod version. A guest gets
403 `members_only` and the backend is not asked. `GET /v1/game/requests` answers
`{ "aspect": { "price", "why_not" }, "tome": { ... } }`, `why_not` null when the
member may buy it now; the backend refusing them answers 409 `request_refused`,
and the backend not answering 503 `requests_unavailable`. `POST /v1/game/requests`
takes `{ "type": "aspect" }` or `{ "type": "tome", "reason" }` (1 to 1,000
characters) and answers `{ "type", "position", "leaf_paid", "leaf" }`; the
backend charges the member through `PUT /internal/v1/purchases/{key}` before it
answers. Refused, it answers 409 `request_refused` with the backend's reason and
nothing taken. With no answer that says, 504 `request_unknown`: it may have been
made, and is not to be sent again. Leaf waits 30 seconds for it.

`GET /v1/game/hello` answers `{ "sign_in", "leaf_spending" }`: `GAME_SIGN_IN_URL`
and `GAME_LEAF_SPENDING`. A page that gets it knows it is on a live server.

`GET /v1/game/me` answers `{ "player": { "id", "username" }, "rank", "guest",
"leaf", "xp", "level", "event_cursor", "coins" }`. `rank` is the member's guild rank as
the guild writes it, such as `Captain`, or null for a guest or a website admin
who is not in the guild. `level` is as `/v1/me` has it. `event_cursor` is the id
of the member's newest event, 0 when they have none, from which to read
`/v1/me/events?after=` on their next visit. For a guest, `guest` is true,
`leaf` and `xp` are 0, `level` is a new member's and `event_cursor` is 0, and
nothing is read from the ledger or the events: a former member's old Leaf is
not shown to them while they are a guest. `coins` is the player's Coins, guest
or member (see [The play service](#the-play-service)); asking opens a new
player's account with the welcome.

**The old saves.** Before the games were Leaf's, each page kept its game in
the browser and copied it to a save per slot (`saves`, with earlier copies in
`save_history`). No route reads or writes them any more; the tables stay for
bringing the last of them over (see [Moving over](#moving-over)), and a later
migration drops them.

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
after that id. With the newest 50 come two things the town shows that no list of
events can say, as of the same moment: `today`, `{ "from", "raids", "wars" }`,
how many raids and wars the guild finished in the UTC day that began at `from`,
by when each happened, each once however many members it paid; and `last_war`,
`{ "territory", "occurred_at" }`, the last territory fought at by when the war
happened (of two at one moment, the one whose name sorts later), or null. Both
count only what Leaf paid for, which is what the events tell of. The stream behaves exactly as the member's own does, from where
it starts to when it closes, and counts toward the same six. All open guild
streams are fed by one look at the database every two seconds, not one each.
Raid party members' events share a `detail` and an `occurred_at`.

A member's name is the one the backend gave when they last opened
`/v1/game/me` as a member, or else the one Mojang gives. Leaf asks Mojang only about
players it knows, as for skins. It keeps the names it learns, and each time it
learns a new one, removes those nobody asked for in 30 days. An event whose
member no one can name yet, because Mojang can't be reached, is left out.

**Presence.** `PUT /v1/game/presence` takes `{ "place", "stay", "device" }`:
`place` is one of `town`, `camp`, `works` and `table`; `stay`, true or false and
optional, says whether the player's character may stay in town, dozing, for a
day after they go (the town's page says it, from its own state; left out, it is
as it was, and on for a player Leaf has never been told about); and `device`, `phone` or `desktop` and
optional, is what the page is on, by its window's width when it signed in
(under 700 CSS pixels is a phone), for the staff's record of who played.
Anything else gets 400 `invalid_place`. It records
both, with whether the player is a guest, and answers `{ "present": [{ "id",
"username", "place", "guest" }], "resting": [{ "id", "username", "place",
"guest", "seen_at" }] }`: `present` is the 50 seen most recently of everyone
whose game said where they were in the last 90 seconds, the player included,
in name order; `resting` is those last seen between 90 seconds and a day ago
whose `stay` was true, newest first, at most 24. A game that says the same place
and `stay` less than 5 seconds after anything was last written for its player is
answered the lists, but nothing is written; somewhere else, or other about
staying, is written at once. A player in one of Live's rooms of the game's
places (the town) is written there by Live itself, as if their game had said so
(below). Players not seen for a day are forgotten.
`GET /v1/game/presence` answers the same lists and writes nothing: a page in
one of Live's rooms asks it every 30 seconds, since the room keeps where its
player is. Each `PUT` is also a visit's call (see
[Who played](#who-played-the-staffs-view)); a `GET` is not.

### The play service

Leaf owns the state of the games played on it (`apps/api/src/play`): a
player's page holds a copy to draw from and sends commands, and Leaf checks
each with the game's own rules, applies it, stores the result and answers with
what happened. A game's rules are a pure package that Leaf and the page both
import, and hand Leaf one `Game` (`packages/core/src/play.ts`): a new
player's state, the state brought to Leaf's clock, one command done or
refused, what the page is shown of a state (nothing that tells the future),
and the state as stored text. Time is Leaf's, and so are the dice: each call
gets a fresh number from the machine's secure randomness (`Ctx.seed`), which
the game stirs into the stream its state keeps; the stream is never shown.
The games on it now: `raid`, The Little Raid (`packages/raid`), `works`, the Works (`packages/factory`), and
`pulls` (`packages/pulls`).

- `GET /v1/game/play/{game}` answers `{ "rev", "now", "state" }`: how many
  batches have changed the state, Leaf's clock, and the game's view of it. A
  player with no state yet gets a new one (and, if they have no Coins account
  yet, the welcome). Nothing is ever read from the old saves. `?differs=<tick>`
  is from a page that found its own copy not to be Leaf's state at that tick;
  Leaf logs it, with whose and which game.
- `POST /v1/game/play/{game}` takes `{ "player", "commands": [{ "id", ... }] }`:
  `player` is the id the page believes it is (409 `not_you`, nothing done, when
  it is not the session's player, as for a page left open after someone else
  signed in; the kit's play client then sends nothing more and loads the page
  again), and the commands are at most 32, each with an id the page made (up to 64 letters, digits and `_ . : -`),
  unique in the batch, and answers `{ "rev", "now", "results", "state" }`:
  for each command in order `{ "id", "notes" }` (the game's own notes of what
  happened) or `{ "id", "refused": "<code>" }`, and the state after them all;
  or, for a game whose page keeps a copy with the same rules (the Works),
  the game's short answer instead (`Game.answer`: for the Works, Leaf's tick,
  and the yard's tick, check and the orders hung that do not count yet after
  the batch).
  One refused does not stop the rest. The whole batch is kept in one
  transaction: the state brought to now with each command done, the Coins each
  paid or took, what each logged and each command's answer, written together;
  a failure anywhere leaves nothing of it. A command whose id is
  among the player's newest 256 to the game answers what it answered then
  (its notes or its refusal, with the state, or short answer, as it stands now) and changes
  nothing, so a page that lost an answer sends the batch again safely. `rev`
  goes up by one with each batch that changed anything, Leaf's own tending
  (below) among them.
- 404 `no_such_game` for a game Leaf does not play; 400 `invalid_command` for a
  body that is not commands, more than 32, a missing or repeated id, or a
  command that is not one of the game's (nothing is done); 413 as elsewhere;
  429 `slow_down` for a batch that would take one player past 10 batches a
  second (bursts of 20) or 10 commands a second (bursts of 40), across all
  games: it is refused whole, and nothing is done.
- A command's Coins are worked out in order, starting from the balance: each
  change it pays or takes is added in turn, and if the balance would go below
  nothing at any point the command is refused with `not_enough_coins` and
  nothing of it is kept. So a command may pay something in and then take a
  price from it (the Works pays its till in before taking a price).
- Play pays a player at most 5,000 Coins in any hour and 20,000 in a UTC day
  (`EARNINGS` in core), whatever the games, the pages' route below included.
  Past that a command that pays is done all the same and pays only what is
  left, so nobody is stopped mid-game and playing faster than a person can
  earns nothing more. The welcome and Coins brought over do not count, and
  neither does a change a game marks `free` (`CoinChange.free`): Coins given
  back for something paid for, or paid by Leaf's own clock, such as the Works'
  till. Such a change is paid whole and uses none of what may still be earned;
  its entry has `earned` 0.
- A command may take Leaf (`Done.leaf`: a whole number above 0, what it was
  for, and a key unique among the game's spends for the player); no game pays
  Leaf in. While `GAME_LEAF_SPENDING` is off, or for a guest, such a command is
  refused with `leaf_closed`; when its spends come to more than the ledger's
  balance, with `not_enough_leaf`. Otherwise each spend is posted to the ledger
  in the batch's transaction, as a `spend` on the `shop` sink keyed
  `play:<game>:<player>:<key>` with what it was for as its memo, and logged as
  `leaf_spent` for the staff's report. A key the ledger has seen is not taken
  again, and the command stands. A spend earns no XP and uses none of the
  Coins' room. The raid's `buyLook` is the one command that takes Leaf.
- A stored state that does not read (a rules change that forgot an older
  version, say) answers both routes 409 `state_unreadable`: nothing is done,
  the state is kept as it is, and Leaf logs the player and the game. The page
  shows the kit's card for it and sends nothing more.
- A game may have a board (`Game.standing`: a whole number players are listed
  by, and a few more shown beside it; the Works' is the Coins a yard has ever
  earned, and its story orders done). A batch that changed the state writes
  where it stands in the same transaction. `GET /v1/game/play/{game}/standings`
  answers `{ "top": [{ "place", "id", "name", "guest", "score", "also", "you" }], "you" }`:
  the twenty highest scores above 0, a tie going to whoever reached it first;
  `place` is how many score higher, and one; names as the guild's news has
  them ("Someone" for one Leaf has none for); the outer `you` is the caller's
  own `{ "place", "score", "also" }`, or null before they score. Empty for a
  game with no board.
- Each call a player makes to a game (an opening, a batch not refused whole,
  a visit, for the visitor) adds the time since their last call to that game
  to how long they have played it, when that is at most 3 minutes
  (`IDLE_MS`; a page in view calls at least every 75 seconds); a longer gap
  adds nothing. Leaf's own tending (below) is not a call. It is written as the
  call arrives, with that moment, before the call waits for anything, and by
  Leaf itself, so that the caller going away cannot stop it: one that waits in
  a line (below) counts from when it came. `GET /v1/game/people/{player}` answers `{ "id", "name",
"games", "played" }`: for each game they stand in or have played a second
  of, `played` in whole seconds and, with a standing, its `place`, `score`
  and `also`; and `played` for all games together.

Tables (migration 17): `play_state` (a player's state in a game, with its
`rev`; 0 is a state nothing has been done to), `play_commands` (each command's
id, the `rev` it led to and its notes or refusal, never the state; only each
player's newest 256 to a game are kept, the older removed once a batch),
`coins` and `coin_entries`, and `command_days` (each
player's commands done and refused, by the UTC day). What commands log goes to
`activity`, which migration 16 made for the staff's report. Migration 18 gave
`coin_entries` `earned`, 1 for an entry weighed against what a player may earn
and 0 for one that is not. Migration 19 made `standings`, where each player's
state in a game with a board stands; its `updated_at` is when the score was
last reached. Migration 23 made `played`: each player's time in each game, in
milliseconds, and when Leaf last heard from them there (`seen_at`). Migration 24
gave `play_state` `guest`, whether the player was a guest when it was last
written (a state from before took it from where it stands, or else from the
player as last seen), which whatever Leaf writes of it while they are away says
too.

**Coins** are a ledger like Leaf: a balance per player, changed only by an
entry, each keyed by the fact it records (`<game>:<player>:<key>` for a
game's, such as `raid:<player>:run:7`) so that it is never made twice. A
trigger applies each entry to its balance, which can never go below zero, and
entries are never changed or removed. A new player's account opens with 300,
as one entry keyed `welcome:<player>`. They are the only Coins there are:
every page shows the ledger's number, and the browser keeps none.

**Activity.** What a game's commands log (a raid begun, a room won or lost, a
raid ended and what it paid) is written to `activity` (`player_id`, `at`,
`game`, `kind`, `data` as JSON) in the same transaction: up to 1,000 of a
player's a UTC day (past that they are not logged, and the play goes on), and
kept 180 days, older rows being removed as new ones are written. So is the
count of the batch's commands done and refused, in `command_days`. Both are
for the staff's report (see [Who played](#who-played-the-staffs-view)).

**Awards.** A game may say what a state shows was won for good
(`Game.awards`): The Little Raid a carved figure of each boss its almanac has
beaten (`trophy-<boss>`), the Works a model of each capstone its depot has
taken in (`model-<capstone>`). In the transaction of a batch that changed such
a game's state, each one the player does not hold yet is written to `awards`
(`player_id`, `id`, `at`); none is ever taken away. Every call of every game
is told all the player holds (`Ctx.awards`), so that the town can send each to
the camp as a trophy.

**Tending.** A game may say that its states go on by themselves for hours
(`Game.tend`): the Works' yards work while their owners are away. Everything
Leaf does with one player's state in a game is a job in that state's lane: an
open, a visit, a batch, or Leaf's own tend. A job takes its place in the
lane's line as it arrives, with the moment it arrived, and the lane does its
jobs one at a time in that order, each at its own moment: a batch is done at the
moment it arrived, however long it waited. A lane holds at most one copy of the
state in memory. For each job it reads the stored state if it has no copy or
the stored `rev` is no longer its copy's (a staging step or another Leaf wrote
it), brings the copy to the job's moment, and then shows it; or does each of
the batch's commands to it in order, once the copy is run on to the tick the
command is done at, weighing each against the balances as they stood before any
was kept, and keeps it. A state that tends is run on 2 ms of work at a time,
with as long a rest after each; one slice runs at a time for every state and
every job together. The next slice goes to the players' job that arrived
first (a tend with one behind it in its line runs as that one's), but a tend
that has waited through three of those has the next: a player's job waits
behind at most one slice of Leaf's own tending, and the tending goes on however
busy the players are. No transaction runs a state on or does a command: a
batch's transaction only checks and writes, the stored `rev` first, whether or
not the state changed, then the balances its commands were weighed against
(Coins, what may still be earned, and Leaf if any was taken), then the state,
the answers, the Coins and the log. The copy is written by a batch, and when a
job leaves the line empty with the copy run on past what is stored, as a batch
of no commands keeps a state (where it stands and what it has won with it, and
`rev` up by one); nothing else writes it, and the job is answered after. When
what is stored has moved on (another Leaf wrote it, as for about twenty seconds
of every deploy, or a tool did), nothing is written, and the job is done again
from what is stored at its own moment, three times at most before it fails: so
between two Leafs the row decides, and no command is lost or done twice. A new
player's state is made in memory, their Coins opened with the welcome as it is,
and stored by the first of those. Anything going wrong in a job drops the copy,
and the next job reads what is stored. A batch is done whatever becomes of its
request; an open, a visit or a tend whose caller has gone while it waited is
never done. A lane with nothing in its line and nothing unsaved is let go.
Every minute, from a minute after it starts (so that a Leaf starting beside one
stopping does not tend against it), Leaf puts a tend in the line of each state
no batch has written for two minutes (`TEND_AFTER`; an open page sends
something more often), but for those it found standing still when it last read
them (a yard eight hours after its owner was last there), until they are
written again, and those with a tend in their line already; it waits for none
of them, and each reads nothing until the slices give it its first turn. A tend
that fails is logged (`Tending the <game> state of <player> failed`), and the
others are tended all the same. Leaf stopped with jobs waiting has written
nothing of them: every state is as last stored, only behind, and the next Leaf
runs it on from there. A sweep whose tends have all ended logs `tended`: how
many states, and how long they took. On the development machine, tending the
largest kept yard (228 pieces) takes 9.5 ms of work two and a half minutes
behind and 0.9 s eight hours behind, so half a core keeps about 7,900 such
yards up; its owner opening it eight hours behind, on a Leaf just started,
waits about 2 s. `bun apps/api/test/live-load.ts 32 20
50 10` timed the town while fifty of them, eight hours behind, were tended and
ten players visited one at once: 17.4 ms at the median, 32.8 ms at the 95th
percentile and 36.9 ms at worst, against 15.9, 31.6 and 33.7 ms without; the ten
visits were answered within 2.7 s, the other forty-nine tends taking every
fourth slice meanwhile. With `32 20 50 0 50`, fifty players visited a large yard
written a minute ago at once, all answered within 0.07 s, and its owner's
command sent behind them was answered in 67 to 83 ms; their page's commands
after, once every half second, took 4 to 5 ms at the median and 11 ms at worst.

**The town and the camp** keep the camp (what stands where, each thing by an
id of its own, the tray of things not set out, the letters, the pets),
the caller waiting at it and when the next sets out, the chest's and the
welcome's UTC days, when the member was last here, how far their news has been
told and whether their character stays. Its commands, what happens by itself
and what its page is shown are in `packages/town/README.md`. Buying at a stall
takes the price; the chest pays 3 Coins once a UTC day, free of the cap; where
a camp stands (things set out, callers greeted, the crab's sightings) is shown
on a person's card. Each trophy the player holds (an award) goes into the
camp's tray.

**The pulls** keep what each player has won, their counters, Seeds and free
pulls; the rules and odds are in `packages/pulls/README.md`. Pulls paid with
Leaf take it as one spend per command, keyed `pull:<pulls before it>`. Who a
banner's headliner is, is the `banner_people` table (`banner`, `player_id`),
put in by hand; Leaf counts them as known, so their name and skin are looked up.

**The Little Raid** keeps the run in hand, the almanac, the looks and the trail
picked. Its commands, notes, refusals and what its page is shown are in
`packages/raid/src/README.md`. A run that ends pays its Coins as one entry
keyed by the run's number.

**The Works** keeps the yard, its clock and its till; its commands, what its
page is shown and answered and how the page runs the yard ahead of Leaf are in
`packages/factory/README.md` and `apps/works/README.md`. Time is Leaf's: a yard holds the ticks it has run
and the moment of Leaf's clock its last tick stands for, ten ticks a second.
Leaf runs every yard tick for tick, looked at or not (tending, above), for
eight hours after its owner's last command; then it stands still until their
next. Opening or sending brings a yard to three seconds short of Leaf's clock,
and each command is done at the tick the page's copy stood at when it was
made. What the yard did since its owner's last command is counted from what it
remembers of that moment, and shown to the page for its letter once that was
five minutes ago or more. Its Coins are
keyed `works:<player>:bank:<n>` by the yard's own count, and every one it pays
in is `free`: the till paid in before any price is taken and when the page
collects it, and what a piece cost given back when it is taken away. A plot
bought, a standing order handed over and each lesson, project and commission
finished are logged. A yard kept by the first design's rules (`packages/yard`,
now gone) does not read: Leaf logs it, keeps it as it is, answers its owner
`state_unreadable`, and does not tend it.

### Live: players in the same place, as it happens

`GET /v1/game/live?v=2&room=<kind>` (`livePath` in core) is a WebSocket into a
room; the game adds `&device=phone` or `desktop`, what the page is on, for the
player's visits (anything else there is taken as nothing said). Players in the same room see each other move as it happens, and see who
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
below 1024 a second. Each kind of room has a pace (`speed` in `ROOMS`: the
town's is 160 a second, its walk 64): a move further from the player's last
place than the pace allows in the time since, half as far again and 8 units
more, is shown to everybody else as a jump, though the game's count did not
change, so a page that says its player is anywhere it likes only has them jump
there. `flags` bit 0 says the player is moving. `jump` counts the
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
| game | `act`     | `kind` and `arg`, one of `ACTS` in core (an emote: `wave`, ...; a touch on a thing in town: `post:174,100`).       |
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
size, how many fit in one copy and its pace (the town: 512 by 352, 32, 160). A player is put in
the first copy with space, or a new one (`town/2`); a copy closes when its last
player leaves. Rooms live in memory, in the one process.

**Limits.** No frame over 4 KiB (Bun closes the connection, 1009). Text frames
over 512 UTF-16 code units are not read. A player may send 30 moves a second (bursts of 40),
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

When Leaf stops, every open visit is closed, and then every connection with
1012, and every event stream ends, before the HTTP server stops: production and the tests both serve Leaf with `serveLeaf` in `app.ts`,
which puts Leaf's farewell on top of the server (see [Deploying](#deploying)). The game tries again
half a second later, and then every second or so until Leaf is back (`retryAfter`
in the kit's `realtime.ts`), at once when the page comes back to the front or the
network returns; then it joins its room again, and says where its player is again,
as a jump. `bun apps/town/review/reconnect.ts` measures it: stopped as a deploy
stops it and started again 15 seconds later, `play.ts` answered `/healthz` and the
town's page was back in its room 0.02 to 1.17 seconds after, in five rounds.

Once a minute while anybody is about, or anything was refused, Leaf logs a `live`
line: players, how many are connected, who is in which room, how many connections
opened and closed, how many frames came in and were dropped, and `refused`, how
many openings were turned away before the upgrade, by code (`unauthorized: 3`).

**Where they are, for everybody else.** A player in a room whose kind is one of
the game's places (`town`) is present there as `PUT /v1/game/presence` has it,
written by Live: when they come into the room (keeping what they last said
about staying, and staying if they never said), again every 30 seconds while
they are in it, and when they leave it (their connection's grace run out, a
`leave`, or another room), as last seen there then, unless their game has said
since that they are somewhere else. So pages that ask who is about count them
right, and they rest in town after they go, though their page never says where
it is. The same moments open, keep and close their visit there.

**What it is not, yet.** Positions are the game's to say, inside the room and
at its pace: right for walking about together, never for anything that pays or
wins. Fights
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
network's unevenness. `bun apps/api/test/live-load.ts [players] [seconds] [yards] [visitors] [fresh]` runs
the real app with that many players walking about the town at the game's pace
(and that many large yards for Leaf to tend meanwhile), and times every move from its sender to each other player receiving it (not to
the screen). On the development machine, with the server and every player in one
process: 32 players, every move seen by all 31 others, 17 ms at the median and
35 ms at worst, 15 KiB a second to each player; 128 players in four copies of
the town, 19 ms and 38 ms, 19% of one core for everything. Measured on the
screen, with `play.ts --crowd 6` and two pages as two members on the same
machine, one walking about the town and the other read every 100 ms for 24
seconds: the second draws the first where the first said it was 125 to 135 ms
before, and so at most 10 of the town's pixels behind it at the town's walk.

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
bun apps/api/test/play.ts 4000 /tmp/play --crowd 6
```

The games Leaf plays are served as in production; The Little Raid needs it, and
opened with no Leaf answering shows a card saying so. Its screenshot tours
start one of these servers each (`apps/battler/review/tour.ts`).

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
  `/sign-out?return_to=<address>` clears it and ends the session, as the
  website's does, until Tester signs in again: a live connection of theirs is
  closed as signed out once Leaf asks again.
- Each of the others has a session of their own, `as-<name>` in small letters:
  `/sign-in?as=quillon&return_to=<address>` sets it, for a second page as
  somebody else.
- `PUBLIC_ORIGIN` is `http://127.0.0.1:4000`.
- Ctrl-C, or SIGTERM, stops it as a deploy stops Leaf: live connections are told
  Leaf is restarting (1012), and event streams end, before the server goes.
- `--guest`: Tester is signed in but not in the guild, so they play as a guest.
- `--down`: the backend can't be asked who Tester is, so they answer 503.
- `--busy`: every minute a few of the four finish a raid together, for the guild's news.
- `--admin`: the backend knows one more session, `staff`, of Warden, a website
  admin not in the guild, so that
  `curl -H 'Authorization: Bearer staff' http://127.0.0.1:4000/v1/game/admin/activity`
  shows who played; `/sign-in?as=warden` signs a page in as them.
- `--crowd <n>`: n more members, each in a skin of their own, in the town's live
  room and walking about it along its paths: stopping a few seconds at each
  spot, now and then sitting on a log by the fire a while, and now and then
  waving, cheering, laughing or sending a heart. They say where they are only
  by being in the room. Every third is on a phone.
- `--dice <n>`: Leaf's dice fall the same way every time from `n`, so a tour plays the same game each run.

For the tours it also serves `POST /test/play/raid` with `{ "stage": [...] }`,
which stages a moment at Tester's raid table that play does not reach by
itself (a run from a chosen seed, more acorns, a figure handed over, a new
member; `apps/api/test/stage-raid.ts`), and `POST /test/play/works`, which
does the same in Tester's yard (a yard kept part-way through the story or a new
one, a time away, a standing order filled; `apps/api/test/stage-works.ts`), and
`POST /test/play/town`, in Tester's town and camp (a new member's town, a
lived-in camp, a caller waiting, a time away, a full mailbox, Coins to shop
with; `apps/api/test/stage-town.ts`). The guild's own Leaf has no such route.

## Who played: the staff's view

Leaf records when players come, where they go in the game and for how long,
for the staff alone, to see how the game is played, to answer "what happened
to my game", and to notice anything out of the ordinary. It keeps no IP
address, browser string, where a player walks or what they point at. The
rules are `packages/core/src/visits.ts`; the store is `apps/api/src/activity`.

- **Visits** (`visits`): each stay in a place (`town`, `camp`, `works`,
  `table`). One opens when a player comes into one of Live's rooms of a place,
  or when their page says it is there (`PUT /v1/game/presence`), and is heard
  of again while they stay: by the room every 30 seconds, and by each call. It
  closes when they leave the room or their grace runs out, when they come to
  another place (a player has one open visit at most), or, not heard of for 90
  seconds, at the last time it was. A page's call in the place of the room a
  player then comes into is the same visit, the room's from then on. Each Leaf
  process has an id of its own (`instance`), and a visit is the one's that last
  heard of it: Leaf stopping closes its own open visits at that moment, before
  any connection, and leaves open those the other container in a deploy has
  heard of since, with the time they began.
- **Sessions** (`sessions`): visits by one player less than five minutes apart
  are one sitting: its start and end (null while a visit of it is open), its
  seconds, the seconds in each place (`places`, JSON) and `device`, `phone` or
  `desktop` as the page said when the session began (null when it said
  nothing), all kept up to date as its visits open and close.
- **Players** (`players_seen`): one row a player: first and last seen, all
  their seconds, their sessions, and their name and whether a guest as last
  known, written each time Leaf hears of them.
- **Things done** (`activity`): what each game's commands log through the play
  service (`Done.log`), as JSON, by the names in `LOGGED` in core. A raid run
  is `raid_started` (`trail`), a `raid_room` for each room fought (`room`,
  `kind`, `won`, `resolve` left, the fight's `seconds`) and `raid_ended`
  (`trail`, `rooms_won`, `ended`: `won`, `lost` or `left`, and the `coins` it
  paid); the Works logs `works_plot` and `works_plan` (what was bought, and its
  `price`), `works_order` for a standing order handed over (`order`, `title`,
  `pay`) and `works_story` for each story order finished (`order`, its number
  in the story, `title`, `pay`).
- **Commands** (`command_days`): how many of each player's commands the play
  service did and how many it refused, by the UTC day. One sent again and
  answered from before is not counted again.

Visits and sessions that ended 180 days ago are removed whenever a visit is
opened, and the things done 180 days ago whenever new ones are written (at
most 1,000 of a player's are written a UTC day); players are kept for good. Every minute Leaf
closes the visits gone silent, and so does a read of the report.

`GET /v1/game/admin/activity?days=<n>` lets in only a session the backend marks
as a website admin, and refuses anyone else with 403 `staff_only`. It covers
the last `n` UTC days, today the last (7 when left out, at most 90; one that is
not a whole number of 1 or more gets 400 `invalid_days`), and answers:

| Field     | What it holds                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `now`     | Leaf's clock.                                                                                                                                                                                          |
| `here`    | Who is in which place now: `id`, `name`, `guest`, `place`, `since`.                                                                                                                                    |
| `players` | Everyone with time in the period, most first: `first_seen_at`, `last_seen_at`, `seconds_total` (ever), `sessions` and `seconds` in the period, `places` (seconds), and `done`, their last five things. |
| `days`    | Each day, oldest first: `players`, `new_players`, `sessions` begun, `hours`, and `places` (hours), to two places; a visit across midnight counts on both days.                                         |
| `raid`    | `began`: runs begun in the period; `runs`: how many runs won how many rooms (so far, for one still going).                                                                                             |
| `works`   | `began`: players who first went to the Works in the period; `players`: how many of those there in it have filled how many story orders.                                                                |
| `odd`     | What is out of the ordinary, newest first: `id`, `name`, `rule`, `at` and `value`.                                                                                                                     |

The rules of `odd` (`ODD_RULES` in core) are a list to look at; nothing is done
about them:

| `rule`              | When                                                                  | `at`                   | `value`     |
| ------------------- | --------------------------------------------------------------------- | ---------------------- | ----------- |
| `coins_in_an_hour`  | A player's Coins rose more than 5,000 in an hour (the most each day). | The hour's first entry | Coins risen |
| `sessions_in_a_day` | More than 20 sessions begun in a UTC day.                             | The day                | Sessions    |
| `long_visit`        | A visit longer than 12 hours, ended or not.                           | When it began          | Its seconds |
| `refused_in_a_day`  | More commands refused than done in a day.                             | The day                | Refused     |

Coins are read from the ledger (`coin_entries`), leaving out Coins brought over
by hand from the old saves (`import:<player>`); refused commands from
`command_days`. What other players see of someone stays what it was: in town
now, or dozed off a while ago.

## Moving over

The few players with progress in the old saves (the `saves` table) had their
Little Raid and their Coins brought over once, by hand, on 22 November 2026,
with a tool that has since been deleted: each one's Coins as one ledger entry
keyed `import:<player>`, and their table as their `raid` play state with
everything drawn afresh. Nothing in the product reads an old save, and an old
slot takes no more writes once its game has moved.

Their yards were brought over the same way the same day: each as the
player's `works` play state, standing at Leaf's clock, with a new seed. That
tool is deleted too.

Their towns and camps were brought over once too: each as the player's `town`
play state, every thing standing given an id, the callers and the stream
afresh. That tool is deleted too.

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
(`credit_sync`, `achievement_sync`), each `snapshot`, every error with its
cause, and `stopped`, with how long each part of its stop took.

During a deploy the old and the new container run side by side for a few
seconds on the same database file. That is safe: SQLite locks the file between
them, and the credit sync's lease lets only one of them read the feed.
Otherwise the service is built to run as a single instance.

A game's state the new container wrote in a shape the old one cannot read is
answered 409 `state_unreadable` by the old one; a page asks again each second
for 30 seconds, as it does a Leaf without the play service (`play.ts` in the
kit), and shows the card for it only after.

A deploy starts the new container, waits for it to answer `/healthz`, and then
stops the old one with SIGTERM. The proxy in front (Traefik) shares requests
between every running container of the app and drops one only once it has
exited, so until the old process has exited, it is sent about half of all
requests, and the ones it can no longer answer fail with 502. So Leaf stops at
once, from the top down (`main.ts`, `serveLeaf` in `app.ts`):

1. Live closes this process's open visits and tells every player Leaf is
   restarting (1012). Their pages reconnect, to the new container.
2. Every event stream ends (`OpenStreams.end`). Its client reconnects too.
3. The HTTP server stops listening. A request already being answered has 200 ms
   to finish; whatever is still open then is closed.
4. The scheduled work is interrupted. A sync cut short rolls back its
   transaction and lets go of its lease, so nothing is left half written.
5. The database is closed, folding its write-ahead log back in, and the process
   exits 0, logging `stopped`.

Should that take longer than two seconds, the process exits anyway, with 1,
having logged `stop_overdue` and the part it was waiting for.

It used to linger. Bun's graceful stop waited up to eight seconds for open
responses to finish, and an event stream never finishes by itself, so the old
process stopped listening at once and then ran on, answering nothing. A deploy
measured from outside (`/healthz` four times a second) and on the server (the
containers' states twice a second):

```text
+15.8 s  the new container starts
+21.0 s  the new container is healthy; both are up
+26.6 s  the first 502; from here 12 of about 33 requests fail
+34.8 s  the last 502
+35.2 s  the old container is gone
```

From SIGTERM to exit, on this machine, with the real server and each kind of
connection players hold open:

| Open when it is told to stop                 | Before | Now    |
| -------------------------------------------- | ------ | ------ |
| Nothing                                      | 24 ms  | 23 ms  |
| A member's event stream                      | 8.0 s  | 17 ms  |
| The guild's event stream                     | 8.0 s  | 18 ms  |
| A live connection                            | 21 ms  | 20 ms  |
| A request in flight (waiting on the backend) | 2.5 s  | 215 ms |
| All four                                     | 8.0 s  | 230 ms |

On a deploy, that should leave only the requests the proxy sends the old
container in that fraction of a second to fail, where it was half of them for
eight seconds.

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
