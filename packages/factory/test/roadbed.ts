/**
 * A staged yard at the opening of tier 6 that makes what its commission wants (`roadbed`: 2,000
 * tarmac, 4,000 sleepers, 6,000 varnish) by the real rules, from tar: pitch, creosote and spirit as
 * 1, 2 and 3, the still's proportion backwards (SPEC-2's tier 6). One still III, fed by three
 * gatherers on tar, sends each of its three things along its own line east:
 *
 * - pitch along the top: first into the tarmac bench, then into the powerhouse, the yard's power, and
 *   the rest into a cracker that makes creosote of it;
 * - creosote along the middle: first into the sleeper bench, then, with the first cracker's, into a
 *   second cracker that makes spirit of it;
 * - spirit along the bottom, with the second cracker's, into two varnish benches in turn.
 *
 * What the benches take besides comes from the yard's older lines: here, crates of it stacked against
 * each bench, gravel (5 crates, as much as the slag mills have made) running out after about 2,500
 * tarmac. Two boilers on deadfall give the power the depot does not.
 *
 * Without the crackers and the powerhouse (`cracking: false`), the same yard has nowhere for the pitch
 * and creosote its benches do not take: once the gravel is gone, its pitch backs up into the still,
 * which stops, and the varnish stops with it.
 */
import * as F from "../src/index.ts";
import { fill, learn } from "./goals.ts";
import { bareLand } from "./land.ts";
import { sketch } from "./townlight.ts";
import { must } from "./yards.ts";

type At = readonly [number, number];
const W = 50;
const H = 31;
/** The depot's middle, and the still's (its own tile). */
const DEPOT: At = [46, 14];
const STILL: At = [4, 14];
/** The lines' rows: pitch, creosote, spirit. */
const PITCH = 4;
const CREOSOTE = 14;
const SPIRIT = 24;
/** Boilers along the bottom, each fed deadfall from beneath. */
const BOILERS = [10, 16];

/** The land: bare, with tar behind the still and deadfall under the boilers' gatherers. */
function land(): F.Land {
  const deposits: (readonly [number, number, F.ItemName])[] = [];
  for (const z of [13, 14, 15]) deposits.push([2, z, "tar"]);
  for (const x of BOILERS) deposits.push([x, 30, "deadfall"]);
  return bareLand(W, H, deposits, DEPOT);
}

/** Builds a piece at grade III (a crate, a pylon or a boiler at the grade it has). */
function build(y: F.Yard, kind: F.KindName, at: At, dir: number): void {
  const graded = F.isGraded(F.kind(kind));
  must(y, { do: "build", kind, x: at[0], y: at[1], dir, ...(graded ? { grade: 3 } : {}) });
}
/** Lays a run of grade III belt from a tile to another, or into what stands there, as the page's router lays one. */
function lay(y: F.Yard, from: At, to: At): void {
  const legs = F.route(y, from, to);
  if (!legs) throw new Error(`no way from ${from.join(",")} to ${to.join(",")}\n${sketch(y, 0, W - 1, 0, H - 1)}`);
  for (const l of legs) Object.assign(l, { grade: 3 });
  must(y, F.writeAct({ do: "lay", legs }));
}
/** A row of full crates from `x0` to `x1` on row `z`, each handing on toward `dir`, the last into what stands beyond. */
function crates(y: F.Yard, x0: number, x1: number, z: number, dir: number, name: F.ItemName): void {
  for (let x = x0; x <= x1; x++) {
    build(y, "crate", [x, z], dir);
    const r = F.holderOf(y, F.at(y, x, z));
    for (let k = 0; k < y.open.crate; k++) F.put(y.holders, r, F.item(name));
  }
}
/** A splitter on a line facing east at `at`, its way `first` (1 left, 2 right) put first, its way `shut` shut. */
function splitter(y: F.Yard, at: At, first: number | null, shut: readonly number[]): void {
  build(y, "splitter", at, 0);
  if (first !== null) must(y, { do: "first", x: at[0], y: at[1], way: first });
  for (const way of shut) must(y, { do: "way", x: at[0], y: at[1], way, open: false });
}
/** A run of belt east along a row. */
function belts(y: F.Yard, x0: number, x1: number, z: number): void {
  for (let x = x0; x <= x1; x++) build(y, "belt", [x, z], 0);
}

/** Pylons over the whole yard where nothing stands, each within reach of the next and of the depot. */
function pylons(y: F.Yard): void {
  for (const z of [1, 7, 11, 18, 21, 28])
    for (let x = 1; x < W; x += 5) {
      if (y.kind[F.at(y, x, z)] === F.NONE) F.build(y, F.PYLON, x, z, 0, Infinity);
    }
}

/** The staged yard: tier 6 open, the commission's research known and the commission in hand. */
export function roadbedYard(cracking = true): F.Yard {
  const y = F.create({ land: land(), tier: 6, seed: 3 });
  for (const id of ["still3", "powerhouse", "tarring", "sleepers", "varnishing"]) learn(y, F.goal(id));
  // The two nodes before it, done.
  while (y.hand !== -1 && F.GOALS[y.hand]?.id !== "roadbed") fill(y);

  // The still and its gatherers.
  build(y, "still", STILL, 0);
  for (const z of [13, 14, 15]) build(y, "gatherer", [2, z], 0);
  for (const x of BOILERS) {
    build(y, "boiler", [x, 29], 0);
    build(y, "gatherer", [x, 30], 3);
  }

  // Pitch: the tarmac bench on its gravel, the powerhouse, and the cracker at the line's end.
  build(y, "bench", [14, PITCH - 1], 3);
  crates(y, 9, 13, PITCH - 1, 0, "gravel");
  splitter(y, [14, PITCH], 1, [2]);
  belts(y, 15, 17, PITCH);
  if (cracking) {
    build(y, "powerhouse", [18, PITCH - 2], 0);
    splitter(y, [18, PITCH], 1, [2]);
    belts(y, 19, 21, PITCH);
    build(y, "cracker", [22, PITCH], 0);
  } else belts(y, 18, 21, PITCH);

  // Creosote: the sleeper bench on its planks, and, with the first cracker's, the second cracker.
  build(y, "bench", [24, CREOSOTE - 1], 3);
  crates(y, 7, 23, CREOSOTE - 1, 0, "plank");
  belts(y, 6, 23, CREOSOTE);
  splitter(y, [24, CREOSOTE], 1, [2]);
  belts(y, 25, 27, CREOSOTE);
  build(y, "joiner", [28, CREOSOTE], 0);
  belts(y, 29, 29, CREOSOTE);
  if (cracking) build(y, "cracker", [30, CREOSOTE], 0);

  // Spirit: with the second cracker's, two varnish benches in turn, each on its oil.
  build(y, "joiner", [36, SPIRIT], 0);
  belts(y, 37, 37, SPIRIT);
  splitter(y, [38, SPIRIT], null, [0]);
  build(y, "bench", [38, SPIRIT + 1], 1);
  crates(y, 20, 37, SPIRIT + 1, 0, "oil");
  build(y, "bench", [38, SPIRIT - 1], 3);
  crates(y, 39, 44, SPIRIT - 1, 2, "oil");
  pylons(y);

  // The lines between, and what the benches make into the depot.
  lay(y, [6, 13], [14, PITCH]);
  lay(y, [6, 15], [36, SPIRIT]);
  if (cracking) {
    lay(y, [24, PITCH], [28, CREOSOTE]);
    lay(y, [32, CREOSOTE], [36, SPIRIT]);
  }
  for (const from of [
    [14, PITCH - 2],
    [24, CREOSOTE - 2],
    [38, SPIRIT + 2],
    [38, SPIRIT - 2],
  ] as const)
    lay(y, from, DEPOT);
  // Each machine told what to make, as a player tells it, so that it takes only those parts.
  for (const [at, item] of [
    [[14, PITCH - 1], "tarmac"],
    [[24, CREOSOTE - 1], "sleeper"],
    [[38, SPIRIT + 1], "varnish"],
    [[38, SPIRIT - 1], "varnish"],
    ...(cracking
      ? ([
          [[22, PITCH], "creosote"],
          [[30, CREOSOTE], "spirit"],
        ] as const)
      : []),
  ] as const)
    must(y, { do: "recipe", x: at[0], y: at[1], item });
  y.history = [];
  return y;
}
