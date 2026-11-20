/**
 * The Great Sequoia: the guild's tree at the heart of the valley. A cinnamon column far wider than
 * any member's tree, rising out of the top of the frame into a gold-touched canopy, on a foot of
 * great buttress roots. A few huge elbowed limbs reach out below the canopy, carrying their own
 * clouds of foliage, and the guild's lanterns hang beneath them.
 */

import { drawTrunk, type TrunkSpec } from "../../art/bark.ts";
import { type Lobe, renderPad, snowCap } from "../../art/foliage.ts";
import { ix, R, type Season } from "../../engine/palette.ts";
import type { Surface } from "../../engine/raster.ts";
import { hash3, noise1, Rng } from "../../engine/rng.ts";
import { HEART_X, type Layer } from "./world.ts";

export const GREAT_FOOT = 217;
export const GREAT_ID = 100;
export const DOOR_ID = 107;

export interface Hook {
  x: number;
  y: number;
  /** Cord length to the lantern's top. */
  cord: number;
}

export interface Great {
  /** Lanterns already hanging, in front-layer coordinates. */
  lanterns: Hook[];
  /** Free hooks where new lanterns hang, nearest the trunk first. */
  free: Hook[];
  /** The door in the roots: its window glows. */
  door: { x: number; y: number };
  /** Points along the lower canopy for winter's fairy lights. */
  festoon: { x: number; y: number }[];
}

interface Limb {
  side: number;
  y0: number;
  reach: number;
  rise: number;
  /** Thickness at the trunk. */
  w: number;
}

/**
 * Five great limbs below the canopy, each at its own height, reach and angle: they leave the trunk
 * steeply, as a giant sequoia's do, and level off into their clouds of foliage. Never a ladder.
 */
const LIMBS: readonly Limb[] = [
  { side: -1, y0: 140, reach: 62, rise: 54, w: 7 },
  { side: 1, y0: 128, reach: 86, rise: 50, w: 8 },
  { side: -1, y0: 106, reach: 112, rise: 58, w: 7 },
  { side: 1, y0: 92, reach: 104, rise: 40, w: 7 },
  { side: -1, y0: 74, reach: 80, rise: 30, w: 6 },
];

type Pt = { x: number; y: number };

/** A point on a limb's curve: steeply up from the trunk, bending outward, levelling at its tip. */
function limbAt(l: Limb, x0: number, u: number): Pt {
  const p0 = { x: x0, y: l.y0 };
  const p1 = { x: x0 + l.side * l.reach * 0.18, y: l.y0 - l.rise * 0.48 };
  const p2 = { x: x0 + l.side * l.reach * 0.58, y: l.y0 - l.rise * 0.82 };
  const p3 = { x: x0 + l.side * l.reach, y: l.y0 - l.rise };
  const a = (1 - u) ** 3;
  const b = 3 * (1 - u) ** 2 * u;
  const c = 3 * (1 - u) * u * u;
  const d = u ** 3;
  const crook = Math.sin(u * 8 + l.y0) * 1.4 * u;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x + crook, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

export function paintGreat(layer: Layer, season: Season): Great {
  const s = layer.s;
  const X = layer.lx(HEART_X);
  const foot = GREAT_FOOT;
  const rng = new Rng(0x9e47);
  const cx = (y: number): number => X - 2 + 3 * Math.sin((foot - y) / 90) + 2 * Math.sin((foot - y) / 23);
  const hw = (y: number): number => {
    const up = Math.max(0, foot - y);
    // A gentle taper, and a broad concave flare into the ground: the buttressed foot.
    return 27 - 7 * Math.min(1, up / 220) + 31 * Math.exp(-up / 12) + 4 * Math.exp(-up / 40);
  };
  const trunk: TrunkSpec = {
    top: -4,
    foot,
    cx,
    hw,
    light: 0.3,
    rimLeft: true,
    rimRight: false,
    seed: 0x5e0,
    furrow: 5.4,
    moss: 0.8,
  };

  const lanterns: Hook[] = [];
  const free: Hook[] = [];
  const festoon: Pt[] = [];
  const before = s.data.slice();

  // The far side of the canopy first: darker clouds seen through the gaps.
  const backPads: { x: number; y: number; r: number }[] = [
    { x: -110, y: 26, r: 30 },
    { x: -40, y: 14, r: 34 },
    { x: 40, y: 18, r: 34 },
    { x: 112, y: 30, r: 28 },
    { x: -150, y: 48, r: 18 },
    { x: 150, y: 50, r: 20 },
  ];
  for (const b of backPads) {
    const lobes: Lobe[] = [{ x: X + b.x, y: b.y, rx: b.r, ry: b.r * 0.42 }];
    const art = renderPad({ lobes, ramp: R.FOLI, lightX: -1, clump: 3.6, seed: rng.int(0, 1e6), bias: -1.5, gold: 0 });
    s.blit(art.sprite, art.ox, art.oy);
  }
  // The cinnamon carpet the giant sheds round its foot, thinning at its edges.
  for (let y = foot - 4; y <= foot + 9; y++)
    for (let x = X - 120; x <= X + 120; x++) {
      const d = ((x - X) / 120) ** 2 + ((y - foot - 2) / 8) ** 2;
      if (d > 1) continue;
      const v = hash3(x, y, 0x1a);
      if (v > 0.85 - d * 0.6) continue;
      s.set(
        x,
        y,
        season === "winter"
          ? ix(R.SNOW, v < 0.2 ? 4 : 5)
          : v < 0.12
            ? ix(R.BARK, 6)
            : v < 0.4
              ? ix(R.SOIL, 6)
              : ix(R.SOIL, 5),
      );
    }
  drawTrunk(s, trunk);
  // Under the canopy the trunk falls into shade: a level darker, then two. Each step's edge
  // wanders with the bark's plates, so it never shows as a line.
  for (let y = 0; y < 80; y++) {
    const x0 = Math.round(cx(y) - hw(y));
    const x1 = Math.round(cx(y) + hw(y));
    for (let x = x0; x <= x1; x++) {
      const v = s.get(x, y);
      if (v >> 3 !== R.BARK && v >> 3 !== R.OLIVE) continue;
      const edge = noise1(x / 3.5, 0x5a) * 14;
      const drop = y < 40 + edge ? 2 : y < 64 + edge ? 1 : 0;
      if (drop) s.set(x, y, ix(v >> 3, Math.max(0, (v & 7) - drop)));
    }
  }
  buttresses(s, cx, hw, foot);
  for (const l of LIMBS) drawLimb(s, l, cx(l.y0) + l.side * hw(l.y0) * 0.6);

  // The clouds the limbs carry, and the canopy the trunk rises into.
  const pads: ReturnType<typeof renderPad>[] = [];
  for (const l of LIMBS) {
    const x0 = cx(l.y0) + l.side * hw(l.y0) * 0.6;
    const tip = limbAt(l, x0, 1);
    const big = 15 + l.reach * 0.1;
    pads.push(pad(tip.x - l.side * big * 0.1, tip.y - 2, big, 0.5, rng, season));
    // The limb disappears into its foliage: clouds along its outer half, sitting on it.
    for (const u of [0.42, 0.6, 0.8]) {
      const p = limbAt(l, x0, u + rng.range(-0.03, 0.03));
      pads.push(pad(p.x, p.y - 2 - u * 3, big * (0.42 + u * 0.4), 0.55, rng, season));
    }
    // Lanterns hang from the limb's underside between its clouds; spare hooks wait for the next raid.
    [0.3, 0.45, 0.6, 0.74, 0.88].forEach((u, k) => {
      const p = limbAt(l, x0, u);
      const hook = {
        x: Math.round(p.x),
        y: Math.round(p.y + l.w * (1 - u * 0.72) * 0.45),
        cord: 3 + Math.round(hash3(k, l.y0, 3) * 8),
      };
      if ((k + (l.side > 0 ? 0 : 1)) % 2 === 0) lanterns.push(hook);
      else free.push(hook);
    });
  }
  // The canopy: a broad cumulus of clouds across the top of the frame, its belly lit gold.
  const crown: { x: number; y: number; r: number; flat: number }[] = [
    { x: -128, y: 40, r: 24, flat: 0.46 },
    { x: -84, y: 30, r: 30, flat: 0.48 },
    { x: -30, y: 36, r: 28, flat: 0.5 },
    { x: 26, y: 28, r: 32, flat: 0.48 },
    { x: 80, y: 38, r: 28, flat: 0.46 },
    { x: 132, y: 44, r: 22, flat: 0.48 },
    { x: -58, y: 8, r: 34, flat: 0.5 },
    { x: 54, y: 4, r: 36, flat: 0.5 },
    { x: -4, y: -6, r: 34, flat: 0.5 },
  ];
  for (const c of crown) pads.push(pad(X + c.x + rng.range(-4, 4), c.y + rng.range(-2, 2), c.r, c.flat, rng, season));
  // Bottom-up, so upper clouds' bellies lie over the tops of those below.
  for (const p of pads.toSorted((a, b) => b.oy + b.sprite.h - (a.oy + a.sprite.h))) s.blit(p.sprite, p.ox, p.oy);
  // Lanterns also hang along the canopy's lower edge.
  crown.slice(0, 6).forEach((c, i) => {
    const hook = {
      x: Math.round(X + c.x + (i % 2 ? 6 : -5)),
      y: Math.round(c.y + c.r * c.flat * 0.75),
      cord: 4 + ((i * 5) % 7),
    };
    if (i % 2 === 0) lanterns.push(hook);
    else free.push(hook);
  });
  // Winter's fairy lights: one long swag along the canopy's lower edge, pad to pad.
  for (const c of crown.slice(0, 6)) festoon.push({ x: Math.round(X + c.x), y: Math.round(c.y + c.r * c.flat * 0.7) });

  if (layer.owner) for (let i = 0; i < s.data.length; i++) if (s.data[i] !== before[i]) layer.owner[i] = GREAT_ID;
  const door = rootDoor(s, layer, cx(foot) + 16, foot + 1);
  free.sort((a, b) => Math.abs(a.x - X) - Math.abs(b.x - X) || b.y - a.y);
  festoon.sort((a, b) => a.x - b.x);
  return { lanterns, free, door, festoon };
}

function pad(x: number, y: number, size: number, flat: number, rng: Rng, season: Season): ReturnType<typeof renderPad> {
  const rx = size * rng.range(0.9, 1.1);
  const ry = rx * flat * rng.range(0.9, 1.1);
  const lobes: Lobe[] = [{ x, y, rx, ry }];
  const bumps = rng.int(1, 3);
  for (let b = 0; b < bumps; b++) {
    const side = b === 0 ? (rng.chance(0.5) ? -1 : 1) : b === 1 ? 1 : -1;
    lobes.push({
      x: x + side * rx * rng.range(0.25, 0.55),
      y: y - ry * rng.range(0.35, 0.7),
      rx: rx * rng.range(0.4, 0.58),
      ry: ry * rng.range(0.7, 0.9),
    });
  }
  // The guild's tree wears the guild's gold: more of its clumps catch the light.
  const art = renderPad({
    lobes,
    ramp: rng.chance(0.28) ? R.CANOPY : R.FOLI,
    lightX: -1,
    clump: 3.5,
    seed: rng.int(0, 1e6),
    bias: 0.3,
    gold: 0.6,
    goldIndex: ix(R.OLIVE, 7),
  });
  return season === "winter" ? { sprite: snowCap(art.sprite, rng.int(0, 1e6)), ox: art.ox, oy: art.oy - 1 } : art;
}

/** A great limb: thick at the trunk, tapering, lit on its upper left, ridged with bark along its length. */
function drawLimb(s: Surface, l: Limb, x0: number): void {
  const steps = Math.ceil(l.reach * 2.4);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const p = limbAt(l, x0, u);
    const q = limbAt(l, x0, Math.min(1, u + 0.01));
    // The limb's normal, pointing up and to the left (toward the light) where it can.
    let nx = -(q.y - p.y);
    let ny = q.x - p.x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    if (nx * -0.6 + ny * -0.8 < 0) {
      nx = -nx;
      ny = -ny;
    }
    const r = Math.max(1.3, l.w * Math.pow(1 - u, 0.85) * 0.9 + 1.2) / 2;
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dy * dy > r * r + 0.3) continue;
        const x = Math.round(p.x + dx);
        const y = Math.round(p.y + dy);
        // Across the limb: +1 on its lit edge, -1 on its shaded one.
        const across = (dx * nx + dy * ny) / r;
        const groove = Math.abs(across) < 0.6 && hash3(Math.round(u * 40), Math.round(across * 3), l.y0) < 0.3;
        const level = across > 0.62 ? 6 : across > 0.2 ? 5 : across < -0.55 ? 2 : groove ? 3 : 4;
        const moss = across > 0.5 && noise1(u * 14, l.y0) > 0.55;
        s.set(x, y, moss ? ix(R.OLIVE, level > 5 ? 6 : 5) : ix(R.BARK, level));
      }
    }
  }
}

/**
 * Roots: the flare carries the trunk into the ground; beyond it, low rounded ridges creep out over
 * the soil, lit along their backs, mossed in patches. Those on the shaded right sit in shadow.
 */
function buttresses(s: Surface, cx: (y: number) => number, hw: (y: number) => number, foot: number): void {
  const base = hw(foot);
  const c = cx(foot);
  const roots = [
    { side: -1, len: 26, h: 7 },
    { side: -1, len: 12, h: 4, at: -0.25 },
    { side: 1, len: 20, h: 6 },
    { side: 1, len: 9, h: 3, at: -0.3 },
  ];
  for (const r of roots) {
    const x0 = c + r.side * base * (1 + (r.at ?? 0)) - r.side * 4;
    const lit = r.side < 0;
    for (let k = 0; k <= r.len; k++) {
      const u = k / r.len;
      const x = Math.round(x0 + r.side * k);
      const hgt = r.h * Math.pow(1 - u, 0.8) * (0.85 + 0.15 * Math.sin(u * 7));
      const top = Math.round(foot - hgt);
      for (let y = top; y <= foot + 1; y++) {
        const d = y - top;
        let level = d === 0 ? (lit ? 6 : 4) : d === 1 ? (lit ? 5 : 3) : y >= foot ? 1 : lit ? 3 : 2;
        if (d > 1 && hash3(x, y, 0x77) < 0.18) level -= 1;
        s.set(x, y, ix(R.BARK, Math.max(0, level)));
      }
      if (u > 0.1 && u < 0.85 && noise1(x / 3, 17 + r.len) > 0.55)
        s.set(x, top - 1, ix(R.OLIVE, hash3(x, top, 6) < 0.35 ? 6 : 4));
    }
  }
}

/** A little round door between the roots, with a lit window: the guild's root office. */
function rootDoor(s: Surface, layer: Layer, x: number, foot: number): Pt {
  const dx = Math.round(x);
  const w = 9;
  const h = 13;
  const top = foot - h;
  for (let y = top - 2; y <= foot; y++) {
    for (let k = -2; k < w + 2; k++) {
      const u = (k - (w - 1) / 2) / ((w + 3) / 2);
      const v = (y - (top - 2)) / (h + 2);
      if (u * u + Math.pow(Math.max(0, 0.4 - v) / 0.4, 2) > 1) continue;
      s.set(dx + k, y, ix(R.INK, 1));
      if (layer.owner) layer.owner[y * layer.w + dx + k] = DOOR_ID;
    }
  }
  for (let y = top; y <= foot; y++) {
    for (let k = 0; k < w; k++) {
      const u = (k - (w - 1) / 2) / (w / 2);
      const v = (y - top) / h;
      if (u * u + Math.pow(Math.max(0, 0.36 - v) / 0.36, 2) > 1) continue;
      const plank = k % 3 === 0 ? 3 : k % 3 === 1 ? 5 : 4;
      s.set(dx + k, y, ix(R.WOOD, y === top ? 6 : plank));
    }
  }
  // A brass knob, hinges, and a round window that glows.
  s.set(dx + 6, foot - 5, ix(R.GLOW, 4));
  s.set(dx + 1, top + 4, ix(R.METAL, 4));
  s.set(dx + 1, foot - 3, ix(R.METAL, 4));
  const wy = top + 4;
  for (const [a, b] of [
    [3, 0],
    [4, 0],
    [5, 0],
    [3, 1],
    [4, 1],
    [5, 1],
  ] as const)
    s.set(dx + a, wy + b, ix(R.GLOW, b === 0 ? 5 : 4));
  s.set(dx + 4, wy, ix(R.WOOD, 2));
  s.set(dx + 4, wy + 1, ix(R.WOOD, 2));
  s.rect(dx + 1, foot + 1, w - 2, 1, ix(R.STONE, 4));
  return { x: dx + 4, y: wy };
}
