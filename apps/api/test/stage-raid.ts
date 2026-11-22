/**
 * Staging a moment at the raid's table, for the screenshot tours: what play does not reach by
 * itself (a run from a chosen seed, more acorns, a figure handed over, a figure on the stall, an
 * item on the rack, empty hands, a new member). Only the play server on this machine
 * (`play.ts`) serves it, at `POST /test/play/raid`; the guild's own Leaf has no such route.
 */
import type { PlayerId } from "@sequoia-leaf/core";
import { isComponentId, isFigureId, isFinishedId, RAID, startRun, type Table, TRAIL_COUNT } from "@sequoia-leaf/raid";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, least: number, most: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= least && v <= most ? v : null;

/** Does one staging step to a table, writing down the number of a run or a figure it made. */
function step(table: Table, op: Record<string, unknown>, made: number[]): void {
  const run = table.run;
  if (isRecord(op.start)) {
    const seed = whole(op.start.seed, 0, 0xffffffff) ?? 1;
    const trail = whole(op.start.trail, 0, TRAIL_COUNT - 1) ?? 0;
    table.runs += 1;
    table.run = startRun(seed, { trail });
    table.trail = trail;
    made.push(table.runs);
    return;
  }
  if (!run) return;
  const acorns = whole(op.acorns, 0, 999);
  if (acorns !== null) run.acorns = acorns;
  if (isRecord(op.give) && isFigureId(op.give.kind)) {
    const slot = run.bench.indexOf(null);
    if (slot >= 0) {
      const stars = op.give.stars === 3 ? 3 : op.give.stars === 2 ? 2 : 1;
      const id = run.nextId++;
      run.bench[slot] = { id, kind: op.give.kind, stars, items: [], fed: 0 };
      made.push(id);
    }
  }
  if (isRecord(op.offer) && isFigureId(op.offer.kind)) {
    const at = whole(op.offer.at, 0, run.stall.length - 1);
    if (at !== null) run.stall[at] = op.offer.kind;
  }
  if (isComponentId(op.item) || isFinishedId(op.item)) run.items.push(op.item);
  if (op.strip === true) {
    for (const piece of [...run.board, ...run.bench]) if (piece) piece.items = [];
  }
}

/** Stages each step in order on the player's table, as one change. Gives back the numbers of what it made. */
export const stageRaid = (playerId: PlayerId, ops: readonly unknown[]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const stored = yield* SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Schema.Struct({ rev: Schema.Int, state: Schema.String }),
      execute: (player) => sql`SELECT rev, state FROM play_state WHERE player_id = ${player} AND game = 'raid'`,
    })(playerId);
    if (ops.some((op) => isRecord(op) && op.fresh === true)) {
      yield* sql`DELETE FROM play_state WHERE player_id = ${playerId} AND game = 'raid'`;
      return [];
    }
    const found = Option.isSome(stored) ? RAID.decode(stored.value.state) : null;
    const table = found ?? RAID.create({ now: Date.now(), player: { id: playerId, guest: false }, seed: 1 });
    const made: number[] = [];
    for (const op of ops) if (isRecord(op)) step(table, op, made);
    const text = RAID.encode(table);
    if (RAID.decode(text) === null) return [];
    if (Option.isSome(stored)) {
      yield* sql`UPDATE play_state SET rev = rev + 1, state = ${text}, updated_at = ${Date.now()} WHERE player_id = ${playerId} AND game = 'raid'`;
    } else {
      yield* sql`INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${playerId}, 'raid', 1, ${text}, ${Date.now()})`;
    }
    return made;
  });
