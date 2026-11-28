/**
 * Tier 5's tunnels: the deep culvert (`deepculvert`), with which a tunnel passes under up to 12
 * tiles, each tile beyond 5 adding 2 Coins to its grade I price, by the one price rule every
 * purchase and refund asks (`price`, its span among what it is priced by); and wide mouths
 * (`widemouths`), with which both mouths of a tunnel take things in from their left and right, as
 * well as from behind the way in, by its kind's ports.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { learn } from "./goals.ts";
import { bareLand } from "./land.ts";
import { give, must, upgrading } from "./yards.ts";

type Rec = Record<string, unknown>;
const plank = F.item("plank");

/** A bare yard in tier 5 with the long culvert, and the research named studied; with `tier: 6`, every research of tier 5. */
function yard(research: readonly string[] = [], tier = 5): F.Yard {
  const y = F.create({ land: bareLand(40, 11, [], [36, 5]), tier, seed: 1 });
  for (const id of research) learn(y, F.goal(id));
  y.history = [];
  return y;
}

/** The Coins a command took (or, below 0, gave), the till paid in left out; a refused command throws. */
function spent(y: F.Yard, c: Rec): number {
  const did = give(y, c);
  if ("refused" in did) throw new Error(`${String(c.do)} was refused: ${did.why}`);
  return (did.coins ?? []).reduce((sum, ch) => sum + (ch.reason === "Earned in the Works" ? 0 : -ch.amount), 0);
}

/** A tunnel going in at (x, z) facing east that passes under `span` tiles, as the page's two taps lay one. */
const tunnel = (x: number, z: number, span: number, grade = 1): Rec =>
  F.writeAct({ do: "lay", legs: [{ tunnel: true, x, y: z, dir: 0, span, grade }] });

describe("a deep culvert", () => {
  test("is tier 5's, after the longer culvert, and lets a tunnel pass under up to 12 tiles", () => {
    const g = F.GOALS[F.goal("deepculvert")];
    expect([g?.kind, g?.tier, g?.needs.map((n) => F.GOALS[n]?.id), g?.unlocks]).toEqual([
      "research",
      5,
      ["longculvert"],
      { span: 12 },
    ]);
    expect([yard().open.span, yard(["deepculvert"]).open.span]).toEqual([5, 12]);
  });

  test("says what each tile beyond 5 adds at each grade, as the prices have it", () => {
    const more = [1, 2, 3].map((g) => F.price(F.TUNNEL, g, 6) - F.price(F.TUNNEL, g, 5));
    expect(F.RESEARCH.find((r) => r.id === "deepculvert")?.what).toBe(
      `A tunnel passes under up to 12 tiles, up from 5. Each tile beyond 5 adds ${more[0]} Coins to its price at grade 1, ${more[1]} at grade 2 and ${more[2]} at grade 3.`,
    );
  });

  test("without it, a tunnel under 6 or 12 tiles is refused, changing nothing; under 5 it is laid as before", () => {
    const y = yard();
    const was = F.encode(y);
    for (const span of [6, 12])
      expect(give(y, tunnel(2, 4, span))).toMatchObject({
        why: "A tunnel needs a free tile to come up on, 1 to 5 tiles ahead",
      });
    expect(F.encode(y)).toBe(was);
    expect(spent(y, tunnel(2, 4, 5))).toBe(12);
  });

  test("a tunnel costs 12 Coins at grade I, and 2 more for each tile beyond 5 it passes under, times its grade's price", () => {
    const y = yard(["deepculvert"]);
    // Grade I, II and III cost 1, 3 and 8 times grade I's price.
    for (const [span, grade, cost] of [
      [1, 1, 12],
      [5, 1, 12],
      [6, 1, 14],
      [12, 1, 26],
      [6, 2, 42],
      [12, 2, 78],
      [12, 3, 208],
    ] as const) {
      expect([span, grade, F.price(F.TUNNEL, grade, span), F.price(F.TUNNEL, grade, -span)]).toEqual([
        span,
        grade,
        cost,
        cost,
      ]);
      const z = 1 + grade * 3;
      expect([span, grade, spent(y, tunnel(2, z, span, grade))]).toEqual([span, grade, cost]);
      // Taken away from either mouth, all of it comes back.
      const taken = span % 2 === 0 ? 2 : 3 + span;
      expect([span, grade, -spent(y, { do: "remove", x: taken, y: z })]).toEqual([span, grade, cost]);
    }
  });

  test("one laid with one tap, where every nearer tile is taken, comes up further and costs what its span costs", () => {
    const y = yard(["deepculvert"]);
    for (let x = 3; x <= 9; x++) must(y, { do: "build", kind: "crate", x, y: 4, dir: 0 });
    // The nearest tile it can come up on is (10, 4): it passes under 7 tiles.
    expect(F.tunnelExit(y, 2, 4, 0)).toEqual({ x: 10, y: 4, span: 7 });
    expect(spent(y, { do: "build", kind: "tunnel", x: 2, y: 4, dir: 0 })).toBe(16);
    expect(F.worthAt(y, F.at(y, 10, 4))).toBe(16);
  });

  test("raised and lowered, it costs what its span costs between the grades, and a whole area as much", () => {
    const y = yard(["deepculvert"], 6);
    must(y, tunnel(2, 4, 12));
    expect(spent(y, { do: "build", kind: "tunnel", x: 2, y: 4, dir: 0, grade: 2, span: 12 })).toBe(78 - 26);
    const tiles = [F.at(y, 2, 4), F.at(y, 15, 4)];
    expect(F.upgradePrice(y, tiles)).toBe(208 - 78);
    expect(spent(y, upgrading(y, tiles))).toBe(208 - 78);
    expect(spent(y, { do: "build", kind: "tunnel", x: 2, y: 4, dir: 0, grade: 1, span: 12 })).toBe(26 - 208);
  });

  test("copied, moved, kept as a blueprint and as a plan of the whole yard, and undone, it is priced by its span alike", () => {
    const y = yard(["deepculvert"], 6);
    must(y, tunnel(2, 4, 12));
    const tiles = [F.at(y, 2, 4), F.at(y, 15, 4)];
    const pieces = F.piecesAt(y, tiles);
    expect([pieces.length, pieces[0]?.span, F.priceOf(y, pieces, true)]).toEqual([1, 12, 26]);
    // A copy two rows down, then a move two rows further, which costs nothing.
    expect(spent(y, { do: "copy", tiles, turns: 0, x: 2, y: 6, id: "c-1" })).toBe(26);
    expect(spent(y, { do: "move", tiles: [F.at(y, 2, 6)], turns: 0, x: 2, y: 8, id: "m-1" })).toBe(0);
    expect([F.kindAt(y, 2, 8), y.span[F.at(y, 2, 8)], y.span[F.at(y, 15, 8)]]).toEqual([F.TUNNEL, 12, -12]);
    // Undone, the move and then the copy: the copy's 26 Coins come back.
    expect(spent(y, { do: "undo", entry: "m-1" })).toBe(0);
    expect(spent(y, { do: "undo", entry: "c-1" })).toBe(-26);
    expect(F.kindAt(y, 2, 6)).toBe(F.NONE);
    // A blueprint of it stood elsewhere.
    must(y, { do: "saveBlueprint", slot: 0, tiles });
    expect(spent(y, { do: "placeBlueprint", slot: 0, turns: 0, x: 2, y: 9 })).toBe(26);
    // A plan of the whole yard, put back with the tunnel taken up since: the tunnel costs 26 to stand again.
    must(y, { do: "saveYard", slot: 1 });
    expect(spent(y, { do: "remove", x: 2, y: 4 })).toBe(-26);
    expect(spent(y, { do: "placeBlueprint", slot: 1, turns: 0, x: 0, y: 0 })).toBe(26);
    expect([y.span[F.at(y, 2, 4)], y.span[F.at(y, 15, 4)]]).toEqual([12, -12]);
  });

  test("carries what goes in under all 12 tiles, and is kept so: read back with its Undo, it stands and undoes as it did", () => {
    const y = yard(["deepculvert"]);
    must(y, { do: "build", kind: "crate", x: 1, y: 4, dir: 0 });
    must(y, { do: "build", kind: "crate", x: 17, y: 4, dir: 0 });
    // Shut, it keeps all it takes in.
    must(y, { do: "crate", x: 17, y: 4, open: false });
    must(y, { ...tunnel(2, 4, 12), id: "t-1" });
    must(y, { do: "build", kind: "belt", x: 16, y: 4, dir: 0, id: "b-1" });
    const [from, to] = [y.row[F.at(y, 1, 4)] ?? -1, y.row[F.at(y, 17, 4)] ?? -1];
    for (let k = 0; k < 6; k++) F.put(y.holders, from, plank);
    for (let k = 0; k < 40; k++) F.step(y);
    // Under the ground still: what was kept is what is there.
    expect(y.tunnels.under.includes(plank)).toBe(true);
    const text = F.encode(y);
    const back = F.decode(text, y.land);
    if (!back) throw new Error("the yard does not read back");
    expect([F.encode(back), F.check(back), back.span[F.at(back, 15, 4)]]).toEqual([text, F.check(y), -12]);
    for (let k = 0; k < 1500; k++) F.step(back);
    expect(F.held(back.holders, to, plank)).toBe(6);
    expect(back.history.map((e) => e.id)).toEqual(["t-1", "b-1"]);
    must(back, { do: "undo", entry: "b-1" });
    expect(spent(back, { do: "undo", entry: "t-1" })).toBe(-26);
    expect([F.kindAt(back, 2, 4), F.kindAt(back, 15, 4)]).toEqual([F.NONE, F.NONE]);
  });

  test("a tunnel under 5 tiles or fewer is kept and checked as before: its far mouth's byte, its row, its price", () => {
    const y = yard(["deepculvert"]);
    must(y, tunnel(2, 4, 5));
    expect([F.spanByte(5), F.spanByte(-5), F.spanOfByte(3), F.spanOfByte(13)]).toEqual([13, 3, -5, 5]);
    expect([F.spanByte(-12), F.spanOfByte(F.spanByte(-12)), F.spanOfByte(F.spanByte(127))]).toEqual([252, -12, 127]);
    expect(F.worthAt(y, F.at(y, 2, 4))).toBe(12);
  });
});

/** A tunnel going in at (5, 5) facing east under 3 tiles (or a belt there facing east), and a belt pointing at each side of it. */
function mouth(research: readonly string[], belt = false): F.Yard {
  const y = yard(research);
  must(y, belt ? { do: "build", kind: "belt", x: 5, y: 5, dir: 0 } : tunnel(5, 5, 3));
  must(y, { do: "build", kind: "belt", x: 4, y: 5, dir: 0 }); // behind
  must(y, { do: "build", kind: "belt", x: 5, y: 4, dir: 1 }); // its left, coming south
  must(y, { do: "build", kind: "belt", x: 5, y: 6, dir: 3 }); // its right, coming north
  must(y, { do: "build", kind: "belt", x: 6, y: 5, dir: 2 }); // its front, coming west
  return y;
}
const SIDES = [
  [4, 5],
  [5, 4],
  [5, 6],
  [6, 5],
] as const;
const takenFrom = (y: F.Yard): boolean[] => SIDES.map(([x, z]) => F.takes(y, F.at(y, 5, 5), F.at(y, x, z)));

/** What is left in each feeding crate and what reached the far crate, fed from behind, the left and the right of a way in at once. */
function fedFromThree(research: readonly string[]): number[] {
  const y = mouth(research);
  must(y, { do: "remove", x: 6, y: 5 });
  // Crates feeding the three belts, and one where the far mouth hands on.
  const feeds = [
    [3, 5, 0],
    [5, 3, 1],
    [5, 7, 3],
  ] as const;
  for (const [x, z, d] of feeds) must(y, { do: "build", kind: "crate", x, y: z, dir: d });
  must(y, { do: "build", kind: "crate", x: 10, y: 5, dir: 0 });
  must(y, { do: "crate", x: 10, y: 5, open: false });
  for (const [x, z] of feeds) for (let k = 0; k < 5; k++) F.put(y.holders, y.row[F.at(y, x, z)] ?? -1, plank);
  for (let k = 0; k < 3000; k++) F.step(y);
  return [
    ...feeds.map(([x, z]) => F.held(y.holders, y.row[F.at(y, x, z)] ?? -1, plank)),
    F.held(y.holders, y.row[F.at(y, 10, 5)] ?? -1, plank),
  ];
}

/** What is left in each feeding crate and what reached the far crate, fed from behind the way in and from the left and right of the far mouth at once. */
function fedAtExit(research: readonly string[]): number[] {
  const y = yard(research);
  must(y, tunnel(5, 5, 3));
  // One belt behind the way in, and belts pointing into the left and right of the far mouth at (9, 5).
  must(y, { do: "build", kind: "belt", x: 4, y: 5, dir: 0 });
  must(y, { do: "build", kind: "belt", x: 9, y: 4, dir: 1 });
  must(y, { do: "build", kind: "belt", x: 9, y: 6, dir: 3 });
  const feeds = [
    [3, 5, 0],
    [9, 3, 1],
    [9, 7, 3],
  ] as const;
  for (const [x, z, d] of feeds) must(y, { do: "build", kind: "crate", x, y: z, dir: d });
  must(y, { do: "build", kind: "crate", x: 10, y: 5, dir: 0 });
  must(y, { do: "crate", x: 10, y: 5, open: false });
  for (const [x, z] of feeds) for (let k = 0; k < 5; k++) F.put(y.holders, y.row[F.at(y, x, z)] ?? -1, plank);
  for (let k = 0; k < 3000; k++) F.step(y);
  return [
    ...feeds.map(([x, z]) => F.held(y.holders, y.row[F.at(y, x, z)] ?? -1, plank)),
    F.held(y.holders, y.row[F.at(y, 10, 5)] ?? -1, plank),
  ];
}

describe("wide mouths", () => {
  test("are tier 5's, after the deep culvert", () => {
    const g = F.GOALS[F.goal("widemouths")];
    expect([g?.kind, g?.tier, g?.needs.map((n) => F.GOALS[n]?.id), g?.unlocks]).toEqual([
      "research",
      5,
      ["deepculvert"],
      { mouths: true },
    ]);
  });

  test("without them, a tunnel's way in takes from behind alone and its far mouth from none; with them, both mouths take from their left and right, never from behind the far mouth or from the front", () => {
    expect(takenFrom(mouth(["deepculvert"]))).toEqual([true, false, false, false]);
    expect(takenFrom(mouth(["widemouths"]))).toEqual([true, true, true, false]);
    const farSides = [
      [8, 5],
      [9, 4],
      [9, 6],
      [10, 5],
    ] as const;
    const farTaken = (research: readonly string[]): boolean[] => {
      const y = mouth(research);
      return farSides.map(([x, z]) => F.takes(y, F.at(y, 9, 5), F.at(y, x, z)));
    };
    expect(farTaken(["deepculvert"])).toEqual([false, false, false, false]);
    expect(farTaken(["widemouths"])).toEqual([false, true, true, false]);
  });

  test("with them, a way in on a line that crosses it takes in by just the sides a belt facing its way there would", () => {
    expect(takenFrom(mouth(["widemouths"]))).toEqual(takenFrom(mouth(["widemouths"], true)));
    // Without them, a belt there takes from its sides as ever, and the way in does not.
    expect(takenFrom(mouth(["deepculvert"], true))).toEqual([true, true, true, false]);
  });

  test("fed from behind, its left and its right at once, everything goes under and comes up at the far mouth; without them only what comes from behind", () => {
    expect(fedFromThree(["widemouths"])).toEqual([0, 0, 0, 15]);
    // Without: the side belts fill and wait; their crates keep the rest.
    const without = fedFromThree(["deepculvert"]);
    expect([without[0], without[3]]).toEqual([0, 5]);
    expect((without[1] ?? 0) + (without[2] ?? 0)).toBeGreaterThan(0);
  });

  test("fed from behind its way in and from the left and right of its far mouth at once, everything reaches the crate ahead; without them only what came through the tunnel", () => {
    expect(fedAtExit(["widemouths"])).toEqual([0, 0, 0, 15]);
    const without = fedAtExit(["deepculvert"]);
    expect([without[0], without[3]]).toEqual([0, 5]);
    expect((without[1] ?? 0) + (without[2] ?? 0)).toBeGreaterThan(0);
  });
});
