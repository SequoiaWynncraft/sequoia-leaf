import { DAY_MS, utcDay } from "@sequoia-leaf/core";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import type { PlayersEvent } from "../events/store.ts";

/** The kinds of event the whole guild sees of each other: raids and wars, levels and milestones. */
export const GUILD_EVENT_TYPES = ["leaf_earned", "level_up", "achievement_paid"] as const;

/**
 * What a member is shown of another member's event, by its type: what
 * happened, never what it paid. Decoding a stored event keeps only these
 * fields and drops the rest, Leaf and XP among them.
 */
const Shown = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("leaf_earned"),
    data: Schema.fromJsonString(
      Schema.Struct({
        source: Schema.Literals(["raid", "war"]),
        detail: Schema.String,
        occurred_at: Schema.String,
        in_claim: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("level_up"),
    data: Schema.fromJsonString(Schema.Struct({ level: Schema.Int })),
  }),
  Schema.Struct({
    type: Schema.Literal("achievement_paid"),
    data: Schema.fromJsonString(
      Schema.Struct({ label: Schema.NullOr(Schema.String), tier: Schema.NullOr(Schema.String) }),
    ),
  }),
]);

const shown = Schema.decodeUnknownOption(Shown);

/** A guild event as the API sends it. */
export interface GuildEvent {
  readonly id: number;
  readonly type: string;
  /** The event as JSON text. */
  readonly json: string;
}

/**
 * Events as the guild sees them, each with the name of the member it happened
 * to. One whose member has no name in `names` is left out, as is one that is
 * not of the guild's kinds.
 */
export function guildEvents(events: readonly PlayersEvent[], names: ReadonlyMap<string, string>): GuildEvent[] {
  return events.flatMap((event) => {
    const username = names.get(event.playerId);
    const view = shown({ type: event.type, data: event.data });
    if (username === undefined || Option.isNone(view)) {
      return [];
    }
    const json = JSON.stringify({
      id: event.id,
      type: view.value.type,
      created_at: new Date(event.createdAt).toISOString(),
      player: { id: event.playerId, username },
      data: view.value.data,
    });
    return [{ id: event.id, type: view.value.type, json }];
  });
}

/** The raids and wars Leaf paid for: those it wrote an event for, so those the guild's events tell of. */
const TOLD = "activities a JOIN ledger_entries l ON l.idempotency_key = a.source_key";

/**
 * What the town shows of the guild that its newest events cannot say, as the
 * rest of the answer's JSON: how many raids and wars the guild finished in the
 * UTC day of `now`, by when each happened, each once however many members it
 * paid (a row's `source_key` is the raid's or the war's own id and then the
 * member's); and the last
 * territory fought at, by when the war happened, of two at one moment the one
 * whose name sorts later.
 */
/**
 * How long a credit's source key's last part is, `:` and the account's dashed UUID
 * (`raid:<completion>:<account>`): without it, the key names the raid or war, whoever's account it was.
 */
const ACCOUNT_SUFFIX = 37;

export const guildDay = Effect.fnUntraced(function* (now: number) {
  const sql = yield* SqlClient.SqlClient;
  const from = utcDay(now) * DAY_MS;
  const counted = SqlSchema.findAll({
    Request: Schema.Int,
    Result: Schema.Struct({ kind: Schema.Literals(["raid", "war"]), count: Schema.Int }),
    execute: (since) => sql`
      SELECT a.kind AS kind, COUNT(DISTINCT substr(a.source_key, 1, length(a.source_key) - ${ACCOUNT_SUFFIX})) AS count
      FROM ${sql.literal(TOLD)}
      WHERE a.occurred_at >= ${since} AND a.occurred_at < ${since + DAY_MS}
      GROUP BY a.kind
    `,
  });
  const lastWar = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ territory: Schema.String, occurredAt: Schema.Int }),
    execute: () => sql`
      SELECT a.detail AS territory, a.occurred_at AS occurredAt
      FROM ${sql.literal(TOLD)}
      WHERE a.kind = 'war'
      ORDER BY a.occurred_at DESC, a.detail DESC LIMIT 1
    `,
  });
  const counts = yield* counted(from);
  const [war] = yield* lastWar(undefined);
  const count = (kind: "raid" | "war") => counts.find((row) => row.kind === kind)?.count ?? 0;
  return JSON.stringify({
    today: { from: new Date(from).toISOString(), raids: count("raid"), wars: count("war") },
    last_war: war ? { territory: war.territory, occurred_at: new Date(war.occurredAt).toISOString() } : null,
  }).slice(1);
});
