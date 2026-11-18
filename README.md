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
- **Repeatable.** Always one; finishing it unlocks the next.

A quest asks for one or two of these. Most ask for two, raids or wars, as in
"Complete 3 NOL raids or 9 wars", so raiders and warrers can both finish them.
Each keeps its own progress, and whichever is met first finishes the quest. A
war goal asks three wars for each raid the quest is worth, because a war takes
about a third of a raid's time.

| Objective       | Example                    | What counts                                                  |
| --------------- | -------------------------- | ------------------------------------------------------------ |
| `raids`         | "Complete 2 raids"         | Every raid, or only one named raid ("Complete 3 NOL raids"). |
| `wars`          | "Take part in 2 wars"      | Every war the member took part in.                           |
| `season_rating` | "Earn 1,000 season rating" | The season rating of every raid and war they took part in.   |

A quest counts the activities the credit sync records, in the same database
transaction that records them, and a finished quest pays its Leaf and XP in
that transaction too. Between activities nothing is written: what a member sees is
calculated from their last stored state.

## API

Responses are JSON with `snake_case` fields. Errors are `{ "code", "message" }`.

| Route                      | What it returns                                            |
| -------------------------- | ---------------------------------------------------------- |
| `GET /healthz`             | `{ "status": "ok" }`                                       |
| `GET /v1/me`               | The signed-in member's Leaf, XP and level.                 |
| `GET /v1/me/quests`        | Their quests, banked dailies and recently finished quests. |
| `GET /v1/me/events`        | What happened to them recently, oldest first.              |
| `GET /v1/me/events/stream` | The same events as they happen, as server-sent events.     |

`/v1/me` routes take the member's Sequoia session, as `Authorization: Bearer`
or as the site's `seq_session` cookie. The server asks sequoia-backend who the
session belongs to; the mod can send the token it already holds for the
backend. Only current guild members are let in.

Each quest in `/v1/me/quests` lists its `goals`, every way to finish it, each
with its own `type`, `raid`, `title`, `progress` and `target`. Its `objective`,
`progress` and `target` repeat the goal nearest to being met, for clients that
show one bar.

`GET /v1/me/quests?sync=1` reads the credit feed first, at most once every 15
seconds, so a raid that just finished shows up without waiting for the next
scheduled run.

### Events

An event is something a client would want to show when it happens. Each one is
written in the same transaction as the change it reports, and has an id that
only grows.

| Type               | When                       | `data`                                                                                     |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------ |
| `leaf_earned`      | A raid or war paid Leaf.   | `source`, `leaf`, `xp`, `detail`, `occurred_at`, and for a war `in_claim`                  |
| `quest_completed`  | A quest finished and paid. | `quest`, in the shape `/v1/me/quests` uses                                                 |
| `level_up`         | XP reached a new level.    | `level`, and `leaf`, what the levels reached paid                                          |
| `achievement_paid` | A milestone paid Leaf.     | `award_id`, `ladder`, `milestone`, `tier`, `threshold`, `label`, `leaf`, `xp`, `earned_at` |

`detail` is the raid's name or the territory fought over. `occurred_at` is when
the raid or war was played, which can be well before the event: a credit that
appears late is paid, and reported, when it appears. `in_claim` is `true` for a
war over a territory in Sequoia's claim, a defence, which pays twice as much per
war point; `false` for an FFA war or a snipe; and left out when the backend
could not tell.

`GET /v1/me/events` answers `{ "events": [{ "id", "type", "created_at", "data" }] }`.
With `?after=<id>` it lists up to 100 events after that id; without, the newest 50.

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
