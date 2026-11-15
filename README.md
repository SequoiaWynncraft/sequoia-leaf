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

The foundation is in place: the Leaf ledger, with tests. There are no player
or staff endpoints yet, and nothing is deployed.

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
