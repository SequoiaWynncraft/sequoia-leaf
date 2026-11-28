/**
 * Staff edits recorded by the play service (`play_staff_edits`, migration 52). Each accepted
 * `StaffCommand` carrying edit metadata records the exact state text it ran on, the rev before and
 * after, a compact JSON summary of the command, who ran it (`by`), and when (`at`), inside the
 * play service's own transaction. Never shown to players.
 */
import type { GameId, PlayerId } from "@sequoia-leaf/core";
import { Effect, type Option, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/sql";

import { PlayerUuid } from "../wire.ts";
import { type Attempt, StaffCommand } from "./games.ts";

/** One staff edit waiting to be written in the batch's transaction. */
export interface PendingStaffEdit {
  readonly commandId: string;
  readonly by: PlayerId;
  readonly command: string;
  readonly before: string;
}

/** A full row from `play_staff_edits`, including the exact `before` state text for undo. */
const StaffEditSchema = Schema.Struct({
  id: Schema.Int,
  playerId: PlayerUuid,
  game: Schema.String,
  commandId: Schema.String,
  revBefore: Schema.Int,
  revAfter: Schema.Int,
  before: Schema.String,
  command: Schema.fromJsonString(Schema.Unknown),
  by: PlayerUuid,
  at: Schema.Int,
});
export type StaffEditRow = typeof StaffEditSchema.Type;

/** A staff edit listed without its large `before` state text. */
const StaffEditSummarySchema = Schema.Struct({
  id: Schema.Int,
  playerId: PlayerUuid,
  game: Schema.String,
  revBefore: Schema.Int,
  revAfter: Schema.Int,
  command: Schema.fromJsonString(Schema.Unknown),
  by: PlayerUuid,
  at: Schema.Int,
});
export type StaffEditSummary = typeof StaffEditSummarySchema.Type;

/**
 * Collects a pending staff edit if `command` is a `StaffCommand` with edit metadata and was
 * accepted (neither the rules nor Leaf's balance checks refused it).
 */
export function collectStaffEdit(
  edits: PendingStaffEdit[],
  command: unknown,
  commandId: string,
  attempt: Attempt,
  result: { readonly refused?: string },
): void {
  if ("refused" in attempt || "refused" in result) return;
  if (!(command instanceof StaffCommand) || command.edit === undefined) return;
  edits.push({
    commandId,
    by: command.edit.by,
    command: JSON.stringify(command.edit.command),
    before: attempt.before,
  });
}

/** Writes every pending staff edit inside the play service's transaction. */
export const recordStaffEdits = (
  sql: SqlClient.SqlClient,
  playerId: PlayerId,
  game: GameId,
  revBefore: number | null,
  revAfter: number,
  edits: readonly PendingStaffEdit[],
  at: number,
): Effect.Effect<void> =>
  Effect.forEach(
    edits,
    (edit) => sql`
      INSERT INTO play_staff_edits (player_id, game, command_id, rev_before, rev_after, before, command, by, at)
      VALUES (${playerId}, ${game}, ${edit.commandId}, ${revBefore ?? 0}, ${revAfter}, ${edit.before}, ${edit.command}, ${edit.by}, ${at})
      ON CONFLICT (player_id, game, command_id) DO NOTHING
    `,
    { discard: true },
  ).pipe(Effect.orDie);

/** Reads one staff edit for a player and game by its id, including the exact `before` state text. */
export const readStaffEdit = (
  sql: SqlClient.SqlClient,
  playerId: PlayerId,
  game: GameId,
  id: number,
): Effect.Effect<Option.Option<StaffEditRow>> =>
  SqlSchema.findOneOption({
    Request: Schema.Struct({ playerId: Schema.String, game: Schema.String, id: Schema.Int }),
    Result: StaffEditSchema,
    execute: (q) => sql`
      SELECT id, player_id AS playerId, game, command_id AS commandId, rev_before AS revBefore,
             rev_after AS revAfter, before, command, by, at
      FROM play_staff_edits
      WHERE id = ${q.id} AND player_id = ${q.playerId} AND game = ${q.game}
    `,
  })({ playerId, game, id }).pipe(Effect.orDie);

/** Reads the staff edit recorded for a command id, if one was written. */
export const readStaffEditByCommand = (
  sql: SqlClient.SqlClient,
  playerId: PlayerId,
  game: GameId,
  commandId: string,
): Effect.Effect<Option.Option<StaffEditSummary>> =>
  SqlSchema.findOneOption({
    Request: Schema.Struct({ playerId: Schema.String, game: Schema.String, commandId: Schema.String }),
    Result: StaffEditSummarySchema,
    execute: (q) => sql`
      SELECT id, player_id AS playerId, game, rev_before AS revBefore, rev_after AS revAfter, command, by, at
      FROM play_staff_edits
      WHERE player_id = ${q.playerId} AND game = ${q.game} AND command_id = ${q.commandId}
    `,
  })({ playerId, game, commandId }).pipe(Effect.orDie);

/** Lists a player's most recent staff edits for a game, newest first, omitting the full `before` text. */
export const listStaffEdits = (
  sql: SqlClient.SqlClient,
  playerId: PlayerId,
  game: GameId,
  limit = 20,
): Effect.Effect<readonly StaffEditSummary[]> =>
  SqlSchema.findAll({
    Request: Schema.Struct({ playerId: Schema.String, game: Schema.String, limit: Schema.Int }),
    Result: StaffEditSummarySchema,
    execute: (q) => sql`
      SELECT id, player_id AS playerId, game, rev_before AS revBefore, rev_after AS revAfter, command, by, at
      FROM play_staff_edits
      WHERE player_id = ${q.playerId} AND game = ${q.game}
      ORDER BY id DESC LIMIT ${q.limit}
    `,
  })({ playerId, game, limit }).pipe(Effect.orDie);
