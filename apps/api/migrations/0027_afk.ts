import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Time AFK beside time played: `afk_ms` is how long each player has had a game open while away from
// the keys, in milliseconds, and `afk` whether their last call there said they were (`PlayStore.heard`).
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE played ADD COLUMN afk_ms INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE played ADD COLUMN afk INTEGER NOT NULL DEFAULT 0 CHECK (afk IN (0, 1))`;
});
