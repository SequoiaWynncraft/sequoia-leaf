/**
 * A yard of growers on a ring, for the tests and the bench (`bench.ts`): tier 7's shared ring
 * (SPEC-2 0.2), its growers seeding themselves from it.
 */
import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

const CRYSTAL = F.item("crystal");
const FEED = F.item("feed");

/**
 * A ring of 40 belts (x 2 to 20, rows 6 to 8) with 4 growers along its top, each facing south: a
 * splitter on the ring sends star crystals up into each grower's east side first, and each grower's
 * middle way out drops onto the ring. One splitter on the ring's east side drains it to the depot.
 * Each grower is fed crystal feed from two crates on its back; 8 star crystals ride the ring.
 */
export function ringOfGrowers(): F.Yard {
  const land = bareLand(40, 16, [], [30, 12]);
  const y = F.create({ land, tier: 8, seed: 5 });
  const belt = (x: number, z: number, dir: number): void => must(y, { do: "build", kind: "belt", x, y: z, dir });
  for (let x = 2; x < 20; x++) belt(x, 6, 0);
  for (let z = 6; z < 8; z++) belt(20, z, 1);
  for (let x = 20; x > 2; x--) belt(x, 8, 2);
  for (let z = 8; z > 6; z--) belt(2, z, 3);
  for (const gx of [4, 8, 12, 16]) {
    must(y, { do: "build", kind: "grower", x: gx, y: 3, dir: 1 });
    belt(gx, 5, 1);
    must(y, { do: "build", kind: "splitter", x: gx + 2, y: 6, dir: 0 });
    must(y, { do: "first", x: gx + 2, y: 6, way: 1 });
    belt(gx + 2, 5, 3);
    belt(gx + 2, 4, 3);
    belt(gx + 2, 3, 2);
    for (const z of [1, 0]) {
      must(y, { do: "build", kind: "crate", x: gx, y: z, dir: 1 });
      const r = F.holderOf(y, F.at(y, gx, z));
      for (let k = 0; k < y.open.crate; k++) F.put(y.holders, r, FEED);
    }
  }
  // The drain: east off the ring's east side, to the depot.
  must(y, { do: "build", kind: "splitter", x: 20, y: 7, dir: 1 });
  const legs = F.route(y, [21, 7], [30, 12]);
  if (!legs) throw new Error("no way to the depot");
  must(y, F.writeAct({ do: "lay", legs }));
  for (const [x, z] of [
    [25, 9],
    [22, 3],
    [18, 0],
    [14, 1],
    [10, 0],
    [6, 1],
    [2, 0],
  ] as const)
    must(y, { do: "build", kind: "pylon", x, y: z, dir: 0 });
  for (const x of [3, 5, 7, 9, 11, 13, 15, 17]) {
    y.item[F.at(y, x, 8)] = CRYSTAL;
    y.prog[F.at(y, x, 8)] = 4;
  }
  F.changed(y);
  y.history = [];
  return y;
}
