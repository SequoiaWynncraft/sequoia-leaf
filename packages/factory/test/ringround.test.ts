/**
 * Rings built at random (`round.ts`): a ring of a random size and grade, with splitters, sorters,
 * joiners and stocked crates along it, a tunnel in it, and sorters at its corners whose straight ways
 * run round outside it and back in, so the order breaks round it in more than one place; a splitter
 * on it sends what it can off it first, onto a belt of a random grade into a shut crate (the drain).
 *
 * The drain takes what the same pieces would bring it as a line: the ring cut open just past the
 * drain, where a shut crate takes what goes on. That is the belt's pace where every piece runs at it
 * (the drain's belt of the ring's grade, at grade I or III); less where the rules carry less on a
 * line too, as through a crate at grade II, which hands a thing on from the start of the next tile,
 * or into a drain's belt slower than the ring. And no thing is made or lost. Rings by hand in
 * `beltrings.test.ts`.
 */
import { expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { PLANK, planks, randomRing } from "./randomring.ts";

/** What the drain of a random ring took in the ten seconds from second 10, and whether every plank is still there. */
function run(
  seed: number,
  cut: boolean,
): { took: number; kept: boolean; rings: number; grade: number; drainGrade: number } {
  const { y, bin, grade, drainGrade } = randomRing(seed, cut);
  const had = planks(y);
  while (y.tick < 100) F.step(y);
  const from = F.held(y.holders, bin, PLANK);
  while (y.tick < 200) F.step(y);
  const took = F.held(y.holders, bin, PLANK) - from;
  return { took, kept: planks(y) === had, rings: F.ringsOf(y).rings, grade, drainGrade };
}

test("a ring built at random brings its drain what the same pieces would as a line, the belt's pace where they all run at it, and loses nothing", () => {
  const seen: string[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    const ring = run(seed, false);
    const line = run(seed, true);
    // What a belt carries a tick is its grade's pace in eighths of a tile.
    const pace = (100 * (F.PACE[ring.grade] ?? 0)) / 8;
    const belt = ring.grade !== 2 && ring.drainGrade === ring.grade ? Math.abs(ring.took - pace) <= 1 : true;
    const says = [
      ring.rings === 1 && line.rings === 0,
      Math.abs(ring.took - line.took) <= 1,
      belt,
      ring.kept && line.kept,
    ];
    const got = `${seed}: ${says.join(" ")}`;
    const why = ` (grade ${ring.grade}, drain ${ring.drainGrade}: ring ${ring.took}, line ${line.took}, belt ${pace})`;
    seen.push(says.every(Boolean) ? got : got + why);
  }
  expect(seen).toEqual(Array.from({ length: 40 }, (_, k) => `${k + 1}: true true true true`));
});
