import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Earlier copies of saves, so that a save written over can be put back: what each write replaced
// (`earlier`, at most one a minute a slot), and copies a game sent that were refused as
// written over an older version (`refused`, the same). Kept a week.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE save_history (
      player_id TEXT    NOT NULL,
      slot      TEXT    NOT NULL,
      kind      TEXT    NOT NULL CHECK (kind IN ('earlier', 'refused')),
      version   INTEGER NOT NULL,
      data      TEXT    NOT NULL,
      saved_at  INTEGER NOT NULL,
      kept_at   INTEGER NOT NULL
    ) STRICT
  `;
  yield* sql`CREATE INDEX save_history_by_slot ON save_history (player_id, slot, kind, kept_at)`;
  yield* sql`CREATE INDEX save_history_by_age ON save_history (kept_at)`;
});
