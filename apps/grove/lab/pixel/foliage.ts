/**
 * Clouded foliage, as the welcome canopy draws it: a pad is a crowd of small rounded clumps, each
 * lit on top and dark underneath, painted top to bottom so every clump's lit crown sits over the
 * shadow of the one above. The pad as a whole is lit from one side, so its clumps share one light.
 */

import { ix, R } from "./palette.ts";
import { type Sprite, sprite } from "./raster.ts";
import { hash3, noise1, Rng } from "./rng.ts";

export interface Lobe {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export interface PadSpec {
  lobes: readonly Lobe[];
  ramp: number;
  /** Where light comes from: -1 the left, 1 the right. */
  lightX: number;
  /** Clump radius: the size of the foliage texture. */
  clump: number;
  seed: number;
  /** Shift every level, as a pad in shadow or behind the trunk is drawn darker. */
  bias?: number;
  /** Fraction of clump tops that catch the gold light. */
  gold?: number;
  /** Needle tips: single pixels sticking out of the lit top edge. */
  tips?: boolean;
  /** The sunset-lit tops are drawn in this ramp's level, so every foliage in the glade shares one gold. */
  goldIndex?: number;
}

export interface PadArt {
  sprite: Sprite;
  /** Where the sprite's (0, 0) sits relative to the lobes' coordinate origin. */
  ox: number;
  oy: number;
}

interface Clump {
  x: number;
  y: number;
  r: number;
  base: number;
}

export function renderPad(spec: PadSpec): PadArt {
  const rng = new Rng(spec.seed);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of spec.lobes) {
    minX = Math.min(minX, l.x - l.rx);
    maxX = Math.max(maxX, l.x + l.rx);
    minY = Math.min(minY, l.y - l.ry);
    maxY = Math.max(maxY, l.y + l.ry);
  }
  const pad = spec.clump + 2;
  const ox = Math.floor(minX - pad);
  const oy = Math.floor(minY - pad);
  const w = Math.ceil(maxX + pad) - ox + 1;
  const h = Math.ceil(maxY + pad) - oy + 1;
  const out = sprite(w, h);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const hx = Math.max(1, (maxX - minX) / 2);
  const hy = Math.max(1, (maxY - minY) / 2);

  // Clumps on a jittered staggered grid inside each lobe.
  const clumps: Clump[] = [];
  const r0 = spec.clump;
  const sp = r0 * 1.45;
  for (const l of spec.lobes) {
    const rows = Math.max(1, Math.round((l.ry * 2) / (sp * 0.82)));
    for (let row = 0; row <= rows; row++) {
      const y = l.y - l.ry + (row / rows) * l.ry * 2;
      const dyN = (y - l.y) / l.ry;
      const half = l.rx * Math.sqrt(Math.max(0, 1 - dyN * dyN));
      const n = Math.max(1, Math.round((half * 2) / sp));
      for (let k = 0; k <= n; k++) {
        const x = l.x - half + (k / n) * half * 2 + (row % 2 ? sp * 0.35 : -sp * 0.15) + rng.range(-0.6, 0.6);
        const ex = (x - l.x) / l.rx;
        if (ex * ex + dyN * dyN > 1.05) continue;
        // The pad's own light: high on its lit shoulder, low underneath.
        const ny = (y - cy) / hy;
        const nx = ((x - cx) / hx) * spec.lightX;
        const light = -ny * 1.05 + nx * 0.4 + 0.1;
        clumps.push({
          x: x + rng.range(-0.4, 0.4),
          y: y + rng.range(-0.5, 0.5),
          r: r0 * (rng.chance(0.2) ? rng.range(1.15, 1.35) : rng.range(0.8, 1.05)) * (dyN > 0.5 ? 0.9 : 1),
          base: 3.5 + light * 2.2 + (spec.bias ?? 0),
        });
      }
    }
  }
  clumps.sort((a, b) => a.y - b.y || a.x - b.x);

  const gold = spec.gold ?? 0.3;
  for (const c of clumps) {
    const goldTop = c.base > 4 && rng.chance(gold);
    const x0 = Math.floor(c.x - c.r - 1);
    const x1 = Math.ceil(c.x + c.r + 1);
    const y0 = Math.floor(c.y - c.r - 1);
    const y1 = Math.ceil(c.y + c.r + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x - c.x) / c.r;
        const dy = (y - c.y) / (c.r * 0.86);
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        // Lit crown, body, dark crescent below; the lit side leans toward the light.
        const local = -dy * 1.25 + dx * spec.lightX * 0.45;
        let level = c.base + (local > 0.55 ? 1 : local < -0.6 ? -1.4 : 0);
        if (dy > 0.62 && d > 0.55) level = Math.min(level, c.base - 1.8);
        const px = x - ox;
        const py = y - oy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        // A sunlit cluster: the clump's lit quarter, its crown brightest.
        if (goldTop && dy < -0.15 && dx * spec.lightX < 0.35 && d < 0.8) {
          const crown = dy < -0.55;
          out.data[py * w + px] = crown
            ? (spec.goldIndex ?? ix(spec.ramp, 7))
            : ix(spec.ramp, Math.min(7, Math.round(c.base) + 1));
          continue;
        }
        out.data[py * w + px] = ix(spec.ramp, Math.max(0, Math.min(7, Math.round(level))));
      }
    }
  }

  // Sunlit rims: where the silhouette faces the light (above, and toward the light's side), it
  // catches the gold, in runs, as the welcome canopy's clusters do.
  const lit = new Uint8Array(out.data);
  const opaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && (lit[y * w + x] ?? 0) !== 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = lit[y * w + x] ?? 0;
      if (!v || (spec.bias ?? 0) < -1) continue;
      const level = v & 7;
      if (level < 2 || y > h * 0.7) continue;
      const above = !opaque(x, y - 1);
      const side = !opaque(x + spec.lightX, y);
      const run = noise1(x / 2.5 + y * 1.7, spec.seed);
      if (above && run > 0.3) {
        out.data[y * w + x] = run > 0.62 ? (spec.goldIndex ?? ix(spec.ramp, 7)) : ix(spec.ramp, Math.min(7, level + 2));
        if (opaque(x, y + 1) && ((lit[(y + 1) * w + x] ?? 0) & 7) >= 2)
          out.data[(y + 1) * w + x] = ix(spec.ramp, Math.min(7, ((lit[(y + 1) * w + x] ?? 0) & 7) + 1));
      } else if (side && run > 0.45 && y < h * 0.55) {
        out.data[y * w + x] = ix(spec.ramp, Math.min(7, level + 2));
      }
    }
  }

  // Needle tips along the lit top edge, and a dark lip along the underside.
  const tips = spec.tips ?? true;
  for (let x = 0; x < w; x++) {
    let top = -1;
    for (let y = 0; y < h; y++) {
      if (out.data[y * w + x]) {
        top = y;
        break;
      }
    }
    if (top > 0 && tips) {
      const v = out.data[top * w + x] ?? 0;
      if ((v & 7) >= 4 && hash3(x, top, spec.seed) < 0.32)
        out.data[(top - 1) * w + x] = ix(spec.ramp, Math.max(3, (v & 7) - 1));
    }
    let bottom = -1;
    for (let y = h - 1; y >= 0; y--) {
      if (out.data[y * w + x]) {
        bottom = y;
        break;
      }
    }
    if (bottom >= 0)
      out.data[bottom * w + x] = ix(spec.ramp, Math.max(0, Math.min(1, ((out.data[bottom * w + x] ?? 0) & 7) - 2)));
  }
  return { sprite: out, ox, oy };
}

/**
 * Snow on a sprite's upward faces, after the welcome's winterise: caps a pixel or two deep on runs
 * of level tops, mounding a pixel in the middle of longer caps, with some tops left bare.
 */
export function snowCap(s: Sprite, seed: number, depth = 2): Sprite {
  const out: Sprite = { w: s.w, h: s.h + 1, data: new Uint8Array(s.w * (s.h + 1)) };
  for (let y = 0; y < s.h; y++) out.data.set(s.data.subarray(y * s.w, (y + 1) * s.w), (y + 1) * s.w);
  const tops: number[] = [];
  for (let x = 0; x < s.w; x++) {
    let top = -1;
    for (let y = 1; y < out.h; y++) {
      if (out.data[y * s.w + x]) {
        top = y;
        break;
      }
    }
    tops.push(top);
  }
  let x = 0;
  while (x < s.w) {
    if ((tops[x] ?? -1) < 0) {
      x++;
      continue;
    }
    let end = x;
    while (end + 1 < s.w && (tops[end + 1] ?? -1) >= 0 && Math.abs((tops[end + 1] ?? 0) - (tops[end] ?? 0)) <= 1) end++;
    const len = end - x + 1;
    const bare = hash3(x, len, seed) < 0.22;
    if (len >= 3 && !bare) {
      for (let i = x; i <= end; i++) {
        const t = tops[i] ?? 0;
        const edge = i === x || i === end;
        const mid = Math.abs(i - (x + end) / 2) < len / 4;
        out.data[t * s.w + i] = ix(R.SNOW, edge ? 4 : 6);
        if (!edge && depth > 1 && t + 1 < out.h && out.data[(t + 1) * s.w + i])
          out.data[(t + 1) * s.w + i] = ix(R.SNOW, 3);
        if (mid && len >= 5 && t - 1 >= 0) out.data[(t - 1) * s.w + i] = ix(R.SNOW, 7);
      }
    }
    x = end + 1;
  }
  return out;
}
