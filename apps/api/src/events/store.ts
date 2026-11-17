import type { Database } from "bun:sqlite";

import type { PlayerId } from "@sequoia-leaf/core";

import type { questJson } from "../quests/json.ts";

/** Something that happened to a player, with its details in the shape the API sends. */
export type PlayerEvent =
  /** A raid or war paid Leaf. `detail` is the raid's name or the territory; `occurred_at` is when it was played. */
  | {
      readonly type: "leaf_earned";
      readonly data: { source: "raid" | "war"; leaf: number; xp: number; detail: string; occurred_at: string };
    }
  /** A quest was finished and its reward paid. */
  | { readonly type: "quest_completed"; readonly data: { quest: ReturnType<typeof questJson> } }
  /** The player's XP reached a new level. */
  | { readonly type: "level_up"; readonly data: { level: number } }
  /**
   * An achievement milestone paid Leaf. `ladder` is Sierra's key, such as
   * `raid:TNA`; `count` is how many raids or wars the milestone stands for.
   */
  | {
      readonly type: "achievement_paid";
      readonly data: {
        award_id: string;
        ladder: string;
        milestone: string;
        tier: string | null;
        count: number | null;
        leaf: number;
        xp: number;
        earned_at: string;
      };
    };

/** An event as stored: its place in the player's history, and its details as the JSON text that was written. */
export interface StoredEvent {
  readonly id: number;
  readonly type: string;
  readonly data: string;
  readonly createdAt: number;
}

/** Records an event. Call it in the same transaction as the change it reports. */
export function insertEvent(db: Database, playerId: PlayerId, event: PlayerEvent, now: number): void {
  db.query("INSERT INTO events (player_id, type, data, created_at) VALUES (?, ?, ?, ?)").run(
    playerId,
    event.type,
    JSON.stringify(event.data),
    now,
  );
}

/** A player's events after an event id, oldest first. */
export function listEventsAfter(db: Database, playerId: PlayerId, afterId: number, limit: number): StoredEvent[] {
  return db
    .query<{ id: number; type: string; data: string; created_at: number }, [string, number, number]>(
      "SELECT id, type, data, created_at FROM events WHERE player_id = ? AND id > ? ORDER BY id LIMIT ?",
    )
    .all(playerId, afterId, limit)
    .map((row) => ({ id: row.id, type: row.type, data: row.data, createdAt: row.created_at }));
}

/** A player's newest events, oldest first. */
export function listLatestEvents(db: Database, playerId: PlayerId, limit: number): StoredEvent[] {
  return db
    .query<{ id: number; type: string; data: string; created_at: number }, [string, number]>(
      "SELECT id, type, data, created_at FROM events WHERE player_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(playerId, limit)
    .map((row) => ({ id: row.id, type: row.type, data: row.data, createdAt: row.created_at }))
    .toReversed();
}

/** The id of the newest event of any player, or 0 when there are none. Events written from now on have a larger id. */
export function latestEventId(db: Database): number {
  return db.query<{ id: number }, []>("SELECT COALESCE(MAX(id), 0) AS id FROM events").get()?.id ?? 0;
}

/** An event as the API sends it, as JSON text. The stored details are already JSON, so they are spliced in as they are. */
export function eventJsonText(event: StoredEvent): string {
  const head = JSON.stringify({ id: event.id, type: event.type, created_at: new Date(event.createdAt).toISOString() });
  return `${head.slice(0, -1)},"data":${event.data}}`;
}
