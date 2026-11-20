/**
 * Everything behind and under the guild's trees: the Fruma ridge on the far skyline, the valley's
 * wild forests at three depths, the ground of each row of trees, and the ferns in the foreground.
 */

import { type Lobe, renderPad, snowCap } from "../pixel/foliage.ts";
import { ix, R, type Season } from "../pixel/palette.ts";
import type { Surface } from "../pixel/raster.ts";
import { hash3, noise1, Rng } from "../pixel/rng.ts";
import { HEART_X, HORIZON, type Layer, NEW_BANNER, PLACES, type Row, WORLD_H, WORLD_W } from "./world.ts";

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------
// The far skyline. West, the Swamp's lowlands lie flat to the horizon; east, the Fruma ridge
// rises, the guild's home, with a pennant on each territory it holds.

/** The Fruma ridge's crest at nominal x, in world rows. */
export function ridgeCrest(X: number): number {
  const lift = smooth(380, 1060, X) * 24;
  const bumps =
    0.55 * Math.sin(X * 0.0071 + 1.3) + 0.3 * Math.sin(X * 0.0187 + 0.4) + 0.15 * (noise1(X / 34, 71) - 0.5) * 2;
  return Math.round(HORIZON + 4 - lift - bumps * (3 + lift * 0.25));
}

function farRange(X: number): number {
  return Math.round(
    HORIZON - 6 - smooth(200, 900, X) * 10 - 6 * Math.sin(X * 0.0043 + 2) - 3 * Math.sin(X * 0.013 + 0.7),
  );
}

export function paintRidge(layer: Layer, season: Season): void {
  const s = layer.s;
  const winter = season === "winter";
  for (let x = 0; x < s.w; x++) {
    const X = layer.X(x);
    const far = farRange(X);
    for (let y = far; y < WORLD_H; y++) s.set(x, y, ix(R.HAZE, y === far ? 7 : 6));
    if (winter)
      for (let y = far; y < far + 3; y++) if (hash3(x, y, 4) < 0.7 - (y - far) * 0.2) s.set(x, y, ix(R.SNOW, 3));
    const crest = ridgeCrest(X);
    for (let y = crest; y < WORLD_H; y++) {
      const depth = y - crest;
      // Valley mist: a lighter run every few rows, broken into long streaks.
      const mist = depth % 5 === 3 && noise1(x / 9 + y, 5) > 0.45;
      const lit = depth === 0 || (depth === 1 && hash3(x >> 1, 9, 3) < 0.4);
      s.set(x, y, ix(R.HAZE, lit ? 5 : mist ? 5 : 4));
    }
    if (winter && X > 700)
      for (let y = crest; y < crest + 2; y++) if (hash3(x, y, 5) < 0.6 - (y - crest) * 0.25) s.set(x, y, ix(R.SNOW, 2));
  }
  // A lake in the lowlands, catching the sunset: the Swamp's waters, far off.
  const lake = { x: layer.lx(250), y: HORIZON + 13, rx: 28 };
  for (let y = lake.y - 2; y <= lake.y + 2; y++) {
    for (let x = lake.x - lake.rx; x <= lake.x + lake.rx; x++) {
      const d = ((x - lake.x) / lake.rx) ** 2 + ((y - lake.y) / 2.6) ** 2;
      if (d > 1) continue;
      const glint = y === lake.y - 1 && hash3(x >> 1, 3, 17) < 0.35 && d < 0.6;
      s.set(x, y, glint ? ix(R.SKY2, 2) : ix(R.HAZE, y === lake.y - 2 ? 7 : 6));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The wild forest, as the welcome's far forest draws it (copied from `../pixel/backdrop.ts`).

function spire(
  s: Surface,
  cx: number,
  base: number,
  h: number,
  w: number,
  ramp: number,
  body: number,
  litRight: boolean,
  seed: number,
  bare = 0,
): void {
  const top = base - h;
  const crownH = h * (1 - bare);
  const tierH = Math.max(3, Math.round(crownH / 8));
  s.set(cx, top - 1, ix(ramp, body));
  for (let y = top; y <= base; y++) {
    const dy = y - top;
    if (dy > crownH) {
      const hw = Math.max(1, w * 0.1) + (y > base - 4 ? (y - (base - 4)) * 0.5 : 0);
      for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++) {
        const lit = litRight ? x === Math.round(cx + hw) : x === Math.round(cx - hw);
        s.set(x, y, ix(ramp, lit ? body + 1 : body - 1));
      }
      continue;
    }
    const t = dy / crownH;
    const tier = (dy % tierH) / tierH;
    const taper =
      bare > 0 ? Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.08)), 0.5) * 0.6 + t * 0.4 : Math.pow(t, 0.85);
    const hw = Math.max(0.5, (w / 2) * taper * (0.66 + 0.44 * tier) + (hash3(dy, seed, 3) - 0.5) * 1.1);
    const x0 = Math.round(cx - hw);
    const x1 = Math.round(cx + hw);
    for (let x = x0; x <= x1; x++) {
      const edgeLit = litRight ? x === x1 : x === x0;
      const edgeShade = litRight ? x === x0 : x === x1;
      const tierShade = tier < 0.25 && x !== x0 && x !== x1 && hash3(x, y, seed) < 0.55;
      s.set(x, y, ix(ramp, edgeLit ? body + 2 : edgeShade || tierShade ? body - 1 : body));
    }
  }
}

/** A dead snag in the Swamp's mist: a bare pole, its top snapped, a stub of a limb or two. */
function snag(s: Surface, cx: number, base: number, h: number, ramp: number, body: number, seed: number): void {
  const lean = (hash3(seed, 1, 1) - 0.5) * 3;
  for (let k = 0; k <= h; k++) {
    const y = base - k;
    const x = Math.round(cx + (lean * k) / h);
    const hw = k < 3 ? 1.5 : k > h - 3 ? 0.5 : 1;
    for (let dx = -Math.round(hw); dx <= Math.round(hw); dx++) s.set(x + dx, y, ix(ramp, dx < 0 ? body + 1 : body));
  }
  const stubs = 1 + Math.floor(hash3(seed, 2, 2) * 2);
  for (let i = 0; i < stubs; i++) {
    const k = Math.round(h * (0.45 + 0.35 * hash3(seed, i, 3)));
    const side = hash3(seed, i, 4) < 0.5 ? -1 : 1;
    const x = Math.round(cx + (lean * k) / h);
    for (let j = 1; j <= 3; j++) s.set(x + side * j, base - k - (j > 2 ? 1 : 0), ix(ramp, body));
  }
}

const SWAMP_END = 330;

export function paintWildForest(layer: Layer, depth: "haze" | "far" | "near", seed: number): void {
  const s = layer.s;
  const rng = new Rng(seed);
  const ramp = depth === "haze" ? R.HAZE : depth === "far" ? R.FAR : R.MID;
  const step = depth === "haze" ? 5 : depth === "far" ? 7 : 15;
  const sd = rng.int(0, 9999);
  let x = rng.range(-step, 0);
  let i = 0;
  while (x < s.w + step) {
    const cx = Math.round(x);
    const X = layer.X(cx);
    const swamp = 1 - smooth(SWAMP_END - 120, SWAMP_END + 60, X);
    const grove = noise1(cx / (depth === "near" ? 26 : 18), sd);
    const litRight = false;
    if (depth === "haze") {
      const crest = ridgeCrest(X);
      for (let row = 0; row < 3; row++) {
        // The Swamp's lowlands are open water and reed beds: no forest there.
        if (swamp > 0.55 || noise1(cx / 13 + row * 7, sd) < 0.28 + swamp * 0.5) continue;
        const h = (5 + grove * 10 + rng.range(-2, 2) + row * 3) * (1 - swamp * 0.5);
        const base = Math.max(crest + 6, HORIZON + 6) + row * 6 + Math.round(rng.range(-1, 1));
        spire(s, cx + row * 2, base, Math.round(h), h * 0.36, ramp, row === 0 ? 3 : 2, litRight, sd + i + row * 99);
      }
    } else if (depth === "far") {
      if (swamp > 0.5) {
        if (rng.chance(0.12)) snag(s, cx, HORIZON + 30, Math.round(rng.range(6, 20)), ramp, 4, sd + i);
      } else if (noise1(cx / 9, sd + 3) > 0.2 && Math.abs(X - NEW_BANNER) > 22) {
        const h = 14 + grove * 26 + rng.range(-3, 5);
        spire(s, cx, HORIZON + 34, Math.round(h), h * 0.3 + rng.range(-0.5, 0.5), ramp, 4, litRight, sd + i);
      }
    } else {
      // The near wild forest: tall redwood silhouettes in groves, parting round the heart, where
      // the Great Sequoia stands, and thinning to snags over the Swamp.
      const nearHeart = Math.abs(X - HEART_X) < 70 || Math.abs(X - NEW_BANNER) < 34;
      if (swamp > 0.5) {
        if (rng.chance(0.18)) snag(s, cx, HORIZON + 42, Math.round(rng.range(10, 34)), ramp, 3, sd + i);
      } else if (!nearHeart && grove > 0.32) {
        const h = 40 + grove * 46 + rng.range(-6, 8);
        const sequoia = i % 3 === 1;
        spire(
          s,
          cx,
          HORIZON + 42,
          Math.round(h),
          h * (sequoia ? 0.22 : 0.27),
          ramp,
          3,
          litRight,
          sd + i,
          sequoia ? 0.4 : 0,
        );
      }
    }
    x += step * rng.range(0.7, 1.3);
    i++;
  }
}

// ---------------------------------------------------------------------------------------------
// The ground each row of trees stands on: moss, a fringe of undergrowth along its top edge, and
// in the front row the path from the gate to the campfire.

export interface Ground {
  /** The ground's top edge at each layer x. */
  top: Int16Array;
}

export function paintGround(layer: Layer, row: Row, season: Season, seed: number): Ground {
  const s = layer.s;
  const winter = season === "winter";
  const rng = new Rng(seed);
  const sd = rng.int(0, 9999);
  const top = new Int16Array(s.w);
  const far = row.name === "back" ? 2 : row.name === "mid" ? 1 : 0;
  for (let x = 0; x < s.w; x++) {
    const X = layer.X(x);
    const undulate = Math.round((noise1(X / 40, sd) - 0.5) * 4 + (noise1(X / 11, sd + 1) - 0.5) * 1.5);
    const t = row.fringe + undulate;
    top[x] = t;
    for (let y = t; y < WORLD_H; y++) {
      const d = y - t;
      let v: number;
      if (winter) {
        const n = noise1(x / 7 + y * 0.9, sd + 2);
        v = d === 0 ? ix(R.SNOW, 6 - far) : ix(R.SNOW, Math.max(1, (n > 0.62 ? 5 : n < 0.2 ? 3 : 4) - far));
      } else {
        const n = noise1(x / 6 + Math.floor(y / 2) * 3.3, sd + 2);
        const fine = hash3(x, y, sd);
        let level = d === 0 ? 5 : d < 3 ? 4 : n > 0.66 ? 4 : n < 0.25 ? 2 : 3;
        // The nearest ground falls into shade toward the frame's bottom edge.
        if (y > WORLD_H - 9) level -= y > WORLD_H - 4 ? 2 : 1;
        if (fine < 0.08) level += 1;
        else if (fine > 0.94) level -= 1;
        v = ix(R.MOSS, Math.max(0, level - far));
        if (d === 0 && hash3(x >> 1, y, 3) < 0.3) v = ix(R.OLIVE, Math.max(2, 5 - far));
      }
      s.set(x, y, v);
    }
  }
  if (row.name === "front") paintPath(layer, top, winter, sd);
  if (row.name !== "back") paintDetail(layer, row, top, winter, sd + 9);
  paintUndergrowth(layer, row, top, winter, rng.fork("shrubs"));
  return { top };
}

/** The trodden path: in at the gate, east of the stall, on to the campfire before the Great Sequoia. */
function paintPath(layer: Layer, top: Int16Array, winter: boolean, sd: number): void {
  const s = layer.s;
  const x0 = layer.lx(PLACES.campfire - 30);
  const x1 = layer.lx(WORLD_W);
  for (let x = x0; x < Math.min(s.w, x1); x++) {
    const X = layer.X(x);
    const fade = smooth(PLACES.campfire - 30, PLACES.campfire + 20, X);
    const cy = 233 + Math.round(Math.sin(X / 70) * 1.5 + (noise1(X / 23, sd + 5) - 0.5) * 2);
    const half = 2.2 + fade * 1.4 + noise1(X / 9, sd + 6) * 0.8;
    for (let y = Math.round(cy - half); y <= Math.round(cy + half); y++) {
      if (y <= (top[x] ?? 0) + 2) continue;
      const edge = Math.abs(y - cy) > half - 1;
      if (edge && hash3(x, y, 9) < 0.5) continue;
      const v = hash3(x, y, sd);
      if (winter) s.set(x, y, ix(R.SNOW, edge ? 3 : v < 0.2 ? 2 : 3));
      else s.set(x, y, ix(R.SOIL, edge ? 4 : v < 0.12 ? 7 : v < 0.4 ? 6 : 5));
    }
    // Pebbles along the edges, now and then.
    if (!winter && hash3(x, 3, sd) < 0.05) {
      const py = Math.round(cy + (hash3(x, 4, sd) < 0.5 ? -half - 1 : half + 1));
      s.set(x, py, ix(R.STONE, 5));
      s.set(x + 1, py, ix(R.STONE, 3));
    }
  }
}

/**
 * The ground's small things, gathered in drifts rather than sprinkled: tufts of grass, a few
 * wildflowers, pale mushrooms in little families, fallen needles.
 */
function paintDetail(layer: Layer, row: Row, top: Int16Array, winter: boolean, sd: number): void {
  const s = layer.s;
  const rng = new Rng(sd);
  const near = row.name === "front";
  const bottom = near ? WORLD_H - 2 : row.fringe + 14;
  for (let x = 2; x < s.w - 2; x++) {
    const X = layer.X(x);
    const drift = noise1(X / 26, sd);
    if (drift < 0.42) continue;
    const t = top[x] ?? row.fringe;
    // Tufts of grass: a few blades each, lit at the tips, in drifts.
    if (hash3(x, 1, sd) < (drift - 0.42) * (near ? 0.5 : 0.35)) {
      const y = Math.round(t + 3 + rng.next() * (bottom - t - 3));
      const blades = rng.int(2, 4);
      for (let b = 0; b < blades; b++) {
        const h = rng.int(2, near ? 5 : 3);
        const bx = x + b - 1;
        for (let k = 0; k < h; k++)
          s.set(
            bx + (k === h - 1 && b === 0 ? -1 : 0),
            y - k,
            winter ? ix(R.SNOW, k === h - 1 ? 7 : 5) : ix(R.FERN, k === h - 1 ? 6 : k === 0 ? 2 : 4),
          );
      }
    }
    if (winter) continue;
    // Wildflowers, a handful together.
    if (near && drift > 0.68 && hash3(x, 2, sd) < 0.05) {
      const y = Math.round(t + 6 + rng.next() * (bottom - t - 8));
      const petal = rng.pick([ix(R.ROSE, 5), ix(R.CREAM, 6), ix(R.SHROOM, 6), ix(R.STAR, 3)]);
      for (let f = 0; f < rng.int(2, 4); f++) {
        const fx = x + rng.int(-3, 3);
        const fy = y + rng.int(-1, 1);
        s.set(fx, fy + 1, ix(R.FERN, 3));
        s.set(fx, fy, petal);
      }
    }
    // Pale mushrooms, a family of two or three.
    if (near && drift > 0.6 && hash3(x, 3, sd) < 0.012) {
      const y = Math.round(t + 5 + rng.next() * (bottom - t - 7));
      for (let m = 0; m < rng.int(2, 3); m++) {
        const mx = x + m * 3 - 2;
        const my = y + (m % 2);
        const big = m === 0;
        s.set(mx, my, ix(R.SHROOM, 6));
        s.set(mx, my - 1, ix(R.SHROOM, 6));
        s.rect(mx - (big ? 2 : 1), my - (big ? 3 : 2), big ? 5 : 3, 1, ix(R.SHROOM, 5));
        s.rect(mx - (big ? 1 : 0), my - (big ? 4 : 3), big ? 3 : 1, 1, ix(R.SHROOM, 7));
        if (big) s.set(mx + 1, my - 3, ix(R.SHROOM, 3));
      }
    }
  }
}

/** Low clumps of undergrowth along a row's top edge: in groups, with gaps, never evenly spaced. */
function paintUndergrowth(layer: Layer, row: Row, top: Int16Array, winter: boolean, rng: Rng): void {
  const s = layer.s;
  const k = row.scale;
  let x = rng.range(0, 10);
  while (x < s.w) {
    const X = layer.X(x);
    const inSwamp = X < SWAMP_END - 40 && row.name !== "back";
    const group = rng.int(1, 6);
    const scale = rng.chance(0.25) ? rng.range(1.3, 1.8) : rng.range(0.6, 1.1);
    for (let g = 0; g < group && x < s.w; g++) {
      const rx = rng.range(4, 9) * (0.6 + k * 0.5) * scale * (g === 0 || g === group - 1 ? 0.75 : 1);
      const ry = rx * rng.range(0.45, 0.62);
      const cx = Math.round(x);
      const base = (top[Math.max(0, Math.min(s.w - 1, cx))] ?? row.fringe) + 1;
      if (!inSwamp) {
        const lobes: Lobe[] = [
          { x: 0, y: 0, rx, ry },
          { x: rx * rng.range(-0.5, 0.5), y: -ry * 0.5, rx: rx * 0.55, ry: ry * 0.75 },
        ];
        const art = renderPad({
          lobes,
          ramp: R.FOLI,
          lightX: -1,
          clump: 1.6 + k * 0.6,
          seed: rng.int(0, 1e6),
          bias: row.name === "back" ? -0.8 : row.name === "mid" ? -0.3 : 0.1,
          gold: row.name === "front" ? 0.35 : 0.2,
          goldIndex: ix(R.OLIVE, 6),
        });
        const sp = winter ? snowCap(art.sprite, rng.int(0, 1e6)) : art.sprite;
        s.blit(sp, cx + art.ox, base + art.oy - Math.round(ry * 0.35));
      }
      x += rx * rng.range(1.1, 1.7);
    }
    x += (rng.chance(0.3) ? rng.range(40, 90) : rng.range(6, 30)) * (row.name === "front" ? 1.3 : 1);
  }
}

// ---------------------------------------------------------------------------------------------
// The foreground: ferns along the bottom edge, near and dark, sliding past a little faster than
// the trees as the camera pans.

export function paintForeground(layer: Layer, season: Season, seed: number): void {
  const s = layer.s;
  const rng = new Rng(seed);
  const winter = season === "winter";
  let x = rng.range(0, 30);
  while (x < s.w) {
    const X = layer.X(x);
    // Keep the foreground clear in front of the heart and the pond, where the eye should go.
    const clear = Math.abs(X - HEART_X) < 70 || Math.abs(X - PLACES.pond) < 60 || Math.abs(X - PLACES.campfire) < 30;
    if (!clear) {
      const fronds = rng.int(3, 6);
      const size = rng.range(10, 19);
      fern(s, Math.round(x), WORLD_H + 1, size, fronds, rng.int(0, 1e6), winter);
    }
    x += rng.range(40, 120);
  }
}

/** A fern: fronds arching out from a crown, leaflets alternating along each, lit at their tips. */
function fern(s: Surface, cx: number, base: number, size: number, fronds: number, seed: number, winter: boolean): void {
  const rng = new Rng(seed);
  for (let f = 0; f < fronds; f++) {
    const side = f % 2 === 0 ? -1 : 1;
    const spread = (0.25 + 0.75 * ((f + rng.range(0.1, 0.9)) / fronds)) * side;
    const len = size * rng.range(0.75, 1.1) * (1 - Math.abs(spread) * 0.25);
    const steps = Math.ceil(len * 1.6);
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      // Up and out, then the tip curls over and down.
      const x = cx + spread * len * Math.sin(u * 1.4) * 0.9;
      const y = base - len * Math.sin(u * Math.PI * 0.62) * 0.9;
      const shade = u > 0.8 ? 6 : u > 0.5 ? 4 : 2;
      s.set(x, y, ix(R.FERN, shade));
      // Leaflets every other step, alternating sides, shrinking toward the tip.
      if (i % 2 === 0 && u > 0.12) {
        const leaf = Math.max(1, Math.round((1 - u) * 4));
        const ls = i % 4 === 0 ? -1 : 1;
        for (let k = 1; k <= leaf; k++) {
          const lx = x + side * k * 0.6;
          const ly = y + ls * k * 0.7 + k * 0.3;
          s.set(lx, ly, ix(R.FERN, Math.min(7, shade + (k === leaf && u > 0.4 ? 2 : 0))));
        }
      }
      if (winter && u > 0.5 && u < 0.85 && i % 3 === 0) s.set(x, y - 1, ix(R.SNOW, 6));
    }
  }
}
