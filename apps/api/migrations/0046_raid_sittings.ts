import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// The raid's live tables (sittings: `packages/raid/src/sitting/`), as Leaf keeps them.
//
// `raid_sittings`: each sitting, by an id Leaf made; its state as the rules encode it, and how many
// writes have changed it (`rev`); who opened it and when; where it stands (`stage`, the rules'
// `stage.at`); the moment it is next due (`due_at`, the stage's `until`; null once it is over); and
// when it ended (null until it is over). A sitting a day over is let go of, state and all.
//
// `raid_sitting_seats`: who is seated where while a sitting is not over: everyone sat at an open
// one, and each member still in at a started one. One row a player, so the database holds that a
// player is at one sitting at a time.
//
// `raid_sitting_places`: each member's place at a finished sitting (1 the winner) of how many seats,
// and when it ended; kept for good, after the sitting itself is let go of.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE raid_sittings (
      id        TEXT    PRIMARY KEY,
      state     TEXT    NOT NULL,
      rev       INTEGER NOT NULL,
      opened_by TEXT    NOT NULL,
      opened_at INTEGER NOT NULL,
      stage     TEXT    NOT NULL CHECK (stage IN ('open', 'carousel', 'plan', 'fight', 'over')),
      due_at    INTEGER,
      ended_at  INTEGER,
      CHECK ((stage = 'over') = (ended_at IS NOT NULL) AND (stage = 'over') = (due_at IS NULL))
    ) STRICT
  `;
  yield* sql`CREATE INDEX raid_sittings_due ON raid_sittings (due_at) WHERE due_at IS NOT NULL`;
  yield* sql`CREATE INDEX raid_sittings_ended ON raid_sittings (ended_at) WHERE ended_at IS NOT NULL`;
  yield* sql`CREATE INDEX raid_sittings_by ON raid_sittings (opened_by, opened_at)`;
  yield* sql`
    CREATE TABLE raid_sitting_seats (
      player_id TEXT    PRIMARY KEY,
      sitting   TEXT    NOT NULL REFERENCES raid_sittings (id),
      since     INTEGER NOT NULL
    ) STRICT
  `;
  yield* sql`CREATE INDEX raid_sitting_seats_at ON raid_sitting_seats (sitting)`;
  yield* sql`
    CREATE TABLE raid_sitting_places (
      sitting   TEXT    NOT NULL,
      player_id TEXT    NOT NULL,
      place     INTEGER NOT NULL CHECK (place >= 1),
      seats     INTEGER NOT NULL CHECK (seats >= place),
      ended     INTEGER NOT NULL,
      PRIMARY KEY (sitting, player_id)
    ) STRICT
  `;
  yield* sql`CREATE INDEX raid_sitting_places_of ON raid_sitting_places (player_id)`;
});
