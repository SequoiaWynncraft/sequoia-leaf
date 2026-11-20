/**
 * Care: watering, pruning and misting the tree, each a short effect drawn as a function of the time
 * since the tap, in the welcome's own vocabulary: droplets in the ice and frost tones, falling
 * leaves the welcome's shape in the tree's own colours, mist in the welcome's puff colours thinning
 * through its dither, and dew catching the light as the welcome's sparkles. The crown drinks after
 * watering: a soft light climbs it from the foot. The tool itself (`drawCareTool`) is UI and stands
 * over the world.
 */

import { leaf, sparkleStage } from "../../bundle/vocabulary.ts";
import { bayer } from "../../engine/dither.ts";
import { hash3 } from "../../engine/rng.ts";
import type { Tool } from "../../game/params.ts";
import { type Canvas, drawPouringCan, drawToolIcon } from "../../ui/hud.ts";
import { drinkWave, type Fx, isTree, leafKeys } from "./stage.ts";

export interface CareEffect {
  tool: Tool;
  t0: number;
  x: number;
  y: number;
}

export const CARE_LENGTH: Record<Tool, number> = { water: 2.1, shears: 1.8, mist: 2.4 };

/** Where the can is held for a tap: up and to the right, its rose a little above the spot. */
export function canAt(x: number, y: number): { x: number; y: number } {
  return { x: x + 3, y: Math.max(1, y - 26) };
}

/** The world side, drawn behind the near layer. */
export function drawCareWorld(fx: Fx, e: CareEffect, t: number): void {
  const tau = t - e.t0;
  const { pic, ink } = fx;
  if (e.tool === "water") {
    // Two streams from the can's rose arc down onto the crown and splash.
    const can = canAt(e.x, e.y);
    const sx = can.x + 2;
    const sy = can.y + 15;
    for (let i = 0; i < 26; i++) {
      const born = 0.1 + (i >> 1) * 0.055;
      const u = (tau - born) / 0.42;
      if (u < 0 || u > 1.15) continue;
      const tx = e.x + (i % 2 === 0 ? -3 : 3) + (hash3(i, 1, 7) - 0.5) * 6;
      if (u > 1) {
        const k = (u - 1) / 0.15;
        pic.set(tx - 1 - k * 2, e.y - 1 - k, ink.c("ice_hi"));
        pic.set(tx + 1 + k * 2, e.y - 1 - k, ink.c("ice_body"));
        continue;
      }
      const x = sx + (tx - sx) * u;
      const y = sy + (e.y - sy) * u * u;
      pic.set(x, y, ink.c("ice_hi"));
      pic.set(x, y - 1, ink.c("ice_body"));
      pic.set(x - 1, y - 1, ink.c("ice_shadow"));
    }
    dew(fx, e, tau - 0.7, 8, 1.3);
    drinkWave(fx, (tau - 0.65) / 0.9);
  } else if (e.tool === "shears") {
    // Leaves fall from where the crown was trimmed, rocking as they go, in the tree's own colours.
    const [light, dark] = leafKeys(fx.tree, fx.season);
    for (let i = 0; i < 12; i++) {
      const u = (tau - 0.2 - hash3(i, 2, 3) * 0.3) / 1.3;
      if (u < 0 || u > 1) continue;
      const x0 = e.x + (hash3(i, 3, 3) - 0.5) * 12;
      const y0 = e.y + (hash3(i, 4, 3) - 0.5) * 6;
      const x = x0 + Math.sin(u * 7 + i) * 4;
      const y = y0 + u * u * 40 + u * 8;
      leaf(fx, Math.round(x), Math.round(y), Math.floor(u * 9 + i), ink.c(light), ink.c(dark));
    }
  } else {
    // Soft puffs of mist drifting out across the crown, thinning through the dither.
    for (let i = 0; i < 7; i++) {
      const u = (tau - i * 0.09) / 1.5;
      if (u < 0 || u > 1) continue;
      const cx = e.x + 10 - u * (18 + i * 3);
      const cy = e.y - 3 + (i - 3) * 1.5 + u * 4;
      const r = 2 + u * 5;
      for (let y = Math.floor(cy - r); y <= cy + r; y++)
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          const d = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
          if (d > 1 || bayer(x, y) > (1 - u) * (1.1 - d * 0.6)) continue;
          pic.set(x, y, ink.c(d < 0.35 && u < 0.5 ? "puff" : "puff_shadow"));
        }
    }
    dew(fx, e, tau - 0.5, 10, 1.8);
  }
}

/** Dew on the crown round the tap, catching the light: the welcome's sparkle in frost tones. */
function dew(fx: Fx, e: CareEffect, tau: number, count: number, life: number): void {
  if (tau < 0) return;
  for (let i = 0; i < count; i++) {
    const u = (tau - hash3(i, 5, 5) * 0.6) / (life * 0.6);
    if (u < 0 || u > 1) continue;
    const x = Math.round(e.x + (hash3(i, 6, 5) - 0.5) * 26);
    const y = Math.round(e.y + (hash3(i, 7, 5) - 0.6) * 16);
    if (!isTree(fx.tree, x, y) && hash3(i, 8, 5) < 0.6) continue;
    fx.pic.sparkle(x, y, sparkleStage(u, false), fx.ink.c("ice_hi"), fx.ink.c("frost"));
  }
}

/** The tool itself, at work, drawn over the world. */
export function drawCareTool(c: Canvas, e: CareEffect, t: number): void {
  const tau = t - e.t0;
  const a = tau < 0.12 ? tau / 0.12 : tau > 1.1 ? Math.max(0, 1 - (tau - 1.1) / 0.3) : 1;
  if (a <= 0) return;
  if (e.tool === "water") {
    const can = canAt(e.x, e.y);
    if (tau < 0.12) drawToolIcon(c, "water", can.x, can.y + 2, a);
    else drawPouringCan(c, can.x, can.y, a);
  } else if (e.tool === "shears") {
    // Snip: the shears close on the crown with a little flash at the blades.
    const snap = tau > 0.18 && tau < 0.32;
    drawToolIcon(c, "shears", e.x - 3 + (snap ? 1 : 0), e.y - 14 - (snap ? 1 : 0), a);
    if (snap)
      for (const [dx, dy] of [
        [0, -3],
        [3, 0],
        [2, -2],
        [-2, -2],
      ] as const)
        c.px(e.x + 11 + dx, e.y - 12 + dy, [255, 255, 255]);
  } else {
    const pump = Math.floor(tau * 5) % 2 === 0 && tau < 0.9;
    drawToolIcon(c, "mist", e.x + 14, e.y - 10 + (pump ? 1 : 0), a);
  }
}
