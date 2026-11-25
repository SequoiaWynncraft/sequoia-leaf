import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Whose camp a visit to a camp is in (`camp_owner`: the owner's player id, which is how the camp
// list and the camps' live rooms name a camp), as the player's page said; null in any other place,
// and for a visit whose page did not say. Going from one camp to another is a move, so a visit is
// in one camp from when it opens to when it closes. Each player's newest visit (`last_visits`)
// carries it too, copied by the triggers with the rest of the visit, so that who is about says
// whose camp somebody is in. A Leaf from before this, beside this one in a deploy, opens visits
// with none.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE visits ADD COLUMN camp_owner TEXT CHECK (camp_owner IS NULL OR place = 'camp')`;
  yield* sql`ALTER TABLE last_visits ADD COLUMN camp_owner TEXT`;
  yield* sql`DROP TRIGGER visits_opened`;
  yield* sql`
    CREATE TRIGGER visits_opened
    AFTER INSERT ON visits
    BEGIN
      INSERT INTO last_visits (player_id, visit_id, place, camp_owner, guest, heard_at, left_at, stay)
      VALUES (NEW.player_id, NEW.id, NEW.place, NEW.camp_owner, NEW.guest, NEW.heard_at, NEW.left_at,
              coalesce((SELECT stay FROM players_seen WHERE player_id = NEW.player_id), 1))
      ON CONFLICT (player_id) DO UPDATE SET
        visit_id = excluded.visit_id, place = excluded.place, camp_owner = excluded.camp_owner,
        guest = excluded.guest, heard_at = excluded.heard_at, left_at = excluded.left_at
      WHERE excluded.visit_id > last_visits.visit_id;
    END
  `;
  yield* sql`DROP TRIGGER visits_heard`;
  yield* sql`
    CREATE TRIGGER visits_heard
    AFTER UPDATE OF place, camp_owner, guest, heard_at, left_at ON visits
    BEGIN
      UPDATE last_visits SET place = NEW.place, camp_owner = NEW.camp_owner, guest = NEW.guest,
        heard_at = NEW.heard_at, left_at = NEW.left_at
      WHERE player_id = NEW.player_id AND visit_id = NEW.id;
    END
  `;
});
