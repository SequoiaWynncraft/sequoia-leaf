/**
 * Colours. A belt, tunnel mouth, splitter, joiner or sorter has a tint, 0 or one of six colours a
 * player gives to tell lines apart; it changes nothing about how the yard runs. A splitter, joiner or
 * sorter is coloured by itself; a belt or a tunnel mouth with its whole line: every belt and tunnel joined
 * end to end with it, as things are handed on, as far as the next thing that is neither.
 */
import { toward } from "./land.ts";
import { LINED, NONE, TINTED } from "./tables.ts";
import { behind } from "./tiles.ts";
import { nextOf, takes } from "./wire.ts";
import type { Yard } from "./yard.ts";

/** Whether a tile holds what is coloured with its line (a belt, a tunnel mouth). */
const inLine = (y: Yard, i: number): boolean => i >= 0 && LINED[y.kind[i] ?? NONE] === 1;

/**
 * The belt or tunnel mouth a line comes onto a tile from, or -1: a tunnel's other mouth, the one
 * straight behind if it hands to this tile, or else the only one that does. So a belt that joins
 * the side of a line running straight on is a line of its own.
 */
function before(y: Yard, j: number): number {
  if (!inLine(y, j)) return -1;
  const d = y.dir[j] ?? 0;
  const span = y.span[j] ?? 0;
  if (span < 0) return j + (span - 1) * (y.land.step[d] ?? 0);
  const from: number[] = [];
  for (const way of [d + 2, d + 3, d + 1]) {
    const k = toward(y.land, j, way & 3);
    if (inLine(y, k) && nextOf(y, k) === j && takes(y, j, k)) from.push(k);
  }
  return from.length === 1 || from[0] === behind(y, j) ? (from[0] ?? -1) : -1;
}

/** The belt or tunnel mouth a line goes on to from a tile, or -1. */
function after(y: Yard, i: number): number {
  const j = nextOf(y, i);
  return before(y, j) === i ? j : -1;
}

/** The tiles coloured together with a tile: a splitter or a joiner by itself, a belt or a tunnel mouth with its line. */
export function lineOf(y: Yard, i: number): number[] {
  const k = i < 0 ? NONE : (y.kind[i] ?? NONE);
  if (TINTED[k] === 1 && LINED[k] !== 1) return [i];
  if (!inLine(y, i)) return [];
  const line = [i];
  const on = new Set(line);
  for (const step of [after, before])
    for (let j = step(y, i); j >= 0 && !on.has(j); j = step(y, j)) {
      line.push(j);
      on.add(j);
    }
  return line;
}

/** Gives the line through a tile a colour, 1 to 6, or with 0 takes it off. Says whether anything there can be coloured. */
export function paint(y: Yard, i: number, tint: number): boolean {
  const line = lineOf(y, i);
  for (const j of line) y.tint[j] = tint;
  return line.length > 0;
}

/** Gives tiles just laid, in any order, the colour of the line they join: the line that feeds them, or else the line they feed. */
export function join(y: Yard, laid: readonly number[]): void {
  // No colour beside them, none to take: so a yard with no colour in it works nothing out here.
  const coloured = (i: number): boolean => i >= 0 && (y.tint[i] ?? 0) > 0;
  if (!laid.some((i) => [0, 1, 2, 3].some((way) => coloured(toward(y.land, i, way))))) return;
  const bare = new Set(laid.filter((i) => y.tint[i] === 0));
  for (const step of [before, after]) {
    // From each, along the tiles just laid to the first with a colour, going over no tile twice.
    const seen = new Set<number>();
    for (const i of bare) {
      const run: number[] = [];
      let j = i;
      for (; bare.has(j) && !seen.has(j); j = step(y, j)) {
        seen.add(j);
        run.push(j);
      }
      const tint = j < 0 ? 0 : (y.tint[j] ?? 0);
      for (const k of run) if (tint > 0 && bare.delete(k)) y.tint[k] = tint;
    }
  }
}
