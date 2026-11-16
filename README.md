# sequoia-leaf

The service behind Leaf, the Sequoia guild currency, and the game built on it.
Members earn Leaf from guild activity such as raids and wars, and spend it.

It runs on Cloudflare Workers with a D1 database, and is written in TypeScript.
Bun is the toolchain: package manager, formatter (`bun fmt`), type checker
(`bun check`) and test runner. Linting is oxlint with type-aware rules.

Node.js is installed for one reason: Cloudflare's tools need it. Wrangler does
not support running on Bun, and the Worker tests use Vitest with Cloudflare's
plugin, which runs them inside the Workers runtime through wrangler.

## Status

Live at `https://leaf.seqwawa.com` since 16 November 2026. The Worker reads
sequoia-backend's player credit feed every minute, pays Leaf and XP for raids
and wars, and runs quests on top of them. Signed-in members can read their
balance, level and quests. There is no way to spend Leaf yet and there are no
staff endpoints.

## Getting started

```sh
mise install     # install the pinned bun and node
bun install
bun run verify   # format check, lint, typecheck and test
bun fmt          # format everything
bun run dev      # run the Worker at http://localhost:8787
```

## Layout

| Path                  | What it is                                                 |
| --------------------- | ---------------------------------------------------------- |
| `packages/core`       | The rules of the game as pure functions and types. No I/O. |
| `apps/api`            | The Cloudflare Worker: HTTP routes and the D1 database.    |
| `apps/api/migrations` | The database schema, applied in order.                     |

## How Leaf is earned

sequoia-backend records raids and wars. Its `/internal/player-credits` endpoint
lists who took part in each one. The Worker reads it on a schedule:

- Every minute it reads the events since its last run, once they are 30 seconds
  old, and records each player's part as an activity together with the Leaf it
  pays. The rates are in `packages/core/src/rules.ts`.
- Every hour it re-reads the last week, to pick up credits that appear late,
  such as a war scored afterwards or a name matched to a player afterwards.

Each credit carries the backend's event id and the player's UUID, so reading
the same events again pays nothing twice. Nothing that happened before the
Worker's first run is ever credited.

The Worker needs the backend's internal token as the secret
`BACKEND_INTERNAL_TOKEN`. Without it, it serves requests but skips the feed.

## Quests

Every member has three quest slots. The templates and rewards are in
`packages/core/src/rules.ts`.

- **Daily.** One becomes available each UTC day, and up to three bank up, so
  playing every third day loses nothing. Finishing one starts the next banked
  one at once. There are no streaks.
- **Weekly.** One per week, Monday to Monday in UTC. It expires with the week.
- **Repeatable.** Always one; finishing it unlocks the next.

A quest counts the activities the credit sync records, in the same database
batch that records them, and a finished quest pays its Leaf and XP in that
batch too. Between activities nothing is written: what a member sees is
calculated from their last stored state.

## API

Responses are JSON with `snake_case` fields. Errors are `{ "code", "message" }`.

| Route               | What it returns                                            |
| ------------------- | ---------------------------------------------------------- |
| `GET /healthz`      | `{ "status": "ok" }`                                       |
| `GET /v1/me`        | The signed-in member's Leaf, XP and level.                 |
| `GET /v1/me/quests` | Their quests, banked dailies and recently finished quests. |

`/v1/me` routes take the member's Sequoia session, as `Authorization: Bearer`
or as the site's `seq_session` cookie. The Worker asks sequoia-backend who the
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
   function in `core`, with a test beside it. Worker tests run against a real
   local D1 database; the database is never mocked.

## Deploying

Nothing deploys automatically. From `apps/api`, signed in to the Sequoia
Cloudflare account:

```sh
wrangler d1 migrations apply sequoia-leaf --remote   # only when there are new migrations
wrangler deploy
```

Apply migrations before deploying code that needs them. The Worker's one
secret, `BACKEND_INTERNAL_TOKEN`, is sequoia-backend's `APP_INTERNAL_API_TOKEN`
and is set with `wrangler secret put BACKEND_INTERNAL_TOKEN`.

The `seqwawa.com` zone redirects every hostname that is not on an allowlist to
the main site (the "Catch-all unused" redirect rule). `leaf.seqwawa.com` is on
that list; a new hostname has to be added to it before it will serve anything.
