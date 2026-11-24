/**
 * What the member does, on the page against a stand-in Leaf: Select's copy is one command whatever
 * its size; the phone's belt tool starts a run on the tile ahead of what it taps; what is worked
 * out from the yard is worked out again when a goal is finished, and kept through a command that
 * changes nothing that stands; the page builds, picks up and
 * draws as belts only the kinds it draws; and a drawing of pieces in hand writes nothing to the yard.
 */
import { describe, expect, test } from "bun:test";

import {
  ALL_KINDS,
  at,
  BELT,
  build,
  buyPlot,
  check,
  create,
  deliver,
  DEPOT,
  encode,
  goal,
  GOALS,
  holderOf,
  item,
  kind,
  MILLI,
  NONE,
  piecesAt,
  placed,
  plot,
  plotState,
  put,
  SORTER,
  SPLITTER,
  type Yard,
} from "@sequoia-leaf/factory";
import { deck } from "@sequoia-leaf/kit/card.ts";

import { act, clear, ctx, kindAt, kindOn, opened, until, useFakeLeaf } from "../test/fake-leaf.ts";
import { asIf, layout } from "./layout.ts";
import { DRAWN, draws, S } from "./state.ts";
import {
  aimAt,
  cancel,
  confirm,
  dragEnd,
  dragLost,
  dragOver,
  hold,
  markEnd,
  markOver,
  markStart,
  pickFrom,
  place,
  press,
  running,
  runOver,
  runStart,
  setTool,
  takeAway,
  tapBelt,
  undo,
  usable,
} from "./tools.ts";
import { tileRef } from "./ui/card.ts";
import { printOf } from "./ui/prints.ts";
import { again, differences, doNow, runYard } from "./yard.ts";

useFakeLeaf();

/** A yard Leaf has, with every goal of the tiers below `tier` done, standing for Leaf's clock now. */
function yardAt(tier: number): Yard {
  const y = create({ seed: 5, tier });
  y.at = ctx().now;
  return y;
}
/** What a tile's card says it holds, as its print has it. */
const holds = (i: number): readonly (readonly [number, number])[] => {
  const p = printOf(tileRef(i));
  return p?.card === "standing" ? p.holding : [];
};
/** The commands Leaf was sent, by what each did. */
const sent = (leaf: { commands: unknown[] }): unknown[] =>
  leaf.commands.map((c) => (typeof c === "object" && c !== null && "do" in c ? c.do : null));

describe("Select's copy", () => {
  test("of more than 160 pieces is one command, done alike on the page and on Leaf", async () => {
    const y = yardAt(3);
    buyPlot(y, plot("meadow"), Infinity);
    // 161 belts on the yard's own plot, clear of the depot, and of where the meadow's redwoods would meet a copy of them.
    for (let z = 12; z < 24; z++)
      for (let x = 16; x < 32; x++) {
        const byDepot = z >= 17 && z <= 19 && x > 22;
        const byTrees = (z === 21 || z === 22) && (x === 22 || x === 23);
        if (!byDepot && !byTrees) expect(build(y, BELT, x, z, 0, Infinity).ok).toBe(true);
      }
    expect(y.kind.filter((k) => k === BELT).length).toBe(161);
    const fake = await opened(y, 10_000);
    setTool("select");
    markStart(16, 12);
    markOver(31, 23);
    markEnd();
    expect(S.mark?.pieces.length).toBe(161);
    hold("copy");
    // Its box of 16 by 12 on the meadow, (16, 24) to (31, 35).
    aimAt(23, 29);
    expect(S.aim?.why).toBeNull();
    expect(place(23, 29)).toBe(true);
    expect(S.world.kind.filter((k) => k === BELT).length).toBe(322);
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(5);
    expect(sent(fake.leaf)).toEqual(["copy"]);
    expect([differences(), check(S.world), encode(S.world)]).toEqual([
      0,
      check(fake.leaf.yard),
      encode({ ...fake.leaf.yard, seed: null }),
    ]);
  });

  test("sets down what stands on the tiles it was taken up from, as the rules do, after a copy has landed on them", async () => {
    const y = yardAt(3);
    for (let x = 18; x < 21; x++) build(y, BELT, x, 13, 0, Infinity);
    await opened(y, 10_000);
    setTool("select");
    markStart(18, 13);
    markOver(20, 13);
    markEnd();
    hold("copy");
    // The first copy lands one tile on, over two of the three it was taken from.
    aimAt(20, 13);
    expect(place(20, 13)).toBe(true);
    if (S.group) S.group.turns = 1;
    aimAt(26, 15);
    expect(S.group?.at).toEqual(placed(piecesAt(S.world, S.group?.tiles ?? []), 1, 26, 14));
  });
});

describe("the belt tool, with a finger", () => {
  test("tapping a splitter starts the run on the tile ahead of it, and Leaf lays it as the page did", async () => {
    const y = yardAt(1);
    build(y, BELT, 18, 13, 0, Infinity);
    build(y, SPLITTER, 19, 13, 0, Infinity);
    const fake = await opened(y, 10_000);
    S.finger = true;
    setTool(BELT);
    tapBelt(19, 13);
    tapBelt(24, 13);
    expect(S.run?.why).toBeNull();
    expect(S.run?.legs[0]).toMatchObject({ x: 20, y: 13 });
    expect(confirm()).toBe(true);
    expect([kindAt({ x: 19, y: 13 }), kindAt({ x: 20, y: 13 }), kindAt({ x: 24, y: 13 })]).toEqual([
      "splitter",
      "belt",
      "belt",
    ]);
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(5);
    expect(differences()).toBe(0);
    expect(encode(S.world)).toBe(encode({ ...fake.leaf.yard, seed: null }));
  });
});

describe("what is worked out from the yard and kept", () => {
  test("is worked out again when a goal is finished: a plot it puts up for sale has its sign", async () => {
    // The last lesson in hand, all but one gear of it given.
    const y = yardAt(0);
    for (const [name, n] of [
      ["plank", 12],
      ["ingot", 12],
      ["brick", 12],
      ["tool", 10],
      ["gear", 9],
      ["frame", 10],
    ] as const)
      deliver(y, item(name), n);
    expect(GOALS[y.hand]?.id).toBe("gears");
    await opened(y);
    const meadow = plot("meadow");
    const signed = (): boolean => layout(S.world).signs.some((s) => s.plot.plot === meadow);
    expect(signed()).toBe(false);
    // The last gear reaches the depot as the copy runs on.
    deliver(S.world, item("gear"), 1);
    runYard(1000);
    expect([S.world.done.at(-1), plotState(S.world, meadow).state]).toEqual([goal("gears"), "for sale"]);
    expect(signed()).toBe(true);
  });

  test("is worked out again when a line is coloured: a colour is part of what stands", async () => {
    const y = yardAt(2);
    for (let x = 18; x < 22; x++) build(y, BELT, x, 13, 0, Infinity);
    await opened(y);
    const before = layout(S.world);
    expect("refused" in doNow(act({ do: "paint", x: 19, y: 13, tint: 3 }))).toBe(false);
    expect(layout(S.world)).not.toBe(before);
  });

  test("is worked out again for every change the rules count, and kept while the yard only runs on", async () => {
    const y = yardAt(2);
    for (let x = 18; x < 22; x++) build(y, BELT, x, 13, 0, Infinity);
    y.till = 3 * MILLI;
    const fake = await opened(y);
    const before = layout(S.world);
    runYard(performance.now() + 300);
    expect(layout(S.world)).toBe(before);
    const rev = S.world.rev;
    expect("refused" in doNow(act({ do: "collect" }))).toBe(false);
    expect(S.world.rev).toBe(rev + 1);
    expect(layout(S.world)).not.toBe(before);
    // Leaf's yard taken is another yard.
    const kept = layout(S.world);
    await until(() => fake.leaf.posts >= 1);
    await again();
    expect(differences()).toBe(0);
    expect(layout(S.world)).not.toBe(kept);
    expect(layout(S.world).yard).toBe(S.world);
  });

  test("is worked out again when a piece is raised where it stands, a sorter is set, or a way is put first", async () => {
    const y = yardAt(5);
    build(y, BELT, 18, 13, 0, Infinity);
    build(y, SORTER, 19, 13, 0, Infinity);
    build(y, SPLITTER, 20, 13, 0, Infinity);
    build(y, BELT, 21, 13, 0, Infinity);
    await opened(y, 100_000);
    for (const c of [
      { do: "build", kind: "belt", x: 18, y: 13, dir: 0, grade: 2 },
      { do: "sort", x: 19, y: 13, item: "plank" },
      { do: "first", x: 20, y: 13, way: 0 },
    ]) {
      const before = layout(S.world);
      expect(doNow(act(c))).not.toHaveProperty("refused");
      expect(layout(S.world)).not.toBe(before);
    }
  });
});

describe("the kinds this page draws", () => {
  test("are every kind in the tables but the depot, each once; a sorter is in the dock once unlocked, picked up with Q, and drawn with a belt's arms", async () => {
    expect(DRAWN.toSorted((a, b) => a - b)).toEqual(ALL_KINDS.filter((k) => k !== DEPOT));
    const y = yardAt(4);
    build(y, SORTER, 18, 13, 0, Infinity);
    build(y, BELT, 19, 13, 0, Infinity);
    // With Coins for the cart stop built below.
    await opened(y, 1000);
    expect(DRAWN.every(draws)).toBe(true);
    // The depot is drawn too, and is no tool.
    expect([draws(DEPOT), usable(DEPOT), DRAWN.includes(DEPOT)]).toEqual([true, false, false]);
    expect([usable(SORTER), usable(kind("stop")), usable(kind("study"))]).toEqual([true, true, true]);
    setTool(null);
    expect(pickFrom(18, 13)).toBe(true);
    expect(S.tool).toBe(SORTER);
    const L = layout(S.world);
    expect([(L.arms[at(S.world, 18, 13)] ?? 0) > 0, (L.arms[at(S.world, 19, 13)] ?? 0) > 0]).toEqual([true, true]);
    // A piece that hands into a cart stop is one whose things reach the depot: the stop is told which.
    expect("refused" in doNow(act({ do: "build", kind: "stop", x: 20, y: 13, dir: 0 }))).toBe(false);
    const after = layout(S.world);
    const n = after.intoDepot.indexOf(at(S.world, 19, 13));
    expect([n >= 0, after.intoStop[n]]).toEqual([true, at(S.world, 20, 13)]);
  });

  for (const tier of [0, 1, 2])
    test(`none of the later kinds is in the dock of a yard in tier ${tier}`, async () => {
      await opened(yardAt(tier));
      expect([usable(SORTER), usable(kind("stop")), usable(kind("study"))]).toEqual([false, false, false]);
    });
});

describe("a tunnel aimed", () => {
  test("knows where its far mouth comes up, worked out once for the aim", async () => {
    const y = yardAt(2);
    build(y, BELT, 19, 13, 0, Infinity);
    await opened(y);
    setTool(kind("tunnel"));
    aimAt(18, 13);
    expect(S.aim?.far).toBe(at(S.world, 20, 13));
  });
});

describe("a tunnel's card", () => {
  test("reads nothing of the holders' table at its own row", async () => {
    const y = yardAt(2);
    // A crate holding three planks, and a tunnel: each the first row of its own table.
    build(y, kind("crate"), 18, 13, 0, Infinity);
    build(y, kind("tunnel"), 20, 13, 0, Infinity);
    const crate = at(y, 18, 13);
    const tunnel = at(y, 20, 13);
    for (let k = 0; k < 3; k++) put(y.holders, holderOf(y, crate), item("plank"));
    await opened(y);
    expect([S.world.row[crate], S.world.row[tunnel]]).toEqual([0, 0]);
    expect(holds(crate)).toEqual([[item("plank"), 3]]);
    expect(holds(tunnel)).toEqual([]);
  });
});

describe("pieces in hand, drawn as they would stand", () => {
  test("are drawn from a yard that shares all but its own few arrays with the real one, and nothing is written to it", async () => {
    const y = yardAt(3);
    for (let x = 18; x < 22; x++) build(y, BELT, x, 13, 0, Infinity);
    build(y, kind("crate"), 22, 13, 0, Infinity);
    await opened(y);
    const w = S.world;
    const tiles = [18, 19, 20, 21, 22].map((x) => at(w, x, 13));
    const kept = (): unknown => [encode(w), [w.kind, w.dir, w.span, w.shut, w.tint, w.row].map((a) => Array.from(a))];
    const before = kept();
    const group = { as: "move" as const, tiles, at: placed(piecesAt(w, tiles), 1, 20, 15) };
    const as = asIf(w, group);
    expect(kept()).toEqual(before);
    // Moved: gone from where they stand, and standing where they are aimed, turned to face south.
    expect([as.kind[at(w, 18, 13)], as.kind[at(w, 20, 15)], as.dir[at(w, 20, 15)], as.kind[at(w, 20, 19)]]).toEqual([
      NONE,
      BELT,
      1,
      kind("crate"),
    ]);
    // Everything else is the real yard's own, and its own arrays are kept for the next aim.
    for (const part of ["holders", "tunnels", "land", "item", "prog", "lit"] as const) expect(as[part]).toBe(w[part]);
    expect(as.kind).not.toBe(w.kind);
    expect(asIf(w, { ...group, as: "copy" }).kind).toBe(as.kind);
    expect(kept()).toEqual(before);
  });
});

describe("the page", () => {
  test("reads a piece's row in a side table only through the rules' `holderOf` and `tunnelOf`", async () => {
    const dir = new URL("./", import.meta.url).pathname;
    const reads: string[] = [];
    for await (const file of new Bun.Glob("**/*.ts").scan(dir)) {
      if (file.endsWith(".test.ts")) continue;
      const text = await Bun.file(dir + file).text();
      text.split("\n").forEach((line, n) => {
        // A read, not the page's own copy of rows being filled in (`asIf`).
        if (/\brow\[[^\]]*\](?!\s*=(?!=))/.test(line)) reads.push(`${file}:${n + 1}`);
      });
    }
    expect(reads).toEqual([]);
  });
});

describe("a drag ends with what is in hand", () => {
  test("a drag that goes on after the brush was put away (as the yard gives way to Leaf's) colours nothing", async () => {
    const y = yardAt(2);
    for (let x = 18; x < 22; x++) build(y, BELT, x, 13, 0, Infinity);
    for (let x = 18; x < 22; x++) build(y, BELT, x, 16, 0, Infinity);
    const fake = await opened(y);
    setTool("paint");
    S.tint = 3;
    press(19, 13, 1);
    expect(S.world.tint[at(S.world, 19, 13)]).toBe(3);
    // The yard gives way to Leaf's: what is under way is put away, as Escape puts it away.
    cancel();
    dragOver(19, 16, 1);
    expect(S.world.tint[at(S.world, 19, 16)]).toBe(0);
    await until(() => fake.leaf.posts >= 1);
    expect(sent(fake.leaf)).toEqual(["paint"]);
  });

  test("losing focus mid-drag lays no run, and the belt aims again where the mouse goes", async () => {
    const fake = await opened(yardAt(2));
    setTool(BELT);
    runStart(18, 13, 1);
    runOver(21, 13, 1);
    expect([running(), S.run?.legs.length]).toEqual([true, 4]);
    // What the window's blur does.
    dragLost();
    expect([running(), S.run, S.tool]).toEqual([false, null, BELT]);
    // A let-go that comes after all lays nothing.
    dragEnd(1);
    S.hover = { x: 18, y: 14 };
    aimAt(18, 14);
    expect([S.aim?.x, S.aim?.y]).toEqual([18, 14]);
    await Bun.sleep(5);
    expect(fake.leaf.posts).toBe(0);
  });
});

describe("undo, as Leaf did things", () => {
  test("leaves alone a piece another page built, where Leaf turned this page's own piece down", async () => {
    const fake = await opened(yardAt(2), 100);
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    // Another page of the member's builds a mill on a tile this page still shows empty.
    fake.elsewhere({ do: "build", kind: "mill", ...a, dir: 0 });
    setTool(BELT);
    expect(place(a.x, a.y)).toBe(true);
    // Leaf turns the belt down, and the page takes Leaf's yard, mill and all.
    await until(() => kindAt(a) === "mill");
    undo();
    await Bun.sleep(5);
    expect([kindAt(a), kindOn(fake.leaf.yard, a)]).toEqual(["mill", "mill"]);
    expect(sent(fake.leaf).filter((c) => c === "clear" || c === "remove")).toEqual([]);
  });

  test("undoes nothing Leaf has not done yet, and once it has, what it did", async () => {
    const fake = await opened(yardAt(2), 100);
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    setTool(BELT);
    expect(place(a.x, a.y)).toBe(true);
    // Not answered yet: nothing is undone.
    expect(undo()).toBe(false);
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(2);
    expect(undo()).toBe(true);
    await until(() => fake.leaf.posts >= 2);
    expect([kindAt(a), kindOn(fake.leaf.yard, a)]).toEqual([undefined, undefined]);
  });

  test("lets go of what no longer stands as it was done, when Leaf's yard is taken", async () => {
    const fake = await opened(yardAt(2), 100);
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    setTool(BELT);
    expect(place(a.x, a.y)).toBe(true);
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(2);
    // Another page takes that belt away and puts a mill there; this page takes Leaf's yard.
    fake.elsewhere({ do: "remove", ...a });
    fake.elsewhere({ do: "build", kind: "mill", ...a, dir: 0 });
    await again();
    expect(kindAt(a)).toBe("mill");
    expect(undo()).toBe(false);
    await Bun.sleep(5);
    expect([kindAt(a), sent(fake.leaf)]).toEqual(["mill", ["build"]]);
  });
});

/** Pins the card of a tile, as a click on it does. */
const pin = (i: number): void => {
  deck.open = { stack: [`tile:${i}`], pinned: true, via: "mouse", at: {}, from: {}, side: false, preview: false };
};

describe("the pinned card", () => {
  test("is the one source of what the yard marks: taking up a tool closes it, and nothing is marked", async () => {
    const y = yardAt(2);
    build(y, BELT, 18, 13, 0, Infinity);
    await opened(y);
    const i = at(S.world, 18, 13);
    pin(i);
    expect(S.picked).toBe(i);
    setTool(BELT);
    expect([deck.open, S.picked]).toEqual([null, -1]);
  });

  test("closes when the piece it is about is taken away, or cleared with an area", async () => {
    const y = yardAt(3);
    for (let x = 18; x < 21; x++) build(y, BELT, x, 13, 0, Infinity);
    await opened(y);
    pin(at(S.world, 18, 13));
    expect(takeAway(18, 13)).toBe(true);
    expect([deck.open, S.picked]).toEqual([null, -1]);
    pin(at(S.world, 19, 13));
    // Another piece taken away leaves it be.
    expect(takeAway(20, 13)).toBe(true);
    expect(S.picked).toBe(at(S.world, 19, 13));
    deck.close();
  });
});
