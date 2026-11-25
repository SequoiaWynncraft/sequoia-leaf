/**
 * Undo, done by the rules (`history.ts`): one command, all of it or none, that puts back what the
 * player set and moves exactly the opposite Coins. Random play undone all the way back stands as it
 * began, each Undo moving back just the Coins its command moved, the yard's running state its own
 * but on pieces stood again, which stand as new; what reviews found wrong, each by name; the history
 * kept with the yard, its caps, and its check.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { generate } from "./gen.ts";
import { bareLand } from "./land.ts";
import { Player } from "./player.ts";
import { rng } from "./random.ts";
import { delivering, give, junctions, must, saved, staged } from "./yards.ts";

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

/** Plays a command at the yard's tick with `purse` Coins to spend; one that does not read throws. */
function play(y: F.Yard, c: Rec, purse = Infinity): ReturnType<typeof F.play> {
  const read = F.readCommand({ tick: y.tick, ...c });
  if (!read) throw new Error(`${JSON.stringify(c)} does not read`);
  return F.play(y, read, purse);
}
/** Undoes the newest entry with `purse` Coins to spend. */
const undo = (y: F.Yard, purse = Infinity): ReturnType<typeof F.play> =>
  play(y, { do: "undo", entry: y.history.at(-1)?.id ?? "" }, purse);

/** What the Coins of a command come to with as many as it may take: what a purse must hold for it. */
function priceOf(y: F.Yard, c: Rec): number {
  const copy = F.decode(F.encode(y), y.land);
  if (!copy) throw new Error("the yard does not read back");
  return Math.max(0, -coinsOf(play(copy, c)));
}

/** Says the yard is in the form reading it back gives: the same text, and the same check. */
function readsBack(y: F.Yard): void {
  const back = F.decode(F.encode(y), y.land);
  expect(back && [F.encode(back), F.check(back)]).toEqual([F.encode(y), F.check(y)]);
}

/** How every piece stands, as the player set it, and the pieces to hand: all Undo puts back. */
function settings(y: F.Yard): string {
  const pieces = [...y.kind.keys()].flatMap((i) =>
    F.isKind(y.kind[i] ?? F.NONE) ? [[i, y.kind[i], y.dir[i], y.span[i], y.free[i], F.keptAt(y, i)]] : [],
  );
  return JSON.stringify([pieces, Array.from(y.spare)]);
}

/** What the piece on a tile carries, holds and is doing: its running state, none of which Undo sets. */
function running(y: F.Yard, i: number, cursor = true): unknown {
  const r = F.holderOf(y, i);
  const h = y.holders;
  const t = F.tunnelOf(y, i);
  const holds =
    r < 0 ? [] : [h.out[r], h.making[r], h.work[r], h.fuel[r], h.count[r], ...F.ALL_ITEMS.map((n) => F.held(h, r, n))];
  const under = t < 0 ? [] : Array.from(y.tunnels.under.subarray(t * F.SPAN_MOST, (t + 1) * F.SPAN_MOST));
  return [y.item[i], y.prog[i], y.via[i], (y.turn[i] ?? 0) & (cursor ? 255 : 3), holds, under];
}

/** Whether the piece on a tile is as one new-stood: carrying, holding and doing nothing. */
function isNew(y: F.Yard, i: number): boolean {
  const r = F.holderOf(y, i);
  const h = y.holders;
  const empty = r < 0 || (h.count[r] === 0 && h.out[r] === F.NONE && h.making[r] === F.NONE && h.work[r] === 0);
  return y.item[i] === F.NONE && y.prog[i] === 0 && y.turn[i] === 0 && empty;
}

/**
 * Says an Undo left the yard's running state its own: unchanged on every piece that stands where it
 * stood (but for a splitter's next way in, which goes with its last way in), and every piece stood
 * again new. Pieces moved back carry what they carried: every piece of the yard, wherever it stands,
 * carries, holds and is doing what one did before, but for the side a thing came in from, which
 * moving forgets.
 */
function ranOn(was: F.Yard, now: F.Yard, moved: boolean): void {
  const tiles = [...now.kind.keys()];
  if (moved) {
    const carried = (y: F.Yard): string[] =>
      tiles
        .filter((i) => F.isKind(y.kind[i] ?? F.NONE))
        .map((i) => JSON.stringify([y.kind[i], Object.assign([], running(y, i), { 2: 0 })]))
        .toSorted((a, b) => a.localeCompare(b));
    expect(carried(now)).toEqual(carried(was));
    return;
  }
  for (const i of tiles.filter((t) => now.kind[t] === was.kind[t])) {
    const cursor = (now.ins[i] ?? 0) !== 0 && (was.ins[i] ?? 0) !== 0;
    expect([i, running(now, i, cursor)]).toEqual([i, running(was, i, cursor)]);
  }
  for (const i of tiles.filter((t) => now.kind[t] !== was.kind[t] && now.kind[t] !== F.NONE))
    expect([i, isNew(now, i)]).toEqual([i, true]);
}

/**
 * Random play of commands with an Undo, each under an id of its own with a purse of just what it
 * costs, or now and then one Coin short of it first (refused, and nothing changed), and `ticks`
 * between; then each undone, newest first, each with just the Coins it takes back, or one short of
 * them first. After every Undo the pieces stand as they did before its command, the Undo moved back
 * just the Coins that command moved, and the running state is the yard's own (`ranOn`). After every
 * command and every Undo the yard reads back as itself. Every entry kept is undone.
 */
function undoneAll(
  start: F.Yard,
  seed: number,
  ticks: (y: F.Yard, r: () => number) => void = () => {},
): { kinds: Set<string>; short: number; undone: number } {
  // Its owner there at its last tick, with nothing in its till or to undo: only the commands move anything.
  const y = start;
  y.till = 0;
  y.history = [];
  const r = rng(seed);
  const p = new Player(y, seed, new Map());
  // Blueprints kept of what stands, to be set down.
  for (const slot of [0, 1, 2]) give(y, { do: "saveBlueprint", slot, tiles: p.box() });
  y.seen = F.here(y);
  const first = settings(y);
  const done: { stood: string; coins: number; kind: string }[] = [];
  for (let k = 0; k < 600 && done.length < 18; k++) {
    const c: Rec = { ...p.command(), id: `c-${seed}-${k}` };
    if (!UNDONE.has(String(c.do)) || !F.readCommand({ tick: y.tick, ...c })) continue;
    const price = priceOf(y, c);
    if (price > 0 && r() < 0.3) {
      const was = F.encode(y);
      expect(play(y, c, price - 1)).toMatchObject({ refused: expect.any(String) });
      expect(F.encode(y)).toBe(was);
    }
    const stood = settings(y);
    const length = y.history.length;
    const did = play(y, c, price);
    if ("refused" in did) continue;
    readsBack(y);
    // A command that changed nothing keeps no entry; none here is over the cap.
    if (y.history.at(-1)?.id === c.id) done.push({ stood, coins: coinsOf(did), kind: String(c.do) });
    expect([y.history.length, y.history.length - length]).toEqual([done.length, y.history.at(-1)?.id === c.id ? 1 : 0]);
    ticks(y, r);
  }
  let short = 0;
  const kinds = new Set<string>();
  for (const was of done.toReversed()) {
    const copy = F.decode(F.encode(y), y.land);
    if (!copy) throw new Error("the yard does not read back");
    const free = undo(y, 0);
    const shortBy = "refused" in free ? /^Not enough Coins: (\d+) short$/.exec(free.why) : null;
    // Refused for nothing but Coins, ever.
    expect("refused" in free && !shortBy ? free.why : null).toBeNull();
    if (shortBy) {
      short++;
      const text = F.encode(y);
      if (r() < 0.5) expect(undo(y, Number(shortBy[1]) - 1)).toMatchObject({ refused: "cannot_undo" });
      expect(F.encode(y)).toBe(text);
    }
    const did = shortBy ? undo(y, Number(shortBy[1])) : free;
    expect(did).not.toHaveProperty("refused");
    readsBack(y);
    expect(settings(y)).toBe(was.stood);
    // Each Undo moves back just what its own command moved.
    expect([was.kind, coinsOf(did)]).toEqual([was.kind, 0 - was.coins]);
    ranOn(copy, y, was.kind === "move");
    kinds.add(was.kind);
  }
  expect([y.history.length, settings(y)]).toEqual([0, first]);
  return { kinds, short, undone: done.length };
}

describe("Undo", () => {
  test("random play undone all the way back stands as it began, each Undo moving back just what its command moved, the yard's running state its own", () => {
    let undone = 0;
    let short = 0;
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 18; seed++) {
      // Pieces to hand, some standing and some not: a yard begun, one with its lines laid, and one
      // with every kind of meeting of lines (splitters, sorters, joiners, tunnels).
      const start = [F.create({ seed, tier: 4 }), delivering(seed), junctions()][seed % 3] ?? delivering(seed);
      if (seed % 3 === 0) must(start, { do: "build", kind: "gatherer", x: 19, y: 15, dir: 0 });
      const got = undoneAll(start, seed);
      undone += got.undone;
      short += got.short;
      for (const k of got.kinds) kinds.add(k);
    }
    expect(undone).toBeGreaterThan(100);
    expect(short).toBeGreaterThan(10);
    expect([...kinds]).toEqual(
      // A run of belt and a copy are seldom done at random: a test below does them.
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

  test("with the yard running between, every Undo is done, its running state its own: ticks change no setting", () => {
    for (const seed of [11, 12, 13, 14]) {
      const got = undoneAll(delivering(seed), seed, (y, r) => {
        for (let t = Math.floor(r() * 120); t > 0; t--) F.step(y);
      });
      expect(got.undone).toBeGreaterThan(5);
    }
  });

  test("a splitter's ways shut, put first and turned in, and a sorter's side, undone one at a time, stand as they did", () => {
    const y = junctions();
    y.history = [];
    const first = settings(y);
    for (const c of [
      { do: "side", right: false, x: 21, y: 21 },
      { do: "way", way: 0, open: false, x: 28, y: 13 },
      { do: "first", way: null, x: 28, y: 13 },
      { do: "wayIn", way: 2, on: false, x: 28, y: 13 },
      { do: "turn", dir: 1, x: 14, y: 20 },
    ]) {
      const was = settings(y);
      must(y, c);
      expect(settings(y)).not.toBe(was);
    }
    for (let k = 0; k < 5; k++) expect(undo(y)).not.toHaveProperty("refused");
    expect(settings(y)).toBe(first);
  });

  test("a run of belt, a tunnel and a copy, undone newest first, are taken away again, the Coins netting to nothing", () => {
    const y = laid();
    y.till = 0;
    const first = settings(y);
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
    expect([settings(y), net]).toEqual([first, 0]);
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

/** The first tile of each of `n` lines of belt in a yard, no two on one line. */
function linesIn(y: F.Yard, n: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const i of y.kind.keys()) {
    if (y.kind[i] !== F.BELT || seen.has(i) || out.length >= n) continue;
    for (const j of F.lineOf(y, i)) seen.add(j);
    out.push(i);
  }
  return out;
}
const xyOf = (y: F.Yard, i: number): Rec => ({ x: i % y.land.w, y: Math.floor(i / y.land.w) });

describe("what Undo puts back", () => {
  test("a piece taken away comes back as new, holding nothing; pieces moved go back with what they hold now", () => {
    const y = laid();
    const crate = F.at(y, 29, 14);
    const plank = F.item("plank");
    for (let k = 0; k < 6; k++) F.put(y.holders, F.holderOf(y, crate), plank);
    const holds = (i: number): number => F.held(y.holders, F.holderOf(y, i), plank);
    must(y, { do: "remove", x: 29, y: 14 });
    undo(y);
    expect([y.kind[crate], holds(crate)]).toEqual([F.CRATE, 0]);
    // Holding planks again, moved to bare ground, some tipped out: moved back, it holds what it holds now.
    for (let k = 0; k < 6; k++) F.put(y.holders, F.holderOf(y, crate), plank);
    const to =
      [...y.kind.keys()].find(
        (i) => F.refusal(y, F.CRATE, i % y.land.w, Math.floor(i / y.land.w), Infinity, 2) === null,
      ) ?? 0;
    must(y, { do: "move", tiles: [crate], turns: 0, ...xyOf(y, to) });
    F.take(y.holders, F.holderOf(y, to), plank, 2);
    expect(undo(y)).not.toHaveProperty("refused");
    expect([y.kind[crate], holds(crate)]).toEqual([F.CRATE, 4]);
  });

  test("a stroke of the brush is one entry, named by its first command: each after it names it, and one Undo puts every line back", () => {
    const y = laid();
    const lines = linesIn(y, 3);
    expect(lines.length).toBe(3);
    const tints = lines.map((i) => y.tint[i]);
    const [a = 0, b = 0, c = 0] = lines;
    must(y, { do: "paint", tint: 4, ...xyOf(y, a), id: "s-1" });
    must(y, { do: "paint", tint: 4, onto: "s-1", ...xyOf(y, b), id: "s-2" });
    must(y, { do: "paint", tint: 4, onto: "s-1", ...xyOf(y, c), id: "s-3" });
    expect(y.history.map((e) => e.id)).toEqual(["s-1"]);
    // A stroke naming an entry that is not the newest begins one of its own.
    must(y, { do: "paint", tint: 5, onto: "elsewhere-1", ...xyOf(y, a), id: "s-4" });
    expect(y.history.map((e) => e.id)).toEqual(["s-1", "s-4"]);
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

  test("a splitter set down on a belt, undone after it has handed things on, gives back the belt as new: no way of a splitter's", () => {
    const y = laid();
    y.history = [];
    // A belt of the crate's line, carrying.
    const belt = [...y.kind.keys()].find((i) => y.kind[i] === F.BELT && y.item[i] !== F.NONE) ?? -1;
    must(y, { do: "build", kind: "splitter", dir: y.dir[belt], ...xyOf(y, belt) });
    let ran = 0;
    for (; y.turn[belt] === 0 && ran < 600; ran++) F.step(y);
    expect([ran < 600, y.kind[belt]]).toEqual([true, F.SPLITTER]);
    expect(undo(y)).not.toHaveProperty("refused");
    expect([y.kind[belt], y.turn[belt], y.first[belt], y.ins[belt], y.item[belt]]).toEqual([F.BELT, 0, 0, 0, F.NONE]);
    readsBack(y);
  });

  test("a joiner set down on a belt, undone after it has handled a thing, gives back the belt as new: no way of a joiner's", () => {
    const y = laid();
    const belt = [...y.kind.keys()].find((i) => y.kind[i] === F.BELT && y.item[i] !== F.NONE) ?? -1;
    must(y, { do: "build", kind: "joiner", dir: y.dir[belt], ...xyOf(y, belt) });
    let ran = 0;
    for (; y.turn[belt] === 0 && ran < 600; ran++) F.step(y);
    expect([ran < 600, y.kind[belt]]).toEqual([true, F.JOINER]);
    expect(undo(y)).not.toHaveProperty("refused");
    expect([y.kind[belt], y.turn[belt], y.first[belt], y.ins[belt]]).toEqual([F.BELT, 0, 0, 0]);
    readsBack(y);
  });
});

describe("the history", () => {
  test("is kept with the yard, and a yard kept before it had one reads with none", () => {
    const y = laid();
    must(y, { do: "turn", x: 29, y: 20, dir: 1, id: "h-1" });
    const back = F.decode(F.encode(y), y.land);
    expect(back?.history).toEqual(y.history);
    expect(back?.history.map((e) => e.id)).toEqual(["h-1"]);
    for (const name of ["v7-small", "v7-mid", "v6-mid"] as const) {
      const old = saved(name);
      expect([old.history, "history" in JSON.parse(F.encode(old))]).toEqual([[], false]);
    }
    // One entry that is not one, and the yard reads all the same, with none.
    const raw = { ...JSON.parse(F.encode(y)), history: ["AAAA", "nope"] };
    expect(F.decode(JSON.stringify(raw), y.land)?.history).toEqual([]);
  });

  test("never outlives its land: read on a map where a mill taken away would stand on the stream, there is nothing to undo, and nothing changes", () => {
    const land = bareLand(15, 9, [], [12, 4]);
    const y = F.create({ land, tier: 4, seed: 1 });
    must(y, { do: "build", kind: "mill", x: 4, y: 4, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 6, y: 4, dir: 0 });
    must(y, { do: "remove", x: 6, y: 4 });
    // The same map, but the stream runs where the mill stood.
    const water = land.water.slice();
    water[F.at(y, 6, 4)] = 1;
    const other: F.Land = { ...land, water };
    const back = F.decode(F.encode(y), other);
    if (!back) throw new Error("the yard does not read back");
    expect(back.history).toEqual([]);
    const text = F.encode(back);
    expect(undo(back)).toEqual({ refused: "cannot_undo", why: "Nothing to undo" });
    expect([F.encode(back), back.kind[F.at(back, 6, 4)]]).toEqual([text, F.NONE]);
    // On its own map, the same yard keeps its history.
    expect(F.decode(F.encode(y), land)?.history).toEqual(y.history);
  });

  test("never outlives its rules: kept under other rules (a starter allowance since lowered), there is nothing to undo, and nothing changes", () => {
    const y = F.create({ seed: 1 });
    must(y, { do: "build", kind: "mill", x: 21, y: 15, dir: 0 });
    must(y, { do: "remove", x: 21, y: 15 });
    expect(y.history.length).toBe(2);
    const rec: Rec = JSON.parse(F.encode(y));
    expect(typeof rec.stamp).toBe("string");
    const back = F.decode(JSON.stringify({ ...rec, stamp: `elsewhere.${String(rec.stamp).split(".")[1]}` }), y.land);
    if (!back) throw new Error("the yard does not read back");
    const text = F.encode(back);
    expect([back.history, undo(back)]).toEqual([[], { refused: "cannot_undo", why: "Nothing to undo" }]);
    expect([F.encode(back), back.kind[F.at(back, 21, 15)], back.spare[F.MILL]]).toEqual([text, F.NONE, 1]);
  });

  test("is undone newest first: an Undo naming another entry than the newest, as another tab would send, is refused", () => {
    const y = laid();
    must(y, { do: "turn", x: 29, y: 20, dir: 1, id: "n-1" });
    must(y, { do: "turn", x: 29, y: 20, dir: 2, id: "n-2" });
    expect(play(y, { do: "undo", entry: "n-1" })).toEqual({
      refused: "cannot_undo",
      why: "Cannot undo: that is no longer the last thing done",
    });
    expect(play(y, { do: "undo", entry: "n-2" })).not.toHaveProperty("refused");
    expect(play(y, { do: "undo", entry: "n-1" })).not.toHaveProperty("refused");
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

  test("keeps 20 entries at most and 32,768 bytes in all, the oldest let go first", () => {
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
    // A yard of four times the guild's land laid with coloured belts, every one taken away at once:
    // on the guild's land itself, every entry fits (`whole.test.ts`).
    const y = F.create({ land: bareLand(96, 72, [], [94, 70]), tier: 4, seed: 1 });
    for (let z = 0; z < 68; z++)
      for (let x = 0; x < 96; x++) if (F.build(y, F.BELT, x, z, 0, Infinity).ok) y.tint[F.at(y, x, z)] = 3;
    const all = F.within(y, 0, 0, y.land.w, y.land.h);
    // More tiles than the wire names on the guild's land: the command is given as the rules take it.
    expect(F.play(y, { do: "clear", tiles: all, tick: y.tick, id: "big-1" })).not.toHaveProperty("refused");
    expect(F.piecesAt(y, all)).toEqual([]);
    expect(y.history.map((e) => e.id)).toEqual(["big-1"]);
    expect(undo(y)).toEqual({ refused: "cannot_undo", why: "Cannot undo: that changed too much at once" });
  });
});

describe("an entry's name", () => {
  test("is the id of the command that made it: a stroke on two copies of the yard a tick apart is one entry on both, under one name", () => {
    const page = laid();
    const leaf = F.decode(F.encode(page), page.land);
    if (!leaf) throw new Error("the yard does not read back");
    const [a = 0, b = 0] = linesIn(page, 2);
    // Leaf does each command a tick later than the page did: what the belts carry has moved on.
    for (const [y, late] of [
      [page, 0],
      [leaf, 1],
    ] as const) {
      for (let t = 0; t < late; t++) F.step(y);
      must(y, { do: "paint", tint: 3, ...xyOf(y, a), id: "p-1" });
      must(y, { do: "paint", tint: 3, onto: "p-1", ...xyOf(y, b), id: "p-2" });
    }
    expect([page.history.map((e) => e.id), leaf.history.map((e) => e.id)]).toEqual([["p-1"], ["p-1"]]);
  });

  test("a stale tab's Undo of a mill since undone and built again is refused: the mill built again stands", () => {
    const y = F.create({ seed: 1 });
    must(y, { do: "build", kind: "mill", x: 21, y: 15, dir: 0, id: "a-1" });
    // Another tab undoes the mill and builds it again, the same mill on the same tile the same way.
    expect(play(y, { do: "undo", entry: "a-1", id: "b-1" })).not.toHaveProperty("refused");
    must(y, { do: "build", kind: "mill", x: 21, y: 15, dir: 0, id: "b-2" });
    expect(play(y, { do: "undo", entry: "a-1", id: "a-2" })).toEqual({
      refused: "cannot_undo",
      why: "Cannot undo: that is no longer the last thing done",
    });
    expect(y.kind[F.at(y, 21, 15)]).toBe(F.MILL);
  });

  test("an Undo naming a command that was turned down is refused: what another page built where it was aimed stands", () => {
    const y = F.create({ seed: 1 });
    must(y, { do: "build", kind: "belt", x: 21, y: 15, dir: 0, id: "a-1" });
    // The other page, not yet told of the belt, builds a mill there and undoes it.
    expect(play(y, { do: "build", kind: "mill", x: 21, y: 15, dir: 0, id: "b-1" })).toMatchObject({
      refused: "cannot_build",
    });
    expect(play(y, { do: "undo", entry: "b-1", id: "b-2" })).toEqual({
      refused: "cannot_undo",
      why: "Cannot undo: that is no longer the last thing done",
    });
    expect(y.kind[F.at(y, 21, 15)]).toBe(F.BELT);
  });
});

describe("a stroke of the brush", () => {
  test("over the cap stays one entry, under its name, that cannot be undone: no line of it is undone", () => {
    const y = F.create({ land: bareLand(128, 128, [], [126, 126]), tier: 4, seed: 1 });
    const rows = Array.from({ length: 60 }, (_, k) => 2 * k);
    for (const z of rows) for (let x = 0; x < 120; x++) F.build(y, F.BELT, x, z, 0, Infinity);
    must(y, { do: "paint", tint: 2, x: 0, y: 0, id: "s-0" });
    rows.slice(1).forEach((z, k) => must(y, { do: "paint", tint: 2, onto: "s-0", x: 0, y: z, id: `s-${k + 1}` }));
    expect(y.history.map((e) => e.id)).toEqual(["s-0"]);
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

  test("gone on over a splitter after its next way moved on keeps that move: undone, the colours go back and the splitter's next way is as the yard left it", () => {
    const y = junctions();
    y.history = [];
    const splitter = F.at(y, 28, 13);
    const [line = 0] = linesIn(y, 1);
    const tints = [y.tint[line], y.tint[splitter]];
    must(y, { do: "paint", tint: 6, ...xyOf(y, line), id: "g-1" });
    let ran = 0;
    for (const turn = y.turn[splitter]; y.turn[splitter] === turn && ran < 600; ran++) F.step(y);
    expect(ran).toBeLessThan(600);
    must(y, { do: "paint", tint: 6, onto: "g-1", x: 28, y: 13, id: "g-2" });
    for (let t = 0; t < 7; t++) F.step(y);
    const turn = y.turn[splitter];
    expect(y.history.map((e) => e.id)).toEqual(["g-1"]);
    expect(undo(y)).not.toHaveProperty("refused");
    expect([y.tint[line], y.tint[splitter], y.turn[splitter]]).toEqual([...tints, turn]);
  });
});

describe("a splitter's way turned in or out", () => {
  test("undone sets back its ways in alone: its next way out is as the yard left it", () => {
    // A splitter at (4, 4) facing east, planks coming from a crate behind it, sending them ahead and
    // to its right by turns, into shut crates; its left way turned in, then the yard run on.
    const y = F.create({ land: bareLand(15, 9, [], [12, 4]), tier: 5, seed: 1 });
    must(y, { do: "build", kind: "splitter", x: 4, y: 4, dir: 0 });
    for (const [x, z, dir] of [
      [3, 4, 0],
      [5, 4, 0],
      [4, 5, 1],
    ] as const)
      must(y, { do: "build", kind: "belt", x, y: z, dir });
    for (const [x, z] of [
      [6, 4],
      [4, 6],
    ] as const) {
      must(y, { do: "build", kind: "crate", x, y: z, dir: 0 });
      must(y, { do: "crate", x, y: z, open: false });
    }
    must(y, { do: "build", kind: "crate", x: 2, y: 4, dir: 0 });
    for (let k = 0; k < 40; k++) F.put(y.holders, F.holderOf(y, F.at(y, 2, 4)), F.item("plank"));
    const splitter = F.at(y, 4, 4);
    must(y, { do: "wayIn", way: 1, on: true, x: 4, y: 4 });
    let ran = 0;
    for (const turn = y.turn[splitter] ?? 0; ((y.turn[splitter] ?? 0) & 3) === (turn & 3) && ran < 600; ran++)
      F.step(y);
    expect(ran).toBeLessThan(600);
    const out = (y.turn[splitter] ?? 0) & 3;
    expect(undo(y)).not.toHaveProperty("refused");
    expect([y.ins[splitter], (y.turn[splitter] ?? 0) & 3]).toEqual([0, out]);
    readsBack(y);
  });
});

describe("a piece stood again", () => {
  test("is stood as new: a Study taken away mid-folio comes back holding nothing and doing nothing, and gives the research in line no work", () => {
    const y = staged("study");
    y.history = [];
    const i = [...y.kind.keys()].find((t) => y.kind[t] === F.STUDY) ?? -1;
    const r = (): number => F.holderOf(y, i);
    for (let k = 0; k < 600 && (y.holders.work[r()] ?? 0) === 0; k++) F.step(y);
    expect([(y.holders.count[r()] ?? 0) > 0, (y.holders.work[r()] ?? 0) > 0]).toEqual([true, true]);
    // Taken away, its research taken out of line, and undone.
    must(y, { do: "remove", ...xyOf(y, i) });
    while (y.line.length > 0) must(y, { do: "unstudy", research: F.GOALS[y.line[0] ?? 0]?.id });
    expect(undo(y)).not.toHaveProperty("refused");
    expect([y.kind[i], y.holders.count[r()], y.holders.making[r()], y.holders.work[r()]]).toEqual([
      F.STUDY,
      0,
      F.NONE,
      0,
    ]);
    readsBack(y);
  });

  test("is put back, not built: a paid belt coloured before the yard may paint, taken away and undone, stands again coloured, its Coin taken back", () => {
    // A saved yard, a paid belt built in it and coloured; read back as an old save is that kept a
    // colour from before Paint was unlocked (Signs not done): the colour is carried.
    const start = saved("v7-mid");
    start.spare[F.BELT] = 0;
    const t =
      [...start.kind.keys()].find(
        (i) => F.refusal(start, F.BELT, i % start.land.w, Math.floor(i / start.land.w), Infinity, 0) === null,
      ) ?? -1;
    must(start, { do: "build", kind: "belt", dir: 0, ...xyOf(start, t) });
    must(start, { do: "paint", tint: 4, ...xyOf(start, t) });
    const rec: Rec = JSON.parse(F.encode(start));
    const done = Array.isArray(rec.done) ? rec.done.filter((g) => g !== "signs") : [];
    const y = F.decode(JSON.stringify({ ...rec, done }), start.land);
    if (!y) throw new Error("the yard does not read back");
    y.history = [];
    expect([F.locked(y.open, { use: "paint" }) !== null, y.kind[t], y.tint[t], y.free[t]]).toEqual([
      true,
      F.BELT,
      4,
      0,
    ]);
    const gave = coinsOf(play(y, { do: "remove", ...xyOf(y, t) }));
    expect(gave).toBeGreaterThan(0);
    const did = undo(y);
    expect([coinsOf(did), y.kind[t], y.tint[t], y.free[t], y.history]).toEqual([-gave, F.BELT, 4, 0, []]);
    readsBack(y);
  });

  test("a tunnel taken away and undone stands again with each mouth's own colour", () => {
    const y = laid();
    const { w } = y.land;
    const at =
      [...y.kind.keys()].find(
        (i) =>
          F.refusal(y, F.TUNNEL, i % w, Math.floor(i / w), Infinity, 0) === null &&
          F.tunnelExit(y, i % w, Math.floor(i / w), 0),
      ) ?? -1;
    must(y, { do: "build", kind: "tunnel", dir: 0, ...xyOf(y, at) });
    const far = F.otherMouth(y, at);
    y.tint[at] = 3;
    y.tint[far] = 4;
    y.history = [];
    must(y, { do: "remove", ...xyOf(y, at) });
    expect(undo(y)).not.toHaveProperty("refused");
    expect([y.kind[at], y.kind[far], y.tint[at], y.tint[far], F.otherMouth(y, at)]).toEqual([
      F.TUNNEL,
      F.TUNNEL,
      3,
      4,
      far,
    ]);
    readsBack(y);
  });
});
