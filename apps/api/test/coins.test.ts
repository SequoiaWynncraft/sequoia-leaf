import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { playerId } from "@sequoia-leaf/core";

import { HOUR, noNetwork, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);

let services: ReturnType<typeof testLeaf>;

beforeEach(() => {
  services = testLeaf({ now: T0 }, noNetwork);
});

afterEach(async () => {
  await services.dispose();
});

describe("the Coins ledger", () => {
  it("weighs the cap on a player's entries of the last day alone, by an index on the time", async () => {
    const plan = await services.query(
      (sql) => sql`
        EXPLAIN QUERY PLAN SELECT coalesce(sum(amount), 0) FROM coin_entries
        WHERE player_id = ${alice} AND at > ${T0 - HOUR} AND amount > 0
          AND game IS NOT NULL AND earned = 1
      `,
    );
    expect(plan.map((row) => String(Object(row).detail))).toEqual([
      "SEARCH coin_entries USING INDEX coin_entries_by_player_at (player_id=? AND at>?)",
    ]);
  });
});
