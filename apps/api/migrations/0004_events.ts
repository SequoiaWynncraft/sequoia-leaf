import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // What happened to each player, in the order it happened, for clients to show
  // as it happens: Leaf earned, a quest finished, a level gained.

  // An event is written in the same transaction as the change it reports, so
  // there is never one without the other. Clients read forward from the last
  // event id they have seen and miss nothing while disconnected.
  yield* sql`
    CREATE TABLE events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id  TEXT    NOT NULL,
      type       TEXT    NOT NULL,
      -- The event's details as JSON, in the shape the API sends.
      data       TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT
  `;

  yield* sql`
    CREATE INDEX events_by_player ON events (player_id, id)
  `;
});
