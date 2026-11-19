import type { Database } from "bun:sqlite";

import {
  type Activity,
  correctRaidPayment,
  DAY_MS,
  DEFAULT_RULES,
  draftEntry,
  leaf,
  levelForXp,
  parsePlayerId,
  type PlayerId,
  type Rules,
} from "@sequoia-leaf/core";

import { fetchCredits } from "../backend/credits.ts";
import { getAccount, insertEntry, listEarns } from "../ledger/store.ts";
import { takeBackLevels } from "../levels/pay.ts";
import type { Services } from "../services.ts";
import type { CreditSource } from "./sync.ts";

// The raid share correction of 2026-11-19, run once by hand with
// `scripts/correct-raid-shares.ts`; see "Correcting raid shares" in the README.
//
// Until then the credit feed gave every raid party member the whole party's
// season rating, so each was paid about 3.3 times their share. The feed now
// gives each member their share. This reverses every raid payment that was
// above the share, pays the share in its place, and takes back the payouts of
// levels the corrected XP no longer reaches.

/** The longest window the backend's credit feed answers. */
export const FEED_WINDOW_MS = 31 * DAY_MS;

const MEMO = "Raid share correction, 2026-11-19";

/** A raid payment as the credit sync keys it. Other raid entries, such as the shares this pays, do not match. */
const RAID_PAYMENT_KEY = /^raid:\d+:[0-9a-f-]{36}$/;

/** How many players the report names. */
const TOP_PLAYERS = 5;

/** `dry_run` does everything in one transaction and rolls it back; `apply` keeps it. */
export type CorrectionMode = "dry_run" | "apply";

/** What one player's correction took back, for the report's list of the players it took the most from. */
export interface PlayerCorrection {
  readonly player_id: PlayerId;
  /** Leaf and XP taken back, after the shares paid in place. */
  readonly leaf_taken_back: number;
  readonly xp_taken_back: number;
  readonly level_before: number;
  readonly level_after: number;
}

/** What a run did, or in a dry run would do. Printed as it is, so its names are snake_case. */
export interface CorrectionReport {
  /** Players with a raid payment the correction looked at. */
  players_checked: number;
  players_corrected: number;
  /** Raid payments the credit sync made that no reversal had undone. */
  raid_entries_checked: number;
  raid_entries_reversed: number;
  /** Payments the feed lists at or above what was paid, which stand. */
  raid_entries_kept: number;
  /** Payments the feed no longer lists, for example because the name no longer resolves. They stand. */
  raid_entries_without_feed_row: number;
  raid_leaf_without_feed_row: number;
  /** What the reversed raid payments had paid, in full. */
  raid_leaf_reversed: number;
  raid_xp_reversed: number;
  /** What the shares paid in their place. A share of zero pays nothing. */
  share_entries_earned: number;
  share_leaf_earned: number;
  share_xp_earned: number;
  /** Level payouts reversed because the corrected XP no longer reaches the level. */
  level_entries_reversed: number;
  level_leaf_reversed: number;
  /** The change to all balances and XP together. Never positive. */
  net_leaf_change: number;
  net_xp_change: number;
  players_whose_level_drops: number;
  largest_level_drop: number;
  /** Players left with a negative balance. Zero while Leaf cannot be spent. */
  players_below_zero: number;
  top_players_by_leaf_taken_back: PlayerCorrection[];
}

/** The report of a whole run: which part of the feed was read, and what the correction did. */
export interface CorrectionRun extends CorrectionReport {
  mode: CorrectionMode;
  feed_from: string;
  feed_to: string;
  feed_windows: number;
  feed_raid_credits: number;
}

/**
 * Reads the corrected feed from the credit sync's first run to now, and
 * corrects every raid payment against it. In `dry_run` mode nothing is kept.
 * Running it again after `apply` changes nothing.
 */
export async function runRaidShareCorrection(services: Services, mode: CorrectionMode): Promise<CorrectionRun> {
  const { token, url } = services.backend;
  if (token === undefined) {
    throw new Error("BACKEND_INTERNAL_TOKEN is not set, so the credit feed cannot be read");
  }
  const now = services.now();
  const started = services.db
    .query<{ started_at: number | null }, []>("SELECT started_at FROM sync_state WHERE name = 'credits'")
    .get();
  const from = Math.min(started?.started_at ?? now, now);
  const source: CreditSource = (windowFrom, windowTo) =>
    fetchCredits(services.fetcher, { baseUrl: url, token }, windowFrom, windowTo);
  const { shares, windows } = await readRaidShares(source, from, now);
  const report = correctRaidShares(services.db, shares, DEFAULT_RULES, now, mode);
  return {
    mode,
    feed_from: new Date(from).toISOString(),
    feed_to: new Date(now).toISOString(),
    feed_windows: windows,
    feed_raid_credits: shares.size,
    ...report,
  };
}

/** Reads the raid credits in [from, to) in windows the backend accepts, by the key the credit sync pays them under. */
export async function readRaidShares(
  source: CreditSource,
  from: number,
  to: number,
): Promise<{ shares: Map<string, Activity>; windows: number }> {
  const starts: number[] = [];
  for (let start = from; start < to; start += FEED_WINDOW_MS) {
    starts.push(start);
  }
  const read = await Promise.all(starts.map((start) => source(start, Math.min(start + FEED_WINDOW_MS, to))));
  const shares = new Map<string, Activity>();
  for (const activity of read.flat()) {
    if (activity.kind === "raid") {
      shares.set(activity.sourceKey, activity);
    }
  }
  return { shares, windows: starts.length };
}

/** Carries a dry run's report out of the transaction it rolls back. */
class DryRunRollback extends Error {
  override readonly name = "DryRunRollback";
  readonly report: CorrectionReport;

  constructor(report: CorrectionReport) {
    super("A dry run rolls back what it did");
    this.report = report;
  }
}

/**
 * Corrects every player's raid payments against `shares`, the corrected
 * feed's raid credits by source key, each player in a transaction of their
 * own. Payments made after `now` are left alone: they were paid from the
 * corrected feed while this ran. Writes no events.
 */
export function correctRaidShares(
  db: Database,
  shares: ReadonlyMap<string, Activity>,
  rules: Rules,
  now: number,
  mode: CorrectionMode,
): CorrectionReport {
  if (mode === "apply") {
    return correctAll(db, shares, rules, now);
  }
  try {
    db.transaction(() => {
      throw new DryRunRollback(correctAll(db, shares, rules, now));
    }).immediate();
  } catch (error) {
    if (error instanceof DryRunRollback) {
      return error.report;
    }
    throw error;
  }
  throw new Error("A dry run must end by rolling back");
}

function correctAll(db: Database, shares: ReadonlyMap<string, Activity>, rules: Rules, now: number): CorrectionReport {
  const report: CorrectionReport = {
    players_checked: 0,
    players_corrected: 0,
    raid_entries_checked: 0,
    raid_entries_reversed: 0,
    raid_entries_kept: 0,
    raid_entries_without_feed_row: 0,
    raid_leaf_without_feed_row: 0,
    raid_leaf_reversed: 0,
    raid_xp_reversed: 0,
    share_entries_earned: 0,
    share_leaf_earned: 0,
    share_xp_earned: 0,
    level_entries_reversed: 0,
    level_leaf_reversed: 0,
    net_leaf_change: 0,
    net_xp_change: 0,
    players_whose_level_drops: 0,
    largest_level_drop: 0,
    players_below_zero: 0,
    top_players_by_leaf_taken_back: [],
  };
  const corrected: PlayerCorrection[] = [];
  const players = db
    .query<{ player_id: string }, []>(
      "SELECT DISTINCT player_id FROM ledger_entries WHERE kind = 'earn' AND origin = 'raid' ORDER BY player_id",
    )
    .all();
  for (const row of players) {
    const playerId = parsePlayerId(row.player_id);
    if (playerId === undefined) {
      continue;
    }
    report.players_checked += 1;
    // A player is corrected entirely or not at all. Inside a dry run's transaction this is a savepoint.
    const correction = db.transaction(() => correctPlayer(db, playerId, shares, rules, now, report)).immediate();
    if (correction !== undefined) {
      corrected.push(correction);
    }
  }
  for (const player of corrected) {
    report.players_corrected += 1;
    report.net_leaf_change -= player.leaf_taken_back;
    report.net_xp_change -= player.xp_taken_back;
    const drop = player.level_before - player.level_after;
    if (drop > 0) {
      report.players_whose_level_drops += 1;
      report.largest_level_drop = Math.max(report.largest_level_drop, drop);
    }
  }
  report.players_below_zero = corrected.filter((player) => getAccount(db, player.player_id).balance < 0).length;
  report.top_players_by_leaf_taken_back = corrected
    .toSorted((a, b) => b.leaf_taken_back - a.leaf_taken_back || a.player_id.localeCompare(b.player_id))
    .slice(0, TOP_PLAYERS);
  return report;
}

/** Corrects one player's raid payments, then their levels. Returns undefined when nothing needed correcting. */
function correctPlayer(
  db: Database,
  playerId: PlayerId,
  shares: ReadonlyMap<string, Activity>,
  rules: Rules,
  now: number,
  report: CorrectionReport,
): PlayerCorrection | undefined {
  const before = getAccount(db, playerId);
  let reversed = 0;
  for (const { entry, reversed: undone } of listEarns(db, playerId, "raid")) {
    const key = entry.idempotencyKey;
    if (undone || entry.createdAt > now || !RAID_PAYMENT_KEY.test(key)) {
      continue;
    }
    report.raid_entries_checked += 1;
    const share = shares.get(key);
    if (share === undefined) {
      report.raid_entries_without_feed_row += 1;
      report.raid_leaf_without_feed_row += entry.balanceDelta;
      continue;
    }
    const decision = correctRaidPayment(entry.balanceDelta, share, rules.earning);
    if (decision.action === "keep") {
      report.raid_entries_kept += 1;
      continue;
    }
    insertEntry(
      db,
      draftEntry({ kind: "reversal", playerId, reverses: entry, idempotencyKey: `undo:${key}`, memo: MEMO }),
      now,
    );
    reversed += 1;
    report.raid_entries_reversed += 1;
    report.raid_leaf_reversed += entry.balanceDelta;
    report.raid_xp_reversed += entry.xpDelta;
    if (decision.shareLeaf > 0) {
      const earned = insertEntry(
        db,
        draftEntry({
          kind: "earn",
          playerId,
          amount: leaf(decision.shareLeaf),
          source: "raid",
          idempotencyKey: `${key}:share`,
          memo: MEMO,
        }),
        now,
      );
      report.share_entries_earned += 1;
      report.share_leaf_earned += earned.balanceDelta;
      report.share_xp_earned += earned.xpDelta;
    }
  }
  if (reversed === 0) {
    return undefined;
  }
  for (const payout of takeBackLevels(db, playerId, rules.levels, now, MEMO)) {
    report.level_entries_reversed += 1;
    report.level_leaf_reversed += payout.balanceDelta;
  }
  const after = getAccount(db, playerId);
  return {
    player_id: playerId,
    leaf_taken_back: before.balance - after.balance,
    xp_taken_back: before.xp - after.xp,
    level_before: levelForXp(before.xp, rules.levels).level,
    level_after: levelForXp(after.xp, rules.levels).level,
  };
}
