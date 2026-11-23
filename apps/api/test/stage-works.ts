/**
 * Staging a moment in Tester's yard, for the screenshot tours: what play does not reach by itself
 * (a yard part-way through the tiers, or a new one; a time away; a standing order filled). Only the
 * play server on this machine (`play.ts`) serves it, at `POST /test/play/works`; the guild's own
 * Leaf has no such route.
 */
import type { PlayerId } from "@sequoia-leaf/core";
import {
  ALL_ITEMS,
  at,
  BELT,
  build,
  clockOf,
  deliver,
  type Dir,
  DX,
  DY,
  FACTORY,
  GOALS,
  here,
  type Item,
  NONE,
  remove,
  stepTo,
  type Yard,
} from "@sequoia-leaf/factory";
import { isStage, staged } from "@sequoia-leaf/factory/test/yards.ts";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, most: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most ? v : null;

const tester = (now: number, seed: number) => ({
  now,
  player: { id: "tester", guest: false },
  seed,
  room: 0,
  awards: [],
});

/**
 * What the node in hand still wants, laid ready to reach the depot, one thing at a time as play
 * would bring it: on straight runs of belt from each side of the depot, one thing to a tile, each
 * run stopping a tile short of the depot, so that nothing arrives until the page lays the last belt
 * of a run (`works.stage`'s callers do, as the member would). An empty belt on that last tile is
 * taken up, and empty belts further out are used again. The pieces to hand stay the player's.
 */
function feed(y: Yard): void {
  const g = y.hand;
  const want = g === -1 ? undefined : GOALS[g]?.want;
  if (g === -1 || !want) return;
  const things: Item[] = [];
  for (const n of ALL_ITEMS) for (let c = (want[n] ?? 0) - (y.got[g]?.[n] ?? 0); c > 0; c--) things.push(n);
  const [cx, cy] = y.land.depot;
  // The tiles beside the depot, each with the way into it.
  const faces: { x: number; y: number; dir: Dir }[] = [];
  for (const k of [-1, 0, 1])
    faces.push(
      { x: cx + k, y: cy - 2, dir: 1 },
      { x: cx + k, y: cy + 2, dir: 3 },
      { x: cx - 2, y: cy + k, dir: 0 },
      { x: cx + 2, y: cy + k, dir: 2 },
    );
  const spare = y.spare[BELT] ?? 0;
  const tile = (f: (typeof faces)[number], out: number): number =>
    at(y, f.x - (DX[f.dir] ?? 0) * out, f.y - (DY[f.dir] ?? 0) * out);
  /** An empty belt on a tile, facing a way: the one there, or one set down. */
  const belt = (i: number, dir: Dir): boolean => {
    if (i < 0) return false;
    if (y.kind[i] === BELT && y.dir[i] === dir && y.item[i] === NONE) return true;
    if (y.kind[i] !== NONE || !build(y, BELT, i % y.land.w, Math.floor(i / y.land.w), dir, Infinity).ok) return false;
    y.free[i] = 0;
    return true;
  };
  const open = faces.filter((f) => {
    const i = tile(f, 0);
    if (y.kind[i] === BELT && y.item[i] === NONE) remove(y, f.x, f.y);
    return y.kind[i] === NONE;
  });
  for (let out = 1; out <= 6; out++)
    for (const f of open) {
      if (things.length === 0) break;
      // Further out only behind one of these: a straight run into the depot.
      const before = tile(f, out - 1);
      if (out > 1 && (y.kind[before] !== BELT || y.dir[before] !== f.dir)) continue;
      const i = tile(f, out);
      if (!belt(i, f.dir)) continue;
      y.item[i] = things.pop() ?? NONE;
      y.prog[i] = 0;
    }
  y.spare[BELT] = spare;
}

/**
 * Does one staging step to a yard: `{ yard: "mid" }` puts a yard built by commands in its place
 * (`staged` in the rules' test yards: `"small"`, `"short"`, `"mid"`, `"large"`; or `"new"`, a new
 * one), and `{ text: "..." }` any yard as its kept text, counting its Coins on from the one it
 * replaces; `{ away: minutes }` has its owner leave it that long ago, and runs it every tick since as
 * Leaf would have; `{ fill: n }` sends the depot what the nth standing order still wants, and what
 * the node in hand wants of the same things first; `{ feed: true }` lays what the node in hand still
 * wants ready to reach the depot (`feed`).
 */
function step(y: Yard | null, op: Record<string, unknown>, now: number): Yard | null {
  const next =
    op.yard === "new"
      ? FACTORY.create(tester(now, 20_261_122))
      : isStage(op.yard)
        ? staged(op.yard)
        : typeof op.text === "string"
          ? FACTORY.decode(op.text)
          : undefined;
  if (next !== undefined) {
    // It counts its Coins on from the yard it replaces, so that no Coins key is made twice. A yard
    // given as text is otherwise as given, its owner's last visit with it.
    if (next) Object.assign(next, { at: now, bank: y?.bank ?? 0 });
    return next;
  }
  if (!y) return y;
  const away = whole(op.away, 7 * 24 * 60);
  if (away !== null) {
    y.seen = here(y);
    y.at -= away * 60_000;
    FACTORY.advance(y, tester(now, 0));
  }
  if (op.feed === true) feed(y);
  const order = y.board[whole(op.fill, 3) ?? -1];
  const hand = y.hand === -1 ? null : GOALS[y.hand];
  const got = y.hand === -1 ? null : y.got[y.hand];
  if (order)
    for (const n of ALL_ITEMS) {
      const left = (order.want[n] ?? 0) - (order.filled[n] ?? 0);
      const first = Math.max(0, (hand?.want[n] ?? 0) - (got?.[n] ?? 0));
      if (left > 0) deliver(y, n, left + first);
    }
  return y;
}

/** Somebody else the play server knows, whose yard can be put on the board. */
export interface Other {
  readonly id: PlayerId;
  readonly guest: boolean;
}

/**
 * Stages each step in order in Tester's yard, as one change, and writes where it stands as a batch
 * would. `{ others: [coins, ...] }` puts the yards of `others` on the Works' board instead of any
 * there before: the nth has earned that many Coins, a little before the one after it.
 */
export const stageWorks = (playerId: PlayerId, ops: readonly unknown[], others: readonly Other[]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const stored = yield* SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Schema.Struct({ rev: Schema.Int, state: Schema.String }),
      execute: (player) => sql`SELECT rev, state FROM play_state WHERE player_id = ${player} AND game = 'works'`,
    })(playerId);
    const now = Date.now();
    // The yard at Leaf's tick now, as the page shows it: a read runs it on without keeping what it
    // ran, so what is stored may be behind.
    let yard = Option.isSome(stored) ? FACTORY.decode(stored.value.state) : null;
    if (yard) stepTo(yard, clockOf(yard, now));
    for (const op of ops) {
      if (!isRecord(op)) continue;
      if (!Array.isArray(op.others)) {
        yard = step(yard, op, now);
        continue;
      }
      yield* sql`DELETE FROM standings WHERE game = 'works' AND player_id != ${playerId}`;
      for (const [n, other] of others.entries()) {
        const coins = whole(op.others[n], 1e9);
        if (coins === null) continue;
        const tier = Math.min(4, Math.floor(coins / 3000));
        yield* sql`
          INSERT INTO standings (player_id, game, score, also, guest, updated_at)
          VALUES (${other.id}, 'works', ${coins}, ${JSON.stringify({ tier })}, ${other.guest ? 1 : 0}, ${now - others.length + n})
        `;
      }
    }
    if (!yard) return;
    const text = FACTORY.encode(yard);
    if (Option.isSome(stored)) {
      yield* sql`UPDATE play_state SET rev = rev + 1, state = ${text}, updated_at = ${now} WHERE player_id = ${playerId} AND game = 'works'`;
    } else {
      yield* sql`INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${playerId}, 'works', 1, ${text}, ${now})`;
    }
    const standing = FACTORY.standing?.(yard);
    if (standing) {
      yield* sql`
        INSERT OR REPLACE INTO standings (player_id, game, score, also, guest, updated_at)
        VALUES (${playerId}, 'works', ${standing.score}, ${JSON.stringify(standing.also)}, 0, ${now})
      `;
    }
  });
