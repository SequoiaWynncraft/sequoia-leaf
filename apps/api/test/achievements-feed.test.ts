import { describe, expect, it } from "bun:test";

import { playerId } from "@sequoia-leaf/core";

import { AwardFeedError, fetchAwards } from "../src/achievements/feed.ts";
import type { Fetcher } from "../src/services.ts";
import { rejection } from "./support.ts";

const config = { baseUrl: "http://sierra.test:8082", token: "secret-token" };
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

const diamondRow = {
  award_id: `${ALICE}:raid:TNA:5`,
  player_uuid: ALICE,
  achievement_key: "raid:TNA",
  milestone_id: "diamond",
  tier: "diamond",
  threshold: 1000,
  label: "Diamond",
  earned_at: "2026-11-02T00:01:30.250Z",
};

describe("fetchAwards", () => {
  it("asks Sierra for the window with the internal token", async () => {
    const { fetcher, calls } = answering({ awards: [] });

    await fetchAwards(fetcher, config, FROM, TO);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "http://sierra.test:8082/internal/v1/achievements/awards?from=2026-11-02T00%3A00%3A00.000Z&to=2026-11-02T00%3A05%3A00.000Z",
    );
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBe("Bearer secret-token");
  });

  it("turns each award into one the rules can price", async () => {
    const { fetcher } = answering({ awards: [diamondRow] });

    expect(await fetchAwards(fetcher, config, FROM, TO)).toEqual([
      {
        awardId: `${ALICE}:raid:TNA:5`,
        playerId: ALICE,
        ladder: "raid:TNA",
        milestoneId: "diamond",
        tier: "diamond",
        threshold: 1000,
        label: "Diamond",
        earnedAt: Date.parse("2026-11-02T00:01:30.250Z"),
      },
    ]);
  });

  it("keeps an award that has no milestone, tier, threshold or label, such as a badge", async () => {
    const badge = {
      ...diamondRow,
      achievement_key: "badge:tcc",
      milestone_id: null,
      tier: null,
      threshold: null,
      label: null,
    };
    const { fetcher } = answering({ awards: [badge] });

    const [award] = await fetchAwards(fetcher, config, FROM, TO);

    expect([award?.milestoneId, award?.tier, award?.threshold, award?.label]).toEqual([null, null, null, null]);
  });

  it("fails when Sierra refuses the request", async () => {
    const { fetcher } = answering({ code: "unauthorized" }, 401);

    expect(await rejection(fetchAwards(fetcher, config, FROM, TO))).toEqual(
      new AwardFeedError("Sierra answered the awards feed with HTTP 401"),
    );
  });

  it("fails the whole read when one award is malformed, so nothing is partly paid", async () => {
    const malformed = [
      { ...diamondRow, player_uuid: "not-a-uuid" },
      { ...diamondRow, earned_at: "yesterday" },
      { ...diamondRow, threshold: 2.5 },
      { ...diamondRow, award_id: "" },
    ];

    const failures = await Promise.all(
      malformed.map((bad) =>
        rejection(fetchAwards(answering({ awards: [diamondRow, bad] }).fetcher, config, FROM, TO)),
      ),
    );

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(AwardFeedError);
    }
  });

  it("fails when the answer has no awards list", async () => {
    const { fetcher } = answering({ raids: [] });

    expect(await rejection(fetchAwards(fetcher, config, FROM, TO))).toEqual(
      new AwardFeedError("The awards feed has no awards list"),
    );
  });
});
