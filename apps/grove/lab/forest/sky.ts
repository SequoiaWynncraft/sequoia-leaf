/**
 * The valley's sky: the glade's streaked dusk gradient (copied from `../pixel/backdrop.ts`, whose
 * sky drawing is not exported), cloud banks lit from below, the moon at night, and the stars.
 */

import { ix, R, rampOf, type Time } from "../pixel/palette.ts";
import { bayer, type Surface } from "../pixel/raster.ts";
import { noise1, Rng } from "../pixel/rng.ts";
import { HORIZON, type Layer, WORLD_H } from "./world.ts";

const SKY_STEPS = 24;
export const skyIndex = (g: number): number => {
  const k = Math.max(0, Math.min(SKY_STEPS - 1, Math.floor(g)));
  return ix(R.SKY0 + (k >> 3), k & 7);
};

export const isSky = (index: number): boolean => {
  const r = rampOf(index);
  return r === R.SKY0 || r === R.SKY1 || r === R.SKY2;
};

/** Where the gradient stands at a row: 0 the top's deepest step, 23 the horizon's gold. */
export function gradient(time: Time, y: number): number {
  // The art is taller than the glade's, so the gradient starts a little way down.
  const t = Math.max(0, Math.min(1, (y - 18) / (HORIZON - 16)));
  if (time === "night") return 23 * Math.pow(t, 2.1);
  if (time === "day") return 4 + 19 * Math.pow(t, 1.1);
  return 5 + 18.6 * Math.pow(t, 1.18);
}

export interface Star {
  x: number;
  y: number;
  big: boolean;
  phase: number;
  period: number;
}

export function paintSky(layer: Layer, time: Time, seed: number): Star[] {
  const s = layer.s;
  const rng = new Rng(seed ^ 0x51ce);
  const sd = Math.floor(rng.next() * 9999);
  for (let y = 0; y < WORLD_H; y++) {
    const g = gradient(time, y);
    for (let x = 0; x < s.w; x++) {
      let v: number;
      if (time === "night") v = g + bayer(x, y) - 0.5;
      else {
        const a = noise1(x / 14 + Math.floor(y / 2) * 5.37, sd) - 0.5;
        const b = noise1(x / 6 + y * 3.91, sd + 7) - 0.5;
        v = g + a * 1.3 + b * 0.25;
      }
      s.set(x, y, skyIndex(v));
    }
  }
  // Cloud banks: long streaks stacked a couple of rows apart, lit from below by the sunset.
  const banks = time === "day" ? 6 : 9;
  for (let i = 0; i < banks; i++) {
    const cy = 30 + (HORIZON - 40) * ((i + rng.range(0.15, 0.85)) / banks);
    const cx = ((i * 0.41 + rng.range(-0.1, 0.1)) % 1) * s.w;
    const streaks = rng.int(2, 4);
    for (let k = 0; k < streaks; k++) {
      const sy = Math.round(cy + k * rng.range(2, 3.5));
      const len = (rng.range(0.16, 0.3) * s.w + 20) * (1 - k * 0.18);
      const sx = cx + rng.range(-0.06, 0.06) * s.w + k * rng.range(-8, 8);
      const thick = rng.range(1.4, 3.2) * (k === 0 ? 1 : 0.8);
      streak(s, time, sx, sy, len, thick, sd + i * 17 + k);
    }
  }
  if (time === "night") moon(s, Math.round(s.w * 0.36), 52);
  return time === "day" ? [] : placeStars(s.w, time, rng.fork("stars"));
}

function streak(s: Surface, time: Time, cx: number, cy: number, len: number, thick: number, seed: number): void {
  const lift = time === "night" ? 1.5 + 4 * (cy / HORIZON) : 5.2 - 2.6 * (cy / HORIZON);
  for (let x = Math.floor(cx - len / 2); x <= cx + len / 2; x++) {
    if (x < 0 || x >= s.w) continue;
    const u = (x - (cx - len / 2)) / len;
    const run = Math.floor(x / 4);
    const prof = Math.pow(Math.sin(Math.PI * u), 0.55) * thick * (0.55 + 0.75 * noise1(run / 1.7, seed));
    if (prof < 0.6) continue;
    const top = Math.round(cy - prof * 0.55);
    const bot = Math.round(cy + prof * 0.45);
    for (let y = top; y <= bot; y++) {
      const g = gradient(time, y);
      if (time === "day") s.set(x, y, ix(R.STAR, y === bot ? 4 : y === top ? 7 : 6));
      else s.set(x, y, skyIndex(g + lift + (y === bot ? 1.6 : y === top ? -0.6 : 0.4)));
    }
  }
}

function moon(s: Surface, mx: number, my: number): void {
  const r = 5.5;
  for (let y = Math.floor(my - r * 3); y <= my + r * 3; y++) {
    for (let x = Math.floor(mx - r * 3); x <= mx + r * 3; x++) {
      const d = Math.hypot(x - mx, y - my);
      if (d <= r) {
        const shade = Math.hypot(x - (mx - 3.2), y - (my - 0.5)) < r * 0.95;
        const mare = Math.hypot(x - (mx + 1.5), y - (my + 1.5)) < 1.6 || Math.hypot(x - (mx + 2.5), y - (my - 2)) < 1.1;
        s.set(x, y, shade ? ix(R.STAR, 1) : mare ? ix(R.STAR, 5) : ix(R.STAR, d > r - 1 ? 6 : 7));
      } else if (d < r * 2.6 && isSky(s.get(x, y))) {
        const v = 1 - (d - r) / (r * 1.6);
        if (bayer(x, y) < v * 0.55) s.set(x, y, ix(R.SKY1, 7));
      }
    }
  }
}

function placeStars(w: number, time: Time, rng: Rng): Star[] {
  const count = Math.round((w * HORIZON) / (time === "night" ? 240 : 800));
  const out: Star[] = [];
  for (let i = 0; i < count; i++) {
    const y = Math.round(Math.pow(rng.next(), time === "night" ? 1.2 : 1.7) * HORIZON * (time === "night" ? 0.8 : 0.5));
    out.push({
      x: rng.int(2, w - 3),
      y: Math.max(20, y + 16),
      big: rng.chance(0.1),
      phase: rng.next(),
      period: rng.range(2.4, 5.5),
    });
  }
  return out;
}

/** Twinkles the stars that fall on open sky, in frame coordinates (`ox`, `oy` the layer's offset). */
export function drawStars(s: Surface, stars: readonly Star[], t: number, ox: number, oy: number): void {
  for (const st of stars) {
    const x = st.x - ox;
    const y = st.y - oy;
    if (x < 1 || x >= s.w - 1 || y < 1 || y >= s.h - 1) continue;
    const b = 0.5 + 0.5 * Math.sin((t / st.period + st.phase) * Math.PI * 2);
    if (b < 0.2) continue;
    s.setWhere(x, y, ix(R.STAR, b > 0.7 ? 7 : 5), isSky);
    if (st.big && b > 0.6) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        s.setWhere(x + dx, y + dy, ix(R.STAR, 4), isSky);
    }
  }
}
