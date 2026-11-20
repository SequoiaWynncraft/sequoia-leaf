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

## Getting started

```sh
mise install     # install the pinned bun
bun install
bun run verify   # format check, lint, typecheck and test
bun fmt          # format everything
bun run dev      # run the server at http://localhost:3000, restarting on changes
```

The server is configured with environment variables:

| Variable                      | Default                   | What it is                                              |
| ----------------------------- | ------------------------- | ------------------------------------------------------- |
| `PORT`                        | `3000`                    | The port to listen on.                                  |
| `DATABASE_PATH`               | `data/leaf.db`            | The SQLite file. It is created when missing.            |
| `BACKUP_DIR`                  | `backups` beside the file | Where snapshots of the database are written.            |
| `BACKEND_URL`                 | `https://api.seqwawa.com` | sequoia-backend, for the credit feed and session check. |
| `BACKEND_INTERNAL_TOKEN`      | none                      | sequoia-backend's `APP_INTERNAL_API_TOKEN`.             |
| `SIERRA_URL`                  | none                      | Sierra's internal API, for the awards feed.             |
| `BACKUP_S3_ENDPOINT`          | none                      | The S3 endpoint snapshots are copied to.                |
| `BACKUP_S3_BUCKET`            | none                      | The bucket there.                                       |
| `BACKUP_S3_ACCESS_KEY_ID`     | none                      | A key that may write to that bucket.                    |
| `BACKUP_S3_SECRET_ACCESS_KEY` | none                      | Its secret.                                             |

Without `BACKEND_INTERNAL_TOKEN` the server answers requests but does not read
the credit feed, which is what local development wants. Without `SIERRA_URL` it
does not read the awards feed, and achievement milestones pay nothing. Without all four
`BACKUP_S3_*` variables, snapshots stay on the machine.

## Layout

| Path                  | What it is                                                           |
| --------------------- | -------------------------------------------------------------------- |
| `packages/core`       | The rules of the game as pure functions and types. No I/O.           |
| `apps/api`            | The server, on Effect: the HTTP API, database and feed syncs.        |
| `apps/api/migrations` | The database schema, as Effect migrations applied in order at start. |
| `Dockerfile`          | The production image.                                                |

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

The routes are declared once, as an Effect `HttpApi` in
`apps/api/src/api/api.ts`, with the shape of every answer and error in
`schemas.ts` and `errors.ts` beside it. The server implements that declaration,
and `GET /openapi.json` serves the OpenAPI document generated from it.

| Route                                       | What it returns                                            |
| ------------------------------------------- | ---------------------------------------------------------- |
| `GET /healthz`                              | `{ "status": "ok" }`                                       |
| `GET /v1/me`                                | The signed-in member's Leaf, XP and level.                 |
| `GET /v1/me/quests`                         | Their quests, banked dailies and recently finished quests. |
| `POST /v1/me/quests/{id}/reroll`            | Swaps one of their quests for another.                     |
| `GET /v1/me/events`                         | What happened to them recently, oldest first.              |
| `GET /v1/me/events/stream`                  | The same events as they happen, as server-sent events.     |
| `GET /v1/grove`                             | Their Grove: tree, Bloom, care, cones, pity and spirits.   |
| `POST /v1/grove/care`                       | Waters, mists or prunes their tree.                        |
| `POST /v1/grove/cones/buy`                  | Buys cones for Leaf.                                       |
| `POST /v1/grove/cones/open`                 | Opens cones they hold.                                     |
| `PUT /v1/grove/companion`                   | Chooses the spirit that follows them.                      |
| `GET /v1/grove/great`                       | The Great Sequoia's goals this week, and its lanterns.     |
| `POST /v1/grove/great/offer`                | Offers Leaf to the Great Sequoia.                          |
| `GET /v1/grove/rates`                       | The cones' published odds. Public.                         |
| `GET /v1/grove/forest`                      | Every member's tree in the Forest. Public.                 |
| `GET /v1/market/listings`                   | Listings taking orders, newest first. Public.              |
| `GET /v1/market/listings/{id}`              | One listing, however it stands. Public.                    |
| `POST /v1/market/listings`                  | Lists an item or a service.                                |
| `PATCH /v1/market/listings/{id}`            | Changes a listing's price or description.                  |
| `POST /v1/market/listings/{id}/withdraw`    | Stops a listing taking orders.                             |
| `GET /v1/market/my-listings`                | The member's own listings.                                 |
| `POST /v1/market/listings/{id}/buy`         | Buys from a listing, holding the Leaf.                     |
| `GET /v1/market/orders`                     | Orders the member bought or sold, newest first.            |
| `GET /v1/market/orders/{id}`                | One of their orders.                                       |
| `POST /v1/market/orders/{id}/…`             | `deliver`, `confirm`, `cancel` or `dispute` an order.      |
| `GET /v1/conversions/rates`                 | What Leaf converts to, at what rate and cap. Public.       |
| `POST /v1/conversions`                      | Claims Leaf out as LE, a tome or an aspect.                |
| `GET /v1/conversions`                       | The member's claims.                                       |
| `POST /v1/conversions/{id}/cancel`          | Cancels a waiting claim, refunding it.                     |
| `GET /v1/staff/market/disputes`             | Disputed orders. Staff.                                    |
| `POST /v1/staff/market/orders/{id}/resolve` | Releases or refunds a dispute. Staff.                      |
| `GET /v1/staff/conversions`                 | The conversion queue. Staff.                               |
| `POST /v1/staff/conversions/{id}/pay`       | Marks a claim paid in-game. Staff.                         |
| `POST /v1/staff/conversions/{id}/decline`   | Declines a claim, refunding it. Staff.                     |
| `GET /openapi.json`                         | This API as an OpenAPI document.                           |

`/v1/me` routes, and the `/v1/grove`, `/v1/market`, `/v1/conversions` and
`/v1/staff` routes that are not public, take the member's Sequoia session, the token sequoia-backend
issued, as `Authorization: Bearer`; the mod sends the one it already holds for
the backend. The server asks sequoia-backend who the session belongs to, and
remembers a confirmed session for a minute. Only current guild members are let
in.

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
quests, a reroll, three marketplace orders and two conversion claims. `apps/api/test/contract.test.ts` makes those calls on the
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

### Events

An event is something a client would want to show when it happens. Each one is
written in the same transaction as the change it reports, and has an id that
only grows.

| Type                   | When                                                                     | `data`                                                                                     |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `leaf_earned`          | A raid or war paid Leaf.                                                 | `source`, `leaf`, `xp`, `detail`, `occurred_at`, and for a war `in_claim`                  |
| `quest_completed`      | A quest finished and paid.                                               | `quest`, in the shape `/v1/me/quests` uses                                                 |
| `quest_rerolled`       | The member swapped a quest.                                              | `replaced` and `quest`, the old and the new, and `leaf`, what it cost                      |
| `level_up`             | XP reached a new level.                                                  | `level`, and `leaf`, what the levels reached paid                                          |
| `achievement_paid`     | A milestone paid Leaf.                                                   | `award_id`, `ladder`, `milestone`, `tier`, `threshold`, `label`, `leaf`, `xp`, `earned_at` |
| `grove.cone_opened`    | They opened a cone of Dryad or better.                                   | `banner`, `spirit`, `rank`, `verdant`, `copy`                                              |
| `grove.bloomed`        | Their Bloom filled and gave a cone.                                      | `source` (`raid` or `care`), `cycle`                                                       |
| `grove.raid_lantern`   | A raid they were in hung a lantern in the Forest.                        | `raid`, `raid_name`, `party`, `occurred_at`                                                |
| `guild.war_win`        | The guild won a war they fought in.                                      | `war`, `territory`, `players`, `occurred_at`, and `in_claim` when known                    |
| `market.order_placed`  | An order on their listing, or one they placed.                           | `order`, in the shape the marketplace's routes use; the same for both sides                |
| `market.delivered`     | The seller marked an order delivered.                                    | `order`                                                                                    |
| `market.completed`     | The seller was paid: the buyer confirmed, or the days to dispute passed. | `order`                                                                                    |
| `market.cancelled`     | Either side cancelled an order before delivery.                          | `order`, with `cancelled_by`                                                               |
| `market.disputed`      | The buyer disputed a delivered order.                                    | `order`, with `dispute_reason`                                                             |
| `market.resolved`      | Staff released or refunded a dispute.                                    | `order`, with `resolution`                                                                 |
| `conversion.requested` | They claimed Leaf out, and the claim joined the queue.                   | `conversion`, in the shape `/v1/conversions` uses                                          |
| `conversion.paid`      | Staff paid their claim in-game.                                          | `conversion`                                                                               |
| `conversion.declined`  | Staff declined their claim and refunded it.                              | `conversion`, with `decline_reason`                                                        |

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
- A stream carries a comment line every 20 seconds to keep the connection
  open. Ignore lines that start with `:`.

## Sequoia Grove

The Grove is the game the Grove client (`apps/grove`) draws: each member's tree,
the spirits they find in cones, and the Forest where every member's tree stands.
Its numbers are `grove` in `packages/core/src/rules.ts` and its rules are
`packages/core/src/grove.ts`.

- **The tree** has no XP of its own: its level is the member's SEQ level. Its
  variant, one of three looks per level, is a stable hash of the member's UUID
  (FNV-1a, as the client hashes a seed), so it never changes. It can't be bought.
  It grows when its member levels up, which the `level_up` event already says.
- **Bloom** fills by one for each raid the credit sync pays, keyed by the raid's
  own ledger key (`raid:<completion>:<player>`), so a raid read again adds none,
  and by one for each care. At 10 it gives a cone, keyed by the Bloom's number
  (`bloom:<player>:<n>`), and starts again. It never decays.
- **Care**: watering, misting and pruning (`water`, `mist`, `shears`) each spend
  a charge. A charge comes back four hours after it was spent and six bank up,
  so a member who visits once a day loses nothing. Charges are worked out from
  one stored moment, so nothing is written until one is spent; nothing wilts and
  there is no streak.
- **Cones** cost 400 Leaf, one or ten at a time, spent through the ledger with
  sink `cone`. Opening one is `openCone`: the server rolls a whole number below
  2^32 with Web Crypto, and the rank, the spirit, the featured share and the
  Verdant coat all follow from that roll and the member's pity. A cone is a
  Treant or better within 40, and the count carries over between banners. The
  banner on is the latest in `grove.banners` to have started; its featured
  spirit is half its rank's cones. Every cone opened is a row of
  `grove_openings`, with its roll and the pity before and after it, which is
  never changed or deleted, so any cone can be checked against the rules.
- **Spirits**: each copy of a spirit deepens its bond, up to five hearts; the
  fourth copy, and 4% of all cones, wear the Verdant coat. A member's companion
  is one spirit they have opened, which the mod's nametag and the Discord role
  icon can show.
- **The Forest** lists every member who has opened the Grove. Each takes the
  free spot nearest the heart the first time they come, and keeps it: a new
  member never moves anyone. Spots are numbers from 0; the client places them.

Each write names the request it answers with a `request_id` the client makes,
such as a UUID (letters, digits, `-` and `_`, up to 64). Sending a request
again does what it did once: a purchase spends once (`cone:<player>:<request>`
in the ledger) and a care spends one charge. A retried opening answers with the
cones it opened the first time; a retried care or purchase answers with how
things stand now. The same id with a different body is refused.

A body the route doesn't take gets 400 `invalid_request`. Leaf refuses with 409,
changing nothing, and one of these codes:

- `insufficient_leaf`: the balance doesn't cover the cones.
- `request_conflict`: the request id was used before for something else.
- `not_enough_cones`: they hold fewer cones than they asked to open.
- `no_charges`: the tree has had all the care it can take until a charge comes back.
- `no_banner`: no banner is on, so cones can't be opened.
- `not_owned`: a companion they have not opened.

An offering outside 100 to 10,000 whole Leaf gets 400 `invalid_offering`.

`GET /v1/grove/rates` publishes the odds from the same rules a cone is opened
with: each rank's chance and each spirit's, the pity, the Verdant coat, the
price and the care. `GET /v1/grove/forest` answers `{ "trees": [{ "player_id",
"name", "level", "variant", "spot", "companion" }] }`, nearest the heart first.
Neither needs a session.

The Grove's tables keep each member's totals and spirits by trigger
(`grove_totals`, `grove_spirits`), as `accounts` is kept from the ledger, so
`GET /v1/grove` costs the same however long a member has played.

### The Great Sequoia

The tree at the Forest's heart has three guild goals a week, Monday to Monday in
UTC: raids, Leaf offered and wars (`great` in `rules.ts`). A raid party's run
counts once however many members it credits, and so does a war. Members offer
Leaf with `POST /v1/grove/great/offer` and `{ "leaf", "request_id" }`, 100 to
10,000 at a time, spent through the ledger with sink `offering`
(`offering:<player>:<request>`), so a request sent again offers once. It answers
`{ "leaf", "offered", "glow" }`: the balance, what they offered this week, and
their lantern's glow.

Everyone who helps in a week, by raiding, warring or offering, hangs a lantern.
A lantern's glow steps up at 1, 10 and 30 contributions (a raid, a war, or 100
Leaf offered), a cosmetic extra for helping more; it is a step, not a place, and
nothing ranks who helped most. The rewards are cosmetic and for everyone: a goal
met gives the whole guild its reward until the end of the next week. Each week
a member helped is a ring on their tree.

`GET /v1/grove/great` answers the week and last week, each with its `goals`
(`progress`, `target`, `met` and `reward`), the `rewards` everyone has now, the
`lanterns` in the order their members first helped, the member's own `lantern`,
`glow`, `offered` and `rings`, and the `offering` limits.

Triggers add each week up as activities and offerings are recorded
(`great_weeks`, `great_helpers`), so reading a busy week takes as long as a
quiet one.

## The marketplace

Members trade in-game items and services with each other for Leaf. It belongs
to Leaf as a whole: the Grove client shows it as the Trading Post, and the
website and mod can use the same routes. The numbers are `market` in
`packages/core/src/rules.ts` and the rules are `packages/core/src/market.ts`.

- **A listing** is an `item` or a `service`, with a title (3 to 80 characters),
  a description (up to 1,000), a price of 1 to 1,000,000 Leaf a unit, and a
  quantity of 1 to 64. It has no images, which keeps moderation light. It
  takes orders for 14 days. A seller may have 20 taking orders at once, may
  change its price and description only while no order on it is open, and may
  withdraw it, which leaves the orders already open to carry on.
  `POST /v1/market/listings` takes `{ "kind", "title", "description"?, "price",
"quantity"?, "request_id" }`; a request sent again makes one listing.
- **Buying** holds the buyer's Leaf: a spend with sink `market_hold`, keyed by
  the order (`market_hold:<order>`). `POST /v1/market/listings/{id}/buy` takes
  `{ "price", "quantity"?, "request_id" }`, where `price` is the unit price the
  buyer was shown: Leaf holds that or nothing (`price_changed`). Nobody can buy
  their own listing, or from one withdrawn or expired.
- **Delivering and confirming**: the seller marks the order delivered and the
  buyer confirms, which pays the seller an earn with source `market_sale`
  (`market_sale:<order>`), less the fee, which is 0 for now. A sale grants no
  XP: Leaf passed between members is not guild activity, and would otherwise
  level two members trading back and forth. The buyer may confirm before the
  seller marks it, or while disputing it. A delivered order nobody disputes
  confirms itself 7 days after delivery: a job checks every minute.
- **Cancelling**: either side may cancel before delivery, which refunds the
  buyer by reversing the hold (`undo:market_hold:<order>`). The hold is undone
  in full, by the ledger's own rule that an entry is reversed at most once, and
  a refund is not new Leaf, so it is a reversal rather than an earn.
- **Disputes**: the buyer may dispute a delivered order with a reason. Staff
  see the disputes and release the Leaf to the seller or refund the buyer,
  with a note both sides see. Staff can't settle an order they are a side of.

Every step an order takes is a row of `market_order_steps`, once each, with
the role and the player who took it (none for Leaf's own confirmation), and a
trigger lets an order only move forward, so a seller can never be paid after
a refund nor a buyer refunded after a sale. Every change to a listing is a row
of `market_listing_changes`. Neither table is ever changed or deleted. Each
step answers the order as it is when it was taken before, so a retry is safe.

An order is the same for both sides, in every answer and event:
`{ "id", "listing": { "id", "kind", "title" }, "seller", "buyer", "quantity",
"price", "leaf", "fee", "state", "placed_at", "delivered_at", "disputed_at",
"closed_at", "auto_confirms_at", "cancelled_by", "dispute_reason", "resolution" }`.
`state` is `placed`, `delivered`, `disputed`, `completed`, `cancelled` or
`refunded`. Who on staff settled a dispute is recorded but not sent.

`GET /v1/market/listings` takes `kind`, `q` (words in the title or the
description), `limit` (up to 100, 50 by default) and `before`, the
`next_before` of the page before. It and `GET /v1/market/listings/{id}` need
no session.

## Conversions

Leaf converts out to Liquid Emeralds, tomes and aspects, which staff pay
in-game. The rates are `conversions` in `rules.ts`, the Branchmasters' first
proposal, marked `provisional` until they are tuned with them: 200 Leaf to 1
LE, 32 to 64 LE at a time; 4,000 Leaf for a tome or an aspect.

- `POST /v1/conversions` with `{ "kind", "count"?, "note"?, "request_id" }`
  spends the Leaf at once, sink `conversion`, keyed by the claim
  (`conversion:<id>`), and puts the claim in its kind's queue. `count` is how
  many LE; 1, when left out, for a tome or an aspect. `note` says which.
- **A monthly cap** guards the guild's budget: 100 LE, 4 tomes and 4 aspects a
  calendar month in UTC, for everyone. A claim past it is still taken and
  held, and waits, in the order claims were made, for the first month with
  room. It is never dropped. No claim passes one made before it, a month's
  unclaimed allowance doesn't carry over, and when a claim ahead leaves the
  queue the ones behind move up. Each claim says the month it is due from
  (`due_from`), whether staff can pay it now (`due`) and its place (`position`).
  `allotMonths` in `packages/core/src/conversions.ts` decides it.
- **Each member** may claim 64 LE, one tome and one aspect a month, so one
  member can't hold the whole queue.
- **Staff** pay a claim once its month has come, which records the month whose
  allowance paid it and who paid it, or decline it with a reason, which
  refunds it by reversing the spend (`undo:conversion:<id>`). A member may
  cancel their own claim while it waits, with the same refund. Staff can't pay
  their own claim. A claim is closed once; a trigger keeps it as it was then.

At launch Leaf was issued at about 118,000 a day, about 590 LE a day at 200 to
1, against a budget of about 100 LE a month: the queue will be long. The cap,
not the rate, is what keeps payouts inside the budget.

`GET /v1/conversions/rates`, with no session, publishes each kind's rate,
counts, cap and member limit, and the month a claim made now would be due from.

## Staff

Staff are members sequoia-backend marks as website administrators
(`website_admin`), the narrowest notion of staff its session check gives; the
`/v1/staff` routes answer anyone else 403 `not_staff`. Each staff step records
the staff member's player id, in the audit and as the ledger entry's `actor`.

The marketplace and conversions answer `{ "code", "message" }` errors: 400
`invalid_request`, `invalid_listing` or `invalid_count`; 403 `not_seller`,
`not_buyer`, `own_order` or `own_claim`; 404 `listing_not_found`,
`order_not_found` or `conversion_not_found` (also for an order or claim that
isn't the member's); and 409, changing nothing, `insufficient_leaf`,
`request_conflict`, `own_listing`, `listing_closed`, `sold_out`,
`price_changed`, `has_open_orders`, `too_many_listings`, `already_delivered`,
`not_delivered`, `not_disputed`, `order_closed`, `member_limit`, `not_pending`
or `not_due`.

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
- **`BACKEND_URL=http://sequoia-backend:8081`**, the backend's address on the
  server's private Docker network, so the credit feed and session checks never
  leave the machine.
- **`BACKEND_INTERNAL_TOKEN`**, the backend's `APP_INTERNAL_API_TOKEN`.
  Sierra takes the same token.
- **`SIERRA_URL=http://sequoia-sierra:8082`**, Sierra's internal API on the
  same network, for the awards feed.
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
