/**
 * An aurora in a rare spirit's colour, after the welcome scenes' (sequoia-backend/assets/welcome/
 * authoring/README.md, "aurora.py"): settled curtains of tall, soft, irregular vertical rays in
 * overlapping groups, rising from a gently curved base and fading upward through the colour into
 * the violet sky over a faint dithered sheet. The lower edge brightens only in short uneven
 * stretches, never as a line. Nothing travels: each ray only breathes in brightness on its own
 * phase. It is drawn in the RARITY ramp, so it takes the rank's colour, and only on open sky.
 */

import { isSky } from "./backdrop.ts";
import type { Layout } from "./layout.ts";
import { ix, R } from "./palette.ts";
import type { Surface } from "./raster.ts";
import { hash3, noise1 } from "./rng.ts";

/**
 * `strength` (0 to 1) grows the curtains in and out; `curtains` (1 to 3) is how much of the sky
 * they take, from one soft band to the whole sky.
 */
export function drawAurora(s: Surface, L: Layout, strength: number, t: number, seed: number, curtains: number): void {
  if (strength <= 0) return;
  const bottom = Math.max(8, L.horizon - 6);
  for (let c = 0; c < curtains; c++) {
    const sd = (seed + c * 7919) % 100000;
    // Each curtain's span and height: the first wide and low, the later ones higher and shorter.
    const x0 = L.W * (c === 0 ? 0.04 : c === 1 ? 0.3 : -0.05);
    const x1 = L.W * (c === 0 ? 0.72 : c === 1 ? 1.05 : 0.45);
    const baseY = bottom * (0.62 - c * 0.14);
    const tall = bottom * (0.26 + 0.05 * curtains) * (0.55 + 0.45 * strength);
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(L.W, x1); x++) {
      const u = (x - x0) / (x1 - x0);
      // The curtain thins toward its ends.
      const span = Math.sin(Math.PI * u);
      const by = Math.round(
        baseY + Math.sin(x * 0.027 + sd) * bottom * 0.11 + Math.sin(x * 0.071 + sd * 1.7) * bottom * 0.04,
      );
      // Separate rays in groups: a run of columns carries rays, with dark sky between them.
      const group = noise1(x / 5, sd);
      if (group < 0.42 || hash3(x, sd, 3) < 0.42) continue;
      const breath = 0.7 + 0.3 * Math.sin(t * (0.9 + hash3(x, sd, 5) * 0.8) + hash3(x, sd, 6) * 6.3);
      const h = tall * span * (0.35 + 0.9 * noise1(x / 7, sd + 1)) * (0.6 + 0.6 * hash3(x, sd, 4));
      const bright = Math.min(1, group * 1.3) * breath * strength;
      for (let k = 0; k < h * Math.min(1, strength * 1.5); k++) {
        const y = by - k;
        if (y < 1) break;
        const v = k / h;
        // Solid low down; toward the top every other pixel, then every third, into the sky.
        if (v > 0.5 && k % 2 === 1) continue;
        if (v > 0.78 && k % 3 !== 0) continue;
        if (!isSky(s.get(x, y))) continue;
        const level = v < 0.08 ? 6 : v < 0.28 ? 5 : v < 0.5 ? 4 : v < 0.72 ? 3 : 2;
        s.set(x, y, ix(R.RARITY, Math.max(1, level - (bright < 0.42 ? 1 : 0) - (bright < 0.25 ? 1 : 0))));
      }
      // The lower edge, bright only in short uneven stretches.
      if (noise1(x / 3.2 + c * 11, sd + 2) > 0.62 && isSky(s.get(x, by + 1)))
        s.set(x, by + 1, ix(R.RARITY, bright > 0.5 ? 7 : 6));
    }
    // The faint sheet the rays hang in: a sparse scatter of its darkest light.
    for (let y = Math.max(1, Math.round(baseY - tall)); y < baseY; y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(L.W, x1); x++) {
        const u = (x - x0) / (x1 - x0);
        const d = Math.sin(Math.PI * u) * (1 - (baseY - y) / tall) * strength;
        if (hash3(x, y, sd) > d * 0.07 || !isSky(s.get(x, y))) continue;
        s.set(x, y, ix(R.RARITY, 2));
      }
    }
  }
}
