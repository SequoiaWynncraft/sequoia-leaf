/**
 * Staging the Tally for the screenshot tours: everybody the play server knows (Tester, the four
 * members, the guest and the crowd) on every counter, in the guild's raids and wars, in the Works
 * and at the raid's table, for this week and the weeks before, with ties here and there. Tester is
 * near the top of the town's boards and off the top ten of the rest, so a board shows Tester's own
 * place at its foot. Only the play server on this machine (`play.ts`) serves it, at
 * `POST /test/play/tally`; the guild's own Leaf has no such route.
 */
import { DAY_MS, type PlayerId, RAID_KEYS, TALLY_STATS, type TallyStat } from "@sequoia-leaf/core";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

import { tally } from "../src/tally/store.ts";

/** How large each counter runs, for the busiest player: times in milliseconds. */
const MOST: Readonly<Record<TallyStat, number>> = {
  raid_wins: 14,
  raid_rooms: 180,
  works_orders: 60,
  crab: 40,
  greeted: 30,
  waves: 24,
  taps: 900,
  logs: 120,
  rolls: 18,
  "played:town": 30 * 3_600_000,
  "afk:town": 12 * 3_600_000,
  "played:works": 40 * 3_600_000,
  "played:raid": 9 * 3_600_000,
};

/** Who is how busy, from 1 down: the first of the others most, Tester a little under the middle but for the crab. */
const busy = (i: number, of: number, stat: TallyStat, tester: boolean) =>
  tester ? (stat === "crab" ? 1.1 : 0.32) : 0.25 + 0.75 * (1 - i / of);

export function stageTally(
  tester: PlayerId,
  others: readonly { readonly id: PlayerId; readonly guest: boolean }[],
  now: number,
) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const everyone = [...others, { id: tester, guest: false }];
    const lastWeek = now - 8 * DAY_MS;
    let made = 0;
    for (const [i, { id, guest }] of everyone.entries()) {
      const mine = id === tester;
      for (const stat of TALLY_STATS) {
        // Whole tens of a busiest's count, so that some tie.
        const n = Math.round(MOST[stat] * busy(i, everyone.length, stat, mine) * 10) / 10;
        const week = Math.floor(n * (0.25 + ((i * 7) % 5) / 10));
        yield* tally(sql, id, stat, Math.floor(n) - week, lastWeek - i * 60_000);
        yield* tally(sql, id, stat, week, now - i * 60_000);
      }
      const scale = busy(i, everyone.length, "raid_wins", mine);
      yield* sql`
        INSERT OR REPLACE INTO standings (player_id, game, score, also, guest, updated_at) VALUES
          (${id}, 'works', ${Math.round(48_000 * scale)}, ${JSON.stringify({ tier: Math.min(3, Math.floor(scale * 4)) })},
           ${guest ? 1 : 0}, ${now - i * 1000}),
          (${id}, 'raid', ${Math.round(9 * scale)}, '{"runs":12,"room":9}', ${guest ? 1 : 0}, ${now - i * 1000})
      `;
      // The guild's raids and wars, for members: this week's and the weeks before.
      if (!guest) {
        for (let r = 0; r < Math.round(30 * scale); r++) {
          const at = r % 3 === 0 ? now - (r + 1) * 3_600_000 : lastWeek - r * DAY_MS;
          const raid = r % 4 !== 3;
          yield* sql`
            INSERT OR IGNORE INTO activities (source_key, player_id, kind, raid, detail, season_rating, occurred_at, recorded_at, in_claim)
            VALUES (${`tally:${raid ? "raid" : "war"}:${r}:${id}`}, ${id}, ${raid ? "raid" : "war"},
                    ${raid ? (RAID_KEYS[r % RAID_KEYS.length] ?? null) : null}, 'Somewhere', ${60 + (r % 5) * 20},
                    ${at}, ${at}, ${raid ? null : r % 2})
          `;
          made++;
        }
      }
      for (const [k, owner] of everyone.entries()) {
        if (owner.id !== id && (i + k) % 3 === 0) {
          yield* sql`
            INSERT OR IGNORE INTO camp_visits (visitor_id, owner_id, first_at, last_at)
            VALUES (${id}, ${owner.id}, ${lastWeek}, ${k % 2 === 0 ? now : lastWeek})
          `;
        }
      }
    }
    return { players: everyone.length, activities: made };
  });
}
