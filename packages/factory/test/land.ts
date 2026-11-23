/**
 * Land of any size, ported from the scale study (works-scale/scripts/land.ts), in about the
 * proportions of today's 48 by 36 map:
 * deposits 14% of tiles (deadfall 28% of them, stone 19, ore 15, sand 16, clay 14, resin 8),
 * water 5.4%, redwoods 2.1% (2 by 2 trunks). Plots of 16 by 12, the depot in the middle plot.
 *
 * The whole map is one plot ("yard"), owned: the rules' plot ids are a closed list of nine, and
 * which plot a tile is on does not change what a tick or a save costs.
 */
import type { Land, Raw } from "@sequoia-leaf/yard";

import { rng } from "./random.ts";

export const PW = 16;
export const PH = 12;

const KINDS: [Raw, number][] = [
  ["deadfall", 0.28],
  ["stone", 0.19],
  ["ore", 0.15],
  ["sand", 0.16],
  ["clay", 0.14],
  ["resin", 0.08],
];

export function makeLand(cols: number, rows: number, seed = 7): Land {
  const r = rng(seed);
  const w = cols * PW;
  const h = rows * PH;
  const n = w * h;
  const deposit: (Raw | null)[] = Array.from({ length: n }, () => null);
  const water = new Uint8Array(n);
  const trunk = new Uint8Array(n);
  const plot = new Int8Array(n);
  const cx = Math.floor(cols / 2) * PW + 8;
  const cy = Math.floor(rows / 2) * PH + 6;
  const nearDepot = (x: number, y: number): boolean => Math.abs(x - cx) <= 3 && Math.abs(y - cy) <= 3;
  const idx = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x);

  // Streams: one for every three or four columns of plots, top to bottom, two wide, meandering.
  const streams = Math.max(1, Math.round(cols / 3.5));
  for (let s = 0; s < streams; s++) {
    let x = Math.floor(((s + 0.5) / streams) * w) + (s % 2 === 0 ? -5 : 5);
    for (let y = 0; y < h; y++) {
      if (y % 3 === 0) x += r() < 0.5 ? -1 : 1;
      for (const dx of [0, 1]) {
        const i = idx(x + dx, y);
        if (i >= 0 && !nearDepot(x + dx, y)) water[i] = 1;
      }
    }
  }
  // Ponds: one for every dozen plots.
  const ponds = Math.max(1, Math.round((cols * rows) / 12));
  for (let p = 0; p < ponds; p++) {
    const px = Math.floor(r() * (w - 10)) + 5;
    const py = Math.floor(r() * (h - 8)) + 4;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx * 0.45 + dy * dy > 4.2) continue;
        const i = idx(px + dx, py + dy);
        if (i >= 0 && !nearDepot(px + dx, py + dy)) water[i] = 1;
      }
  }

  const clear = (x: number, y: number): boolean => {
    const i = idx(x, y);
    return i >= 0 && water[i] === 0 && trunk[i] === 0 && deposit[i] === null && !nearDepot(x, y);
  };
  const pick = (): Raw => {
    let at = r();
    for (const [k, p] of KINDS) {
      at -= p;
      if (at < 0) return k;
    }
    return "deadfall";
  };

  for (let pr = 0; pr < rows; pr++)
    for (let pc = 0; pc < cols; pc++) {
      const x0 = pc * PW;
      const y0 = pr * PH;
      // One redwood (2 by 2) a plot.
      for (let tries = 0; tries < 40; tries++) {
        const tx = x0 + 1 + Math.floor(r() * (PW - 3));
        const ty = y0 + 1 + Math.floor(r() * (PH - 3));
        if (![0, 1].every((dy) => [0, 1].every((dx) => clear(tx + dx, ty + dy)))) continue;
        for (const dy of [0, 1]) for (const dx of [0, 1]) trunk[idx(tx + dx, ty + dy)] = 1;
        break;
      }
      // Three blobs a plot, about 9 tiles each: 27 of 192 tiles, 14%.
      for (let b = 0; b < 3; b++) {
        const kind = pick();
        const size = 6 + Math.floor(r() * 7);
        for (let tries = 0; tries < 40; tries++) {
          const bx = x0 + 2 + Math.floor(r() * (PW - 4));
          const by = y0 + 2 + Math.floor(r() * (PH - 4));
          if (!clear(bx, by)) continue;
          const tiles = [idx(bx, by)];
          deposit[idx(bx, by)] = kind;
          for (let grow = 0; grow < 200 && tiles.length < size; grow++) {
            const from = tiles[Math.floor(r() * tiles.length)] ?? 0;
            const fx = from % w;
            const fy = (from - fx) / w;
            const d = Math.floor(r() * 4);
            const nx = fx + ([1, 0, -1, 0][d] ?? 0);
            const ny = fy + ([0, 1, 0, -1][d] ?? 0);
            if (Math.abs(nx - bx) > 3 || Math.abs(ny - by) > 2) continue;
            if (nx < x0 || ny < y0 || nx >= x0 + PW || ny >= y0 + PH || !clear(nx, ny)) continue;
            deposit[idx(nx, ny)] = kind;
            tiles.push(idx(nx, ny));
          }
          break;
        }
      }
    }
  return {
    w,
    h,
    deposit,
    water,
    trunk,
    plot,
    plots: [{ id: "yard", name: "The Yard", why: "", price: 0, x: 0, y: 0, w, h }],
    depot: [cx, cy],
  };
}
