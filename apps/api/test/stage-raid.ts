/**
 * Staging a moment at the raid's table, for the screenshot tours: what play does not reach by
 * itself (a run from a chosen seed, more acorns, a figure handed over, a figure on the stall, an
 * item on the rack, empty hands, a new member, another member's board across the table, under a
 * name, figures pulled). Only the play server on this machine (`play.ts`) serves it, at
 * `POST /test/play/raid`; the guild's own Leaf has no such route.
 *
 * `{ pulled: { greg: 3 } }` has Tester hold the awards of three copies of Greg pulled (a banner's
 * member by its banner, `{ "banner-1": 2 }`), and
 * `{ start: { seed, trail, own: true } }` sets out with the figures pulled; `{ fresh: true }` is a
 * member who has pulled nothing.
 */
import type { PlayerId } from "@sequoia-leaf/core";
import {
  boardMet,
  isComponentId,
  isFigureId,
  isFinishedId,
  isMemberId,
  RAID,
  type Roster,
  rosterOf,
  startRun,
  type Table,
  TRAIL_COUNT,
} from "@sequoia-leaf/raid";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { keepStaged } from "./stage-kept.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, least: number, most: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= least && v <= most ? v : null;

/** Does one staging step to a table, writing down the number of a run or a figure it made. */
function step(table: Table, op: Record<string, unknown>, made: number[], own: Roster): void {
  const run = table.run;
  if (isRecord(op.start)) {
    const seed = whole(op.start.seed, 0, 0xffffffff) ?? 1;
    const trail = whole(op.start.trail, 0, TRAIL_COUNT - 1) ?? 0;
    table.runs += 1;
    table.run = startRun(seed, op.start.own === true ? { trail, own } : { trail });
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
  // The party waiting in the room as another member's board, signed as the rules sign one Leaf hands over.
  if (typeof op.member === "string")
    run.foe =
      boardMet({ player: "20000000-0000-4000-8000-0000000000aa", name: op.member, data: run.foe, of: 1 }) ?? run.foe;
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
      yield* sql`DELETE FROM awards WHERE player_id = ${playerId} AND (id LIKE 'pull:figure:%' OR id LIKE 'copies:figure:%' OR id LIKE 'pull:headliner:%' OR id LIKE 'copies:headliner:%')`;
      return [];
    }
    // What Tester has pulled, as the pulls award it: each figure or banner's member, and each further copy.
    const pulled = ops.flatMap((op) => (isRecord(op) && isRecord(op.pulled) ? Object.entries(op.pulled) : []));
    const won = pulled.flatMap(([id, copies]) => {
      const prize = isMemberId(id) ? `headliner:${id}` : `figure:${id}`;
      return Array.from({ length: whole(copies, 1, 99) ?? 0 }, (_, i) =>
        i === 0 ? `pull:${prize}` : `copies:${prize}:${i + 1}`,
      );
    });
    for (const id of won) {
      yield* sql`INSERT OR IGNORE INTO awards (player_id, id, at) VALUES (${playerId}, ${id}, ${Date.now()})`;
    }
    const awards = yield* SqlSchema.findAll({
      Request: Schema.String,
      Result: Schema.Struct({ id: Schema.String }),
      execute: (player) => sql`SELECT id FROM awards WHERE player_id = ${player}`,
    })(playerId);
    const own = rosterOf(awards.map((row) => row.id));
    const found = Option.isSome(stored) ? RAID.decode(stored.value.state) : null;
    const table =
      found ??
      RAID.create({
        now: Date.now(),
        player: { id: playerId, guest: false },
        seed: 1,
        room: 0,
        awards: [],
        postcards: {},
      });
    const made: number[] = [];
    for (const op of ops) if (isRecord(op)) step(table, op, made, own);
    const text = RAID.encode(table);
    if (RAID.decode(text) === null) return [];
    yield* keepStaged(playerId, "raid", text, RAID.postcard?.(table), Date.now());
    return made;
  });
