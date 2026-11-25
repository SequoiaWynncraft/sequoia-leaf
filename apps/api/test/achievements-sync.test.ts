import { beforeEach, describe, expect, it } from "bun:test";

import {
  DEFAULT_RULES,
  minecraftId,
  type PlayerId,
  playerId,
  type ReportedAward,
  type Rules,
} from "@sequoia-leaf/core";
import { Effect } from "effect";

import { runAchievementSync } from "../src/achievements/run.ts";
import { type AwardSource, syncAchievements } from "../src/achievements/sync.ts";
import { Events } from "../src/events/store.ts";
import type { SyncMode } from "../src/sync/windowed.ts";
import { rejection, testLeaf } from "./support.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
/** The first sync runs at T0, so paying starts at T0. */
const T0 = 1_763_000_000_000;

let ledger: ReturnType<typeof testLeaf>;

beforeEach(() => {
  ledger = testLeaf({ now: T0 }, () => Promise.reject(new Error("No network in this test")));
});

function award(player: PlayerId, ladder: string, milestoneId: string | null, earnedAt: number): ReportedAward {
  return {
    awardId: `${player}:${ladder}:${milestoneId ?? "badge"}`,
    account: minecraftId(player),
    ladder,
    milestoneId,
    tier: milestoneId,
    threshold: 25,
    label: null,
    earnedAt,
  };
}

const unreachable: AwardSource<Error> = () => Effect.fail(new Error("Sierra is down"));

/** A feed that answers a window with the awards inside it. The list can grow, as Sierra's does. */
function feed(awards: ReportedAward[]): AwardSource {
  return (from, to) => Effect.succeed(awards.filter((one) => one.earnedAt >= from && one.earnedAt < to));
}

function sync(source: AwardSource<Error>, now: number, mode: SyncMode = "recent", rules: Rules = DEFAULT_RULES) {
  return ledger.run(syncAchievements(source, rules, now, mode));
}

async function events(player: PlayerId): Promise<{ type: string; data: unknown }[]> {
  const stored = await ledger.run(Events.use((store) => store.after(player, 0, 100)));
  return stored.map((event) => ({ type: event.type, data: JSON.parse(event.data) }));
}

describe("syncAchievements", () => {
  it("pays nothing for milestones reached before its first run", async () => {
    const source = feed([
      award(alice, "raid:TNA", "diamond", T0 - 60 * MINUTE),
      award(alice, "raid:NOL", "gold", T0 - 1),
      award(bob, "raid:TNA", "bronze", T0 + SECOND),
    ]);

    expect(await sync(source, T0)).toEqual({ status: "started" });
    expect(await sync(source, T0 + MINUTE)).toEqual({ status: "synced", recorded: 1, leafPaid: 1000 });
    expect(await sync(source, T0 + 2 * MINUTE, "deep")).toEqual({ status: "synced", recorded: 0, leafPaid: 0 });

    expect((await ledger.account(alice)).balance).toBe(0);
    expect((await ledger.account(bob)).balance).toBe(1000);
  });

  it("pays a guild milestone once however often its window is read, and says so", async () => {
    const diamond = { ...award(alice, "raid:TNA", "diamond", T0 + 10 * SECOND), threshold: 1000, label: "Diamond" };
    const source = feed([diamond]);

    await sync(source, T0);
    await sync(source, T0 + MINUTE);
    await sync(source, T0 + 2 * MINUTE);
    await sync(source, T0 + 3 * MINUTE, "deep");

    // A milestone's Leaf comes with no XP, so it gains no level.
    expect(await ledger.account(alice)).toMatchObject({ balance: 15_000, xp: 0 });
    const entries = await ledger.query(
      (sql) =>
        sql`
        SELECT origin, idempotency_key, balance_delta, xp_delta FROM ledger_entries
        WHERE player_id = ${alice} ORDER BY id DESC
      `.values,
    );
    expect(entries).toEqual([["achievement", `achievement:${diamond.awardId}`, 15_000, 0]]);
    expect(await events(alice)).toEqual([
      {
        type: "achievement_paid",
        data: {
          award_id: diamond.awardId,
          ladder: "raid:TNA",
          milestone: "diamond",
          tier: "diamond",
          threshold: 1000,
          label: "Diamond",
          leaf: 15_000,
          xp: 0,
          earned_at: new Date(T0 + 10 * SECOND).toISOString(),
        },
      },
    ]);
  });

  it("levels a player with a milestone's Leaf when the rules count it as XP", async () => {
    const rules: Rules = { ...DEFAULT_RULES, achievements: { ...DEFAULT_RULES.achievements, grantsXp: true } };
    const source = feed([award(alice, "raid:TNA", "gold", T0 + 10 * SECOND)]);

    await sync(source, T0, "recent", rules);
    await sync(source, T0 + MINUTE, "recent", rules);

    // 2,500 XP reaches level 3, and levels 2 and 3 pay 100 and 125 Leaf.
    expect(await ledger.account(alice)).toMatchObject({ balance: 2500 + 225, xp: 2500 });
    expect((await events(alice)).at(-1)).toEqual({ type: "level_up", data: { level: 3, leaf: 225 } });
  });

  it("pays the war ladder and the all-raids ladder, and nothing for professions, roles or badges", async () => {
    const source = feed([
      award(alice, "war:completed", "silver", T0 + SECOND),
      award(alice, "raid:all raids", "bronze", T0 + 2 * SECOND),
      award(alice, "profession:mining", "level-132", T0 + 3 * SECOND),
      award(alice, "role:insignia", "gold", T0 + 4 * SECOND),
      award(alice, "badge:tcc", null, T0 + 5 * SECOND),
    ]);

    await sync(source, T0);
    // A war Silver at 500 and an all-raids Bronze at 1,000.
    expect(await sync(source, T0 + MINUTE)).toEqual({ status: "synced", recorded: 2, leafPaid: 1500 });

    expect((await events(alice)).map((event) => event.type)).toEqual(["achievement_paid", "achievement_paid"]);
  });

  it("pays a milestone that Sierra reports late once the deep run reads its window again", async () => {
    const awards: ReportedAward[] = [];
    const source = feed(awards);
    await sync(source, T0);
    await sync(source, T0 + 60 * MINUTE);
    awards.push(award(alice, "raid:TCC", "silver", T0 + 5 * MINUTE));

    await sync(source, T0 + 61 * MINUTE);
    expect((await ledger.account(alice)).balance).toBe(0);
    await sync(source, T0 + 62 * MINUTE, "deep");
    expect((await ledger.account(alice)).balance).toBe(1500);
  });

  it("keeps its place when Sierra cannot be read, and pays on the next run", async () => {
    const source = feed([award(alice, "raid:TNA", "bronze", T0 + SECOND)]);
    await sync(source, T0);

    expect(await rejection(sync(unreachable, T0 + MINUTE))).toEqual(new Error("Sierra is down"));
    expect(await sync(source, T0 + 2 * MINUTE)).toEqual({ status: "synced", recorded: 1, leafPaid: 1000 });
  });

  it("lets one run through at a time", async () => {
    await sync(feed([]), T0);
    const answer = Promise.withResolvers<ReportedAward[]>();
    const slow: AwardSource = () => Effect.promise(() => answer.promise);

    const first = sync(slow, T0 + MINUTE);
    expect(await sync(feed([]), T0 + MINUTE)).toEqual({ status: "busy" });
    answer.resolve([]);
    expect(await first).toEqual({ status: "synced", recorded: 0, leafPaid: 0 });
  });

  it("does not read the feed until Sierra's address is configured", async () => {
    const calls: string[] = [];
    const clock = { now: T0 };
    const sierra = async (url: string) => {
      calls.push(url);
      return Response.json({ awards: [] });
    };

    expect(await testLeaf(clock, sierra, { sierraUrl: undefined }).run(runAchievementSync("recent"))).toBe(undefined);
    const leaf = testLeaf(clock, sierra);
    expect(await leaf.run(runAchievementSync("recent"))).toEqual({ status: "started" });
    clock.now += MINUTE;
    await leaf.run(runAchievementSync("recent"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toStartWith("https://sierra.test/internal/v1/achievements/awards?");
  });
});
