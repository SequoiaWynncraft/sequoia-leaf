/**
 * How long the Tally's boards take on a database the size of the live one, or larger:
 *
 *   bun apps/api/test/tally-load.ts [members] [days]
 *
 * It fills a database in memory with `members` members (200 when left out) and `days` days (365)
 * of what the guild does: each member a few raids and wars a day, each paid in the ledger, quests
 * finished, levels and milestones, a yard, a table and a camp, the counters of what they did in
 * town and the camps they stayed in. Then it asks for every board, for the week and for all time,
 * as a member's page does: once worked out (cold) and once kept (warm), and prints how long each
 * took on the HTTP route, slowest first.
 */
import { playerId, TALLY_BOARDS, TALLY_STATS } from "@sequoia-leaf/core";
import { Effect } from "effect";

import { DAY, fakeBackend, sessionOf, testLeaf } from "./support.ts";

const [membersText = "200", daysText = "365"] = process.argv.slice(2);
const members = Number(membersText);
const days = Number(daysText);
const now = Date.UTC(2026, 10, 25, 12);
const clock = { now };
const ids = Array.from({ length: members }, (_, i) =>
  playerId(`30000000-0000-0000-0000-${String(i).padStart(12, "0")}`),
);
const [first = ids[0]] = ids;
const { fetcher } = fakeBackend({ "load-token": () => Response.json(sessionOf(first ?? playerId(""), "Load")) });
const leaf = testLeaf(clock, fetcher);

/** A small steady stream of numbers, so that every run fills the same database. */
let seed = 7;
const roll = (n: number): number => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed % n;
};
const RAIDS = ["notg", "nol", "tcc", "tna", "wtp"] as const;

const began = performance.now();
let entries = 0;
let activities = 0;
await leaf.query((sql) =>
  Effect.gen(function* () {
    yield* sql`BEGIN`;
    for (const [m, id] of ids.entries()) {
      yield* sql`INSERT INTO player_names (player_id, username, updated_at, asked_at) VALUES (${id}, ${`Member${m}`}, ${now}, ${now})`;
      yield* sql`INSERT INTO players_seen (player_id, name, guest, first_seen_at, last_seen_at) VALUES (${id}, ${`Member${m}`}, ${m % 9 === 0 ? 1 : 0}, ${now - days * DAY}, ${now})`;
      // How busy each member is: some every day, some now and then.
      const busy = 1 + roll(6);
      let sequence = 0;
      for (let d = 0; d < days; d++) {
        const day = now - (days - d) * DAY;
        const raids = roll(busy + 1);
        const wars = roll(busy);
        for (let r = 0; r < raids + wars; r++) {
          const at = day + roll(DAY);
          const raid = r < raids;
          const key = `${raid ? "raid" : "war"}:${m}:${d}:${r}`;
          yield* sql`
            INSERT INTO activities (source_key, player_id, kind, raid, detail, season_rating, occurred_at, recorded_at, in_claim)
            VALUES (${key}, ${id}, ${raid ? "raid" : "war"}, ${raid ? RAIDS[roll(5)] : null}, 'Somewhere', ${50 + roll(150)},
                    ${at}, ${at}, ${raid ? null : roll(2)})
          `;
          yield* sql`
            INSERT INTO ledger_entries (player_id, kind, balance_delta, xp_delta, origin, idempotency_key, created_at)
            VALUES (${id}, 'earn', ${40 + roll(80)}, ${40 + roll(80)}, ${raid ? "raid" : "war"}, ${key}, ${at})
          `;
          activities++;
          entries++;
        }
        if (raids + wars > 0) {
          const at = day + roll(DAY);
          yield* sql`
            INSERT INTO quests (player_id, slot, sequence, template_id, objective_type, target, reward_leaf, reward_xp,
                                progress, started_at, completed_at)
            VALUES (${id}, 'daily', ${++sequence}, 'd', 'raids', 1, 60, 60, 1, ${day}, ${at})
          `;
          yield* sql`
            INSERT INTO ledger_entries (player_id, kind, balance_delta, xp_delta, origin, idempotency_key, created_at)
            VALUES (${id}, 'earn', 60, 60, 'quest', ${`quest:${m}:${d}`}, ${at})
          `;
          entries++;
        }
        if (roll(30) === 0) {
          yield* sql`
            INSERT INTO ledger_entries (player_id, kind, balance_delta, xp_delta, origin, idempotency_key, created_at)
            VALUES (${id}, 'earn', 250, 0, 'achievement', ${`award:${m}:${d}`}, ${day})
          `;
          entries++;
        }
      }
      yield* sql`
        INSERT INTO standings (player_id, game, score, also, guest, updated_at) VALUES
          (${id}, 'works', ${roll(200_000)}, ${JSON.stringify({ tier: roll(4) })}, 0, ${now - roll(DAY)}),
          (${id}, 'raid', ${roll(12)}, '{"runs":3,"room":4}', 0, ${now - roll(DAY)}),
          (${id}, 'town', ${roll(200)}, '{"greeted":3,"sightings":9}', 0, ${now - roll(DAY)})
      `;
      for (const stat of TALLY_STATS) {
        const n = 1 + roll(stat.includes(":") ? 360_000_000 : 3000);
        yield* sql`
          INSERT INTO tallies (player_id, stat, n, week, week_n, at)
          VALUES (${id}, ${stat}, ${n}, ${Date.UTC(2026, 10, 23)}, ${roll(n)}, ${now - roll(DAY)})
        `;
      }
      for (let v = 0; v < 15; v++) {
        const owner = ids[roll(ids.length)];
        if (owner !== undefined && owner !== id)
          yield* sql`INSERT OR IGNORE INTO camp_visits (visitor_id, owner_id, first_at, last_at) VALUES (${id}, ${owner}, ${now - roll(days * DAY)}, ${now - roll(14 * DAY)})`;
      }
    }
    yield* sql`COMMIT`;
    return [];
  }),
);
console.log(
  `${members} members, ${days} days: ${activities.toLocaleString("en-US")} raids and wars, ${entries.toLocaleString("en-US")} ledger entries, filled in ${((performance.now() - began) / 1000).toFixed(1)} s`,
);

const app = leaf.app();
/** How long the route takes to answer, in milliseconds. */
async function timed(path: string): Promise<number> {
  const t = performance.now();
  const response = await app.request(path, { headers: { Authorization: "Bearer load-token" } });
  await response.arrayBuffer();
  if (response.status !== 200) throw new Error(`${path}: ${response.status}`);
  return performance.now() - t;
}
// Leaf's first answer of all signs the session in; not a board's time.
await app.request("/v1/game/me", { headers: { Authorization: "Bearer load-token" } });
const spans = TALLY_BOARDS.flatMap((b) =>
  (b.week ? (["week", "all"] as const) : (["all"] as const)).map((p) => ({ b, p })),
);
const results = await spans.reduce<Promise<{ name: string; cold: number; warm: number }[]>>(
  (before, { b, p }) =>
    before.then(async (done) => {
      const path = `/v1/game/tally/${b.id}/${p}`;
      const cold = await timed(path);
      const warm = await timed(path);
      return [...done, { name: `${b.id} ${p}`, cold, warm }];
    }),
  Promise.resolve([]),
);
const ms = (n: number) => n.toFixed(2).padStart(8);
console.log(`\n${"board".padEnd(22)} ${"cold ms".padStart(8)} ${"kept ms".padStart(8)}`);
for (const r of results.toSorted((a, b) => b.cold - a.cold))
  console.log(`${r.name.padEnd(22)} ${ms(r.cold)} ${ms(r.warm)}`);
const sum = (of: "cold" | "warm") => results.reduce((all, r) => all + r[of], 0);
console.log(`\nall ${results.length} boards: ${ms(sum("cold"))} ms cold, ${ms(sum("warm"))} ms kept`);
await app.dispose();
await leaf.dispose();
