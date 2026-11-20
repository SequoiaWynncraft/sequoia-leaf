/**
 * Care: watering, pruning and misting the tree. Each is a short effect drawn as a function of the
 * time since the tap: water arcs from the can and the crown takes a breath; shears snip a pad
 * and its clippings fall; the mister lays a drifting veil and leaves dew sparkling.
 */

import { type Canvas, drawPouringCan, drawToolIcon } from "./hud.ts";
import { ix, R } from "./palette.ts";
import type { Tool } from "./params.ts";
import type { Surface } from "./raster.ts";
import { hash3 } from "./rng.ts";

export interface CareEffect {
  tool: Tool;
  t0: number;
  x: number;
  y: number;
  /** For shears: the pad that was cut, and where its clippings fall from. */
  pad?: { x0: number; x1: number; y0: number; y1: number };
}

export const CARE_LENGTH: Record<Tool, number> = { water: 2.1, shears: 1.8, mist: 2.4 };

/** Where the can is held for a tap: up and to the right, its rose a little above the spot. */
export function canAt(x: number, y: number): { x: number; y: number } {
  return { x: x + 3, y: Math.max(1, y - 26) };
}

/** The world side: droplets, clippings, mist and sparkles. */
export function drawCareWorld(s: Surface, e: CareEffect, t: number): void {
  const tau = t - e.t0;
  if (e.tool === "water") {
    // Two streams from the can's rose arc down onto the crown and splash.
    const can = canAt(e.x, e.y);
    const sx = can.x + 2;
    const sy = can.y + 15;
    for (let i = 0; i < 26; i++) {
      const born = 0.1 + (i >> 1) * 0.055;
      const u = (tau - born) / 0.42;
      if (u < 0 || u > 1.15) continue;
      const spread = (i % 2 === 0 ? -3 : 3) + (hash3(i, 1, 7) - 0.5) * 6;
      const tx = e.x + spread;
      if (u > 1) {
        // The splash: a pixel thrown either side.
        const k = (u - 1) / 0.15;
        s.set(tx - 1 - k * 2, e.y - 1 - k, ix(R.WATER, 7));
        s.set(tx + 1 + k * 2, e.y - 1 - k, ix(R.WATER, 6));
        continue;
      }
      const x = sx + (tx - sx) * u;
      const y = sy + (e.y - sy) * u * u;
      s.set(x, y, ix(R.WATER, 7));
      s.set(x, y - 1, ix(R.WATER, 5));
      s.set(x - 1, y - 1, ix(R.WATER, 3));
    }
    sparkles(s, e, tau - 0.7, 8, 1.3);
  } else if (e.tool === "shears") {
    // Sprigs fall from where the pad was cut, tumbling as they go.
    const box = e.pad ?? { x0: e.x - 6, x1: e.x + 6, y0: e.y - 4, y1: e.y + 4 };
    for (let i = 0; i < 22; i++) {
      const u = (tau - 0.2 - hash3(i, 2, 3) * 0.3) / 1.3;
      if (u < 0 || u > 1) continue;
      const x0 = box.x0 + hash3(i, 3, 3) * (box.x1 - box.x0);
      const y0 = box.y0 + hash3(i, 4, 3) * (box.y1 - box.y0) * 0.6;
      const x = x0 + Math.sin(u * 7 + i) * 4;
      const y = y0 + u * u * 52 + u * 8;
      const flip = Math.floor(u * 9 + i) % 2;
      s.set(x, y, ix(R.FOLI, 6));
      s.set(x + (flip ? 1 : -1), y, ix(i % 3 === 0 ? R.OLIVE : R.FOLI, i % 3 === 0 ? 6 : 4));
      s.set(x + (flip ? 2 : -2), y + 1, ix(R.FOLI, 3));
    }
  } else {
    // Soft puffs of mist drifting out across the crown, thinning, then dew catching the light.
    for (let i = 0; i < 7; i++) {
      const u = (tau - i * 0.09) / 1.5;
      if (u < 0 || u > 1) continue;
      const cx = e.x + 10 - u * (18 + i * 3);
      const cy = e.y - 3 + (i - 3) * 1.5 + u * 4;
      const r = 2 + u * 5;
      for (let y = Math.floor(cy - r); y <= cy + r; y++) {
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          const d = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
          if (d > 1 - u * 0.3) continue;
          if (u > 0.45 && (x + y) % 2 === 0) continue;
          s.set(x, y, ix(R.WATER, d < 0.35 && u < 0.5 ? 7 : 6));
        }
      }
    }
    sparkles(s, e, tau - 0.5, 10, 1.8);
  }
}

function sparkles(s: Surface, e: CareEffect, tau: number, count: number, life: number): void {
  if (tau < 0) return;
  for (let i = 0; i < count; i++) {
    const born = hash3(i, 5, 5) * 0.6;
    const u = (tau - born) / (life * 0.6);
    if (u < 0 || u > 1) continue;
    const x = Math.round(e.x + (hash3(i, 6, 5) - 0.5) * 26);
    const y = Math.round(e.y + (hash3(i, 7, 5) - 0.6) * 16);
    const bright = u > 0.2 && u < 0.6;
    s.set(x, y, ix(R.STAR, 7));
    if (bright) {
      s.set(x + 1, y, ix(R.WATER, 6));
      s.set(x - 1, y, ix(R.WATER, 6));
      s.set(x, y + 1, ix(R.WATER, 6));
      s.set(x, y - 1, ix(R.WATER, 6));
    }
  }
}

/** The tool itself, at work, drawn over the art. */
export function drawCareTool(c: Canvas, e: CareEffect, t: number): void {
  const tau = t - e.t0;
  const a = tau < 0.12 ? tau / 0.12 : tau > 1.1 ? Math.max(0, 1 - (tau - 1.1) / 0.3) : 1;
  if (a <= 0) return;
  if (e.tool === "water") {
    const can = canAt(e.x, e.y);
    if (tau < 0.12) drawToolIcon(c, "water", can.x, can.y + 2, a);
    else drawPouringCan(c, can.x, can.y, a);
  } else if (e.tool === "shears") {
    // Snip: the shears close on the pad with a little flash at the blades.
    const snap = tau > 0.18 && tau < 0.32;
    drawToolIcon(c, "shears", e.x - 3 + (snap ? 1 : 0), e.y - 14 - (snap ? 1 : 0), a);
    if (snap) {
      for (const [dx, dy] of [
        [0, -3],
        [3, 0],
        [2, -2],
        [-2, -2],
      ] as const)
        c.px(e.x + 11 + dx, e.y - 12 + dy, [255, 255, 255]);
    }
  } else {
    const pump = Math.floor(tau * 5) % 2 === 0 && tau < 0.9;
    drawToolIcon(c, "mist", e.x + 14, e.y - 10 + (pump ? 1 : 0), a);
  }
}

/**
 * The crown's breath after watering: pads lift a pixel and brighten, in a wave from the foot up.
 * `drinks` are more moments the crown drinks, such as each of a day's groots.
 */
export function breath(
  effects: readonly CareEffect[],
  t: number,
  padY: number,
  foot: number,
  top: number,
  drinks: readonly number[] = [],
): { lift: number; bright: boolean } {
  const h = (foot - padY) / Math.max(1, foot - top);
  const wave = (tau: number): { lift: number; bright: boolean } | null => {
    const local = tau - h * 0.35;
    return local > 0 && local < 0.55 ? { lift: local < 0.4 ? 1 : 0, bright: local < 0.5 } : null;
  };
  for (const e of effects) {
    if (e.tool !== "water") continue;
    const w = wave(t - e.t0 - 0.65);
    if (w) return w;
  }
  for (const at of drinks) {
    const w = wave(t - at);
    if (w) return w;
  }
  return { lift: 0, bright: false };
}
