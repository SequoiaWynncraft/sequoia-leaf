import { describe, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";

import { legal, type RaidCommand } from "./command.ts";
import type { ItemId } from "./content/items.ts";
import { LEGACY_ERA } from "./content/releases.ts";
import { predict, RAID, readCommand, refusalText, type Table, tableView } from "./game.ts";
import { forgeItems } from "./rack.ts";
import { beginFight, choose, giveItem, pieces, type Run, spotOf, startRun, summariseRun } from "./run.ts";
import { readNotes } from "./wire.ts";

/** A run in its first room, its starter on the board, with these items on the rack. */
function planning(items: ItemId[]): Run {
  const run = startRun(5, { era: LEGACY_ERA });
  choose(run, 0);
  run.items = items;
  return run;
}

const ctx = (seed: number): Ctx => ({
  now: 1_800_000_000_000,
  player: { id: "10000000-0000-0000-0000-000000000001", guest: false },
  seed,
  room: 1e9,
  awards: [],
  postcards: {},
});
/** Leaf's table with that run laid out. */
const tableOf = (run: Run): Table => ({ ...RAID.create(ctx(1)), runs: 1, run });

describe("two components on the rack", () => {
  test("become the finished item, in the first one's place, and the second's place closes up", () => {
    const run = planning(["bark", "thorn", "mosscharm", "plume", "chestnut"]);
    expect(forgeItems(run, 1, 3)).toEqual({ ok: true, notes: [{ t: "made", item: "wasptail", at: 1 }] });
    expect(run.items).toEqual(["bark", "wasptail", "mosscharm", "chestnut"]);
    // The first may be the later place: the item is where it was, one along now.
    expect(forgeItems(run, 3, 0)).toEqual({ ok: true, notes: [{ t: "made", item: "hollowlog", at: 2 }] });
    expect(run.items).toEqual(["wasptail", "mosscharm", "hollowlog"]);
  });

  test("two of the same component make their own item", () => {
    const run = planning(["thorn", "thorn"]);
    expect(forgeItems(run, 0, 1).ok).toBe(true);
    expect(run.items).toEqual(["blackthorn"]);
  });

  test("the item is remembered as forged, as one made on a figure is, and is handed over like any item", () => {
    const run = planning(["glowcap", "bark"]);
    forgeItems(run, 0, 1);
    expect(run.seen.forged).toEqual(["lichen"]);
    expect(summariseRun(run).forged).toEqual(["lichen"]);
    const figure = pieces(run)[0];
    const spot = figure ? spotOf(run, figure.id) : null;
    if (!figure || !spot) throw new Error("nobody to hand it to");
    expect(giveItem(run, 0, spot).ok).toBe(true);
    expect([figure.items, run.items]).toEqual([["lichen"], []]);
  });

  test("anything but two components is refused, and nothing changes", () => {
    const run = planning(["thorn", "mosscharm", "wasptail", "plume"]);
    const before = structuredClone(run);
    const refused: [number, number, string][] = [
      [0, 1, "two_components"], // with an emblem
      [1, 0, "two_components"],
      [0, 2, "two_components"], // with a finished item
      [2, 3, "two_components"],
      [0, 0, "two_components"], // with itself
      [0, 4, "no_such_item"], // a place that is empty
      [9, 0, "no_such_item"],
      [-1, 0, "no_such_item"],
      [0.5, 3, "no_such_item"],
    ];
    for (const [at, other, code] of refused) {
      expect([at, other, forgeItems(run, at, other)]).toMatchObject([at, other, { ok: false, code }]);
    }
    expect(run).toEqual(before);
    expect(refusalText("two_components")).toBe("It takes two components.");
  });

  test("outside planning it is refused: a pick waiting, a fight, a raid that is over", () => {
    const picking = startRun(5, { era: LEGACY_ERA });
    picking.items = ["thorn", "plume"];
    expect(forgeItems(picking, 0, 1)).toMatchObject({ ok: false, code: "pick_starter" });
    const fighting = planning(["thorn", "plume"]);
    beginFight(fighting);
    expect(forgeItems(fighting, 0, 1)).toMatchObject({ ok: false, code: "fighting" });
    const over = planning(["thorn", "plume"]);
    over.stage = { phase: "over", ending: "left" };
    expect(forgeItems(over, 0, 1)).toMatchObject({ ok: false, code: "raid_over" });
    for (const run of [picking, fighting, over]) expect(run.items).toEqual(["thorn", "plume"]);
  });
});

describe("forging as a command", () => {
  const forge: RaidCommand = { do: "forge", item: 2, with: 0 };

  test("is read off the wire with its two places, and nothing else is", () => {
    expect(readCommand({ do: "forge", item: 2, with: 0, id: "x" })).toEqual(forge);
    for (const bad of [
      { do: "forge" },
      { do: "forge", item: 0 },
      { do: "forge", item: 0, with: -1 },
      { do: "forge", item: 0.5, with: 1 },
      { do: "forge", item: "0", with: 1 },
      { do: "forged", item: 0, with: 1 },
    ]) {
      expect(readCommand(bad)).toBeNull();
    }
  });

  test("the page shows it before Leaf answers, exactly as Leaf does it", () => {
    const state = tableOf(planning(["thorn", "bark", "plume"]));
    const guessed = predict(RAID.view(state, ctx(2)), forge);
    const done = RAID.apply(state, forge, ctx(3));
    if ("refused" in done) throw new Error(`refused: ${done.refused}`);
    expect(done.state.run?.items).toEqual(["bark", "wasptail"]);
    expect(done.notes).toEqual([{ t: "made", item: "wasptail", at: 1 }]);
    expect(guessed).toEqual({ view: tableView(done.state, ctx(2)), notes: [...done.notes] });
    // Leaf's notes read back on the page as they were sent.
    expect(readNotes(structuredClone(done.notes))).toEqual([...done.notes]);
  });

  test("a refusal is the same on the page and on Leaf, and whether it would be done can be asked", () => {
    const state = tableOf(planning(["thorn", "mosscharm", "plume"]));
    const bad: RaidCommand = { do: "forge", item: 0, with: 1 };
    expect(predict(RAID.view(state, ctx(2)), bad)).toEqual({ refused: "two_components" });
    expect(RAID.apply(state, bad, ctx(3))).toEqual({ refused: "two_components" });
    const run = state.run;
    if (!run) throw new Error("no run");
    expect([legal(run, { do: "forge", item: 0, with: 1 }), legal(run, { do: "forge", item: 0, with: 2 })]).toEqual([
      false,
      true,
    ]);
    expect(run.items).toEqual(["thorn", "mosscharm", "plume"]);
  });
});
