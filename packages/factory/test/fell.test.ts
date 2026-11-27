/**
 * Felling a redwood (`fell`): once felling is studied (tier 5's research), on a plot the yard owns,
 * the first for 1,000 Coins and each after for half as much again, rounded down to a whole 100, by
 * how many the yard has felled, those felled before felling was research among them (`fellPrice`).
 * Every tile of it is then ground like any other for every rule that asks (`redwoodAt`): building,
 * the router, tunnels, blueprints and plans of the whole yard. It is never undone: it forgets what
 * Undo would undo, as buying a plot does, and its Coins never come back. What is felled is the
 * yard's, kept with it and in its check; a yard kept before it could fell reads with nothing felled.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { learn } from "./goals.ts";
import { near, tileNear, xy } from "./near.ts";
import { buying, give, must } from "./yards.ts";

type Rec = Record<string, unknown>;

/** The Meadow's redwood: its corner, and its four tiles. */
const TREE = near(-2, 15);
const TILES = [tileNear(-2, 15), tileNear(-1, 15), tileNear(-2, 16), tileNear(-1, 16)];
const FELLING = F.goal("felling");
/** What the first redwoods cost, in turn: the 10th is what a yard that felled all 9 of the first land's pays next. */
const PRICES = [1000, 1500, 2200, 3300, 4900, 7300, 10_900, 16_300, 24_400, 36_600];

/** A yard in tier 5 that owns the Meadow, where a redwood stands, with nothing to undo: felling studied, unless said. */
function meadow(felling = true): F.Yard {
  const y = F.create({ seed: 5, tier: 5 });
  must(y, buying(y, "meadow"));
  if (felling) learn(y, FELLING);
  y.history = [];
  return y;
}

/** The first ring's plots: the yard and the eight round it, the land of every yard before tier 5's. */
const firstRing = (p: F.Plotted): boolean => p.ring <= 1;
/** The redwoods of the first ring's plots: 9. */
const FIRST_TREES = F.LAND.trees.filter(
  (tiles) => (F.LAND.plots[F.LAND.plot[tiles[0] ?? 0] ?? F.NONE]?.ring ?? 9) <= 1,
);

/** A yard as `meadow` makes it that has bought every plot of the first ring: every redwood of it on its own land. */
function everywhere(): F.Yard {
  const y = meadow();
  for (let more = true; more;) {
    more = false;
    for (const p of y.land.plots)
      if (firstRing(p) && !y.plots.includes(p.plot) && !("refused" in give(y, buying(y, F.plotName(p.plot)))))
        more = true;
  }
  return y;
}

/** Plays a command at the yard's tick with `purse` Coins to spend. */
function play(y: F.Yard, c: Rec, purse = Infinity): ReturnType<typeof F.play> {
  const read = F.readCommand({ tick: y.tick, ...c });
  if (!read) throw new Error(`${JSON.stringify(c)} does not read`);
  return F.play(y, read, purse);
}

/** The Coins a command moved, the till paid in left out. */
const coinsOf = (did: ReturnType<typeof F.play>): [number, string][] =>
  "refused" in did
    ? []
    : (did.coins ?? []).flatMap((c) => (c.reason === "Earned in the Works" ? [] : [[c.amount, c.reason]]));

/** A redwood's corner tile as a command names it. */
const spotOf = (y: F.Yard, tiles: readonly number[]): { x: number; y: number } => ({
  x: (tiles[0] ?? 0) % y.land.w,
  y: Math.floor((tiles[0] ?? 0) / y.land.w),
});

describe("felling a redwood", () => {
  test("is tier 5's research, needing nothing; before it is known a redwood is not felled, and nothing changes", () => {
    const info = F.GOALS[FELLING];
    expect([info?.kind, info?.tier, info?.needs, info?.unlocks]).toEqual(["research", 5, [], { felling: true }]);
    expect(F.ready(F.create({ tier: 4 }).open, FELLING)).toBe(false);
    const y = meadow(false);
    expect(F.ready(y.open, FELLING)).toBe(true);
    const was = F.encode(y);
    expect(play(y, { do: "fell", ...TREE })).toEqual({ refused: "locked", why: "Felling is not unlocked yet" });
    expect(F.encode(y)).toBe(was);
    expect(TILES.map((i) => F.redwoodAt(y, i))).toEqual([true, true, true, true]);
  });

  test("the first costs 1,000 Coins and frees every tile of it: a belt is then built on each", () => {
    const y = meadow();
    for (const i of TILES)
      expect(F.refusal(y, F.BELT, i % y.land.w, Math.floor(i / y.land.w), Infinity)).toBe(
        "Nothing can be built on a tree",
      );
    expect(F.fellPrice(y)).toBe(1000);
    const did = play(y, { do: "fell", ...near(-1, 16) }, 1000);
    expect(coinsOf(did)).toEqual([[-1000, "Felled in the Works"]]);
    for (const i of TILES) {
      expect(F.redwoodAt(y, i)).toBe(false);
      must(y, { do: "build", kind: "belt", x: i % y.land.w, y: Math.floor(i / y.land.w), dir: 0 });
    }
    // The Meadow's other ground was never a redwood's, and no other redwood fell.
    expect(F.LAND.trees.filter((_, t) => y.felled[t] === 1)).toEqual([TILES]);
  });

  test("each after costs half as much again as the one before, rounded down to a whole 100 Coins", () => {
    const y = everywhere();
    const owned = (tiles: readonly number[]): boolean =>
      y.land.plots.some((p, n) => n === y.land.plot[tiles[0] ?? 0] && y.plots.includes(p.plot));
    expect(FIRST_TREES.every(owned)).toBe(true);
    const paid = FIRST_TREES.map((tiles) => coinsOf(play(y, { do: "fell", ...spotOf(y, tiles) }))[0]?.[0]);
    expect(paid).toEqual(PRICES.slice(0, FIRST_TREES.length).map((p) => -p));
    // All 9 felled: the next would cost 36,600.
    expect([FIRST_TREES.length, F.fellPrice(y)]).toEqual([9, 36_600]);
    // By the count alone, whichever were felled: 2,107,900 for the 20th.
    const counted = (n: number): number => F.fellPrice({ ...y, felled: Uint8Array.from({ length: n }, () => 1) });
    expect(Array.from({ length: 10 }, (_, n) => counted(n))).toEqual(PRICES);
    expect([counted(15), counted(19)]).toEqual([416_400, 2_107_900]);
  });

  test("counts the redwoods felled before it was research: a yard kept with 8 felled pays 24,400 for its 9th", () => {
    const y = everywhere();
    const others = FIRST_TREES.filter((tiles) => !tiles.includes(TILES[0] ?? -1));
    const kept = { ...JSON.parse(F.encode(y)), felled: others.map((tiles) => tiles[0]) };
    const back = F.decode(JSON.stringify(kept), y.land);
    if (!back) throw new Error("the yard does not read back");
    expect(F.fellPrice(back)).toBe(24_400);
    expect(play(back, { do: "fell", ...TREE }, 24_399)).toEqual({ refused: "cannot_fell", why: "Not enough Coins" });
    expect(coinsOf(play(back, { do: "fell", ...TREE }, 24_400))).toEqual([[-24_400, "Felled in the Works"]]);
    expect(F.fellPrice(back)).toBe(36_600);
  });

  test("is refused, changing nothing, short of Coins, on a plot the yard does not own, and where no redwood stands", () => {
    const y = meadow();
    const was = F.encode(y);
    expect(play(y, { do: "fell", ...TREE }, 999)).toEqual({ refused: "cannot_fell", why: "Not enough Coins" });
    // The Clay Bank's redwood, on a plot the yard has not bought.
    expect(play(y, { do: "fell", ...near(-14, -4) })).toEqual({
      refused: "cannot_fell",
      why: "The Clay Bank is not the yard's yet",
    });
    expect(play(y, { do: "fell", ...near(-4, 12) })).toEqual({
      refused: "cannot_fell",
      why: "There is no redwood here",
    });
    expect(F.encode(y)).toBe(was);
    must(y, { do: "fell", ...TREE });
    expect(play(y, { do: "fell", ...near(-2, 16) })).toEqual({
      refused: "cannot_fell",
      why: "There is no redwood here",
    });
  });

  test("lets the router lay belts across where it stood, and a tunnel come up there", () => {
    const y = meadow();
    // From west of the redwood to east of it, along its first row.
    const across = (): F.Leg[] | null => F.route(y, xy(-3, 15), xy(0, 15));
    expect(across()?.some((l) => TILES.includes(F.at(y, l.x, l.y)))).toBe(false);
    expect(F.tunnelExit(y, ...xy(-4, 15), 0, 1)).toBeNull();
    must(y, { do: "fell", ...TREE });
    expect(across()?.map((l) => [l.x, l.y])).toEqual([xy(-3, 15), xy(-2, 15), xy(-1, 15), xy(0, 15)]);
    expect(F.tunnelExit(y, ...xy(-4, 15), 0, 1)).toEqual({ ...near(-2, 15), span: 1 });
  });
});

describe("felling is never undone", () => {
  test("it forgets what Undo would undo, as buying a plot does, and its Coins never come back", () => {
    const y = meadow();
    must(y, { do: "build", kind: "belt", ...near(-4, 12), dir: 0, id: "b-1" });
    expect(y.history.map((e) => e.id)).toEqual(["b-1"]);
    must(y, { do: "fell", ...TREE, id: "f-1" });
    expect(y.history).toEqual([]);
    for (const entry of ["f-1", "b-1"])
      expect(play(y, { do: "undo", entry })).toEqual({ refused: "cannot_undo", why: "Nothing to undo" });
    expect(TILES.map((i) => F.redwoodAt(y, i))).toEqual([false, false, false, false]);
    // What is built where it stood since is undone as any build is; the redwood stays felled.
    must(y, { do: "build", kind: "belt", ...TREE, dir: 0, id: "b-2" });
    expect("refused" in play(y, { do: "undo", entry: "b-2" })).toBe(false);
    expect([F.kindAt(y, TREE.x, TREE.y), F.redwoodAt(y, TILES[0] ?? -1)]).toEqual([F.NONE, false]);
  });
});

describe("a redwood felled, kept", () => {
  test("reads back felled, with what was built where it stood standing; the check says it was felled", () => {
    const y = meadow();
    const standing = F.check(y);
    must(y, { do: "fell", ...TREE });
    expect(F.check(y)).not.toBe(standing);
    must(y, { do: "build", kind: "mill", ...near(-2, 16), dir: 0 });
    const text = F.encode(y);
    expect(JSON.parse(text)).toMatchObject({ felled: [TILES[0]] });
    const back = F.decode(text, y.land);
    expect(back && [F.encode(back), F.check(back), back.kind[tileNear(-2, 16)]]).toEqual([text, F.check(y), F.MILL]);
  });

  test("a yard kept before it could fell reads with every redwood standing, and keeps no list of them", () => {
    const y = meadow();
    expect(JSON.parse(F.encode(y))).not.toHaveProperty("felled");
    const back = F.decode(F.encode(y), y.land);
    expect(back && TILES.map((i) => F.redwoodAt(back, i))).toEqual([true, true, true, true]);
  });

  test("only on a plot the yard owns, and only as a redwood's tile: anything else kept is let go", () => {
    const y = meadow();
    // The Clay Bank's redwood, not the yard's; bare ground; a tile off the map; not a tile at all.
    const rec = { ...JSON.parse(F.encode(y)), felled: [tileNear(-14, -4), tileNear(-4, 12), 99_999, "a tree"] };
    const back = F.decode(JSON.stringify(rec), y.land);
    expect(back && Array.from(back.felled)).toEqual(Array.from(y.felled));
  });

  test("no more entries are read than the land has redwoods: a redwood kept after that many stands", () => {
    const y = meadow();
    const junk = Array.from({ length: F.LAND.trees.length }, () => tileNear(-4, 12));
    const rec = { ...JSON.parse(F.encode(y)), felled: [...junk, TILES[0]] };
    const back = F.decode(JSON.stringify(rec), y.land);
    expect(back && F.redwoodAt(back, TILES[0] ?? -1)).toBe(true);
  });

  test("is kept by a version after 7, so a Leaf that knows only version 7 refuses it rather than plant it back", () => {
    const y = meadow();
    must(y, { do: "fell", ...TREE });
    expect(JSON.parse(F.encode(y)).v).toBeGreaterThan(7);
    // A version-7 yard, kept before redwoods could be felled, still reads with every redwood standing.
    const seven = { ...JSON.parse(F.encode(meadow())), v: 7 };
    const back = F.decode(JSON.stringify(seven), y.land);
    expect(back && TILES.map((i) => F.redwoodAt(back, i))).toEqual([true, true, true, true]);
  });
});

/** A yard with every goal done that owns the Meadow, its redwood felled and a belt where it stood, kept as a plan. */
function planned(): F.Yard {
  const y = F.create({ seed: 5, tier: 6 });
  must(y, buying(y, "meadow"));
  y.history = [];
  must(y, { do: "fell", ...TREE, id: "f-1" });
  must(y, { do: "build", kind: "belt", ...TREE, dir: 0, id: "b-1" });
  must(y, { do: "saveYard", slot: 0 });
  return y;
}

describe("a plan of the whole yard", () => {
  test("that stands a piece where a redwood stands again (kept by a Leaf that had not felled it) is refused, and the redwood stands", () => {
    const planner = planned();
    must(planner, { do: "undo", entry: "b-1" });
    const { felled: _, ...kept } = JSON.parse(F.encode(planner));
    const y = F.decode(JSON.stringify(kept), planner.land);
    if (!y) throw new Error("the yard does not read back");
    expect(F.redwoodAt(y, TILES[0] ?? -1)).toBe(true);
    const was = F.encode(y);
    expect(give(y, { do: "placeBlueprint", slot: 0, turns: 0, x: 0, y: 0 })).toMatchObject({
      refused: "cannot_place_blueprint",
      why: expect.stringContaining("tree"),
    });
    expect(F.encode(y)).toBe(was);
  });

  test("put back never plants a redwood: kept before it was felled, it leaves the ground clear", () => {
    const y = F.create({ seed: 5, tier: 6 });
    must(y, buying(y, "meadow"));
    must(y, { do: "build", kind: "mill", ...near(-3, -3), dir: 0 });
    must(y, { do: "saveYard", slot: 0 });
    must(y, { do: "fell", ...TREE });
    must(y, { do: "build", kind: "belt", ...TREE, dir: 0 });
    must(y, { do: "placeBlueprint", slot: 0, turns: 0, x: 0, y: 0 });
    expect([y.kind[F.at(y, TREE.x, TREE.y)], F.redwoodAt(y, F.at(y, TREE.x, TREE.y))]).toEqual([F.NONE, false]);
  });
});
