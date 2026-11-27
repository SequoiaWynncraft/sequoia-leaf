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
  CRATE,
  create,
  deliver,
  DEPOT,
  encode,
  goal,
  GOALS,
  gradeSays,
  holderOf,
  item,
  kind,
  MILLI,
  NONE,
  piecesAt,
  placed,
  play,
  type Plot,
  plot,
  plotName,
  plotPrice,
  plotState,
  put,
  readCommand,
  SORTER,
  SPLITTER,
  takes,
  type Yard,
} from "@sequoia-leaf/factory";
import { near, xy } from "@sequoia-leaf/factory/test/near.ts";
import { deck } from "@sequoia-leaf/kit/card.ts";

import { act, clear, ctx, isRecord, kindAt, kindOn, opened, until, useFakeLeaf } from "../test/fake-leaf.ts";
import { armsAt, asIf, layout } from "./layout.ts";
import { markedTiles, pinPulse } from "./pinned.ts";
import { DRAWN, draws, S, toolHooks } from "./state.ts";
import {
  aimAt,
  cancel,
  confirm,
  dragEnd,
  dragLost,
  dragOver,
  hold,
  keepAim,
  markEnd,
  markOver,
  markStart,
  paintAt,
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
import { aimedSpan, comesUp, setWayIn, tunnelAim } from "./tunnel.ts";
import { moveFrom, tileRef } from "./ui/card.ts";
import { handPrint } from "./ui/dock.ts";
import { printOf } from "./ui/prints.ts";
import { machineRef } from "./ui/refs.ts";
import { again, coins, differences, doNow, runYard } from "./yard.ts";

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
/** The colour of the line through a tile of the page's copy. */
const tint = (x: number, z: number): number => S.world.tint[x + z * S.world.land.w] ?? 0;
/** The commands Leaf was sent, by what each did. */
const sent = (leaf: { commands: unknown[] }): unknown[] =>
  leaf.commands.map((c) => (typeof c === "object" && c !== null && "do" in c ? c.do : null));

describe("Select's copy", () => {
  test("of more than 160 pieces is one command, done alike on the page and on Leaf", async () => {
    const y = yardAt(3);
    buyPlot(y, plot("meadow"), 300, Infinity);
    // 161 belts on the yard's own plot, clear of the depot, and of where the meadow's redwoods would meet a copy of them.
    for (let dy = -6; dy < 6; dy++)
      for (let dx = -8; dx < 8; dx++) {
        const byDepot = dy >= -1 && dy <= 1 && dx > -2;
        const byTrees = (dy === 3 || dy === 4) && (dx === -2 || dx === -1);
        if (!byDepot && !byTrees) expect(build(y, BELT, ...xy(dx, dy), 0, Infinity).ok).toBe(true);
      }
    expect(y.kind.filter((k) => k === BELT).length).toBe(161);
    const fake = await opened(y, 10_000);
    setTool("select");
    markStart(...xy(-8, -6));
    markOver(...xy(7, 5));
    markEnd();
    expect(S.mark?.pieces.length).toBe(161);
    hold("copy");
    // Its box of 16 by 12 on the meadow, (16, 24) to (31, 35).
    aimAt(...xy(-1, 11));
    expect(S.aim?.why).toBeNull();
    expect(place(...xy(-1, 11))).toBe(true);
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
    for (let dx = -6; dx < -3; dx++) build(y, BELT, ...xy(dx, -5), 0, Infinity);
    await opened(y, 10_000);
    setTool("select");
    markStart(...xy(-6, -5));
    markOver(...xy(-4, -5));
    markEnd();
    hold("copy");
    // The first copy lands one tile on, over two of the three it was taken from.
    aimAt(...xy(-4, -5));
    expect(place(...xy(-4, -5))).toBe(true);
    if (S.group) S.group.turns = 1;
    aimAt(...xy(2, -3));
    expect(S.group?.at).toEqual(placed(piecesAt(S.world, S.group?.tiles ?? []), 1, ...xy(2, -4)));
  });
});

describe("a piece's card's Move", () => {
  test("takes that piece alone in hand, and setting it down moves it, done alike on the page and on Leaf", async () => {
    const y = yardAt(3);
    for (let dx = -6; dx < -3; dx++) build(y, BELT, ...xy(dx, -5), 0, Infinity);
    build(y, kind("crate"), ...xy(-3, -5), 0, Infinity);
    const fake = await opened(y, 10_000);
    const w = S.world;
    expect(printOf(tileRef(at(w, ...xy(-3, -5))))).toMatchObject({ card: "standing", move: true });
    // On a tile with nothing standing, it takes nothing up.
    const hand = S.hand;
    moveFrom(...xy(0, -3));
    expect(S.hand).toBe(hand);
    moveFrom(...xy(-3, -5));
    expect(S.group?.as).toBe("move");
    expect(piecesAt(w, S.group?.tiles ?? []).map((p) => [p.kind, p.x, p.y])).toEqual([[kind("crate"), ...xy(-3, -5)]]);
    aimAt(...xy(1, -3));
    expect(S.aim?.why).toBeNull();
    expect(place(...xy(1, -3))).toBe(true);
    expect([kindAt({ ...near(-3, -5) }), kindAt({ ...near(1, -3) }), kindAt({ ...near(-4, -5) })]).toEqual([
      undefined,
      "crate",
      "belt",
    ]);
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(5);
    expect(sent(fake.leaf)).toEqual(["move"]);
    expect([differences(), encode(S.world)]).toEqual([0, encode({ ...fake.leaf.yard, seed: null })]);
  });

  test("takes a tunnel's two mouths alone, and not the belts that cross over between them", async () => {
    const y = yardAt(3);
    expect(build(y, kind("tunnel"), ...xy(-4, -2), 0, Infinity, { span: 2 }).ok).toBe(true);
    for (let dy = -3; dy < 0; dy++) expect(build(y, BELT, ...xy(-3, dy), 1, Infinity).ok).toBe(true);
    await opened(y, 10_000);
    moveFrom(...xy(-4, -2));
    expect(S.group?.as).toBe("move");
    expect(piecesAt(S.world, S.group?.tiles ?? []).map((p) => p.kind)).toEqual([kind("tunnel")]);
  });
});

describe("the belt tool, with a finger", () => {
  test("tapping a splitter starts the run on the tile ahead of it, and Leaf lays it as the page did", async () => {
    const y = yardAt(1);
    build(y, BELT, ...xy(-6, -5), 0, Infinity);
    build(y, SPLITTER, ...xy(-5, -5), 0, Infinity);
    const fake = await opened(y, 10_000);
    S.finger = true;
    setTool(BELT);
    tapBelt(...xy(-5, -5));
    tapBelt(...xy(0, -5));
    expect(S.run?.why).toBeNull();
    expect(S.run?.legs[0]).toMatchObject({ ...near(-4, -5) });
    expect(confirm()).toBe(true);
    expect([kindAt({ ...near(-5, -5) }), kindAt({ ...near(-4, -5) }), kindAt({ ...near(0, -5) })]).toEqual([
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

  test("puts a signpost on every plot for sale, whatever has been bought: Skyfall Edge too, whose redwoods stand along the middle of its edge", () => {
    const y = create({ seed: 3, tier: 5 });
    const sale = (): Plot[] => y.land.plots.flatMap((p) => (plotState(y, p.plot).state === "for sale" ? [p.plot] : []));
    const signed = (): Plot[] => layout(y).signs.map((s) => s.plot.plot);
    // Bought as the page buys, by a command, so that the yard counts the change and its layout is worked out again.
    const buy = (p: Plot): void => {
      const c = readCommand({ tick: y.tick, do: "buyPlot", plot: plotName(p), price: plotPrice(y, p) });
      if (!c || "refused" in play(y, c)) throw new Error("not bought");
    };
    buy(plot("meadow"));
    buy(plot("workings"));
    expect(signed()).toContain(plot("skyfall"));
    // Every plot, bought cheapest first: at each step, every plot for sale has its sign and no other has one.
    for (let left = sale(); left.length > 0; left = sale()) {
      expect(signed().toSorted((a, b) => a - b)).toEqual(left.toSorted((a, b) => a - b));
      buy(left.reduce((a, b) => (plotPrice(y, b) < plotPrice(y, a) ? b : a)));
    }
  });

  test("is worked out again when a line is coloured: a colour is part of what stands", async () => {
    const y = yardAt(2);
    for (let dx = -6; dx < -2; dx++) build(y, BELT, ...xy(dx, -5), 0, Infinity);
    await opened(y);
    const before = layout(S.world);
    expect("refused" in doNow(act({ do: "paint", ...near(-5, -5), tint: 3 }))).toBe(false);
    expect(layout(S.world)).not.toBe(before);
  });

  test("is worked out again for every change the rules count, and kept while the yard only runs on", async () => {
    const y = yardAt(2);
    for (let dx = -6; dx < -2; dx++) build(y, BELT, ...xy(dx, -5), 0, Infinity);
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
    build(y, BELT, ...xy(-6, -5), 0, Infinity);
    build(y, SORTER, ...xy(-5, -5), 0, Infinity);
    build(y, SPLITTER, ...xy(-4, -5), 0, Infinity);
    build(y, BELT, ...xy(-3, -5), 0, Infinity);
    await opened(y, 100_000);
    for (const c of [
      { do: "build", kind: "belt", ...near(-6, -5), dir: 0, grade: 2 },
      { do: "sort", ...near(-5, -5), item: "plank" },
      { do: "first", ...near(-4, -5), way: 0 },
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
    build(y, SORTER, ...xy(-6, -5), 0, Infinity);
    build(y, BELT, ...xy(-5, -5), 0, Infinity);
    // With Coins for the cart stop built below.
    await opened(y, 1000);
    expect(DRAWN.every(draws)).toBe(true);
    // The depot is drawn too, and is no tool.
    expect([draws(DEPOT), usable(DEPOT), DRAWN.includes(DEPOT)]).toEqual([true, false, false]);
    expect([usable(SORTER), usable(kind("stop")), usable(kind("study"))]).toEqual([true, true, true]);
    setTool(null);
    expect(pickFrom(...xy(-6, -5))).toBe(true);
    expect(S.tool).toBe(SORTER);
    const L = layout(S.world);
    expect([(L.arms[at(S.world, ...xy(-6, -5))] ?? 0) > 0, (L.arms[at(S.world, ...xy(-5, -5))] ?? 0) > 0]).toEqual([
      true,
      true,
    ]);
    // A piece that hands into a cart stop is one whose things reach the depot: the stop is told which.
    expect("refused" in doNow(act({ do: "build", kind: "stop", ...near(-4, -5), dir: 0 }))).toBe(false);
    const after = layout(S.world);
    const n = after.intoDepot.indexOf(at(S.world, ...xy(-5, -5)));
    expect([n >= 0, after.intoStop[n]]).toEqual([true, at(S.world, ...xy(-4, -5))]);
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
    build(y, BELT, ...xy(-5, -5), 0, Infinity);
    await opened(y);
    setTool(kind("tunnel"));
    aimAt(...xy(-6, -5));
    expect(S.aim?.far).toBe(at(S.world, ...xy(-4, -5)));
  });
});

/** What each grade's button quotes with the tunnel's way in set at (-7, -5), aimed `dx` tiles on. */
function quotes(dx: number): number[] {
  aimAt(...xy(-7 + dx, -5));
  return handPrint().grades.map((g) => g.cost);
}

describe("a tunnel through a deep culvert", () => {
  test("is aimed as far as 12 tiles on, at 2 Coins more for each past 5; its card says what it cost, raises and gives back by the same", async () => {
    // Every research of tier 5 done; a row clear for 14 tiles.
    const fake = await opened(create({ seed: 5, tier: 6 }), 5000);
    const w = S.world;
    setTool(kind("tunnel"));
    S.dir = 0;
    const from = near(-7, -5);
    expect(setWayIn(from.x, from.y)).toBe(true);
    const aimed = (dx: number): unknown => {
      const a = tunnelAim(from, -1, ...xy(-7 + dx, -5));
      return [a.why, a.cost];
    };
    expect([aimed(6), aimed(7), aimed(13), aimed(14)]).toEqual([
      [null, 12],
      [null, 14],
      [null, 26],
      ["A tunnel passes under 1 to 12 tiles", 12],
    ]);
    // Aimed 12 tiles on, each grade's button quotes what that grade of it costs.
    expect([quotes(3), quotes(13)]).toEqual([
      [12, 36, 96],
      [26, 78, 208],
    ]);
    // Each button's card, held, is of that grade of the tunnel aimed: the same price, worked out once.
    const held = [1, 2, 3].map((g) => printOf(machineRef(kind("tunnel"), g, aimedSpan(kind("tunnel")))));
    expect(held.map((p) => (p?.card === "machine" ? [p.price, p.span] : null))).toEqual([
      [26, 12],
      [78, 12],
      [208, 12],
    ]);
    expect(comesUp(from, ...xy(6, -5))).toBe(true);
    await until(() => fake.leaf.commands.some((c) => isRecord(c) && c.do === "lay"));
    const p = printOf(tileRef(at(w, from.x, from.y)));
    if (p?.card !== "standing") throw new Error("no card");
    expect([p.machine.price, p.raise?.cost, p.refund]).toEqual([26, 78 - 26, 26]);
    // Its Raise says what grade II of it costs, as the card's text for that grade does.
    expect([p.machine.span, gradeSays(kind("tunnel"), 2, p.machine.span)]).toEqual([
      12,
      "Carries up to 200 items /min, up from 150. Costs 78 Coins.",
    ]);
    // From its far mouth alike.
    expect(printOf(tileRef(at(w, ...xy(6, -5))))).toMatchObject({ machine: { price: 26 }, refund: 26 });
  });
});

/** A way in at (-6, -5) facing east, fed from behind and from the north, in a yard with tier 5's research to `tier`. */
function fed(tier: number): { y: Yard; i: number } {
  const y = create({ seed: 5, tier });
  expect(build(y, BELT, ...xy(-7, -5), 0, Infinity).ok).toBe(true);
  expect(build(y, BELT, ...xy(-6, -6), 1, Infinity).ok).toBe(true);
  expect(build(y, kind("tunnel"), ...xy(-6, -5), 0, Infinity, { span: 2 }).ok).toBe(true);
  return { y, i: at(y, ...xy(-6, -5)) };
}
/** Its arms east, south, west and north: 1 in, 2 out, 0 none. */
const armsOf = (y: Yard, i: number): number[] => [0, 1, 2, 3].map((side) => (armsAt(y, i) >> (side * 2)) & 3);

describe("a tunnel's way in, drawn", () => {
  test("takes in from the north with wide mouths and is drawn so; without them, from behind alone, and drawn so", () => {
    const wide = fed(6);
    expect([takes(wide.y, wide.i, at(wide.y, ...xy(-6, -6))), armsOf(wide.y, wide.i)]).toEqual([true, [0, 0, 1, 1]]);
    const narrow = fed(5);
    expect([takes(narrow.y, narrow.i, at(narrow.y, ...xy(-6, -6))), armsOf(narrow.y, narrow.i)]).toEqual([
      false,
      [0, 0, 1, 0],
    ]);
  });
});

describe("a long tunnel the purse is short for", () => {
  test("shows its own price, and turns good once the purse covers it, with the pointer still", async () => {
    await opened(create({ seed: 5, tier: 6 }), 15);
    S.world.till = 0;
    setTool(kind("tunnel"));
    S.dir = 0;
    const from = near(-7, -5);
    expect(setWayIn(from.x, from.y)).toBe(true);
    aimAt(...xy(6, -5));
    // Short, it shows the nearest tile it could come up on, as ever, and the price of the one asked for.
    expect([coins(), S.aim?.why, S.aim?.cost, S.aim?.far]).toEqual([
      15,
      "Not enough Coins",
      26,
      at(S.world, ...xy(-5, -5)),
    ]);
    // The till earns what is short; the pointer has not moved.
    S.world.till += 11 * MILLI;
    keepAim();
    expect([coins(), S.aim?.why, S.aim?.cost, S.aim?.far]).toEqual([26, null, 26, at(S.world, ...xy(6, -5))]);
  });

  test("one under 5 tiles or fewer, short of Coins, shows what the page always showed: the nearest tile, its price, why", async () => {
    await opened(create({ seed: 5, tier: 5 }), 11);
    S.world.till = 0;
    setTool(kind("tunnel"));
    S.dir = 0;
    const from = near(-7, -5);
    expect(setWayIn(from.x, from.y)).toBe(true);
    for (const ahead of [3, 4, 5, 6]) {
      aimAt(...xy(-7 + ahead, -5));
      expect([ahead, S.aim?.why, S.aim?.cost, S.aim?.far]).toEqual([
        ahead,
        "Not enough Coins",
        12,
        at(S.world, ...xy(-5, -5)),
      ]);
    }
  });
});

describe("a tunnel's card", () => {
  test("reads nothing of the holders' table at its own row", async () => {
    const y = yardAt(2);
    // A crate holding three planks, and a tunnel: each the first row of its own table.
    build(y, kind("crate"), ...xy(-6, -5), 0, Infinity);
    build(y, kind("tunnel"), ...xy(-4, -5), 0, Infinity);
    const crate = at(y, ...xy(-6, -5));
    const tunnel = at(y, ...xy(-4, -5));
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
    for (let dx = -6; dx < -2; dx++) build(y, BELT, ...xy(dx, -5), 0, Infinity);
    build(y, kind("crate"), ...xy(-2, -5), 0, Infinity);
    await opened(y);
    const w = S.world;
    const tiles = [-6, -5, -4, -3, -2].map((dx) => at(w, ...xy(dx, -5)));
    const kept = (): unknown => [encode(w), [w.kind, w.dir, w.span, w.shut, w.tint, w.row].map((a) => Array.from(a))];
    const before = kept();
    const group = { as: "move" as const, tiles, at: placed(piecesAt(w, tiles), 1, ...xy(-4, -3)) };
    const as = asIf(w, group);
    expect(kept()).toEqual(before);
    // Moved: gone from where they stand, and standing where they are aimed, turned to face south.
    expect([
      as.kind[at(w, ...xy(-6, -5))],
      as.kind[at(w, ...xy(-4, -3))],
      as.dir[at(w, ...xy(-4, -3))],
      as.kind[at(w, ...xy(-4, 1))],
    ]).toEqual([NONE, BELT, 1, kind("crate")]);
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
    for (let dx = -6; dx < -2; dx++) build(y, BELT, ...xy(dx, -5), 0, Infinity);
    for (let dx = -6; dx < -2; dx++) build(y, BELT, ...xy(dx, -2), 0, Infinity);
    const fake = await opened(y);
    setTool("paint");
    S.tint = 3;
    press(...xy(-5, -5), 1);
    expect(S.world.tint[at(S.world, ...xy(-5, -5))]).toBe(3);
    // The yard gives way to Leaf's: what is under way is put away, as Escape puts it away.
    cancel();
    dragOver(...xy(-5, -2), 1);
    expect(S.world.tint[at(S.world, ...xy(-5, -2))]).toBe(0);
    await until(() => fake.leaf.posts >= 1);
    expect(sent(fake.leaf)).toEqual(["paint"]);
  });

  test("losing focus mid-drag lays no run, and the belt aims again where the mouse goes", async () => {
    const fake = await opened(yardAt(2));
    setTool(BELT);
    runStart(...xy(-6, -5), 1);
    runOver(...xy(-3, -5), 1);
    expect([running(), S.run?.legs.length]).toEqual([true, 4]);
    // What the window's blur does.
    dragLost();
    expect([running(), S.run, S.tool]).toEqual([false, null, BELT]);
    // A let-go that comes after all lays nothing.
    dragEnd(1);
    S.hover = { ...near(-6, -4) };
    aimAt(...xy(-6, -4));
    expect([S.aim?.x, S.aim?.y]).toEqual(xy(-6, -4));
    await Bun.sleep(5);
    expect(fake.leaf.posts).toBe(0);
  });
});

describe("Undo, done by the rules", () => {
  test("is one command naming the yard's newest entry, done alike on the page and on Leaf, and shows while there is one", async () => {
    const fake = await opened(yardAt(2), 100);
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    expect(handPrint().undo).toBe(false);
    setTool(BELT);
    expect(place(a.x, a.y)).toBe(true);
    const id = S.world.history.at(-1)?.id;
    expect(handPrint().undo).toBe(true);
    expect(undo()).toBe(true);
    expect([kindAt(a), S.world.history, handPrint().undo]).toEqual([undefined, [], false]);
    await until(() => fake.leaf.commands.length >= 2);
    await Bun.sleep(2);
    expect(fake.leaf.commands.slice(1)).toMatchObject([{ do: "undo", entry: id }]);
    expect([kindOn(fake.leaf.yard, a), differences()]).toEqual([undefined, 0]);
  });

  test("is kept with the yard: Leaf's yard taken again, as after a reload or on another device, still undoes the same", async () => {
    const fake = await opened(yardAt(2), 100);
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    setTool(BELT);
    expect(place(a.x, a.y)).toBe(true);
    await until(() => fake.leaf.posts >= 1);
    await again();
    expect([kindAt(a), handPrint().undo]).toEqual(["belt", true]);
    expect(undo()).toBe(true);
    await until(() => fake.leaf.posts >= 2);
    expect([kindAt(a), kindOn(fake.leaf.yard, a)]).toEqual([undefined, undefined]);
  });

  test("another page's Undo of the same thing comes first: this page's is refused by Leaf, and nothing is undone twice", async () => {
    const fake = await opened(yardAt(2), 100);
    const tiles = clear(40);
    const [a, b] = [tiles[0], tiles.at(-1)];
    if (!a || !b) throw new Error("no room");
    setTool(BELT);
    expect(place(a.x, a.y)).toBe(true);
    expect(place(b.x, b.y)).toBe(true);
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(2);
    // Another page of the member's undoes the belt on b; this page still shows it, and undoes it too.
    fake.elsewhere({ do: "undo", entry: S.world.history.at(-1)?.id });
    expect(undo()).toBe(true);
    // Leaf's newest entry is the belt on a: an Undo naming b's is refused, and the page takes Leaf's yard.
    await until(() => fake.leaf.posts >= 2);
    await Bun.sleep(5);
    expect([kindAt(a), kindAt(b), kindOn(fake.leaf.yard, a), kindOn(fake.leaf.yard, b)]).toEqual([
      "belt",
      undefined,
      "belt",
      undefined,
    ]);
  });

  test("a stroke whose entry is no longer the newest once the page takes Leaf's yard mid-drag begins an entry of its own with its next line", async () => {
    const y = yardAt(4);
    for (const dy of [-6, -4]) for (const dx of [-8, -7, -6]) build(y, BELT, ...xy(dx, dy), 0, Infinity);
    const fake = await opened(y, 100);
    setTool("paint");
    expect(paintAt(...xy(-8, -6), false, 1)).toBe(true);
    const stroke = S.world.history.at(-1)?.id ?? "";
    await until(() => fake.leaf.posts >= 1);
    // Another page of the member's does something, and this page takes Leaf's yard mid-drag.
    fake.elsewhere({ do: "turn", ...near(-6, -4), dir: 1, id: "elsewhere-1" });
    await again();
    expect(S.world.history.map((e) => e.id)).toEqual([stroke, "elsewhere-1"]);
    expect(paintAt(...xy(-8, -4), true, 1)).toBe(true);
    expect(S.world.history.length).toBe(3);
    // One Undo undoes the line painted since: the other page's turn and the stroke's first line stand.
    expect(undo()).toBe(true);
    expect([tint(...xy(-8, -6)) > 0, tint(...xy(-8, -4)), S.world.history.map((e) => e.id)]).toEqual([
      true,
      0,
      [stroke, "elsewhere-1"],
    ]);
  });

  test("after a crate built is shut from its card, has nothing to undo: the crate stands, shut, on the page and on Leaf", async () => {
    const fake = await opened(yardAt(3), 1000);
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    setTool(CRATE);
    expect(place(a.x, a.y)).toBe(true);
    await until(() => fake.leaf.posts >= 1);
    expect(handPrint().undo).toBe(true);
    // The crate's card: Shut it; Leaf says it is done.
    expect("refused" in doNow({ do: "crate", x: a.x, y: a.y, open: false })).toBe(false);
    await until(() => fake.leaf.posts >= 2);
    const open = (y: Yard): number | undefined => y.holders.open[holderOf(y, at(y, a.x, a.y))];
    expect(handPrint().undo).toBe(false);
    expect(undo()).toBe(false);
    await Bun.sleep(5);
    expect([kindAt(a), open(S.world), kindOn(fake.leaf.yard, a), open(fake.leaf.yard)]).toEqual([
      "crate",
      0,
      "crate",
      0,
    ]);
    expect(fake.leaf.commands.map((c) => (isRecord(c) ? c.do : null))).toEqual(["build", "crate"]);
  });

  test("with nothing to undo says so, and sends nothing", async () => {
    const fake = await opened(yardAt(2), 100);
    const said: string[] = [];
    toolHooks.said = (text) => void said.push(text);
    expect(undo()).toBe(false);
    expect(said).toEqual(["Nothing to undo."]);
    await Bun.sleep(5);
    expect(fake.leaf.commands).toEqual([]);
  });
});

/** Pins the card of a tile, as a click on it does. */
const pin = (i: number): void => {
  deck.open = { stack: [`tile:${i}`], pinned: true, via: "mouse", at: {}, from: {}, side: false, preview: false };
};

describe("the pinned card", () => {
  test("of a tunnel marks both mouths; the view brought to it, the mark closes in for a moment and then holds", async () => {
    const y = yardAt(2);
    build(y, kind("tunnel"), ...xy(-4, -5), 0, Infinity, { span: 2 });
    await opened(y);
    expect(markedTiles()).toEqual([]);
    pin(at(S.world, ...xy(-1, -5)));
    expect(markedTiles()).toEqual([at(S.world, ...xy(-1, -5)), at(S.world, ...xy(-4, -5))]);
    S.t = 100;
    expect(pinPulse()).toBe(0);
    S.brought = { tile: at(S.world, ...xy(-1, -5)), at: 100, card: true };
    const out = [100, 100.2, 100.5, 100.6, 101, 102].map((t) => {
      S.t = t;
      return pinPulse();
    });
    expect(out[0]).toBeGreaterThan(0);
    expect(out[1]).toBeLessThan(out[0] ?? 0);
    expect(out[2]).toBeGreaterThan(out[1] ?? 0);
    expect(out.slice(-2)).toEqual([0, 0]);
    // Another piece's card pinned: no pulse for it.
    S.t = 100;
    S.brought = { tile: at(S.world, ...xy(-23, -17)), at: 100, card: true };
    expect(pinPulse()).toBe(0);
  });

  test("is not over the piece on a phone: the piece the view was brought to is marked with no card, until a card is opened or the walk ends", async () => {
    const y = yardAt(2);
    build(y, kind("tunnel"), ...xy(-4, -5), 0, Infinity, { span: 2 });
    build(y, BELT, ...xy(-6, -5), 0, Infinity);
    await opened(y);
    deck.open = null;
    const mouth = at(S.world, ...xy(-4, -5));
    // Brought there with its card opened, and the card put away since: nothing is marked.
    S.brought = { tile: mouth, at: S.t, card: true };
    expect(markedTiles()).toEqual([]);
    // Brought there on a phone, where the card is not opened over it: marked, both mouths.
    S.brought = { tile: mouth, at: S.t, card: false };
    expect(markedTiles()).toEqual([mouth, at(S.world, ...xy(-1, -5))]);
    // Another piece's card opened: that one is marked.
    pin(at(S.world, ...xy(-6, -5)));
    expect(markedTiles()).toEqual([at(S.world, ...xy(-6, -5))]);
    deck.open = null;
    S.brought = null;
    expect(markedTiles()).toEqual([]);
  });
  test("is the one source of what the yard marks: taking up a tool closes it, and nothing is marked", async () => {
    const y = yardAt(2);
    build(y, BELT, ...xy(-6, -5), 0, Infinity);
    await opened(y);
    const i = at(S.world, ...xy(-6, -5));
    pin(i);
    expect(S.picked).toBe(i);
    setTool(BELT);
    expect([deck.open, S.picked]).toEqual([null, -1]);
  });

  test("closes when the piece it is about is taken away, or cleared with an area", async () => {
    const y = yardAt(3);
    for (let dx = -6; dx < -3; dx++) build(y, BELT, ...xy(dx, -5), 0, Infinity);
    await opened(y);
    pin(at(S.world, ...xy(-6, -5)));
    expect(takeAway(...xy(-6, -5))).toBe(true);
    expect([deck.open, S.picked]).toEqual([null, -1]);
    pin(at(S.world, ...xy(-5, -5)));
    // Another piece taken away leaves it be.
    expect(takeAway(...xy(-4, -5))).toBe(true);
    expect(S.picked).toBe(at(S.world, ...xy(-5, -5)));
    deck.close();
  });
});
