/**
 * The assembler: a crafting hall of 3 by 3 tiles that makes what a bench or a workshop makes, as fast
 * as 9 of them at its grade, keeping 9 times their parts, drawing 9 times their power. It takes parts
 * on its back and both sides and none of its front, hands out of the middle of its front, and is
 * built, priced, raised, moved, copied, kept in blueprints and plans, undone, kept and read back as
 * one piece. A yard holding one, or its research, is kept as a version the last Leaf of version 10
 * leaves alone.
 */
import { describe, expect, test } from "bun:test";

import { act } from "../src/commands.ts";
import * as F from "../src/index.ts";
import { beforeReach, learn } from "./goals.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

const ASSEMBLER = F.kind("assembler");
const land = bareLand(34, 20, [], [26, 10]);
const tile = (y: F.Yard, x: number, z: number): number => F.at(y, x, z);

/** A yard of tier 5 with the assembler studied, and nothing to undo. */
function yard(): F.Yard {
  const y = F.create({ land, tier: 5, seed: 1 });
  learn(y, F.goal("assembler"));
  y.history = [];
  return y;
}

/** Every tile from (x0, z0) to (x1, z1) holds an assembler whose own tile is (ox, oz). */
function covers(y: F.Yard, x0: number, z0: number, x1: number, z1: number, ox: number, oz: number): boolean {
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++)
      if (y.kind[tile(y, x, z)] !== ASSEMBLER || F.pieceOf(y, tile(y, x, z)) !== tile(y, ox, oz)) return false;
  return true;
}
function bare(y: F.Yard, x0: number, z0: number, x1: number, z1: number): boolean {
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) if (y.kind[tile(y, x, z)] !== F.NONE || y.part[tile(y, x, z)] !== 0) return false;
  return true;
}

/**
 * How many a machine on (x, z) told to make `out` finishes in `ticks`, kept fed by hand with its
 * recipe's parts and its finished thing taken each tick, so that nothing but its pace limits it.
 */
function made(y: F.Yard, x: number, z: number, out: F.Item, ticks: number): number {
  expect(F.setRecipe(y, x, z, out)).toBeNull();
  const r = F.holderOf(y, F.pieceOf(y, tile(y, x, z)));
  const rec = F.RECIPE[out];
  if (!rec) throw new Error("no recipe");
  let n = 0;
  for (let t = 0; t < ticks; t++) {
    rec.from.forEach((part, p) => {
      while (F.held(y.holders, r, part) < (rec.need[p] ?? 1)) F.put(y.holders, r, part);
    });
    F.step(y);
    if (y.holders.out[r] !== F.NONE) {
      n++;
      y.holders.out[r] = F.NONE;
    }
  }
  return n;
}

/** What a kind of machine makes, by its recipes; and things in their order. */
const madeBy = (k: F.Kind): F.Item[] => (F.MADE_BY[k] ?? []).map((r) => r.out);
const byOut = (a: number, b: number): number => a - b;

/** A yard with one machine of a kind and grade at (20, 10) facing east, and power enough for it. */
function alone(k: F.Kind, grade: number): F.Yard {
  const y = yard();
  expect(F.build(y, k, 20, 10, 0, Infinity, { grade }).ok).toBe(true);
  return y;
}

describe("the assembler", () => {
  test("is a tier 5 research needing nothing, Timber 8,000 and Brass 6,000, and unlocks grades I to III", () => {
    const g = F.goal("assembler");
    const info = F.GOALS[g];
    expect([info?.tier, info?.kind, info?.needs, info?.want[F.item("timber")], info?.want[F.item("brass")]]).toEqual([
      5,
      "research",
      [],
      8000,
      6000,
    ]);
    expect(F.locked(F.create({ land, tier: 5, seed: 1 }).open, { build: ASSEMBLER })).toBe(
      "The assembler is not unlocked yet",
    );
    expect(F.highest(yard().open, ASSEMBLER)).toBe(3);
    expect(F.SIZE_W[ASSEMBLER]).toBe(3);
    expect(F.SIZE_H[ASSEMBLER]).toBe(3);
  });

  test("costs 400 Coins at grade I and the usual grade price after; draws 9 times a bench's power at each grade", () => {
    expect([1, 2, 3].map((g) => F.price(ASSEMBLER, g))).toEqual([400, 1200, 3200]);
    for (const g of [1, 2, 3]) expect(F.drawnAt(ASSEMBLER, g)).toBe(9 * F.drawnAt(F.BENCH, g));
  });

  test("makes every recipe a bench or a workshop makes, and no other", () => {
    expect(madeBy(ASSEMBLER).toSorted(byOut)).toEqual([...madeBy(F.BENCH), ...madeBy(F.WORKSHOP)].toSorted(byOut));
    const y = alone(ASSEMBLER, 1);
    expect(F.setRecipe(y, 20, 10, F.item("plank"))).toBe("That cannot make it");
    expect(F.setRecipe(y, 21, 11, F.item("lantern"))).toBeNull();
  });

  for (const grade of [1, 2, 3])
    test(`at grade ${grade}, makes a bench recipe at 9 times a bench's pace and a workshop recipe at 9 times a workshop's`, () => {
      const ticks = 1800;
      const tool = F.item("tool");
      const lantern = F.item("lantern");
      const bench = made(alone(F.BENCH, grade), 20, 10, tool, ticks);
      const workshop = made(alone(F.WORKSHOP, grade), 20, 10, lantern, ticks);
      expect(bench).toBeGreaterThan(0);
      expect(workshop).toBeGreaterThan(0);
      expect(made(alone(ASSEMBLER, grade), 20, 10, tool, ticks)).toBe(9 * bench);
      expect(made(alone(ASSEMBLER, grade), 20, 10, lantern, ticks)).toBe(9 * workshop);
      // And the planner, and every card, says the same: one assembler is 9 benches or 9 workshops.
      for (const n of [tool, lantern]) {
        const rec = F.RECIPE[n];
        if (!rec) throw new Error("no recipe");
        expect(F.makes(ASSEMBLER, grade, rec)).toBe(9 * F.makes(rec.by, grade, rec));
        const nine = F.feeders(grade, rec, grade).map((f) => 9 * f.count);
        F.feeders(grade, rec, grade, ASSEMBLER).forEach((f, p) => expect(f.count).toBeCloseTo(nine[p] ?? 0, 9));
      }
    });

  test("does no more a minute than the belt it hands to carries, and its parts and feeders are counted for that", () => {
    const tool = F.RECIPE[F.item("tool")];
    if (!tool) throw new Error("no recipe");
    const rate = (grade: number, belt: number | null): F.MachineRate => {
      const y = alone(ASSEMBLER, grade);
      F.setRecipe(y, 20, 10, F.item("tool"));
      if (belt !== null) F.build(y, F.BELT, 22, 10, 0, Infinity, { grade: belt });
      return F.machineRate(y, tile(y, 21, 11), tool);
    };
    // Grade I makes 270 a minute: onto a grade I belt (150 a minute) it does 150; onto grade III (300), or
    // onto nothing yet, all 270. Grade III makes 540; onto a grade III belt it does 300.
    expect([rate(1, 1), rate(1, 3), rate(1, null), rate(3, 3)].map((r) => [r.nominal, r.effective, r.most])).toEqual([
      [270, 150, 150],
      [270, 270, null],
      [270, 270, null],
      [540, 300, 300],
    ]);
    // What 150 tools a minute take, and the mills that make that much.
    expect(F.needs(1, tool, ASSEMBLER, 150).map((n) => n.perMinute)).toEqual([150, 150]);
    const flat = F.feeders(1, tool, 1, ASSEMBLER).map((f) => f.count);
    F.feeders(1, tool, 1, ASSEMBLER, 150).forEach((f, p) =>
      expect(f.count).toBeCloseTo(((flat[p] ?? 0) * 150) / 270, 9),
    );
  });

  test("told nothing, makes the recipe of the most kinds of part it holds: a clock, not a banner pole, from gears, frames and glass", () => {
    const y = alone(ASSEMBLER, 1);
    const r = F.holderOf(y, tile(y, 20, 10));
    for (const [n, c] of [
      ["gear", 2],
      ["frame", 1],
      ["glass", 1],
    ] as const)
      for (let k = 0; k < c; k++) F.put(y.holders, r, F.item(n));
    for (let t = 0; t < 40 && y.holders.out[r] === F.NONE; t++) F.step(y);
    expect(y.holders.out[r]).toBe(F.item("clock"));
    // With no glass, the banner pole is all it can make.
    const pole = alone(ASSEMBLER, 1);
    const p = F.holderOf(pole, tile(pole, 20, 10));
    F.put(pole.holders, p, F.item("gear"));
    F.put(pole.holders, p, F.item("frame"));
    for (let t = 0; t < 40 && pole.holders.out[p] === F.NONE; t++) F.step(pole);
    expect(pole.holders.out[p]).toBe(F.item("pole"));
  });

  test("full of one part it stops taking, is in trouble, and says which part blocks the belt", () => {
    const y = alone(ASSEMBLER, 1);
    expect(F.build(y, F.CRATE, 17, 10, 0, Infinity).ok).toBe(true);
    for (let n = 0; n < 200; n++) F.put(y.holders, F.holderOf(y, tile(y, 17, 10)), F.item("glass"));
    F.build(y, F.BELT, 18, 10, 0, Infinity);
    for (let t = 0; t < 1200; t++) F.step(y);
    const r = F.holderOf(y, tile(y, 20, 10));
    // A clock takes 1 glass, the fewest of any recipe that uses it: 4 recipes' worth, 9 times over.
    expect(F.held(y.holders, r, F.item("glass"))).toBe(36);
    expect(y.item[tile(y, 18, 10)]).toBe(F.item("glass"));
    const said = F.status(y, tile(y, 20, 10));
    expect([said?.state, said?.trouble, said?.spare]).toEqual(["starved", true, F.item("glass")]);
    expect(said?.line.startsWith("Full of glass and waiting for")).toBe(true);
  });

  test("a run of belt aimed at any of its tiles ends at the nearest tile-side that takes things in, facing any way", () => {
    for (const d of [0, 1, 2, 3] as const) {
      const y = yard();
      expect(F.build(y, ASSEMBLER, 14, 10, d, Infinity).ok).toBe(true);
      // From the west, from the north: aimed at its middle and at a corner.
      for (const [from, aim] of [
        [
          [6, 10],
          [14, 10],
        ],
        [
          [14, 2],
          [15, 11],
        ],
      ] as const) {
        const legs = F.route(y, from, aim, { tunnels: false });
        const last = legs?.at(-1);
        const into = last ? tile(y, last.x + (F.DX[last.dir] ?? 0), last.y + (F.DY[last.dir] ?? 0)) : -1;
        expect([d, from, legs !== null, into >= 0 && F.pieceOf(y, into) === tile(y, 14, 10)]).toEqual([
          d,
          from,
          true,
          true,
        ]);
        expect(last && F.takes(y, into, tile(y, last.x, last.y))).toBe(true);
      }
    }
  });

  test("short of power onto a belt that carries more, delivers what its card says: it holds a finished item for each bench it stands in for", () => {
    const y = yard();
    const pole = F.item("pole");
    expect(F.build(y, ASSEMBLER, 20, 10, 0, Infinity, { grade: 3 }).ok).toBe(true);
    // Two more halls and a bench beside it draw the yard short of power: 184 drawn, 100 made, so it makes
    // 196 of the 200 a minute its grade II belt carries, close enough that its belt's timing would show.
    expect(F.build(y, ASSEMBLER, 20, 5, 0, Infinity, { grade: 3 }).ok).toBe(true);
    expect(F.build(y, ASSEMBLER, 20, 15, 0, Infinity, { grade: 1 }).ok).toBe(true);
    expect(F.build(y, F.BENCH, 24, 14, 0, Infinity).ok).toBe(true);
    expect(F.setRecipe(y, 20, 10, pole)).toBeNull();
    for (let x = 22; x <= 24; x++) expect(F.build(y, F.BELT, x, 10, 0, Infinity, { grade: 2 }).ok).toBe(true);
    const own = tile(y, 20, 10);
    const r = F.holderOf(y, own);
    const fed = (): void => {
      for (const n of [F.item("frame"), F.item("gear")]) while (F.held(y.holders, r, n) < 4) F.put(y.holders, r, n);
    };
    for (let t = 0; t < 600; t++) {
      fed();
      F.step(y);
    }
    const said = F.machineRate(y, own, F.RECIPE[pole] ?? null);
    expect(said.share).toBeLessThan(1);
    expect(said.most).toBeNull();
    expect(said.effective).toBeGreaterThan(190);
    const before = y.depot[pole] ?? 0;
    for (let t = 0; t < 15 * 600; t++) {
      fed();
      F.step(y);
    }
    const perMinute = ((y.depot[pole] ?? 0) - before) / 15;
    expect(Math.abs(perMinute - said.effective) / said.effective).toBeLessThan(0.01);
    // It never holds more than 9 finished at once.
    expect((y.holders.more[r] ?? 0) + 1).toBeLessThanOrEqual(9);
  });

  test("its finished items wait behind the first, are kept and read back, and a bench still holds 1", () => {
    const y = alone(ASSEMBLER, 1);
    const r = F.holderOf(y, tile(y, 20, 10));
    made(y, 20, 10, F.item("tool"), 0);
    for (let t = 0; t < 200; t++) {
      for (const n of [F.item("plank"), F.item("ingot")]) while (F.held(y.holders, r, n) < 2) F.put(y.holders, r, n);
      F.step(y);
    }
    // Nothing ahead of its way out: 9 tools held, and it says it is blocked.
    expect([y.holders.out[r], (y.holders.more[r] ?? 0) + 1]).toEqual([F.item("tool"), 9]);
    expect(F.status(y, tile(y, 20, 10))?.state).toBe("blocked");
    const read = F.decode(F.encode(y), land);
    expect(
      read && [
        read.holders.out[F.holderOf(read, tile(read, 20, 10))],
        read.holders.more[F.holderOf(read, tile(read, 20, 10))],
      ],
    ).toEqual([F.item("tool"), 8]);
    expect(read && F.check(read)).toBe(F.check(y));
    // A belt ahead takes them one by one.
    F.build(y, F.BELT, 22, 10, 0, Infinity);
    for (let t = 0; t < 20; t++) F.step(y);
    expect(y.item[tile(y, 22, 10)]).toBe(F.item("tool"));
    // A bench with nowhere to send its tool holds the one.
    const b = alone(F.BENCH, 1);
    const br = F.holderOf(b, tile(b, 20, 10));
    made(b, 20, 10, F.item("tool"), 0);
    for (let t = 0; t < 400; t++) {
      for (const n of [F.item("plank"), F.item("ingot")]) while (F.held(b.holders, br, n) < 2) F.put(b.holders, br, n);
      F.step(b);
    }
    expect([b.holders.out[br], b.holders.more[br]]).toEqual([F.item("tool"), 0]);
  });

  test("keeps 9 times what a bench keeps of each part, and tips out what it no longer keeps when told otherwise", () => {
    const plank = F.item("plank");
    const hamper = F.item("hamper");
    const held = (k: F.Kind): number => {
      const y = alone(k, 1);
      expect(F.setRecipe(y, 20, 10, hamper)).toBeNull();
      // A crate of planks feeding its back, and no pots: it fills with planks and waits.
      expect(F.build(y, F.CRATE, 17, 10, 0, Infinity).ok).toBe(true);
      for (let n = 0; n < 200; n++) F.put(y.holders, F.holderOf(y, tile(y, 17, 10)), plank);
      F.build(y, F.BELT, k === ASSEMBLER ? 18 : 19, 10, 0, Infinity);
      if (k !== ASSEMBLER) F.build(y, F.BELT, 18, 10, 0, Infinity);
      for (let t = 0; t < 1200; t++) F.step(y);
      return F.held(y.holders, F.holderOf(y, F.pieceOf(y, tile(y, 20, 10))), plank);
    };
    expect([held(F.BENCH), held(ASSEMBLER)]).toEqual([8, 72]);
    const y = alone(ASSEMBLER, 1);
    expect(F.setRecipe(y, 20, 10, hamper)).toBeNull();
    const r = F.holderOf(y, tile(y, 20, 10));
    for (let n = 0; n < 72; n++) F.put(y.holders, r, plank);
    // A tool takes 1 plank where a hamper takes 2: it keeps 36.
    expect(F.setRecipe(y, 20, 10, F.item("tool"))).toBeNull();
    expect(F.held(y.holders, r, plank)).toBe(36);
  });

  test("takes parts on its back and both sides, 9 tile-sides, none on its front; hands out of the middle of its front alone", () => {
    const y = alone(ASSEMBLER, 1);
    // It covers 19 to 21 across and 9 to 11 down, facing east.
    expect(covers(y, 19, 9, 21, 11, 20, 10)).toBe(true);
    const takes = (x: number, z: number, fx: number, fz: number): boolean => F.takes(y, tile(y, x, z), tile(y, fx, fz));
    const back = [9, 10, 11].map((z) => takes(19, z, 18, z));
    const sides = [19, 20, 21].flatMap((x) => [takes(x, 9, x, 8), takes(x, 11, x, 12)]);
    const front = [9, 10, 11].map((z) => takes(21, z, 22, z));
    expect([back, sides, front]).toEqual([[true, true, true], Array(6).fill(true), [false, false, false]]);

    // Planks on its back and ingots on its north side make tools, which leave by (22, 10), onto belts to the depot;
    // with belts by the other two tiles of its front alone, nothing leaves, and it says so.
    const line = (outs: readonly number[]): F.Yard => {
      const l = alone(ASSEMBLER, 1);
      for (const [x, z, d, raw] of [
        [17, 10, 0, "plank"],
        [20, 6, 1, "ingot"],
      ] as const) {
        expect(F.build(l, F.CRATE, x, z, d, Infinity).ok).toBe(true);
        for (let n = 0; n < 200; n++) F.put(l.holders, F.holderOf(l, tile(l, x, z)), F.item(raw));
      }
      F.build(l, F.BELT, 18, 10, 0, Infinity);
      F.build(l, F.BELT, 20, 7, 1, Infinity);
      F.build(l, F.BELT, 20, 8, 1, Infinity);
      for (const z of outs) for (let x = 22; x <= 24; x++) F.build(l, F.BELT, x, z, 0, Infinity);
      for (let t = 0; t < 1200; t++) F.step(l);
      return l;
    };
    const out = line([10]);
    expect(out.depot[F.item("tool")] ?? 0).toBeGreaterThan(20);
    const beside = line([9, 11]);
    const said = F.status(beside, tile(beside, 20, 10));
    expect([beside.depot[F.item("tool")] ?? 0, said?.state, said?.stuck]).toEqual([0, "blocked", F.item("tool")]);
  });

  test("hands nothing on while nothing stands ahead of its way out, and says so", () => {
    const y = alone(ASSEMBLER, 1);
    made(y, 20, 10, F.item("tool"), 0);
    const r = F.holderOf(y, tile(y, 20, 10));
    F.put(y.holders, r, F.item("plank"));
    F.put(y.holders, r, F.item("ingot"));
    for (let t = 0; t < 100; t++) F.step(y);
    expect(y.holders.out[r]).toBe(F.item("tool"));
    const said = F.status(y, tile(y, 21, 11));
    expect([said?.state, said?.trouble, said?.line]).toEqual([
      "blocked",
      true,
      "Nowhere to send its tools: nothing is on the tile it points at.",
    ]);
  });

  test("is built, refunded, raised (from its card too), turned, moved, copied, blueprinted and coded as one piece", () => {
    const y = yard();
    const till = y.till;
    expect(F.build(y, ASSEMBLER, 20, 10, 0, Infinity)).toEqual({ ok: true, cost: 400 });
    expect(F.refusal(y, F.BELT, 21, 11, Infinity)).toBe("Something is here already");
    expect(F.refusal(y, ASSEMBLER, 33, 5, Infinity)).toBe("That is off the map");
    // Raised from its card, from a corner: the grade command for its one piece, at the difference.
    const raised = act(
      y,
      { do: "upgrade", tiles: [tile(y, 19, 9)], raise: { kind: ASSEMBLER, from: 1, grade: 2 } },
      Infinity,
      "r1",
    );
    expect("refused" in raised).toBe(false);
    expect([y.grade[tile(y, 20, 10)], covers(y, 19, 9, 21, 11, 20, 10)]).toEqual([2, true]);
    // Turned from a corner: a square keeps its tiles.
    expect(F.turn(y, 21, 11, 1) && y.dir[tile(y, 20, 10)] === 1 && covers(y, 19, 9, 21, 11, 20, 10)).toBe(true);
    expect(F.remove(y, 19, 11)).toEqual({ ok: true, refund: 1200 });
    expect(bare(y, 19, 9, 21, 11)).toBe(true);
    expect(y.till).toBe(till);

    const moving = alone(ASSEMBLER, 1);
    expect(F.move(moving, F.within(moving, 19, 9, 21, 11), 1, 6, 14)).toBeNull();
    expect([covers(moving, 6, 14, 8, 16, 7, 15), moving.dir[tile(moving, 7, 15)], bare(moving, 19, 9, 21, 11)]).toEqual(
      [true, 1, true],
    );

    const copying = alone(ASSEMBLER, 1);
    F.setRecipe(copying, 20, 10, F.item("gear"));
    const copy = F.copyOf(copying, F.within(copying, 19, 9, 21, 11), 0, 6, 14);
    expect(copy !== null && F.stand(copying, copy, Infinity).ok).toBe(true);
    expect([covers(copying, 6, 14, 8, 16, 7, 15), copying.set[tile(copying, 7, 15)]]).toEqual([true, F.item("gear")]);

    const printing = alone(ASSEMBLER, 1);
    expect(F.saveBlueprint(printing, 1, F.within(printing, 19, 9, 21, 11))).toBeNull();
    const pieces = F.blueprintAt(printing, 1, 0, 6, 14) ?? [];
    expect(F.stand(printing, pieces, Infinity).ok && covers(printing, 6, 14, 8, 16, 7, 15)).toBe(true);
    const print = printing.blueprints[1];
    const code = print ? F.blueprintCode(print) : null;
    expect(code !== null && print ? F.codePieces(code) : null).toEqual(print ? F.piecesOf(print.pieces) : null);
  });

  test("is kept in a plan of the whole yard and put back; building and removing it are undone", () => {
    const whole = yard();
    F.build(whole, ASSEMBLER, 20, 10, 0, Infinity);
    expect(F.saveYard(whole, 1)).toBeNull();
    F.remove(whole, 21, 11);
    const plan = whole.blueprints[1];
    expect(plan !== null && plan !== undefined && F.placeYard(whole, plan, Infinity).ok).toBe(true);
    expect(covers(whole, 19, 9, 21, 11, 20, 10)).toBe(true);

    const y = yard();
    must(y, { id: "b1", do: "build", kind: "assembler", x: 10, y: 10, dir: 0 });
    expect(covers(y, 9, 9, 11, 11, 10, 10)).toBe(true);
    must(y, { id: "u1", do: "undo", entry: "b1" });
    expect(bare(y, 9, 9, 11, 11)).toBe(true);
    F.build(y, ASSEMBLER, 10, 10, 0, Infinity);
    must(y, { id: "r1", do: "remove", x: 11, y: 11 });
    expect(bare(y, 9, 9, 11, 11)).toBe(true);
    must(y, { id: "u2", do: "undo", entry: "r1" });
    expect(covers(y, 9, 9, 11, 11, 10, 10)).toBe(true);
  });

  test("is kept and read back at work, with the same check", () => {
    const y = alone(ASSEMBLER, 3);
    made(y, 20, 10, F.item("lantern"), 77);
    const r = F.holderOf(y, tile(y, 20, 10));
    F.put(y.holders, r, F.item("glass"));
    F.step(y);
    expect(y.holders.work[r]).toBeGreaterThan(F.PACE[3] ?? 0);
    const read = F.decode(F.encode(y), land);
    expect(read !== null && covers(read, 19, 9, 21, 11, 20, 10)).toBe(true);
    expect(read && F.check(read)).toBe(F.check(y));
    // Run on, the copy read back plays as the yard does.
    for (let t = 0; t < 300; t++) {
      F.step(y);
      if (read) F.step(read);
    }
    expect(read && F.check(read)).toBe(F.check(y));
  });
});

/** The version a yard is kept as. */
const versionOf = (y: F.Yard): unknown => JSON.parse(F.encode(y)).v;
/** A yard of tier 5 with nothing past version 10 in it (no reach research). */
const plain = (): F.Yard => beforeReach(F.create({ land, tier: 5, seed: 1 }));
/** A yard with the assembler's research forgotten: what it keeps past 10 is the rest of it alone. */
function forget(y: F.Yard): F.Yard {
  y.done = y.done.filter((g) => g !== F.goal("assembler"));
  F.reopen(y);
  return y;
}

describe("a yard with the assembler is a later Leaf's", () => {
  test("its research known, in the line or given folios, or one standing, in a blueprint, in a plan or in Undo: kept as this version", () => {
    const known = plain();
    learn(known, F.goal("assembler"));
    known.history = [];
    const lined = plain();
    must(lined, { do: "study", research: "assembler" });
    const given = plain();
    must(given, { do: "study", research: "assembler" });
    F.giveGoal(given, F.goal("assembler"), F.item("timber"), 10);
    const standing = (): F.Yard => {
      const y = plain();
      learn(y, F.goal("assembler"));
      F.build(y, ASSEMBLER, 20, 10, 0, Infinity);
      y.history = [];
      return y;
    };
    const built = forget(standing());
    const printed = standing();
    F.saveBlueprint(printed, 1, F.within(printed, 19, 9, 21, 11));
    F.remove(printed, 20, 10);
    printed.history = [];
    const planned = standing();
    F.saveYard(planned, 1);
    F.remove(planned, 20, 10);
    planned.history = [];
    const undoable = standing();
    must(undoable, { id: "h1", do: "remove", x: 20, y: 10 });
    const yards = {
      known,
      lined,
      given,
      built,
      printed: forget(printed),
      planned: forget(planned),
      undoable: forget(undoable),
    };
    expect(Object.fromEntries(Object.entries(yards).map(([n, y]) => [n, versionOf(y)]))).toEqual(
      Object.fromEntries(Object.keys(yards).map((n) => [n, F.VERSION])),
    );
    // Asked cheaply, each says what the whole scan says.
    for (const y of Object.values(yards)) {
      const names = F.namesOf(JSON.parse(F.encode(y)), y.land);
      expect([F.pastTen(y), names && F.knownAt10(names)]).toEqual([true, false]);
    }
    // And with nothing of it, kept as version 9.
    expect(versionOf(plain())).toBe(F.PLACED);
  });
});
