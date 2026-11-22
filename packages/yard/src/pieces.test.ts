import { describe, expect, test } from "bun:test";

import { paint, setOpen, setRecipe, setWay, turn } from "./build.ts";
import { BLUEPRINT, KIND } from "./content/machines.ts";
import { bare, belts, lit, on, put, steps, workingYard } from "./fixtures.ts";
import { WORKS } from "./game.ts";
import {
  blueprintRefusal,
  boxOf,
  clear,
  deleteBlueprint,
  move,
  type Piece,
  piecesAt,
  placed,
  priceOf,
  refusals,
  saveBlueprint,
  stand,
  within,
} from "./pieces.ts";
import { load, readPiece, save } from "./save.ts";
import { rewire } from "./step.ts";
import { at, put as add, type World } from "./world.ts";

/** A small works west of the depot: a mill that saws, a shut crate, a tunnel under a pylon, and belts between. */
function works(): World {
  const w = bare();
  put(w, "mill", 2, 2, 0);
  setRecipe(w, 2, 2, "plank");
  belts(w, 3, 2, 4, 2);
  put(w, "crate", 5, 2, 1);
  setOpen(w, 5, 2, false);
  put(w, "pylon", 3, 4);
  put(w, "tunnel", 2, 4, 0, 1);
  return w;
}
/** The tiles of everything in the small works. */
const all = (w: World): number[] => within(w, 2, 2, 5, 4);
const sorted = (pieces: readonly Piece[]): Piece[] => pieces.toSorted((a, b) => a.y - b.y || a.x - b.x);
/** So many belts in rows of `wide`, from the corner. */
const row = (n: number, wide: number): Piece[] =>
  Array.from({ length: n }, (_, k) => ({ kind: "belt", x: k % wide, y: Math.floor(k / wide), dir: 0, span: 0 }));
/** A yard's save with other blueprints put in it, read back: the blueprints that came of it. */
function reread(w: World, blueprints: unknown): World["blueprints"] {
  const raw: unknown = JSON.parse(save(w));
  if (typeof raw !== "object" || raw === null) throw new Error("not a record");
  return load(JSON.stringify({ ...raw, blueprints }))?.blueprints ?? [];
}

describe("an area", () => {
  test("holds a tunnel only when both its mouths are in it, and never the depot", () => {
    const w = works();
    expect(within(w, 2, 4, 3, 4)).toEqual([at(w, 3, 4)]);
    expect(within(w, 2, 4, 4, 4)).toEqual([at(w, 2, 4), at(w, 3, 4), at(w, 4, 4)]);
    expect(within(w, 0, 0, 23, 11)).toHaveLength(7);
    expect(piecesAt(w, within(w, 0, 0, 23, 11)).map((p) => p.kind)).not.toContain("depot");
  });
  test("is told as pieces: a tunnel once, by the mouth things go in at, with what each keeps", () => {
    const w = works();
    expect(sorted(piecesAt(w, all(w)))).toEqual([
      { kind: "mill", x: 2, y: 2, dir: 0, span: 0, recipe: "plank" },
      { kind: "belt", x: 3, y: 2, dir: 0, span: 0 },
      { kind: "belt", x: 4, y: 2, dir: 0, span: 0 },
      { kind: "crate", x: 5, y: 2, dir: 1, span: 0, open: false },
      { kind: "tunnel", x: 2, y: 4, dir: 0, span: 1 },
      { kind: "pylon", x: 3, y: 4, dir: 0, span: 0 },
    ]);
    // Named by the mouth things come out of alone, it is the same tunnel.
    expect(piecesAt(w, [at(w, 4, 4)])).toEqual([{ kind: "tunnel", x: 2, y: 4, dir: 0, span: 1 }]);
    expect(boxOf(piecesAt(w, all(w)))).toEqual({ x: 2, y: 2, w: 4, h: 3 });
  });
  test("turned a quarter turn four times is as it began, tunnels included", () => {
    const w = works();
    const began = piecesAt(w, all(w));
    let turned = began;
    for (let k = 0; k < 4; k++) turned = placed(turned, 1, 2, 2);
    expect(turned).toEqual(began);
    // One quarter turn: what faced east faces south, and the tunnel still comes up two tiles on.
    expect(sorted(placed(began, 1, 0, 0))).toEqual([
      { kind: "tunnel", x: 0, y: 0, dir: 1, span: 1 },
      { kind: "mill", x: 2, y: 0, dir: 1, span: 0, recipe: "plank" },
      { kind: "pylon", x: 0, y: 1, dir: 1, span: 0 },
      { kind: "belt", x: 2, y: 1, dir: 1, span: 0 },
      { kind: "belt", x: 2, y: 2, dir: 1, span: 0 },
      { kind: "crate", x: 2, y: 3, dir: 2, span: 0, open: false },
    ]);
    // And the yard itself, moved round four times where it stands.
    const text = save(w);
    for (let k = 0; k < 4; k++) expect(move(w, within(w, 0, 0, 8, 8), 1, 2, 2)).toBeNull();
    expect(save(w)).toBe(text);
  });
});

describe("a move", () => {
  test("may be set down overlapping where the pieces stood", () => {
    const w = bare();
    belts(w, 2, 2, 5, 2);
    const first = on(w, 2, 2);
    expect(move(w, within(w, 2, 2, 5, 2), 0, 3, 2)).toBeNull();
    expect(w.cells[at(w, 2, 2)]).toBeNull();
    expect(on(w, 3, 2)).toBe(first);
    expect(within(w, 0, 0, 23, 11)).toEqual([3, 4, 5, 6].map((x) => at(w, x, 2)));
  });
  test("onto something in the way is refused, and the yard is untouched", () => {
    const w = works();
    put(w, "pylon", 8, 2);
    put(w, "belt", 10, 8, 0);
    const text = save(w);
    expect(move(w, all(w), 0, 5, 2)).toBe("Something is here already");
    // Not even onto one of its own kind, which a copy would only turn.
    expect(move(w, [at(w, 3, 2)], 0, 10, 8)).toBe("Something is here already");
    expect(move(w, all(w), 0, 21, 2)).toBe("That is off the map");
    expect(move(w, [at(w, 0, 0)], 0, 5, 5)).toBe("There is nothing here to move");
    expect(save(w)).toBe(text);
  });
  test("keeps what a machine holds, a crate's contents and what is under the ground, and costs nothing", () => {
    const w = works();
    const mill = on(w, 2, 2);
    add(mill, "deadfall");
    Object.assign(mill, { making: "plank", work: 5 });
    const crate = on(w, 5, 2);
    for (let k = 0; k < 3; k++) add(crate, "brick");
    const mouth = on(w, 2, 4);
    mouth.under[0] = "ore";
    on(w, 3, 2).item = "plank";
    w.spare = {};
    expect(move(w, all(w), 1, 15, 1)).toBeNull();
    expect(all(w)).toEqual([]);
    // The box is now three tiles by four, with its corner on (15, 1): the mill at the top right, facing south.
    expect(on(w, 17, 1)).toBe(mill);
    expect(mill).toMatchObject({ dir: 1, recipe: "plank", making: "plank", work: 5, count: 1 });
    expect(on(w, 17, 4)).toBe(crate);
    expect(crate).toMatchObject({ dir: 2, open: false, count: 3, buf: { brick: 3 } });
    expect(on(w, 15, 1)).toBe(mouth);
    expect(mouth).toMatchObject({ dir: 1, span: 1, under: ["ore"] });
    expect(on(w, 15, 3)).toMatchObject({ kind: "tunnel", dir: 1, span: -1 });
    expect(on(w, 17, 2).item).toBe("plank");
    // It runs on from there: the plank rides down the belts into the crate.
    steps(w, 40);
    expect(crate.buf.plank).toBeGreaterThanOrEqual(1);
  });
});

describe("a copy", () => {
  test("keeps direction, a set recipe, a shut crate and a tunnel's span, and holds nothing", () => {
    const w = works();
    add(on(w, 2, 2), "deadfall");
    add(on(w, 5, 2), "brick");
    on(w, 3, 2).item = "plank";
    const copy = placed(piecesAt(w, all(w)), 2, 14, 8);
    const price = KIND.mill.cost + 2 * KIND.belt.cost + KIND.crate.cost + KIND.pylon.cost + KIND.tunnel.cost;
    expect(priceOf(w, copy)).toBe(price);
    expect(stand(w, copy, price)).toEqual({ ok: true, cost: price });
    expect(sorted(piecesAt(w, within(w, 14, 8, 17, 10)))).toEqual(sorted(copy));
    expect(on(w, 17, 10)).toMatchObject({ kind: "mill", dir: 2, recipe: "plank", count: 0 });
    expect(on(w, 14, 10)).toMatchObject({ kind: "crate", dir: 3, open: false, count: 0 });
    expect(on(w, 16, 10).item).toBeNull();
    expect(on(w, 17, 8)).toMatchObject({ kind: "tunnel", dir: 2, span: 1 });
    // The originals stay.
    expect(all(w)).toHaveLength(7);
  });
  test("short of Coins is refused with how many short, and nothing is built", () => {
    const w = works();
    const copy = placed(piecesAt(w, all(w)), 0, 14, 8);
    const text = save(w);
    expect(stand(w, copy, priceOf(w, copy) - 7)).toEqual({ ok: false, why: "Not enough Coins: 7 short" });
    expect(save(w)).toBe(text);
  });
  test("uses the pieces the yard has to hand first, for nothing", () => {
    const w = works();
    w.spare = { belt: 1, mill: 1, crate: 3 };
    const copy = placed(piecesAt(w, all(w)), 0, 14, 8);
    const price = KIND.belt.cost + KIND.pylon.cost + KIND.tunnel.cost;
    expect(priceOf(w, copy)).toBe(price);
    expect(priceOf(w, copy, true)).toBe(price);
    expect(stand(w, copy, price)).toEqual({ ok: true, cost: price });
    expect(w.spare).toEqual({ belt: 0, mill: 0, crate: 2 });
    expect([on(w, 14, 8).free, on(w, 15, 8).free, on(w, 16, 8).free, on(w, 17, 8).free]).toEqual([
      true,
      true,
      false,
      true,
    ]);
  });
  test("goes down as single pieces do: over one of its kind it only turns it, and a splitter takes a belt's place", () => {
    const w = bare();
    belts(w, 2, 2, 3, 2);
    setRecipe(w, 2, 2, null);
    const pieces: Piece[] = [
      { kind: "belt", x: 2, y: 2, dir: 1, span: 0 },
      { kind: "splitter", x: 3, y: 2, dir: 0, span: 0 },
      { kind: "mill", x: 4, y: 2, dir: 0, span: 0, recipe: "brick" },
    ];
    const price = KIND.splitter.cost - KIND.belt.cost + KIND.mill.cost;
    expect(priceOf(w, pieces)).toBe(price);
    expect(stand(w, pieces, price)).toEqual({ ok: true, cost: price });
    expect(on(w, 2, 2)).toMatchObject({ kind: "belt", dir: 1 });
    expect(on(w, 3, 2).kind).toBe("splitter");
    expect(on(w, 4, 2).recipe).toBe("brick");
    // All or none: one piece that cannot go stops the rest, and each piece has its own reason.
    const more: Piece[] = [
      { kind: "belt", x: 6, y: 2, dir: 0, span: 0 },
      { kind: "pylon", x: 6, y: 2, dir: 0, span: 0 },
      { kind: "gatherer", x: 7, y: 2, dir: 0, span: 0 },
      { kind: "tunnel", x: 9, y: 6, dir: 0, span: 2 },
    ];
    expect(refusals(w, more)).toEqual([
      null,
      "Two pieces cannot stand on one tile",
      "A gatherer must be placed on a deposit",
      "A tunnel cannot go under the depot",
    ]);
    expect(stand(w, more, 999)).toEqual({ ok: false, why: "Two pieces cannot stand on one tile" });
    expect(w.cells[at(w, 6, 2)]).toBeNull();
  });
  test("with a kind of piece the yard cannot build now is refused, and says which", () => {
    const w = works();
    const copy = placed(piecesAt(w, all(w)), 0, 14, 8);
    w.open.kinds.delete("crate");
    expect(stand(w, copy, 999)).toEqual({ ok: false, why: "The crate is not unlocked yet" });
  });
});

describe("a gatherer moved", () => {
  test("to another deposit keeps what it had gathered, and Leaf reads the yard back as it was", () => {
    const w = lit(bare({ "2,2": "deadfall", "6,2": "ore" }));
    put(w, "gatherer", 2, 2);
    steps(w, 40);
    expect(on(w, 2, 2).out).toBe("deadfall");
    expect(move(w, [at(w, 2, 2)], 0, 6, 2)).toBeNull();
    expect(on(w, 6, 2).out).toBe("deadfall");
    expect(load(save(w), w.land)?.cells[at(w, 6, 2)]?.out).toBe("deadfall");
  });
});

describe("an area removed", () => {
  test("gives back what its pieces cost, as taking each away would", () => {
    const w = works();
    on(w, 3, 2).free = true;
    // The tunnel is named by one mouth, and goes whole.
    const refund = KIND.mill.cost + KIND.belt.cost + KIND.crate.cost + KIND.pylon.cost + KIND.tunnel.cost;
    expect(clear(w, [...within(w, 2, 2, 5, 2), at(w, 3, 4), at(w, 4, 4)])).toEqual({ ok: true, refund });
    expect(within(w, 0, 0, 23, 11)).toEqual([]);
    expect(w.spare.belt).toBe(1);
    expect(clear(w, [at(w, 2, 2), at(w, 12, 6)])).toEqual({ ok: false, why: "There is nothing here to remove" });
  });
});

describe("a blueprint", () => {
  test("is kept, saved with the yard, read back, and set down as a copy is", () => {
    const w = workingYard();
    const tiles = within(w, 25, 12, 28, 17);
    const pieces = piecesAt(w, tiles);
    expect(pieces.length).toBeGreaterThan(8);
    setRecipe(w, 26, 13, "gear");
    expect(saveBlueprint(w, 1, tiles)).toBeNull();
    expect(w.blueprints.map((b) => b?.length ?? 0)).toEqual([0, pieces.length, 0]);
    const back = WORKS.decode(WORKS.encode(w));
    if (!back) throw new Error("the yard did not come back");
    expect(back.blueprints).toEqual(w.blueprints);
    expect(WORKS.encode(back)).toBe(WORKS.encode(w));
    // Set down where it was cut from, once that is cleared: the same pieces, new and empty.
    const print = back.blueprints[1] ?? [];
    const box = boxOf(piecesAt(back, tiles));
    expect(boxOf(print)).toEqual({ ...box, x: 0, y: 0 });
    const refund = clear(back, tiles);
    const price = priceOf(back, print, true);
    expect(refund).toEqual({ ok: true, refund: price });
    expect(stand(back, placed(print, 0, box.x, box.y), price)).toEqual({ ok: true, cost: price });
    expect(sorted(piecesAt(back, within(back, 25, 12, 28, 17)))).toEqual(sorted(piecesAt(w, tiles)));
    expect(back.cells[at(back, 26, 13)]).toMatchObject({ recipe: "gear", count: 0 });
    // A place is emptied, and a visitor is shown none.
    expect(deleteBlueprint(back, 1)).toBe(true);
    expect(deleteBlueprint(back, 1)).toBe(false);
    expect(WORKS.encode(back)).not.toContain("blueprints");
    const ctx = { now: w.at, player: { id: "v", guest: false }, seed: 1, room: 0, awards: [] };
    expect(WORKS.view(w, ctx).yard).toContain("blueprints");
    expect(WORKS.visit?.(w, ctx).yard).not.toContain("blueprints");
  });
  test("holds at most 400 pieces and is at most 32 tiles by 24", () => {
    expect(blueprintRefusal(row(BLUEPRINT.pieces, BLUEPRINT.w))).toBeNull();
    expect(blueprintRefusal(row(401, 32))).toBe("A blueprint holds at most 400 pieces. This is 401");
    expect(blueprintRefusal(row(33, 33))).toBe("A blueprint is at most 32 tiles by 24. This is 33 by 1");
    expect(blueprintRefusal(row(50, 2))).toBe("A blueprint is at most 32 tiles by 24. This is 2 by 25");
    expect(blueprintRefusal([])).toBe("There is nothing here to save");
    // A tunnel's far mouth counts in its size.
    expect(boxOf([{ kind: "tunnel", x: 31, y: 0, dir: 0, span: 1 }]).w).toBe(3);
    const w = bare({}, { w: 40 });
    belts(w, 2, 1, 34, 1);
    expect(saveBlueprint(w, 0, within(w, 0, 0, 39, 2))).toBe("A blueprint is at most 32 tiles by 24. This is 33 by 1");
    expect(saveBlueprint(w, 3, within(w, 0, 0, 20, 2))).toBe("There is no such blueprint");
    expect(saveBlueprint(w, 2, [])).toBe("There is nothing here to save");
    expect(w.blueprints).toEqual([null, null, null]);
  });
  test("read back from a save is checked, and one that does not check is left out", () => {
    const w = workingYard();
    saveBlueprint(w, 0, within(w, 25, 12, 28, 17));
    const kept = w.blueprints[0] ?? [];
    const read = (blueprints: unknown): World["blueprints"] => reread(w, blueprints);
    expect(read([kept, null, kept])).toEqual([kept, null, kept]);
    // A tunnel's far mouth counts: with a belt at the other end, this one is 35 tiles across.
    const wide = [
      { kind: "belt", x: 0, y: 0, dir: 0, span: 0 },
      { kind: "tunnel", x: 31, y: 0, dir: 0, span: 2 },
    ];
    expect(
      read([[{ kind: "castle", x: 0, y: 0, dir: 0, span: 0 }], [{ kind: "depot", x: 0, y: 0, dir: 0, span: 0 }], wide]),
    ).toEqual([null, null, null]);
    expect(
      read([[{ kind: "belt", x: 32, y: 0, dir: 0, span: 0 }], [{ kind: "belt", x: 0, y: 0, dir: 5, span: 0 }], []]),
    ).toEqual([null, null, null]);
    // What a piece may not keep is dropped, and one not set against its corner is set against it.
    expect(
      read([[{ kind: "belt", x: 3, y: 2, dir: 1, span: 0, recipe: "plank", open: false }], "x", kept, kept]),
    ).toEqual([[{ kind: "belt", x: 0, y: 0, dir: 1, span: 0 }], null, kept]);
    // A save from before there were blueprints has none.
    expect(read(undefined)).toEqual([null, null, null]);
  });
});

/** The colours of so many tiles in a row, from (x, y) eastward, as digits: a dash where nothing stands. */
const tints = (w: World, x: number, y: number, n: number): string =>
  Array.from({ length: n }, (_, k) => w.cells[at(w, x + k, y)]?.tint ?? "-").join("");
/** The colour a piece of some kind, asked for with a colour, is read as having. */
const read = (kind: string, tint: unknown): number | undefined =>
  readPiece({ kind, x: 0, y: 0, dir: 0, span: 0, tint })?.tint;
/** A belt running east, asked for with a colour or with none. */
const belt = (x: number, y: number, tint?: number): Piece => ({
  kind: "belt",
  x,
  y,
  dir: 0,
  span: 0,
  ...(tint === undefined ? {} : { tint }),
});

describe("colour", () => {
  test("a coloured line moved, copied and kept as a blueprint keeps its colour", () => {
    const w = bare();
    belts(w, 1, 2, 2, 2);
    put(w, "tunnel", 3, 2, 0, 1);
    put(w, "belt", 6, 2);
    put(w, "splitter", 7, 2);
    paint(w, 1, 2, 3);
    paint(w, 7, 2, 5);
    expect(tints(w, 1, 2, 7)).toBe("333-335");
    const tiles = within(w, 1, 2, 7, 2);
    // A copy: both mouths of the tunnel, and the splitter with its own.
    expect(stand(w, placed(piecesAt(w, tiles), 0, 1, 4), Infinity).ok).toBe(true);
    expect(tints(w, 1, 4, 7)).toBe("333-335");
    // A blueprint, saved with the yard, read back and set down.
    expect(saveBlueprint(w, 0, tiles)).toBeNull();
    const print = load(save(w))?.blueprints[0] ?? [];
    expect(stand(w, placed(print, 0, 1, 9), Infinity).ok).toBe(true);
    expect(tints(w, 1, 9, 7)).toBe("333-335");
    // A move.
    expect(move(w, tiles, 0, 15, 2)).toBeNull();
    expect(tints(w, 1, 2, 7) + tints(w, 15, 2, 7)).toBe("-------333-335");
    // Read off the wire or out of a save, only a real colour on a piece that can be coloured is kept.
    expect([
      read("belt", 6),
      read("joiner", 1),
      read("belt", 7),
      read("belt", 0),
      read("belt", 1.5),
      read("mill", 3),
    ]).toEqual([6, 1, undefined, undefined, undefined, undefined]);
  });
  test("a splitter turned, moved, copied, kept as a blueprint and taken away and put back keeps its shut ways", () => {
    const w = bare();
    put(w, "splitter", 3, 3, 0);
    // Left and right shut: north and south of one facing east.
    setWay(w, 3, 3, 1, false);
    setWay(w, 3, 3, 2, false);
    /** The tiles a splitter on a tile hands to: ahead, left, right, with -1 for a way that is shut. */
    const ways = (x: number, y: number): number[] =>
      Array.from(rewire(w).ways.subarray(at(w, x, y) * 3, at(w, x, y) * 3 + 3));
    expect(ways(3, 3)).toEqual([at(w, 4, 3), -1, -1]);
    // Turned to face south, the shut ways turn with it: east and west now.
    turn(w, 3, 3, 1);
    expect(on(w, 3, 3).shut).toBe(6);
    expect(ways(3, 3)).toEqual([at(w, 3, 4), -1, -1]);
    // Moved, with a quarter turn.
    expect(move(w, [at(w, 3, 3)], 1, 8, 8)).toBeNull();
    expect(on(w, 8, 8)).toMatchObject({ dir: 2, shut: 6 });
    // Copied.
    const piece = piecesAt(w, [at(w, 8, 8)]);
    expect(piece).toEqual([{ kind: "splitter", x: 8, y: 8, dir: 2, span: 0, shut: 6 }]);
    expect(stand(w, placed(piece, 0, 2, 9), Infinity).ok).toBe(true);
    expect(on(w, 2, 9).shut).toBe(6);
    expect(ways(2, 9)).toEqual([at(w, 1, 9), -1, -1]);
    // Kept as a blueprint, saved with the yard, read back and set down.
    expect(saveBlueprint(w, 1, [at(w, 8, 8)])).toBeNull();
    expect(stand(w, placed(load(save(w))?.blueprints[1] ?? [], 0, 5, 1), Infinity).ok).toBe(true);
    expect(on(w, 5, 1).shut).toBe(6);
    // Taken away and put back, as undoing a removal does.
    clear(w, [at(w, 5, 1)]);
    expect(stand(w, placed(piece, 0, 5, 1), Infinity).ok).toBe(true);
    expect(on(w, 5, 1).shut).toBe(6);
    // A new one has all three open, and only a splitter keeps shut ways, of 1 to 7.
    expect(put(w, "splitter", 20, 1).shut).toBe(0);
    const kept = [
      ["splitter", 7],
      ["splitter", 0],
      ["splitter", 8],
      ["splitter", 1.5],
      ["joiner", 3],
    ] as const;
    expect(kept.map(([kind, shut]) => readPiece({ kind, x: 1, y: 1, dir: 0, span: 0, shut })?.shut)).toEqual([
      7,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
  test("a copy of a coloured belt beside an uncoloured one keeps both as they were", () => {
    const w = bare();
    // A coloured line that runs into an uncoloured one: as when a belt joins two lines, and takes the first's colour.
    belts(w, 1, 2, 3, 2);
    paint(w, 1, 2, 4);
    on(w, 3, 2).tint = 0;
    expect(tints(w, 1, 2, 3)).toBe("440");
    expect(stand(w, placed(piecesAt(w, within(w, 2, 2, 3, 2)), 0, 2, 5), Infinity).ok).toBe(true);
    expect(tints(w, 2, 5, 2)).toBe("40");
    // An uncoloured splitter copied onto a coloured belt is still uncoloured.
    put(w, "splitter", 8, 8);
    expect(stand(w, placed(piecesAt(w, [at(w, 8, 8)]), 0, 1, 2), Infinity).ok).toBe(true);
    expect(tints(w, 1, 2, 2)).toBe("04");
  });
  test("pieces stood beside a coloured line take its colour as a run does, whatever order they come in", () => {
    const w = bare();
    // Between two lines, the last of them first: all take the colour of the line that feeds them.
    belts(w, 1, 2, 2, 2);
    paint(w, 1, 2, 2);
    belts(w, 6, 2, 7, 2);
    paint(w, 6, 2, 6);
    expect(stand(w, [belt(5, 2), belt(4, 2), belt(3, 2)], Infinity, true).ok).toBe(true);
    expect(tints(w, 1, 2, 7)).toBe("2222266");
    // Into the start of a line, with nothing coloured feeding them: that line's.
    belts(w, 4, 9, 5, 9);
    paint(w, 4, 9, 4);
    expect(stand(w, [belt(2, 9), belt(3, 9)], Infinity, true).ok).toBe(true);
    // One asked for a colour keeps it, and the one it feeds takes that.
    expect(stand(w, [belt(7, 9), belt(6, 9, 1)], Infinity, true).ok).toBe(true);
    expect(tints(w, 2, 9, 6)).toBe("444411");
  });
});
