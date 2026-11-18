import { describe, expect, it } from "bun:test";

import { playerId } from "@sequoia-leaf/core";

import { CreditFeedError, fetchCredits } from "../src/backend/credits.ts";
import type { Fetcher } from "../src/services.ts";
import { rejection } from "./support.ts";

const config = { baseUrl: "https://backend.test", token: "secret-token" };
const FROM = Date.parse("2026-11-02T00:00:00.000Z");
const TO = Date.parse("2026-11-02T00:05:00.000Z");
const ALICE = playerId("10000000-0000-0000-0000-000000000001");

function answering(body: unknown, status = 200): { fetcher: Fetcher; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, init });
    return Response.json(body, { status });
  };
  return { fetcher, calls };
}

const raidRow = {
  completion_id: 4812,
  completed_at: "2026-11-02T00:01:30Z",
  raid_name: "The Nameless Anomaly",
  season_rating: 110,
  player_uuid: ALICE,
};
const warRow = {
  war_submission_id: 977,
  completed_at: "2026-11-02T00:03:10Z",
  territory: "Detlas",
  season_rating: 60,
  player_uuid: ALICE,
  war_points: 31.5,
  points_status: "scored",
};

describe("fetchCredits", () => {
  it("asks the backend for the window with the internal token", async () => {
    const { fetcher, calls } = answering({ raids: [], wars: [] });

    await fetchCredits(fetcher, config, FROM, TO);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://backend.test/internal/player-credits?from=2026-11-02T00%3A00%3A00.000Z&to=2026-11-02T00%3A05%3A00.000Z",
    );
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBe("Bearer secret-token");
  });

  it("turns raid and war credits into activities with stable keys", async () => {
    const { fetcher } = answering({ raids: [raidRow], wars: [warRow] });

    const activities = await fetchCredits(fetcher, config, FROM, TO);

    expect(activities).toEqual([
      {
        kind: "raid",
        sourceKey: `raid:4812:${ALICE}`,
        playerId: ALICE,
        occurredAt: Date.parse("2026-11-02T00:01:30Z"),
        seasonRating: 110,
        raid: "tna",
        raidName: "The Nameless Anomaly",
      },
      {
        kind: "war",
        sourceKey: `war:977:${ALICE}`,
        playerId: ALICE,
        occurredAt: Date.parse("2026-11-02T00:03:10Z"),
        seasonRating: 60,
        territory: "Detlas",
        warPoints: 31.5,
      },
    ]);
  });

  it("keeps a raid it has no short name for", async () => {
    const { fetcher } = answering({ raids: [{ ...raidRow, raid_name: "A Raid Added Next Year" }], wars: [] });

    const [activity] = await fetchCredits(fetcher, config, FROM, TO);

    expect(activity).toMatchObject({ kind: "raid", raid: undefined, raidName: "A Raid Added Next Year" });
  });

  it("keeps whether a war was over Sequoia's claim when the backend says", async () => {
    const { fetcher } = answering({
      raids: [],
      wars: [
        { ...warRow, war_submission_id: 1, in_claim: true },
        { ...warRow, war_submission_id: 2, in_claim: false },
        { ...warRow, war_submission_id: 3, in_claim: null },
      ],
    });

    const activities = await fetchCredits(fetcher, config, FROM, TO);

    expect(activities.map((activity) => (activity.kind === "war" ? activity.inClaim : "raid"))).toEqual([
      true,
      false,
      undefined,
    ]);
    expect(activities[2]).not.toHaveProperty("inClaim");
  });

  it("leaves out a war whose points are not calculated yet", async () => {
    const pending = { ...warRow, war_points: null, points_status: "unavailable" };
    const { fetcher } = answering({ raids: [], wars: [pending] });

    expect(await fetchCredits(fetcher, config, FROM, TO)).toEqual([]);
  });

  it("fails when the backend refuses the request", async () => {
    const { fetcher } = answering({ error: "Missing or invalid API token" }, 401);

    expect(await rejection(fetchCredits(fetcher, config, FROM, TO))).toBeInstanceOf(CreditFeedError);
  });

  it.each([
    ["a body without lists", { entries: [] }],
    ["a raid without a player", { raids: [{ ...raidRow, player_uuid: "Notch" }], wars: [] }],
    ["a raid with a fractional rating", { raids: [{ ...raidRow, season_rating: 1.5 }], wars: [] }],
    ["a war with text for points", { raids: [], wars: [{ ...warRow, war_points: "many" }] }],
    ["a war without a points field", { raids: [], wars: [{ ...warRow, war_points: undefined }] }],
    ["a war with text for in_claim", { raids: [], wars: [{ ...warRow, in_claim: "yes" }] }],
    ["an unscored war without a territory", { raids: [], wars: [{ ...warRow, war_points: null, territory: "" }] }],
    ["a raid without a timestamp", { raids: [{ ...raidRow, completed_at: "yesterday" }], wars: [] }],
  ])("fails on %s instead of paying part of the feed", async (_name, body) => {
    const { fetcher } = answering(body);

    expect(await rejection(fetchCredits(fetcher, config, FROM, TO))).toBeInstanceOf(CreditFeedError);
  });
});
