/**
 * A plan of the whole yard (`whole.ts`): the research that opens it, kept with every piece on its own
 * tiles, and put back as one command, all of it or none, that makes the yard its layout again for the
 * net of what is taken up and what is stood; refused whole, with nothing changed, short of Coins or
 * for a piece that cannot stand; undone as one entry. The largest yard a player can have, put back
 * over another, fits the history: what that costs in bytes is printed.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { near, xy } from "./near.ts";
import { give, lay, must } from "./yards.ts";

type Rec = Record<string, unknown>;

/** The research of that name. */
function research(id: string): F.Goal {
  const g = F.goalNamed(id);
  if (g === null) throw new Error(`no ${id}`);
  return g;
}
const WHOLE = research("wholeyard");
/** Every tile of a yard. */
const all = (y: F.Yard): number[] => [...y.kind.keys()];
const place = (slot: number, id?: string): Rec => ({
  do: "placeBlueprint",
  slot,
  turns: 0,
  x: 0,
  y: 0,
  ...(id ? { id } : {}),
});

/** Every goal done, tier 4's long works and research among them, with every plot bought; nothing to undo. */
function everything(seed = 1): F.Yard {
  const y = F.create({ seed, tier: 5 });
  for (let more = true; more;) {
    const p = F.PLOT_IDS.find((id) => F.plotState(y, F.plot(id)).state === "for sale");
    more = p !== undefined;
    if (p) must(y, { do: "buyPlot", plot: p });
  }
  return y;
}

/** Lines into the depot, as the delivering yard has them, in a yard with every goal done, run on until they deliver. */
function lines(seed = 1): F.Yard {
  const y = F.create({ seed, tier: 5 });
  const depot = y.land.depot;
  must(y, { do: "build", kind: "gatherer", ...near(-5, -3), dir: 0 });
  lay(y, xy(-4, -3), depot);
  must(y, { do: "build", kind: "gatherer", ...near(5, 3), dir: 3 });
  must(y, { do: "build", kind: "mill", ...near(5, 2), dir: 2 });
  lay(y, xy(4, 2), depot);
  must(y, { do: "build", kind: "pylon", ...near(3, -3), dir: 0 });
  must(y, { do: "build", kind: "gatherer", ...near(6, -4), dir: 2 });
  must(y, { do: "build", kind: "crate", ...near(5, -4), dir: 2 });
  lay(y, xy(4, -4), depot);
  for (let k = 0; k < 600; k++) F.step(y);
  y.history = [];
  return y;
}

/** A tile of the yard's own plot where a workshop may stand, clear of everything. */
function clearTile(y: F.Yard): { x: number; y: number } {
  const i = all(y).find((t) => F.refusal(y, F.WORKSHOP, t % y.land.w, Math.floor(t / y.land.w), Infinity) === null);
  if (i === undefined) throw new Error("no clear ground");
  return { x: i % y.land.w, y: Math.floor(i / y.land.w) };
}

/** The Coins a command moved to the player, the till paid in with it left out. */
const coinsOf = (did: ReturnType<typeof F.play>): number =>
  "refused" in did
    ? Number.NaN
    : (did.coins ?? []).reduce((n, c) => n + (c.reason === "Earned in the Works" ? 0 : c.amount), 0);

/** How every piece stands, as the player set it; with `hand`, which were to hand, and the pieces to hand. */
function settings(y: F.Yard, hand = true): string {
  const pieces = all(y).flatMap((i) =>
    F.isKind(y.kind[i] ?? F.NONE) ? [[i, y.kind[i], y.dir[i], y.span[i], hand ? y.free[i] : 0, F.keptAt(y, i)]] : [],
  );
  return JSON.stringify([pieces, hand ? Array.from(y.spare) : []]);
}

/** How many of each kind were to hand, standing or not: what the yard has of them whatever stands where. */
const toHand = (y: F.Yard): number[] =>
  Array.from(y.spare, (n, k) => n + all(y).filter((i) => y.kind[i] === k && y.free[i] === 1).length);

/** What a machine, crate or boiler on a tile holds and is doing. */
function holding(y: F.Yard, x: number, z: number): unknown {
  const r = F.holderOf(y, F.at(y, x, z));
  const h = y.holders;
  return [h.out[r], h.making[r], h.work[r], h.count[r], ...F.ALL_ITEMS.map((n) => F.held(h, r, n))];
}

/** The bytes a yard takes as the store keeps it, UTF-8 text. */
const bytesKept = (y: F.Yard): number => Buffer.byteLength(F.encode(y), "utf8");

/** The grade III line-hours of a piece of research: each folio it wants, at what one grade III machine makes of it a minute. */
function lineHours(g: F.Goal): number {
  const want = F.GOALS[g]?.want ?? F.counts();
  return F.ALL_ITEMS.reduce((sum, n) => {
    const count = want[n] ?? 0;
    if (count === 0) return sum;
    const { kind, recipe } = F.makerOf(n);
    return sum + count / F.makes(kind, 3, recipe) / 60;
  }, 0);
}

describe("the research", () => {
  test("is tier 4's, after the plan chest's shelves, and the most the game asks for any research: about 15 hours of grade III lines", () => {
    const info = F.GOALS[WHOLE];
    expect([info?.kind, info?.tier, info?.needs.map((g) => F.GOALS[g]?.id)]).toEqual(["research", 4, ["shelves"]]);
    const others = F.ALL_GOALS.filter((g) => F.GOALS[g]?.kind === "research" && g !== WHOLE);
    const most = Math.max(...others.map(lineHours));
    console.log(
      `A plan of the whole yard: ${lineHours(WHOLE).toFixed(1)} line-hours; the most of any other: ${most.toFixed(1)}`,
    );
    expect(lineHours(WHOLE)).toBeGreaterThan(4 * most);
    expect(lineHours(WHOLE)).toBeCloseTo(14.6, 1);
    expect(F.unlockedBy(WHOLE)).toEqual([
      {
        is: "tool",
        tool: "whole",
        name: "A plan of the whole yard",
        says: "Select can save the whole yard as a blueprint, of every piece in it, and put it back where it was.",
      },
    ]);
  });

  test("gates keeping the whole yard and putting a plan of it back: before it is known, both are refused as locked", () => {
    const y = lines();
    must(y, { do: "saveYard", slot: 0 });
    y.done = y.done.filter((g) => g !== WHOLE);
    F.reopen(y);
    const locked = { refused: F.LOCKED, why: "A plan of the whole yard is not unlocked yet" };
    expect(give(y, { do: "saveYard", slot: 1 })).toEqual(locked);
    must(y, { do: "clear", tiles: all(y) });
    const text = F.encode(y);
    expect(give(y, place(0))).toEqual({ refused: "cannot_place_blueprint", why: locked.why });
    expect(F.encode(y)).toBe(text);
  });
});

describe("saving the whole yard", () => {
  test("keeps every piece on its own tiles, however many and however far apart, and reads back as a plan of the whole yard", () => {
    const y = lines();
    must(y, { do: "saveYard", slot: 2 });
    const print = y.blueprints[2];
    expect(print?.whole).toBe(true);
    expect(F.piecesOf(print?.pieces ?? new Uint8Array())).toEqual(F.piecesAt(y, all(y)));
    // More than the box a blueprint of an area may cover: the depot's lines reach from 19 to 30 across.
    expect(F.boxOf(F.piecesAt(y, all(y))).w).toBeGreaterThan(10);
    const back = F.decode(F.encode(y), y.land);
    expect(back?.blueprints[2]).toEqual(print);
    // Kept as a plain blueprint of the same bytes, it is another yard: the check tells them apart.
    const plain = F.decode(F.encode(y), y.land);
    if (!plain || !print) throw new Error("the yard does not read back");
    plain.blueprints[2] = { pieces: print.pieces, whole: false };
    expect(F.check(plain)).not.toBe(F.check(y));
  });

  test("is refused with nothing standing, and in a place the yard has not got", () => {
    const y = everything();
    expect(give(y, { do: "saveYard", slot: 0 })).toEqual({
      refused: "cannot_save_blueprint",
      why: "There is nothing here to save",
    });
    must(y, { do: "build", kind: "mill", ...near(-3, -3), dir: 0 });
    expect(give(y, { do: "saveYard", slot: F.BLUEPRINTS_MOST - 1 })).not.toHaveProperty("refused");
    expect(F.readCommand({ tick: 0, do: "saveYard", slot: F.BLUEPRINTS_MOST })).toBeNull();
  });
});

describe("putting a plan of the whole yard back", () => {
  test("onto a bare yard stands every piece as it was saved, for what taking them away gave back", () => {
    const y = lines();
    const saved = settings(y, false);
    const hand = toHand(y);
    must(y, { do: "saveYard", slot: 0 });
    const cleared = give(y, { do: "clear", tiles: all(y) });
    const did = give(y, place(0));
    expect(settings(y, false)).toBe(saved);
    // The pieces to hand stand again as such, wherever the plan puts the first of each.
    expect(toHand(y)).toEqual(hand);
    expect(coinsOf(did)).toBe(-coinsOf(cleared));
    expect(F.check(y)).toBe(F.check(F.decode(F.encode(y), y.land) ?? F.create()));
  });

  test("over a different yard: what stands as the plan has it stays, with what it holds; only the rest is taken up and stood, for the net of their prices", () => {
    const y = lines();
    must(y, { do: "saveYard", slot: 1 });
    const saved = settings(y, false);
    // A while on something else: the ore line taken up, a bench and a belt where it was, the plank line kept.
    must(y, { do: "remove", ...near(6, -4) });
    must(y, { do: "remove", ...near(5, -4) });
    must(y, { do: "build", kind: "bench", ...near(6, -4), dir: 1 });
    must(y, { do: "build", kind: "belt", ...near(5, -4), dir: 1, grade: 3 });
    for (let k = 0; k < 120; k++) F.step(y);
    const mill = holding(y, ...xy(5, 2));
    const print = y.blueprints[1];
    if (!print) throw new Error("no plan");
    const plan = F.yardPlan(y, print);
    expect(plan.up.map((p) => [F.kindName(p.kind), p.x, p.y])).toEqual([
      ["belt", ...xy(5, -4)],
      ["bench", ...xy(6, -4)],
    ]);
    expect(plan.stood.map((p) => [F.kindName(p.kind), p.x, p.y])).toEqual([
      ["crate", ...xy(5, -4)],
      ["gatherer", ...xy(6, -4)],
    ]);
    // A belt III and a bench back, a crate and a gatherer stood.
    const net = F.price(F.CRATE, 1) + F.price(F.GATHERER, 1) - F.price(F.BELT, 3) - F.price(F.BENCH, 1);
    expect(plan.price).toBe(net);
    const did = give(y, place(1));
    expect([coinsOf(did), settings(y, false)]).toEqual([-net, saved]);
    expect(holding(y, ...xy(5, 2))).toEqual(mill);
  });

  test("gives back what the yard it replaces is worth more, free, as a piece taken away does", () => {
    const y = lines();
    must(y, { do: "saveYard", slot: 0 });
    must(y, { do: "build", kind: "workshop", dir: 0, grade: 3, ...clearTile(y) });
    const did = give(y, place(0));
    if ("refused" in did) throw new Error(did.why);
    expect((did.coins ?? []).filter((c) => c.reason !== "Earned in the Works")).toEqual([
      { amount: F.price(F.WORKSHOP, 3), reason: "Taken away in the Works", key: expect.any(String), free: true },
    ]);
  });

  test("is refused whole when Coins are short, saying by how many for the whole; with exactly enough it is done", () => {
    const y = lines();
    must(y, { do: "saveYard", slot: 0 });
    must(y, { do: "clear", tiles: all(y) });
    const print = y.blueprints[0];
    if (!print) throw new Error("no plan");
    const price = F.yardPlan(y, print).price;
    const till = Math.floor(y.till / F.MILLI);
    const read = F.readCommand({ tick: y.tick, ...place(0) });
    if (!read) throw new Error("does not read");
    const text = F.encode(y);
    expect(F.play(y, read, price - till - 1)).toEqual({
      refused: "cannot_place_blueprint",
      why: "Not enough Coins: 1 short",
    });
    expect(F.encode(y)).toBe(text);
    expect(F.play(y, read, price - till)).not.toHaveProperty("refused");
  });

  test("is refused whole, with nothing changed, for a piece on land the yard does not own, with the reason", () => {
    const y = everything();
    const meadow = y.land.plots.find((p) => p.plot === F.plot("meadow"));
    if (!meadow) throw new Error("no meadow");
    const i = all(y).find((t) => y.land.plot[t] === y.land.plots.indexOf(meadow) && y.land.deposit[t] === F.NONE);
    const tile = { x: (i ?? 0) % y.land.w, y: Math.floor((i ?? 0) / y.land.w) };
    must(y, { do: "build", kind: "pylon", dir: 0, ...tile });
    must(y, { do: "saveYard", slot: 0 });
    must(y, { do: "remove", ...tile });
    // The plot is not the yard's (as a tuning that sold it later would leave a yard).
    y.plots = y.plots.filter((p) => p !== meadow.plot);
    const text = F.encode(y);
    expect(give(y, place(0))).toEqual({
      refused: "cannot_place_blueprint",
      why: `${meadow.name} is not the yard's yet`,
    });
    expect(F.encode(y)).toBe(text);
  });

  test("is refused when the yard already stands as the plan has it", () => {
    const y = lines();
    must(y, { do: "saveYard", slot: 0 });
    expect(give(y, place(0))).toEqual({
      refused: "cannot_place_blueprint",
      why: "The yard already stands as this plan has it",
    });
  });

  test("stands a tunnel of another length on the same tile as new, and one of the pieces to hand as the rules use them", () => {
    const y = everything();
    must(y, { do: "build", kind: "mill", ...near(-3, -3), dir: 0 });
    must(y, { do: "lay", legs: [{ kind: "tunnel", ...near(-14, -8), dir: 0, span: 2 }] });
    must(y, { do: "saveYard", slot: 0 });
    const saved = settings(y);
    must(y, { do: "remove", ...near(-14, -8) });
    must(y, { do: "remove", ...near(-3, -3) });
    must(y, { do: "build", kind: "mill", ...near(-2, -6), dir: 1 });
    must(y, { do: "lay", legs: [{ kind: "tunnel", ...near(-14, -8), dir: 0, span: 3 }] });
    // The mill to hand stands at (22, 12) now; put back, the mill is to hand again at (21, 15).
    const before = settings(y);
    const did = give(y, place(0, "w-1"));
    expect(settings(y)).toBe(saved);
    // A tunnel back and a tunnel stood, at one price; a mill to hand taken up and stood again, for nothing.
    expect(coinsOf(did)).toBe(0);
    must(y, { do: "undo", entry: "w-1" });
    expect(settings(y)).toBe(before);
  });
});

describe("Undo of a plan of the whole yard put back", () => {
  test("stands again new a piece the placement took up, however like it what was stood in its place: a crate refilled is put back empty", () => {
    const y = lines();
    const crate = { ...near(5, -4) };
    const held = (): number => y.holders.count[F.holderOf(y, F.at(y, crate.x, crate.y))] ?? 0;
    // Kept shut in the plan, then opened: the plan takes the open crate up and stands a shut one.
    must(y, { do: "crate", open: false, ...crate });
    must(y, { do: "saveYard", slot: 0 });
    must(y, { do: "crate", open: true, ...crate });
    for (let k = 0; k < 600 && held() > 0; k++) F.step(y);
    const before = settings(y);
    must(y, { ...place(0), id: "w-1" });
    for (let k = 0; k < 6000 && held() < 40; k++) F.step(y);
    expect(held()).toBeGreaterThanOrEqual(40);
    must(y, { do: "undo", entry: "w-1" });
    expect([settings(y), held()]).toEqual([before, 0]);
  });

  test("is one entry, and puts the yard back as it was, the Coins the other way", () => {
    const y = lines();
    must(y, { do: "saveYard", slot: 1 });
    must(y, { do: "remove", ...near(6, -4) });
    must(y, { do: "remove", ...near(5, -4) });
    must(y, { do: "build", kind: "bench", ...near(6, -4), dir: 1 });
    must(y, { do: "build", kind: "workshop", dir: 0, grade: 2, ...clearTile(y) });
    for (let k = 0; k < 60; k++) F.step(y);
    const before = settings(y);
    const did = give(y, place(1, "w-1"));
    expect(y.history.at(-1)?.id).toBe("w-1");
    const undone = give(y, { do: "undo", entry: "w-1" });
    expect(settings(y)).toBe(before);
    expect(coinsOf(undone)).toBe(-coinsOf(did));
    expect(y.history.map((e) => e.id)).not.toContain("w-1");
  });
});

/**
 * The largest yard a player can have: every goal done, every plot bought, a piece on every tile one
 * may stand on, each of the kind whose settings take the most bytes (a sorter III, coloured, set to a
 * thing and sent right). A plan of a yard of nothing but belts put back over it changes every tile.
 */
function fullOf(kind: "sorter" | "belt"): F.Yard {
  const y = everything();
  for (const i of all(y)) {
    const [x, z] = [i % y.land.w, Math.floor(i / y.land.w)];
    if (kind === "belt") F.build(y, F.BELT, x, z, 0, Infinity);
    else if (F.build(y, F.SORTER, x, z, 1, Infinity, { grade: 3, right: true }).ok) {
      y.tint[i] = 1 + (i % 6);
      F.setSort(y, x, z, F.item("plank"));
    }
  }
  y.history = [];
  return y;
}

describe("the history, for the largest yard", () => {
  test("holds a plan of the whole yard put back over the largest yard a player can have, every tile changed, two of them and more, the oldest let go by bytes", () => {
    const sorters = fullOf("sorter");
    const belts = fullOf("belt");
    must(sorters, { do: "saveYard", slot: 0 });
    must(belts, { do: "saveYard", slot: 1 });
    const pieces = F.piecesAt(sorters, all(sorters)).length;
    sorters.blueprints[1] = belts.blueprints[1] ?? null;
    // The yard as kept with nothing of this: no plan and no history.
    const bare = F.decode(F.encode(sorters), sorters.land);
    if (!bare) throw new Error("does not read back");
    bare.blueprints = bare.blueprints.map(() => null);
    // The belts put back over the sorters, which their entry keeps every setting of: the largest entry there is.
    const sizes = ["a", "b", "c", "d"].map((id, k) => {
      must(sorters, { do: "placeBlueprint", slot: k % 2 === 0 ? 1 : 0, turns: 0, x: 0, y: 0, id });
      return sorters.history.at(-1)?.bytes.length ?? 0;
    });
    const [largest = 0, back = 0] = sizes;
    expect(largest).toBeLessThanOrEqual(F.UNDO_ENTRY);
    expect(sizes).toEqual([largest, back, largest, back]);
    // Two of the largest and one more fit; a fourth lets the oldest go.
    expect(2 * largest + back).toBeLessThanOrEqual(F.UNDO_BYTES);
    expect(2 * largest + 2 * back).toBeGreaterThan(F.UNDO_BYTES);
    expect(sorters.history.map((e) => e.id)).toEqual(["b", "c", "d"]);
    const kept = bytesKept(sorters);
    // Each is undone in turn, as one command: back to the belts the oldest left.
    for (const id of ["d", "c", "b"]) must(sorters, { do: "undo", entry: id });
    expect(F.piecesAt(sorters, all(sorters)).every((p) => p.kind === F.BELT)).toBe(true);
    console.log(
      [
        `the largest yard: ${pieces} pieces on ${sorters.land.w} by ${sorters.land.h} tiles, every plot`,
        `a plan of belts put back over it: an entry of ${largest} bytes (of ${F.UNDO_ENTRY}); the plan of it put back over the belts: ${back}`,
        `the yard as text: ${bytesKept(bare)} bytes with no plan and no history; with both plans and three entries, ${kept}`,
      ].join("\n"),
    );
  }, 60_000);
});
