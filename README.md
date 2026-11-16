# sequoia-leaf

The service behind Leaf, the Sequoia guild currency, and the game built on it.
Members earn Leaf from guild activity such as raids and wars, and spend it.

It is one Bun process with a SQLite database file, written in TypeScript. Bun
is the whole toolchain: runtime, package manager, formatter (`bun fmt`), type
checker (`bun check`), test runner and the SQLite driver. Linting is oxlint
with type-aware rules.

## Status

Live at `https://leaf.seqwawa.com` since 16 November 2026. It reads
sequoia-backend's player credit feed every minute, pays Leaf and XP for raids
and wars, and runs quests on top of them. Signed-in members can read their
balance, level and quests. There is no way to spend Leaf yet and there are no
staff endpoints.

Production is moving from a Cloudflare Worker to the Sequoia server. Until
that is done, `leaf.seqwawa.com` is served by the Worker built from commit
`8448be8`.

## Getting started

```sh
mise install     # install the pinned bun
bun install
bun run verify   # format check, lint, typecheck and test
bun fmt          # format everything
bun run dev      # run the server at http://localhost:3000, restarting on changes
```

The server is configured with environment variables:

| Variable                 | Default                   | What it is                                              |
| ------------------------ | ------------------------- | ------------------------------------------------------- |
| `PORT`                   | `3000`                    | The port to listen on.                                  |
| `DATABASE_PATH`          | `data/leaf.db`            | The SQLite file. It is created when missing.            |
| `BACKEND_URL`            | `https://api.seqwawa.com` | sequoia-backend, for the credit feed and session check. |
| `BACKEND_INTERNAL_TOKEN` | none                      | sequoia-backend's `APP_INTERNAL_API_TOKEN`.             |

Without `BACKEND_INTERNAL_TOKEN` the server answers requests but does not read
the credit feed, which is what local development wants.

## Layout

| Path                  | What it is                                                    |
| --------------------- | ------------------------------------------------------------- |
| `packages/core`       | The rules of the game as pure functions and types. No I/O.    |
| `apps/api`            | The server: HTTP routes, the database and the credit sync.    |
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

## Quests

Every member has three quest slots. The templates and rewards are in
`packages/core/src/rules.ts`.

- **Daily.** One becomes available each UTC day, and up to three bank up, so
  playing every third day loses nothing. Finishing one starts the next banked
  one at once. There are no streaks.
- **Weekly.** One per week, Monday to Monday in UTC. It expires with the week.
- **Repeatable.** Always one; finishing it unlocks the next.

A quest counts the activities the credit sync records, in the same database
transaction that records them, and a finished quest pays its Leaf and XP in
that transaction too. Between activities nothing is written: what a member sees is
calculated from their last stored state.

## API

Responses are JSON with `snake_case` fields. Errors are `{ "code", "message" }`.

| Route               | What it returns                                            |
| ------------------- | ---------------------------------------------------------- |
| `GET /healthz`      | `{ "status": "ok" }`                                       |
| `GET /v1/me`        | The signed-in member's Leaf, XP and level.                 |
| `GET /v1/me/quests` | Their quests, banked dailies and recently finished quests. |

`/v1/me` routes take the member's Sequoia session, as `Authorization: Bearer`
or as the site's `seq_session` cookie. The server asks sequoia-backend who the
session belongs to; the mod can send the token it already holds for the
backend. Only current guild members are let in.

`GET /v1/me/quests?sync=1` reads the credit feed first, at most once every 15
seconds, so a raid that just finished shows up without waiting for the next
scheduled run. A client that wants a pop-up when a quest completes calls this
shortly after the player finishes a raid or war, and shows the quests in
`recently_completed` it has not shown before.

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

The production image is the `Dockerfile` at the root. It runs the server as an
unprivileged user and keeps the database in `/data`, which has to be a volume
that survives deploys:

```sh
docker build --tag sequoia-leaf .
docker run --publish 3000:3000 --volume leaf-data:/data --env BACKEND_INTERNAL_TOKEN=... sequoia-leaf
```

The server applies new migrations when it starts, before it takes requests. It
is built to run as a single instance: SQLite has one writer, and the credit
sync's schedule lives in the process.

The `seqwawa.com` zone redirects every hostname that is not on an allowlist to
the main site (the "Catch-all unused" redirect rule). `leaf.seqwawa.com` is on
that list; a new hostname has to be added to it before it will serve anything.
