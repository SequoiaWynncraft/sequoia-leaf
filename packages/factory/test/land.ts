/**
 * Land of any size, ported from the scale study (works-scale/scripts/land.ts), in about the
 * proportions of today's 48 by 36 map:
 * deposits 14% of tiles (deadfall 28% of them, stone 19, ore 15, sand 16, clay 14, resin 8),
 * water 5.4%, redwoods 2.1% (2 by 2 trunks). Plots of 16 by 12, the depot in the middle plot.
 *
 * The whole map is one plot ("yard"), owned: which plot a tile is on does not change what a tick or
 * a save costs.
 */
import * as F from "../src/index.ts";
import { rng } from "./random.ts";

export const PW = 16;
export const PH = 12;

const KINDS: [F.RawName, number][] = [
  ["deadfall", 0.28],
  ["stone", 0.19],
  ["ore", 0.15],
  ["sand", 0.16],
  ["clay", 0.14],
  ["resin", 0.08],
];

/** A land of one owned plot, from its deposits (by thing), water and trunks. */
function oneplot(
  w: number,
  h: number,
  deposit: Uint8Array,
  water: Uint8Array,
  trunk: Uint8Array,
  depot: readonly [number, number],
): F.Land {
  return F.landOf({
    w,
    h,
    deposit,
    water,
    trunk,
    plot: new Uint8Array(w * h),
    plots: [{ plot: F.plot("yard"), name: "The Yard", why: "", price: 0, ring: 0, x: 0, y: 0, w, h }],
    depot,
  });
}

export function makeLand(cols: number, rows: number, seed = 7): F.Land {
  const r = rng(seed);
  const w = cols * PW;
  const h = rows * PH;
  const n = w * h;
  const deposit = new Uint8Array(n).fill(F.NONE);
  const water = new Uint8Array(n);
  const trunk = new Uint8Array(n);
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
    return i >= 0 && water[i] === 0 && trunk[i] === 0 && deposit[i] === F.NONE && !nearDepot(x, y);
  };
  const pick = (): F.RawName => {
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
        const kind = F.item(pick());
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
  return oneplot(w, h, deposit, water, trunk, [cx, cy]);
}

/** A small bare land, one plot owned, with a few deposits (of anything gathered) where asked and the depot's middle at `depot`. */
export function bareLand(
  w: number,
  h: number,
  deposits: readonly (readonly [number, number, F.ItemName])[],
  depot: readonly [number, number],
): F.Land {
  const deposit = new Uint8Array(w * h).fill(F.NONE);
  for (const [x, y, raw] of deposits) deposit[y * w + x] = F.item(raw);
  return oneplot(w, h, deposit, new Uint8Array(w * h), new Uint8Array(w * h), depot);
}

/**
 * The same land in a larger map: its tiles at the top left, bare owned ground to the right and below.
 * The same pieces stand on it at the same places, so a yard can be made again on a map of another size.
 */
export function widened(land: F.Land, w: number, h: number): F.Land {
  const deposit = new Uint8Array(w * h).fill(F.NONE);
  const water = new Uint8Array(w * h);
  const trunk = new Uint8Array(w * h);
  for (let y = 0; y < land.h; y++)
    for (let x = 0; x < land.w; x++) {
      deposit[y * w + x] = land.deposit[y * land.w + x] ?? F.NONE;
      water[y * w + x] = land.water[y * land.w + x] ?? 0;
      trunk[y * w + x] = (land.tree[y * land.w + x] ?? -1) >= 0 ? 1 : 0;
    }
  return oneplot(w, h, deposit, water, trunk, land.depot);
}
