/**
 * Where power reaches. It reaches out from the depot, and from every pylon that is joined to the
 * depot through other pylons. How much there is to go round is worked out with the plumbing, in
 * `step.ts`.
 */
import { REACH } from "./content/machines.ts";
import type { World } from "./world.ts";

/** Works out again which tiles have power, after a pylon is built or taken away or pylons grow taller. */
export function repower(w: World): void {
  const { land } = w;
  const [cx, cy] = land.depot;
  const reach = REACH.pylon * w.rates.reach;
  const link = REACH.link * w.rates.reach;
  const pylons: { x: number; y: number; live: boolean }[] = [];
  w.cells.forEach((b, i) => {
    if (b?.kind === "pylon") pylons.push({ x: i % land.w, y: Math.floor(i / land.w), live: false });
  });
  for (let grew = true; grew;) {
    grew = false;
    for (const p of pylons) {
      if (p.live) continue;
      p.live =
        Math.hypot(p.x - cx, p.y - cy) <= link ||
        pylons.some((q) => q.live && Math.hypot(p.x - q.x, p.y - q.y) <= link);
      if (p.live) grew = true;
    }
  }
  const live = pylons.filter((p) => p.live);
  w.power.fill(0);
  for (let y = 0; y < land.h; y++)
    for (let x = 0; x < land.w; x++)
      if (Math.hypot(x - cx, y - cy) <= REACH.depot || live.some((p) => Math.hypot(x - p.x, y - p.y) <= reach))
        w.power[y * land.w + x] = 1;
  w.wire = null;
}
