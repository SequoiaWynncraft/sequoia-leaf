/**
 * Where power reaches. It reaches out from the depot, and from every pylon joined to the depot
 * through other pylons; each marks the tiles within its reach. It is worked out once after a change
 * that may move it, when next read (`litOf`), however many pieces the change was.
 */
import { REACH } from "./content/machines.ts";
import { PYLON } from "./tables.ts";
import type { Yard } from "./yard.ts";

/**
 * A reach in hundredths of a tile, made `percent` per cent as far, as the whole number its square may
 * be: a tile is within it when the square of its distance is no more.
 */
export const squared = (r: number, percent = 100): number => Math.floor((r * percent) ** 2 / 100_000_000);
/** Whether a whole-tile offset is within a reach given as `squared` gives it. */
const within = (dx: number, dy: number, r2: number): boolean => dx * dx + dy * dy <= r2;

/** Marks the tiles within a reach (`squared`) of (px, py). */
function mark(y: Yard, px: number, py: number, r2: number): void {
  const { w, h } = y.land;
  const most = Math.floor(Math.sqrt(r2));
  for (let ty = Math.max(0, py - most); ty <= Math.min(h - 1, py + most); ty++)
    for (let tx = Math.max(0, px - most); tx <= Math.min(w - 1, px + most); tx++)
      if (within(tx - px, ty - py, r2)) y.lit[ty * w + tx] = 1;
}

/** Works out which tiles have power, and so the plumbing too. */
export function repower(y: Yard): Uint8Array {
  const { land } = y;
  const [cx, cy] = land.depot;
  const reach = squared(REACH.pylon, y.open.reach);
  const link = squared(REACH.link, y.open.reach);
  y.lit.fill(0);
  mark(y, cx, cy, squared(REACH.depot));
  const pylons: number[] = [];
  for (let i = 0; i < y.kind.length; i++) if (y.kind[i] === PYLON) pylons.push(i);
  const live = new Uint8Array(pylons.length);
  const found: number[] = [];
  pylons.forEach((i, n) => {
    if (within((i % land.w) - cx, Math.floor(i / land.w) - cy, link)) {
      live[n] = 1;
      found.push(n);
    }
  });
  // Out from the pylons beside the depot, each live one bringing in those within its link.
  for (let p = found.pop(); p !== undefined; p = found.pop()) {
    const i = pylons[p] ?? 0;
    const px = i % land.w;
    const py = Math.floor(i / land.w);
    mark(y, px, py, reach);
    pylons.forEach((j, q) => {
      if (live[q] === 0 && within((j % land.w) - px, Math.floor(j / land.w) - py, link)) {
        live[q] = 1;
        found.push(q);
      }
    });
  }
  y.powered = true;
  y.wire = null;
  return y.lit;
}

/** Which tiles power reaches, worked out first if a change may have moved it. */
export const litOf = (y: Yard): Uint8Array => (y.powered ? y.lit : repower(y));
