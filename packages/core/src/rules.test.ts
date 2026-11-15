import { describe, expect, it } from "bun:test";

import { type Activity, raidKeyForName } from "./activity.ts";
import { playerId } from "./player.ts";
import { DEFAULT_RULES, leafForActivity } from "./rules.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const base = { sourceKey: "x", playerId: alice, occurredAt: 1_000 };

function raid(seasonRating: number): Activity {
  return { ...base, kind: "raid", raid: "tna", raidName: "The Nameless Anomaly", seasonRating };
}

function war(warPoints: number): Activity {
  return { ...base, kind: "war", territory: "Detlas", seasonRating: 60, warPoints };
}

describe("leafForActivity", () => {
  it("pays a raid its season rating in Leaf at the default rate", () => {
    expect(leafForActivity(raid(110), DEFAULT_RULES.earning)).toBe(110);
  });

  it("scales a raid by the configured rate and rounds down", () => {
    expect(leafForActivity(raid(110), { leafPerRaidSeasonRating: 1.5, leafPerWarPoint: 1 })).toBe(165);
    expect(leafForActivity(raid(3), { leafPerRaidSeasonRating: 0.5, leafPerWarPoint: 1 })).toBe(1);
  });

  it("pays a war its war points, rounded down", () => {
    expect(leafForActivity(war(31.9), DEFAULT_RULES.earning)).toBe(31);
  });

  it("pays nothing for a war scored at zero or below", () => {
    expect(leafForActivity(war(0), DEFAULT_RULES.earning)).toBe(0);
    expect(leafForActivity(war(-4.5), DEFAULT_RULES.earning)).toBe(0);
  });
});

describe("raidKeyForName", () => {
  it("finds the short name of a known raid", () => {
    expect(raidKeyForName("Orphion's Nexus of Light")).toBe("nol");
  });

  it("returns undefined for a raid it does not know", () => {
    expect(raidKeyForName("A Raid Added Next Year")).toBeUndefined();
  });
});
