import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// When each state of a game that goes on by itself is next due a tend from Leaf (`due_at`): two
// minutes after it was written (`TEND_AFTER`), or null once Leaf has found it standing still, never
// to go on by itself until a command moves it. A row written some other way (a tool, a test) is
// due at once. The sweep reads only the rows due, from an index, instead of every row of the game.
// The Works is the one game that goes on by itself; the others' rows are never due.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE play_state ADD COLUMN due_at INTEGER DEFAULT 0`;
  yield* sql`UPDATE play_state SET due_at = CASE WHEN game = 'works' THEN updated_at + 120000 END`;
  yield* sql`CREATE INDEX play_state_due ON play_state (game, due_at) WHERE due_at IS NOT NULL`;
});
