import { describe, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";

import { legal, type RaidCommand } from "./command.ts";
import type { ItemId } from "./content/items.ts";
import { LEGACY_ERA } from "./content/releases.ts";
import type { RackItem } from "./content/tools.ts";
import { predict, RAID, readCommand, refusalText, type Table, tableView } from "./game.ts";
import { forgeItems } from "./rack.ts";
import { rackOf } from "./racks.ts";
import { beginFight, choose, giveItem, pieces, type Run, spotOf, startRun, summariseRun } from "./run.ts";
import { readNotes } from "./wire.ts";

/** A run in its first room, its starter on the board, with these items on the rack. */
function planning(items: RackItem[]): Run {
  const run = startRun(5, { era: LEGACY_ERA });
  choose(run, 0);
  run.rack = rackOf(items);
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
const tableOf = (run: Run): Table => ({
  ...RAID.create(ctx(1)),
  begun: { main: 1, endless: 0 },
  held: { main: run, endless: null },
});

describe("two components on the rack", () => {
  test("become the finished item, which goes on the rack with them gone", () => {
    const run = planning(["bark", "thorn", "mosscharm", "plume", "chestnut"]);
    expect(forgeItems(run, "thorn", "plume")).toEqual({ ok: true, notes: [{ t: "made", item: "wasptail" }] });
    expect(run.rack).toEqual(rackOf(["bark", "wasptail", "mosscharm", "chestnut"]));
    // Either way round.
    expect(forgeItems(run, "chestnut", "bark")).toEqual({ ok: true, notes: [{ t: "made", item: "hollowlog" }] });
    expect(run.rack).toEqual(rackOf(["wasptail", "mosscharm", "hollowlog"]));
  });

  test("two of the same component make their own item, when there are two", () => {
    const run = planning(["thorn", "thorn", "thorn"]);
    expect(forgeItems(run, "thorn", "thorn").ok).toBe(true);
    expect(run.rack).toEqual({ thorn: 1, blackthorn: 1 });
    expect(forgeItems(run, "thorn", "thorn")).toMatchObject({ ok: false, code: "no_such_item" });
  });

  test("the item is remembered as forged, as one made on a figure is, and is handed over like any item", () => {
    const run = planning(["glowcap", "bark"]);
    forgeItems(run, "glowcap", "bark");
    expect(run.seen.forged).toEqual(["lichen"]);
    expect(summariseRun(run).forged).toEqual(["lichen"]);
    const figure = pieces(run)[0];
    const spot = figure ? spotOf(run, figure.id) : null;
    if (!figure || !spot) throw new Error("nobody to hand it to");
    expect(giveItem(run, "lichen", spot).ok).toBe(true);
    expect([figure.items, run.rack]).toEqual([["lichen"], {}]);
  });

  test("anything but two components is refused, and nothing changes", () => {
    const run = planning(["thorn", "mosscharm", "wasptail", "plume", "tongs"]);
    const before = structuredClone(run);
    const refused: [ItemId, ItemId, string][] = [
      ["thorn", "mosscharm", "two_components"], // with an emblem
      ["mosscharm", "thorn", "two_components"],
      ["thorn", "wasptail", "two_components"], // with a finished item
      ["wasptail", "plume", "two_components"],
      ["thorn", "thorn", "no_such_item"], // one of it, twice
      ["thorn", "bark", "no_such_item"], // a kind that is not there
      ["glowcap", "thorn", "no_such_item"],
    ];
    for (const [a, b, code] of refused) {
      expect([a, b, forgeItems(run, a, b)]).toMatchObject([a, b, { ok: false, code }]);
    }
    expect(run).toEqual(before);
    expect(refusalText("two_components")).toBe("It takes two components.");
  });

  test("outside planning it is refused: a pick waiting, a fight, a raid that is over", () => {
    const picking = startRun(5, { era: LEGACY_ERA });
    picking.rack = rackOf(["thorn", "plume"]);
    expect(forgeItems(picking, "thorn", "plume")).toMatchObject({ ok: false, code: "pick_starter" });
    const fighting = planning(["thorn", "plume"]);
    beginFight(fighting);
    expect(forgeItems(fighting, "thorn", "plume")).toMatchObject({ ok: false, code: "fighting" });
    const over = planning(["thorn", "plume"]);
    over.stage = { phase: "over", ending: "left" };
    expect(forgeItems(over, "thorn", "plume")).toMatchObject({ ok: false, code: "raid_over" });
    for (const run of [picking, fighting, over]) expect(run.rack).toEqual(rackOf(["thorn", "plume"]));
  });
});

describe("forging as a command", () => {
  const forge: RaidCommand = { do: "forge", item: "plume", with: "thorn" };

  test("is read off the wire with its two kinds, and nothing else is", () => {
    expect(readCommand({ do: "forge", item: "plume", with: "thorn", id: "x" })).toEqual(forge);
    for (const bad of [
      { do: "forge" },
      { do: "forge", item: "plume" },
      { do: "forge", item: "plume", with: "tongs" },
      { do: "forge", item: 0, with: 1 },
      { do: "forge", item: "plum", with: "thorn" },
      { do: "forged", item: "plume", with: "thorn" },
    ]) {
      expect(readCommand(bad)).toBeNull();
    }
  });

  test("the page shows it before Leaf answers, exactly as Leaf does it", () => {
    const state = tableOf(planning(["thorn", "bark", "plume"]));
    const guessed = predict(RAID.view(state, ctx(2)), forge);
    const done = RAID.apply(state, forge, ctx(3));
    if ("refused" in done) throw new Error(`refused: ${done.refused}`);
    expect(done.state.held.main?.rack).toEqual(rackOf(["bark", "wasptail"]));
    expect(done.notes).toEqual([{ t: "made", item: "wasptail" }]);
    expect(guessed).toEqual({ view: tableView(done.state, ctx(2)), notes: [...done.notes] });
    // Leaf's notes read back on the page as they were sent.
    expect(readNotes(structuredClone(done.notes))).toEqual([...done.notes]);
  });

  test("a refusal is the same on the page and on Leaf, and whether it would be done can be asked", () => {
    const state = tableOf(planning(["thorn", "mosscharm", "plume"]));
    const bad: RaidCommand = { do: "forge", item: "thorn", with: "mosscharm" };
    expect(predict(RAID.view(state, ctx(2)), bad)).toEqual({ refused: "two_components" });
    expect(RAID.apply(state, bad, ctx(3))).toEqual({ refused: "two_components" });
    const run = state.held.main;
    if (!run) throw new Error("no run");
    expect([
      legal(run, { do: "forge", item: "thorn", with: "mosscharm" }),
      legal(run, { do: "forge", item: "thorn", with: "plume" }),
    ]).toEqual([false, true]);
    expect(run.rack).toEqual(rackOf(["thorn", "mosscharm", "plume"]));
  });
});
