/**
 * A staged yard at tier 8's opening that makes its two launches by the real rules (SPEC-2's tier 8):
 * Pipwick's test rocket, then the guild's rocket. Chargers III, the launch pad and the rocket's parts
 * are known; "Something to point up" is in hand.
 *
 * The test pad, set to the test rocket, has 2 chargers at grade I hard against its back, each fed
 * cells from a crate behind it, and a crate of its 60 hull sections and 240 rocket fuel.
 *
 * The main pad, set to the rocket, has banks at its four doors (SPEC-2 0.2's first answer): on each of
 * its north and south sides two short belts, each fed by 3 chargers III from crates of cells behind
 * them, 300 a minute a belt, 1,200 in all. At each door a sorter set to plain cells sends a cell that
 * went flat while the pad was not ready to a shut crate at its side, so the door never blocks. Its
 * hull sections and fuel come from crates against its back; its front lets plain cells out into a
 * cart stop. Powerhouses on spirit, from crates, give what the depot does not.
 */
import * as F from "../src/index.ts";
import { type At, CELL, crate, fill, FUEL, HULL, put, pylons, run, tier8Yard } from "./launch.ts";
import { must } from "./yards.ts";

const W = 48;
const H = 44;
const DEPOT: At = [42, 38];
/** The main pad's own tile, facing east: it covers two tiles round it. */
export const MAIN: At = [20, 22];
/** The test pad's own tile, facing east. */
export const TEST: At = [36, 10];

/** One door of the main pad: its sorter, the way the sorter and its belt face, the belt's far end, and its three chargers' own tiles and way. */
interface Door {
  readonly sorter: At;
  readonly dir: number;
  readonly from: number;
  readonly chargers: readonly At[];
  readonly face: number;
}
/** The four doors: two on the north side, belts running south; two on the south, belts running north. */
const DOORS: readonly Door[] = [
  { sorter: [18, 19], dir: 1, from: 11, chargers: [11, 13, 15].map((z): At => [16, z]), face: 0 },
  { sorter: [22, 19], dir: 1, from: 11, chargers: [10, 12, 14].map((z): At => [23, z]), face: 2 },
  { sorter: [18, 25], dir: 3, from: 33, chargers: [28, 30, 32].map((z): At => [16, z]), face: 0 },
  { sorter: [22, 25], dir: 3, from: 33, chargers: [27, 29, 31].map((z): At => [23, z]), face: 2 },
];

/** A door: its belt from its far end to its sorter, the sorter set to plain cells with a shut crate at its side, and its chargers fed from crates. */
function door(y: F.Yard, d: Door): void {
  const [x, z] = d.sorter;
  run(y, [x, d.from], d.dir, Math.abs(z - d.from));
  put(y, "sorter", d.sorter, d.dir, 3);
  must(y, { do: "sort", x, y: z, item: "cell" });
  // What it sends aside goes to its left: east of a sorter facing south, west of one facing north, into
  // a shut crate facing away from it, which takes from all but its front.
  crate(y, [d.dir === 1 ? x + 1 : x - 1, z], d.dir === 1 ? 0 : 2, CELL, 0, true);
  for (const c of d.chargers) {
    put(y, "charger", c, d.face, 3);
    // Its crate of cells behind it: west of one facing east, east of one facing west, into its back.
    crate(y, d.face === 0 ? [c[0] - 1, c[1]] : [c[0] + 2, c[1]], d.face, CELL, 2000);
  }
}

/** The staged yard: tier 8 open, chargers III, the pad and the rocket's parts known, the test firing in hand. */
export function launchYard(): F.Yard {
  const y = tier8Yard(W, H, DEPOT, ["charger3", "launchpad"], 8);
  must(y, { do: "take", node: "testfiring" });

  // Powerhouses along the top, each fed spirit from a crate above it.
  for (let k = 0; k < 6; k++) {
    put(y, "powerhouse", [2 + k * 4, 2], 0);
    crate(y, [2 + k * 4, 1], 1, F.item("spirit"), 2000);
  }

  // The test pad: two chargers at grade I against its back, and a crate of its parts.
  put(y, "launchpad", TEST, 0);
  for (const z of [8, 10]) {
    put(y, "charger", [32, z], 0);
    crate(y, [31, z], 0, CELL, 2000);
  }
  const parts = crate(y, [33, 12], 0, HULL, 60);
  fill(y, parts, FUEL, 240);

  // The main pad, set to the rocket: its parts from crates against its back, its front into a cart stop.
  put(y, "launchpad", MAIN, 0);
  must(y, { do: "recipe", x: MAIN[0], y: MAIN[1], item: "rocket", was: "testrocket" });
  crate(y, [17, 20], 0, HULL, 900);
  crate(y, [17, 21], 0, FUEL, 1800);
  crate(y, [17, 22], 0, FUEL, 1800);
  put(y, "stop", [23, 22], 0);
  for (const d of DOORS) door(y, d);

  pylons(y);
  y.history = [];
  return y;
}
