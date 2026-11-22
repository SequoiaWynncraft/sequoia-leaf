import { describe, expect, it } from "bun:test";

import {
  checkPageCoins,
  COIN_REASON_NAMES,
  COIN_REASONS,
  DAILY_CHEST,
  dailyChestKey,
  PAGE_COINS,
  pageCoinsKey,
} from "./coins.ts";

/** A call to spend this amount at a market stall. */
const amount = (n: number, reason = "camp_thing") => checkPageCoins({ id: "a-1", amount: n, reason });

describe("a page's call to change Coins", () => {
  it("names one of the reasons, every one the town's: the Works' Coins are Leaf's own", () => {
    expect(COIN_REASON_NAMES).toEqual(["camp_thing", "daily_chest"]);
    for (const name of COIN_REASON_NAMES) expect(COIN_REASONS[name].game).toBe("town");
    for (const reason of ["works_order", "works_depot", "works_build", "works_refund", "works_plot", "works_plan"]) {
      expect(checkPageCoins({ id: "a-1", amount: -3, reason })).toEqual({ ok: false, code: "invalid_reason" });
    }
    // Nothing on the guild's server pays these: the made-up guild's quests and while-away letter.
    for (const reason of ["quest", "while_away"]) {
      expect(checkPageCoins({ id: "a-1", amount: 3, reason })).toEqual({ ok: false, code: "invalid_reason" });
    }
    expect(checkPageCoins({ id: "a-1", amount: 3, reason: "the chest" })).toEqual({
      ok: false,
      code: "invalid_reason",
    });
  });

  it("is a whole number, not 0, down to -100,000, going the reason's way", () => {
    expect(amount(-5)).toMatchObject({ ok: true, amount: -5 });
    expect(amount(PAGE_COINS.least)).toMatchObject({ ok: true });
    for (const n of [0, -1.5, PAGE_COINS.least - 1, Number.NaN, -Infinity]) {
      expect(amount(n)).toEqual({ ok: false, code: "invalid_amount" });
    }
    // A spend paid as an earning.
    expect(amount(5)).toEqual({ ok: false, code: "invalid_amount" });
  });

  it("for the daily chest takes no amount from the page: Leaf pays its own, keyed by the UTC day", () => {
    for (const n of [3, 5000, -5, 0, 1.5]) {
      expect(checkPageCoins({ id: "a-1", amount: n, reason: "daily_chest" })).toEqual({
        ok: true,
        id: "a-1",
        amount: DAILY_CHEST,
        reason: "daily_chest",
      });
    }
    expect(dailyChestKey("p", 20_782)).toBe("page:p:daily_chest:20782");
  });

  it("has an id as a command has, and is keyed by it for the player", () => {
    for (const id of ["", "a b", "x".repeat(65), "é"]) {
      expect(checkPageCoins({ id, amount: 3, reason: "daily_chest" })).toEqual({ ok: false, code: "invalid_command" });
    }
    expect(pageCoinsKey("p", "chest-2026-11-22")).toBe("page:p:chest-2026-11-22");
  });
});
