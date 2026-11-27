/**
 * The land grows by rings of plots, and nothing kept moves (`keptland.ts`). A ring of throwaway plots
 * is added round the guild's land (`ring.ts`), and every yard the tests make, kept on the guild's land,
 * reads on the larger one with every piece, redwood felled and plan in the same place from the depot,
 * the same check, and the same run tick by tick; and every save in `saves/` reads as version 8 read it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { rulesModules } from "@sequoia-leaf/core";

import * as F from "../src/index.ts";
import { outward, RINGED } from "./ring.ts";
import { delivering, junctions, saved, SAVES, staged } from "./yards.ts";

const read8: unknown = await Bun.file(`${import.meta.dir}/saves/read-v8.json`).json();
/** A save as version 8 kept it once it had read it, from `saves/read-v8.json`. */
function asRead8(name: string): string {
  const text = typeof read8 === "object" && read8 !== null ? Reflect.get(read8, name) : undefined;
  if (typeof text !== "string") throw new Error(`no ${name} in read-v8.json`);
  return text;
}
const fixture = async (name: string): Promise<string> => {
  const raw: unknown = await Bun.file(`${import.meta.dir}/saves/${name}.json`).json();
  const text = typeof raw === "object" && raw !== null ? Reflect.get(raw, "text") : undefined;
  if (typeof text !== "string") throw new Error(`${name} is not a save`);
  return text;
};

/** A yard read back from text on a land, or a failed test. */
function read(text: string, land: F.Land): F.Yard {
  const y = F.decode(text, land);
  if (!y) throw new Error("the yard does not read");
  return y;
}

/** A column and row as far east and south of a yard's depot. */
const fromDepot = (y: F.Yard, x: number, z: number): [number, number] => [x - y.land.depot[0], z - y.land.depot[1]];
/** The tile at a column and row of a yard's land, as far from its depot. */
const tileFromDepot = (y: F.Yard, i: number): [number, number] => fromDepot(y, i % y.land.w, Math.floor(i / y.land.w));
/** A piece with its place from a yard's depot. */
const pieceFromDepot = (y: F.Yard, p: F.Piece): F.Piece =>
  Object.assign({}, p, { x: 0, y: 0, at: fromDepot(y, p.x, p.y) });

/** Everything kept with a place, each place from the depot: the pieces, the redwoods felled, the blueprints' pieces. */
function places(y: F.Yard) {
  const pieces = F.piecesAt(y, [...y.kind.keys()]).map((p) => pieceFromDepot(y, p));
  const felled = y.land.trees.flatMap((tiles, t) => (y.felled[t] === 1 ? [tileFromDepot(y, tiles[0] ?? 0)] : []));
  // A plan of the whole yard is kept on the land's tiles; a blueprint, from the corner of its box.
  const plans = y.blueprints.map((b) => b && F.piecesOf(b.pieces).map((p) => (b.whole ? pieceFromDepot(y, p) : p)));
  return { pieces, felled, plans };
}

/** The yards the tests make, and the saves: each kept as text on the guild's land. */
const YARDS: readonly (readonly [string, () => F.Yard])[] = [
  ["staged gate", () => staged("gate")],
  ["staged large", () => staged("large")],
  ["delivering", () => delivering()],
  ["junctions", () => junctions()],
  ...SAVES.map((name) => [`save ${name}`, () => saved(name)] as const),
];

describe("a ring of plots round the land", () => {
  test("is more land every way, the yard plot still where the plots table places it", () => {
    expect([RINGED.w, RINGED.h]).toEqual([F.LAND.w + 2 * F.PLOT_W, F.LAND.h + 2 * F.PLOT_H]);
    expect(RINGED.origin).toEqual([F.LAND.origin[0] + F.PLOT_W, F.LAND.origin[1] + F.PLOT_H]);
    expect(fromDepot(staged("new"), ...F.LAND.origin)).toEqual([-8, -6]);
    expect(RINGED.trees.length).toBe(F.LAND.trees.length + RINGED.plots.length - F.LAND.plots.length);
  });

  for (const [name, make] of YARDS)
    test(`${name}: read on it, everything is where it was from the depot, with the same check and the same run`, () => {
      const text = F.encode(make());
      const small = read(text, F.LAND);
      const large = read(text, RINGED);
      expect(places(large)).toEqual(places(small));
      // What Undo would undo is never kept past the land it was made on (`history.ts`).
      expect(large.history).toEqual([]);
      small.history = [];
      expect(F.check(large)).toBe(F.check(small));
      // Kept on the larger land, it reads back on it the same; on the guild's land, a Leaf with less
      // land, it does not read at all, and is a newer Leaf's, to be left as it is.
      expect(F.check(read(F.encode(large), RINGED))).toBe(F.check(large));
      expect([F.decode(F.encode(large), F.LAND), F.keptLater(F.encode(large))]).toEqual([null, true]);
      expect(F.keptLater(text)).toBe(false);
      // An hour on, the same tick by tick: every tick of the first minute, then every minute.
      for (let t = 1; t <= 60 * F.MINUTE; t++) {
        F.step(small);
        F.step(large);
        if (t <= F.MINUTE || t % F.MINUTE === 0) {
          expect(F.check(large)).toBe(F.check(small));
          expect(F.drain(large)).toEqual(F.drain(small));
        }
      }
      expect(places(large)).toEqual(places(small));
    });
});

describe("the version of the Works' rules", () => {
  test("covers the land: the plots table and the land made from it are modules the rules run", () => {
    const root = join(import.meta.dir, "..", "..", "..");
    const file = (path: string): string | null => {
      try {
        return readFileSync(join(root, path), "utf8");
      } catch {
        return null;
      }
    };
    const modules = [...rulesModules("works", file).keys()];
    expect(modules).toEqual(
      expect.arrayContaining(["packages/factory/src/content/plots.ts", "packages/factory/src/land.ts"]),
    );
  });
});

describe("a Leaf with less land", () => {
  test("never reads a yard kept on more land: it is a newer Leaf's, left as it is, not read with its ring paid back", () => {
    const y = outward();
    expect([y.kind.includes(F.CRATE), y.felled.includes(1), y.blueprints[0]?.whole]).toEqual([true, true, true]);
    const text = F.encode(y);
    expect(F.decode(text, F.LAND)).toBeNull();
    expect([F.keptLater(text), F.keptLater(text, RINGED)]).toEqual([true, false]);
  });

  test("never reads a yard that owns a plot its land lacks, wherever its pieces are", () => {
    const y = F.create({ seed: 5 });
    const record: unknown = JSON.parse(F.encode(y));
    const kept = JSON.stringify(Object.assign({}, record, { plots: ["yard", "moon"] }));
    expect([F.decode(kept), F.keptLater(kept)]).toEqual([null, true]);
  });
});

describe("every save in saves/", () => {
  for (const name of SAVES)
    test(`${name} reads as version 8 read it, on the guild's land and on a larger one`, async () => {
      const text = await fixture(name);
      const kept8 = asRead8(name);
      for (const land of [F.LAND, RINGED]) {
        const now = read(text, land);
        const then = read(kept8, land);
        expect(places(now)).toEqual(places(then));
        expect(F.check(now)).toBe(F.check(then));
        expect(F.encode(now)).toBe(F.encode(then));
      }
    });
});
