/**
 * The clearing itself: mossy ground and a trodden patch round the fire, the undergrowth along the
 * forest's edge, the two framing redwoods and their canopy, ferns, mushrooms and mossy stones,
 * the campfire's ring and logs, and the lantern post.
 */

import { drawTrunk } from "../../art/bark.ts";
import { type Lobe, renderPad, snowCap } from "../../art/foliage.ts";
import { ix, R, type Season, type Time } from "../../engine/palette.ts";
import { fromRows, type Sprite, sprite, type Surface, Surface as SurfaceCtor } from "../../engine/raster.ts";
import { hash3, noise1, Rng } from "../../engine/rng.ts";
import type { Layout, Point } from "./layout.ts";

export interface Placed {
  frames: Sprite[];
  x: number;
  y: number;
  /** Sway period and phase, for things that move. */
  period: number;
  phase: number;
}

export interface Glade {
  /** Ferns: a few sway frames each. Drawn every frame. */
  ferns: Placed[];
  /** Foreground ferns that stand in front of everything. */
  frontFerns: Placed[];
  /** The canopy along the top: sway frames per spray. */
  canopy: Placed[];
  /** Front parts drawn over the critters: the left framing trunk, the near stones and mushrooms. Pre-rendered, index 0 transparent. */
  front: Surface;
  /** Where the fairy lights hang, in winter. */
  festoon: Point[];
}

const winterOf = (season: Season): boolean => season === "winter";

export function buildGlade(s: Surface, L: Layout, time: Time, season: Season, seed: number): Glade {
  const rng = new Rng(seed ^ 0x6a1de);
  const winter = winterOf(season);
  drawGround(s, L, winter, rng.fork("ground"));
  drawUndergrowth(s, L, winter, rng.fork("shrubs"));
  const frames = { left: frameSpec(L, "left", rng.fork("left")), right: frameSpec(L, "right", rng.fork("right")) };
  const back = frameTrunk(frames.right, rng.int(0, 1e6));
  back(s);
  drawPath(s, L, winter);
  drawClearing(s, L, winter);
  drawFloorShrubs(s, L, winter, rng.fork("floor"));
  const ferns = placeFerns(L, winter, rng.fork("ferns"), false);
  const frontFerns = placeFerns(L, winter, rng.fork("front-ferns"), true);
  const canopy = placeCanopy(L, winter, rng.fork("canopy"), frames);
  const front = frameTrunk(frames.left, rng.int(0, 1e6));
  const stones = placeStones(L, winter, rng.fork("stones"));
  const shrooms = placeMushrooms(L, rng.fork("shrooms"));
  void time;
  // Fairy lights hang from cluster to cluster along the canopy's lower fringe.
  const festoon = canopy
    .filter((c) => c.period < 99)
    .map((c) => {
      const f = c.frames[0];
      return f ? { x: c.x + Math.round(f.w / 2), y: c.y + f.h - 3 } : { x: c.x, y: c.y };
    })
    .toSorted((a, b) => a.x - b.x);
  const frontLayer = new SurfaceCtor(L.W, L.H);
  front(frontLayer);
  for (const st of stones) frontLayer.blit(st.sprite, st.x, st.y);
  for (const m of shrooms) frontLayer.blit(m.sprite, m.x, m.y);
  return { ferns, frontFerns, canopy, festoon, front: frontLayer };
}

// ---------------------------------------------------------------------------------------------

function drawGround(s: Surface, L: Layout, winter: boolean, rng: Rng): void {
  const sd = rng.int(0, 9999);
  const top = L.gladeBack - 3;
  for (let y = top; y < L.H; y++) {
    const t = (y - L.gladeBack) / (L.H - L.gladeBack);
    // Lit in the middle distance, shaded under the forest's edge and toward the viewer.
    const base = t < 0.1 ? 1.4 : t < 0.45 ? 1.8 + (t - 0.1) * 3.4 : 3 - (t - 0.45) * 4.6;
    for (let x = 0; x < L.W; x++) {
      const runs = noise1(x / 9 + Math.floor(y / 2) * 3.7, sd) - 0.5;
      const fine = noise1(x / 3 + y * 5.3, sd + 3) - 0.5;
      const v = base + runs * 1.6 + fine * 0.6;
      if (winter) s.set(x, y, ix(R.SNOW, Math.max(1, Math.min(6, v + 1.6))));
      else s.set(x, y, ix(R.MOSS, Math.max(0, Math.min(6, v))));
    }
  }
  if (winter) return;
  // Grass tufts on a loose grid: small lit fans, thicker toward the viewer.
  for (let gy = L.gladeBack + 2; gy < L.H; gy += 4) {
    const t = (gy - L.gladeBack) / (L.H - L.gladeBack);
    const step = 7 - t * 2;
    for (let gx = (gy * 7) % 5; gx < L.W; gx += step) {
      if (hash3(gx | 0, gy, sd) < 0.35) continue;
      const x = Math.round(gx + (hash3(gx | 0, gy, sd + 1) - 0.5) * 4);
      const y = gy + Math.round((hash3(gx | 0, gy, sd + 2) - 0.5) * 2);
      const lit = t < 0.6 ? 5 : 4;
      s.set(x, y, ix(R.MOSS, lit));
      s.set(x - 1, y + 1, ix(R.MOSS, lit - 1));
      s.set(x + 1, y + 1, ix(R.MOSS, lit - 1));
      if (hash3(x, y, 5) < 0.4) s.set(x, y - 1, ix(R.MOSS, lit + 1));
    }
  }
}

/** Trodden earth round the fire, worn toward the tree, its edge broken by moss. */
function drawClearing(s: Surface, L: Layout, winter: boolean): void {
  const cx = L.fire.x - 4;
  const cy = L.fire.y - 1;
  const rx = 24;
  const ry = 8;
  for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) {
    for (let x = Math.floor(L.treeX - 4); x <= cx + rx + 4; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      let d = dx * dx + dy * dy;
      // Worn toward the tree's foot.
      const tx = (x - (L.treeX + cx) / 2) / (Math.abs(cx - L.treeX) / 2 + 6);
      const ty = (y - (cy - 3)) / 4;
      d = Math.min(d, tx * tx + ty * ty + 0.25);
      const edge = (noise1(x / 3 + y * 7.7, 21) - 0.5) * 0.5;
      if (d > 1 + edge) continue;
      if (winter) {
        s.set(x, y, ix(R.SNOW, d > 0.7 ? 3 : 4));
        continue;
      }
      const level = d > 0.8 ? 3 : d > 0.45 ? 4 : 5;
      s.set(x, y, ix(R.SOIL, level - (hash3(x, y, 9) < 0.15 ? 1 : 0)));
    }
  }
}

/** A worn path in from the bottom edge to the fire, its edges broken by grass. */
function drawPath(s: Surface, L: Layout, winter: boolean): void {
  const x0 = L.treeX - 6;
  const x1 = L.fire.x - 8;
  for (let y = L.fire.y; y < L.H; y++) {
    const u = (y - L.fire.y) / (L.H - L.fire.y);
    const cx = x1 + (x0 - x1) * u + Math.sin(u * 3) * 3;
    const hw = 3 + u * 6;
    for (let x = Math.floor(cx - hw - 1); x <= cx + hw + 1; x++) {
      const d = Math.abs(x - cx) / hw;
      const edge = (noise1(x / 2 + y * 3.3, 41) - 0.5) * 0.5;
      if (d > 1 + edge) continue;
      if (winter) s.set(x, y, ix(R.SNOW, d > 0.6 ? 3 : 4));
      else s.set(x, y, ix(R.SOIL, d > 0.7 ? 3 : hash3(x, y, 2) < 0.2 ? 5 : 4));
    }
  }
}

/** Low shrubs over the glade floor, toward the sides, never on the clearing or the companions. */
function drawFloorShrubs(s: Surface, L: Layout, winter: boolean, rng: Rng): void {
  const keepOut = [
    { x: L.lantern.x + 3, y: L.lantern.y - 6, r: 9 },
    { x: L.squirrel.x, y: L.squirrel.y - 6, r: 12 },
    { x: L.crab.x, y: L.crab.y - 4, r: 12 },
    { x: L.fire.x, y: L.fire.y - 4, r: 22 },
    { x: L.treeX, y: L.ground, r: L.H < 170 ? 40 : 26 },
  ];
  // A few clusters each side, each two to four shrubs of different sizes leaning together.
  const spots: { x: number; y: number; w: number }[] = [];
  // Close in, every shrub is big on screen: keep the floor calm round a young tree.
  const clusters = L.narrow || L.H < 170 ? 1 : 3;
  for (const side of [-1, 1] as const) {
    for (let k = 0; k < clusters; k++) {
      const u = (k + rng.range(0.15, 0.85)) / clusters;
      const cx = side < 0 ? L.W * (0.07 + u * 0.24) : L.W * (0.69 + u * 0.26);
      const cy = L.gladeBack + 14 + rng.next() * (L.H - L.gladeBack - 18);
      const n = rng.int(2, 4);
      for (let j = 0; j < n; j++) {
        const w = (j === 0 ? 16 : 8) + rng.next() * 8 * (0.6 + (cy - L.gladeBack) / (L.H - L.gladeBack));
        const x = cx + (j === 0 ? 0 : rng.range(-1, 1) * 12);
        const y = cy + (j === 0 ? 0 : rng.range(-2, 5));
        if (keepOut.some((ko) => Math.hypot(ko.x - x, (ko.y - y) * 1.6) < ko.r + w * 0.5)) continue;
        spots.push({ x, y, w });
      }
    }
  }
  for (const sp of spots.toSorted((a, b) => a.y - b.y)) {
    const h = sp.w * 0.45;
    const lobes: Lobe[] = [
      { x: 0, y: 0, rx: sp.w / 2, ry: h / 2 },
      { x: rng.range(-0.2, 0.2) * sp.w, y: -h * 0.35, rx: sp.w * 0.32, ry: h * 0.42 },
    ];
    let art = renderPad({
      lobes,
      ramp: R.OLIVE,
      lightX: sp.x < L.treeX ? 1 : -1,
      clump: 2.5,
      seed: rng.int(0, 1e6),
      bias: -0.4,
      gold: 0.3,
    });
    if (winter) art = { ...art, sprite: snowCap(art.sprite, sp.x | 0), oy: art.oy - 1 };
    s.blit(art.sprite, Math.round(sp.x) + art.ox, Math.round(sp.y) + art.oy);
  }
}

function drawUndergrowth(s: Surface, L: Layout, winter: boolean, rng: Rng): void {
  let x = rng.range(-6, 0);
  let i = 0;
  while (x < L.W + 8) {
    const side = Math.min(1, Math.abs(x - L.treeX) / (L.W / 2));
    const w = 6 + side * 9 + rng.range(-2, 4) + (rng.chance(0.25) ? 7 : 0);
    const h = 3 + side * 6 + rng.range(-1.5, 4);
    const lightX = x < L.treeX ? 1 : -1;
    const lobes: Lobe[] = [
      { x: 0, y: 0, rx: w / 2, ry: h / 2 },
      { x: rng.range(-w * 0.25, w * 0.25), y: -h * 0.35, rx: w * 0.3, ry: h * 0.4 },
    ];
    let art = renderPad({
      lobes,
      ramp: R.OLIVE,
      lightX,
      clump: 2.3,
      seed: rng.int(0, 1e6),
      bias: -0.6 + side * 0.3,
      gold: 0.25,
    });
    let oy = art.oy;
    if (winter) {
      art = { ...art, sprite: snowCap(art.sprite, i) };
      oy -= 1;
    }
    s.blit(art.sprite, Math.round(x) + art.ox, L.gladeBack + 1 + oy);
    // Now and then a gap, where the forest floor runs back into the trees.
    x += w * (rng.chance(0.12) ? rng.range(1.1, 1.6) : rng.range(0.55, 0.8));
    i++;
  }
}

// ---------------------------------------------------------------------------------------------
// The framing redwoods: the left one close in the foreground, the right one a step back. Both
// lean out a little toward the top, as trunks do when you look up at them, and flare into roots.

interface FrameSpec {
  side: "left" | "right";
  cx: (y: number) => number;
  hw: (y: number) => number;
  foot: number;
}

function frameSpec(L: Layout, side: "left" | "right", rng: Rng): FrameSpec {
  const left = side === "left";
  const hw = left ? (L.narrow ? 18 : 34) : L.narrow ? 14 : 26;
  const show = left ? (L.narrow ? 8 : Math.round(L.W * 0.1)) : L.narrow ? 6 : Math.round(L.W * 0.07);
  const foot = left ? L.H + 2 : L.gladeBack + 20;
  const baseX = left ? show - hw : L.W - show + hw;
  const out = (left ? -1 : 1) * rng.range(5, 8);
  return {
    side,
    foot,
    cx: (y) => baseX + out * Math.pow(1 - y / foot, 1.6),
    hw: (y) => hw + 12 * Math.exp(-(foot - y) / 14) + 3 * Math.exp(-(foot - y) / 40),
  };
}

function frameTrunk(f: FrameSpec, seed: number): (s: Surface) => void {
  const left = f.side === "left";
  return (s) => {
    drawTrunk(s, {
      top: 0,
      foot: f.foot,
      cx: f.cx,
      hw: f.hw,
      light: left ? 0.55 : -0.55,
      rimLeft: !left,
      rimRight: left,
      seed,
      furrow: 6.5,
      moss: 0.7,
      bias: left ? -0.1 : 0.1,
    });
    // Roots spreading into the ground on the open side.
    const dir = left ? 1 : -1;
    const edge = f.cx(f.foot) + dir * f.hw(f.foot);
    for (let r = 0; r < 2; r++) {
      const len = 10 + r * 6;
      const hgt = 5 - r;
      const y0 = f.foot - 1 - r * 4;
      for (let k = 0; k < len; k++) {
        const u = k / len;
        const x = Math.round(edge - dir * 6 + dir * k);
        const top = Math.round(y0 - hgt * Math.pow(1 - u, 1.5));
        for (let y = top; y <= y0 + 1; y++) s.set(x, y, ix(R.BARK, y === top ? 6 : y === top + 1 ? 4 : 2));
        if (hash3(x, top, seed) < 0.5) s.set(x, top - 1, ix(R.OLIVE, 4));
      }
    }
  };
}

/**
 * The canopy: from each framing trunk a branch reaches in along the top and sags under its own
 * weight; leafy clusters hang from it above and below, spaced so sky shows between, the last one
 * hanging lowest at the tip. Lit on the side that faces the opening.
 */
function placeCanopy(L: Layout, winter: boolean, rng: Rng, frames: Record<"left" | "right", FrameSpec>): Placed[] {
  const out: Placed[] = [];
  for (const sideName of ["left", "right"] as const) {
    const side = sideName === "left" ? -1 : 1;
    const f = frames[sideName];
    const reach = L.narrow ? L.W * 0.36 : Math.min(L.W * (sideName === "left" ? 0.3 : 0.26), 118);
    const y0 = 5 + rng.range(-1, 2);
    const x0 = f.cx(y0) - side * f.hw(y0) * 0.55;
    const sag = L.narrow ? 12 : rng.range(16, 22);
    const branchY = (u: number): number => y0 + Math.sin(u * Math.PI * 0.55) * sag * 0.5 + u * u * sag * 0.6;
    const bw = Math.ceil(reach) + 12;
    const branch = sprite(bw, 40);
    const bx = sideName === "left" ? Math.floor(x0) : Math.floor(x0 - reach - 6);
    const by = Math.floor(y0 - 6);
    for (let i = 0; i <= reach; i++) {
      const u = i / reach;
      const x = x0 - side * i;
      const y = branchY(u);
      const r = Math.max(0.6, 2.6 * (1 - u * 0.75));
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
        const px = Math.round(x) - bx;
        const py = Math.round(y + dy) - by;
        if (px < 0 || py < 0 || px >= branch.w || py >= branch.h || Math.abs(dy) > r) continue;
        branch.data[py * branch.w + px] = ix(R.BARK, dy < 0 ? 5 : dy > 0 ? 1 : 3);
      }
      // A twig now and then, angling down.
      if (i > 8 && i % 23 === 7) {
        for (let k = 1; k < 6; k++) {
          const px = Math.round(x - side * k * 0.6) - bx;
          const py = Math.round(y + k) - by;
          if (px >= 0 && py >= 0 && px < branch.w && py < branch.h) branch.data[py * branch.w + px] = ix(R.BARK, 2);
        }
      }
    }
    out.push({ frames: [branch], x: bx, y: by, period: 99, phase: 0 });
    const clusters = L.narrow ? 3 : 5;
    for (let i = 0; i < clusters; i++) {
      const u = 0.12 + (i / (clusters - 1)) * 0.88 + rng.range(-0.03, 0.03);
      const above = i % 2 === 1 && i < clusters - 1;
      const size = ((L.narrow ? 9 : 12) + rng.range(-1.5, 2.5)) * (i === clusters - 1 ? 1.1 : 1);
      const x = x0 - side * u * reach;
      const y = branchY(u) + (above ? -size * 0.25 : size * 0.45) + (i === clusters - 1 ? 4 : 0);
      const lobes: Lobe[] = [
        { x: 0, y: 0, rx: size * 0.72, ry: size * 0.5 },
        { x: side * size * 0.35, y: size * 0.32, rx: size * 0.42, ry: size * 0.36 },
        { x: -side * size * 0.3, y: -size * 0.25, rx: size * 0.4, ry: size * 0.32 },
      ];
      const seed = rng.int(0, 1e6);
      const art = renderPad({
        lobes,
        ramp: R.CANOPY,
        lightX: -side,
        clump: 2.8,
        seed,
        bias: 0.3,
        gold: 0.5,
        goldIndex: ix(R.CANOPY, 7),
      });
      const frame = winter ? snowCap(art.sprite, seed) : art.sprite;
      out.push({
        frames: [frame],
        x: Math.round(x + art.ox),
        y: Math.round(y + art.oy - (winter ? 1 : 0)),
        period: 5 + i,
        phase: rng.next() * 6,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ferns: arching fronds like feathers, each leaflet a short slanted stroke lit on its upper edge,
// every other one a step lighter so the leaflets read one by one. Gold at the sunlit tips.

function fernSprite(
  fronds: { angle: number; len: number }[],
  sway: number,
  seed: number,
  winter: boolean,
  lift = 0,
): Sprite {
  const size = 96;
  const s = sprite(size, size);
  const ox = size / 2;
  const oy = size - 4;
  // Back fronds first, darker; the frond nearest the viewer last.
  const order = fronds
    .map((f, i) => ({ f, i }))
    .toSorted((a, b) => Math.abs(Math.cos(b.f.angle)) - Math.abs(Math.cos(a.f.angle)));
  for (const { f, i } of order) {
    const a = f.angle + sway * 0.035 * (f.len / 20);
    const dirX = Math.cos(a);
    const dirY = Math.sin(a);
    const back = (Math.abs(dirX) < 0.5 ? 0 : -1) + lift;
    const steps = Math.round(f.len * 1.4);
    let leaf = 0;
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const x = ox + dirX * f.len * u + Math.sign(dirX) * u * u * f.len * 0.18;
      const y = oy + dirY * f.len * u + u * u * f.len * 0.5;
      put(s, x, y, ix(R.FERN, u > 0.8 ? 5 : 3 + back));
      if (u < 0.1 || k % 2 !== 0) continue;
      leaf++;
      // Tangent of the arching stem, for the leaflets' slant.
      const tx = dirX * f.len + Math.sign(dirX) * 2 * u * f.len * 0.18;
      const ty = dirY * f.len + 2 * u * f.len * 0.5;
      const ta = Math.atan2(ty, tx);
      const pin = Math.max(1.5, Math.sin(Math.PI * Math.min(1, u * 1.02)) * f.len * 0.2);
      for (const side of [-1, 1] as const) {
        const pa = ta + side * 0.95;
        const up = Math.sin(pa) < Math.sin(ta);
        for (let j = 1; j <= pin; j++) {
          const q = j / pin;
          const lx = x + Math.cos(pa) * j;
          const ly = y + Math.sin(pa) * j + q * q * 0.8;
          const lit = (leaf + (side > 0 ? 1 : 0)) % 2 === 0;
          let level = (up ? 5 : 3) + (lit ? 1 : 0) + back;
          if (u > 0.62 && up && q > 0.5) level = 7;
          put(s, lx, ly, ix(R.FERN, level));
          if (j < pin - 1) put(s, lx, ly + 1, ix(R.FERN, up ? 2 + back : 1));
        }
      }
    }
    void i;
  }
  return winter ? snowCap(s, seed, 1) : s;
}

function put(s: Sprite, x: number, y: number, index: number): void {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= s.w || py >= s.h) return;
  s.data[py * s.w + px] = index;
}

function placeFerns(L: Layout, winter: boolean, rng: Rng, front: boolean): Placed[] {
  const spots: { x: number; y: number; scale: number; fan: number }[] = [];
  if (front) {
    spots.push({ x: L.narrow ? 2 : Math.round(L.W * 0.05), y: L.H + 3, scale: L.narrow ? 0.9 : 1.55, fan: 0.3 });
    spots.push({
      x: L.W - (L.narrow ? 2 : Math.round(L.W * 0.045)),
      y: L.H + 3,
      scale: L.narrow ? 0.9 : 1.5,
      fan: -0.3,
    });
    if (!L.narrow) {
      spots.push({ x: Math.round(L.W * 0.1) + 10, y: L.H - 8, scale: 0.85, fan: 0.15 });
      spots.push({ x: L.W - Math.round(L.W * 0.07) - 10, y: L.H - 14, scale: 0.75, fan: -0.15 });
    }
  } else {
    spots.push({ x: Math.round(L.W * 0.085) + 6, y: L.gladeBack + 20, scale: L.narrow ? 0.55 : 0.85, fan: 0.3 });
    spots.push({ x: L.W - Math.round(L.W * 0.06) - 4, y: L.gladeBack + 14, scale: L.narrow ? 0.5 : 0.8, fan: -0.3 });
    if (!L.narrow) {
      spots.push({ x: L.treeX - 58, y: L.gladeBack + 8, scale: 0.55, fan: 0.1 });
      spots.push({ x: L.treeX + 74, y: L.gladeBack + 6, scale: 0.5, fan: -0.1 });
    }
  }
  return spots.map((sp, i) => {
    const n = front ? 5 : rng.int(6, 7);
    const fronds: { angle: number; len: number }[] = [];
    for (let k = 0; k < n; k++) {
      const u = (k + rng.range(0.2, 0.8)) / n;
      const angle = -Math.PI * (front ? 0.1 + 0.8 * u : 0.06 + 0.88 * u) + sp.fan;
      const len = (22 + 14 * Math.sin(Math.PI * u) + rng.range(-3, 3)) * sp.scale;
      fronds.push({ angle, len });
    }
    const seed = rng.int(0, 1e6);
    const frames = [-1, 0, 1, 0].map((sw) => fernSprite(fronds, sw, seed, winter, front ? 1 : 0));
    return { frames, x: sp.x - 48, y: sp.y - 92 - (winter ? 1 : 0), period: 4.5 + i * 0.7, phase: rng.next() * 5 };
  });
}

// ---------------------------------------------------------------------------------------------

interface Stamp {
  sprite: Sprite;
  x: number;
  y: number;
}

function stoneSprite(w: number, h: number, seed: number, winter: boolean): Sprite {
  const s = sprite(w, h + 2);
  const cx = (w - 1) / 2;
  const cy = h * 0.62 + 1;
  for (let y = 0; y < h + 2; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / (w / 2);
      const dy = (y - cy) / (h * 0.62);
      const d = dx * dx + (dy < 0 ? dy * dy : dy * dy * 2.2);
      if (d > 1) continue;
      const lit = -dy * 1.1 - dx * 0.6;
      let level = 3 + Math.round(lit * 1.6);
      if (d > 0.72 && dy > 0) level = 1;
      // A moss cap on the top, olive with a lit edge.
      if (!winter && dy < -0.35 && hash3(x, y, seed) < 0.8) {
        s.data[y * w + x] = ix(R.OLIVE, dy < -0.7 ? 5 : 4);
        continue;
      }
      s.data[y * w + x] = ix(R.STONE, Math.max(1, Math.min(6, level)));
    }
  }
  return winter ? snowCap(s, seed) : s;
}

function placeStones(L: Layout, winter: boolean, rng: Rng): Stamp[] {
  const out: Stamp[] = [];
  const add = (x: number, y: number, w: number, h: number): void => {
    const sp = stoneSprite(w, h, rng.int(0, 1e6), winter);
    out.push({ sprite: sp, x: Math.round(x - w / 2), y: Math.round(y - sp.h + 1) });
  };
  if (!L.narrow) {
    add(L.treeX - 52, L.H - 18, 11, 6);
    add(L.treeX - 44, L.H - 16, 6, 4);
    // Clear of the crab, who sits nearer the edge when the camera is close.
    add(L.H < 170 ? L.W - 12 : L.W - 30, L.H - 30, 9, 5);
  } else {
    add(L.W - 10, L.H - 22, 9, 5);
  }
  return out;
}

const SHROOM_LEGEND = {
  S: ix(R.SHROOM, 6),
  s: ix(R.SHROOM, 5),
  m: ix(R.SHROOM, 4),
  d: ix(R.SHROOM, 2),
  t: ix(R.CREAM, 5),
  T: ix(R.CREAM, 3),
};

const SHROOMS = [
  fromRows(["..sSs..", ".sSSSm.", "sSSSmmm", "ddddddd", "..ttT..", "..ttT..", "..ttT.."], SHROOM_LEGEND),
  fromRows([".sSm.", "sSSmm", "ddddd", ".tT..", ".tT.."], SHROOM_LEGEND),
  fromRows([".Sm", "Smm", "ddd", ".T."], SHROOM_LEGEND),
];

function placeMushrooms(L: Layout, rng: Rng): Stamp[] {
  const out: Stamp[] = [];
  const cluster = (x: number, y: number): void => {
    const a = SHROOMS[0];
    const b = SHROOMS[1];
    const c = SHROOMS[2];
    if (!a || !b || !c) return;
    out.push({ sprite: a, x: x, y: y - a.h });
    out.push({ sprite: b, x: x + 7, y: y - b.h + 1 });
    if (rng.chance(0.7)) out.push({ sprite: c, x: x - 4, y: y - c.h + 1 });
  };
  // At the feet of the framing trunks and beside the hero's roots, never in the open.
  cluster(L.narrow ? 3 : Math.round(L.W * 0.07) - 2, L.H - 12);
  if (!L.narrow && L.H >= 170) cluster(L.W - Math.round(L.W * 0.05) - 16, L.gladeBack + 28);
  // Beside the hero's roots; close round a seedling, by the lantern's foot instead.
  if (L.H < 170 && !L.narrow) cluster(L.lantern.x + 5, L.lantern.y + 4);
  else cluster(L.treeX - 18, L.ground + 4);
  return out;
}
