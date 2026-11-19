import type { Database } from "bun:sqlite";

import {
  type Activity,
  DEFAULT_RULES,
  draftEntry,
  EARN_SOURCES,
  leaf,
  leafForActivity,
  parsePlayerId,
  type PlayerId,
  type Rules,
} from "@sequoia-leaf/core";

import { fetchCredits } from "../backend/credits.ts";
import { getAccount, insertEntry, listEarns } from "../ledger/store.ts";
import { payLevels } from "../levels/pay.ts";
import type { Services } from "../services.ts";
import { type CorrectionMode, readRaidShares } from "./raid-shares.ts";
import type { CreditSource } from "./sync.ts";

// The guild share correction of 2026-11-19, run once by hand with
// `scripts/correct-guild-shares.ts`; see "Correcting guild shares" in the README.
//
// Until sequoia-backend#536 the credit feed split each raid's season rating
// among everyone in the party, allies from other guilds included, though the
// rating is Sequoia's alone. So members were paid less than their share, and
// players who were never in the guild were paid Leaf. This pays each member
// what their share is still owed, and takes back everything paid to players
// who were never in the guild.

const MEMO = "Guild share correction, 2026-11-19";

/** Any raid entry the credit sync or a correction paid for one completion: `raid:<completion id>:<player>[:...]`. */
const RAID_KEY = /^raid:(\d+):([0-9a-f-]{36})(?::[a-z-]+)?$/;

export interface GuildShareOptions {
  readonly mode: CorrectionMode;
  /** Players who were never Sequoia members, from the backend's membership records. */
  readonly neverMembers: ReadonlySet<PlayerId>;
}

/** What a run did, or in a dry run would do. Printed as it is, so its names are snake_case. */
export interface GuildShareReport {
  players_checked: number;
  /** Members paid the rest of one raid's share or more, and what that paid. */
  members_topped_up: number;
  raid_shares_topped_up: number;
  leaf_topped_up: number;
  xp_topped_up: number;
  /** Levels the topped-up XP reaches, paid as levels always are. */
  levels_paid: number;
  level_leaf_paid: number;
  /** Raids paid more than the feed's share now. None are expected; they stand. */
  raid_payments_above_share: number;
  /** Raids paid that the feed no longer lists for the member, such as a merged completion. They stand. */
  raid_payments_without_feed_row: number;
  /** Never-members whose Leaf was taken back, and what was taken. */
  never_members_corrected: number;
  never_member_entries_reversed: number;
  never_member_leaf_taken_back: number;
  never_member_xp_taken_back: number;
  net_leaf_change: number;
  net_xp_change: number;
}

/**
 * Reads the fixed feed from the credit sync's first run to now, and corrects
 * every player against it. In `dry_run` mode nothing is kept; running it again
 * after `apply` changes nothing.
 */
export async function runGuildShareCorrection(
  services: Services,
  options: GuildShareOptions,
): Promise<GuildShareReport & { mode: CorrectionMode; feed_raid_credits: number }> {
  const { token, url } = services.backend;
  if (token === undefined) {
    throw new Error("BACKEND_INTERNAL_TOKEN is not set, so the credit feed cannot be read");
  }
  const now = services.now();
  const started = services.db
    .query<{ started_at: number | null }, []>("SELECT started_at FROM sync_state WHERE name = 'credits'")
    .get();
  const source: CreditSource = (from, to) => fetchCredits(services.fetcher, { baseUrl: url, token }, from, to);
  const { shares } = await readRaidShares(source, Math.min(started?.started_at ?? now, now), now);
  const report = correctGuildShares(services.db, shares, DEFAULT_RULES, now, options);
  return { mode: options.mode, feed_raid_credits: shares.size, ...report };
}

/** Carries a dry run's report out of the transaction it rolls back. */
class DryRunRollback extends Error {
  override readonly name = "DryRunRollback";
  readonly report: GuildShareReport;

  constructor(report: GuildShareReport) {
    super("A dry run rolls back what it did");
    this.report = report;
  }
}

/** Corrects every player against `shares`, the fixed feed's raid credits by source key, each in a transaction of their own. Writes no events. */
export function correctGuildShares(
  db: Database,
  shares: ReadonlyMap<string, Activity>,
  rules: Rules,
  now: number,
  options: GuildShareOptions,
): GuildShareReport {
  if (options.mode === "apply") {
    return correctAll(db, shares, rules, now, options.neverMembers);
  }
  try {
    db.transaction(() => {
      throw new DryRunRollback(correctAll(db, shares, rules, now, options.neverMembers));
    }).immediate();
  } catch (error) {
    if (error instanceof DryRunRollback) {
      return error.report;
    }
    throw error;
  }
  throw new Error("A dry run must end by rolling back");
}

function correctAll(
  db: Database,
  shares: ReadonlyMap<string, Activity>,
  rules: Rules,
  now: number,
  neverMembers: ReadonlySet<PlayerId>,
): GuildShareReport {
  const report: GuildShareReport = {
    players_checked: 0,
    members_topped_up: 0,
    raid_shares_topped_up: 0,
    leaf_topped_up: 0,
    xp_topped_up: 0,
    levels_paid: 0,
    level_leaf_paid: 0,
    raid_payments_above_share: 0,
    raid_payments_without_feed_row: 0,
    never_members_corrected: 0,
    never_member_entries_reversed: 0,
    never_member_leaf_taken_back: 0,
    never_member_xp_taken_back: 0,
    net_leaf_change: 0,
    net_xp_change: 0,
  };
  const players = db.query<{ player_id: string }, []>("SELECT player_id FROM accounts ORDER BY player_id").all();
  for (const row of players) {
    const playerId = parsePlayerId(row.player_id);
    if (playerId === undefined) {
      continue;
    }
    report.players_checked += 1;
    const before = getAccount(db, playerId);
    // A player is corrected entirely or not at all. Inside a dry run's transaction this is a savepoint.
    db.transaction(() =>
      neverMembers.has(playerId)
        ? takeBackEverything(db, playerId, now, report)
        : topUpRaidShares(db, playerId, shares, rules, now, report),
    ).immediate();
    const after = getAccount(db, playerId);
    report.net_leaf_change += after.balance - before.balance;
    report.net_xp_change += after.xp - before.xp;
  }
  return report;
}

/** Reverses every earn of a player who was never in the guild: their raids, and the quests and levels those raids reached. */
function takeBackEverything(db: Database, playerId: PlayerId, now: number, report: GuildShareReport): void {
  let reversed = 0;
  for (const source of EARN_SOURCES) {
    for (const { entry, reversed: undone } of listEarns(db, playerId, source)) {
      if (undone) {
        continue;
      }
      insertEntry(
        db,
        draftEntry({
          kind: "reversal",
          playerId,
          reverses: entry,
          idempotencyKey: `undo:${entry.idempotencyKey}`,
          memo: MEMO,
        }),
        now,
      );
      reversed += 1;
      report.never_member_entries_reversed += 1;
      report.never_member_leaf_taken_back += entry.balanceDelta;
      report.never_member_xp_taken_back += entry.xpDelta;
    }
  }
  if (reversed > 0) {
    report.never_members_corrected += 1;
  }
}

/** Pays a member the rest of each raid's share the feed now lists, then the levels that reaches. */
function topUpRaidShares(
  db: Database,
  playerId: PlayerId,
  shares: ReadonlyMap<string, Activity>,
  rules: Rules,
  now: number,
  report: GuildShareReport,
): void {
  // What each completion has paid so far, across the sync's payment and any correction's.
  const paid = new Map<string, number>();
  for (const { entry, reversed } of listEarns(db, playerId, "raid")) {
    const match = RAID_KEY.exec(entry.idempotencyKey);
    if (reversed || match?.[2] !== playerId) {
      continue;
    }
    const key = `raid:${match[1]}:${playerId}`;
    paid.set(key, (paid.get(key) ?? 0) + entry.balanceDelta);
  }
  let toppedUp = 0;
  for (const [key, amount] of paid) {
    const share = shares.get(key);
    if (share === undefined) {
      report.raid_payments_without_feed_row += 1;
      continue;
    }
    const owed = leafForActivity(share, rules.earning) - amount;
    if (owed < 0) {
      report.raid_payments_above_share += 1;
    }
    if (owed <= 0) {
      continue;
    }
    const earned = insertEntry(
      db,
      draftEntry({
        kind: "earn",
        playerId,
        amount: leaf(owed),
        source: "raid",
        idempotencyKey: `${key}:guild-share`,
        memo: MEMO,
      }),
      now,
    );
    toppedUp += 1;
    report.raid_shares_topped_up += 1;
    report.leaf_topped_up += earned.balanceDelta;
    report.xp_topped_up += earned.xpDelta;
  }
  if (toppedUp === 0) {
    return;
  }
  report.members_topped_up += 1;
  const levelsBefore = listEarns(db, playerId, "level").filter((earn) => !earn.reversed).length;
  report.level_leaf_paid += payLevels(db, playerId, rules.levels, now);
  report.levels_paid += listEarns(db, playerId, "level").filter((earn) => !earn.reversed).length - levelsBefore;
}
