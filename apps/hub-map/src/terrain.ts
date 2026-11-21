/**
 * Paints the province once, at load: sea, shore, river, hills, roads, woods and every building, all
 * onto one canvas the size of the map. Nothing here moves; what moves is drawn over it each frame.
 */
import { P, rgb } from "./palette.ts";
import { makeCanvas, TREES } from "./pix.ts";
import { fbm, hash2, mulberry, noise } from "./rand.ts";
import {
  CAMP,
  EDGES,
  FIRE,
  GATES,
  H,
  type Hue,
  LANDS,
  LIGHTHOUSE,
  MILL,
  NODES,
  POND,
  type Pt,
  RIVER,
  ROPE,
  smoothLine,
  STONES,
  TREASURY,
  W,
  WORKS,
} from "./world.ts";

export type Light = { x: number; y: number; r: number; hue: Hue; flick: number; a: number };
export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Terrain = {
  ground: HTMLCanvasElement;
  /** Which land each pixel belongs to; 255 is open sea. */
  landId: Uint8Array;
  /** What each pixel is, for how it answers a tap. */
  kind: Uint8Array;
  lights: Light[];
  /** Water pixels that may catch the light. */
  glints: Pt[];
  bounds: Box[];
};
export const KIND = { sea: 0, river: 1, sand: 2, grass: 3, forest: 4, road: 5, rock: 6 } as const;

const CW = (W >> 2) + 2;
const CH = (H >> 2) + 2;
/** A slow-changing field worked out every fourth pixel and read back smoothly: sixteen times cheaper. */
function coarse(fn: (x: number, y: number) => number): Float32Array {
  const a = new Float32Array(CW * CH);
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) a[cy * CW + cx] = fn(cx * 4, cy * 4);
  return a;
}
function samp(a: Float32Array, x: number, y: number): number {
  const fx = x / 4;
  const fy = y / 4;
  const x0 = fx | 0;
  const y0 = fy | 0;
  const tx = fx - x0;
  const ty = fy - y0;
  const i = y0 * CW + x0;
  const p = a[i] as number;
  const q = a[i + 1] as number;
  const r = a[i + CW] as number;
  const s = a[i + CW + 1] as number;
  return p + (q - p) * tx + (r + (s - r) * tx - (p + (q - p) * tx)) * ty;
}
const bump = (x: number, y: number, cx: number, cy: number, r: number): number => {
  const d = Math.hypot(x - cx, y - cy) / r;
  return d >= 1 ? 0 : (1 - d * d) * (1 - d * d);
};
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const FOREST = 0.5;

export function buildTerrain(): Terrain {
  const [ground, g] = makeCanvas(W, H);
  const size = W * H;
  const riv = new Uint8Array(size);
  const road = new Uint8Array(size);
  const block = new Uint8Array(size);
  const flat = new Float32Array(size);
  const sea = new Float32Array(size);
  const level = new Uint8Array(size);
  const kind = new Uint8Array(size);
  const landId = new Uint8Array(size).fill(255);
  const lights: Light[] = [];

  const disc = (arr: Uint8Array, cx: number, cy: number, r: number, v: number): void => {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(H - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r && (arr[i] as number) < v) arr[i] = v;
      }
  };
  const soft = (cx: number, cy: number, r: number): void => {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(H - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const v = 1 - Math.hypot(x - cx, y - cy) / r;
        const i = y * W + x;
        if (v > (flat[i] as number)) flat[i] = v;
      }
  };

  // ---------- water and roads, as masks ----------

  const river = smoothLine(RIVER, 2);
  river.forEach((p, n) => {
    const t = n / river.length;
    const r = 3 + 3.6 * t + noise(n * 0.08, 0, 2) * 1.4;
    disc(riv, p.x, p.y, r, 1);
    disc(block, p.x, p.y, r + 5, 1);
    if (n % 3 === 0) soft(p.x, p.y, 20);
  });
  for (let y = POND.y - POND.ry - 3; y <= POND.y + POND.ry + 3; y++)
    for (let x = POND.x - POND.rx - 3; x <= POND.x + POND.rx + 3; x++) {
      const d =
        ((x - POND.x) / POND.rx) ** 2 + ((y - POND.y) / POND.ry) ** 2 + (noise(x * 0.2, y * 0.2, 8) - 0.5) * 0.4;
      if (d < 1) riv[y * W + x] = 2;
    }
  disc(block, POND.x, POND.y, 34, 1);

  for (const e of EDGES) {
    const town = e.len < 60;
    const core = e.main ? 2.1 : town ? 1.6 : 1.35;
    e.pts.forEach((p, n) => {
      const wet = riv[Math.round(p.y) * W + Math.round(p.x)] === 1;
      disc(road, p.x, p.y, core + (wet ? 2 : 1), 1);
      disc(road, p.x, p.y, core + (wet ? 1 : 0), 2);
      disc(block, p.x, p.y, 7, 1);
      if (n % 3 === 0) soft(p.x, p.y, 26);
    });
  }
  // Trodden ground where people gather.
  const apron = (x: number, y: number, r: number): void => {
    disc(road, x, y, r + 1, 1);
    disc(road, x, y, r, 2);
    disc(block, x, y, r + 8, 1);
    soft(x, y, r + 30);
  };
  apron(NODES.town.x, NODES.town.y, 15);
  apron(NODES.treasury.x, NODES.treasury.y, 5);
  apron(NODES.board.x, NODES.board.y, 5);
  apron(NODES.market.x, NODES.market.y - 1, 9);
  apron(FIRE.x, FIRE.y + 2, 11);
  apron(NODES.works.x, NODES.works.y - 2, 9);
  apron(NODES.camp.x - 2, NODES.camp.y, 10);
  apron(NODES.pond.x, NODES.pond.y, 4);
  apron(NODES.mill.x, NODES.mill.y - 2, 5);
  for (const id of ["gateA", "gateB", "gateC"] as const) apron(NODES[id].x, NODES[id].y - 2, 7);
  for (const id of ["otter", "stonering", "bracken", "reed"] as const) apron(NODES[id].x, NODES[id].y, 5);
  for (const l of LANDS) disc(block, l.bx, l.by, 7, 1);
  disc(block, MILL.x - 8, MILL.y + 14, 42, 1);
  disc(block, LIGHTHOUSE.x, LIGHTHOUSE.y, 12, 1);
  disc(block, STONES.x, STONES.y, 22, 1);
  disc(block, WORKS.x, WORKS.y - 10, 34, 1);
  disc(block, CAMP.x + 8, CAMP.y, 34, 1);
  disc(block, NODES.town.x, NODES.town.y - 4, 86, 1);
  for (const gate of Object.values(GATES)) disc(block, gate.x, gate.y - 6, 22, 1);

  // ---------- the shape of the land ----------

  const seaN = coarse((x, y) => fbm(x * 0.006, y * 0.006, 11, 3) - 0.5);
  const elevN = coarse((x, y) => fbm(x * 0.006, y * 0.006, 3, 2));
  const forestN = coarse((x, y) => fbm(x * 0.012, y * 0.012, 21, 3));
  const warpX = coarse((x, y) => (fbm(x * 0.013, y * 0.013, 31, 2) - 0.5) * 84);
  const warpY = coarse((x, y) => (fbm(x * 0.013, y * 0.013, 37, 2) - 0.5) * 84);

  const seaAt = (x: number, y: number): number => {
    let v = (x - 908) / 70 + samp(seaN, x, y) * 1.7;
    v += Math.max(0, 1 - Math.hypot(x - 968, (y - 706) * 1.1) / 236) * 1.5;
    v -= Math.max(0, 1 - Math.hypot(x - 884, y - 116) / 124) * 1.0;
    v += Math.max(0, 1 - Math.hypot(x - 912, (y - 524) * 1.3) / 74) * 0.85;
    v -= bump(x, y, 978, 322, 44) * 2.3;
    v -= bump(x, y, 1002, 590, 26) * 1.6;
    v += bump(x, y, 880, 392, 46) * 0.5;
    return v;
  };
  const forestAt = (x: number, y: number): number => {
    let f = samp(forestN, x, y);
    if (y < 210) f += 0.07;
    if (x < 230) f += 0.05;
    const dg = Math.hypot(x - 500, y - 342);
    if (dg > 84 && dg < 196) f += 0.14 * (1 - Math.abs(dg - 140) / 56);
    f -= bump(x, y, 116, 284, 104) * 0.5;
    f -= bump(x, y, 474, 566, 86) * 0.42;
    f -= bump(x, y, 652, 446, 98) * 0.36;
    f -= bump(x, y, 838, 300, 92) * 0.3;
    f -= bump(x, y, 100, 440, 60) * 0.3;
    return f;
  };

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const sv = seaAt(x, y);
      sea[i] = sv;
      if (sv > -0.1 || riv[i]) continue;
      let e =
        samp(elevN, x, y) * 0.4 +
        bump(x, y, 150, 100, 236) * 0.62 +
        bump(x, y, 724, 36, 214) * 0.52 +
        bump(x, y, 46, 566, 176) * 0.4 +
        bump(x, y, 600, 92, 150) * 0.2 +
        bump(x, y, 880, 250, 110) * 0.3;
      e *= 1 - 0.85 * Math.min(1, (flat[i] as number) * 1.5);
      e *= Math.min(1, -sv * 2.2);
      level[i] = e < 0.45 ? 0 : e < 0.6 ? 1 : e < 0.76 ? 2 : 3;
    }

  // ---------- whose land ----------

  const bounds: Box[] = LANDS.map(() => ({ x0: W, y0: H, x1: 0, y1: 0 }));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if ((sea[i] as number) > 0.03) continue;
      const wx = x + samp(warpX, x, y);
      const wy = y + samp(warpY, x, y);
      let best = 0;
      let bd = Number.POSITIVE_INFINITY;
      for (let n = 0; n < LANDS.length; n++) {
        const l = LANDS[n] as (typeof LANDS)[number];
        const d = (wx - l.x) * (wx - l.x) + (wy - l.y) * (wy - l.y);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      landId[i] = best;
      const b = bounds[best] as Box;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }

  // ---------- every pixel of ground ----------

  const img = g.createImageData(W, H);
  const data = img.data;
  const put = (i: number, c: number): void => {
    const o = i * 4;
    data[o] = c >> 16;
    data[o + 1] = (c >> 8) & 255;
    data[o + 2] = c & 255;
    data[o + 3] = 255;
  };
  const GREEN = [rgb(P.g0), rgb(P.g1), rgb(P.g2), rgb(P.g3), rgb(P.g4)];
  const STONE = [rgb(P.s3), rgb(P.s2), rgb(P.s1), rgb(P.s0)];
  const WATER = [rgb(P.w0), rgb(P.w1), rgb(P.w2), rgb(P.w3), rgb(P.w4)];
  const FLOWER = [rgb(P.rose), rgb(P.gold2), rgb(P.cream)];
  const c = {
    sand0: rgb(P.sand0),
    sand1: rgb(P.sand1),
    sand2: rgb(P.sand2),
    e0: rgb(P.e0),
    e1: rgb(P.e1),
    e2: rgb(P.e2),
    dust: rgb("#b0855c"),
    plank0: rgb(P.bark0),
    plank1: rgb(P.bark2),
    plank2: rgb(P.bark4),
    foam: rgb("#d6ecf2"),
    deepGreen: rgb("#1c3a26"),
    cliffFoot: rgb("#3a3040"),
  };

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const sv = sea[i] as number;
      const rd = road[i] as number;
      const water = riv[i] as number;
      const grain = hash2(x, y, 9);
      const bay = (BAYER[(x & 3) + ((y & 3) << 2)] as number) / 16 - 0.5;

      if (rd > 0 && water === 1) {
        // A bridge: planks across, a dark rail either side.
        kind[i] = KIND.road;
        put(i, rd === 1 ? c.plank0 : (x + y * 2) % 3 === 0 ? c.plank1 : c.plank2);
        continue;
      }
      if (sv > 0) {
        kind[i] = KIND.sea;
        const v = sv + bay * 0.035;
        const dash = hash2(Math.floor(x / 3), y, 6) > 0.955;
        let tone: number;
        if (v < 0.035) tone = hash2(x >> 1, y, 4) > 0.45 ? c.foam : (WATER[3] as number);
        else if (v < 0.17) tone = WATER[dash ? 4 : 3] as number;
        else if (v < 0.44) tone = WATER[dash ? 3 : 2] as number;
        else if (v < 0.95) tone = WATER[dash ? 2 : 1] as number;
        else tone = WATER[dash ? 1 : 0] as number;
        put(i, tone);
        continue;
      }
      if (water) {
        kind[i] = KIND.river;
        const edge =
          !riv[i - 1] || !riv[i + 1] || !riv[i - W] || !riv[i + W]
            ? (sea[i + 1] as number) > 0
              ? false
              : true
            : false;
        if (edge) put(i, WATER[1] as number);
        else if (water === 2) put(i, WATER[hash2(x >> 2, y, 3) > 0.8 ? 4 : 3] as number);
        else put(i, WATER[hash2(x >> 1, y >> 2, 3) > 0.78 ? 3 : 2] as number);
        continue;
      }
      if (rd > 0) {
        kind[i] = KIND.road;
        if (rd === 2) put(i, grain > 0.86 ? c.dust : grain < 0.12 ? c.e1 : c.e2);
        else put(i, grain < 0.34 ? c.e0 : c.e1);
        continue;
      }
      const pondSand = ((x - POND.x) / (POND.rx * 1.75)) ** 2 + ((y - POND.y) / (POND.ry * 2.1)) ** 2 < 1 + bay * 0.3;
      if (sv > -0.13 + bay * 0.03 || pondSand) {
        kind[i] = KIND.sand;
        put(i, sv > -0.022 ? c.sand0 : grain > 0.8 ? c.sand2 : grain < 0.07 ? c.sand0 : c.sand1);
        continue;
      }

      const lv = level[i] as number;
      let k = 1;
      for (; k <= 8; k++) if (y - k < 0 || (level[i - k * W] as number) > lv) break;
      if (y - k < 0) k = 9;
      if (k <= 6) {
        // The face of a terrace, lit at the top and dark at the foot.
        kind[i] = KIND.rock;
        const crack = hash2(x, 3, 7) > 0.76 ? 1 : 0;
        const tone = k === 1 ? 0 : k <= 3 ? 1 : k <= 5 ? 2 : 3;
        if (k > 1 && k < 6 && hash2(x, y, 15) > 0.93) put(i, GREEN[1] as number);
        else put(i, k === 6 ? c.cliffFoot : (STONE[Math.min(3, tone + crack)] as number));
        continue;
      }
      const fo = forestAt(x, y) > FOREST;
      kind[i] = fo ? KIND.forest : KIND.grass;
      const n1 = noise(x * 0.04, y * 0.04, 5) + bay * 0.1;
      let gi = n1 > 0.64 ? 3 : n1 < 0.3 ? 1 : 2;
      if (lv >= 2) gi++;
      if (fo) gi -= 1;
      if (k <= 8) gi -= 2;
      if (y + 1 < H && (level[i + W] as number) < lv) gi++;
      if (x > 0 && (level[i - 1] as number) < lv) gi++;
      if (x + 1 < W && (level[i + 1] as number) < lv) gi -= 2;
      if (riv[i - 1] || riv[i + 1] || riv[i - W] || riv[i + W]) gi = 0;
      if (grain < 0.012) gi++;
      if (!fo && grain > 0.9968) {
        put(i, FLOWER[Math.floor(hash2(x, y, 10) * 3)] as number);
        continue;
      }
      put(i, gi < 0 ? c.deepGreen : (GREEN[Math.min(4, gi)] as number));
    }
  g.putImageData(img, 0, 0);

  // ---------- things standing on the ground, back to front ----------

  const R = (x: number, y: number, w: number, h: number, col: string): void => {
    g.fillStyle = col;
    g.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const SHADE = "rgba(26,15,30,0.3)";
  const items: { y: number; draw: () => void }[] = [];
  const shadows: (() => void)[] = [];
  const light = (x: number, y: number, r: number, hue: Hue, a = 0.5): void => {
    lights.push({ x, y, r, hue, flick: hash2(x, y, 71) * 6.28, a });
  };

  const sprite = (s: HTMLCanvasElement, x: number, y: number): void => {
    shadows.push(() => {
      const w = s.width;
      R(x - (w >> 1) + 2, y - 1, w - 1, 2, SHADE);
      R(x - (w >> 1) + 4, y + 1, w - 4, 1, SHADE);
    });
    items.push({ y, draw: () => g.drawImage(s, x - (s.width >> 1), y - s.height + 1) });
  };

  // Woods: an even scatter, thick where the forest noise is high, so they read as stands, not dots.
  for (let gy = 6; gy < H; gy += 7)
    for (let gx = 4; gx < W; gx += 8) {
      const x = Math.round(gx + (hash2(gx, gy, 41) - 0.5) * 6 + ((gy / 7) & 1) * 4);
      const y = Math.round(gy + (hash2(gx, gy, 43) - 0.5) * 5);
      if (x < 2 || x >= W - 2 || y < 8 || y >= H) continue;
      const i = y * W + x;
      const here = kind[i] as number;
      if (here !== KIND.grass && here !== KIND.forest) continue;
      if (block[i] || block[i - 8 * W]) continue;
      if (kind[i - 2 * W] === KIND.rock || kind[i + W] === KIND.rock) continue;
      const f = forestAt(x, y);
      const r = hash2(gx, gy, 47);
      const r2 = hash2(gx, gy, 53);
      const inWood = f > FOREST;
      if (inWood ? r > 0.94 : r > 0.04) continue;
      const lv = level[i] as number;
      const ashen = y > 640 + (samp(warpY, x, y) - samp(warpX, x, y)) * 0.5 && x < 640;
      const deep = f > FOREST + 0.07 && r2 > 0.4;
      const pine = r2 < Math.min(0.88, Math.max(0.1, 0.78 - (y - 140) / 520) + (lv > 0 ? 0.25 : 0));
      const big = hash2(gx, gy, 59) < 0.62;
      let s: HTMLCanvasElement;
      if (ashen) s = pine ? TREES.emberPine : big ? TREES.emberL : TREES.emberS;
      else if (!inWood) s = r2 < 0.34 ? TREES.bush : r2 < 0.7 ? TREES.leafS : TREES.pineS;
      else if (pine) s = big ? (deep ? TREES.pineLDeep : TREES.pineL) : deep ? TREES.pineSDeep : TREES.pineS;
      else s = big ? (deep ? TREES.leafLDeep : TREES.leafL) : TREES.leafS;
      sprite(s, x, y);
    }
  // A few rocks on the heights and along the shore.
  for (let n = 0; n < 900; n++) {
    const x = Math.floor(hash2(n, 1, 61) * (W - 8)) + 4;
    const y = Math.floor(hash2(n, 2, 61) * (H - 8)) + 6;
    const i = y * W + x;
    if (block[i]) continue;
    const here = kind[i] as number;
    const high = (level[i] as number) >= 2 && here !== KIND.rock;
    const shore = here === KIND.sand && hash2(n, 3, 61) < 0.25;
    const shoal = here === KIND.sea && (sea[i] as number) < 0.3 && hash2(n, 3, 61) < 0.1;
    if (!high && !shore && !shoal) continue;
    if (high && hash2(n, 4, 61) > 0.35) continue;
    sprite(hash2(n, 5, 61) < 0.5 ? TREES.rockA : TREES.rockB, x, y);
  }

  // ----- buildings -----

  const house = (
    x: number,
    y: number,
    w: number,
    wall: number,
    roof: number,
    rc: readonly [string, string, string],
    wc: readonly [string, string, string],
  ): void => {
    const x0 = Math.round(x - w / 2);
    const top = y - wall - roof;
    shadows.push(() => R(x0 + 2, y, w + 3, 2, SHADE));
    items.push({
      y,
      draw: () => {
        R(x0 + w, y - wall + 1, 2, wall - 1, SHADE);
        R(x0, y - wall, w, wall, wc[1]);
        R(x0, y - wall, 1, wall, wc[0]);
        R(x0 + w - 1, y - wall, 1, wall, wc[2]);
        for (let r = 0; r < roof; r++) {
          const inset = Math.max(0, 2 - r);
          R(x0 - 1 + inset, top + r, w + 2 - inset * 2, 1, r === 0 ? rc[0] : r % 3 === 2 ? rc[2] : rc[1]);
          R(x0 - 1 + inset, top + r, 1, 1, rc[0]);
        }
        R(x0 - 1, top + roof, w + 2, 1, P.ink);
        R(x0 + (w >> 1) - 1, y - 5, 3, 5, P.bark0);
        R(x0 + 2, y - wall + 2, 3, 3, P.gold2);
        R(x0 + 3, y - wall + 3, 1, 1, P.cream);
        if (w >= 16) {
          R(x0 + w - 5, y - wall + 2, 3, 3, P.gold2);
          R(x0 + w - 4, y - wall + 3, 1, 1, P.cream);
        }
        // A chimney on the far slope.
        R(x0 + w - 5, top - 2, 2, 4, P.s1);
        R(x0 + w - 5, top - 2, 1, 4, P.s3);
      },
    });
    light(x0 + 3, y - wall + 3, 9, "amber", 0.42);
    if (w >= 16) light(x0 + w - 4, y - wall + 3, 9, "amber", 0.42);
  };
  const PLUM_ROOF = [P.plum3, P.plum2, P.plum1] as const;
  const BARK_ROOF = [P.bark4, P.bark3, P.bark1] as const;
  const ROSE_ROOF = [P.coral, P.rose, P.plum2] as const;
  const PLASTER = [P.cream, "#e6cfa3", "#c4a274"] as const;
  const TIMBER = [P.bark4, P.bark3, P.bark2] as const;
  const STONEWALL = [P.s3, P.s2, P.s1] as const;

  house(436, 318, 18, 8, 8, BARK_ROOF, PLASTER);
  house(572, 322, 18, 8, 8, PLUM_ROOF, PLASTER);
  house(446, 382, 16, 7, 7, ROSE_ROOF, TIMBER);
  house(566, 400, 18, 8, 8, BARK_ROOF, STONEWALL);
  house(544, 290, 14, 7, 7, PLUM_ROOF, TIMBER);
  house(602, 364, 16, 7, 7, ROSE_ROOF, PLASTER);
  house(420, 370, 14, 7, 6, PLUM_ROOF, STONEWALL);
  house(520, 404, 14, 7, 6, BARK_ROOF, PLASTER);
  house(106, 262, 16, 7, 7, BARK_ROOF, PLASTER);
  house(730, 316, 14, 7, 6, BARK_ROOF, STONEWALL);

  // The Treasury: stone, a plum pediment trimmed in gold, a round gold door with a leaf on it.
  {
    const { x, y } = TREASURY;
    const x0 = x - 15;
    shadows.push(() => R(x0 + 2, y, 33, 2, SHADE));
    items.push({
      y,
      draw: () => {
        R(x0 + 30, y - 13, 2, 12, SHADE);
        R(x0, y - 14, 30, 13, P.s2);
        R(x0, y - 14, 2, 13, P.s3);
        R(x0 + 28, y - 14, 2, 13, P.s0);
        for (const yy of [y - 11, y - 7, y - 4]) R(x0 + 2, yy, 26, 1, P.s1);
        for (const xx of [x0 + 4, x0 + 23]) {
          R(xx, y - 14, 3, 13, P.cream);
          R(xx + 2, y - 14, 1, 13, "#d9c79d");
        }
        R(x0 - 1, y - 1, 32, 2, P.s0);
        R(x0 + 1, y - 2, 28, 1, P.s3);
        R(x - 4, y - 10, 8, 9, P.gold0);
        R(x - 3, y - 11, 6, 1, P.gold0);
        R(x - 3, y - 10, 6, 8, P.gold1);
        R(x - 2, y - 9, 4, 6, P.bark0);
        R(x - 1, y - 8, 2, 2, P.g4);
        R(x, y - 6, 1, 2, P.g3);
        for (let r = 0; r < 10; r++) {
          const half = Math.round(17 - r * 1.7);
          R(x - half, y - 15 - r, half * 2, 1, r % 3 === 2 ? P.plum1 : P.plum2);
          R(x - half, y - 15 - r, 2, 1, P.gold1);
          R(x + half - 2, y - 15 - r, 2, 1, P.gold0);
        }
        R(x - 17, y - 15, 34, 1, P.gold1);
        R(x - 17, y - 14, 34, 1, P.ink);
        R(x - 3, y - 27, 6, 3, P.gold1);
        R(x - 2, y - 28, 4, 1, P.gold2);
        R(x - 1, y - 31, 2, 3, P.gold2);
        R(x - 3, y - 25, 6, 1, P.gold0);
      },
    });
    light(x, y - 6, 18, "amber", 0.5);
    light(x, y - 29, 8, "amber", 0.4);
  }

  // The Works: a timber hall on a stone footing, a forge door that glows, a tall stack.
  {
    const { x, y } = WORKS;
    const x0 = x - 20;
    shadows.push(() => R(x0 + 2, y, 44, 2, SHADE));
    items.push({
      y,
      draw: () => {
        R(x + 10, y - 44, 7, 30, P.s1);
        R(x + 10, y - 44, 2, 30, P.s3);
        R(x + 15, y - 44, 2, 30, P.s0);
        R(x + 9, y - 46, 9, 3, P.s2);
        R(x + 9, y - 46, 9, 1, P.s3);
        R(x + 10, y - 37, 7, 1, P.s0);
        R(x0 + 40, y - 14, 3, 13, SHADE);
        R(x0, y - 15, 40, 15, P.bark3);
        R(x0, y - 15, 2, 15, P.bark4);
        R(x0 + 38, y - 15, 2, 15, P.bark1);
        for (const xx of [x0 + 9, x0 + 30]) R(xx, y - 15, 1, 11, P.bark1);
        R(x0, y - 4, 40, 4, P.s1);
        R(x0, y - 4, 40, 1, P.s3);
        R(x - 7, y - 12, 14, 12, P.bark0);
        R(x - 6, y - 11, 12, 11, P.coral);
        R(x - 5, y - 9, 10, 9, P.amber);
        R(x - 3, y - 6, 6, 6, P.gold2);
        R(x - 1, y - 3, 2, 3, P.cream);
        R(x0 + 3, y - 11, 4, 4, P.gold2);
        R(x0 + 33, y - 11, 4, 4, P.gold2);
        for (let r = 0; r < 14; r++) {
          const inset = Math.max(0, 3 - r);
          R(
            x0 - 2 + inset,
            y - 29 + r,
            44 - inset * 2,
            1,
            r === 0 ? P.bark4 : r % 3 === 2 ? P.bark0 : r % 3 === 1 ? P.bark1 : P.bark2,
          );
          R(x0 - 2 + inset, y - 29 + r, 1, 1, P.bark4);
        }
        R(x0 - 2, y - 15, 44, 1, P.ink);
        // The cog over the door.
        R(x - 1, y - 27, 3, 9, P.s2);
        R(x - 4, y - 24, 9, 3, P.s2);
        R(x - 3, y - 26, 7, 7, P.s3);
        R(x - 1, y - 24, 3, 3, P.gold1);
        // Crates and a barrel by the wall.
        R(x0 - 9, y - 6, 6, 6, P.bark4);
        R(x0 - 9, y - 6, 6, 1, P.gold0);
        R(x0 - 9, y - 3, 6, 1, P.bark2);
        R(x0 - 15, y - 4, 5, 4, P.bark3);
        R(x0 - 15, y - 4, 5, 1, P.bark4);
        R(x0 + 43, y - 6, 4, 6, P.bark2);
        R(x0 + 43, y - 5, 4, 1, P.s3);
        R(x0 + 43, y - 2, 4, 1, P.s3);
      },
    });
    light(x, y - 4, 26, "coral", 0.62);
    light(x0 + 5, y - 9, 9, "amber", 0.4);
    light(x0 + 35, y - 9, 9, "amber", 0.4);
  }

  // The quest board.
  {
    const x = 534;
    const y = 314;
    shadows.push(() => R(x - 6, y, 15, 1, SHADE));
    items.push({
      y,
      draw: () => {
        R(x - 7, y - 12, 1, 12, P.bark1);
        R(x + 6, y - 12, 1, 12, P.bark1);
        R(x - 8, y - 13, 16, 9, P.bark1);
        R(x - 7, y - 12, 14, 7, P.bark3);
        R(x - 6, y - 11, 3, 4, P.cream);
        R(x - 2, y - 11, 4, 3, P.gold2);
        R(x + 3, y - 11, 3, 5, P.cream);
        R(x - 5, y - 11, 1, 1, P.coral);
        R(x, y - 11, 1, 1, P.coral);
        R(x + 4, y - 11, 1, 1, P.coral);
        R(x - 9, y - 15, 18, 2, P.plum2);
        R(x - 8, y - 16, 16, 1, P.plum3);
      },
    });
  }

  // Market stalls under striped awnings.
  const stall = (x: number, y: number, c1: string, c2: string, c3: string): void => {
    shadows.push(() => R(x - 5, y, 14, 1, SHADE));
    items.push({
      y,
      draw: () => {
        R(x - 6, y - 9, 1, 9, P.bark1);
        R(x + 5, y - 9, 1, 9, P.bark1);
        R(x - 6, y - 4, 12, 4, P.bark2);
        R(x - 6, y - 4, 12, 1, P.bark4);
        R(x - 4, y - 6, 2, 2, P.coral);
        R(x - 1, y - 6, 2, 2, P.gold1);
        R(x + 2, y - 6, 2, 2, P.g4);
        for (let k = 0; k < 14; k++) R(x - 7 + k, y - 13, 1, 4, (k >> 1) & 1 ? c2 : c1);
        for (let k = 0; k < 14; k += 2) R(x - 7 + k, y - 9, 1, 1, (k >> 1) & 1 ? c2 : c3);
        R(x - 7, y - 14, 14, 1, c3);
      },
    });
  };
  stall(538, 358, P.coral, P.cream, P.rose);
  stall(554, 355, P.g4, P.cream, P.g2);
  stall(570, 360, P.gold1, P.plum2, P.gold0);

  // The campfire's ring of stones and the logs to sit on.
  {
    const { x, y } = FIRE;
    items.push({
      y: y - 6,
      draw: () => {
        R(x - 4, y - 1, 8, 4, P.s0);
        R(x - 5, y, 10, 2, P.s1);
        R(x - 3, y, 6, 2, P.bark0);
        R(x - 5, y, 2, 1, P.s3);
        R(x - 2, y - 1, 3, 1, P.s3);
        R(x - 16, y - 2, 2, 7, P.bark2);
        R(x - 16, y - 2, 1, 7, P.bark4);
        R(x + 14, y - 2, 2, 7, P.bark2);
        R(x + 14, y - 2, 1, 7, P.bark3);
        R(x - 5, y + 11, 10, 2, P.bark2);
        R(x - 5, y + 11, 10, 1, P.bark4);
        R(x - 4, y - 11, 8, 2, P.bark2);
        R(x - 4, y - 11, 8, 1, P.bark4);
      },
    });
    light(x, y - 2, 40, "amber", 0.75);
  }

  // The poles of the lantern rope.
  for (const [px, py] of [
    [ROPE.ax, ROPE.ay],
    [ROPE.bx, ROPE.by],
  ] as const) {
    shadows.push(() => R(px, py + 17, 5, 1, SHADE));
    items.push({
      y: py + 17,
      draw: () => {
        R(px, py, 1, 17, P.bark1);
        R(px - 1, py + 16, 3, 1, P.bark0);
        R(px - 1, py - 1, 3, 1, P.gold0);
      },
    });
  }

  // Raid gates: an arch of old stone, dark inside until the light is drawn over it.
  for (const gate of Object.values(GATES)) {
    const { x, y } = gate;
    const tint = gate.hue === "violet" ? P.rose : gate.hue === "teal" ? P.teal : P.coral;
    shadows.push(() => R(x - 10, y + 1, 26, 2, SHADE));
    items.push({
      y,
      draw: () => {
        R(x - 13, y - 2, 26, 3, P.s0);
        R(x - 12, y - 3, 24, 1, P.s2);
        R(x - 11, y - 21, 5, 19, P.s1);
        R(x - 11, y - 21, 1, 19, P.s3);
        R(x - 7, y - 21, 1, 19, P.s0);
        R(x + 6, y - 21, 5, 19, P.s1);
        R(x + 6, y - 21, 1, 19, P.s2);
        R(x + 10, y - 21, 1, 19, P.s0);
        R(x - 11, y - 24, 22, 3, P.s1);
        R(x - 9, y - 26, 18, 2, P.s1);
        R(x - 6, y - 27, 12, 1, P.s2);
        R(x - 9, y - 26, 18, 1, P.s2);
        R(x - 11, y - 24, 1, 3, P.s3);
        R(x - 6, y - 21, 12, 19, P.plum0);
        R(x - 5, y - 23, 10, 2, P.plum0);
        R(x - 1, y - 27, 3, 3, tint);
        R(x - 10, y - 14, 1, 1, tint);
        R(x + 9, y - 10, 1, 1, tint);
        R(x - 9, y - 7, 1, 1, tint);
        R(x - 11, y - 18, 2, 1, P.g2);
        R(x + 7, y - 24, 3, 1, P.g2);
        // Braziers either side.
        for (const bx of [x - 18, x + 16]) {
          R(bx, y - 6, 1, 6, P.s0);
          R(bx - 1, y - 7, 3, 1, P.s2);
        }
      },
    });
    light(x, y - 12, 30, gate.hue, 0.6);
    light(x - 18, y - 9, 8, "amber", 0.5);
    light(x + 16, y - 9, 8, "amber", 0.5);
  }

  // The member's camp: a striped tent, a log, a woodpile, and the pole their flag flies from.
  {
    const { x, y } = CAMP;
    shadows.push(() => R(x - 9, y, 24, 2, SHADE));
    items.push({
      y,
      draw: () => {
        for (let r = 0; r < 15; r++) {
          const half = Math.round(((r + 1) * 12) / 15);
          const stripe = r % 4 === 3;
          R(x - half, y - 15 + r, half, 1, stripe ? P.plum3 : P.cream);
          R(x, y - 15 + r, half, 1, stripe ? P.plum2 : "#dcc596");
        }
        for (let r = 6; r < 15; r++) {
          const half = Math.round(((r - 5) * 4) / 9);
          R(x - half, y - 15 + r, half * 2, 1, P.plum0);
        }
        R(x, y - 18, 1, 4, P.bark1);
        R(CAMP.flagX, CAMP.flagY - 17, 1, 17, P.bark1);
        R(CAMP.flagX - 1, CAMP.flagY - 1, 3, 1, P.bark0);
        R(x + 34, y + 10, 8, 2, P.bark2);
        R(x + 34, y + 10, 8, 1, P.bark4);
        R(x + 15, y - 3, 5, 3, P.bark3);
        R(x + 16, y - 5, 3, 2, P.bark4);
      },
    });
    items.push({
      y: CAMP.fireY,
      draw: () => {
        R(CAMP.fireX - 3, CAMP.fireY - 1, 6, 2, P.s1);
        R(CAMP.fireX - 2, CAMP.fireY - 1, 4, 1, P.bark0);
        R(CAMP.fireX - 3, CAMP.fireY - 1, 1, 1, P.s3);
      },
    });
    light(CAMP.fireX, CAMP.fireY - 3, 22, "amber", 0.6);
  }

  // The windmill and its fields.
  {
    const { x, y } = MILL;
    shadows.push(() => R(x - 3, y, 12, 2, SHADE));
    for (const [fx, fy, fw, fh] of [
      [84, 274, 30, 13],
      [118, 280, 22, 15],
      [88, 292, 26, 12],
    ] as const)
      shadows.push(() => {
        R(fx - 1, fy - 1, fw + 2, fh + 2, P.e0);
        for (let r = 0; r < fh; r++) R(fx, fy + r, fw, 1, r % 3 === 0 ? P.e1 : r % 3 === 1 ? P.gold1 : P.gold0);
      });
    items.push({
      y,
      draw: () => {
        for (let r = 0; r < 22; r++) {
          const half = Math.round(4 + (r / 21) * 2);
          R(x - half, y - 22 + r, half * 2, 1, P.cream);
          R(x + half - 2, y - 22 + r, 2, 1, "#c4a274");
          R(x - half, y - 22 + r, 1, 1, "#ffffff");
        }
        R(x - 1, y - 5, 3, 5, P.bark1);
        R(x - 1, y - 14, 2, 3, P.plum1);
        R(x - 5, y - 25, 10, 3, P.bark2);
        R(x - 4, y - 27, 8, 2, P.bark3);
      },
    });
  }

  // The lighthouse on the head.
  {
    const { x, y } = LIGHTHOUSE;
    shadows.push(() => R(x - 2, y, 10, 2, SHADE));
    items.push({
      y,
      draw: () => {
        for (let r = 0; r < 24; r++) {
          const wide = r > 18 ? 1 : 0;
          R(x - 3 - wide, y - 24 + r, 7 + wide * 2, 1, (r >> 2) & 1 ? P.coral : P.cream);
          R(x + 2 + wide, y - 24 + r, 1, 1, (r >> 2) & 1 ? P.rose : "#c4a274");
        }
        R(x - 3, y - 29, 7, 5, P.gold2);
        R(x - 2, y - 28, 5, 3, P.cream);
        R(x - 4, y - 30, 9, 1, P.plum1);
        R(x - 4, y - 24, 9, 1, P.plum1);
        R(x - 2, y - 32, 5, 2, P.plum2);
        R(x, y - 34, 1, 2, P.plum2);
        R(x - 1, y - 5, 2, 5, P.bark0);
      },
    });
    light(x, y - 27, 30, "amber", 0.7);
  }

  // Standing stones in a ring.
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * 6.283 + 0.3;
    const sx = Math.round(STONES.x + Math.cos(a) * 13);
    const sy = Math.round(STONES.y + Math.sin(a) * 7);
    const tall = 5 + (k % 3);
    shadows.push(() => R(sx, sy, 5, 1, SHADE));
    items.push({
      y: sy,
      draw: () => {
        R(sx - 1, sy - tall, 3, tall, P.s1);
        R(sx - 1, sy - tall, 1, tall, P.s3);
        R(sx + 1, sy - tall + 1, 1, tall - 1, P.s0);
      },
    });
  }

  // A crab-shaped sign by the pond, and fingerposts where the roads fork.
  items.push({
    y: 510,
    draw: () => {
      R(790, 502, 1, 8, P.bark1);
      R(786, 499, 9, 5, P.bark3);
      R(786, 499, 9, 1, P.bark4);
      R(788, 501, 5, 2, P.coral);
      R(787, 500, 1, 1, P.coral);
      R(793, 500, 1, 1, P.coral);
    },
  });
  for (const [sx, sy] of [
    [306, 262],
    [528, 212],
    [778, 406],
    [504, 410],
  ] as const)
    items.push({
      y: sy,
      draw: () => {
        R(sx, sy - 8, 1, 8, P.bark1);
        R(sx - 3, sy - 8, 6, 2, P.bark4);
        R(sx - 1, sy - 5, 5, 2, P.bark3);
      },
    });

  // Lamps along the main roads, a little way apart and on alternate sides.
  let lampSide = 1;
  for (const e of EDGES) {
    if (!e.main) continue;
    for (let s = 26; s < e.len - 14; s += 46) {
      const k = e.cum.findIndex((c) => c >= s);
      const p = e.pts[k] as Pt;
      const q = e.pts[Math.max(0, k - 1)] as Pt;
      const len = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      lampSide = -lampSide;
      const x = Math.round(p.x - ((p.y - q.y) / len) * 6 * lampSide);
      const y = Math.round(p.y + ((p.x - q.x) / len) * 6 * lampSide);
      const i = y * W + x;
      if (riv[i] || road[i] || Math.hypot(x - NODES.town.x, y - NODES.town.y) < 26) continue;
      shadows.push(() => R(x, y, 4, 1, SHADE));
      items.push({
        y,
        draw: () => {
          R(x, y - 8, 1, 8, P.bark0);
          R(x - 1, y - 11, 3, 3, P.gold1);
          R(x, y - 10, 1, 1, P.cream);
          R(x - 1, y - 12, 3, 1, P.bark0);
        },
      });
      light(x + 0.5, y - 9, 12, "amber", 0.55);
    }
  }

  // A compass rose in the corner of the sea.
  shadows.push(() => {
    const cx = 992;
    const cy = 694;
    for (let d = 1; d <= 11; d++) {
      const w = d < 4 ? 2 : d < 8 ? 1 : 0;
      R(cx - w, cy - d, w + 1, 1, P.gold2);
      R(cx + 1, cy - d, w, 1, P.gold0);
      R(cx - w, cy + d, w + 1, 1, P.gold1);
      R(cx + 1, cy + d, w, 1, P.gold0);
      R(cx - d, cy - w, 1, w + 1, P.gold2);
      R(cx - d, cy + 1, 1, w, P.gold0);
      R(cx + d, cy - w, 1, w + 1, P.gold1);
      R(cx + d, cy + 1, 1, w, P.gold0);
      if (d <= 5)
        for (const [sx, sy] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ] as const)
          R(cx + sx * d, cy + sy * d, 1, 1, P.w4);
    }
    R(cx - 1, cy - 1, 3, 3, P.cream);
    R(cx, cy, 1, 1, P.plum2);
    // N
    R(cx - 2, cy - 19, 1, 5, P.cream);
    R(cx + 2, cy - 19, 1, 5, P.cream);
    R(cx - 1, cy - 18, 1, 1, P.cream);
    R(cx, cy - 17, 1, 1, P.cream);
    R(cx + 1, cy - 16, 1, 1, P.cream);
  });

  // ----- the redwoods: giants behind the town and at its flanks, never across a road or a roof -----
  const guarded: Box[] = [
    { x0: 440, y0: 286, x1: 584, y1: 398 },
    { x0: 426, y0: 300, x1: 446, y1: 320 },
    { x0: 410, y0: 356, x1: 430, y1: 372 },
    { x0: 594, y0: 350, x1: 612, y1: 366 },
    { x0: 556, y0: 384, x1: 576, y1: 402 },
    { x0: 512, y0: 390, x1: 528, y1: 406 },
  ];
  const redwood = (x: number, y: number, h: number): void => {
    shadows.push(() => {
      R(x - 3, y - 1, 14, 3, SHADE);
      R(x + 2, y + 2, 12, 1, SHADE);
    });
    items.push({
      y,
      draw: () => {
        const top = y - h;
        R(x - 3, top + 12, 6, h - 12, P.bark1);
        R(x - 3, top + 12, 2, h - 12, P.bark3);
        R(x - 1, top + 12, 1, h - 12, P.bark2);
        R(x + 2, top + 12, 1, h - 12, P.bark0);
        for (let yy = top + 30; yy < y - 2; yy += 4) {
          R(x - 3, yy, 1, 2, P.bark4);
          R(x + 1, yy + 2, 1, 2, P.bark0);
        }
        R(x - 4, y - 3, 8, 3, P.bark1);
        R(x - 5, y - 1, 10, 1, P.bark0);
        R(x - 4, y - 3, 2, 2, P.bark3);
        // A low bough either side.
        R(x - 8, top + 36, 6, 3, P.g1);
        R(x - 8, top + 36, 4, 1, P.g2);
        R(x + 3, top + 42, 6, 3, P.g0);
        R(x + 3, top + 42, 3, 1, P.g1);
        // The crown, in four tiers that widen downwards.
        for (let tier = 3; tier >= 0; tier--) {
          const cy = top + 5 + tier * 7;
          const hw = 6 + tier * 3 - (tier === 3 ? 1 : 0);
          for (let r = -4; r <= 4; r++) {
            const w = Math.round(hw * Math.sqrt(1 - (r / 4.6) ** 2));
            const yy = cy + r;
            R(x - w, yy, w * 2, 1, r >= 3 ? "#1c3a26" : P.g0);
            if (r < 3) R(x - w, yy, Math.round(w * 1.15), 1, P.g1);
            if (r < 1) R(x - w + 1, yy, Math.max(1, Math.round(w * 0.6)), 1, P.g2);
            if (r === -3 || r === -1) R(x - w + 2, yy, Math.max(1, Math.round(w * 0.3)), 1, P.g3);
          }
        }
      },
    });
  };
  const roadNear = (x: number, y: number): boolean => {
    for (let dy = -2; dy <= 2; dy += 2)
      for (let dx = -3; dx <= 3; dx += 3) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < W && yy >= 0 && yy < H && road[yy * W + xx]) return true;
      }
    return false;
  };
  const rnd = mulberry(404);
  for (let gy = 214; gy <= 470; gy += 15)
    for (let gx = 372; gx <= 640; gx += 19) {
      const x = Math.round(gx + (rnd() - 0.5) * 12 + ((gy / 15) & 1) * 9);
      const y = Math.round(gy + (rnd() - 0.5) * 8);
      const h = Math.round(48 + rnd() * 18);
      const dx = (x - 500) / 1.25;
      const dy = y - 340;
      const d = Math.hypot(dx, dy);
      if (d < 58 || d > 132) continue;
      const i = y * W + x;
      if (riv[i] || (sea[i] as number) > -0.1 || block[i] === undefined) continue;
      if (kind[i] === KIND.river || kind[i] === KIND.road) continue;
      let clear = true;
      for (let yy = y - h; yy <= y + 2 && clear; yy += 3) {
        const reach = yy < y - h + 30 ? 12 : 4;
        for (let xx = x - reach; xx <= x + reach && clear; xx += 4)
          if (roadNear(xx, yy) || riv[Math.max(0, yy) * W + xx]) clear = false;
      }
      if (!clear) continue;
      if (guarded.some((b) => x > b.x0 - 12 && x < b.x1 + 12 && y > b.y0 - 4 && y < b.y1 + h)) continue;
      redwood(x, y, h);
    }

  for (const s of shadows) s();
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();

  // ---------- dusk: warm from the west, plum towards the sea ----------
  g.globalCompositeOperation = "multiply";
  const grade = g.createLinearGradient(0, 0, W, H);
  grade.addColorStop(0, "#fbdcb4");
  grade.addColorStop(0.45, "#dcc0d8");
  grade.addColorStop(1, "#9486cc");
  g.fillStyle = grade;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "source-over";

  const glints: Pt[] = [];
  const pick = mulberry(9);
  while (glints.length < 420) {
    const x = Math.floor(pick() * W);
    const y = Math.floor(pick() * H);
    const here = kind[y * W + x];
    if (here === KIND.river || (here === KIND.sea && (sea[y * W + x] as number) < 1.6)) glints.push({ x, y });
  }

  return { ground, landId, kind, lights, glints, bounds };
}
