import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Who is about comes from each player's newest visit. It was found by grouping the last day's
// visits by player on every request; now the database keeps it, one row a player (`last_visits`),
// as visits are written: triggers copy a visit's place, guest, heard and left times onto its
// player's row when it is opened (if it is newer than the one there) and whenever those change,
// remove the row with the visit it copies (180 days on, nothing is kept of where a player was),
// and copy `players_seen.stay` onto it, so that every Leaf writing visits keeps it right, an older
// one beside this one in a deploy included. Its indexes give the lists' few rows without reading
// the rest: those open by when they were last heard of, and those closed (and those closed before
// they were last heard of) by whether they stay and when they left. Those gone silent are found
// among the open by when they were last heard of: each write closes a hundred, so few wait.
//
// Open visits get an index by when they were last heard of, for those gone silent. The index of
// every visit by when it was last heard of, which only the grouping read, goes.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE last_visits (
      player_id TEXT    PRIMARY KEY,
      visit_id  INTEGER NOT NULL,
      place     TEXT    NOT NULL,
      guest     INTEGER NOT NULL CHECK (guest IN (0, 1)),
      heard_at  INTEGER NOT NULL,
      left_at   INTEGER,
      stay      INTEGER NOT NULL CHECK (stay IN (0, 1))
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`CREATE INDEX last_visits_open ON last_visits (heard_at DESC, player_id) WHERE left_at IS NULL`;
  yield* sql`
    CREATE INDEX last_visits_closed ON last_visits (stay, left_at DESC, player_id) WHERE left_at IS NOT NULL
  `;
  // Those closed before they were last heard of (a close that raced a later call): few, if any.
  yield* sql`
    CREATE INDEX last_visits_closed_early ON last_visits (stay, left_at DESC, player_id) WHERE left_at < heard_at
  `;
  yield* sql`
    INSERT INTO last_visits (player_id, visit_id, place, guest, heard_at, left_at, stay)
    SELECT v.player_id, v.id, v.place, v.guest, v.heard_at, v.left_at,
           coalesce((SELECT stay FROM players_seen AS p WHERE p.player_id = v.player_id), 1)
    FROM visits AS v
    WHERE v.id IN (SELECT max(id) FROM visits GROUP BY player_id)
  `;
  yield* sql`
    CREATE TRIGGER visits_opened
    AFTER INSERT ON visits
    BEGIN
      INSERT INTO last_visits (player_id, visit_id, place, guest, heard_at, left_at, stay)
      VALUES (NEW.player_id, NEW.id, NEW.place, NEW.guest, NEW.heard_at, NEW.left_at,
              coalesce((SELECT stay FROM players_seen WHERE player_id = NEW.player_id), 1))
      ON CONFLICT (player_id) DO UPDATE SET
        visit_id = excluded.visit_id, place = excluded.place, guest = excluded.guest,
        heard_at = excluded.heard_at, left_at = excluded.left_at
      WHERE excluded.visit_id > last_visits.visit_id;
    END
  `;
  yield* sql`
    CREATE TRIGGER visits_heard
    AFTER UPDATE OF place, guest, heard_at, left_at ON visits
    BEGIN
      UPDATE last_visits SET place = NEW.place, guest = NEW.guest, heard_at = NEW.heard_at, left_at = NEW.left_at
      WHERE player_id = NEW.player_id AND visit_id = NEW.id;
    END
  `;
  yield* sql`
    CREATE TRIGGER visits_removed
    AFTER DELETE ON visits
    BEGIN
      DELETE FROM last_visits WHERE player_id = OLD.player_id AND visit_id = OLD.id;
    END
  `;
  yield* sql`
    CREATE TRIGGER players_seen_stay
    AFTER UPDATE OF stay ON players_seen
    BEGIN
      UPDATE last_visits SET stay = NEW.stay WHERE player_id = NEW.player_id;
    END
  `;
  yield* sql`
    CREATE TRIGGER players_seen_first
    AFTER INSERT ON players_seen
    BEGIN
      UPDATE last_visits SET stay = NEW.stay WHERE player_id = NEW.player_id;
    END
  `;
  yield* sql`CREATE INDEX visits_open_by_heard ON visits (heard_at) WHERE left_at IS NULL`;
  yield* sql`DROP INDEX visits_by_heard`;
});
