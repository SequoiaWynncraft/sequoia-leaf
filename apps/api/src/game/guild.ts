import { Option, Schema } from "effect";

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
