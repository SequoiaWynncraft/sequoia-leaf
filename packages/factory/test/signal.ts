/**
 * A staged yard at the opening of tier 7's commission that makes what it wants (`signal`: 1,500
 * dishes, 6,000 lattices, 2,000 Star folios) by the real rules: 11,000 lattices, so 22,000 star
 * crystals, grown (SPEC-2's tier 7). Ten growers III stand in two columns of five, each in a loop of
 * its own: its way out into a splitter whose way back round to its north side is put first, the rest
 * spilling east onto its column's line. Each is seeded from a gatherer III on the star crystal in the
 * ground at its south, and fed crystal feed from six crates on its west.
 *
 * The two columns' lines meet and run into a lattice bench, fed wire from crates. Its lattices go
 * half to the depot, a quarter to a dish workshop (telegraphs and sleepers from crates) and a quarter
 * to a Star folio workshop (coils and varnish from crates). What the benches take besides star
 * crystal comes from the yard's older lines: here, crates of it. Boilers on deadfall along the top
 * give the 1,600 power the growers draw that the depot does not.
 *
 * Without the way back put first (`first: false`), each loop's splitter sends half back, and its
 * grower runs down to the pace of the star crystal in the ground (`thesignal.test.ts`).
 */
import * as F from "../src/index.ts";
import { fill, learn } from "./goals.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

type At = readonly [number, number];
const W = 72;
const H = 40;
const DEPOT: At = [66, 20];
/** The growers' own tiles: two columns of five. */
const COLUMNS = [9, 30];
const ROWS = [5, 12, 19, 26, 33];
/** The boilers' row, their gatherers on deadfall above it, and where they run. */
const BOILERS = { z: 1, from: 14, to: 66 };
/** The row the two columns' lines join on. */
const TRUNK = 38;
/** The lattice bench, and the two workshops. */
const BENCH: At = [44, 30];
const DISH: At = [56, 30];
const STAR: At = [56, 36];

/** The land: bare, star crystal under each grower's gatherer, deadfall under the boilers' gatherers. */
function land(): F.Land {
  const deposits: (readonly [number, number, F.ItemName])[] = [];
  for (const gx of COLUMNS) for (const gz of ROWS) deposits.push([gx, gz + 2, "crystal"]);
  for (let x = BOILERS.from; x <= BOILERS.to; x++) deposits.push([x, BOILERS.z - 1, "deadfall"]);
  return bareLand(W, H, deposits, DEPOT);
}

/** Builds a piece at grade III (a crate, a pylon or a boiler at the grade it has). */
function build(y: F.Yard, kind: F.KindName, at: At, dir: number): void {
  const graded = F.isGraded(F.kind(kind));
  must(y, { do: "build", kind, x: at[0], y: at[1], dir, ...(graded ? { grade: 3 } : {}) });
}
/** A straight run of grade III belt from a tile, `count` tiles toward `dir`. */
function run(y: F.Yard, from: At, dir: number, count: number): void {
  const [dx, dy] = [F.DX[dir] ?? 0, F.DY[dir] ?? 0];
  for (let k = 0; k < count; k++) build(y, "belt", [from[0] + dx * k, from[1] + dy * k], dir);
}
/** A row of full crates, each handing on toward `dir`, from `at` away from where they hand: the first into what stands beyond. */
function crates(y: F.Yard, at: At, dir: number, count: number, name: F.ItemName): void {
  for (let k = 0; k < count; k++) {
    const c: At = [at[0] - (F.DX[dir] ?? 0) * k, at[1] - (F.DY[dir] ?? 0) * k];
    build(y, "crate", c, dir);
    const r = F.holderOf(y, F.at(y, c[0], c[1]));
    for (let n = 0; n < y.open.crate; n++) F.put(y.holders, r, F.item(name));
  }
}

/** One grower in a loop of its own, on its own tile (gx, gz) facing east, its spill onto its column's line at gx + 4. */
function loop(y: F.Yard, gx: number, gz: number, first: boolean): void {
  build(y, "grower", [gx, gz], 0);
  crates(y, [gx - 2, gz], 0, 6, "feed");
  build(y, "gatherer", [gx, gz + 2], 3);
  build(y, "splitter", [gx + 2, gz], 0);
  if (first) must(y, { do: "first", x: gx + 2, y: gz, way: 1 });
  build(y, "belt", [gx + 2, gz - 1], 3);
  build(y, "belt", [gx + 2, gz - 2], 2);
  build(y, "belt", [gx + 1, gz - 2], 1);
  build(y, "belt", [gx + 3, gz], 0);
}

/** Pylons over the whole yard where nothing stands, each within reach of the next and of the depot. */
function pylons(y: F.Yard): void {
  for (const z of [2, 8, 15, 22, 29, 36])
    for (let x = 1; x < W; x += 5) if (y.kind[F.at(y, x, z)] === F.NONE) F.build(y, F.PYLON, x, z, 0, Infinity);
  // And one between the workshops, which those rows pass by.
  F.build(y, F.PYLON, 58, 33, 0, Infinity);
}

/** The staged yard: tier 7 open, the commission's research known (growers to grade III) and the commission in hand. */
export function signalYard(first = true): F.Yard {
  const y = F.create({ land: land(), tier: 7, seed: 7 });
  for (const id of ["grower3", "lattices", "starfolio", "dishes"]) learn(y, F.goal(id));
  // The three nodes before it, done.
  while (y.hand !== -1 && F.GOALS[y.hand]?.id !== "signal") fill(y);

  for (let x = BOILERS.from; x <= BOILERS.to; x++) {
    build(y, "boiler", [x, BOILERS.z], 0);
    build(y, "gatherer", [x, BOILERS.z - 1], 1);
  }
  for (const gx of COLUMNS) {
    for (const gz of ROWS) loop(y, gx, gz, first);
    // Its column's line, south past every grower's spill to the trunk.
    for (let z = ROWS[0] ?? 0; z < TRUNK; z++) build(y, "belt", [gx + 4, z], 1);
  }
  // The trunk: east along the bottom from the first column's line, which the second's joins, then north and into the bench.
  for (let x = (COLUMNS[0] ?? 0) + 4; x < BENCH[0] - 1; x++) build(y, "belt", [x, TRUNK], 0);
  for (let z = TRUNK; z > BENCH[1]; z--) build(y, "belt", [BENCH[0] - 1, z], 3);
  build(y, "belt", [BENCH[0] - 1, BENCH[1]], 0);

  // The lattice bench, its wire from the north, its star crystal from the west.
  build(y, "bench", BENCH, 0);
  crates(y, [BENCH[0], BENCH[1] - 1], 1, 13, "wire");
  // The workshops, each its two other parts from north and south.
  build(y, "workshop", DISH, 0);
  crates(y, [DISH[0], DISH[1] - 1], 1, 2, "telegraph");
  crates(y, [DISH[0], DISH[1] + 1], 3, 2, "sleeper");
  build(y, "workshop", STAR, 0);
  crates(y, [STAR[0], STAR[1] - 1], 1, 2, "coil");
  crates(y, [STAR[0], STAR[1] + 1], 3, 2, "varnish");
  // The lattices: half north to the depot, half on to a second splitter, which sends them to the workshops in turn.
  run(y, [BENCH[0] + 1, BENCH[1]], 0, 3);
  build(y, "splitter", [48, 30], 0);
  run(y, [48, 29], 3, 9);
  run(y, [48, 20], 0, 17);
  build(y, "belt", [49, 30], 0);
  build(y, "splitter", [50, 30], 0);
  run(y, [51, 30], 0, 5);
  run(y, [50, 31], 1, 5);
  run(y, [50, 36], 0, 6);
  // What the workshops make, to the depot: the Star folios onto the dishes' line.
  run(y, [57, 30], 0, 8);
  run(y, [65, 30], 3, 9);
  run(y, [57, 36], 0, 7);
  run(y, [64, 36], 3, 6);
  for (const [at, item] of [
    [BENCH, "lattice"],
    [DISH, "dish"],
    [STAR, "star"],
  ] as const)
    must(y, { do: "recipe", x: at[0], y: at[1], item });
  pylons(y);
  y.history = [];
  return y;
}
