/**
 * Undo, done by the rules (`history.ts`): one command, all of it or none, that puts back exactly
 * what was there and moves exactly the opposite Coins. Random play undone all the way back is the
 * yard it began as, byte for byte, with the Coins netting to nothing; the four things a review
 * found wrong with an Undo the page planned, each by name; the history kept with the yard, its
 * caps, and its check.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { generate } from "./gen.ts";
import { bareLand } from "./land.ts";
import { Player } from "./player.ts";
import { rng } from "./random.ts";
import { delivering, generated, give, junctions, must, saved, staged } from "./yards.ts";

type Rec = Record<string, unknown>;

/** A yard of its lines laid, with nothing yet to undo. */
function laid(seed = 1): F.Yard {
  const y = delivering(seed);
  y.history = [];
  return y;
}

/** Every plot the slice sells with the generator's pieces on it, tier 4 open (where an area may be upgraded), and nothing yet to undo. */
function large(): F.Yard {
  const plots = F.PLOT_IDS.filter((p) => p !== "yard");
  const buy = (gen: { cmd: (c: Rec) => boolean }): void => {
    for (const plot of plots) gen.cmd({ do: "buyPlot", plot });
  };
  const y = generate(F.LAND, 600, 20_261_122, buy, F.create({ seed: 20_261_122, tier: 4 })).y;
  y.history = [];
  return y;
}

/** The commands with an Undo. */
const UNDONE: ReadonlySet<string> = new Set([
  "build",
  "lay",
  "stand",
  "placeBlueprint",
  "move",
  "copy",
  "remove",
  "clear",
  "upgrade",
  "turn",
  "paint",
  "side",
  "way",
  "first",
  "wayIn",
]);

/** The Coins a command moved to the player, the till paid in with it left out. */
const coinsOf = (did: ReturnType<typeof F.play>): number =>
  "refused" in did ? 0 : (did.coins ?? []).reduce((n, c) => n + (c.reason === "Earned in the Works" ? 0 : c.amount), 0);

/** A yard as kept, but for the counts of its Coins changes and of entries kept, and what Undo would undo. */
const kept = (y: F.Yard): string => F.encode({ ...y, bank: 0, history: [], entries: 0 });

/** Says the yard is in the form reading it back gives: the same text, and the same check. */
function readsBack(y: F.Yard): void {
  const back = F.decode(F.encode(y), y.land);
  expect(back && [F.encode(back), F.check(back)]).toEqual([F.encode(y), F.check(y)]);
}

/** Plays a command at the yard's tick with `purse` Coins to spend; one that does not read throws. */
function play(y: F.Yard, c: Rec, purse = Infinity): ReturnType<typeof F.play> {
  const read = F.readCommand({ tick: y.tick, ...c });
  if (!read) throw new Error(`${JSON.stringify(c)} does not read`);
  return F.play(y, read, purse);
}
/** Undoes the newest entry with `purse` Coins to spend. */
const undo = (y: F.Yard, purse = Infinity): ReturnType<typeof F.play> =>
  play(y, { do: "undo", entry: y.history.at(-1)?.id ?? 0 }, purse);

/** What the Coins of a command come to with as many as it may take: what a purse must hold for it. */
function priceOf(y: F.Yard, c: Rec): number {
  const copy = F.decode(F.encode(y), y.land);
  if (!copy) throw new Error("the yard does not read back");
  return Math.max(0, -coinsOf(play(copy, c)));
}

/** How the pieces stand on every tile, and those to hand: all a command sets, and nothing ticks change. */
function standing(y: F.Yard): unknown {
  const parts = ["kind", "dir", "grade", "tint", "shut", "first", "ins", "set", "free", "span"] as const;
  const crates = [...y.kind.keys()].map((i) => (y.kind[i] === F.CRATE ? y.holders.open[F.holderOf(y, i)] : -1));
  return [...parts.map((p) => Array.from(y[p])), crates, Array.from(y.spare)];
}

/**
 * Random play of commands with an Undo, each with a purse of just what it costs, or now and then
 * one Coin short of it first (refused, and nothing changed), and `ticks` between; then each undone,
 * newest first, each with just the Coins it takes back, or one short of them first. Says, for each
 * entry undone, that the yard is as it was before that command: `same` compares the two. After every
 * command and every Undo the yard reads back as itself (`readsBack`), and every entry kept is undone.
 */
function undoneAll(
  start: F.Yard,
  seed: number,
  same: (now: F.Yard, was: F.Yard) => void,
  ticks: (y: F.Yard, r: () => number) => void = () => {},
): { done: number; undone: number; first: string; kinds: Set<string>; short: number } {
  // Its owner there at its last tick, with nothing in its till or to undo: only the commands move anything.
  const y = start;
  y.till = 0;
  y.history = [];
  const r = rng(seed);
  const p = new Player(y, seed, new Map());
  // Blueprints kept of what stands, to be set down.
  for (const slot of [0, 1, 2]) give(y, { do: "saveBlueprint", slot, tiles: p.box() });
  y.seen = F.here(y);
  const first = kept(y);
  const before: { yard: F.Yard; coins: number; kind: string }[] = [];
  for (let k = 0; k < 600 && before.length < 18; k++) {
    const c = p.command();
    if (!UNDONE.has(String(c.do)) || !F.readCommand({ tick: y.tick, ...c })) continue;
    const price = priceOf(y, c);
    if (price > 0 && r() < 0.3) {
      const was = F.encode(y);
      expect(play(y, c, price - 1)).toMatchObject({ refused: expect.any(String) });
      expect(F.encode(y)).toBe(was);
    }
    const copy = F.decode(F.encode(y), y.land);
    const [top, length] = [y.history.at(-1)?.id, y.history.length];
    const did = play(y, c, price);
    if ("refused" in did || !copy) continue;
    readsBack(y);
    // A command that changed nothing keeps no entry; none here is over the cap.
    if (y.history.at(-1)?.id !== top || y.history.length !== length)
      before.push({ yard: copy, coins: coinsOf(did), kind: String(c.do) });
    expect(y.history.length).toBe(before.length);
    ticks(y, r);
  }
  let undone = 0;
  let net = 0;
  let shorts = 0;
  const kinds = new Set<string>();
  while (y.history.length > 0) {
    const was = before.at(-1 - undone);
    const free = undo(y, 0);
    const short = "refused" in free ? /^Not enough Coins: (\d+) short$/.exec(free.why) : null;
    const need = Number(short?.[1] ?? 0);
    // Refused for nothing but Coins, ever.
    expect("refused" in free && !short ? free.why : null).toBeNull();
    if (short) {
      shorts++;
      const text = F.encode(y);
      if (r() < 0.5) expect(undo(y, need - 1)).toMatchObject({ refused: "cannot_undo" });
      expect(F.encode(y)).toBe(text);
    }
    const did = short ? undo(y, need) : free;
    expect(did).not.toHaveProperty("refused");
    if (!was) throw new Error("an entry with no command");
    readsBack(y);
    same(y, was.yard);
    net += was.coins + coinsOf(did);
    kinds.add(was.kind);
    undone++;
  }
  // What was done and undone moved no Coins in all.
  expect(net).toBe(0);
  return { done: before.length, undone, first, kinds, short: shorts };
}

describe("Undo", () => {
  test("random play undone all the way back is the yard it began as, byte for byte, the Coins netting to nothing", () => {
    let undone = 0;
    let short = 0;
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 18; seed++) {
      // Pieces to hand, some standing and some not: a yard begun, one with its lines laid, and one
      // with every kind of meeting of lines (splitters, sorters, joiners, tunnels).
      const start = [F.create({ seed, tier: 4 }), delivering(seed), junctions()][seed % 3] ?? delivering(seed);
      if (seed % 3 === 0) must(start, { do: "build", kind: "gatherer", x: 19, y: 15, dir: 0 });
      const got = undoneAll(start, seed, (now, was) => {
        expect(kept(now)).toBe(kept(was));
        expect(Array.from(now.spare)).toEqual(Array.from(was.spare));
        expect(F.check({ ...now, bank: 0, history: [], entries: 0 })).toBe(
          F.check({ ...was, bank: 0, history: [], entries: 0 }),
        );
      });
      expect(got.undone).toBe(got.done);
      expect(kept(start)).toBe(got.first);
      undone += got.undone;
      short += got.short;
      for (const k of got.kinds) kinds.add(k);
    }
    expect(undone).toBeGreaterThan(100);
    expect(short).toBeGreaterThan(10);
    expect([...kinds]).toEqual(
      // A run of belt and a copy are seldom done at random: the next test does them.
      expect.arrayContaining([
        "build",
        "stand",
        "placeBlueprint",
        "move",
        "remove",
        "clear",
        "upgrade",
        "turn",
        "paint",
        "way",
        "first",
        "wayIn",
      ]),
    );
  });

  test("a splitter's ways shut, put first and turned in, and a sorter's side, undone one at a time, are as they were, its next way in too", () => {
    const y = junctions();
    y.history = [];
    y.seen = F.here(y);
    const first = kept(y);
    for (const c of [
      { do: "side", right: false, x: 21, y: 21 },
      { do: "way", way: 0, open: false, x: 28, y: 13 },
      { do: "first", way: null, x: 28, y: 13 },
      { do: "wayIn", way: 2, on: false, x: 28, y: 13 },
      { do: "turn", dir: 1, x: 14, y: 20 },
    ]) {
      const was = kept(y);
      must(y, c);
      expect(kept(y)).not.toBe(was);
    }
    for (let k = 0; k < 5; k++) expect(undo(y)).not.toHaveProperty("refused");
    expect(kept(y)).toBe(first);
  });

  test("a run of belt, a tunnel and a copy, undone newest first, are taken away again, the Coins netting to nothing", () => {
    const y = laid();
    y.till = 0;
    y.seen = F.here(y);
    const first = kept(y);
    const { w, h } = y.land;
    const tiles = [...Array(w * h).keys()];
    const may = (k: F.Kind, i: number, d = 0): boolean =>
      F.refusal(y, k, i % w, Math.floor(i / w), Infinity, d) === null;
    // A run of belt from bare ground to bare ground three tiles east.
    const legs = tiles
      .filter((i) => may(F.BELT, i) && may(F.BELT, i + 3))
      .map((i) => F.route(y, [i % w, Math.floor(i / w)], [(i % w) + 3, Math.floor(i / w)]))
      .find((l) => l !== null && l.length > 0);
    const xy = (i: number): Rec => ({ x: i % w, y: Math.floor(i / w) });
    // Each on bare ground as the yard stands once the one before is done.
    const tunnel = (): number =>
      tiles.find((i) => may(F.TUNNEL, i) && F.tunnelExit(y, i % w, Math.floor(i / w), 0)) ?? 0;
    const to = (): number => tiles.find((i) => may(F.CRATE, i, 2)) ?? 0;
    let net = 0;
    for (const c of [
      () => F.writeAct({ do: "lay", legs: legs ?? [] }),
      () => ({ do: "build", kind: "tunnel", dir: 0, ...xy(tunnel()) }),
      () => ({ do: "copy", tiles: [F.at(y, 29, 14)], turns: 0, ...xy(to()) }),
    ]) {
      const did = give(y, c());
      expect(did).not.toHaveProperty("refused");
      net += coinsOf(did);
    }
    expect([y.history.length, net < 0]).toEqual([3, true]);
    for (let k = 0; k < 3; k++) net += coinsOf(undo(y));
    expect([kept(y), net]).toEqual([first, 0]);
  });

  test("with the yard running between, every Undo is done and puts back how every piece stood: ticks change no piece", () => {
    for (const seed of [11, 12, 13]) {
      const got = undoneAll(
        delivering(seed),
        seed,
        (now, was) => expect(standing(now)).toEqual(standing(was)),
        (y, r) => {
          for (let t = Math.floor(r() * 120); t > 0; t--) F.step(y);
        },
      );
      expect(got.undone).toBe(got.done);
    }
  });

  test("the till is counted once: a purse and the till's whole Coins pay for it exactly, and a Coin less is short by one", () => {
    const y = F.create({ seed: 1 });
    must(y, { do: "build", kind: "mill", x: 21, y: 15, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 24, y: 12, dir: 0 });
    must(y, { do: "remove", x: 24, y: 12 });
    // 5 whole Coins and a part in the till: with 14 in the purse, 19 of the 20 to take back.
    y.till = 5 * F.MILLI + 400;
    expect(undo(y, 14)).toEqual({ refused: "cannot_undo", why: "Not enough Coins: 1 short" });
    const did = undo(y, 15);
    expect("refused" in did ? did : (did.coins ?? []).map((c) => [c.amount, c.reason, c.free === true])).toEqual([
      [5, "Earned in the Works", true],
      [-20, "Undone in the Works", false],
    ]);
    expect(y.till).toBe(400);
  });

  test("short of Coins, the whole Undo is refused and nothing of it is done; with enough, all of it is, as one command", () => {
    const y = laid();
    y.till = 0;
    const tiles = F.within(y, 27, 13, 31, 15);
    const pieces = F.piecesAt(y, tiles).length;
    const gave = coinsOf(play(y, { do: "clear", tiles }));
    expect([pieces > 2, gave > 0]).toEqual([true, true]);
    const text = F.encode(y);
    expect(undo(y, gave - 1)).toMatchObject({ refused: "cannot_undo" });
    expect(F.encode(y)).toBe(text);
    const did = undo(y, gave);
    expect("refused" in did ? did : (did.coins ?? []).map((c) => c.amount)).toEqual([-gave]);
    expect(F.piecesAt(y, tiles).length).toBe(pieces);
  });

  test("short of Coins, it says how many for the whole Undo, not for one piece of it", () => {
    const y = F.create({ seed: 1, tier: 4 });
    // The mill to hand first, then two paid for, 20 Coins each, taken away together.
    must(y, { do: "build", kind: "mill", x: 21, y: 15, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 24, y: 12, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 25, y: 12, dir: 0 });
    expect(coinsOf(play(y, { do: "clear", tiles: [F.at(y, 24, 12), F.at(y, 25, 12)] }))).toBe(40);
    expect(undo(y, 16)).toEqual({ refused: "cannot_undo", why: "Not enough Coins: 24 short" });
    expect(undo(y, 16)).toEqual({ refused: "cannot_undo", why: "Not enough Coins: 24 short" });
    expect(undo(y, 40)).not.toHaveProperty("refused");
  });

  test("the mill to hand comes back to hand, and the paid one paid for: undone, neither swaps with the other", () => {
    const y = F.create({ seed: 1 });
    const hand = F.at(y, 21, 15);
    const paid = F.at(y, 24, 12);
    must(y, { do: "build", kind: "mill", x: 21, y: 15, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 24, y: 12, dir: 0 });
    expect([y.free[hand], y.free[paid], y.spare[F.MILL]]).toEqual([1, 0, 0]);
    // Taken away one at a time, the paid one first: only it gives Coins back.
    expect(coinsOf(play(y, { do: "remove", x: 24, y: 12 }))).toBe(20);
    expect(coinsOf(play(y, { do: "remove", x: 21, y: 15 }))).toBe(0);
    expect(y.spare[F.MILL]).toBe(1);
    expect(coinsOf(undo(y))).toBe(0);
    expect(coinsOf(undo(y))).toBe(-20);
    expect([y.free[hand], y.free[paid], y.spare[F.MILL]]).toEqual([1, 0, 0]);
    // And so taking them away again gives back what it gave the first time.
    expect(coinsOf(play(y, { do: "remove", x: 21, y: 15 }))).toBe(0);
    expect(coinsOf(play(y, { do: "remove", x: 24, y: 12 }))).toBe(20);
  });
});

describe("what Undo puts back", () => {
  test("a piece taken away comes back with what it held; pieces moved go back with what they hold now, never with what they held", () => {
    const y = laid();
    const crate = F.at(y, 29, 14);
    const plank = F.item("plank");
    const r = F.holderOf(y, crate);
    for (let k = 0; k < 6; k++) F.put(y.holders, r, plank);
    const holds = (i: number): number => F.held(y.holders, F.holderOf(y, i), plank);
    const had = holds(crate);
    must(y, { do: "remove", x: 29, y: 14 });
    undo(y);
    expect(holds(crate)).toBe(had);
    // Moved to bare ground, then emptied: moved back, it holds what it holds now.
    const to =
      [...y.kind.keys()].find(
        (i) => F.refusal(y, F.CRATE, i % y.land.w, Math.floor(i / y.land.w), Infinity, 2) === null,
      ) ?? 0;
    const there = { x: to % y.land.w, y: Math.floor(to / y.land.w) };
    must(y, { do: "move", tiles: [crate], turns: 0, ...there });
    must(y, { do: "tipOut", item: null, ...there });
    expect(undo(y)).not.toHaveProperty("refused");
    expect([y.kind[crate], holds(crate)]).toEqual([F.CRATE, 0]);
  });

  test("a stroke of the brush is one entry: each command after the first says the entry it adds to, and one Undo puts every line back", () => {
    const y = laid();
    const belts = [...y.kind.keys()].filter((i) => y.kind[i] === F.BELT);
    const lines = [...new Set(belts.map((i) => F.lineOf(y, i)[0] ?? i))].slice(0, 3);
    const tints = lines.map((i) => y.tint[i]);
    const xy = (i: number): Rec => ({ x: i % y.land.w, y: Math.floor(i / y.land.w) });
    const [a = 0, b = 0, c = 0] = lines;
    must(y, { do: "paint", tint: 4, ...xy(a) });
    must(y, { do: "paint", tint: 4, onto: y.history.at(-1)?.id, ...xy(b) });
    must(y, { do: "paint", tint: 4, onto: y.history.at(-1)?.id, ...xy(c) });
    expect(y.history.length).toBe(1);
    // A stroke saying an entry that is not the newest begins one of its own.
    must(y, { do: "paint", tint: 5, onto: 12_345, ...xy(a) });
    expect(y.history.length).toBe(2);
    undo(y);
    undo(y);
    expect(lines.map((i) => y.tint[i])).toEqual(tints);
  });

  test("a command with no Undo that changes a piece or the Coins forgets them all; one that does not, keeps them", () => {
    const y = laid();
    must(y, { do: "turn", x: 29, y: 20, dir: 1 });
    F.put(y.holders, F.holderOf(y, F.at(y, 29, 14)), F.item("plank"));
    must(y, { do: "tipOut", item: null, x: 29, y: 14 });
    must(y, { do: "collect" });
    expect(y.history.length).toBe(1);
    must(y, { do: "crate", open: false, x: 29, y: 14 });
    expect(y.history).toEqual([]);
  });
});

describe("the history", () => {
  test("is kept with the yard, and a yard kept before it had one reads with none", () => {
    const y = laid();
    must(y, { do: "turn", x: 29, y: 20, dir: 1 });
    const back = F.decode(F.encode(y), y.land);
    expect(back?.history).toEqual(y.history);
    for (const name of ["v7-small", "v7-mid", "v6-mid"] as const) {
      const old = saved(name);
      expect([old.history, "history" in JSON.parse(F.encode(old))]).toEqual([[], false]);
    }
    // One entry that is not one, and the yard reads all the same, with none.
    const raw = { ...JSON.parse(F.encode(y)), history: ["AAAA", "nope"] };
    expect(F.decode(JSON.stringify(raw), y.land)?.history).toEqual([]);
  });

  test("is undone newest first: an Undo for another entry than the newest, as another tab would send, is refused", () => {
    const y = laid();
    must(y, { do: "turn", x: 29, y: 20, dir: 1 });
    const first = y.history.at(-1)?.id ?? 0;
    must(y, { do: "turn", x: 29, y: 20, dir: 2 });
    expect(play(y, { do: "undo", entry: first })).toEqual({
      refused: "cannot_undo",
      why: "Cannot undo: that is no longer the last thing done",
    });
    expect(play(y, { do: "undo", entry: y.history.at(-1)?.id })).not.toHaveProperty("refused");
    expect(play(y, { do: "undo", entry: first })).not.toHaveProperty("refused");
    expect(undo(y)).toEqual({ refused: "cannot_undo", why: "Nothing to undo" });
  });

  test("refuses an entry that no longer matches the yard: it never happens in play, and here a piece is turned behind the rules' back", () => {
    const y = laid();
    must(y, { do: "turn", x: 29, y: 20, dir: 1 });
    y.dir[F.at(y, 29, 20)] = 3;
    const text = F.encode(y);
    expect(undo(y)).toEqual({ refused: "cannot_undo", why: "Cannot undo: it has changed since" });
    expect(F.encode(y)).toBe(text);
  });

  test("keeps 20 entries at most and 4,096 bytes in all, the oldest let go first", () => {
    const y = F.create({ seed: 1, tier: 4 });
    must(y, { do: "build", kind: "splitter", x: 24, y: 12, dir: 0 });
    for (let k = 0; k < 30; k++) must(y, { do: "turn", x: 24, y: 12, dir: (k + 1) % 4 });
    expect(y.history.length).toBe(F.UNDO_MOST);
    for (let k = 0; k < F.UNDO_MOST; k++) undo(y);
    // The oldest ten turns and the splitter were let go: it faces as the tenth turn left it.
    expect([y.history.length, y.dir[F.at(y, 24, 12)]]).toEqual([0, 10 % 4]);
    const many = large();
    must(many, { do: "upgrade", tiles: F.within(many, 0, 0, many.land.w, many.land.h) });
    must(many, { do: "turn", x: 24, y: 12, dir: 0 });
    expect(many.history.reduce((n, e) => n + e.bytes.length, 0)).toBeLessThanOrEqual(F.UNDO_BYTES);
  });

  test("a command whose own entry is over the cap is done, and Undo then says it cannot undo that", () => {
    const y = generated().y;
    const g = F.decode(F.encode(y), y.land);
    if (!g) throw new Error("the generated yard does not read back");
    g.history = [];
    // Every holder holding one of each thing: taken away, what they held is the entry's to keep.
    for (let r = 0; r < g.holders.size; r++) for (const n of F.ALL_ITEMS) F.put(g.holders, r, n);
    const all = F.within(g, 0, 0, g.land.w, g.land.h);
    must(g, { do: "clear", tiles: all });
    expect(F.piecesAt(g, all)).toEqual([]);
    expect(undo(g)).toEqual({ refused: "cannot_undo", why: "Cannot undo: that changed too much at once" });
    expect(give(g, { do: "undo", entry: g.history.at(-1)?.id })).toMatchObject({ refused: "cannot_undo" });
  });
});

describe("an entry's id", () => {
  test("names the action, not what it did: a stroke on two copies of the yard a tick apart is one entry on both, under one id", () => {
    const page = laid();
    const leaf = F.decode(F.encode(page), page.land);
    if (!leaf) throw new Error("the yard does not read back");
    const lines = [
      ...new Set([...page.kind.keys()].filter((i) => page.kind[i] === F.BELT).map((i) => F.lineOf(page, i)[0] ?? i)),
    ];
    const xy = (i: number): Rec => ({ x: i % page.land.w, y: Math.floor(i / page.land.w) });
    const [a = 0, b = 0] = lines;
    // Leaf does each command a tick later than the page did: what the belts carry has moved on.
    for (const [y, late] of [
      [page, 0],
      [leaf, 1],
    ] as const) {
      for (let t = 0; t < late; t++) F.step(y);
      must(y, { do: "paint", tint: 3, ...xy(a) });
    }
    const id = page.history.at(-1)?.id;
    expect(leaf.history.at(-1)?.id).toBe(id);
    for (const y of [page, leaf]) must(y, { do: "paint", tint: 3, onto: id, ...xy(b) });
    expect([page.history.length, leaf.history.length, leaf.history.at(-1)?.id]).toEqual([1, 1, id]);
  });

  test("a stale tab's Undo of a mill since undone and built again is refused: the mill built again stands", () => {
    const y = F.create({ seed: 1 });
    must(y, { do: "build", kind: "mill", x: 21, y: 15, dir: 0 });
    const stale = y.history.at(-1)?.id;
    // Another tab undoes the mill and builds it again, the same mill on the same tile the same way.
    expect(undo(y)).not.toHaveProperty("refused");
    must(y, { do: "build", kind: "mill", x: 21, y: 15, dir: 0 });
    expect(y.history.at(-1)?.id).not.toBe(stale);
    expect(play(y, { do: "undo", entry: stale })).toEqual({
      refused: "cannot_undo",
      why: "Cannot undo: that is no longer the last thing done",
    });
    expect(y.kind[F.at(y, 21, 15)]).toBe(F.MILL);
  });

  test("goes on counting when there is nothing left to undo, as read back: an entry never takes an id used before", () => {
    const y = F.create({ seed: 1 });
    must(y, { do: "build", kind: "mill", x: 21, y: 15, dir: 0 });
    undo(y);
    const back = F.decode(F.encode(y), y.land);
    if (!back) throw new Error("the yard does not read back");
    expect([back.history, back.entries]).toEqual([[], 1]);
    must(back, { do: "build", kind: "mill", x: 21, y: 15, dir: 0 });
    expect(back.history.at(-1)?.id).toBe(2);
  });
});

describe("a stroke of the brush", () => {
  test("over the cap stays one entry, under its id, that cannot be undone: no line of it is undone", () => {
    const y = F.create({ land: bareLand(64, 64, [], [62, 62]), tier: 4, seed: 1 });
    const rows = Array.from({ length: 30 }, (_, k) => 2 * k);
    for (const z of rows) for (let x = 0; x < 56; x++) F.build(y, F.BELT, x, z, 0, Infinity);
    must(y, { do: "paint", tint: 2, x: 0, y: 0 });
    const id = y.history.at(-1)?.id;
    for (const z of rows.slice(1)) must(y, { do: "paint", tint: 2, onto: id, x: 0, y: z });
    expect([y.history.length, y.history.at(-1)?.id]).toEqual([1, id]);
    expect(undo(y)).toEqual({ refused: "cannot_undo", why: "Cannot undo: that changed too much at once" });
    expect(rows.every((z) => y.tint[F.at(y, 30, z)] === 2)).toBe(true);
  });

  test("undone sets back the colour alone: a splitter's next way out is as the yard left it", () => {
    const y = junctions();
    y.history = [];
    const splitter = F.at(y, 28, 13);
    must(y, { do: "paint", tint: 5, x: 28, y: 13 });
    let ran = 0;
    for (const turn = y.turn[splitter]; y.turn[splitter] === turn && ran < 600; ran++) F.step(y);
    const turn = y.turn[splitter];
    expect(ran).toBeLessThan(600);
    expect(undo(y)).not.toHaveProperty("refused");
    expect([y.tint[splitter], y.turn[splitter]]).toEqual([0, turn]);
  });
});

describe("a piece stood again", () => {
  test("gets back what it held, and its work only as the yard lets it be now: a Study's on research taken out of line is let go", () => {
    const y = staged("study");
    y.history = [];
    const i = [...y.kind.keys()].find((t) => y.kind[t] === F.STUDY) ?? -1;
    const r = (): number => F.holderOf(y, i);
    for (let k = 0; k < 600 && (y.holders.work[r()] ?? 0) === 0; k++) F.step(y);
    const folios = (): number => y.holders.count[r()] ?? 0;
    const was = { folios: folios(), making: y.holders.making[r()], work: y.holders.work[r()] };
    expect([was.making !== F.NONE, (was.work ?? 0) > 0]).toEqual([true, true]);
    const xy = { x: i % y.land.w, y: Math.floor(i / y.land.w) };
    // Taken away and undone at once, it is as it was, at work.
    must(y, { do: "remove", ...xy });
    undo(y);
    expect({ folios: folios(), making: y.holders.making[r()], work: y.holders.work[r()] }).toEqual(was);
    // Taken away, its research taken out of line, and undone: its folios, and no work.
    must(y, { do: "remove", ...xy });
    while (y.line.length > 0) must(y, { do: "unstudy", research: F.GOALS[y.line[0] ?? 0]?.id });
    expect(undo(y)).not.toHaveProperty("refused");
    expect([folios(), y.holders.making[r()], y.holders.work[r()]]).toEqual([was.folios, F.NONE, 0]);
    readsBack(y);
  });
});
