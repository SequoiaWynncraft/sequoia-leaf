/**
 * A splitter's ways out, as a press on its card moves them: each way
 * steps open, first (once a way may be put first), shut, in (once ways in are unlocked), and open
 * again. Worked out from the yard alone; `tools.ts` sends what it says.
 */
import {
  type Act,
  ahead,
  carries,
  CRATE,
  type Dir,
  locked,
  nextOf,
  SPLITTER,
  wayOut,
  type Yard,
} from "@sequoia-leaf/factory";

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

/**
 * Where a finger's run of belt from a machine leaves it, and the way out of it: the tile a machine
 * that makes things hands them on to (`nextOf`: a gatherer, a mill, a bench, a workshop), where the
 * run's first belt goes. Nothing for anything else: a piece that carries (a run from a belt starts
 * on it), a crate, or a piece that hands nothing on.
 */
export function outletOf(w: Yard, i: number): { readonly x: number; readonly y: number; readonly dir: Dir } | null {
  const k = w.kind[i] ?? -1;
  const out = i < 0 || carries(k) || k === CRATE ? -1 : nextOf(w, i);
  const d = w.dir[i] ?? 0;
  if (out < 0) return null;
  return { x: out % w.land.w, y: Math.floor(out / w.land.w), dir: d === 1 ? 1 : d === 2 ? 2 : d === 3 ? 3 : 0 };
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
