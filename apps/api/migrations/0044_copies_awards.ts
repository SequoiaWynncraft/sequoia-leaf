import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// The pulls award each further copy of a prize, up to the seventh, as `copies:<prize>:<n>` (n from
// 2 to 7), which the Little Raid reads a figure's level from. Leaf keeps a game's awards as a batch
// changes its state, so each player who has pulled already is given theirs here, from the `have`
// of their stored pulls, without the retired wares the game lets go of as it reads a state.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT OR IGNORE INTO awards (player_id, id, at)
    SELECT s.player_id, 'copies:' || h.key || ':' || n.value, s.updated_at
    FROM play_state AS s, json_each(s.state, '$.have') AS h, json_each('[2,3,4,5,6,7]') AS n
    WHERE s.game = 'pulls' AND json_valid(s.state) AND h.key NOT LIKE 'ware:%' AND n.value <= h.value
  `;
});
