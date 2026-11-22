import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Who played, when, where and for how long, for the staff alone: each stay in a place (`visits`),
// each sitting (`sessions`, visits less than five minutes apart), and one row a player
// (`players_seen`). Visits and sessions are kept 180 days; `players_seen` and `activity` for good.
// No IP address, browser string, or where a player walks is kept.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // `ended_at` is null while one of its visits is open. `places` is the seconds in each place, as a
  // JSON object (`{"town": 840, "camp": 60}`); `seconds` is the sum of its visits'. `device` is what
  // the page said it was on at sign-in, null when it said nothing.
  yield* sql`
    CREATE TABLE sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id  TEXT    NOT NULL,
      guest      INTEGER NOT NULL CHECK (guest IN (0, 1)),
      started_at INTEGER NOT NULL,
      ended_at   INTEGER,
      seconds    INTEGER NOT NULL DEFAULT 0 CHECK (seconds >= 0),
      device     TEXT    CHECK (device IN ('phone', 'desktop')),
      places     TEXT    NOT NULL DEFAULT '{}'
    ) STRICT
  `;
  yield* sql`CREATE INDEX sessions_by_player ON sessions (player_id, started_at)`;
  yield* sql`CREATE INDEX sessions_by_end ON sessions (ended_at)`;

  // One stay in a place. `source` is how Leaf knows of it: a live room, or the page's presence
  // calls. `heard_at` is the last time Leaf heard the player was there; a visit not heard of for
  // 90 seconds is closed then. `instance` is the Leaf process that last heard of it: during a
  // deploy two run on this file, and the one stopping closes only the open visits still its own.
  // `left_at` is null while they are there. A player has at most one open visit.
  yield* sql`
    CREATE TABLE visits (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
      player_id  TEXT    NOT NULL,
      guest      INTEGER NOT NULL CHECK (guest IN (0, 1)),
      place      TEXT    NOT NULL,
      source     TEXT    NOT NULL CHECK (source IN ('room', 'call')),
      entered_at INTEGER NOT NULL,
      heard_at   INTEGER NOT NULL,
      instance   TEXT    NOT NULL,
      left_at    INTEGER CHECK (left_at >= entered_at),
      seconds    INTEGER NOT NULL DEFAULT 0 CHECK (seconds >= 0)
    ) STRICT
  `;
  yield* sql`CREATE UNIQUE INDEX visits_open ON visits (player_id) WHERE left_at IS NULL`;
  yield* sql`CREATE INDEX visits_by_end ON visits (left_at)`;
  yield* sql`CREATE INDEX visits_by_session ON visits (session_id)`;

  // Each player ever seen, kept for good: their name and whether they were a guest as last known.
  yield* sql`
    CREATE TABLE players_seen (
      player_id     TEXT    PRIMARY KEY,
      name          TEXT    NOT NULL,
      guest         INTEGER NOT NULL CHECK (guest IN (0, 1)),
      first_seen_at INTEGER NOT NULL,
      last_seen_at  INTEGER NOT NULL,
      seconds_total INTEGER NOT NULL DEFAULT 0 CHECK (seconds_total >= 0),
      sessions      INTEGER NOT NULL DEFAULT 0 CHECK (sessions >= 0)
    ) STRICT
  `;

  // What the games' commands log through the play service (`Done.log`), as JSON text. The play
  // service's own migration makes it too, so whichever lands first does.
  yield* sql`
    CREATE TABLE IF NOT EXISTS activity (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id TEXT    NOT NULL,
      at        INTEGER NOT NULL,
      game      TEXT    NOT NULL,
      kind      TEXT    NOT NULL,
      data      TEXT    NOT NULL
    ) STRICT
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS activity_by_player ON activity (player_id, at)`;
  // For the staff's report of each game, such as the raid's runs in the last week.
  yield* sql`CREATE INDEX IF NOT EXISTS activity_by_game ON activity (game, at)`;
});
