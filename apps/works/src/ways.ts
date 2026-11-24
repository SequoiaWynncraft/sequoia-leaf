/**
 * A splitter's ways out, as a press on its card moves them and as undo puts them back: each way
 * steps open, first (once a way may be put first), shut, in (once ways in are unlocked), and open
 * again. Worked out from the yard alone; `tools.ts` sends what it says.
 */
import { type Act, ahead, locked, SPLITTER, wayOut, type Yard } from "@sequoia-leaf/factory";

/**
 * The tile a finger's run of belt from the piece on a tile begins on: where it hands things on. For
 * a splitter, its first way out that sends (ahead, left, right), not one shut or taking things in;
 * for the rest, the tile ahead. -1 for none.
 */
export function runOut(w: Yard, i: number): number {
  if (w.kind[i] !== SPLITTER) return ahead(w, i);
  for (let way = 0; way < 3; way++) {
    const to = wayOut(w, i, way);
    if (to >= 0) return to;
  }
  return -1;
}

/** How one of a splitter's ways out stands: sending things out (put first, or open), shut, or taking things in. */
export type WayState = "open" | "first" | "shut" | "in";

/** How the way `way` (0 ahead, 1 left, 2 right) of the splitter on a tile stands. */
export function wayState(w: Yard, i: number, way: number): WayState {
  if (((w.ins[i] ?? 0) >> way) & 1) return "in";
  if (((w.shut[i] ?? 0) >> way) & 1) return "shut";
  return w.first[i] === way + 1 ? "first" : "open";
}

/** The command a press on one of the ways of the splitter on (x, y) sends: the way moved on a step. */
export function stepWay(w: Yard, i: number, x: number, y: number, way: number): Act {
  const now = wayState(w, i, way);
  if (now === "open" && locked(w.open, { first: true }) === null) return { do: "first", x, y, way };
  if (now === "open" || now === "first") return { do: "way", x, y, way, open: false };
  if (now === "shut" && locked(w.open, { ins: true }) === null) return { do: "wayIn", x, y, way, on: true };
  return now === "shut" ? { do: "way", x, y, way, open: true } : { do: "wayIn", x, y, way, on: false };
}

/** A splitter's ways as undo keeps them: its shut ways and its ways in, a bit each, and the way it puts first, 1 + the way or 0. */
export interface Ways {
  readonly shut: number;
  readonly first: number;
  readonly ins: number;
}

/** The ways of the splitter on a tile, as they stand. */
export const waysAt = (w: Yard, i: number): Ways => ({
  shut: w.shut[i] ?? 0,
  first: w.first[i] ?? 0,
  ins: w.ins[i] ?? 0,
});

/**
 * Gives the splitter on (x, y) the ways it had, through `send`, which does each command at once: each
 * way that took things in turned in, each that sent things out opened, then the way it put first, then
 * each way that was shut shut. In that order, since a way that is shut or in cannot be put first.
 */
export function waysBack(w: Yard, i: number, x: number, y: number, was: Ways, send: (a: Act) => void): void {
  for (let way = 0; way < 3; way++) {
    const bit = 1 << way;
    const now = wayState(w, i, way);
    if (was.ins & bit) {
      if (now !== "in") send({ do: "wayIn", x, y, way, on: true });
    } else if ((was.shut & bit) === 0 && (now === "in" || now === "shut")) send({ do: "way", x, y, way, open: true });
  }
  if (w.first[i] !== was.first) send({ do: "first", x, y, way: was.first === 0 ? null : was.first - 1 });
  for (let way = 0; way < 3; way++)
    if (was.shut & (1 << way) && wayState(w, i, way) !== "shut") send({ do: "way", x, y, way, open: false });
}
