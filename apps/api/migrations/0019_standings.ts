import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Where each player's state in a game with a board stands: the game's score for it, and the few
// numbers shown beside it (`also`, as JSON), written whenever a batch changes the state.
// `updated_at` is when the score was last reached, so that a tie goes to whoever reached it first.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE standings (
      player_id  TEXT,
      game       TEXT,
      score      INTEGER NOT NULL,
      also       TEXT    NOT NULL,
      guest      INTEGER NOT NULL CHECK (guest IN (0, 1)),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, game)
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`CREATE INDEX standings_by_score ON standings (game, score DESC, updated_at)`;
});
