/**
 * Small life and lore at the clearing's edge: the "Do Not The Farm" sign at the grove's gate, a
 * little tilled patch it guards, and the Mossmote who patrols it.
 */

import { ix, R, type Season } from "../../engine/palette.ts";
import type { Surface } from "../../engine/raster.ts";
import { hash3 } from "../../engine/rng.ts";
import { blitFrame, wandererFrame } from "./actors.ts";
import type { Layout, Point } from "./layout.ts";

// ---------------------------------------------------------------------------------------------
// A tiny carved alphabet, three pixels wide and five tall (M and N wider), for signs in the world.

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  D: ["XX.", "X.X", "X.X", "X.X", "XX."],
  O: [".X.", "X.X", "X.X", "X.X", ".X."],
  N: ["X..X", "XX.X", "X.XX", "X..X", "X..X"],
  T: ["XXX", ".X.", ".X.", ".X.", ".X."],
  H: ["X.X", "X.X", "XXX", "X.X", "X.X"],
  E: ["XXX", "X..", "XX.", "X..", "XXX"],
  F: ["XXX", "X..", "XX.", "X..", "X.."],
  A: [".X.", "X.X", "XXX", "X.X", "X.X"],
  R: ["XX.", "X.X", "XX.", "X.X", "X.X"],
  M: ["X...X", "XX.XX", "X.X.X", "X...X", "X...X"],
};

function carvedWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += ch === " " ? 3 : (GLYPHS[ch]?.[0]?.length ?? 3) + 1;
  return w - 1;
}

/** Letters cut into wood: the groove dark, its lower lip catching the light. */
function carve(s: Surface, text: string, x: number, y: number): void {
  let cx = x;
  for (const ch of text) {
    if (ch === " ") {
      cx += 3;
      continue;
    }
    const g = GLYPHS[ch];
    if (!g) continue;
    g.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) {
        if (row[gx] !== "X") continue;
        s.set(cx + gx, y + gy, ix(R.WOOD, 0));
        const below = g[gy + 1]?.[gx] === "X";
        if (!below) s.set(cx + gx, y + gy + 1, ix(R.WOOD, 5));
      }
    });
    cx += (g[0]?.length ?? 3) + 1;
  }
}

/**
 * The sign at the grove's gate, "DO NOT / THE FARM", on two posts: a weathered plank with moss
 * along its top, and the little tilled patch it guards beside it. `at` is the left post's foot.
 */
export function drawSign(s: Surface, at: Point, season: Season): void {
  const winter = season === "winter";
  const lines = ["DO NOT", "THE FARM"];
  const w = Math.max(...lines.map(carvedWidth)) + 6;
  const h = 15;
  const x0 = at.x;
  const top = at.y - 8 - h;
  // The farm: three short furrows of turned soil with sprouts, beside the sign's right post.
  for (let r = 0; r < 3; r++) {
    const fy = at.y - 4 + r * 3;
    for (let k = 0; k < 11; k++) {
      const fx = x0 + w + 1 + k - r;
      s.set(fx, fy, ix(winter ? R.SNOW : R.SOIL, winter ? 3 : 2));
      s.set(fx, fy + 1, ix(winter ? R.SNOW : R.SOIL, winter ? 4 : 4));
      if (!winter && k % 4 === 1 + (r % 2)) {
        s.set(fx, fy - 1, ix(R.FERN, 5));
        s.set(fx - 1, fy - 2, ix(R.FERN, 6));
        s.set(fx + 1, fy - 2, ix(R.FERN, 4));
      }
    }
  }
  // Two posts, sunk in the ground.
  for (const px of [x0 + 3, x0 + w - 5]) {
    for (let y = top + h - 1; y <= at.y; y++) {
      s.set(px, y, ix(R.WOOD, 3));
      s.set(px + 1, y, ix(R.WOOD, 2));
    }
    s.set(px - 1, at.y, ix(R.MOSS, 4));
    s.set(px + 2, at.y, ix(R.MOSS, 3));
  }
  // The plank: lit along its top, shaded along its bottom, a grain line or two, a split corner.
  for (let y = top; y < top + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const edge = (x === x0 || x === x0 + w - 1) && (y === top || y === top + h - 1);
      if (edge) continue;
      // Weathered: darker than new wood, so the sign sits back in the glade.
      let level = y === top ? 5 : y === top + h - 1 ? 1 : y === top + 1 ? 4 : 3;
      if (y > top + 1 && y < top + h - 1 && hash3(x >> 2, y, 41) < 0.14) level = 2;
      if (x === x0 || x === x0 + w - 1) level = Math.min(level, 2);
      s.set(x, y, ix(R.WOOD, level));
    }
  }
  s.set(x0 + w - 2, top + h - 2, ix(R.WOOD, 1));
  lines.forEach((line, i) => carve(s, line, x0 + Math.floor((w - carvedWidth(line)) / 2), top + 2 + i * 7));
  // Moss, or snow, along the top edge.
  for (let x = x0 + 1; x < x0 + w - 1; x++) {
    const v = hash3(x, top, 17);
    if (winter) {
      s.set(x, top - 1, ix(R.SNOW, v < 0.5 ? 6 : 5));
      if (v < 0.3) s.set(x, top - 2, ix(R.SNOW, 7));
    } else if (v < 0.45) {
      s.set(x, top - 1, ix(R.OLIVE, v < 0.2 ? 6 : 4));
      if (v < 0.12) s.set(x, top - 2, ix(R.OLIVE, 5));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The Mossmote's patrol: out along the sign, a pause to look and blink, back again.

export interface Wanderer {
  x0: number;
  x1: number;
  y: number;
  phase: number;
}

export function placeWanderer(L: Layout, seed: number): Wanderer | null {
  const phase = hash3(seed, 3, 9) * 20;
  if (L.sign) return { x0: L.sign.x - 12, x1: L.sign.x + 26, y: L.sign.y + 4, phase };
  if (L.W < 90) return null;
  return { x0: 10, x1: Math.min(L.squirrel.x - 16, 40), y: L.ground + 6, phase };
}

/** The Mossmote hops along its patrol; it pauses at each end. */
export function drawWanderer(s: Surface, w: Wanderer, t: number): void {
  const span = Math.max(1, w.x1 - w.x0);
  const walk = span / 6;
  const rest = 2.6;
  const cycle = 2 * (walk + rest);
  const u = (((t + w.phase) % cycle) + cycle) % cycle;
  let x: number;
  let facing = 1;
  let moving = false;
  if (u < walk) {
    x = w.x0 + span * (u / walk);
    moving = true;
  } else if (u < walk + rest) x = w.x1;
  else if (u < 2 * walk + rest) {
    x = w.x1 - span * ((u - walk - rest) / walk);
    facing = -1;
    moving = true;
  } else {
    x = w.x0;
    facing = -1;
  }
  const f = wandererFrame((t + w.phase) * 1000, moving);
  blitFrame(s, f, x, w.y, facing < 0);
}
