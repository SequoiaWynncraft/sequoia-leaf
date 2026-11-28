/**
 * Staff operations on a player's Works yard, modelled on `grant.ts`: edits go through `Play.send`
 * as a single `StaffCommand` with edit metadata so `play_staff_edits` records the exact before-yard
 * atomically in the play service's transaction. `dry` runs the real rules on the stored yard and
 * writes nothing. `edits` and `export` are read-only.
 */
import { isRefused, type PlayerId } from "@sequoia-leaf/core";
import {
  type Dir,
  exportYard,
  FACTORY,
  packPieces,
  packPrint,
  piecesAt,
  readStaffNote,
  toBase64,
  type WorksStaffCommand,
} from "@sequoia-leaf/factory";
import { Clock, Effect, Option, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { SqlClient, SqlSchema } from "effect/sql";

import { ctxOf, GAMES, NOTHING_GIVEN, StaffCommand, type StaffEditMeta } from "./games.ts";
import { Play } from "./service.ts";
import { listStaffEdits, readStaffEdit, readStaffEditByCommand } from "./staff-edits.ts";
import { PlayStore } from "./store.ts";

/** The staff member running a Works edit. */
export interface WorksActor {
  readonly id: PlayerId;
  readonly name: string;
}

/** One staff edit action against a player's Works yard. */
export type WorksAction =
  | { readonly do: "learn"; readonly goals: readonly string[] }
  | { readonly do: "plots"; readonly plots: readonly string[] }
  | { readonly do: "copy"; readonly source: PlayerId }
  | {
      readonly do: "code";
      readonly code: string;
      readonly x: number;
      readonly y: number;
      readonly turn: Dir;
      readonly replace: boolean;
    }
  | { readonly do: "undo"; readonly editId: number; readonly force: boolean };

/** One JSON-line result of a Works staff edit (or dry run). */
export interface WorksEditResult {
  readonly ok: boolean;
  readonly dry: boolean;
  readonly player: PlayerId;
  readonly name: string | null;
  readonly by: WorksActor;
  readonly editId: number | null;
  readonly revBefore: number | null;
  readonly revAfter: number | null;
  readonly goalsAdded: readonly string[];
  readonly plotsAdded: readonly string[];
  readonly piecesBefore: number;
  readonly piecesAfter: number;
  readonly cost: number;
  readonly refused: string | null;
  readonly at: string;
}

const Seen = Schema.Struct({ guest: Schema.BooleanFromBit, name: Schema.NullOr(Schema.String) });

interface Prepared {
  readonly command: WorksStaffCommand;
  readonly summary: Readonly<Record<string, unknown>>;
}

function refusedResult(
  player: PlayerId,
  name: string | null,
  by: WorksActor,
  dry: boolean,
  at: number,
  refused: string,
  revBefore: number | null = null,
): WorksEditResult {
  return {
    ok: false,
    dry,
    player,
    name,
    by,
    editId: null,
    revBefore,
    revAfter: null,
    goalsAdded: [],
    plotsAdded: [],
    piecesBefore: 0,
    piecesAfter: 0,
    cost: 0,
    refused,
    at: new Date(at).toISOString(),
  };
}

const prepareAction = (player: PlayerId, action: WorksAction, by: WorksActor) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const store = yield* PlayStore;
    const actor = { by: by.id, name: by.name };
    switch (action.do) {
      case "learn":
        return {
          command: { do: "learn", goals: action.goals, ...actor },
          summary: { do: "learn", goals: action.goals },
        } satisfies Prepared;
      case "plots":
        return {
          command: { do: "plots", plots: action.plots, ...actor },
          summary: { do: "plots", plots: action.plots },
        } satisfies Prepared;
      case "code": {
        const { code, x, y, turn, replace } = action;
        return {
          command: { do: "pieces", code, x, y, turn, replace, ...actor },
          summary: { do: "pieces", at: [x, y], turn, replace, codeLength: code.length },
        } satisfies Prepared;
      }
      case "copy": {
        const source = yield* store.read(action.source, "works");
        if (Option.isNone(source)) return { refused: "no_such_source" };
        const yard = FACTORY.decode(source.value.state);
        if (yard === null) return { refused: "unreadable_source" };
        const all = Array.from({ length: yard.land.w * yard.land.h }, (_, i) => i);
        const pieces = piecesAt(yard, all);
        const packed = toBase64(packPrint(packPieces(pieces)));
        return {
          command: { do: "pieces", packed, replace: true, ...actor },
          summary: { do: "pieces", copy: action.source, replace: true, pieces: pieces.length },
        } satisfies Prepared;
      }
      case "undo": {
        const edit = yield* readStaffEdit(sql, player, "works", action.editId);
        if (Option.isNone(edit)) return { refused: "no_such_edit" };
        const current = yield* store.read(player, "works");
        if (Option.isNone(current)) return { refused: "no_yard" };
        if (!action.force && current.value.rev > edit.value.revAfter) return { refused: "rev_moved" };
        return {
          command: { do: "restore", yard: edit.value.before, ...actor },
          summary: { do: "restore", undo: action.editId, force: action.force },
        } satisfies Prepared;
      }
    }
  });

const runDry = (
  player: PlayerId,
  guest: boolean,
  name: string | null,
  by: WorksActor,
  at: number,
  command: WorksStaffCommand,
) =>
  Effect.gen(function* () {
    const store = yield* PlayStore;
    const stored = yield* store.read(player, "works");
    const revBefore = Option.isSome(stored) ? stored.value.rev : 0;
    const ctx = ctxOf({ playerId: player, guest }, at, 0, 0, NOTHING_GIVEN);
    const decoded = Option.isNone(stored) ? FACTORY.create(ctx) : FACTORY.decode(stored.value.state);
    if (decoded === null) return refusedResult(player, name, by, true, at, "unreadable", revBefore);
    const state = FACTORY.advance(decoded, ctx);
    const answer = FACTORY.apply(state, command, ctx);
    if (isRefused(answer)) return refusedResult(player, name, by, true, at, answer.refused, revBefore);
    const note = readStaffNote(answer.notes[0]);
    if (note === null) return yield* Effect.die(new Error("A Works staff command gave no note"));
    return {
      ok: true,
      dry: true,
      player,
      name,
      by,
      editId: null,
      revBefore,
      revAfter: null,
      goalsAdded: note.goals,
      plotsAdded: note.plots,
      piecesBefore: note.piecesBefore,
      piecesAfter: note.piecesAfter,
      cost: note.cost,
      refused: null,
      at: new Date(at).toISOString(),
    } satisfies WorksEditResult;
  });

const runLive = (
  player: PlayerId,
  guest: boolean,
  name: string | null,
  by: WorksActor,
  at: number,
  prepared: Prepared,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const play = yield* Play;
    const random = yield* SecureRandom.SecureRandom;
    const commandId = `staff:${at}:${yield* random.intBetween(0, 0xffffffff)}`;
    const meta: StaffEditMeta = { by: by.id, command: prepared.summary };
    const batch = yield* play.send({ playerId: player, guest }, GAMES.works, [
      new StaffCommand(commandId, prepared.command, meta),
    ]);
    if (batch.status === "unreadable" || batch.status === "slow") {
      return refusedResult(player, name, by, false, at, batch.status);
    }
    if (batch.status !== "done") return yield* Effect.die(new Error(`A Works staff edit was ${batch.status}`));
    const [result] = batch.results;
    if (result === undefined) return yield* Effect.die(new Error("A Works staff edit was not answered"));
    if ("refused" in result) return refusedResult(player, name, by, false, at, result.refused);
    const note = readStaffNote(result.notes[0]);
    if (note === null) return yield* Effect.die(new Error("A Works staff edit gave no note"));
    const edit = Option.getOrNull(yield* readStaffEditByCommand(sql, player, "works", commandId));
    return {
      ok: true,
      dry: false,
      player,
      name,
      by,
      editId: edit?.id ?? null,
      revBefore: edit?.revBefore ?? null,
      revAfter: edit?.revAfter ?? batch.rev,
      goalsAdded: note.goals,
      plotsAdded: note.plots,
      piecesBefore: note.piecesBefore,
      piecesAfter: note.piecesAfter,
      cost: note.cost,
      refused: null,
      at: new Date(at).toISOString(),
    } satisfies WorksEditResult;
  });

/**
 * Applies one Works staff edit to `player`'s yard through the play service (or simulates it on the
 * stored yard without writing when `dry` is true).
 */
export const editWorks = (player: PlayerId, action: WorksAction, by: WorksActor, dry: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const at = yield* Clock.currentTimeMillis;
    const seen = yield* SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Seen,
      execute: (id) => sql`
        SELECT coalesce(s.guest, p.guest) AS guest, p.name FROM (SELECT ${id} AS player_id) AS w
        LEFT JOIN players_seen AS p ON p.player_id = w.player_id
        LEFT JOIN play_state AS s ON s.player_id = w.player_id AND s.game = 'works'
        WHERE p.player_id IS NOT NULL OR s.player_id IS NOT NULL
      `,
    })(player).pipe(Effect.orDie);
    if (Option.isNone(seen)) return refusedResult(player, null, by, dry, at, "no_such_player");
    const { guest, name } = seen.value;
    const prepared = yield* prepareAction(player, action, by);
    if ("refused" in prepared) return refusedResult(player, name, by, dry, at, prepared.refused);
    return dry
      ? yield* runDry(player, guest, name, by, at, prepared.command)
      : yield* runLive(player, guest, name, by, at, prepared);
  });

/** Lists a player's recent staff edits on their Works yard, newest first. */
export const worksEdits = (player: PlayerId, limit = 20) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* listStaffEdits(sql, player, "works", limit);
    const edits = rows.map((row) => ({
      id: row.id,
      revBefore: row.revBefore,
      revAfter: row.revAfter,
      command: row.command,
      by: row.by,
      at: new Date(row.at).toISOString(),
    }));
    return { player, edits };
  });

/** Exports a player's Works yard read-only as blueprint codes split to fit 40×30. */
export const exportWorks = (player: PlayerId) =>
  Effect.gen(function* () {
    const store = yield* PlayStore;
    const stored = yield* store.read(player, "works");
    if (Option.isNone(stored)) return { ok: false as const, player, refused: "no_yard" as const };
    const yard = FACTORY.decode(stored.value.state);
    if (yard === null) return { ok: false as const, player, refused: "unreadable" as const };
    const parts = exportYard(yard);
    const pieces = parts.reduce((sum, part) => sum + part.pieces, 0);
    return { ok: true as const, player, rev: stored.value.rev, pieces, parts };
  });
