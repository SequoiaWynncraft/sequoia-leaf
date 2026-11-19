# sequoia-leaf

The service behind Leaf, the Sequoia guild currency, and the game built on it.
Members earn Leaf from guild activity such as raids and wars, and spend it.

It is one Bun process with a SQLite database file, written in TypeScript. Bun
is the whole toolchain: runtime, package manager, formatter (`bun fmt`), type
checker (`bun check`), test runner and the SQLite driver. Linting is oxlint
with type-aware rules.

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

| Path                  | What it is                                                    |
| --------------------- | ------------------------------------------------------------- |
| `packages/core`       | The rules of the game as pure functions and types. No I/O.    |
| `apps/api`            | The server: HTTP routes, the database and the feed syncs.     |
| `apps/api/migrations` | The database schema. New files are applied in order at start. |
| `Dockerfile`          | The production image.                                         |

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

Responses are JSON with `snake_case` fields. Errors are `{ "code", "message" }`.

| Route                            | What it returns                                            |
| -------------------------------- | ---------------------------------------------------------- |
| `GET /healthz`                   | `{ "status": "ok" }`                                       |
| `GET /v1/me`                     | The signed-in member's Leaf, XP and level.                 |
| `GET /v1/me/quests`              | Their quests, banked dailies and recently finished quests. |
| `POST /v1/me/quests/{id}/reroll` | Swaps one of their quests for another.                     |
| `GET /v1/me/events`              | What happened to them recently, oldest first.              |
| `GET /v1/me/events/stream`       | The same events as they happen, as server-sent events.     |

`/v1/me` routes take the member's Sequoia session, as `Authorization: Bearer`
or as the site's `seq_session` cookie. The server asks sequoia-backend who the
session belongs to; the mod can send the token it already holds for the
backend. Only current guild members are let in.

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
- A quiet stream carries a comment line every 20 seconds to keep the
  connection open. Ignore lines that start with `:`.

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
    `db.transaction`, so none of them exists without the others.

## Deploying

Merging to `main` deploys. Coolify on the Sequoia server builds the
`Dockerfile` and replaces the running container; the app is `sequoia-leaf-prod`
in the `sequoia-leaf` project. The server applies new migrations when it
starts, before it takes requests.

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

## Correcting raid shares, 2026-11-19

Until sequoia-backend#530, the credit feed gave every raid party member the
whole party's season rating, so each was paid about 3.3 times their share, in
Leaf and in XP. The guild decided the excess is taken back. The feed now gives
each member their share, so raids paid from then on are right, and
`apps/api/scripts/correct-raid-shares.ts` corrects the ones paid before.

It reads the corrected feed from the credit sync's first run to now, 31 days
at a time, and then, for each player in a transaction of their own, looks at
each raid payment the sync made (`raid:<completion id>:<player>`) before the
cutoff given as `--paid-before`:

- A payment that is more than the member's share is reversed in full, Leaf and
  XP, by `undo:raid:<completion id>:<player>`, and the share is paid in its
  place by `raid:<completion id>:<player>:share`. A share of zero pays nothing.
- A payment that is the share or less stands.
- A payment the feed no longer lists under its completion id stands, and the
  report lists it in `payments_without_feed_row` with its completion id,
  player, Leaf, XP and `created_at`, to be reconciled by hand. That happens
  when a name no longer resolves, or became ambiguous, or when the backend
  merged two reports into one completion after the sync paid the other id.
  The correction does not try to match the ids itself.
- With the XP corrected, the payout of each level the player no longer reaches
  is reversed (`undo:level:<player>:<level>`). Reaching that level again pays it
  again, once, keyed `level:<player>:<level>:2`.

A player is corrected entirely or not at all. The correction writes no events:
there is no event type for it, and the mod would not know one. Players see the
corrected balance, XP and level the next time they read them.

It is idempotent. A payment that has been reversed is not looked at again, and
the shares' keys are not raid payment keys, so running it again with the same
`--paid-before` changes nothing. A run that stops partway leaves the players it
reached corrected, and the next run does the rest.

### The cutoff

`--paid-before` is required and has no default. Give the moment the backend's
fix went live: its new container started at about 07:53 UTC on 2026-11-19, so
`2026-11-19T07:53:00Z`. A sync run stamps its payments with the moment it
started, before it reads the feed, and the new container served only after it
started, so every payment made before then was paid from the old feed.

A payment made at or after the cutoff stands, even when the feed now lists a
smaller share for it. It was paid from the fixed feed, and a smaller share now
means the backend has since added members to the completion: its
reconciliation can add names to a completion it already reported, under the
same id, which divides the rating among more members. Taking that back would
take back a payment that was right when it was made.

An earlier cutoff is the safe side: it can leave an overpayment standing, but
never takes back a payment of the share. The report lists every payment made
after the cutoff that the feed now lists at a smaller share, in
`payments_after_cutoff_above_share`, so one left standing can be found and
dealt with by hand.

### Running it

Run it in the production container, from a terminal on the Coolify app or with
`docker exec` on the server. It uses the app's own `DATABASE_PATH`,
`BACKEND_URL` and `BACKEND_INTERNAL_TOKEN`, and refuses a `DATABASE_PATH` that
does not exist rather than create an empty database, which would have nothing
to correct.

Run the dry run on a copy of the database, never on `/data/leaf.db` itself. It
does everything in one transaction and rolls it back, so it keeps nothing, but
it opens and migrates the database it is given, and it holds that database's
write lock until it ends, which stalls the server's writes for the whole run.
Copy the database with `VACUUM INTO`, which takes a consistent copy while the
server runs, and point `DATABASE_PATH` at the copy:

```sh
bun -e 'import { Database } from "bun:sqlite"; new Database("/data/leaf.db", { readonly: true }).run("VACUUM INTO ?", ["/tmp/leaf-dry-run.db"])'
DATABASE_PATH=/tmp/leaf-dry-run.db bun run apps/api/scripts/correct-raid-shares.ts --paid-before 2026-11-19T07:53:00Z
rm /tmp/leaf-dry-run.db*
```

Then apply it to the live database, with the server running:

```sh
bun run apps/api/scripts/correct-raid-shares.ts --paid-before 2026-11-19T07:53:00Z --apply
```

`--apply` first writes a snapshot to `BACKUP_DIR` (`/data/backups`), since a
reversal cannot itself be reversed. Restoring it as under [Backups](#backups)
undoes the correction, and everything else written after it. It then corrects
one player at a time, each in a short transaction. A credit sync that runs
meanwhile waits for each to finish: its write transaction takes the write lock
when it begins, so a correction's commit cannot land between its reads and its
writes.

Either prints one JSON object: the cutoff, how many players and payments were
corrected, the Leaf and XP the reversals took back and the shares paid, the
level payouts reversed, the net change, how many players lost a level and the
most any lost, the payments without a feed row and the payments after the
cutoff the feed now lists lower, each listed, and the five players it took the
most Leaf from, by UUID.

### What it leaves as it is

- **Quest rewards.** A `season_rating` quest finished with the inflated rating
  keeps its reward, Leaf and XP, and an open one keeps the progress it counted.
  That is the owner's decision: quest rewards are outside the correction. The
  XP such a reward paid still counts toward levels.
- **What was recorded.** The `activities` table keeps the rating each raid was
  recorded with, and nothing is counted again from it.
- **Payments it does not correct**: those at or below the share, those made at
  or after the cutoff, and those the feed no longer lists. The report lists the
  last two kinds where they may be wrong.
- **Wars and achievement milestones**, which the fix did not touch, and level
  payouts for levels the corrected XP still reaches.
- **Events already sent.** `leaf_earned` and `level_up` events keep the amounts
  they announced.
