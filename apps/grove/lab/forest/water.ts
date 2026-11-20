/**
 * Still water. Pools are painted with one marker index; each frame, every marker pixel is filled
 * with what stands above its pool's far shore, mirrored and darkened, so whatever moves (lanterns,
 * fireflies, a lifting lantern) shows in the water too. Seen from low down, a pond's near rows
 * reflect things higher up, so the mirror is stretched: a short pool still holds tall trees.
 */

import { ix, R } from "../pixel/palette.ts";
import type { Surface } from "../pixel/raster.ts";
import { hash3 } from "../pixel/rng.ts";
import { WATER } from "./landmarks.ts";

/** A table from an index to its reflection: sky three steps deeper, everything else two levels darker. */
export function reflectionMap(): Uint8Array {
  const map = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const r = i >> 3;
    const l = i & 7;
    if (r === R.SKY0 || r === R.SKY1 || r === R.SKY2) {
      const k = Math.max(0, (r - R.SKY0) * 8 + l - 3);
      map[i] = ix(R.SKY0 + (k >> 3), k & 7);
    } else if (r === R.GLOW || r === R.FIRE || r === R.LIGHTS || r === R.STAR || r === R.RARITY) {
      map[i] = ix(r, l - 1);
    } else map[i] = i === 0 ? ix(R.HAZE, 2) : ix(r, l - 2);
  }
  return map;
}

/** Glints: a reflection index lifted a few levels, for the ripple lines that catch the light. */
export function glintMap(): Uint8Array {
  const map = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const r = i >> 3;
    const l = i & 7;
    if (r === R.SKY0 || r === R.SKY1 || r === R.SKY2) {
      const k = Math.min(23, (r - R.SKY0) * 8 + l + 4);
      map[i] = ix(R.SKY0 + (k >> 3), k & 7);
    } else map[i] = ix(r, l + 2);
  }
  return map;
}

export function reflectWater(
  s: Surface,
  t: number,
  reflect: Uint8Array,
  glint: Uint8Array,
  winter: boolean,
  phase: number,
): void {
  const { w, h, data } = s;
  for (let x = 0; x < w; x++) {
    let y0 = -1;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (data[i] !== WATER) {
        y0 = -1;
        continue;
      }
      if (y0 < 0) y0 = y;
      const d = y - y0;
      if (winter) {
        // Ice: pale, with long cracks of reflection.
        const crack = (d + Math.floor((x + phase) / 9)) % 4 === 1 && hash3((x + phase) >> 2, d, 3) < 0.55;
        data[i] = crack ? ix(R.SNOW, 3) : ix(R.SNOW, d === 0 ? 2 : hash3(x + phase, y, 5) < 0.15 ? 5 : 4);
        continue;
      }
      const sy = y0 - 3 - Math.floor(d * 5);
      const wave = d > 1 ? Math.round(Math.sin(y * 1.9 + t * 1.6 + (x + phase) * 0.07) * 0.8) : 0;
      const sx = Math.max(0, Math.min(w - 1, x + wave));
      let src = sy >= 0 ? (data[sy * w + sx] ?? 0) : 0;
      if (src === WATER) src = sy >= 0 ? (data[sy * w + x] ?? 0) : 0;
      let v = reflect[src] ?? src;
      // The far shore's lip is dark; ripple lines catch the light, drifting slowly.
      if (d === 0) v = ix(R.HAZE, 1);
      else if (d % 3 === 2 && hash3(Math.floor((x + phase + t * 3) / 5), d, 9) < 0.28) v = glint[v] ?? v;
      data[i] = v;
    }
  }
}
