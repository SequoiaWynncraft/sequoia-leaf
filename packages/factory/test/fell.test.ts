/**
 * Felling a redwood (`fell`): on a plot the yard owns, for `FELL_PRICE` Coins, every tile of it
 * then ground like any other for every rule that asks (`redwoodAt`): building, the router, tunnels,
 * blueprints and plans of the whole yard. Undo plants it back and gives the Coins back. What is
 * felled is the yard's, kept with it and in its check; a yard kept before it could fell reads with
 * nothing felled.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { near, tileNear, xy } from "./near.ts";
import { give, must } from "./yards.ts";

type Rec = Record<string, unknown>;

/** The Meadow's redwood: its corner, and its four tiles. */
const TREE = near(-2, 15);
const TILES = [tileNear(-2, 15), tileNear(-1, 15), tileNear(-2, 16), tileNear(-1, 16)];

/** A yard at a tier (where tunnels are open, unless said) that owns the Meadow, where a redwood stands, with nothing to undo. */
function meadow(tier = 4): F.Yard {
  const y = F.create({ seed: 5, tier });
  must(y, { do: "buyPlot", plot: "meadow" });
  y.history = [];
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

describe("felling a redwood", () => {
  test("on a plot the yard owns costs 100 Coins and frees every tile of it: a belt is then built on each", () => {
    const y = meadow();
    for (const i of TILES)
      expect(F.refusal(y, F.BELT, i % y.land.w, Math.floor(i / y.land.w), Infinity)).toBe(
        "Nothing can be built on a tree",
      );
    expect(F.FELL_PRICE).toBe(100);
    const did = play(y, { do: "fell", ...near(-1, 16) }, 100);
    expect(coinsOf(did)).toEqual([[-100, "Felled in the Works"]]);
    for (const i of TILES) {
      expect(F.redwoodAt(y, i)).toBe(false);
      must(y, { do: "build", kind: "belt", x: i % y.land.w, y: Math.floor(i / y.land.w), dir: 0 });
    }
    // The Meadow's other ground was never a redwood's, and no other redwood fell.
    expect(F.LAND.trees.filter((_, t) => y.felled[t] === 1)).toEqual([TILES]);
  });

  test("is refused, changing nothing, short of Coins, on a plot the yard does not own, and where no redwood stands", () => {
    const y = meadow();
    const was = F.encode(y);
    expect(play(y, { do: "fell", ...TREE }, 99)).toEqual({ refused: "cannot_fell", why: "Not enough Coins" });
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

describe("Undo of a redwood felled", () => {
  test("plants it back and gives the 100 Coins back; a belt built on it since is undone first", () => {
    const y = meadow();
    const first = [Array.from(y.kind), Array.from(y.felled)];
    must(y, { do: "fell", ...TREE, id: "f-1" });
    must(y, { do: "build", kind: "belt", ...TREE, dir: 0, id: "b-1" });
    expect(y.history.map((e) => e.id)).toEqual(["f-1", "b-1"]);
    expect(play(y, { do: "undo", entry: "f-1" })).toMatchObject({ refused: "cannot_undo" });
    expect("refused" in play(y, { do: "undo", entry: "b-1" })).toBe(false);
    const back = play(y, { do: "undo", entry: "f-1" });
    expect(coinsOf(back)).toEqual([[100, "Undone in the Works"]]);
    expect(TILES.map((i) => F.redwoodAt(y, i))).toEqual([true, true, true, true]);
    expect(F.refusal(y, F.BELT, TREE.x, TREE.y, Infinity)).toBe("Nothing can be built on a tree");
    expect([Array.from(y.kind), Array.from(y.felled)]).toEqual(first);
  });

  test("is kept with the yard: read back, the felling is still the one to undo", () => {
    const y = meadow();
    must(y, { do: "fell", ...TREE, id: "f-1" });
    const back = F.decode(F.encode(y), y.land);
    if (!back) throw new Error("the yard does not read back");
    expect("refused" in play(back, { do: "undo", entry: "f-1" })).toBe(false);
    expect(F.redwoodAt(back, TILES[0] ?? 0)).toBe(true);
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
  const y = F.create({ seed: 5, tier: 5 });
  must(y, { do: "buyPlot", plot: "meadow" });
  y.history = [];
  must(y, { do: "fell", ...TREE, id: "f-1" });
  must(y, { do: "build", kind: "belt", ...TREE, dir: 0, id: "b-1" });
  must(y, { do: "saveYard", slot: 0 });
  return y;
}

describe("a plan of the whole yard", () => {
  test("that stands a piece where a redwood stands again is refused, and the redwood stands", () => {
    const y = planned();
    must(y, { do: "undo", entry: "b-1" });
    must(y, { do: "undo", entry: "f-1" });
    const was = F.encode(y);
    expect(give(y, { do: "placeBlueprint", slot: 0, turns: 0, x: 0, y: 0 })).toMatchObject({
      refused: "cannot_place_blueprint",
      why: expect.stringContaining("tree"),
    });
    expect(F.encode(y)).toBe(was);
  });

  test("put back never plants a redwood: kept before it was felled, it leaves the ground clear", () => {
    const y = F.create({ seed: 5, tier: 5 });
    must(y, { do: "buyPlot", plot: "meadow" });
    must(y, { do: "build", kind: "mill", ...near(-3, -3), dir: 0 });
    must(y, { do: "saveYard", slot: 0 });
    must(y, { do: "fell", ...TREE });
    must(y, { do: "build", kind: "belt", ...TREE, dir: 0 });
    must(y, { do: "placeBlueprint", slot: 0, turns: 0, x: 0, y: 0 });
    expect([y.kind[F.at(y, TREE.x, TREE.y)], F.redwoodAt(y, F.at(y, TREE.x, TREE.y))]).toEqual([F.NONE, false]);
  });
});
