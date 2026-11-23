import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// The pieces of a player's that a game asks Leaf to keep apart from their state (`Done.keep`), one
// for each slot, the newest over any older: `data` is JSON. Each member who has pulled already gets
// the pulls' `have` from their stored state, as a pull would leave it, without the retired wares
// the game lets go of as it reads a state.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE play_kept (
      player_id  TEXT    NOT NULL,
      game       TEXT    NOT NULL,
      slot       TEXT    NOT NULL,
      data       TEXT    NOT NULL CHECK (json_valid(data)),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, game, slot)
    ) STRICT
  `;
  yield* sql`
    INSERT INTO play_kept (player_id, game, slot, data, updated_at)
    SELECT s.player_id, 'pulls', 'have', json_group_object(h.key, h.value), s.updated_at
    FROM play_state AS s, json_each(s.state, '$.have') AS h
    WHERE s.game = 'pulls' AND s.guest = 0 AND json_valid(s.state) AND h.key NOT LIKE 'ware:%'
    GROUP BY s.player_id
  `;
});
