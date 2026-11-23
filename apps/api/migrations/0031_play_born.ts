import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// When each player's state in a game was made, by Leaf's clock: its generation, which names the
// keys of the Coins and Leaf its commands pay and take, so that a state made again (the staff taking
// away one that will not read) never meets a key of the one before it. 0 for a state made before
// this, whose keys stay as they were.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE play_state ADD COLUMN born INTEGER NOT NULL DEFAULT 0`;
});
