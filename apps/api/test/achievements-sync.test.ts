import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";

import { type AchievementAward, DEFAULT_RULES, type PlayerId, playerId } from "@sequoia-leaf/core";

import { runAchievementSync } from "../src/achievements/run.ts";
import { type AwardSource, syncAchievements } from "../src/achievements/sync.ts";
import { listEventsAfter } from "../src/events/store.ts";
import { getAccount, listEntries } from "../src/ledger/store.ts";
import type { SyncMode } from "../src/sync/windowed.ts";
import { rejection, testDatabase, testServices } from "./support.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
/** The first sync runs at T0, so paying starts at T0. */
const T0 = 1_763_000_000_000;

let db: Database;

beforeEach(() => {
  db = testDatabase();
});

function award(player: PlayerId, ladder: string, milestoneId: string | null, earnedAt: number): AchievementAward {
  return {
    awardId: `${player}:${ladder}:${milestoneId ?? "badge"}`,
    playerId: player,
    ladder,
    milestoneId,
    tier: milestoneId,
    count: 25,
    earnedAt,
  };
}

const unreachable: AwardSource = async () => {
  throw new Error("Sierra is down");
};

/** A feed that answers a window with the awards inside it. The list can grow, as Sierra's does. */
function feed(awards: AchievementAward[]): AwardSource {
  return async (from, to) => awards.filter((one) => one.earnedAt >= from && one.earnedAt < to);
}

function sync(source: AwardSource, now: number, mode: SyncMode = "recent") {
  return syncAchievements(db, source, DEFAULT_RULES, now, mode);
}

function events(player: PlayerId): { type: string; data: unknown }[] {
  return listEventsAfter(db, player, 0, 100).map((event) => ({ type: event.type, data: JSON.parse(event.data) }));
}

describe("syncAchievements", () => {
  it("pays nothing for milestones reached before its first run", async () => {
    const source = feed([
      award(alice, "raid:TNA", "diamond", T0 - 60 * MINUTE),
      award(alice, "raid:NOL", "gold", T0 - 1),
      award(bob, "raid:TNA", "bronze", T0 + SECOND),
    ]);

    expect(await sync(source, T0)).toEqual({ status: "started" });
    expect(await sync(source, T0 + MINUTE)).toEqual({ status: "synced", recorded: 1, leafPaid: 250 });
    expect(await sync(source, T0 + 2 * MINUTE, "deep")).toEqual({ status: "synced", recorded: 0, leafPaid: 0 });

    expect(getAccount(db, alice).balance).toBe(0);
    expect(getAccount(db, bob).balance).toBe(250);
  });

  it("pays a guild milestone once however often its window is read, and says so", async () => {
    const diamond = { ...award(alice, "raid:TNA", "diamond", T0 + 10 * SECOND), count: 1000 };
    const source = feed([diamond]);

    await sync(source, T0);
    await sync(source, T0 + MINUTE);
    await sync(source, T0 + 2 * MINUTE);
    await sync(source, T0 + 3 * MINUTE, "deep");

    expect(getAccount(db, alice)).toMatchObject({ balance: 5000, xp: 5000 });
    const entries = listEntries(db, alice, { limit: 10 });
    expect(entries.map((entry) => [entry.origin, entry.idempotencyKey, entry.balanceDelta])).toEqual([
      ["achievement", `achievement:${diamond.awardId}`, 5000],
    ]);
    expect(events(alice)).toEqual([
      {
        type: "achievement_paid",
        data: {
          award_id: diamond.awardId,
          ladder: "raid:TNA",
          milestone: "diamond",
          tier: "diamond",
          count: 1000,
          leaf: 5000,
          xp: 5000,
          earned_at: new Date(T0 + 10 * SECOND).toISOString(),
        },
      },
      { type: "level_up", data: { level: 4 } },
    ]);
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
    expect(await sync(source, T0 + MINUTE)).toEqual({ status: "synced", recorded: 2, leafPaid: 750 });

    expect(events(alice).map((event) => event.type)).toEqual(["achievement_paid", "achievement_paid"]);
  });

  it("pays a milestone that Sierra reports late once the deep run reads its window again", async () => {
    const awards: AchievementAward[] = [];
    const source = feed(awards);
    await sync(source, T0);
    await sync(source, T0 + 60 * MINUTE);
    awards.push(award(alice, "raid:TCC", "silver", T0 + 5 * MINUTE));

    await sync(source, T0 + 61 * MINUTE);
    expect(getAccount(db, alice).balance).toBe(0);
    await sync(source, T0 + 62 * MINUTE, "deep");
    expect(getAccount(db, alice).balance).toBe(500);
  });

  it("keeps its place when Sierra cannot be read, and pays on the next run", async () => {
    const source = feed([award(alice, "raid:TNA", "bronze", T0 + SECOND)]);
    await sync(source, T0);

    expect(await rejection(sync(unreachable, T0 + MINUTE))).toEqual(new Error("Sierra is down"));
    expect(await sync(source, T0 + 2 * MINUTE)).toEqual({ status: "synced", recorded: 1, leafPaid: 250 });
  });

  it("lets one run through at a time", async () => {
    await sync(feed([]), T0);
    const answer = Promise.withResolvers<AchievementAward[]>();
    const slow: AwardSource = () => answer.promise;

    const first = sync(slow, T0 + MINUTE);
    expect(await sync(feed([]), T0 + MINUTE)).toEqual({ status: "busy" });
    answer.resolve([]);
    expect(await first).toEqual({ status: "synced", recorded: 0, leafPaid: 0 });
  });

  it("does not read the feed until Sierra's address is configured", async () => {
    const calls: string[] = [];
    const clock = { now: T0 };
    const services = testServices(clock, async (url) => {
      calls.push(url);
      return Response.json({ awards: [] });
    });

    expect(await runAchievementSync({ ...services, sierra: { ...services.sierra, url: undefined } }, "recent")).toBe(
      undefined,
    );
    expect(await runAchievementSync(services, "recent")).toEqual({ status: "started" });
    clock.now += MINUTE;
    await runAchievementSync(services, "recent");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toStartWith("https://sierra.test/internal/v1/achievements/awards?");
  });
});
