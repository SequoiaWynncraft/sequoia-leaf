import {
  draftEntry,
  leaf,
  type PlayerId,
  type Quest,
  QUEST_SLOTS,
  type QuestBook,
  type QuestObjective,
  type QuestSlot,
  type QuestStep,
  RAID_KEYS,
  type RaidKey,
} from "@sequoia-leaf/core";

import { entryInsert } from "../ledger/store.ts";

interface QuestRow {
  slot: string;
  sequence: number;
  template_id: string;
  objective_type: string;
  objective_raid: string | null;
  target: number;
  reward_leaf: number;
  reward_xp: number;
  progress: number;
  started_at: number;
  expires_at: number | null;
  completed_at: number | null;
}

const QUEST_COLUMNS =
  "slot, sequence, template_id, objective_type, objective_raid, target, reward_leaf, reward_xp, progress, started_at, expires_at, completed_at";

function isSlot(value: string): value is QuestSlot {
  return QUEST_SLOTS.some((slot) => slot === value);
}

function isRaidKey(value: string): value is RaidKey {
  return RAID_KEYS.some((key) => key === value);
}

function toObjective(row: QuestRow): QuestObjective {
  if (row.objective_type === "wars") {
    return { type: "wars", count: row.target };
  }
  if (row.objective_type !== "raids") {
    throw new Error(`Quest has an unknown objective type: ${row.objective_type}`);
  }
  if (row.objective_raid === null) {
    return { type: "raids", count: row.target };
  }
  if (!isRaidKey(row.objective_raid)) {
    throw new Error(`Quest names an unknown raid: ${row.objective_raid}`);
  }
  return { type: "raids", raid: row.objective_raid, count: row.target };
}

function toQuest(row: QuestRow): Quest {
  if (!isSlot(row.slot)) {
    throw new Error(`Quest has an unknown slot: ${row.slot}`);
  }
  return {
    slot: row.slot,
    sequence: row.sequence,
    templateId: row.template_id,
    objective: toObjective(row),
    reward: { leaf: row.reward_leaf, xp: row.reward_xp },
    progress: row.progress,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
  };
}

type JoinedRow = { daily_charges: number; daily_charged_day: number } & {
  [Column in keyof QuestRow]: QuestRow[Column] | null;
};

/** The quest columns are all NULL when the player has no quest yet, and all set otherwise. */
function hasQuest(row: JoinedRow): row is JoinedRow & QuestRow {
  return row.slot !== null;
}

/** A player's quest book, or undefined for a player who has never had a quest. One database read. */
export async function loadQuestBook(db: D1Database, playerId: PlayerId): Promise<QuestBook | undefined> {
  // One row per slot's latest quest, each carrying the player's daily charges;
  // a single row of NULL quest columns for a player with charges but no quest.
  const { results } = await db
    .prepare(
      `SELECT player.daily_charges, player.daily_charged_day, ${QUEST_COLUMNS.split(", ")
        .map((column) => `quest.${column}`)
        .join(", ")}
       FROM quest_players AS player
       LEFT JOIN quests AS quest
         ON quest.player_id = player.player_id
        AND quest.sequence = (SELECT MAX(later.sequence) FROM quests AS later
                              WHERE later.player_id = quest.player_id AND later.slot = quest.slot)
       WHERE player.player_id = ?`,
    )
    .bind(playerId)
    .all<JoinedRow>();
  const [first] = results;
  if (first === undefined) {
    return undefined;
  }
  const latest: { [slot in QuestSlot]?: Quest } = {};
  for (const row of results) {
    if (hasQuest(row)) {
      const quest = toQuest(row);
      latest[quest.slot] = quest;
    }
  }
  return { dailyCharges: first.daily_charges, dailyChargedDay: first.daily_charged_day, latest };
}

/**
 * The statements that save a step: the player's daily charges, every quest
 * handed out or changed, and the reward of every quest finished. They belong
 * in the same batch as the activities that caused the step.
 */
export function questWrites(db: D1Database, playerId: PlayerId, step: QuestStep, now: number): D1PreparedStatement[] {
  const statements = [
    db
      .prepare(
        `INSERT INTO quest_players (player_id, daily_charges, daily_charged_day) VALUES (?, ?, ?)
         ON CONFLICT (player_id) DO UPDATE
         SET daily_charges = excluded.daily_charges, daily_charged_day = excluded.daily_charged_day`,
      )
      .bind(playerId, step.book.dailyCharges, step.book.dailyChargedDay),
  ];
  for (const quest of step.written) {
    statements.push(
      db
        .prepare(
          `INSERT INTO quests (player_id, ${QUEST_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (player_id, slot, sequence) DO UPDATE
           SET progress = excluded.progress, completed_at = excluded.completed_at`,
        )
        .bind(
          playerId,
          quest.slot,
          quest.sequence,
          quest.templateId,
          quest.objective.type,
          quest.objective.type === "raids" ? (quest.objective.raid ?? null) : null,
          quest.objective.count,
          quest.reward.leaf,
          quest.reward.xp,
          quest.progress,
          quest.startedAt,
          quest.expiresAt,
          quest.completedAt,
        ),
    );
  }
  for (const quest of step.completed) {
    const draft = draftEntry({
      kind: "earn",
      playerId,
      amount: leaf(quest.reward.leaf),
      xp: quest.reward.xp,
      source: "quest",
      idempotencyKey: `quest:${playerId}:${quest.slot}:${quest.sequence}`,
    });
    statements.push(entryInsert(db, draft, now));
  }
  return statements;
}

/** A player's quests finished at or after a moment, newest first. */
export async function listCompletedSince(db: D1Database, playerId: PlayerId, since: number): Promise<Quest[]> {
  const { results } = await db
    .prepare(
      `SELECT ${QUEST_COLUMNS} FROM quests
       WHERE player_id = ? AND completed_at >= ?
       ORDER BY completed_at DESC, slot, sequence DESC
       LIMIT 20`,
    )
    .bind(playerId, since)
    .all<QuestRow>();
  return results.map(toQuest);
}
