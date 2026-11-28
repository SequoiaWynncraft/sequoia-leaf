/**
 * A staged top yard at the opening of tier 5 that makes what its commission wants (`townlight`: 800
 * telegraphs, 800 strings of lights, 600 Spark folios) by the real rules, from salvage. Three breaker
 * lines each sort their mixed belt (SPEC-2 section 0.2): slag to a mill (gravel, into the depot),
 * copper to a mill (wire), and one more part of the mix to where it is wanted; the rest of each belt
 * goes into the depot.
 *
 * - The coil line: its wire and ingots straight into a coil bench, whose coils run past the telegraph
 *   workshop and the Spark folio workshop, a splitter putting each first.
 * - The bulb line: its wire and glass (with sand pressed into more glass beside it) straight into a
 *   bulb bench, whose bulbs run past all three workshops the same way.
 * - The lights line: its wire into the lights workshop, its gears into the folio workshop.
 *
 * Frames and banner poles come from the yard's tier 4 lines: here, crates of them stacked against the
 * telegraph and lights workshops. Without a way for its slag (`slag: false`), each line's slag rides
 * on to the depot, which does not take it, and the line stops there.
 */
import * as F from "../src/index.ts";
import { learn } from "./goals.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

type At = readonly [number, number];
/** The breaker lines' rows, west of the workshops. */
const COIL = 6;
const BULB = 16;
const LIGHTS = 32;
/** Boilers along the bottom, each fed deadfall from beneath, for the power the depot does not give. */
const BOILERS = [4, 10, 16, 22, 28, 34];
/** The depot's middle. */
const DEPOT: At = [64, 22];
/** The workshops, in a row facing north: telegraph, lights, Spark folio. */
const TELEGRAPH: At = [40, 22];
const LIGHT: At = [44, 22];
const SPARK: At = [48, 22];

/** The land: bare, with salvage under each line's gatherers and sand by the bulb bench. */
function land(): F.Land {
  const deposits: (readonly [number, number, F.ItemName])[] = [];
  for (const row of [COIL, BULB, LIGHTS])
    deposits.push([2, row, "salvage"], [2, row + 1, "salvage"], [3, row - 1, "salvage"]);
  deposits.push([8, BULB - 2, "sand"], [9, BULB - 3, "sand"]);
  for (const x of BOILERS) deposits.push([x, 41, "deadfall"]);
  return bareLand(70, 44, deposits, DEPOT);
}

/** Lays a run of grade III belt from a tile to another, or into what stands there, as the page's router lays one. */
function lay(y: F.Yard, from: At, to: At): void {
  const legs = F.route(y, from, to);
  if (!legs) throw new Error(`no way from ${from.join(",")} to ${to.join(",")}\n${sketch(y, 0, 40, 22, 40)}`);
  for (const l of legs) Object.assign(l, { grade: 3 });
  must(y, F.writeAct({ do: "lay", legs }));
}
/** Builds a piece at grade III. */
const build = (y: F.Yard, kind: string, at: At, dir: number): void =>
  must(y, { do: "build", kind, x: at[0], y: at[1], dir, grade: 3 });
/** Fills a crate with things, as the yard's own lines would have. */
function stock(y: F.Yard, at: At, name: F.ItemName, n: number): void {
  const r = F.holderOf(y, F.at(y, at[0], at[1]));
  for (let k = 0; k < n; k++) F.put(y.holders, r, F.item(name));
}

/**
 * A breaker line along `row`, east: three gatherers on salvage into a breaker, then sorters on its
 * belt: slag (if `slag`) north into a mill, copper north into a mill, and `third` north. Gives where
 * the gravel, the wire and the third part come out, and where the rest goes on.
 */
function line(y: F.Yard, row: number, third: F.ItemName, slag: boolean): { gravel: At; wire: At; third: At; rest: At } {
  build(y, "gatherer", [2, row], 0);
  build(y, "gatherer", [2, row + 1], 0);
  build(y, "gatherer", [3, row - 1], 1);
  build(y, "breaker", [3, row], 0);
  for (let x = 5; x <= 14; x++) if (x !== 10 && x !== 13 && (x !== 7 || !slag)) build(y, "belt", [x, row], 0);
  if (slag) {
    build(y, "sorter", [7, row], 0);
    must(y, { do: "sort", x: 7, y: row, item: "slag" });
    build(y, "mill", [7, row - 1], 3);
  }
  build(y, "sorter", [10, row], 0);
  must(y, { do: "sort", x: 10, y: row, item: "copper" });
  build(y, "mill", [10, row - 1], 3);
  build(y, "sorter", [13, row], 0);
  must(y, { do: "sort", x: 13, y: row, item: third });
  return { gravel: [7, row - 2], wire: [10, row - 2], third: [13, row - 1], rest: [15, row] };
}

/**
 * A branch off a line at `at`, facing north: a splitter putting the way ahead (north) first, its right
 * way (east) spilling down onto the line's belt on `row` again, its left shut, so that a full bench or
 * workshop never stops the line behind it: what it spills goes on with the rest into the depot. Gives
 * the tile ahead of it.
 */
function branch(y: F.Yard, at: At, row: number): At {
  build(y, "splitter", at, 3);
  must(y, { do: "first", x: at[0], y: at[1], way: 0 });
  must(y, { do: "way", x: at[0], y: at[1], way: 1, open: false });
  for (let z = at[1]; z < row; z++) build(y, "belt", [at[0] + 1, z], 1);
  return [at[0], at[1] - 1];
}

/** Its third part up from its sorter through a branch, and west along the row above into the bench on its wire mill. */
function intoBench(y: F.Yard, row: number): void {
  for (const x of [13, 12, 11]) build(y, "belt", [x, row - 2], 2);
  branch(y, [13, row - 1], row);
}

/** The staged yard: tier 5 open, the commission's research known and the commission in hand. */
export function townlightYard(slag = true): F.Yard {
  const y = F.create({ land: land(), tier: 5, seed: 3 });
  for (const id of ["breaker3", "windings", "bulbs", "sparkfolio", "telegraphy", "lightstrings"]) learn(y, F.goal(id));
  y.history = [];
  // Power: pylons above and below everything and over the workshops, each within reach of the next and of the depot.
  for (const z of [11, 27, 36]) for (let x = 1; x <= 61; x += 6) build(y, "pylon", [x, z], 0);
  for (const x of [37, 43, 49, 55, 59]) build(y, "pylon", [x, 18], 0);
  for (const at of [
    [12, 8],
    [4, 8],
    [1, 32],
  ] as const)
    build(y, "pylon", at, 0);
  for (const x of BOILERS) {
    must(y, { do: "build", kind: "boiler", x, y: 40, dir: 0 });
    build(y, "gatherer", [x, 41], 3);
  }

  // The workshops, and what stands against them first: frames and poles stacked in crates on their
  // east sides, and the ends of the runs into them.
  for (const at of [TELEGRAPH, LIGHT, SPARK]) build(y, "workshop", at, 3);
  for (const [at, name] of [
    [[41, 22], "frame"],
    [[42, 22], "frame"],
    [[45, 22], "pole"],
    [[46, 22], "pole"],
  ] as const) {
    build(y, "crate", at, 2);
    stock(y, at, name, y.open.crate);
  }
  for (const [at, dir] of [
    // Bulbs dropping from the bulb belt into each workshop's west side.
    [[39, 21], 1],
    [[39, 22], 0],
    [[43, 21], 1],
    [[43, 22], 0],
    [[47, 21], 1],
    [[47, 22], 0],
    // Coils up into the telegraph and folio workshops' backs; wire up into the lights workshop's.
    [[40, 23], 3],
    [[48, 23], 3],
    [[44, 23], 3],
    // Gears into the folio workshop's east side.
    [[49, 22], 2],
  ] as const)
    build(y, "belt", at, dir);
  // The coil belt east along row 24 and the bulb belt east along row 20, a splitter at each workshop putting it first.
  for (let x = 38; x <= 47; x++) if (x !== 40) build(y, "belt", [x, 24], 0);
  for (const x of [40, 48]) {
    build(y, "splitter", [x, 24], 0);
    must(y, { do: "first", x, y: 24, way: 1 });
    must(y, { do: "way", x, y: 24, way: 2, open: false });
  }
  must(y, { do: "way", x: 48, y: 24, way: 0, open: false });
  for (let x = 37; x <= 46; x++) if (x !== 39 && x !== 43) build(y, "belt", [x, 20], 0);
  for (const x of [39, 43, 47]) {
    build(y, "splitter", [x, 20], 0);
    must(y, { do: "first", x, y: 20, way: 2 });
    must(y, { do: "way", x, y: 20, way: 1, open: false });
  }
  must(y, { do: "way", x: 47, y: 20, way: 0, open: false });
  // What the workshops make goes north by a tunnel under the bulb belt, and on into the depot.
  for (const [x, z] of [SPARK, LIGHT, TELEGRAPH]) {
    must(y, F.writeAct({ do: "lay", legs: [{ tunnel: true, x, y: z - 1, dir: 3, span: 1, grade: 3 }] }));
    lay(y, [x, z - 4], DEPOT);
  }

  // The three breaker lines, each into what stands waiting for it.
  const bulb = line(y, BULB, "glass", slag);
  build(y, "bench", bulb.wire, 3);
  intoBench(y, BULB);
  build(y, "gatherer", [8, BULB - 2], 0);
  build(y, "gatherer", [9, BULB - 3], 1);
  build(y, "mill", [9, BULB - 2], 0);
  lay(y, [bulb.wire[0], bulb.wire[1] - 1], [37, 20]);
  const coil = line(y, COIL, "ingot", slag);
  build(y, "bench", coil.wire, 3);
  intoBench(y, COIL);
  lay(y, [coil.wire[0], coil.wire[1] - 1], [38, 24]);
  const lights = line(y, LIGHTS, "gear", slag);
  lay(y, branch(y, lights.wire, LIGHTS), [44, 23]);
  lay(y, branch(y, lights.third, LIGHTS), [49, 22]);
  // Into the depot: each line's gravel, and the rest of its belt with what its branches spill.
  for (const l of [coil, bulb, lights]) {
    lay(y, l.rest, DEPOT);
    if (slag) lay(y, l.gravel, DEPOT);
  }
  // Each machine told what to make, as a player tells it, so that it takes only those parts.
  for (const [at, item] of [
    [coil.wire, "coil"],
    [bulb.wire, "bulb"],
    [TELEGRAPH, "telegraph"],
    [LIGHT, "lights"],
    [SPARK, "spark"],
  ] as const)
    must(y, { do: "recipe", x: at[0], y: at[1], item });
  y.history = [];
  return y;
}

/** A yard's tiles in a box, a letter a kind (`a` a belt, the kinds' order on), for seeing what stands where. */
export function sketch(y: F.Yard, x0: number, x1: number, y0: number, y1: number): string {
  const rows: string[] = [];
  for (let z = y0; z <= y1; z++) {
    let row = `${String(z).padStart(2)} `;
    for (let x = x0; x <= x1; x++) {
      const k = y.kind[z * y.land.w + x] ?? F.NONE;
      row += k === F.NONE ? "." : String.fromCharCode(97 + k);
    }
    rows.push(row);
  }
  return rows.join("\n");
}
