import { describe, expect, it } from "bun:test";

import type { Activity } from "./activity.ts";
import { correctRaidPayment, levelsNoLongerReached } from "./corrections.ts";
import { playerId } from "./player.ts";
import { DEFAULT_RULES } from "./rules.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");

function share(seasonRating: number): Activity {
  return {
    kind: "raid",
    sourceKey: `raid:1:${alice}`,
    playerId: alice,
    occurredAt: 1_000,
    seasonRating,
    raid: "tna",
    raidName: "The Nameless Anomaly",
  };
}

describe("correctRaidPayment", () => {
  it("replaces a payment of the whole party's rating with the member's share", () => {
    expect(correctRaidPayment(440, share(110), DEFAULT_RULES.earning)).toEqual({ action: "replace", shareLeaf: 110 });
  });

  it("pays the share at the raid rate, rounded down", () => {
    const rates = { ...DEFAULT_RULES.earning, leafPerRaidSeasonRating: 1.5 };

    expect(correctRaidPayment(400, share(65), rates)).toEqual({ action: "replace", shareLeaf: 97 });
  });

  it("replaces a payment with nothing when the share pays nothing", () => {
    expect(correctRaidPayment(2, share(0), DEFAULT_RULES.earning)).toEqual({ action: "replace", shareLeaf: 0 });
  });

  it("keeps a payment that was the share or less", () => {
    expect(correctRaidPayment(110, share(110), DEFAULT_RULES.earning)).toEqual({ action: "keep" });
    expect(correctRaidPayment(80, share(110), DEFAULT_RULES.earning)).toEqual({ action: "keep" });
  });
});

describe("levelsNoLongerReached", () => {
  // Level 2 takes 1,000 XP, level 3 2,250 and level 4 3,750.
  const levels = DEFAULT_RULES.levels;

  it("lists the paid levels above the one the XP reaches, lowest first", () => {
    expect(levelsNoLongerReached(1_200, [4, 2, 3], levels)).toEqual([3, 4]);
  });

  it("lists nothing when the XP still reaches every paid level", () => {
    expect(levelsNoLongerReached(2_250, [2, 3], levels)).toEqual([]);
  });

  it("lists every paid level when the XP is back to level 1", () => {
    expect(levelsNoLongerReached(999, [2, 3], levels)).toEqual([2, 3]);
  });
});
