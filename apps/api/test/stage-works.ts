/**
 * Staging a moment in Tester's yard, for the screenshot tours: what play does not reach by itself
 * (a yard kept part-way through the story, or a new one; a time away; a standing order filled).
 * Only the play server on this machine (`play.ts`) serves it, at `POST /test/play/works`; the
 * guild's own Leaf has no such route.
 */
import type { PlayerId } from "@sequoia-leaf/core";
import { deliver, ITEMS, storyOrder, WORKS, type World } from "@sequoia-leaf/yard";
import large from "@sequoia-leaf/yard/yards/large.json";
import mid from "@sequoia-leaf/yard/yards/mid.json";
import short from "@sequoia-leaf/yard/yards/short.json";
import small from "@sequoia-leaf/yard/yards/small.json";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/** The yards kept part-way through the story (`apps/works/review/balance.ts --yards`). */
const YARDS = { small, short, mid, large } as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, most: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most ? v : null;

/**
 * Does one staging step to a yard: `{ yard: "mid" }` puts a kept yard (or `"new"`, a new one) in
 * its place, counting its Coins on from the one it replaces; `{ away: minutes }` has Leaf's clock
 * pass that long unwatched; `{ fill: n }` sends the depot what the nth standing order still wants,
 * and the story order first.
 */
function step(w: World | null, op: Record<string, unknown>, now: number): World | null {
  const named = Object.entries(YARDS).find(([name]) => name === op.yard)?.[1];
  const next =
    op.yard === "new"
      ? WORKS.create({ now, player: { id: "tester", guest: false }, seed: 20_261_122, room: 0 })
      : named
        ? WORKS.decode(JSON.stringify(named))
        : undefined;
  if (next !== undefined) {
    // It counts its Coins on from the yard it replaces, so that no Coins key is made twice.
    if (next) Object.assign(next, { at: now, bank: w?.bank ?? 0 });
    return next;
  }
  if (!w) return w;
  const away = whole(op.away, 7 * 24 * 60);
  if (away !== null) w.at -= away * 60_000;
  const order = w.board[whole(op.fill, 3) ?? -1];
  if (order)
    for (const k of ITEMS) {
      const n = (order.want[k] ?? 0) - (order.filled[k] ?? 0);
      if (n > 0) deliver(w, k, n + Math.max(0, (storyOrder(w)?.want[k] ?? 0) - (w.filled[k] ?? 0)));
    }
  return w;
}

/** Stages each step in order in Tester's yard, as one change. */
export const stageWorks = (playerId: PlayerId, ops: readonly unknown[]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const stored = yield* SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Schema.Struct({ rev: Schema.Int, state: Schema.String }),
      execute: (player) => sql`SELECT rev, state FROM play_state WHERE player_id = ${player} AND game = 'works'`,
    })(playerId);
    const now = Date.now();
    let yard = Option.isSome(stored) ? WORKS.decode(stored.value.state) : null;
    for (const op of ops) if (isRecord(op)) yard = step(yard, op, now);
    if (!yard) return;
    const text = WORKS.encode(yard);
    if (Option.isSome(stored)) {
      yield* sql`UPDATE play_state SET rev = rev + 1, state = ${text}, updated_at = ${now} WHERE player_id = ${playerId} AND game = 'works'`;
    } else {
      yield* sql`INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${playerId}, 'works', 1, ${text}, ${now})`;
    }
  });
