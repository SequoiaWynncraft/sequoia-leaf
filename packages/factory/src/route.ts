/**
 * Finding a way for a belt: the shortest clear run from a tile to a thing, going under what is in
 * the way by tunnel where tunnels are open. A screen lays a belt from two taps with it.
 */
import { at, digsUnder, type Dir, DX, DY } from "./build.ts";
import { toward } from "./land.ts";
import type { Piece } from "./pieces.ts";
import {
  BELT,
  BENCH,
  BOILER,
  CRATE,
  DEPOT,
  JOINER,
  type Kind,
  locked,
  MILL,
  NONE,
  SORTER,
  SPLITTER,
  STOP,
  STUDY,
  TUNNEL,
  WORKSHOP,
} from "./tables.ts";
import { ahead, takes as sideTakes } from "./wire.ts";
import type { Yard } from "./yard.ts";

/** Where a leg of a run is laid, which way it goes, and its grade: what a leg of belt and a leg of tunnel both hold. */
interface Laid {
  readonly x: number;
  readonly y: number;
  readonly dir: Dir;
  readonly grade: number;
}

/**
 * A leg of a run of belt, and all a run carries: a belt or a tunnel, laid on a tile, going one way,
 * at a grade. Only a tunnel goes under, so only a tunnel's leg says how far (`span`: 0 for the
 * tunnel standing there, raised or lowered). A leg has nothing to set: no colour, no recipe, no shut
 * way. A run takes the colour of the line it joins.
 */
export type Leg =
  | (Laid & { readonly tunnel: false; readonly span?: never })
  | (Laid & { readonly tunnel: true; readonly span: number });

/** What a leg lays. */
export const legKind = (l: Leg): Kind => (l.tunnel ? TUNNEL : BELT);
/** How far under a leg goes: a tunnel's span, and none for a belt. */
export const legSpan = (l: Leg): number => (l.tunnel ? l.span : 0);
/** A leg as a piece to stand, made of nothing but what a leg holds. */
export const legPiece = (l: Leg): Piece => ({
  kind: legKind(l),
  x: l.x,
  y: l.y,
  dir: l.dir,
  span: legSpan(l),
  ...(l.grade > 1 ? { grade: l.grade } : {}),
});

/** What a tunnel counts as in tiles of belt, beyond its own length, so a plain way round is taken when it is near as short. */
const DIG = 4;
const DIRS: readonly Dir[] = [0, 1, 2, 3];

/** Whether the piece on tile `t` would take things from tile `c`, handed over going `d`. */
function takesFrom(y: Yard, t: number, c: number, d: Dir): boolean {
  const k = y.kind[t] ?? NONE;
  if (k === DEPOT || k === STOP || k === STUDY) return true;
  if (k === SPLITTER || k === SORTER) return sideTakes(y, t, c);
  if (k === TUNNEL) return (y.span[t] ?? 0) > 0 && d === y.dir[t];
  if (k === BELT || k === JOINER || k === MILL || k === BENCH || k === WORKSHOP || k === CRATE || k === BOILER)
    return c !== ahead(y, t);
  return false;
}

/**
 * The shortest clear run from the tile `from` to `to`. If something stands on `to`, the run ends
 * beside it, pointing into it from a side it takes things from (for the depot, whichever of its
 * tiles is nearest); if `to` is clear ground, the run ends on it, pointing on the way it came, or
 * into the depot if it ends beside it. Nothing if there is no way.
 */
export function route(
  y: Yard,
  from: readonly [number, number],
  to: readonly [number, number],
  opts: { readonly tunnels?: boolean } = {},
): Leg[] | null {
  // A run that crosses a tunnel's near mouth it steps over is looked for again with that mouth ruled out.
  const ruled = new Set<number>();
  for (let tries = 0; tries < 12; tries++) {
    const found = search(y, from, to, opts.tunnels ?? true, ruled);
    if (found === null || Array.isArray(found)) return found;
    ruled.add(found);
  }
  return null;
}

function search(
  y: Yard,
  from: readonly [number, number],
  to: readonly [number, number],
  tunnels: boolean,
  ruled: ReadonlySet<number>,
): Leg[] | number | null {
  const W = y.land.w;
  const start = at(y, from[0], from[1]);
  const goal = at(y, to[0], to[1]);
  if (start < 0 || goal < 0) return null;
  // A clear tile is one a belt may be built on: `refusal` for a belt on empty ground, asked of the land directly.
  const { land } = y;
  const owned = land.plots.map((p) => y.plots.includes(p.plot));
  const belts = locked(y.open, { build: BELT }) === null;
  const clear = (i: number): boolean =>
    i >= 0 &&
    belts &&
    y.kind[i] === NONE &&
    owned[land.plot[i] ?? NONE] === true &&
    land.water[i] === 0 &&
    land.trunk[i] === 0;
  if (!clear(start)) return null;
  const digs = tunnels && locked(y.open, { build: TUNNEL }) === null;
  const target = y.kind[goal] !== NONE ? goal : -1;
  const toDepot = y.kind[goal] === DEPOT;

  // A place in the search is a tile and, just out of a tunnel, the one way it must go on: tile * 5 + (0, or 1 + way).
  const n = y.kind.length * 5;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
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
      const z = Math.floor(i / W);
      for (const d of DIRS) {
        if (must !== 0 && must - 1 !== d) continue;
        const j = toward(land, i, d);
        if (j < 0) continue;
        if (target >= 0 ? (j === target || (toDepot && y.kind[j] === DEPOT)) && takesFrom(y, j, i, d) : i === goal) {
          end = s;
          endDir = d;
          break search;
        }
        if (!clear(j)) continue;
        push(j * 5, c + 1, s, -1);
        if (!digs || ruled.has(j)) continue;
        for (let span = 1; span <= y.open.span; span++) {
          // Nothing is dug under the depot, so no longer tunnel this way will do either.
          if (!digsUnder(y, x + DX[d] * (span + 1), z + DY[d] * (span + 1))) break;
          const e = at(y, x + DX[d] * (span + 2), z + DY[d] * (span + 2));
          if (clear(e) && e !== goal) push(e * 5 + 1 + d, c + 2 * span + 2 + DIG, s, span);
        }
      }
    }
  if (end < 0) return null;
  // On clear ground the last belt goes on the way the run came; beside the depot, into it: a run
  // that ends there was meant to go in.
  if (target < 0) {
    const p = prev[end] ?? -1;
    if (p >= 0) endDir = wayBetween(W, Math.floor(p / 5), goal);
    const onto = toward(land, goal, endDir);
    if (onto < 0 || y.kind[onto] !== DEPOT)
      for (const d of DIRS) {
        const j = toward(land, goal, d);
        if (j >= 0 && y.kind[j] === DEPOT && takesFrom(y, j, goal, d)) endDir = d;
      }
  }

  // Walk back from the end, giving each tile the way to the tile after it.
  const legs: Leg[] = [];
  const used = new Set<number>();
  const mouths: number[] = [];
  let dir: Dir = endDir;
  for (let s = end; s >= 0; s = prev[s] ?? -1) {
    const i = Math.floor(s / 5);
    const x = i % W;
    const z = Math.floor(i / W);
    const span = dug[s] ?? -1;
    if (span < 0) {
      if (s % 5 === 0) legs.push({ tunnel: false, x, y: z, dir, grade: 1 });
      const p = prev[s] ?? -1;
      if (p >= 0) dir = wayBetween(W, Math.floor(p / 5), i);
    } else {
      // This tile is a tunnel's far mouth: the near mouth is `span + 1` tiles back.
      const d: Dir = s % 5 === 1 ? 0 : s % 5 === 2 ? 1 : s % 5 === 3 ? 2 : 3;
      const near = at(y, x - DX[d] * (span + 1), z - DY[d] * (span + 1));
      legs.push({ tunnel: true, x: x - DX[d] * (span + 1), y: z - DY[d] * (span + 1), dir: d, span, grade: 1 });
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
