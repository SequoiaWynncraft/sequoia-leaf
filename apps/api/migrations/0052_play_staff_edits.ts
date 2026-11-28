import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Every staff edit applied through the play service (`StaffCommand` with edit metadata), kept so
// staff can inspect past edits and undo them cleanly. Never shown to players. `before` is the exact
// serialized state the command ran on, captured inside the play service's write transaction beside
// `rev_before` and `rev_after`; `command` is a compact JSON summary without large payloads.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE play_staff_edits (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id  TEXT    NOT NULL,
      game       TEXT    NOT NULL,
      command_id TEXT    NOT NULL,
      rev_before INTEGER NOT NULL CHECK (rev_before >= 0),
      rev_after  INTEGER NOT NULL CHECK (rev_after >= 0),
      before     TEXT    NOT NULL,
      command    TEXT    NOT NULL CHECK (json_valid(command)),
      by         TEXT    NOT NULL,
      at         INTEGER NOT NULL,
      UNIQUE (player_id, game, command_id)
    ) STRICT
  `;
  yield* sql`CREATE INDEX play_staff_edits_by_player ON play_staff_edits (player_id, game, id DESC)`;
});
