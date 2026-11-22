/**
 * Staging a moment in Tester's pulls, for the screenshot tours: what play does not reach by itself
 * quickly (a banner with somebody as its headliner, sixty pulls towards a top prize, a 50/50 lost,
 * prizes and Seeds in hand). Only the play server on this machine (`play.ts`) serves it, at
 * `POST /test/play/pulls`; the guild's own Leaf has no such route.
 *
 * Each step: `{ headliner: n }` makes the nth of `others` the first banner's headliner, and
 * `{ headliner: null }` leaves it with nobody; `{ fresh: true }` puts a new player's pulls in place of
 * Tester's (counting pulls on from the old ones); `{ top: n }`, `{ mid: n }` and `{ owed: true }` set the banners' counters, and
 * `{ groveTop: n }` the always-open pool's; `{ seeds: n }` and `{ free: n }` set the Seeds and the
 * free pulls waiting; `{ have: ["thing:fountain", ...] }` gives one more of each prize, noted in the
 * history as drawn from the always-open pool. (`play.ts` itself moves Leaf's clock for
 * `{ ahead: days }` and has Tester hold n Leaf for `{ leaf: n }`.)
 */
import type { PlayerId } from "@sequoia-leaf/core";
import { BANNERS, PULLS, type Pulls, rarityOf } from "@sequoia-leaf/pulls";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import type { Other } from "./stage-works.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, most: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most ? v : null;

/** Does one staging step to a player's pulls. */
function step(s: Pulls, op: Record<string, unknown>, now: number): void {
  const banner = s.counters.banner;
  banner.top = whole(op.top, 79) ?? banner.top;
  banner.mid = whole(op.mid, 9) ?? banner.mid;
  if (typeof op.owed === "boolean") banner.owed = op.owed;
  s.counters.grove.top = whole(op.groveTop, 79) ?? s.counters.grove.top;
  s.seeds = whole(op.seeds, 1e6) ?? s.seeds;
  s.free.waiting = whole(op.free, 7) ?? s.free.waiting;
  for (const prize of Array.isArray(op.have) ? op.have : []) {
    if (typeof prize !== "string" || rarityOf(prize) === undefined) continue;
    s.have[prize] = (s.have[prize] ?? 0) + 1;
    s.history.push({ prize, pool: "grove", at: now, top: 1 });
    s.pulls += 1;
  }
}

/** Stages each step in order, as one change, and says what Tester's pulls stand at. */
export const stagePulls = (playerId: PlayerId, ops: readonly unknown[], others: readonly Other[], now: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const banner = BANNERS[0]?.id ?? "";
    for (const op of ops) {
      if (!isRecord(op) || !("headliner" in op)) continue;
      const person = others[whole(op.headliner, others.length) ?? -1];
      yield* sql`DELETE FROM banner_people WHERE banner = ${banner}`;
      if (person) yield* sql`INSERT INTO banner_people (banner, player_id) VALUES (${banner}, ${person.id})`;
    }
    const stored = yield* SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Schema.Struct({ rev: Schema.Int, state: Schema.String }),
      execute: (player) => sql`SELECT rev, state FROM play_state WHERE player_id = ${player} AND game = 'pulls'`,
    })(playerId);
    const kept = Option.isSome(stored) ? PULLS.decode(stored.value.state) : null;
    // A new player's pulls, counting on from the old one's, so that no pull's Leaf is keyed as an earlier one was.
    const created = (): Pulls => ({
      ...PULLS.create({ now, player: { id: playerId, guest: false }, seed: 20_261_122, room: 0, awards: [] }),
      pulls: kept?.pulls ?? 0,
    });
    let s = kept ?? created();
    for (const op of ops) {
      if (!isRecord(op)) continue;
      if (op.fresh === true) s = created();
      step(s, op, now);
    }
    const text = PULLS.encode(s);
    if (Option.isSome(stored)) {
      yield* sql`UPDATE play_state SET rev = rev + 1, state = ${text}, updated_at = ${now} WHERE player_id = ${playerId} AND game = 'pulls'`;
    } else {
      yield* sql`INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${playerId}, 'pulls', 1, ${text}, ${now})`;
    }
    return { counters: s.counters, seeds: s.seeds, free: s.free.waiting, prizes: Object.keys(s.have).length };
  });
