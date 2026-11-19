import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";

import { DAY_MS, DEFAULT_RULES, leaf, type PlayerId, playerId, type Rules } from "@sequoia-leaf/core";

import { fetchCredits } from "../src/backend/credits.ts";
import { type CorrectionRun, runRaidShareCorrection } from "../src/earning/raid-shares.ts";
import { syncCredits } from "../src/earning/sync.ts";
import { getAccount, listEntries, postEntry } from "../src/ledger/store.ts";
import { payMissedLevels } from "../src/levels/pay.ts";
import type { Fetcher, Services } from "../src/services.ts";
import { testServices } from "./support.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
const carol = playerId("00000000-0000-4000-8000-00000000000c");
const dave = playerId("00000000-0000-4000-8000-00000000000d");
const eve = playerId("00000000-0000-4000-8000-00000000000e");
const party = [alice, bob, carol, dave];

const MINUTE = 60_000;
/** Monday 16 November 2026, 12:00 UTC: the credit sync's first run. */
const T0 = Date.UTC(2026, 10, 16, 12);
/** When the correction runs. */
const LATER = T0 + DAY_MS;

/**
 * The sync pays with no quests, so raids and levels are all that pay. Level 2
 * takes 1,000 XP and pays 100 Leaf, level 3 1,250 more and 125.
 */
const noQuests: Rules = { ...DEFAULT_RULES, quests: { ...DEFAULT_RULES.quests, templates: [] } };

interface RaidRow {
  completion_id: number;
  completed_at: string;
  raid_name: string;
  season_rating: number;
  player_uuid: string;
}

/** One credit per member, each with the same season rating, as the backend lists a raid. */
function raid(id: number, at: number, members: readonly PlayerId[], seasonRating: number): RaidRow[] {
  return members.map((member) => ({
    completion_id: id,
    completed_at: new Date(at).toISOString(),
    raid_name: "The Nameless Anomaly",
    season_rating: seasonRating,
    player_uuid: member,
  }));
}

let clock: { now: number };
let services: Services;
let db: Database;
/** What the stand-in backend lists. */
let raids: RaidRow[];
/** The windows the backend was asked for. */
let requests: [number, number][];

/** Answers the credit feed from `raids`, and refuses a window longer than 31 days, as the backend does. */
const backend: Fetcher = async (url) => {
  const query = new URL(url).searchParams;
  const from = Date.parse(query.get("from") ?? "");
  const to = Date.parse(query.get("to") ?? "");
  requests.push([from, to]);
  if (to - from > 31 * DAY_MS) {
    return Response.json({ error: "the window must not exceed 31 days" }, { status: 400 });
  }
  const inWindow = raids.filter((row) => {
    const at = Date.parse(row.completed_at);
    return at >= from && at < to;
  });
  return Response.json({ raids: inWindow, wars: [] });
};

beforeEach(() => {
  clock = { now: T0 };
  services = testServices(clock, backend);
  db = services.db;
  raids = [];
  requests = [];
});

/** The credit feed as the sync reads it, from the stand-in backend. */
function creditFeed(from: number, to: number) {
  return fetchCredits(backend, { baseUrl: "https://backend.test", token: "internal-token" }, from, to);
}

/** Runs the credit sync at a moment, against what the backend lists then. */
async function syncAt(at: number): Promise<void> {
  clock.now = at;
  await syncCredits(db, creditFeed, noQuests, at, "recent");
}

/** Pays the raids as the feed listed them before 2026-11-19: every member the whole party's rating. */
async function paidInFull(listed: RaidRow[]): Promise<void> {
  await syncAt(T0);
  raids = listed;
  await syncAt(T0 + 10 * MINUTE);
}

async function correct(mode: "dry_run" | "apply", listed: RaidRow[], at = LATER): Promise<CorrectionRun> {
  raids = listed;
  clock.now = at;
  return runRaidShareCorrection(services, mode);
}

function entries(player: PlayerId): [string, string, number, number][] {
  return listEntries(db, player, { limit: 100 })
    .toReversed()
    .map((entry) => [entry.kind, entry.idempotencyKey, entry.balanceDelta, entry.xpDelta]);
}

/** Everything the correction could write to: the ledger, the accounts and the events. */
function everything(): unknown[] {
  return [
    db.query("SELECT * FROM ledger_entries ORDER BY id").all(),
    db.query("SELECT * FROM accounts ORDER BY player_id").all(),
    db.query("SELECT * FROM events ORDER BY id").all(),
  ];
}

/** Each account equals the sum of its entries, which the accounts trigger keeps. */
function expectAccountsMatchLedger(): void {
  const rows = db
    .query<{ balance: number; xp: number; entries_balance: number; entries_xp: number }, []>(
      `SELECT accounts.balance, accounts.xp,
         SUM(ledger_entries.balance_delta) AS entries_balance, SUM(ledger_entries.xp_delta) AS entries_xp
       FROM accounts JOIN ledger_entries USING (player_id)
       GROUP BY accounts.player_id`,
    )
    .all();
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect([row.balance, row.xp]).toEqual([row.entries_balance, row.entries_xp]);
  }
}

describe("runRaidShareCorrection", () => {
  it("replaces each member's payment of a four-member raid's total with their share, and leaves a solo raid alone", async () => {
    await paidInFull([...raid(1, T0 + MINUTE, party, 440), ...raid(2, T0 + 2 * MINUTE, [eve], 110)]);
    const events = db.query("SELECT * FROM events").all();

    const report = await correct("apply", [
      ...raid(1, T0 + MINUTE, party, 110),
      ...raid(2, T0 + 2 * MINUTE, [eve], 110),
    ]);

    for (const member of party) {
      expect(getAccount(db, member)).toMatchObject({ balance: 110, xp: 110 });
    }
    expect(entries(alice)).toEqual([
      ["earn", `raid:1:${alice}`, 440, 440],
      ["reversal", `undo:raid:1:${alice}`, -440, -440],
      ["earn", `raid:1:${alice}:share`, 110, 110],
    ]);
    expect(entries(eve)).toEqual([["earn", `raid:2:${eve}`, 110, 110]]);
    expect(getAccount(db, eve)).toMatchObject({ balance: 110, xp: 110 });
    expectAccountsMatchLedger();
    expect(db.query("SELECT * FROM events").all()).toEqual(events);
    expect(report).toMatchObject({
      mode: "apply",
      feed_from: new Date(T0).toISOString(),
      feed_to: new Date(LATER).toISOString(),
      feed_windows: 1,
      feed_raid_credits: 5,
      players_checked: 5,
      players_corrected: 4,
      raid_entries_checked: 5,
      raid_entries_reversed: 4,
      raid_entries_kept: 1,
      raid_entries_without_feed_row: 0,
      raid_leaf_reversed: 1760,
      raid_xp_reversed: 1760,
      share_entries_earned: 4,
      share_leaf_earned: 440,
      share_xp_earned: 440,
      level_entries_reversed: 0,
      net_leaf_change: -1320,
      net_xp_change: -1320,
      players_whose_level_drops: 0,
      players_below_zero: 0,
    });
    expect(report.top_players_by_leaf_taken_back.map((player) => [player.player_id, player.leaf_taken_back])).toEqual(
      party.map((member) => [member, 330]),
    );
  });

  it("changes nothing when it runs again", async () => {
    await paidInFull([...raid(1, T0 + MINUTE, party, 440), ...raid(2, T0 + 2 * MINUTE, [eve], 110)]);
    const corrected = [...raid(1, T0 + MINUTE, party, 110), ...raid(2, T0 + 2 * MINUTE, [eve], 110)];
    await correct("apply", corrected);
    const after = everything();

    const again = await correct("apply", corrected, LATER + MINUTE);

    expect(everything()).toEqual(after);
    expect(again).toMatchObject({
      players_corrected: 0,
      raid_entries_checked: 1,
      raid_entries_reversed: 0,
      raid_entries_kept: 1,
      share_entries_earned: 0,
      level_entries_reversed: 0,
      net_leaf_change: 0,
      net_xp_change: 0,
      top_players_by_leaf_taken_back: [],
    });
  });

  it("takes back the Leaf for the levels the corrected XP no longer reaches, and pays a level reached again once", async () => {
    const overpaid = [1, 2, 3, 4, 5, 6].flatMap((id) => raid(id, T0 + id * MINUTE, party, 440));
    await paidInFull(overpaid);
    expect(getAccount(db, alice)).toMatchObject({ balance: 2640 + 225, xp: 2640 });

    const shares = [1, 2, 3, 4, 5, 6].flatMap((id) => raid(id, T0 + id * MINUTE, party, 110));
    const report = await correct("apply", shares);

    expect(getAccount(db, alice)).toMatchObject({ balance: 660, xp: 660 });
    expect(entries(alice).filter(([, key]) => key.startsWith("level:") || key.startsWith("undo:level:"))).toEqual([
      ["earn", `level:${alice}:2`, 100, 0],
      ["earn", `level:${alice}:3`, 125, 0],
      ["reversal", `undo:level:${alice}:2`, -100, 0],
      ["reversal", `undo:level:${alice}:3`, -125, 0],
    ]);
    expect(report).toMatchObject({
      level_entries_reversed: 8,
      level_leaf_reversed: 900,
      net_leaf_change: -4 * (1980 + 225),
      players_whose_level_drops: 4,
      largest_level_drop: 2,
    });
    expect(report.top_players_by_leaf_taken_back[0]).toEqual({
      player_id: alice,
      leaf_taken_back: 1980 + 225,
      xp_taken_back: 1980,
      level_before: 3,
      level_after: 1,
    });
    expectAccountsMatchLedger();

    // Four more raids, paid as shares, bring Alice back to level 2.
    raids = [...shares, ...[7, 8, 9, 10].flatMap((id) => raid(id, LATER + id * MINUTE, [alice], 110))];
    await syncAt(LATER + 20 * MINUTE);
    await syncAt(LATER + 21 * MINUTE);
    payMissedLevels(db, DEFAULT_RULES.levels, LATER + 22 * MINUTE);

    expect(getAccount(db, alice)).toMatchObject({ balance: 1100 + 100, xp: 1100 });
    expect(
      entries(alice)
        .filter(([, key]) => key.startsWith("level:"))
        .map(([, key]) => key),
    ).toEqual([`level:${alice}:2`, `level:${alice}:3`, `level:${alice}:2:2`]);
    expectAccountsMatchLedger();
  });

  it("leaves a payment the corrected feed no longer lists, and reports it", async () => {
    await paidInFull(raid(3, T0 + MINUTE, [alice, bob], 220));

    // Bob's name no longer resolves, so the feed leaves his credit out.
    const report = await correct("apply", raid(3, T0 + MINUTE, [alice], 110));

    expect(getAccount(db, alice)).toMatchObject({ balance: 110, xp: 110 });
    expect(entries(bob)).toEqual([["earn", `raid:3:${bob}`, 220, 220]]);
    expect(report).toMatchObject({
      raid_entries_checked: 2,
      raid_entries_reversed: 1,
      raid_entries_without_feed_row: 1,
      raid_leaf_without_feed_row: 220,
    });
  });

  it("writes nothing in a dry run, and reports what applying it would do", async () => {
    const ids = [1, 2, 3, 4, 5, 6];
    const solo = raid(7, T0 + 7 * MINUTE, [eve], 110);
    await paidInFull([...ids.flatMap((id) => raid(id, T0 + id * MINUTE, party, 440)), ...solo]);
    const shares = [...ids.flatMap((id) => raid(id, T0 + id * MINUTE, party, 110)), ...solo];
    const before = everything();

    const dryRun = await correct("dry_run", shares);

    expect(everything()).toEqual(before);
    expect(db.inTransaction).toBe(false);
    const applied = await correct("apply", shares);
    expect({ ...dryRun, mode: "apply" }).toEqual(applied);
    expect(dryRun.raid_entries_reversed).toBe(24);
  });

  it("reads the feed from the credit sync's first run to now in windows of at most 31 days", async () => {
    const start = LATER - 70 * DAY_MS;
    db.query("UPDATE sync_state SET started_at = ?, cursor = ? WHERE name = 'credits'").run(start, LATER);
    // Paid the way the sync pays, early in the first window and late in the last.
    for (const [id, member, at] of [
      [1, alice, start + DAY_MS],
      [2, bob, LATER - DAY_MS],
    ] as const) {
      postEntry(
        db,
        { kind: "earn", playerId: member, amount: leaf(440), source: "raid", idempotencyKey: `raid:${id}:${member}` },
        at + 10 * MINUTE,
      );
    }

    const report = await correct("apply", [
      ...raid(1, start + DAY_MS, [alice], 110),
      ...raid(2, LATER - DAY_MS, [bob], 110),
    ]);

    expect(requests).toEqual([
      [start, start + 31 * DAY_MS],
      [start + 31 * DAY_MS, start + 62 * DAY_MS],
      [start + 62 * DAY_MS, LATER],
    ]);
    expect(report).toMatchObject({ feed_windows: 3, raid_entries_reversed: 2 });
    expect(getAccount(db, alice).balance).toBe(110);
    expect(getAccount(db, bob).balance).toBe(110);
  });
});
