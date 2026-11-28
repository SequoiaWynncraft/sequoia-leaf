/**
 * A folded ring of 6,000 tiles, for the tests (`ringfold.test.ts`) and the bench (`bench.ts`): belts
 * back and forth along 60 rows of 99, and back up a column of 60 at its west end, with a sorter every
 * tenth tile of each row, full of planks but for one tile. With `set`, the sorters are set to stone,
 * which never comes: each sends to its side, onto the row before it, so the ring's ways cross it 600
 * times though nothing goes them.
 */
import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";

const W = 100;
const ROWS = 60;

/** The folded ring (as the module says): the yard, and its tiles in the way things go round it. */
export function folded(set = false): { y: F.Yard; tiles: number[] } {
  const y = F.create({ land: bareLand(W + 6, ROWS + 6, [], [W + 3, ROWS + 3]), tier: 8, seed: 1 });
  const tiles: number[] = [];
  const put = (kind: F.Kind, x: number, z: number, dir: F.Dir): void => {
    if (!F.build(y, kind, x, z, dir, Infinity).ok) throw new Error(`no room at ${x}, ${z}`);
    tiles.push(F.at(y, x, z));
  };
  const [belt, sorter] = [F.kind("belt"), F.kind("sorter")];
  for (let z = 0; z < ROWS; z++)
    for (let n = 1; n < W; n++) {
      const east = z % 2 === 0;
      const x = east ? n : W - n;
      const end = n === W - 1;
      const dir: F.Dir = !end ? (east ? 0 : 2) : z === ROWS - 1 ? 2 : 1;
      put(!end && n % 10 === 5 ? sorter : belt, x, z, dir);
      if (set && !end && n % 10 === 5) F.setSort(y, x, z, F.item("stone"));
    }
  for (let z = ROWS - 1; z >= 0; z--) put(belt, 0, z, z === 0 ? 0 : 3);
  for (const i of tiles.slice(1)) {
    y.item[i] = F.item("plank");
    y.prog[i] = 8;
  }
  F.changed(y);
  return { y, tiles };
}
