/**
 * Everything beyond the clearing: the streaked sky, the far ridges with the sunset behind them, the
 * guild's Great Sequoia towering faintly on the far ridge, and two depths of forest.
 */

import type { Layout, Point } from "./layout.ts";
import { ix, mist, R, rampOf, type Time } from "./palette.ts";
import { bayer, type Surface } from "./raster.ts";
import { hash3, noise1, Rng } from "./rng.ts";

const SKY_STEPS = 24;
const skyIndex = (g: number): number => {
  const k = Math.max(0, Math.min(SKY_STEPS - 1, Math.floor(g)));
  return ix(R.SKY0 + (k >> 3), k & 7);
};

export const isSky = (index: number): boolean => {
  const r = rampOf(index);
  return r === R.SKY0 || r === R.SKY1 || r === R.SKY2;
};

export interface Backdrop {
  stars: { x: number; y: number; big: boolean; phase: number; period: number }[];
  lanterns: Point[];
  /** The lake on the valley floor, where its glints are drawn each frame. */
  lake: { x: number; y: number; rx: number; ry: number };
}

/** Where the sky's gradient stands at a row: 0 is the top's deepest step, 23 the horizon's gold. */
function gradient(time: Time, y: number, horizon: number): number {
  const t = Math.max(0, Math.min(1, y / (horizon + 2)));
  if (time === "night") return 23 * Math.pow(t, 2.1);
  if (time === "day") return 4 + 19 * Math.pow(t, 1.1);
  return 5 + 18.6 * Math.pow(t, 1.18);
}

export function drawBackdrop(s: Surface, L: Layout, time: Time, seed: number): Backdrop {
  const rng = new Rng(seed ^ 0x51ce);
  drawSky(s, L, time, rng.fork("sky"));
  drawFarRange(s, L, rng.fork("ridges"));
  const lanterns = drawGreatSequoia(s, L);
  const lake = drawValley(s, L, rng.fork("valley"));
  drawForest(s, L, rng.fork("far"), "far");
  drawForest(s, L, rng.fork("mid"), "mid");
  const stars = placeStars(L, time, rng.fork("stars"));
  if (time === "night") drawMoon(s, L);
  return { stars, lanterns, lake };
}

function drawSky(s: Surface, L: Layout, time: Time, rng: Rng): void {
  const bottom = L.gladeBack;
  const sd = Math.floor(rng.next() * 9999);
  for (let y = 0; y < bottom; y++) {
    const g = gradient(time, y, L.horizon);
    for (let x = 0; x < L.W; x++) {
      let v: number;
      if (time === "night") {
        // The welcome's night sky: a dithered gradient, two neighbouring steps in a fine weave.
        v = g + bayer(x, y) - 0.5;
      } else {
        // Ragged streaks: each row's edge wanders in long horizontal runs.
        const a = noise1(x / 14 + Math.floor(y / 2) * 5.37, sd) - 0.5;
        const b = noise1(x / 6 + y * 3.91, sd + 7) - 0.5;
        v = g + a * 1.3 + b * 0.25;
      }
      s.set(x, y, skyIndex(v));
    }
  }

  // Cloud banks: a few long streaks stacked a couple of rows apart, lit from below by the sunset,
  // warmer than the sky they cross and brightest on their undersides.
  const banks = time === "day" ? 5 : 7;
  for (let i = 0; i < banks; i++) {
    const cy = L.horizon * (0.12 + 0.74 * ((i + rng.range(0.15, 0.85)) / banks));
    const cx = ((i * 0.38 + rng.range(-0.12, 0.12)) % 1) * L.W * 1.1 - L.W * 0.05;
    const streaks = rng.int(2, 4);
    for (let k = 0; k < streaks; k++) {
      const sy = Math.round(cy + k * rng.range(2, 3.5));
      const len = (rng.range(0.16, 0.34) * L.W + 18) * (1 - k * 0.18);
      const sx = cx + rng.range(-0.08, 0.08) * L.W + k * rng.range(-8, 8);
      const thick = rng.range(1.4, 3.2) * (k === 0 ? 1 : 0.8);
      cloudStreak(s, L, time, sx, sy, len, thick, sd + i * 17 + k);
    }
  }
}

function cloudStreak(
  s: Surface,
  L: Layout,
  time: Time,
  cx: number,
  cy: number,
  len: number,
  thick: number,
  seed: number,
): void {
  const lift = time === "night" ? 1.5 + 4 * (cy / L.horizon) : 5.2 - 2.6 * (cy / L.horizon);
  for (let x = Math.floor(cx - len / 2); x <= cx + len / 2; x++) {
    if (x < 0 || x >= L.W) continue;
    const u = (x - (cx - len / 2)) / len;
    // Thickness changes in runs of a few pixels, as hand-drawn streaks do, never pixel to pixel.
    const run = Math.floor(x / 4);
    const prof = Math.pow(Math.sin(Math.PI * u), 0.55) * thick * (0.55 + 0.75 * noise1(run / 1.7, seed));
    if (prof < 0.6) continue;
    const top = Math.round(cy - prof * 0.55);
    const bot = Math.round(cy + prof * 0.45);
    for (let y = top; y <= bot; y++) {
      const g = gradient(time, y, L.horizon);
      if (time === "day") {
        s.set(x, y, ix(R.STAR, y === bot ? 4 : y === top ? 7 : 6));
      } else {
        s.set(x, y, skyIndex(g + lift + (y === bot ? 1.6 : y === top ? -0.6 : 0.4)));
      }
    }
  }
}

/** A waxing moon high over the forest, with a faint dithered halo. */
function drawMoon(s: Surface, L: Layout): void {
  const mx = Math.round(L.narrow ? L.W * 0.7 : L.W * 0.62);
  const my = Math.round(L.horizon * (L.narrow ? 0.42 : 0.24));
  const r = 5.5;
  for (let y = Math.floor(my - r * 3); y <= my + r * 3; y++) {
    for (let x = Math.floor(mx - r * 3); x <= mx + r * 3; x++) {
      const d = Math.hypot(x - mx, y - my);
      if (d <= r) {
        // The lit part, with the shadowed limb on the left, a couple of soft maria.
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

function placeStars(L: Layout, time: Time, rng: Rng): Backdrop["stars"] {
  if (time === "day") return [];
  const count = Math.round((L.W * L.horizon) / (time === "night" ? 260 : 900));
  const stars: Backdrop["stars"] = [];
  for (let i = 0; i < count; i++) {
    const y = Math.round(
      Math.pow(rng.next(), time === "night" ? 1.3 : 1.8) * L.horizon * (time === "night" ? 0.85 : 0.55),
    );
    stars.push({
      x: rng.int(2, L.W - 3),
      y: Math.max(2, y),
      big: rng.chance(time === "night" ? 0.1 : 0.12),
      phase: rng.next(),
      period: rng.range(2.4, 5.5),
    });
  }
  return stars;
}

function ridgeLine(x: number, base: number, amp: number, k: number, seed: number): number {
  return Math.round(
    base -
      amp *
        (0.55 * Math.sin(x * 0.019 * k + seed) +
          0.3 * Math.sin(x * 0.047 * k + seed * 2.1) +
          0.15 * (noise1(x / 7, seed) - 0.5)),
  );
}

/** The far range under the sunset: one violet silhouette, its crest catching the last light. */
function drawFarRange(s: Surface, L: Layout, rng: Rng): void {
  const a = rng.range(0, 6);
  for (let x = 0; x < L.W; x++) {
    const far = ridgeLine(x, L.horizon - 4, Math.min(9, (L.gladeBack - L.horizon) * 0.3), 1, a);
    for (let y = far; y < L.gladeBack; y++) s.set(x, y, ix(R.HAZE, y === far ? 7 : 6));
  }
}

/**
 * The valley, as the guild's "Fogbound Sequoias" paints depth: a few forested ridges, each a calm
 * violet silhouette sloping down from one side toward the valley floor, and between them level
 * banks of teal mist. Fog lies flat while the ridges slope, so each ridge rises out of the bank in
 * front of the one behind it; the further banks are paler. Only the nearest ridge shows treetops,
 * in small groves. A still lake lies on the floor where the ridges meet.
 */
function drawValley(s: Surface, L: Layout, rng: Rng): Backdrop["lake"] {
  const top = L.horizon - 1;
  const bottom = L.gladeBack + 1;
  const span = bottom - top;
  const count = span >= 40 ? 3 : 2;
  const valleyX = L.lake.x;
  const openL = Math.max(0, L.treeX - L.W * 0.22);
  const openR = Math.min(L.W, L.lake.x + L.lake.rx + L.W * 0.16);
  let fromLeft = rng.chance(0.5);
  let lake: Backdrop["lake"] = { x: valleyX, y: top + Math.round(span * 0.4), rx: L.lake.rx, ry: 2 };
  for (let k = 0; k < count; k++) {
    const depth = (k + 1) / count;
    const near = k === count - 1;
    // The nearest ridge stops short of the clearing, so the lake on the floor behind it shows.
    const low = top + span * (near ? 0.76 : 0.24 + 0.62 * depth);
    const rise = span * (0.22 + 0.2 * depth);
    const from = fromLeft ? openL : openR;
    const to = valleyX + (fromLeft ? 1 : -1) * L.lake.rx * rng.range(0.9, 1.5);
    const sd = rng.int(0, 9999);
    const line = new Int16Array(L.W);
    for (let x = 0; x < L.W; x++) {
      const v = Math.max(0, Math.min(1, (x - from) / (to - from)));
      const slope = 0.5 + 0.5 * Math.cos(Math.PI * v);
      const swell = (noise1(x / 21, sd) - 0.5) * span * 0.06;
      line[x] = Math.round(low - rise * slope + swell);
    }
    if (near) {
      // Small groves of spires along the nearest crest: a few trees, a gap, a few more.
      let x = rng.range(0, 8);
      while (x < L.W) {
        const trees = rng.int(2, 4);
        for (let i = 0; i < trees; i++) {
          const cx = Math.round(x + i * rng.range(3.5, 5));
          const h = rng.int(4, 7);
          const base = line[Math.max(0, Math.min(L.W - 1, cx))] ?? bottom;
          for (let dy = 0; dy < h; dy++) {
            const hw = Math.floor((dy / h) * 2.4);
            for (let dx = -hw; dx <= hw; dx++) {
              const xi = cx + dx;
              if (xi >= 0 && xi < L.W) line[xi] = Math.min(line[xi] ?? bottom, base - h + dy);
            }
          }
        }
        x += trees * 4.5 + rng.range(6, 16);
      }
    } else {
      for (let x = 0; x < L.W; x++) if (noise1(x / 2.6, sd + 5) > 0.64) line[x] = (line[x] ?? bottom) - 1;
    }

    // The bank of mist in front of the ridge behind: level, its top edge torn into long wisps as
    // the sky's streaks are, a few loose wisps above it, its foot hidden behind this ridge.
    const bankTop = Math.round(low - span * 0.17);
    const bankH = Math.max(3, Math.round(span * 0.12));
    const pale = Math.max(4, 7 - k);
    const wsd = sd + 11;
    for (let x = 0; x < L.W; x++) {
      const run = noise1(x / 13 + k * 3.1, wsd);
      const edge = Math.round(bankTop - bankH * (0.25 + 0.75 * run));
      for (let y = edge; y <= low + 2; y++) s.set(x, y, mist(y < edge + 2 ? Math.max(1, pale - 1) : pale));
    }
    for (let w = 0; w < 3 + count - k; w++) {
      const wy = bankTop - bankH - 2 - (w % 3) * 2;
      const wx = Math.round(rng.range(0, L.W));
      const len = Math.round(rng.range(6, 18 + span * 0.3));
      for (let x = wx; x < wx + len && x < L.W; x++) {
        const u = (x - wx) / len;
        if (u < 0.12 || u > 0.88 ? (x & 1) === 0 : false) continue;
        s.set(x, wy, mist(Math.max(1, pale - 1)));
      }
    }
    // The lake lies on the valley floor in front of the mist, its near edge under the nearest ridge.
    if (near) lake = drawLake(s, L, line, valleyX);
    const body = near ? 3 : k === 0 && count === 3 ? 5 : 4;
    for (let x = 0; x < L.W; x++) {
      const crest = line[x] ?? bottom;
      const lit = noise1(x / 4 + k * 13, 77) > 0.52;
      for (let y = crest; y < bottom; y++) s.set(x, y, ix(R.HAZE, y === crest && lit ? body + 1 : body));
    }
    fromLeft = !fromLeft;
  }
  // The last bank lies along the clearing's edge, behind the undergrowth.
  const lastTop = bottom - Math.round(span * 0.12);
  for (let y = lastTop; y < bottom; y++) {
    const a = (y - lastTop) / (bottom - lastTop);
    for (let x = 0; x < L.W; x++) if (bayer(x, y) < a * 1.2) s.set(x, y, mist(a > 0.6 ? 4 : 3));
  }
  return lake;
}

/** A still lake in the valley floor: the sky's colours, a dark band where the far shore reflects. */
function drawLake(s: Surface, L: Layout, shore: Int16Array, cx: number): Backdrop["lake"] {
  // Sit it in the notch where the next ridge is lowest near the valley's middle.
  let low = Math.round(cx);
  for (let x = Math.round(cx - L.lake.rx); x <= cx + L.lake.rx; x++) {
    if (x >= 0 && x < L.W && (shore[x] ?? 0) > (shore[low] ?? 0)) low = x;
  }
  const rx = L.lake.rx;
  const ry = Math.max(2, Math.round(rx / 8));
  // Its near edge tucks under the ridge in front.
  const cy = (shore[low] ?? L.horizon) - ry + 2;
  const x0 = low;
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = Math.floor(x0 - rx); x <= x0 + rx; x++) {
      const d = ((x - x0) / rx) ** 2 + ((y - cy) / (ry + 0.5)) ** 2;
      if (d > 1) continue;
      const row = y - (cy - ry);
      // The far shore's dark reflection along the top, then the sunset's pink and gold.
      const index = row === 0 ? ix(R.HAZE, 4) : d < 0.25 ? ix(R.SKY2, 4) : d < 0.6 ? ix(R.SKY2, 3) : ix(R.SKY2, 2);
      s.set(x, y, index);
    }
  }
  return { x: x0, y: cy, rx, ry };
}

/**
 * The guild's tree on the far ridge: a column far taller than the forest, hazy, its crown one
 * lumpy clouded mass (never a stack of discs), with lanterns in its branches.
 */
function drawGreatSequoia(s: Surface, L: Layout): Point[] {
  const gx = L.great.x;
  const foot = L.horizon + 4;
  const top = Math.round(L.H * 0.12);
  const k = L.narrow ? 0.72 : 1;
  const body = ix(R.HAZE, 3);
  const lit = ix(R.HAZE, 5);
  const rim = ix(R.HAZE, 6);
  const shade = ix(R.HAZE, 2);
  const litLeft = gx > L.treeX;
  for (let y = top + 8; y <= foot; y++) {
    const t = (y - top) / (foot - top);
    const hw = (1.3 + t * 1.4) * k + Math.max(0, y - (foot - 6)) * 0.7;
    const x0 = Math.round(gx - hw);
    const x1 = Math.round(gx + hw);
    for (let x = x0; x <= x1; x++)
      s.set(x, y, (litLeft ? x === x0 : x === x1) ? lit : (litLeft ? x === x1 : x === x0) ? shade : body);
  }
  const crownH = Math.round((foot - top) * 0.5);
  const maxW = 13 * k;
  const lanterns: Point[] = [];
  const tiers = 8;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const py = top + 3 + t * crownH;
    const half = maxW * (0.32 + 0.68 * Math.sin(Math.PI * (0.12 + 0.62 * t))) * (i === tiers - 1 ? 0.75 : 1);
    const px = gx + (i % 2 === 0 ? -1 : 1) * half * 0.18 * (i === 0 ? 0 : 1);
    const ry = 3 + t * 1.6;
    for (let y = Math.floor(py - ry - 1); y <= Math.ceil(py + ry); y++) {
      for (let x = Math.floor(px - half - 2); x <= Math.ceil(px + half + 2); x++) {
        // Lumpy rims: the radius wanders column by column in two-pixel runs.
        const bump = 1 + (hash3(x >> 1, i, 91) - 0.5) * 0.45;
        const dx = (x - px) / (half * bump);
        const dy = (y - py) / ry;
        const d = dx * dx + (dy < 0 ? dy * dy : dy * dy * 1.5);
        if (d > 1) continue;
        // Seen this far off it is one flat shape: a sunlit rim on its sunset side, a few lit lumps.
        const edge = litLeft ? dx < -0.62 : dx > 0.62;
        const litSide = litLeft ? dx < 0.05 : dx > -0.05;
        let v = body;
        if (edge && dy < 0.35) v = d > 0.72 ? rim : lit;
        else if (dy < -0.5 && litSide && hash3(x >> 1, i, 5) < 0.55) v = lit;
        else if (i === tiers - 1 && dy > 0.5) v = shade;
        s.set(x, y, v);
      }
    }
    if (i > 0 && i < tiers - 1)
      lanterns.push({ x: Math.round(px + (i % 2 ? 0.45 : -0.4) * half), y: Math.round(py + ry * 0.5) });
  }
  return lanterns;
}

/**
 * A spire, as the welcome's far forest draws them: half-width growing from the tip, stepped out in
 * tiers, a lit edge facing the sunset. `bare` leaves the lower trunk without branches, as a redwood's.
 */
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
      // Bare trunk below the crown.
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

/**
 * Two depths of forest walling the valley: tall at the sides and falling away where the valley
 * opens, from beside the tree to past the lake, so the sunset and the mist show behind the tree as
 * they do between the welcome's trunks. The mid forest parts round the Great Sequoia, so the
 * guild's tree is always seen.
 */
function drawForest(s: Surface, L: Layout, rng: Rng, depth: "far" | "mid"): void {
  const ramp = depth === "far" ? R.FAR : R.MID;
  const step = depth === "far" ? 6.5 : 12;
  const sd = rng.int(0, 9999);
  let x = rng.range(-step, 0);
  let i = 0;
  const openL = L.treeX - L.W * 0.12;
  const openR = L.lake.x + L.lake.rx + L.W * 0.04;
  const wall = Math.max(40, L.W * 0.3);
  while (x < L.W + step) {
    const out = x < openL ? openL - x : x > openR ? x - openR : 0;
    const v = Math.min(1, out / wall);
    const side = v * v * (3 - 2 * v);
    const grove = noise1(x / (depth === "mid" ? 40 : 22), sd);
    const cx = Math.round(x);
    const litRight = cx < L.treeX;
    const nearGreat = Math.abs(cx - L.great.x) < (L.narrow ? 10 : 22);
    if (depth === "far") {
      // The opening stays open, so the mist and the lake show through it.
      const h = 12 + side * 34 + grove * 16 + rng.range(-3, 3);
      if (side > 0.04)
        spire(s, cx, L.gladeBack + 2, Math.round(h), h * 0.3 + rng.range(-0.5, 0.5), ramp, 4, litRight, sd + i);
    } else if (side > 0.3 && !nearGreat) {
      const h = 26 + side * 50 + grove * 22 + rng.range(-4, 4);
      const sequoia = i % 3 === 1;
      spire(
        s,
        cx,
        L.gladeBack + 6,
        Math.round(h),
        h * (sequoia ? 0.24 : 0.3),
        ramp,
        3,
        litRight,
        sd + i,
        sequoia ? 0.38 : 0,
      );
    }
    x += step * rng.range(0.75, 1.25);
    i++;
  }
}
