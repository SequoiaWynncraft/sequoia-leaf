import {
  assignSpots,
  bloomCyclesBetween,
  type ConePull,
  GROVE_RANKS,
  type GroveRules,
  type PlayerId,
} from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { PlayerUuid } from "../wire.ts";

/** A member who has opened the Grove. */
const Member = Schema.Struct({
  playerId: PlayerUuid,
  username: Schema.String,
  firstSeenAt: Schema.Int,
  spot: Schema.Int,
  companion: Schema.NullOr(Schema.String),
  chargeAnchor: Schema.NullOr(Schema.Int),
});
export type GroveMember = typeof Member.Type;

const MEMBER_COLUMNS = `player_id AS playerId, username, first_seen_at AS firstSeenAt, spot, companion,
  charge_anchor AS chargeAnchor`;

const Flag = Schema.Literals([0, 1]);

const OpeningRow = Schema.Struct({
  banner: Schema.String,
  roll: Schema.Int,
  pityBefore: Schema.Int,
  pityAfter: Schema.Int,
  rank: Schema.Literals(GROVE_RANKS),
  spirit: Schema.String,
  verdant: Flag,
  guaranteed: Flag,
  featured: Flag,
  copy: Schema.Int,
});

/** A cone as the audit holds it: what it gave, and the banner it was opened on. */
export interface StoredOpening extends ConePull {
  readonly banner: string;
}

/** A spirit a member has opened, how many times, and whether any copy wore the Verdant coat. */
export interface Found {
  readonly spirit: string;
  readonly copies: number;
  readonly verdant: boolean;
}

/** A member's tree as the Forest shows it. */
export interface ForestTree {
  readonly playerId: PlayerId;
  readonly username: string;
  readonly spot: number;
  readonly companion: string | null;
  readonly xp: number;
}

const Totals = Schema.Struct({ bloom: Schema.Int, cones: Schema.Int });

/**
 * Each member's Grove: their place in the Forest, their Bloom, cones, care and
 * spirits. Every gain is stored once by the fact behind it, so writing it again
 * changes nothing. Leaf moves only through the ledger, never here. A database
 * failure is a defect.
 */
export class Grove extends Context.Service<
  Grove,
  {
    /**
     * Records that a member opened the Grove, under the name they signed in
     * with. The first time, they get the free spot nearest the Forest's heart,
     * which is theirs from then on. Call it in a transaction.
     */
    readonly visit: (playerId: PlayerId, username: string, now: number) => Effect.Effect<GroveMember>;
    readonly member: (playerId: PlayerId) => Effect.Effect<GroveMember | undefined>;
    /** All the Bloom a member ever gained. */
    readonly bloomGained: (playerId: PlayerId) => Effect.Effect<number>;
    /**
     * Adds Bloom once by `key`, and grants a cone for each Bloom cycle it
     * completes, once by the cycle's number. Answers the cycles it completed:
     * none when the key was recorded before. Call it in a transaction.
     */
    readonly addBloom: (
      playerId: PlayerId,
      key: string,
      source: "raid" | "care",
      bloom: number,
      now: number,
      rules: GroveRules,
    ) => Effect.Effect<readonly number[]>;
    /** Grants cones once by `key`. Answers false, and grants nothing, when the key was used before. */
    readonly grantCones: (
      playerId: PlayerId,
      key: string,
      source: "bought" | "bloom",
      cones: number,
      now: number,
    ) => Effect.Effect<boolean>;
    /** The cones a member holds: those granted, less those opened. */
    readonly cones: (playerId: PlayerId) => Effect.Effect<number>;
    /** Cones opened since the member's last one of the pity rank or better, on any banner. */
    readonly pity: (playerId: PlayerId) => Effect.Effect<number>;
    /** The spirits a member has opened, in the order they first found them. */
    readonly collection: (playerId: PlayerId) => Effect.Effect<readonly Found[]>;
    /** The cones a request opened, in order; none when it opened none. */
    readonly openings: (playerId: PlayerId, requestId: string) => Effect.Effect<readonly StoredOpening[]>;
    /** Stores the cones a request opened, in order. Call it in a transaction. */
    readonly recordOpenings: (
      playerId: PlayerId,
      requestId: string,
      banner: string,
      pulls: readonly ConePull[],
      now: number,
    ) => Effect.Effect<void>;
    /** The tool a care request used, when it was recorded before. */
    readonly careFor: (playerId: PlayerId, requestId: string) => Effect.Effect<string | undefined>;
    /** Records a care request, with the member's charges counted from `anchor` after it. Call it in a transaction. */
    readonly recordCare: (
      playerId: PlayerId,
      requestId: string,
      tool: string,
      anchor: number,
      now: number,
    ) => Effect.Effect<void>;
    readonly setCompanion: (playerId: PlayerId, spirit: string | null) => Effect.Effect<void>;
    /** Every member's tree, nearest the heart first. */
    readonly forest: Effect.Effect<readonly ForestTree[]>;
  }
>()("leaf/Grove") {
  static readonly layer = Layer.effect(
    Grove,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const findMember = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Member,
        execute: (playerId) =>
          sql`SELECT ${sql.literal(MEMBER_COLUMNS)} FROM grove_members WHERE player_id = ${playerId}`,
      });
      const spots = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({ spot: Schema.Int }),
        execute: () => sql`SELECT spot FROM grove_members`,
      });
      // The triggers keep these from the facts, so they cost the same however long a member has played.
      const totalsRow = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Totals,
        execute: (playerId) => sql`SELECT bloom, cones FROM grove_totals WHERE player_id = ${playerId}`,
      });
      const totals = (playerId: PlayerId) =>
        totalsRow(playerId).pipe(Effect.map(Option.getOrElse(() => ({ bloom: 0, cones: 0 }))), Effect.orDie);
      const latestPity = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({ pity: Schema.Int }),
        execute: (playerId) => sql`
          SELECT pity_after AS pity FROM grove_openings WHERE player_id = ${playerId} ORDER BY id DESC LIMIT 1
        `,
      });
      const found = SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({ spirit: Schema.String, copies: Schema.Int, verdant: Flag }),
        execute: (playerId) => sql`
          SELECT spirit, copies, verdant FROM grove_spirits WHERE player_id = ${playerId} ORDER BY first_found
        `,
      });
      const openingRows = SqlSchema.findAll({
        Request: Schema.Struct({ playerId: Schema.String, requestId: Schema.String }),
        Result: OpeningRow,
        execute: ({ playerId, requestId }) => sql`
          SELECT banner, roll, pity_before AS pityBefore, pity_after AS pityAfter, rank, spirit,
                 verdant, guaranteed, featured, copy
          FROM grove_openings WHERE player_id = ${playerId} AND request_id = ${requestId}
          ORDER BY position
        `,
      });
      const careTool = SqlSchema.findOneOption({
        Request: Schema.Struct({ playerId: Schema.String, requestId: Schema.String }),
        Result: Schema.Struct({ tool: Schema.String }),
        execute: ({ playerId, requestId }) =>
          sql`SELECT tool FROM grove_care WHERE player_id = ${playerId} AND request_id = ${requestId}`,
      });
      const trees = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({
          playerId: PlayerUuid,
          username: Schema.String,
          spot: Schema.Int,
          companion: Schema.NullOr(Schema.String),
          xp: Schema.Int,
        }),
        execute: () => sql`
          SELECT member.player_id AS playerId, member.username, member.spot, member.companion,
                 COALESCE(account.xp, 0) AS xp
          FROM grove_members AS member
          LEFT JOIN accounts AS account ON account.player_id = member.player_id
          ORDER BY member.spot
        `,
      });

      const member = (playerId: PlayerId) => findMember(playerId).pipe(Effect.map(Option.getOrUndefined), Effect.orDie);

      const visit = Effect.fn("Grove.visit")(function* (playerId: PlayerId, username: string, now: number) {
        const known = yield* member(playerId);
        if (known !== undefined) {
          if (known.username === username) {
            return known;
          }
          yield* sql`UPDATE grove_members SET username = ${username} WHERE player_id = ${playerId}`.pipe(Effect.orDie);
          return { ...known, username };
        }
        const taken = (yield* spots(undefined).pipe(Effect.orDie)).map((row) => row.spot);
        const spot = assignSpots(taken, [playerId]).get(playerId) ?? taken.length;
        const created: GroveMember = {
          playerId,
          username,
          firstSeenAt: now,
          spot,
          companion: null,
          chargeAnchor: null,
        };
        yield* sql`INSERT INTO grove_members ${sql.insert(created)}`.pipe(Effect.orDie);
        return created;
      });

      const grantCones = (playerId: PlayerId, key: string, source: "bought" | "bloom", cones: number, now: number) =>
        sql`
          INSERT INTO grove_cone_grants ${sql.insert({ key, playerId, source, cones, createdAt: now })}
          ON CONFLICT (key) DO NOTHING RETURNING key
        `.pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.orDie,
        );

      const addBloom = Effect.fn("Grove.addBloom")(function* (
        playerId: PlayerId,
        key: string,
        source: "raid" | "care",
        bloom: number,
        now: number,
        rules: GroveRules,
      ) {
        if (bloom <= 0) {
          return [];
        }
        const added = yield* sql`
          INSERT INTO grove_bloom ${sql.insert({ key, playerId, source, bloom, createdAt: now })}
          ON CONFLICT (key) DO NOTHING RETURNING key
        `.pipe(Effect.orDie);
        if (added.length === 0) {
          return [];
        }
        const total = (yield* totals(playerId)).bloom;
        const cycles = bloomCyclesBetween(total - bloom, total, rules);
        for (const cycle of cycles) {
          yield* grantCones(playerId, `bloom:${playerId}:${cycle}`, "bloom", 1, now);
        }
        return cycles;
      });

      const recordOpenings = Effect.fn("Grove.recordOpenings")(function* (
        playerId: PlayerId,
        requestId: string,
        banner: string,
        pulls: readonly ConePull[],
        now: number,
      ) {
        for (const [position, pull] of pulls.entries()) {
          yield* sql`
            INSERT INTO grove_openings ${sql.insert({
              playerId,
              requestId,
              position,
              banner,
              roll: pull.roll,
              pityBefore: pull.pityBefore,
              pityAfter: pull.pityAfter,
              rank: pull.rank,
              spirit: pull.spirit,
              verdant: Number(pull.verdant),
              guaranteed: Number(pull.guaranteed),
              featured: Number(pull.featured),
              copy: pull.copy,
              createdAt: now,
            })}
          `.pipe(Effect.orDie);
        }
      });

      return Grove.of({
        visit,
        member,
        bloomGained: (playerId) => totals(playerId).pipe(Effect.map(({ bloom }) => bloom)),
        addBloom,
        grantCones,
        cones: (playerId) => totals(playerId).pipe(Effect.map(({ cones }) => cones)),
        pity: (playerId) =>
          latestPity(playerId).pipe(
            Effect.map((row) => Option.match(row, { onNone: () => 0, onSome: ({ pity }) => pity })),
            Effect.orDie,
          ),
        collection: (playerId) =>
          found(playerId).pipe(
            Effect.map((rows) => rows.map((row) => ({ ...row, verdant: row.verdant === 1 }))),
            Effect.orDie,
          ),
        openings: (playerId, requestId) =>
          openingRows({ playerId, requestId }).pipe(
            Effect.map((rows) =>
              rows.map((row) => ({
                ...row,
                verdant: row.verdant === 1,
                guaranteed: row.guaranteed === 1,
                featured: row.featured === 1,
              })),
            ),
            Effect.orDie,
          ),
        recordOpenings,
        careFor: (playerId, requestId) =>
          careTool({ playerId, requestId }).pipe(
            Effect.map((row) => Option.getOrUndefined(Option.map(row, ({ tool }) => tool))),
            Effect.orDie,
          ),
        recordCare: (playerId, requestId, tool, anchor, now) =>
          Effect.gen(function* () {
            yield* sql`INSERT INTO grove_care ${sql.insert({ playerId, requestId, tool, createdAt: now })}`;
            yield* sql`UPDATE grove_members SET charge_anchor = ${anchor} WHERE player_id = ${playerId}`;
          }).pipe(Effect.orDie),
        setCompanion: (playerId, spirit) =>
          sql`UPDATE grove_members SET companion = ${spirit} WHERE player_id = ${playerId}`.pipe(
            Effect.asVoid,
            Effect.orDie,
          ),
        forest: trees(undefined).pipe(Effect.orDie),
      });
    }),
  );
}
