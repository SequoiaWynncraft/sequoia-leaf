import { describe, expect, test } from "bun:test";

import { RAID } from "./game.ts";
import { newAlmanac } from "./outside.ts";
import { choose, startRun } from "./run.ts";

describe("the table's postcard for the town", () => {
  const ctx = {
    now: 1_800_000_000_000,
    player: { id: "p", guest: false },
    seed: 5,
    room: 0,
    awards: [],
    postcards: {},
  };

  test("a new member's table is set out, with no till", () => {
    expect(RAID.postcard?.(RAID.create(ctx))).toEqual({
      waiting: "The board is set out. One crab is uncounted.",
      till: 0,
    });
  });

  test("a raid under way says where it got to, and a table raided before says so once it is over", () => {
    const run = startRun(5);
    choose(run, 0);
    run.room = 4;
    const table = { ...RAID.create(ctx), run, almanac: { ...newAlmanac(), runs: 3 } };
    expect(RAID.postcard?.(table)).toEqual({ waiting: "A raid is under way: room 5, on The Easy Way.", till: 0 });
    expect(RAID.postcard?.({ ...table, run: null }).waiting).toBe("The board is set out for another raid.");
  });
});
