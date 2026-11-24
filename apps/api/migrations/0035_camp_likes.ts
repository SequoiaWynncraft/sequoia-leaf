import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// The likes of camps (`camp_likes`): one row a person and a camp they have ever liked, kept when
// the like is taken back, so that the camp's owner is told of it once. `first_at` is when it was
// first given, `at` when it was last given, and `liked` whether it stands now.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE camp_likes (
      liker_id TEXT,
      owner_id TEXT,
      first_at INTEGER NOT NULL,
      at       INTEGER NOT NULL,
      liked    INTEGER NOT NULL CHECK (liked IN (0, 1)),
      PRIMARY KEY (liker_id, owner_id)
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`CREATE INDEX camp_likes_by_owner ON camp_likes (owner_id, liked, at)`;
});
