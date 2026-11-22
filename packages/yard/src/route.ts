/**
 * Finding a way for a belt. Given a tile to start on and a thing to reach, it finds the shortest
 * clear run of belt between them, going under what is in the way by tunnel where tunnels are open.
 * A screen can use it to lay a belt from two taps; the balance script lays its whole yards with it.
 * A run is stood all or none, as any set of pieces is (`stand`, in `pieces.ts`).
 */
import { digsUnder, refusal } from "./build.ts";
import { SPAN } from "./content/machines.ts";
import { type Dir, DIRS, DX, DY } from "./grid.ts";
import { at, type World } from "./world.ts";

/** One piece of a run: a belt on a tile, or a tunnel going in at one. */
export interface Leg {
  readonly kind: "belt" | "tunnel";
  readonly x: number;
  readonly y: number;
  readonly dir: Dir;
  /** For a tunnel, how many tiles it passes under. */
  readonly span: number;
}

/**
 * What a tunnel counts as in tiles of belt, beyond its own length, so a plain way round is taken
 * when it is near as short. Each tile passed under counts double, so tunnels are no longer than they need be.
 */
const DIG = 4;

/** Whether the building on tile `t` would take things from tile `c`, handed over going `d`. */
function takesFrom(w: World, t: number, c: number, d: Dir): boolean {
  const b = w.cells[t];
  if (!b) return false;
  const W = w.land.w;
  const ahead = at(w, (t % W) + DX[b.dir], Math.floor(t / W) + DY[b.dir]);
  switch (b.kind) {
    case "depot":
      return true;
    case "splitter":
      return d === b.dir;
    case "tunnel":
      return b.span > 0 && d === b.dir;
    case "belt":
    case "joiner":
    case "mill":
    case "bench":
    case "workshop":
    case "crate":
    case "boiler":
      return c !== ahead;
    case "gatherer":
    case "pylon":
    case "wheel":
      return false;
  }
}

/**
 * The shortest clear run from the tile `from` to `to`. If something stands on `to`, the run ends
 * beside it, pointing into it from a side it takes things from (for the depot, whichever of its
 * tiles is nearest); if `to` is clear ground, the run ends on it. Nothing if there is no way.
 * `tunnels: false` keeps it above ground.
 */
export function route(
  w: World,
  from: readonly [number, number],
  to: readonly [number, number],
  opts: { readonly tunnels?: boolean } = {},
): Leg[] | null {
  // A run may not use a tile twice. The search cannot see that for a tunnel's near mouth, which it
  // steps over, so a run that crosses itself there is looked for again with that mouth ruled out.
  const ruled = new Set<number>();
  for (let tries = 0; tries < 12; tries++) {
    const found = search(w, from, to, opts.tunnels ?? true, ruled);
    if (found === null || Array.isArray(found)) return found;
    ruled.add(found);
  }
  return null;
}

/** One search: the run, nothing if there is no way, or the tile of a tunnel mouth the run would use twice. */
function search(
  w: World,
  from: readonly [number, number],
  to: readonly [number, number],
  tunnels: boolean,
  ruled: ReadonlySet<number>,
): Leg[] | number | null {
  const W = w.land.w;
  const start = at(w, from[0], from[1]);
  const goal = at(w, to[0], to[1]);
  if (start < 0 || goal < 0) return null;
  const clear = (i: number): boolean =>
    i >= 0 && !w.cells[i] && refusal(w, "belt", i % W, Math.floor(i / W), Infinity) === null;
  if (!clear(start)) return null;
  const digs = tunnels && w.open.kinds.has("tunnel");
  const target = w.cells[goal] ? goal : -1;
  // Any side of the depot is as good as another.
  const toDepot = w.cells[goal]?.kind === "depot";

  // A place in the search is a tile and, just out of a tunnel, the one way it must go on: tile * 5 + (0, or 1 + way).
  const n = w.cells.length * 5;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  /** How each place was come to: -1 by a plain step, otherwise the span of the tunnel that led there. */
  const dug = new Int8Array(n).fill(-1);
  const queue: number[][] = [];
  const push = (s: number, c: number, p: number, span: number): void => {
    if (c >= (cost[s] ?? Infinity)) return;
    cost[s] = c;
    prev[s] = p;
    dug[s] = span;
    (queue[c] ??= []).push(s);
  };
  push(start * 5, 0, -1, -1);
  let end = -1;
  let endDir: Dir = 0;
  search: for (let c = 0; c < queue.length; c++)
    for (const s of queue[c] ?? []) {
      if ((cost[s] ?? Infinity) < c) continue;
      const i = Math.floor(s / 5);
      const must = s % 5;
      const x = i % W;
      const y = Math.floor(i / W);
      for (const d of DIRS) {
        if (must !== 0 && must - 1 !== d) continue;
        const j = at(w, x + DX[d], y + DY[d]);
        if (j < 0) continue;
        if (
          target >= 0
            ? (j === target || (toDepot && w.cells[j]?.kind === "depot")) && takesFrom(w, j, i, d)
            : i === goal
        ) {
          end = s;
          endDir = d;
          break search;
        }
        if (!clear(j)) continue;
        push(j * 5, c + 1, s, -1);
        if (!digs || ruled.has(j)) continue;
        for (let span = 1; span <= SPAN; span++) {
          // Nothing is dug under the depot, so no longer tunnel this way will do either.
          if (!digsUnder(w, x + DX[d] * (span + 1), y + DY[d] * (span + 1))) break;
          const e = at(w, x + DX[d] * (span + 2), y + DY[d] * (span + 2));
          if (clear(e) && e !== goal) push(e * 5 + 1 + d, c + 2 * span + 2 + DIG, s, span);
        }
      }
    }
  if (end < 0) return null;

  // Walk back from the end, giving each tile the way to the tile after it.
  const legs: Leg[] = [];
  const used = new Set<number>();
  const mouths: number[] = [];
  let dir = endDir;
  for (let s = end; s >= 0; s = prev[s] ?? -1) {
    const i = Math.floor(s / 5);
    const x = i % W;
    const y = Math.floor(i / W);
    const span = dug[s] ?? -1;
    if (span < 0) {
      if (s % 5 === 0) legs.push({ kind: "belt", x, y, dir, span: 0 });
      const p = prev[s] ?? -1;
      if (p >= 0) dir = wayBetween(W, Math.floor(p / 5), i);
    } else {
      // This tile is a tunnel's far mouth: the near mouth is `span + 1` tiles back, and the tile before that led into it.
      const d: Dir = s % 5 === 1 ? 0 : s % 5 === 2 ? 1 : s % 5 === 3 ? 2 : 3;
      const near = at(w, x - DX[d] * (span + 1), y - DY[d] * (span + 1));
      legs.push({ kind: "tunnel", x: x - DX[d] * (span + 1), y: y - DY[d] * (span + 1), dir: d, span });
      mouths.push(near);
      dir = d;
    }
    if (used.has(i)) return null;
    used.add(i);
  }
  for (const mouth of mouths) if (used.has(mouth) || mouths.indexOf(mouth) !== mouths.lastIndexOf(mouth)) return mouth;
  return legs.toReversed();
}

function wayBetween(W: number, a: number, b: number): Dir {
  const dx = (b % W) - (a % W);
  const dy = Math.floor(b / W) - Math.floor(a / W);
  return dx > 0 ? 0 : dx < 0 ? 2 : dy > 0 ? 1 : 3;
}
