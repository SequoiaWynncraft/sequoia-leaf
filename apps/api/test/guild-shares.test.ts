import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";

import { DAY_MS, DEFAULT_RULES, leaf, type PlayerId, playerId, type Rules } from "@sequoia-leaf/core";

import { fetchCredits } from "../src/backend/credits.ts";
import { runGuildShareCorrection } from "../src/earning/guild-shares.ts";
import { syncCredits } from "../src/earning/sync.ts";
import { getAccount, listEntries, postEntry } from "../src/ledger/store.ts";
import type { Fetcher, Services } from "../src/services.ts";
import { testServices } from "./support.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
/** From another guild: in Sequoia's raids, never in Sequoia. */
const ally = playerId("00000000-0000-4000-8000-0000000000a1");

const MINUTE = 60_000;
/** Thursday 19 November 2026, 12:00 UTC: the credit sync's first run. */
const T0 = Date.UTC(2026, 10, 19, 12);
const LATER = T0 + DAY_MS;

/** Raids and levels are all that pay: level 2 takes 1,000 XP and pays 100 Leaf. */
const noQuests: Rules = { ...DEFAULT_RULES, quests: { ...DEFAULT_RULES.quests, templates: [] } };

interface RaidRow {
  completion_id: number;
  completed_at: string;
  raid_name: string;
  season_rating: number;
  player_uuid: string;
}

/** One credit per listed player, each with their share, as the backend lists a raid. */
function raid(id: number, shares: readonly [PlayerId, number][]): RaidRow[] {
  return shares.map(([player, seasonRating]) => ({
    completion_id: id,
    completed_at: new Date(T0 + id * MINUTE).toISOString(),
    raid_name: "The Nameless Anomaly",
    season_rating: seasonRating,
    player_uuid: player,
  }));
}

let clock: { now: number };
let services: Services;
let db: Database;
let raids: RaidRow[];

const backend: Fetcher = async (url) => {
  const query = new URL(url).searchParams;
  const [from, to] = [Date.parse(query.get("from") ?? ""), Date.parse(query.get("to") ?? "")];
  const inWindow = raids.filter((row) => Date.parse(row.completed_at) >= from && Date.parse(row.completed_at) < to);
  return Response.json({ raids: inWindow, wars: [] });
};

beforeEach(() => {
  clock = { now: T0 };
  services = testServices(clock, backend);
  db = services.db;
  raids = [];
});

/** The credit feed as the sync reads it, from the stand-in backend. */
function feed(from: number, to: number) {
  return fetchCredits(backend, { baseUrl: "https://backend.test", token: "internal-token" }, from, to);
}

/** Pays the raids as the feed listed them before sequoia-backend#536: the rating split among allies too. */
async function paidDiluted(listed: RaidRow[]): Promise<void> {
  await syncCredits(db, feed, noQuests, T0, "recent");
  raids = listed;
  clock.now = T0 + 30 * MINUTE;
  await syncCredits(db, feed, noQuests, clock.now, "recent");
}

function correct(mode: "dry_run" | "apply", fixed: RaidRow[], at = LATER) {
  raids = fixed;
  clock.now = at;
  return runGuildShareCorrection(services, { mode, neverMembers: new Set([ally]) });
}

function keys(player: PlayerId): [string, number, number][] {
  return listEntries(db, player, { limit: 100 })
    .toReversed()
    .map((entry) => [entry.idempotencyKey, entry.balanceDelta, entry.xpDelta]);
}

function everything(): unknown[] {
  return [db.query("SELECT * FROM ledger_entries ORDER BY id").all(), db.query("SELECT * FROM accounts").all()];
}

describe("runGuildShareCorrection", () => {
  it("pays each member the rest of their share and takes back what a player never in the guild was paid", async () => {
    // Alice and Bob raided with an ally; the feed split their 220 three ways.
    await paidDiluted(
      raid(1, [
        [alice, 73],
        [bob, 73],
        [ally, 73],
      ]),
    );
    const events = db.query("SELECT * FROM events").all();

    const report = await correct(
      "apply",
      raid(1, [
        [alice, 110],
        [bob, 110],
      ]),
    );

    expect(keys(alice)).toEqual([
      [`raid:1:${alice}`, 73, 73],
      [`raid:1:${alice}:guild-share`, 37, 37],
    ]);
    expect(getAccount(db, bob)).toMatchObject({ balance: 110, xp: 110 });
    expect(keys(ally)).toEqual([
      [`raid:1:${ally}`, 73, 73],
      [`undo:raid:1:${ally}`, -73, -73],
    ]);
    expect(getAccount(db, ally)).toMatchObject({ balance: 0, xp: 0 });
    expect(db.query("SELECT * FROM events").all()).toEqual(events);
    expect(report).toMatchObject({
      mode: "apply",
      feed_raid_credits: 2,
      players_checked: 3,
      members_topped_up: 2,
      raid_shares_topped_up: 2,
      leaf_topped_up: 74,
      xp_topped_up: 74,
      never_members_corrected: 1,
      never_member_entries_reversed: 1,
      never_member_leaf_taken_back: 73,
      net_leaf_change: 74 - 73,
      net_xp_change: 74 - 73,
    });
  });

  it("takes back the levels and quests a player never in the guild was paid, not just the raids", async () => {
    const many = Array.from({ length: 11 }, (_, index) =>
      raid(index + 1, [
        [alice, 50],
        [ally, 100],
      ]),
    ).flat();
    await paidDiluted(many);
    postEntry(db, { kind: "earn", playerId: ally, amount: leaf(200), source: "quest", idempotencyKey: "quest:x" }, T0);
    expect(getAccount(db, ally).balance).toBe(1100 + 100 + 200);

    const report = await correct("dry_run", many);
    expect(report).toMatchObject({ never_member_entries_reversed: 13, never_member_leaf_taken_back: 1400 });

    await correct("apply", many);
    expect(getAccount(db, ally)).toMatchObject({ balance: 0, xp: 0 });
  });

  it("pays the levels a member's topped-up XP reaches", async () => {
    const diluted = Array.from({ length: 9 }, (_, index) =>
      raid(index + 1, [
        [alice, 100],
        [ally, 100],
      ]),
    ).flat();
    await paidDiluted(diluted);
    expect(getAccount(db, alice)).toMatchObject({ balance: 900, xp: 900 });

    const fixed = Array.from({ length: 9 }, (_, index) => raid(index + 1, [[alice, 120]])).flat();
    const report = await correct("apply", fixed);

    // 9 x 20 more XP takes Alice past level 2's 1,000, which pays 100.
    expect(getAccount(db, alice)).toMatchObject({ xp: 1080, balance: 1080 + 100 });
    expect(report).toMatchObject({
      raid_shares_topped_up: 9,
      leaf_topped_up: 180,
      levels_paid: 1,
      level_leaf_paid: 100,
    });
  });

  it("counts only what still stands, so a raid the first correction reversed and paid a share for gets the rest", async () => {
    // The feed once gave Alice the party's 440; the first correction took it back and paid the diluted 73.
    await paidDiluted(raid(1, [[alice, 440]]));
    const [payment] = listEntries(db, alice, { limit: 1 });
    if (payment === undefined) throw new Error("no payment");
    postEntry(db, { kind: "reversal", playerId: alice, reverses: payment, idempotencyKey: `undo:raid:1:${alice}` }, T0);
    postEntry(
      db,
      { kind: "earn", playerId: alice, amount: leaf(73), source: "raid", idempotencyKey: `raid:1:${alice}:share` },
      T0,
    );

    await correct("apply", raid(1, [[alice, 110]]));

    expect(getAccount(db, alice)).toMatchObject({ balance: 110, xp: 110 });
    expect(keys(alice).at(-1)).toEqual([`raid:1:${alice}:guild-share`, 37, 37]);
  });

  it("leaves a payment above the share, or one the feed no longer lists, and says so", async () => {
    await paidDiluted([...raid(1, [[alice, 110]]), ...raid(2, [[alice, 80]])]);

    const report = await correct("apply", raid(1, [[alice, 90]]));

    expect(getAccount(db, alice)).toMatchObject({ balance: 190 });
    expect(report).toMatchObject({
      raid_payments_above_share: 1,
      raid_payments_without_feed_row: 1,
      raid_shares_topped_up: 0,
    });
  });

  it("changes nothing when it runs again, and keeps nothing in a dry run", async () => {
    await paidDiluted(
      raid(1, [
        [alice, 73],
        [bob, 73],
        [ally, 73],
      ]),
    );
    const fixed = raid(1, [
      [alice, 110],
      [bob, 110],
    ]);
    const before = everything();

    await correct("dry_run", fixed);
    expect(everything()).toEqual(before);

    await correct("apply", fixed);
    const applied = everything();
    const again = await correct("apply", fixed, LATER + MINUTE);
    expect(everything()).toEqual(applied);
    expect(again).toMatchObject({ raid_shares_topped_up: 0, never_member_entries_reversed: 0, net_leaf_change: 0 });
  });
});
