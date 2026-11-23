import { describe, expect, test } from "bun:test";

import { setOpen, setWay } from "./build.ts";
import { check } from "./check.ts";
import { awayOf } from "./clock.ts";
import { create } from "./create.ts";
import { put, steps, workingYard } from "./fixtures.ts";
import { RIGHT } from "./grid.ts";
import { saveBlueprint, within } from "./pieces.ts";
import { load, save } from "./save.ts";
import { blank, type Building, type World } from "./world.ts";
import large from "./yards/large.json";
import mid from "./yards/mid.json";
import short from "./yards/short.json";
import small from "./yards/small.json";

/** A yard read from its text, or the test fails. */
function read(text: string): World {
  const w = load(text);
  if (!w) throw new Error("not a yard");
  return w;
}
const again = (w: World): World => read(save(w));
/** The kept yards, and a working one with a splitter, a joiner, a crate and a blueprint, each run on a while. */
function yards(): [string, World][] {
  const working = workingYard();
  put(working, "splitter", 17, 13);
  put(working, "joiner", 18, 13);
  put(working, "crate", 19, 13);
  expect(saveBlueprint(working, 0, within(working, 19, 13, 23, 17))).toBeNull();
  const kept = Object.entries({ small, short, mid, large }).map(([name, yard]): [string, World] => [
    name,
    read(JSON.stringify(yard)),
  ]);
  const all: [string, World][] = [...kept, ["working", working]];
  for (const [, w] of all) steps(w, 300);
  return all;
}

/** The first piece of a kind in a yard, or the test fails. */
function first(w: World, kind: Building["kind"]): Building {
  const b = w.cells.find((c) => c?.kind === kind);
  if (!b) throw new Error(`no ${kind}`);
  return b;
}
const belt = (w: World): Building => first(w, "belt");

describe("the check", () => {
  test("is the same for a yard and for the yard read back from its save, and for the page's copy of it", () => {
    for (const [name, w] of yards()) {
      expect([name, check(again(w))]).toEqual([name, check(w)]);
      // What the page is shown: no seed, and a letter about a time away; and Leaf sets `at` on its own.
      const page = read(save({ ...w, seed: null, away: awayOf(w) ?? { seconds: 600, coins: 3, made: {} } }));
      page.at += 12_345;
      expect([name, check(page)]).toEqual([name, check(w)]);
    }
  });

  test("of two yards alike stays alike, run on 1,000 ticks", () => {
    for (const [name, w] of yards()) {
      const copy = again(w);
      steps(w, 1000);
      steps(copy, 1000);
      expect([name, check(copy)]).toEqual([name, check(w)]);
      expect(save(copy)).toBe(save(w));
    }
  });

  test("differs for any one thing changed", () => {
    const working = yards().find(([name]) => name === "working")?.[1] ?? create();
    const before = check(working);
    const changes: Record<string, (w: World) => void> = {
      "one thing more on a belt": (w) => {
        const b = w.cells.find((c) => c?.kind === "belt" && c.item === null);
        if (!b) throw new Error("no empty belt");
        b.item = "plank";
      },
      "one thing less on a belt": (w) => {
        const b = w.cells.find((c) => c?.kind === "belt" && c.item !== null);
        if (!b) throw new Error("no full belt");
        b.item = null;
      },
      "how far a thing is across its belt": (w) => {
        const b = w.cells.find((c) => c?.kind === "belt" && c.item !== null);
        if (b) b.prog += 0.125;
      },
      "a machine's work one tick on": (w) => void (first(w, "mill").work += 1),
      "a boiler's fuel": (w) => void (first(w, "boiler").fuel += 1),
      "a splitter's turn": (w) => void (first(w, "splitter").turn = (first(w, "splitter").turn + 1) % 3),
      "a crate's contents": (w) => {
        const crate = first(w, "crate");
        crate.buf.stone = (crate.buf.stone ?? 0) + 1;
        crate.count++;
      },
      "a crate shut": (w) => {
        const i = w.cells.indexOf(first(w, "crate"));
        setOpen(w, i % w.land.w, Math.floor(i / w.land.w), false);
      },
      "a shut way": (w) => {
        const i = w.cells.indexOf(first(w, "splitter"));
        setWay(w, i % w.land.w, Math.floor(i / w.land.w), 1, false);
      },
      "a colour": (w) => void (belt(w).tint = 3),
      "a recipe set": (w) => void (first(w, "bench").recipe = "engine"),
      "what a machine is making, and has made": (w) => void (first(w, "mill").out = "brick"),
      "which way a piece faces": (w) => void (belt(w).dir = RIGHT[belt(w).dir]),
      "a piece taken away": (w) => void (w.cells[w.cells.indexOf(belt(w))] = null),
      "a piece of another kind": (w) => void (w.cells[w.cells.indexOf(belt(w))] = blank("joiner", 0)),
      "a piece that was to hand": (w) => void (belt(w).free = !belt(w).free),
      "what is under a tunnel": (w) => {
        const mouth = w.cells.find((c) => c?.kind === "tunnel" && c.span > 0);
        if (!mouth) throw new Error("no tunnel");
        mouth.under[0] = mouth.under[0] === null ? "ore" : null;
      },
      "the till": (w) => void (w.till += 0.01),
      "an order's filled count": (w) => {
        const order = w.board[0];
        if (!order) throw new Error("no board");
        order.filled.plank = (order.filled.plank ?? 0) + 1;
      },
      "an order on the board": (w) => void w.board.pop(),
      "the tick": (w) => void (w.tick += 1),
      "the Coins changes counted": (w) => void (w.bank += 1),
      "the story": (w) => void (w.filled.plank = (w.filled.plank ?? 0) + 1),
      "what the depot has taken in": (w) => void (w.depot.ore = (w.depot.ore ?? 0) + 1),
      "what has gone to orders": (w) => void (w.given.ore = (w.given.ore ?? 0) + 1),
      "the orders hung": (w) => void (w.serial += 1),
      "the next free swap": (w) => void (w.swapAt += 1),
      "the owner's last command": (w) => void (w.seen = { ...w.seen, tick: w.seen.tick + 1 }),
      "a plot": (w) => void w.plots.push("meadow"),
      "a plan": (w) => void w.plans.pop(),
      "the pieces to hand": (w) => void (w.spare.belt = (w.spare.belt ?? 0) + 1),
      "the pace": (w) => void (w.pace.warm += 1),
      "a blueprint": (w) => void (w.blueprints[0] = null),
    };
    for (const [what, change] of Object.entries(changes)) {
      const w = again(working);
      expect(check(w)).toBe(before);
      change(w);
      expect([what, check(w) === before]).toEqual([what, false]);
    }
  });

  test("covers every field of a piece and of the yard but those it leaves out", () => {
    // A field added to a piece or the yard fails this until the check mixes it in, or says why not.
    const piece = Object.keys(blank("belt", 0)).filter((k) => !["kinds", "count", "idle", "via"].includes(k));
    expect(piece.toSorted()).toEqual([
      "buf",
      "dir",
      "free",
      "fuel",
      "item",
      "kind",
      "making",
      "open",
      "out",
      "prog",
      "recipe",
      "shut",
      "span",
      "tint",
      "turn",
      "under",
      "underProg",
      "work",
    ]);
    const leftOut = new Set([
      "land",
      "power",
      "seed",
      "at",
      "away",
      "rates",
      "open",
      "supply",
      "demand",
      "wire",
      "news",
    ]);
    expect(
      Object.keys(create())
        .filter((k) => !leftOut.has(k))
        .toSorted(),
    ).toEqual([
      "bank",
      "blueprints",
      "board",
      "cells",
      "depot",
      "done",
      "filled",
      "given",
      "pace",
      "paid",
      "plans",
      "plots",
      "seen",
      "serial",
      "sold",
      "spare",
      "story",
      "swapAt",
      "tick",
      "till",
      "told",
    ]);
  });
});
