import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Whether a Coins entry is weighed against what a player may earn: 0 for Coins given back for
// something paid for, or paid by Leaf's own clock (the Works' till), which the cap leaves alone.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE coin_entries ADD COLUMN earned INTEGER NOT NULL DEFAULT 1 CHECK (earned IN (0, 1))`;
});
