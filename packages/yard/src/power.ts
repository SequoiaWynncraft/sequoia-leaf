/**
 * Where power reaches. It reaches out from the depot, and from every pylon that is joined to the
 * depot through other pylons. How much there is to go round is worked out with the plumbing, in
 * `step.ts`.
 *
 * A change that may move it (a pylon built, moved or taken away, pylons grown taller) only marks
 * it as not known (`w.power = null`), and it is worked out when next it is read, as
 * `w.power ?? repower(w)`: once, however many pieces the change was.
 */
import { REACH } from "./content/machines.ts";
import type { World } from "./world.ts";

/** Whether a whole-tile offset is within `r` tiles: squares of whole numbers, so every host agrees. */
const within = (dx: number, dy: number, r: number): boolean => dx * dx + dy * dy <= r * r;

/** Works out which tiles have power: each live pylon, and the depot, marks the tiles within its reach. */
export function repower(w: World): Uint8Array {
  const { land } = w;
  const [cx, cy] = land.depot;
  const reach = REACH.pylon * w.rates.reach;
  const link = REACH.link * w.rates.reach;
  const power = new Uint8Array(land.w * land.h);
  const mark = (px: number, py: number, r: number): void => {
    const most = Math.floor(r);
    for (let y = Math.max(0, py - most); y <= Math.min(land.h - 1, py + most); y++)
      for (let x = Math.max(0, px - most); x <= Math.min(land.w - 1, px + most); x++)
        if (within(x - px, y - py, r)) power[y * land.w + x] = 1;
  };
  mark(cx, cy, REACH.depot);
  const pylons: { x: number; y: number; live: boolean }[] = [];
  w.cells.forEach((b, i) => {
    const x = i % land.w;
    const y = (i - x) / land.w;
    if (b?.kind === "pylon") pylons.push({ x, y, live: within(x - cx, y - cy, link) });
  });
  // Out from the pylons beside the depot, each live one bringing in those within its link.
  const found = pylons.filter((p) => p.live);
  for (let p = found.pop(); p; p = found.pop()) {
    mark(p.x, p.y, reach);
    for (const q of pylons)
      if (!q.live && within(q.x - p.x, q.y - p.y, link)) {
        q.live = true;
        found.push(q);
      }
  }
  w.power = power;
  w.wire = null;
  return power;
}
