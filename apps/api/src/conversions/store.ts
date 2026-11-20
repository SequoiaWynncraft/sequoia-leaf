import {
  CONVERSION_KINDS,
  CONVERSION_STATUSES,
  type ConversionKind,
  type ConversionStatus,
  type PlayerId,
} from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { PlayerUuid } from "../wire.ts";

const ConversionRow = Schema.Struct({
  id: Schema.Int,
  playerId: PlayerUuid,
  username: Schema.String,
  requestId: Schema.String,
  kind: Schema.Literals(CONVERSION_KINDS),
  units: Schema.Int,
  leaf: Schema.Int,
  note: Schema.NullOr(Schema.String),
  requestedMonth: Schema.Int,
  status: Schema.Literals(CONVERSION_STATUSES),
  paidMonth: Schema.NullOr(Schema.Int),
  closedAt: Schema.NullOr(Schema.Int),
  closedBy: Schema.NullOr(Schema.String),
  closeNote: Schema.NullOr(Schema.String),
  createdAt: Schema.Int,
});
export type Conversion = typeof ConversionRow.Type;

const COLUMNS = `id, player_id AS playerId, username, request_id AS requestId, kind, units, leaf, note,
  requested_month AS requestedMonth, status, paid_month AS paidMonth, closed_at AS closedAt,
  closed_by AS closedBy, close_note AS closeNote, created_at AS createdAt`;

const NewId = Schema.Struct({ id: Schema.Int });

/** A claim as its kind's queue needs it: only what decides the month that pays it. */
const QueueRow = Schema.Struct({
  id: Schema.Int,
  status: Schema.Literals(CONVERSION_STATUSES),
  units: Schema.Int,
  requestedMonth: Schema.Int,
  paidMonth: Schema.NullOr(Schema.Int),
});
export type Queued = typeof QueueRow.Type;

/**
 * Claims of Leaf out to LE, tomes and aspects, and the queue they wait in.
 * Leaf moves only through the ledger, never here. Writes belong in the
 * caller's transaction. A database failure is a defect.
 */
export class Conversions extends Context.Service<
  Conversions,
  {
    readonly conversion: (id: number) => Effect.Effect<Conversion | undefined>;
    /** The claim a member's request made, if it made one. */
    readonly conversionFor: (playerId: PlayerId, requestId: string) => Effect.Effect<Conversion | undefined>;
    /** Makes a claim, waiting, and answers its id. */
    readonly create: (
      claim: {
        readonly playerId: PlayerId;
        readonly username: string;
        readonly requestId: string;
        readonly kind: ConversionKind;
        readonly units: number;
        readonly leaf: number;
        readonly note: string | null;
        readonly requestedMonth: number;
      },
      now: number,
    ) => Effect.Effect<number>;
    /** Closes a waiting claim, recording who closed it and why. `paidMonth` is set for a paid one. */
    readonly close: (
      id: number,
      status: Exclude<ConversionStatus, "pending">,
      by: { readonly actor: PlayerId; readonly note: string | null; readonly paidMonth: number | null },
      now: number,
    ) => Effect.Effect<void>;
    /** A member's claims, newest first. */
    readonly of: (playerId: PlayerId, limit: number) => Effect.Effect<readonly Conversion[]>;
    /**
     * A kind's queue: its claims from the first still waiting on, waiting or
     * paid, in the order they were made. Empty when none waits.
     */
    readonly queue: (kind: ConversionKind) => Effect.Effect<readonly Queued[]>;
    /** Every claim of a kind still waiting, in the order they were made. */
    readonly waiting: (kind: ConversionKind) => Effect.Effect<readonly Conversion[]>;
    /** Units of a kind paid from each month from `fromMonth` on, by claims made before claim `beforeId`. */
    readonly paidBefore: (
      kind: ConversionKind,
      beforeId: number,
      fromMonth: number,
    ) => Effect.Effect<ReadonlyMap<number, number>>;
    /** Units of a kind a member claimed in a month and that still stand: waiting or paid. */
    readonly claimedIn: (playerId: PlayerId, kind: ConversionKind, month: number) => Effect.Effect<number>;
  }
>()("leaf/Conversions") {
  static readonly layer = Layer.effect(
    Conversions,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const decodeId = Schema.decodeUnknownEffect(NewId);

      const byId = SqlSchema.findOneOption({
        Request: Schema.Int,
        Result: ConversionRow,
        execute: (id) => sql`SELECT ${sql.literal(COLUMNS)} FROM conversions WHERE id = ${id}`,
      });
      const byRequest = SqlSchema.findOneOption({
        Request: Schema.Struct({ playerId: Schema.String, requestId: Schema.String }),
        Result: ConversionRow,
        execute: ({ playerId, requestId }) =>
          sql`SELECT ${sql.literal(COLUMNS)} FROM conversions WHERE player_id = ${playerId} AND request_id = ${requestId}`,
      });
      const ofPlayer = SqlSchema.findAll({
        Request: Schema.Struct({ playerId: Schema.String, limit: Schema.Int }),
        Result: ConversionRow,
        execute: ({ playerId, limit }) => sql`
          SELECT ${sql.literal(COLUMNS)} FROM conversions WHERE player_id = ${playerId} ORDER BY id DESC LIMIT ${limit}
        `,
      });
      const queue = SqlSchema.findAll({
        Request: Schema.String,
        Result: QueueRow,
        execute: (kind) => sql`
          SELECT id, status, units, requested_month AS requestedMonth, paid_month AS paidMonth FROM conversions
          WHERE kind = ${kind} AND status IN ('pending', 'paid')
            AND id >= (SELECT MIN(id) FROM conversions WHERE kind = ${kind} AND status = 'pending')
          ORDER BY id
        `,
      });
      const waiting = SqlSchema.findAll({
        Request: Schema.String,
        Result: ConversionRow,
        execute: (kind) => sql`
          SELECT ${sql.literal(COLUMNS)} FROM conversions WHERE kind = ${kind} AND status = 'pending' ORDER BY id
        `,
      });
      const paidBefore = SqlSchema.findAll({
        Request: Schema.Struct({ kind: Schema.String, beforeId: Schema.Int, fromMonth: Schema.Int }),
        Result: Schema.Struct({ month: Schema.Int, units: Schema.Int }),
        execute: ({ kind, beforeId, fromMonth }) => sql`
          SELECT paid_month AS month, SUM(units) AS units FROM conversions
          WHERE kind = ${kind} AND status = 'paid' AND id < ${beforeId} AND paid_month >= ${fromMonth}
          GROUP BY paid_month
        `,
      });
      const claimed = SqlSchema.findOne({
        Request: Schema.Struct({ playerId: Schema.String, kind: Schema.String, month: Schema.Int }),
        Result: Schema.Struct({ units: Schema.Int }),
        execute: ({ playerId, kind, month }) => sql`
          SELECT COALESCE(SUM(units), 0) AS units FROM conversions
          WHERE player_id = ${playerId} AND requested_month = ${month} AND kind = ${kind}
            AND status IN ('pending', 'paid')
        `,
      });

      return Conversions.of({
        conversion: (id) => byId(id).pipe(Effect.map(Option.getOrUndefined), Effect.orDie),
        conversionFor: (playerId, requestId) =>
          byRequest({ playerId, requestId }).pipe(Effect.map(Option.getOrUndefined), Effect.orDie),
        create: (claim, now) =>
          sql`
            INSERT INTO conversions ${sql.insert({ ...claim, status: "pending", createdAt: now })} RETURNING id
          `.pipe(
            Effect.flatMap(([row]) => decodeId(row)),
            Effect.map(({ id }) => id),
            Effect.orDie,
          ),
        close: (id, status, { actor, note, paidMonth }, now) =>
          sql`
            UPDATE conversions
            SET status = ${status}, paid_month = ${paidMonth}, closed_at = ${now}, closed_by = ${actor},
                close_note = ${note}
            WHERE id = ${id}
          `.pipe(Effect.asVoid, Effect.orDie),
        of: (playerId, limit) => ofPlayer({ playerId, limit }).pipe(Effect.orDie),
        queue: (kind) => queue(kind).pipe(Effect.orDie),
        waiting: (kind) => waiting(kind).pipe(Effect.orDie),
        paidBefore: (kind, beforeId, fromMonth) =>
          paidBefore({ kind, beforeId, fromMonth }).pipe(
            Effect.map((rows) => new Map(rows.map((row) => [row.month, row.units]))),
            Effect.orDie,
          ),
        claimedIn: (playerId, kind, month) =>
          claimed({ playerId, kind, month }).pipe(
            Effect.map((row) => row.units),
            Effect.orDie,
          ),
      });
    }),
  );
}
