/**
 * The new pieces: a cart stop takes things from any side and they have reached the depot at once,
 * as many stops as the yard has unlocked; a sorter, in at the back, sends the one thing it is set to
 * out to its left and everything else ahead, and with nothing set is a belt. A splitter with a way
 * put first sends everything that way while it takes it, and only the rest to its other ways. And a
 * blueprint, set down by naming its place: turned any way, it stands as turned, tunnels whole, all or
 * none.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { fill } from "./goals.ts";
import { bareLand } from "./land.ts";
import { give, must } from "./yards.ts";

const plank = F.item("plank");
const brick = F.item("brick");
const yard = (tier = 4): F.Yard => F.create({ land: bareLand(15, 9, [], [12, 4]), tier, seed: 1 });

/** A shut crate at (x, y), to catch what comes; its row. */
function sink(y: F.Yard, x: number, z: number): number {
  must(y, { do: "build", kind: "crate", x, y: z, dir: 0 });
  must(y, { do: "crate", x, y: z, open: false });
  return y.row[F.at(y, x, z)] ?? -1;
}
/** A crate at (x, y) facing a way, letting out what it is given. */
function source(y: F.Yard, x: number, z: number, dir: number, things: readonly (readonly [F.Item, number])[]): void {
  must(y, { do: "build", kind: "crate", x, y: z, dir });
  const r = y.row[F.at(y, x, z)] ?? -1;
  for (const [n, c] of things) for (let k = 0; k < c; k++) F.put(y.holders, r, n);
}
const run = (y: F.Yard, ticks: number): void => {
  for (let k = 0; k < ticks; k++) F.step(y);
};
/** Takes a node into hand and sends the depot all it wants, so that it is finished as in play. */
function fillHandWith(y: F.Yard, node: string): void {
  must(y, { do: "take", node });
  fill(y);
}

describe("a cart stop", () => {
  test("takes things in from any side, and each has reached the depot at once", () => {
    const y = yard();
    must(y, { do: "build", kind: "stop", x: 3, y: 4, dir: 0 });
    source(y, 2, 4, 0, [[plank, 3]]);
    source(y, 3, 3, 1, [[brick, 2]]);
    source(y, 3, 5, 3, [[brick, 2]]);
    const till = y.till;
    run(y, 40);
    expect([y.depot[plank], y.depot[brick]]).toEqual([3, 4]);
    expect(y.till - till).toBe(7 * (F.ARRIVAL[plank] ?? 0));
    expect(F.status(y, F.at(y, 3, 4))?.state).toBe("giving");
  });

  test("a yard may stand only as many as it has unlocked", () => {
    expect(give(yard(3), { do: "build", kind: "stop", x: 3, y: 4, dir: 0 })).toMatchObject({
      why: "The cart stop is not unlocked yet",
    });
    const y = yard();
    const most = y.open.stops;
    expect(most).toBeGreaterThan(0);
    // As many as it may, in a row from (3, 4) east, every other tile; then one more is refused.
    for (let k = 1; k < most; k++) must(y, { do: "build", kind: "stop", x: 3 + 2 * k, y: 2, dir: 0 });
    must(y, { do: "build", kind: "stop", x: 3, y: 4, dir: 0 });
    expect(give(y, { do: "build", kind: "stop", x: 5, y: 4, dir: 0 })).toMatchObject({
      refused: "cannot_build",
      why: `The yard may have ${most} cart stop${most === 1 ? "" : "s"}`,
    });
    must(y, { do: "build", kind: "stop", x: 3, y: 4, dir: 1 });
    must(y, { do: "remove", x: 3, y: 4 });
    const two = [5, 6].map((x) => ({ kind: "stop", x, y: 4, dir: 0, span: 0 }));
    expect(give(y, { do: "stand", pieces: two })).toMatchObject({ refused: "cannot_stand" });
    expect(y.kind[F.at(y, 5, 4)]).toBe(F.NONE);
  });
});

/** A sorter on (4, 4) facing east, fed from behind; what reaches the crates ahead and to its left. */
function sorted(item: string | null): { ahead: number[]; left: number[] } {
  const y = yard();
  must(y, { do: "build", kind: "sorter", x: 4, y: 4, dir: 0 });
  if (item !== null) must(y, { do: "sort", x: 4, y: 4, item });
  must(y, { do: "build", kind: "belt", x: 3, y: 4, dir: 0 });
  must(y, { do: "build", kind: "belt", x: 5, y: 4, dir: 0 });
  must(y, { do: "build", kind: "belt", x: 4, y: 3, dir: 3 });
  const ahead = sink(y, 6, 4);
  const left = sink(y, 4, 2);
  source(y, 2, 4, 0, [
    [plank, 5],
    [brick, 4],
  ]);
  run(y, 200);
  const holds = (r: number): number[] => [F.held(y.holders, r, plank), F.held(y.holders, r, brick)];
  return { ahead: holds(ahead), left: holds(left) };
}

describe("a blueprint", () => {
  test("is set down by naming its place, the corner and the turns, in one command that is all or none, whatever its size: 400 pieces", () => {
    const y = F.create({ land: bareLand(48, 30, [], [44, 4]), tier: 4, seed: 1 });
    for (let z = 2; z < 22; z++)
      for (let x = 1; x < 21; x++) expect(F.build(y, F.BELT, x, z, 0, Infinity).ok).toBe(true);
    must(y, { do: "saveBlueprint", slot: 2, tiles: F.within(y, 1, 2, 20, 21) });
    const belts = (): number => y.kind.filter((k) => k === F.BELT).length;
    const did = give(y, { do: "placeBlueprint", slot: 2, x: 22, y: 2, turns: 1 });
    if ("refused" in did) throw new Error(did.why);
    expect([belts(), y.dir[F.at(y, 22, 2)]]).toEqual([800, 1]);
    expect((did.coins ?? []).reduce((sum, c) => sum - c.amount, 0)).toBe(400);
    // Where one of its pieces cannot stand, off the map, none does.
    expect(give(y, { do: "placeBlueprint", slot: 2, x: 30, y: 12, turns: 0 })).toMatchObject({
      refused: "cannot_place_blueprint",
      why: "That is off the map",
    });
    expect(give(y, { do: "placeBlueprint", slot: 1, x: 22, y: 2, turns: 0 })).toMatchObject({
      refused: "cannot_place_blueprint",
      why: "There is no blueprint there",
    });
    expect(belts()).toBe(800);
  });
});

/** 200 belts on the tiles from (1, 2) to (10, 21), on a land of 48 by 30; and how many belts stand. */
function beltsToCopy(): { y: F.Yard; tiles: number[]; count: () => number } {
  const y = F.create({ land: bareLand(48, 30, [], [44, 4]), tier: 4, seed: 1 });
  y.spare.fill(0);
  for (let z = 2; z < 22; z++) for (let x = 1; x < 11; x++) expect(F.build(y, F.BELT, x, z, 0, Infinity).ok).toBe(true);
  return { y, tiles: F.within(y, 1, 2, 10, 21), count: () => y.kind.filter((k) => k === F.BELT).length };
}
const coinsOf = (did: ReturnType<typeof give>): { amount: number }[] =>
  "refused" in did ? [] : (did.coins ?? []).filter((c) => c.reason !== "Earned in the Works");

describe("a copy", () => {
  test("is one command naming the tiles, the turns and the corner, as a move is, all or none whatever its size: 200 pieces", () => {
    const { y, tiles, count } = beltsToCopy();
    const did = give(y, { do: "copy", tiles, turns: 1, x: 12, y: 2 });
    if ("refused" in did) throw new Error(did.why);
    expect([count(), y.dir[F.at(y, 12, 2)], y.kind[F.at(y, 31, 11)]]).toEqual([400, 1, F.BELT]);
    expect(coinsOf(did).map((c) => -c.amount)).toEqual([200]);
    // Where one of its pieces cannot stand, off the map, none does.
    const kept = F.encode(y);
    expect(give(y, { do: "copy", tiles, turns: 0, x: 40, y: 12 })).toMatchObject({
      refused: "cannot_copy",
      why: "That is off the map",
    });
    expect(give(y, { do: "copy", tiles: [F.at(y, 30, 28)], turns: 0, x: 1, y: 1 })).toMatchObject({
      refused: "cannot_copy",
      why: "There is nothing here to copy",
    });
    expect(F.encode(y)).toBe(kept);
  });

  test("over pieces it lowers is charged once, for the whole of it: what its first pieces cost less what its last give back", () => {
    const { y, tiles } = beltsToCopy();
    // Raised belts where the copy's last 120 pieces would go.
    for (let z = 10; z < 22; z++)
      for (let x = 22; x < 32; x++) must(y, { do: "build", kind: "belt", x, y: z, dir: 0, grade: 2 });
    const pieces = F.copyOf(y, tiles, 0, 22, 2) ?? [];
    const first = F.priceOf(y, pieces.slice(0, F.STAND_MOST));
    const whole = F.priceOf(y, pieces);
    expect(first).toBeGreaterThan(whole);
    const did = give(y, { do: "copy", tiles, turns: 0, x: 22, y: 2 });
    expect(coinsOf(did).map((c) => c.amount)).toEqual([-whole]);
  });

  test("needs Select, as a move does", () => {
    const y = F.create({ land: bareLand(48, 30, [], [44, 4]), tier: 1, seed: 1 });
    must(y, { do: "build", kind: "belt", x: 1, y: 1, dir: 0 });
    expect(give(y, { do: "copy", tiles: [F.at(y, 1, 1)], turns: 0, x: 3, y: 3 })).toMatchObject({ refused: "locked" });
  });
});

/**
 * A blueprint holding tunnels, as stood at (1, 5) on a land of 20 by 14: a belt in; a tunnel east under
 * 2 tiles with a belt facing north on the first of them; a grade 2 tunnel south under 1. Its box is 6
 * by 3, and its bottom row and right-hand column hold one tile each when turned 0 and 3 times: the
 * grade 2 tunnel's far mouth.
 */
const PRINT = [
  { kind: "belt", x: 1, y: 5, dir: 0, span: 0 },
  { kind: "tunnel", x: 2, y: 5, dir: 0, span: 2 },
  { kind: "belt", x: 3, y: 5, dir: 3, span: 0 },
  { kind: "tunnel", x: 6, y: 5, dir: 1, span: 1, grade: 2 },
] as const;

/** A tile and what stands on it: kind, way, span (negative at a far mouth) and grade. */
type Stood = readonly [x: number, z: number, kind: number, dir: number, span: number, grade: number];

/** The tiles `PRINT` takes, both mouths of each tunnel, turned `turns` quarter turns right with the corner of its box on (x, y). */
function turned(turns: number, x: number, z: number): Stood[] {
  let tiles = PRINT.flatMap((p): Stood[] => {
    const k = F.kindNamed(p.kind) ?? F.NONE;
    const g = F.gradeOf(k, "grade" in p ? p.grade : 1);
    const far = p.span + 1;
    const near: Stood = [p.x, p.y, k, p.dir, p.span, g];
    return k === F.TUNNEL ? [near, [p.x + F.DX[p.dir] * far, p.y + F.DY[p.dir] * far, k, p.dir, -p.span, g]] : [near];
  });
  for (let t = 0; t < turns; t++) tiles = tiles.map(([a, b, k, d, s, g]): Stood => [-b, a, k, (d + 1) & 3, s, g]);
  const x0 = Math.min(...tiles.map((t) => t[0]));
  const z0 = Math.min(...tiles.map((t) => t[1]));
  return tiles.map(([a, b, k, d, s, g]): Stood => [a - x0 + x, b - z0 + z, k, d, s, g]);
}
/** What stands on a tile. */
function stood(y: F.Yard, x: number, z: number): Stood {
  const i = F.at(y, x, z);
  return [x, z, y.kind[i] ?? F.NONE, y.dir[i] ?? 0, y.span[i] ?? 0, y.grade[i] ?? 0];
}
/** How many tiles have a piece on them. */
const tilesStood = (y: F.Yard): number => y.kind.filter((k) => k !== F.NONE && k !== F.DEPOT).length;

/** A yard of every goal of the slice done on 20 by 14, nothing to hand, with `PRINT` standing and kept as blueprint 0. */
function printed(): F.Yard {
  const y = F.create({ land: bareLand(20, 14, [], [10, 7]), tier: 4, seed: 1 });
  y.spare.fill(0);
  must(y, { do: "stand", pieces: PRINT });
  must(y, { do: "saveBlueprint", slot: 0, tiles: F.within(y, 1, 5, 6, 7) });
  return y;
}
/** The Coins a command took from the purse. */
function spent(y: F.Yard, c: Record<string, unknown>): number {
  const did = give(y, c);
  if ("refused" in did) throw new Error(`${String(c.do)} was refused: ${did.why}`);
  return (did.coins ?? []).reduce((sum, ch) => sum + (ch.reason === "Earned in the Works" ? 0 : -ch.amount), 0);
}

describe("a blueprint holding tunnels", () => {
  test("set down by its place, turned each of the four ways into each corner of the map, stands exactly turned, both mouths of each tunnel at its span and way, and is charged each piece's price once", () => {
    const y = printed();
    const price = 2 * F.price(F.BELT, 1) + F.price(F.TUNNEL, 1) + F.price(F.TUNNEL, 2);
    const corners = [
      [0, 0],
      [17, 0],
      [14, 11],
      [0, 8],
    ] as const;
    corners.forEach(([x, z], turns) => {
      const before = tilesStood(y);
      expect(spent(y, { do: "placeBlueprint", slot: 0, x, y: z, turns })).toBe(price);
      const want = turned(turns, x, z);
      expect(want.map(([a, b]) => stood(y, a, b))).toEqual(want);
      expect(tilesStood(y)).toBe(before + want.length);
    });
  });

  test("is refused whole, nothing changed, where a tunnel's far mouth would fall off the map or onto something, or one of its tunnels would go in over a tunnel that is not the same", () => {
    const y = printed();
    const refused = { refused: "cannot_place_blueprint" };
    let kept = F.encode(y);
    // The grade 2 tunnel's far mouth alone off the bottom of the map, and alone off its right side.
    expect(give(y, { do: "placeBlueprint", slot: 0, x: 7, y: 12, turns: 0 })).toMatchObject(refused);
    expect(give(y, { do: "placeBlueprint", slot: 0, x: 18, y: 0, turns: 3 })).toMatchObject(refused);
    expect(F.encode(y)).toBe(kept);
    // Onto a crate, at (12, 2).
    must(y, { do: "build", kind: "crate", x: 12, y: 2, dir: 0 });
    kept = F.encode(y);
    expect(give(y, { do: "placeBlueprint", slot: 0, x: 7, y: 0, turns: 0 })).toMatchObject(refused);
    expect(F.encode(y)).toBe(kept);
    must(y, { do: "remove", x: 12, y: 2 });
    // The tunnel east going in at (8, 0) over a tunnel going in there south, and over a far mouth.
    for (const [x, z, dir] of [
      [8, 0, 1],
      [8, 2, 3],
    ] as const) {
      expect(F.build(y, F.TUNNEL, x, z, dir, Infinity, { span: 1, grade: 2 }).ok).toBe(true);
      kept = F.encode(y);
      expect(give(y, { do: "placeBlueprint", slot: 0, x: 7, y: 0, turns: 0 })).toMatchObject({
        ...refused,
        why: "Something is here already",
      });
      expect(F.encode(y)).toBe(kept);
      must(y, { do: "remove", x, y: z });
    }
  });

  test("set down over pieces already standing, turns a belt of its own to its way, raises the same tunnel where it stands, passes under another belt, and is charged only what changes", () => {
    const y = printed();
    // Turned twice at (7, 0): a belt west at (12, 2), the tunnel west going in at (11, 2) to (8, 2), a
    // belt south at (10, 2) and the grade 2 tunnel north going in at (7, 2) to (7, 0).
    must(y, { do: "build", kind: "belt", x: 12, y: 2, dir: 3 });
    must(y, { do: "build", kind: "belt", x: 9, y: 2, dir: 0 });
    expect(F.build(y, F.TUNNEL, 7, 2, 3, Infinity, { span: 1 }).ok).toBe(true);
    const before = tilesStood(y);
    const price = F.price(F.TUNNEL, 1) + F.price(F.BELT, 1) + F.price(F.TUNNEL, 2) - F.price(F.TUNNEL, 1);
    expect(spent(y, { do: "placeBlueprint", slot: 0, x: 7, y: 0, turns: 2 })).toBe(price);
    const want = turned(2, 7, 0);
    expect(want.map(([a, b]) => stood(y, a, b))).toEqual(want);
    expect(stood(y, 9, 2)).toEqual([9, 2, F.BELT, 0, 0, 1]);
    expect(tilesStood(y)).toBe(before + 3);
  });

  test("whose own pieces overlap, as a kept yard might hold, is refused whole whichever way it is turned, never half set down", () => {
    const y = F.create({ land: bareLand(20, 14, [], [10, 7]), tier: 4, seed: 1 });
    const rec: unknown = JSON.parse(F.encode(y));
    if (typeof rec !== "object" || rec === null) throw new Error("not a record");
    const { BELT: b, TUNNEL: t } = F;
    // Each piece as kept: kind, x, y, its way (with 4 for a span), and a tunnel's span.
    for (const bytes of [
      [b, 0, 0, 0, b, 0, 0, 1, b, 1, 0, 0],
      [t, 0, 0, 4, 1, b, 2, 0, 0],
      [t, 0, 0, 4, 1, t, 2, 0, 4, 1],
      [t, 0, 0, 4, 1, t, 2, 0, 4 | 2, 1],
    ]) {
      const back = F.decode(JSON.stringify({ ...rec, blueprints: [F.toBase64(Uint8Array.from(bytes))] }), y.land);
      if (!back) throw new Error("the yard does not read back");
      const kept = F.encode(back);
      for (const turns of [0, 1, 2, 3])
        expect(give(back, { do: "placeBlueprint", slot: 0, x: 2, y: 2, turns })).toMatchObject({
          refused: "cannot_place_blueprint",
          why: "Two pieces cannot stand on one tile",
        });
      expect(F.encode(back)).toBe(kept);
    }
  });
});

describe("a sorter", () => {
  test("sends the one thing it is set to out to its left, and everything else ahead", () => {
    expect(sorted("plank")).toEqual({ ahead: [0, 4], left: [5, 0] });
    expect(sorted("brick")).toEqual({ ahead: [5, 0], left: [0, 4] });
  });

  test("with nothing set it is a belt", () => {
    expect(sorted(null)).toEqual({ ahead: [5, 4], left: [0, 0] });
  });

  test("takes things in only from behind; is set by its own command; keeps what it is set to when read back", () => {
    const y = yard();
    must(y, { do: "build", kind: "sorter", x: 4, y: 4, dir: 0 });
    source(y, 4, 5, 3, [[plank, 2]]);
    run(y, 40);
    expect(y.item[F.at(y, 4, 4)]).toBe(F.NONE);
    must(y, { do: "build", kind: "belt", x: 7, y: 7, dir: 0 });
    expect(give(y, { do: "sort", x: 7, y: 7, item: "plank" })).toMatchObject({ refused: "not_a_sorter" });
    must(y, { do: "sort", x: 4, y: 4, item: "brick" });
    const back = F.decode(F.encode(y), y.land);
    expect(back?.set[F.at(back, 4, 4)]).toBe(brick);
    expect(back && F.keptAt(back, F.at(back, 4, 4))).toEqual({ recipe: brick });
  });
});

/**
 * A splitter at (4, 4) facing east, fed from a crate behind it, with a belt and a shut crate on each
 * way out: ahead (east), left (north) and right (south). With `first`, that way is put first.
 * Gives the yard, and how many each way's crate holds after `ticks`.
 */
function splitting(
  things: number,
  ticks: number,
  first: number | null = null,
): { y: F.Yard; got: () => [number, number, number] } {
  const y = yard(5);
  must(y, { do: "build", kind: "splitter", x: 4, y: 4, dir: 0 });
  must(y, { do: "build", kind: "belt", x: 3, y: 4, dir: 0 });
  must(y, { do: "build", kind: "belt", x: 5, y: 4, dir: 0 });
  must(y, { do: "build", kind: "belt", x: 4, y: 3, dir: 3 });
  must(y, { do: "build", kind: "belt", x: 4, y: 5, dir: 1 });
  const sinks = [sink(y, 6, 4), sink(y, 4, 2), sink(y, 4, 6)];
  source(y, 2, 4, 0, [[plank, things]]);
  if (first !== null) must(y, { do: "first", x: 4, y: 4, way: first });
  run(y, ticks);
  const got = (): [number, number, number] => {
    const [a = 0, l = 0, r = 0] = sinks.map((s) => F.held(y.holders, s, plank));
    return [a, l, r];
  };
  return { y, got };
}

describe("a splitter with a way put first", () => {
  test("sends everything that way while the tile there takes it; only what it cannot take is shared among the other ways, as an even splitter shares it", () => {
    // Even, as before: an item each way in turn.
    expect(splitting(60, 400).got()).toEqual([20, 20, 20]);
    // The left way first, while its crate has room: all of it.
    expect(splitting(60, 400, 1).got()).toEqual([0, 60, 0]);
    // Its crate full (and one more on its belt), the rest goes ahead and right in turn; nothing is lost.
    const { y, got } = splitting(200, 1200, 1);
    const [ahead, left, right] = got();
    expect(left).toBe(y.open.crate);
    expect(y.item[F.at(y, 4, 3)]).toBe(plank);
    expect(ahead + right).toBe(200 - left - 1);
    expect(Math.abs(ahead - right)).toBeLessThanOrEqual(1);
  });

  test("is set and cleared by its own command; only an open way may be first, and shutting it puts none first", () => {
    const { y } = splitting(0, 0);
    must(y, { do: "way", x: 4, y: 4, way: 2, open: false });
    expect(give(y, { do: "first", x: 4, y: 4, way: 2 })).toMatchObject({
      refused: "cannot_put_first",
      why: "That way is shut",
    });
    expect(give(y, { do: "first", x: 3, y: 4, way: 0 })).toMatchObject({
      refused: "cannot_put_first",
      why: "There is no splitter there",
    });
    must(y, { do: "first", x: 4, y: 4, way: 0 });
    expect(F.keptAt(y, F.at(y, 4, 4))).toEqual({ shut: 4, first: 0 });
    must(y, { do: "first", x: 4, y: 4, way: 1 });
    expect(y.first[F.at(y, 4, 4)]).toBe(2);
    must(y, { do: "first", x: 4, y: 4, way: null });
    expect(y.first[F.at(y, 4, 4)]).toBe(0);
    must(y, { do: "first", x: 4, y: 4, way: 1 });
    must(y, { do: "way", x: 4, y: 4, way: 1, open: false });
    expect(F.keptAt(y, F.at(y, 4, 4))).toEqual({ shut: 6 });
  });

  test("is refused, with its own code, until the yard has unlocked it, set by its command or kept on a piece stood", () => {
    const y = yard(4);
    must(y, { do: "build", kind: "splitter", x: 4, y: 4, dir: 0 });
    const no = { refused: "locked", why: "Putting a way first is not unlocked yet" };
    expect(give(y, { do: "first", x: 4, y: 4, way: 0 })).toMatchObject(no);
    const piece = { kind: "splitter", x: 6, y: 6, dir: 0, span: 0, first: 2 };
    expect(give(y, { do: "stand", pieces: [piece] })).toMatchObject({
      refused: "cannot_stand",
      why: no.why,
    });
    fillHandWith(y, "flags");
    must(y, { do: "first", x: 4, y: 4, way: 0 });
    must(y, { do: "stand", pieces: [piece] });
    expect(y.first[F.at(y, 6, 6)]).toBe(3);
  });

  test("is kept: read back, in a blueprint and in a copy, each turned; read back where the yard may not put a way first, or the way is shut, it is let go", () => {
    const { y } = splitting(0, 0, 2);
    const back = F.decode(F.encode(y), y.land);
    expect(back && [back.first[F.at(back, 4, 4)], F.check(back)]).toEqual([3, F.check(y)]);
    must(y, { do: "saveBlueprint", slot: 0, tiles: F.within(y, 4, 4, 4, 4) });
    must(y, { do: "placeBlueprint", slot: 0, x: 10, y: 2, turns: 1 });
    must(y, { do: "copy", tiles: F.within(y, 4, 4, 4, 4), x: 10, y: 6, turns: 2 });
    expect([F.at(y, 10, 2), F.at(y, 10, 6)].map((i) => [y.dir[i], y.first[i]])).toEqual([
      [1, 3],
      [2, 3],
    ]);
    const again = F.decode(F.encode(y), y.land);
    expect(again?.blueprints[0] && F.piecesOf(again.blueprints[0])).toEqual([
      { kind: F.SPLITTER, x: 0, y: 0, dir: 0, span: 0, first: 2 },
    ]);
    // Kept by a yard that has not unlocked it: the splitter stands, putting no way first.
    const rec: unknown = JSON.parse(F.encode(y));
    if (typeof rec !== "object" || rec === null) throw new Error("not a record");
    const done = yard(4).done.map((g) => F.GOALS[g]?.id);
    const early = F.decode(JSON.stringify({ ...rec, done }), y.land);
    expect(early && [early.kind[F.at(early, 4, 4)], early.first[F.at(early, 4, 4)]]).toEqual([F.SPLITTER, 0]);
    // A way put first that is shut is not kept, wherever it is read from.
    expect(F.keptOf({ shut: 2, first: 1 }, F.SPLITTER)).toEqual({ shut: 2 });
    expect(F.keptOf({ first: 1 }, F.BELT)).toEqual({});
  });

  test("changes the check, and a splitter that puts no way first keeps the check it had", () => {
    const { y } = splitting(0, 0);
    const even = F.check(y);
    must(y, { do: "first", x: 4, y: 4, way: 0 });
    const first = F.check(y);
    must(y, { do: "first", x: 4, y: 4, way: null });
    expect([first === even, F.check(y)]).toEqual([false, even]);
  });
});

describe("a run of belt", () => {
  test("turns the belt where it starts with it, and nothing but a belt", () => {
    const y = yard();
    must(y, { do: "build", kind: "belt", x: 4, y: 4, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 6, y: 4, dir: 0 });
    must(y, { do: "build", kind: "splitter", x: 8, y: 4, dir: 0 });
    must(y, { do: "lay", legs: [], turn: { x: 4, y: 4, dir: 1 } });
    expect(y.dir[F.at(y, 4, 4)]).toBe(1);
    for (const x of [6, 8, 10]) {
      const before = F.encode(y);
      expect(give(y, { do: "lay", legs: [], turn: { x, y: 4, dir: 1 } })).toMatchObject({
        refused: "cannot_lay",
        why: "There is no belt there to turn",
      });
      expect(F.encode(y)).toBe(before);
    }
  });
});
