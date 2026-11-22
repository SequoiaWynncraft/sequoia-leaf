import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Guild requests sequoia-backend buys for a member with their Leaf, each by a key the backend gives
// it. The spend is the ledger's (`purchase:<key>`), and a refund is its reversal. A key the backend
// cancels is kept here, so that a purchase that reaches Leaf after the backend gave up on it is
// refused, not charged.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE cancelled_purchases (
      key          TEXT    PRIMARY KEY,
      cancelled_at INTEGER NOT NULL
    ) STRICT
  `;
});
