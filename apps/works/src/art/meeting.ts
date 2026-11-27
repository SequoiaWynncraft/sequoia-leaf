/**
 * Tiles where belts meet, as a button or a card pictures them: a piece of bare belt, a tile where
 * belts meet at a grade with what lies over it, and a splitter's arrowheads on some of its ways.
 */
import type { Dir } from "@sequoia-leaf/factory";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { type Arms, arms, beltTile, TILE, woodOf } from "./belts.ts";
import type { Machines } from "./machines.ts";

/** A piece of belt running east, with nothing on it, in a line's colour or in none. */
export const bare = (tint = 0): HTMLCanvasElement => beltTile(arms(2, 0, 1, 0), 0, 5, 1, tint);

/**
 * A tile where belts meet at a grade, as the yard lays it: its belt in the grade's wood (`wood`, as
 * `beltTile` takes it), what marks it, and over that the grade's mark. `a` and `main` as `beltTile`
 * takes them.
 */
export function meetingTile(
  m: Machines,
  a: Arms,
  main: Dir,
  top: HTMLCanvasElement | undefined,
  grade: number,
  wood = woodOf(grade),
): HTMLCanvasElement {
  const { c, g } = makeCanvas(16, 16);
  g.drawImage(beltTile(a, main, 5, wood), 0, 0);
  if (top) g.drawImage(top, 0, 0);
  const pip = m.pips[grade - 2];
  if (pip) g.drawImage(pip, 0, 0);
  return c;
}
/** A tile where belts meet, pointing east, at a grade, for a button: at the first grade, with the lighter slats a button shows a belt with. */
export const meeting = (m: Machines, a: Arms, top: HTMLCanvasElement | undefined, grade: number): HTMLCanvasElement =>
  meetingTile(m, a, 0, top, grade, grade >= 2 ? woodOf(grade) : 1);

/** A splitter's top pointing east with its arrowheads on some of its ways out only (0 ahead, 1 left, 2 right). */
export function headsOn(m: Machines, ways: readonly number[]): HTMLCanvasElement {
  const { c, g } = makeCanvas(TILE, TILE);
  for (const way of ways) {
    const head = m.heads[way]?.[0];
    if (head) g.drawImage(head, 0, 0);
  }
  return c;
}
