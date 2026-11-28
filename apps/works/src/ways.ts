/**
 * A splitter's ways out, as a press on its card moves them: each way
 * steps open, first (once a way may be put first), shut, in (once ways in are unlocked), and open
 * again. Worked out from the yard alone; `tools.ts` sends what it says.
 */
import {
  type Act,
  ahead,
  BIG,
  locked,
  nextOf,
  NONE,
  outsOf,
  pieceOf,
  portTo,
  RULES,
  wayOut,
  type Yard,
} from "@sequoia-leaf/factory";

/** Whether a kind's ways out are each set open, first, shut or in (its rules' `set.way`: a splitter). */
const setsWays = (k: number): boolean => RULES[k]?.set.way !== undefined;

/**
 * The tile a finger's run of belt from the piece on a tile begins on: where it hands things on. For
 * a splitter, its first way out that sends (ahead, left, right), not one shut or taking things in;
 * for a piece of more than one tile, the tile past the way out of the tile tapped (a still's left,
 * middle or right), or from any other of its tiles, past its first way out; for the rest, the tile
 * ahead, a sorter's too, whatever it is set to. -1 for none.
 */
export function runOut(w: Yard, i: number): number {
  if (BIG[w.kind[i] ?? NONE] === 1) return bigOut(w, i);
  if (!setsWays(w.kind[i] ?? -1)) return ahead(w, i);
  for (let way = 0; way < 3; way++) {
    const to = wayOut(w, i, way);
    if (to >= 0) return to;
  }
  return -1;
}

/** The tile past the way out of a big piece's tile `i`, or past its first way out for a tile with none. */
function bigOut(w: Yard, i: number): number {
  const own = pieceOf(w, i);
  const port = outsOf(w, own).findIndex((o) => own + o.dx + o.dy * w.land.w === i);
  return port >= 0 ? portTo(w, own, port) : nextOf(w, own);
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
