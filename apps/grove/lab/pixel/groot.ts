/**
 * Raids water your tree. Every guild raid you finish (a "groot", in the guild's own word) rains on
 * your tree: a small cloud gathers over the crown alone, a gentle rain falls on it, and the crown
 * drinks once for each groot, a breath of growth from the foot up, each one filling a segment of
 * Bloom. A popup in the mod's style says how many.
 */

import { type Canvas, hex, mix, type PopupSpec, type Rgb, UI } from "./hud.ts";
import type { Layout } from "./layout.ts";
import { ix, R } from "./palette.ts";
import { bayer, type Light, type Surface } from "./raster.ts";
import { hash3 } from "./rng.ts";
import type { Tree } from "./tree.ts";

export interface GrootEvent {
  t0: number;
  count: number;
  /** Bloom before the rain; each groot adds a segment. */
  bloomFrom: number;
}

const GATHER = 1.0;
const FIRST_DRINK = 2.0;
const DRINK_GAP = 1.1;

function times(ev: GrootEvent): { drinks: number[]; rainEnd: number; end: number } {
  const drinks = Array.from({ length: ev.count }, (_, i) => ev.t0 + FIRST_DRINK + i * DRINK_GAP);
  const rainEnd = (drinks[drinks.length - 1] ?? ev.t0 + FIRST_DRINK) + 0.9;
  return { drinks, rainEnd, end: rainEnd + 3.2 };
}

/** What the rain has done by `t`: Bloom, a flash as each segment fills, and when the crown drinks. */
export function grootDrink(ev: GrootEvent, t: number): { bloom: number; flash: number; drinkAt: number[] } {
  const { drinks } = times(ev);
  const done = drinks.filter((d) => t >= d);
  const last = done[done.length - 1];
  return {
    bloom: Math.min(10, ev.bloomFrom + done.length),
    flash: last === undefined ? 0 : Math.max(0, 1 - (t - last) / 0.5),
    drinkAt: drinks,
  };
}

/** The cloud's place over the crown, and how solid it is at `t` (0 to 1). */
function cloudAt(ev: GrootEvent, tree: Tree, t: number): { cx: number; cy: number; hw: number; d: number } {
  const { rainEnd } = times(ev);
  const crown = tree.crown;
  const cw = crown.x1 - crown.x0;
  const hw = Math.max(13, Math.min(46, cw * 0.42 + 7));
  const cx = (crown.x0 + crown.x1) / 2 + Math.sin((t - ev.t0) * 0.7) * 0.8;
  const cy = Math.max(8, crown.y0 - 8 - hw * 0.1);
  const tau = t - ev.t0;
  const d = tau < 0 ? 0 : tau < GATHER ? tau / GATHER : t < rainEnd ? 1 : Math.max(0, 1 - (t - rainEnd) / 1.4);
  return { cx, cy, hw, d };
}

/** Where rain landing in column `x` first meets the tree, from its pads' own pixels. */
const landings = new WeakMap<Tree, Map<number, number>>();
function landing(tree: Tree, x: number, ground: number): number {
  let cache = landings.get(tree);
  if (!cache) {
    cache = new Map();
    landings.set(tree, cache);
  }
  const hit = cache.get(x);
  if (hit !== undefined) return hit;
  let y = ground;
  if (tree.seedling) {
    const f = tree.seedling[0];
    if (f && Math.abs(x - tree.foot.x) <= f.w / 2) y = tree.top + 1;
  }
  for (const p of tree.pads) {
    const a = p.art;
    const px = x - a.ox;
    if (px < 0 || px >= a.sprite.w) continue;
    for (let py = 0; py < a.sprite.h; py++) {
      if (a.sprite.data[py * a.sprite.w + px]) {
        y = Math.min(y, a.oy + py);
        break;
      }
    }
  }
  cache.set(x, y);
  return y;
}

export function drawGrootWorld(s: Surface, light: Light, tree: Tree, ev: GrootEvent, t: number, L: Layout): void {
  const { rainEnd, end } = times(ev);
  if (t > end) return;
  const cl = cloudAt(ev, tree, t);
  const tau = t - ev.t0;

  // The rain: short streaks from the cloud's belly, each landing on the crown with a splash.
  const raining = tau > GATHER * 0.8 && t < rainEnd + 0.5;
  if (raining) {
    const fade = t > rainEnd ? 1 - (t - rainEnd) / 0.5 : Math.min(1, (tau - GATHER * 0.8) / 0.4);
    const drops = Math.round(cl.hw * 1.1);
    const top = cl.cy + 4;
    for (let i = 0; i < drops; i++) {
      if (hash3(i, 9, 2) > fade) continue;
      const x = Math.round(cl.cx - cl.hw * 0.85 + (i + hash3(i, 1, 2) * 0.8) * ((cl.hw * 1.7) / drops));
      const land = landing(tree, x, L.ground + 2);
      const fall = Math.max(6, land - top);
      const period = 0.25 + fall / 180;
      const u = (((tau / period + hash3(i, 2, 2)) % 1) + 1) % 1;
      const y = top + u * fall;
      if (u < 0.9) {
        s.set(x, y, ix(R.WATER, 6));
        s.set(x, y - 1, ix(R.WATER, 4));
        if (hash3(i, 3, 2) < 0.4) s.set(x, y - 2, ix(R.WATER, 3));
      } else {
        // A splash: a bead thrown each way off the needles.
        const k = (u - 0.9) / 0.1;
        s.set(x - 1 - Math.round(k), land - 1 - Math.round(k), ix(R.WATER, 7));
        s.set(x + 1 + Math.round(k), land - 1, ix(R.WATER, 6));
      }
    }
    // Wet earth darkening at the foot, with a glint of a puddle.
    for (let dx = -10; dx <= 10; dx++) {
      if (hash3(dx, 4, 7) < 0.55) continue;
      s.set(tree.foot.x + dx, L.ground + 3 + (dx & 1), ix(R.WATER, hash3(dx, 5, 7) < 0.3 ? 4 : 2));
    }
  }

  // Each drink: sparkles rise from the crown's top edge as it breathes.
  const { drinkAt } = grootDrink(ev, t);
  for (const at of drinkAt) {
    const u = (t - at) / 0.9;
    if (u < 0 || u > 1) continue;
    for (let i = 0; i < 9; i++) {
      const x = Math.round(tree.crown.x0 + (tree.crown.x1 - tree.crown.x0) * hash3(i, Math.round(at * 10), 4));
      const y = Math.round(landing(tree, x, L.ground) - 2 - u * 10 * (0.6 + hash3(i, 6, 4)));
      if (u > 0.7 && (i + Math.floor(t * 10)) % 2) continue;
      s.set(x, y, ix(u < 0.4 ? R.STAR : R.WATER, 7));
    }
  }
  // After the rain, dew on the crown catches the light here and there.
  if (t > rainEnd - 0.4) {
    for (let i = 0; i < 12; i++) {
      const b = 0.5 + 0.5 * Math.sin(t * 2.6 + i * 1.9);
      if (b < 0.75 || t > end - 0.3) continue;
      const x = Math.round(tree.crown.x0 + (tree.crown.x1 - tree.crown.x0) * hash3(i, 7, 5));
      const y = landing(tree, x, L.ground) + 1 + Math.round(hash3(i, 8, 5) * 3);
      s.set(x, y, ix(R.STAR, 7));
      if (b > 0.92) light.pool(x, y, 3, 1.2, 1);
    }
  }

  drawCloud(s, cl, t);
}

/** A small soft cloud, lumpy on top, flat underneath, lit on its crown; it gathers and thins by dithering. */
function drawCloud(s: Surface, cl: { cx: number; cy: number; hw: number; d: number }, t: number): void {
  if (cl.d <= 0) return;
  const lumps = [
    { x: -0.55, y: 0.5, r: 0.42 },
    { x: -0.15, y: -0.1, r: 0.58 },
    { x: 0.35, y: 0.15, r: 0.5 },
    { x: 0.7, y: 0.55, r: 0.34 },
  ];
  const ry = cl.hw * 0.42;
  for (let y = Math.floor(cl.cy - ry * 1.4); y <= cl.cy + ry * 0.75; y++) {
    for (let x = Math.floor(cl.cx - cl.hw - 2); x <= cl.cx + cl.hw + 2; x++) {
      let inside = -1;
      let top = 0;
      for (const l of lumps) {
        const dx = (x - (cl.cx + l.x * cl.hw)) / (l.r * cl.hw);
        const dy = (y - (cl.cy + l.y * ry - ry * 0.3)) / (l.r * cl.hw * 0.8);
        const d = dx * dx + dy * dy;
        if (d <= 1) {
          inside = Math.max(inside, 1 - d);
          top = Math.min(top, dy);
        }
      }
      if (inside < 0) continue;
      // Flat belly: nothing below the base line.
      if (y > cl.cy + ry * 0.6) continue;
      if (bayer(x, y) > cl.d * (0.6 + inside * 1.4)) continue;
      const belly = y > cl.cy + ry * 0.3;
      const level = belly ? 3 : top < -0.55 ? 6 : top < -0.2 ? 5 : 4;
      s.set(x, y, ix(R.SMOKE, level + (Math.floor(t * 2 + x * 0.3) % 7 === 0 && level === 5 ? 1 : 0)));
    }
  }
}

export function grootPopupOpen(ev: GrootEvent, t: number): number {
  const { end } = times(ev);
  const tau = t - ev.t0;
  if (tau < 1.3 || t > end) return 0;
  if (t > end - 0.3) return Math.max(0.01, (end - t) / 0.3);
  return Math.min(1, (tau - 1.3) / 0.15);
}

const TEAL = hex("#4eaaa2");

export function grootPopup(ev: GrootEvent): PopupSpec {
  const often = ev.count === 1 ? "once" : `${ev.count} times`;
  return {
    accent: TEAL,
    label: "Guild raids",
    title: `You grooted ${often} today.`,
    lines: [{ text: "The tree drank deeply.", colour: mix(TEAL, UI.text, 0.45) }],
    medal: (c, x, y) => drawDropMedal(c, x, y, ev.count),
  };
}

const DROP = [
  "...k...",
  "..kWk..",
  "..kwk..",
  ".kWwwk.",
  ".kWwwk.",
  "kWwwwvk",
  "kwwwwvk",
  "kwwwvvk",
  ".kwvvk.",
  "..kkk..",
];

/** A teal octagon with a raindrop in it, and a pip for each groot under the drop. */
function drawDropMedal(c: Canvas, x: number, y: number, count: number): void {
  const size = 23;
  const r = (size - 1) / 2;
  for (let yy = 0; yy < size; yy++) {
    for (let xx = 0; xx < size; xx++) {
      const dx = xx - r;
      const dy = yy - r;
      const d = Math.max(Math.abs(dx), Math.abs(dy), (Math.abs(dx) + Math.abs(dy)) / Math.SQRT2);
      if (d > r + 0.4) continue;
      const lit = -(dx + dy) / (Math.abs(dx) + Math.abs(dy) + 0.01);
      const col: Rgb =
        d > r - 0.6
          ? hex("#14302c")
          : d > r - 3.6
            ? lit > 0.35
              ? hex("#8ad4c8")
              : lit > -0.35
                ? TEAL
                : hex("#2e6e66")
            : d > r - 4.6
              ? hex("#14302c")
              : [22, 28, 32];
      c.px(x + xx, y + yy, col);
    }
  }
  c.icon(DROP, { k: hex("#0e1e2a"), W: hex("#e8f8ff"), w: hex("#7fbde6"), v: hex("#3d6ea6") }, x + 8, y + 4);
  const pips = Math.min(5, count);
  for (let i = 0; i < pips; i++) c.px(x + 12 - pips + i * 2, y + 16, hex("#a9dcf4"));
}
