/**
 * The guild's places, painted into the layers once: the Swamp at the valley's west end, the pond
 * where the crab colony lives with its rules and roll call, the campfire clearing before the Great
 * Sequoia, Cinfy's stall on the path, and the gate where the path comes in, with its sign.
 *
 * Water is painted as one marker index; each frame, `water.ts` fills it with a reflection of
 * whatever stands above it, so the lanterns and fireflies show in the pond too.
 */

import { ix, R, type Season } from "../pixel/palette.ts";
import type { Surface } from "../pixel/raster.ts";
import { hash3, noise1, Rng } from "../pixel/rng.ts";
import { tinyText, tinyWidth } from "./font3.ts";
import type { Ground } from "./scenery.ts";
import { type Layer, PLACES, WORLD_H } from "./world.ts";

/** Paint this and the frame's reflection pass fills it with the scene above, mirrored. */
export const WATER = ix(R.WATER, 0);

export const ID = {
  swampSign: 101,
  rules: 102,
  rollcall: 103,
  farm: 104,
  stall: 105,
  campfire: 106,
  pennant: 108,
} as const;

export interface Places {
  /** Where the crabs live: the pond's shore line, in front-layer x. */
  pond: { x0: number; x1: number; shore: number; back: number };
  /** Where the stall's keeper stands and its lantern hangs. */
  stall: { x: number; counter: number; lantern: { x: number; y: number } };
  gate: { x: number; lantern: { x: number; y: number } };
  fire: { x: number; y: number };
  swampSign: { x: number; y: number };
  /** The old pennant at the Swamp, faded. */
  oldPennant: { x: number; y: number };
}

/** Marks every pixel `fn` paints as belonging to `id`, for hit tests and tooltips. */
function own(layer: Layer, id: number, fn: () => void): void {
  const before = new Uint8Array(layer.s.data);
  fn();
  const o = layer.owner;
  if (!o) return;
  for (let i = 0; i < layer.s.data.length; i++) if (layer.s.data[i] !== before[i]) o[i] = id;
}

// ---------------------------------------------------------------------------------------------
// Water: pools with soft muddy shores, reeds in clumps, lily pads.

interface Pool {
  X0: number;
  X1: number;
  top: number;
  bottom: number;
  seed: number;
}

function paintPool(layer: Layer, p: Pool, season: Season): void {
  const s = layer.s;
  const winter = season === "winter";
  const x0 = layer.lx(p.X0);
  const x1 = layer.lx(p.X1);
  const cx = (x0 + x1) / 2;
  const rx = (x1 - x0) / 2;
  const cy = (p.top + p.bottom) / 2;
  const ry = (p.bottom - p.top) / 2;
  for (let y = p.top - 3; y <= p.bottom + 3; y++) {
    for (let x = x0 - 4; x <= x1 + 4; x++) {
      // A flattened oval whose rim wanders: a pond seen from low down.
      const wob = 1 + (noise1(x / 9, p.seed) - 0.5) * 0.22 + (noise1(x / 3.5, p.seed + 1) - 0.5) * 0.08;
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / (ry * wob)) ** 2;
      if (d > 1.16) continue;
      if (d > 1) {
        // The shore: wet dark mud at the back, a lit sandy lip at the front.
        const front = y > cy;
        const v = winter
          ? ix(R.SNOW, front ? 5 : 3)
          : front
            ? ix(R.SOIL, hash3(x, y, 3) < 0.3 ? 7 : 6)
            : ix(R.SOIL, hash3(x, y, 4) < 0.3 ? 3 : 2);
        s.set(x, y, v);
        continue;
      }
      s.set(x, y, WATER);
    }
  }
  // Lily pads, a few, floating near the edges.
  const rng = new Rng(p.seed);
  const pads = rng.int(1, 3);
  for (let i = 0; i < pads; i++) {
    const px = Math.round(cx + rng.range(-0.75, 0.75) * rx);
    const py = Math.round(cy + rng.range(-0.1, 0.6) * ry);
    if (winter) continue;
    s.rect(px - 2, py, 5, 1, ix(R.FERN, 4));
    s.rect(px - 1, py - 1, 3, 1, ix(R.FERN, 6));
    s.set(px + 1, py, ix(R.FERN, 2));
    if (i === 0) s.set(px, py - 2, ix(R.ROSE, 5));
  }
}

/** A clump of reeds and cattails, uneven heights, the odd one bent. */
function reeds(s: Surface, x: number, base: number, count: number, seed: number, winter: boolean): void {
  const rng = new Rng(seed);
  for (let i = 0; i < count; i++) {
    const rx = Math.round(x + rng.range(-1, 1) * count * 0.9);
    const h = Math.round(rng.range(7, 17));
    const bend = rng.chance(0.3) ? (rng.chance(0.5) ? -1 : 1) : 0;
    for (let k = 0; k < h; k++) {
      const bx = rx + (bend && k > h * 0.6 ? bend : 0);
      s.set(bx, base - k, ix(R.FERN, k > h - 4 ? 6 : k < 3 ? 2 : 4));
    }
    if (rng.chance(0.55)) {
      // A cattail head.
      const top = base - h + 2;
      const bx = rx + (bend ? bend : 0);
      for (let k = 0; k < 3; k++) s.set(bx, top + k, ix(R.WOOD, k === 0 ? 4 : 2));
      s.set(bx + 1, top + 1, ix(R.WOOD, 3));
      s.set(bx, top - 1, ix(R.FERN, 5));
      if (winter) s.set(bx, top - 1, ix(R.SNOW, 7));
    } else if (rng.chance(0.5)) {
      // A blade arching over.
      const top = base - h;
      for (let k = 1; k <= 3; k++) s.set(rx + k, top + k - 1, ix(R.FERN, 5));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Signs.

interface BoardOpts {
  /** Weathered: faded, a corner broken off, moss along the top. */
  old?: boolean;
}

/** A plank board with lit top edge and dark rim, lettered by the caller. */
function board(s: Surface, x: number, y: number, w: number, h: number, opts: BoardOpts = {}): void {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const edge = xx === 0 || yy === 0 || xx === w - 1 || yy === h - 1;
      // The weathered board has lost its top-right corner.
      if (opts.old && xx >= w - 4 && yy < xx - (w - 5)) continue;
      const seam = yy > 0 && yy < h - 1 && yy % 5 === 0;
      const grain = hash3(x + xx, y + yy, 21);
      let level = edge ? 1 : seam ? 3 : yy === 1 ? 6 : grain < 0.12 ? 4 : 5;
      if (opts.old && !edge) level = Math.max(2, level - (grain > 0.8 ? 2 : 1));
      s.set(x + xx, y + yy, ix(R.WOOD, level));
    }
  }
  if (opts.old) {
    for (let xx = 1; xx < w - 4; xx++)
      if (hash3(xx, y, 5) < 0.45) s.set(x + xx, y - 1, ix(R.OLIVE, hash3(xx, 2, 3) < 0.3 ? 6 : 4));
    s.set(x + w - 3, y + 2, ix(R.WOOD, 1));
  }
}

function post(s: Surface, x: number, top: number, foot: number, lean = 0): void {
  for (let y = top; y <= foot; y++) {
    const dx = Math.round(((foot - y) / Math.max(1, foot - top)) * lean);
    s.set(x + dx, y, ix(R.WOOD, 4));
    s.set(x + dx + 1, y, ix(R.WOOD, 2));
  }
  s.set(x, top, ix(R.WOOD, 6));
}

/** Lettering on a board: dark ink, with a lit pixel under each stroke as if cut into the wood. */
function letter(s: Surface, text: string, x: number, y: number, faded = false): void {
  tinyText(s, text, x, y, faded ? ix(R.WOOD, 1) : ix(R.INK, 2), faded ? undefined : ix(R.WOOD, 6));
}

/** Text that looks like writing too small to read: a row of short ink strokes. */
function scribble(s: Surface, x: number, y: number, w: number, seed: number): void {
  let cx = x;
  while (cx < x + w) {
    const word = 2 + Math.floor(hash3(cx, y, seed) * 5);
    for (let k = 0; k < word && cx + k < x + w; k++) {
      s.set(cx + k, y + 1, ix(R.WOOD, 2));
      if (hash3(cx + k, y, seed + 1) < 0.4) s.set(cx + k, y, ix(R.WOOD, 2));
    }
    cx += word + 2;
  }
}

// ---------------------------------------------------------------------------------------------

export function paintPlaces(
  layers: { back: Layer; mid: Layer; front: Layer },
  grounds: { back: Ground; mid: Ground; front: Ground },
  season: Season,
): Places {
  const winter = season === "winter";
  const { back, mid, front } = layers;
  void grounds;

  // --- The Swamp: three depths of still water in mist, snags, reeds, and the old sign.
  paintPool(back, { X0: -60, X1: 250, top: 189, bottom: 197, seed: 11 }, season);
  paintPool(mid, { X0: -50, X1: 268, top: 202, bottom: 211, seed: 12 }, season);
  // Drowned trees standing in the floodplain: the Swamp's old guard, bare now and mossed.
  snagTree(mid.s, mid.lx(52), 207, 44, 7);
  snagTree(mid.s, mid.lx(206), 206, 30, 19);
  snagTree(back.s, back.lx(128), 194, 26, 23);
  paintPool(front, { X0: -10, X1: 132, top: 220, bottom: 236, seed: 13 }, season);
  paintPool(front, { X0: 150, X1: 192, top: 229, bottom: 238, seed: 14 }, season);
  paintPool(front, { X0: 240, X1: 316, top: 221, bottom: 234, seed: 15 }, season);
  for (const [X, y, n] of [
    [14, 230, 4],
    [128, 226, 5],
    [142, 233, 3],
    [205, 236, 3],
    [232, 226, 4],
    [300, 232, 4],
    [90, 238, 2],
  ] as const)
    reeds(front.s, front.lx(X), y, n, X * 7 + y, winter);
  for (const [X, y, n] of [
    [30, 206, 3],
    [160, 205, 4],
    [240, 207, 3],
  ] as const)
    reeds(mid.s, mid.lx(X), y, n, X * 5 + y, winter);
  // A mossy old stump on the bank.
  stump(front.s, front.lx(136), 231);

  const signX = front.lx(PLACES.swampSign);
  own(front, ID.swampSign, () => {
    post(front.s, signX - 1, 205, 232, 1);
    board(front.s, signX - 22, 208, 44, 14, { old: true });
    const t1 = "THE SWAMP";
    letter(front.s, t1, signX - Math.floor(tinyWidth(t1) / 2), 210);
    const t2 = "'24 - '26";
    letter(front.s, t2, signX - Math.floor(tinyWidth(t2) / 2), 216, true);
    // A second, smaller plank nailed below at an angle: "held".
    const hx = signX - 9;
    for (let k = 0; k < 18; k++) {
      s2(front.s, hx + k, 224 + Math.floor(k / 9), k === 0 || k === 17);
    }
  });
  const oldPennant = { x: front.lx(106), y: 228 };
  own(front, ID.pennant, () => post(front.s, oldPennant.x, 200, oldPennant.y, -3));

  // --- The pond, with its crab colony's rules and roll call.
  const pondX0 = PLACES.pond - 78;
  const pondX1 = PLACES.pond + 74;
  paintPool(front, { X0: pondX0, X1: pondX1, top: 215, bottom: 233, seed: 21 }, season);
  reeds(front.s, front.lx(pondX0 + 2), 222, 5, 41, winter);
  reeds(front.s, front.lx(pondX1 - 4), 225, 4, 42, winter);
  reeds(front.s, front.lx(pondX1 + 4), 229, 3, 43, winter);
  // Rocks on the near shore for crabs to sun on.
  for (const [X, w] of [
    [PLACES.pond - 30, 7],
    [PLACES.pond + 26, 9],
  ] as const)
    rock(front.s, front.lx(X), 236, w, winter);

  const rulesX = front.lx(PLACES.rules);
  own(front, ID.rules, () => {
    const w = 64;
    const x0 = rulesX - w / 2;
    post(front.s, x0 + 5, 190, 224);
    post(front.s, x0 + w - 7, 190, 224);
    board(front.s, x0, 191, w, 29);
    letter(front.s, "CRAB RULES", rulesX - Math.floor(tinyWidth("CRAB RULES") / 2), 193);
    front.s.hline(x0 + 4, x0 + w - 5, 199, ix(R.WOOD, 3));
    letter(front.s, "1", x0 + 3, 201);
    scribble(front.s, x0 + 7, 202, 30, 7);
    letter(front.s, "2 NO CRABELLIONS", x0 + 3, 207);
    letter(front.s, "3", x0 + 3, 213);
    scribble(front.s, x0 + 7, 214, 38, 9);
  });

  const rollX = front.lx(PLACES.rollcall);
  own(front, ID.rollcall, () => {
    const w = 36;
    const x0 = rollX - w / 2;
    post(front.s, rollX - 1, 196, 226);
    board(front.s, x0, 192, w, 29);
    letter(front.s, "ROLL CALL", rollX - Math.floor(tinyWidth("ROLL CALL") / 2), 194);
    front.s.hline(x0 + 3, x0 + w - 4, 200, ix(R.WOOD, 3));
    // Twelve crabs, three to a row: a tick each, and one that is not there.
    for (let i = 0; i < 12; i++) {
      const cx = x0 + 3 + (i % 3) * 11;
      const cy = 202 + Math.floor(i / 3) * 4;
      front.s.set(cx, cy + 1, ix(R.CRAB, 4));
      front.s.set(cx + 1, cy + 1, ix(R.CRAB, 4));
      front.s.set(cx + 2, cy + 1, ix(R.CRAB, 4));
      front.s.set(cx, cy, ix(R.CRAB, 5));
      front.s.set(cx + 2, cy, ix(R.CRAB, 5));
      if (i === 7) {
        // No. 08: a question mark where the tick should be.
        tinyText(front.s, "?", cx + 4, cy - 1, ix(R.CRAB, 2));
      } else {
        front.s.set(cx + 4, cy + 1, ix(R.FERN, 3));
        front.s.set(cx + 5, cy + 2, ix(R.FERN, 3));
        front.s.set(cx + 6, cy + 1, ix(R.FERN, 3));
        front.s.set(cx + 7, cy, ix(R.FERN, 3));
      }
    }
  });

  // --- The campfire clearing: trodden earth and two log benches. The fire itself is alive.
  const fireX = front.lx(PLACES.campfire);
  const fireY = 231;
  own(front, ID.campfire, () => {
    for (let y = fireY - 5; y <= fireY + 7; y++)
      for (let x = fireX - 34; x <= fireX + 34; x++) {
        const d = ((x - fireX) / 34) ** 2 + ((y - fireY - 1) / 6.5) ** 2;
        if (d > 1 || (d > 0.75 && hash3(x, y, 8) < 0.5)) continue;
        front.s.set(
          x,
          y,
          winter ? ix(R.SNOW, d < 0.5 ? 2 : 3) : ix(R.SOIL, d < 0.4 ? 3 : hash3(x, y, 9) < 0.2 ? 5 : 4),
        );
      }
    bench(front.s, fireX - 34, fireY + 1, 15, winter);
    bench(front.s, fireX + 20, fireY + 3, 14, winter);
  });

  // --- Cinfy's stall.
  const stallX = front.lx(PLACES.stall);
  own(front, ID.stall, () => stall(front.s, stallX, 227, winter));

  // --- The gate, and its sign.
  const gateX = front.lx(PLACES.gate);
  gate(front.s, gateX, 229, winter);
  const farmX = front.lx(PLACES.farm);
  own(front, ID.farm, () => {
    post(front.s, farmX - 1, 210, 231);
    board(front.s, farmX - 19, 207, 38, 15);
    letter(front.s, "DO NOT", farmX - Math.floor(tinyWidth("DO NOT") / 2), 209);
    letter(front.s, "THE FARM", farmX - Math.floor(tinyWidth("THE FARM") / 2), 215);
  });

  return {
    pond: { x0: front.lx(pondX0), x1: front.lx(pondX1), shore: 236, back: 216 },
    stall: { x: stallX, counter: 211, lantern: { x: stallX + 20, y: 194 } },
    gate: { x: gateX, lantern: { x: gateX, y: 197 } },
    fire: { x: fireX, y: fireY },
    swampSign: { x: signX, y: 232 },
    oldPennant,
  };
}

function s2(s: Surface, x: number, y: number, nail: boolean): void {
  s.set(x, y, ix(R.WOOD, nail ? 1 : 3));
  s.set(x, y + 1, ix(R.WOOD, 2));
}

/**
 * A drowned tree: a dark trunk flared at the waterline, snapped off high up, with a few crooked
 * bare limbs reaching out at their own heights, moss on the lit side, its top bleached.
 */
function snagTree(s: Surface, x: number, base: number, h: number, seed: number): void {
  const rng = new Rng(seed);
  const lean = rng.range(-3, 3);
  const at = (k: number): number => x + (lean * k) / h + Math.sin(k / 9 + seed) * 0.8;
  for (let k = 0; k <= h; k++) {
    const y = base - k;
    const cx = Math.round(at(k));
    const flare = k < 5 ? (5 - k) * 0.6 : 0;
    const hw = Math.max(0.5, 2.2 - (k / h) * 1.4 + flare);
    const x0 = Math.round(cx - hw);
    const x1 = Math.round(cx + hw);
    for (let px = x0; px <= x1; px++) {
      const lit = px === x0;
      const v = lit ? ix(R.MOSS, hash3(px, y, 1) < 0.5 ? 5 : 4) : ix(R.BARK, px === x1 ? 0 : 2);
      s.set(px, y, v);
    }
  }
  // The snapped top: a jagged splinter to one side.
  const tx = Math.round(at(h));
  s.set(tx + 1, base - h - 1, ix(R.BARK, 3));
  s.set(tx + 1, base - h - 2, ix(R.BARK, 2));
  // Crooked limbs: out, then up or down a little, at uneven heights.
  const limbs = 2 + rng.int(0, 2);
  for (let i = 0; i < limbs; i++) {
    const k = Math.round(h * rng.range(0.35, 0.85));
    const side = i % 2 === 0 ? -1 : 1;
    let lx = Math.round(at(k));
    let ly = base - k;
    const len = rng.int(4, 9);
    const bend = rng.chance(0.5) ? -1 : 1;
    for (let j = 1; j <= len; j++) {
      lx += side;
      if (j % 3 === 0) ly += j > len / 2 ? bend : -1;
      s.set(lx, ly, ix(R.BARK, side < 0 ? 3 : 1));
    }
  }
}

function stump(s: Surface, x: number, foot: number): void {
  for (let y = foot - 6; y <= foot; y++)
    for (let k = -4; k <= 4; k++) {
      const flare = y > foot - 2 ? 1 : 0;
      if (Math.abs(k) > 3 + flare) continue;
      s.set(x + k, y, ix(R.BARK, k < -1 ? 5 : k > 1 ? 2 : 3));
    }
  for (let k = -3; k <= 3; k++) s.set(x + k, foot - 7, ix(R.WOOD, Math.abs(k) < 2 ? 6 : 5));
  s.set(x, foot - 7, ix(R.WOOD, 3));
  for (let k = -4; k <= 0; k++) if (hash3(k, 1, 3) < 0.7) s.set(x + k, foot - 7 - (k > -3 ? 1 : 0), ix(R.OLIVE, 5));
}

function rock(s: Surface, x: number, foot: number, w: number, winter: boolean): void {
  const h = Math.ceil(w * 0.45);
  for (let y = 0; y < h; y++) {
    const v = (y + 1) / h;
    const half = (w / 2) * Math.sqrt(1 - (1 - v) ** 2) + 0.4;
    for (let k = 0; k < w; k++) {
      const dx = k - (w - 1) / 2;
      if (Math.abs(dx) > half) continue;
      const lit = y === 0 || (dx < -half * 0.3 && y < h - 1);
      const v2 = winter && y === 0 ? ix(R.SNOW, 6) : ix(R.STONE, lit ? 6 : dx > half * 0.4 ? 2 : 4);
      s.set(x - Math.floor(w / 2) + k, foot - h + y, v2);
    }
  }
}

function bench(s: Surface, x: number, y: number, len: number, winter: boolean): void {
  for (let k = 0; k < len; k++) {
    s.set(x + k, y - 3, winter ? ix(R.SNOW, 6) : ix(R.WOOD, 6));
    s.set(x + k, y - 2, ix(R.WOOD, 4));
    s.set(x + k, y - 1, ix(R.WOOD, 3));
    s.set(x + k, y, ix(R.WOOD, 1));
  }
  // The cut ends, with rings.
  for (const ex of [x - 1, x + len]) {
    s.set(ex, y - 2, ix(R.WOOD, 7));
    s.set(ex, y - 1, ix(R.WOOD, 5));
  }
}

/**
 * Cinfy's stall: a little plank stand under a striped awning, cones and a jar of Leaf on the
 * counter, a sign on the front, and the vault (a strongbox with a big lock) tucked beside it.
 */
function stall(s: Surface, x: number, foot: number, winter: boolean): void {
  const half = 20;
  // Back posts and the awning frame.
  post(s, x - half + 2, 190, foot);
  post(s, x + half - 3, 190, foot);
  // The striped awning, sloping a little toward us, its valance scalloped.
  for (let y = 186; y <= 194; y++) {
    const inset = Math.max(0, 189 - y);
    for (let k = -half - 2 + inset; k <= half + 1 - inset; k++) {
      const stripe = Math.floor((k + half + 2) / 4) % 2 === 0;
      const shade = y === 186 + 0 ? 1 : y >= 193 ? -1 : 0;
      s.set(x + k, y, stripe ? ix(R.CRAB, 3 + shade) : ix(R.CREAM, 4 + shade));
    }
  }
  for (let k = -half - 2; k <= half + 1; k++) {
    const scallop = (k + half + 2) % 4;
    if (scallop === 1 || scallop === 2)
      s.set(x + k, 195, Math.floor((k + half + 2) / 4) % 2 === 0 ? ix(R.CRAB, 2) : ix(R.CREAM, 2));
  }
  if (winter) for (let k = -half; k <= half - 1; k++) if (hash3(k, 7, 1) < 0.8) s.set(x + k, 185, ix(R.SNOW, 6));
  // The counter: a lit top board, a planked front.
  for (let k = -half; k < half; k++) {
    s.set(x + k, 211, ix(R.WOOD, 7));
    s.set(x + k, 212, ix(R.WOOD, 5));
  }
  for (let y = 213; y <= foot; y++)
    for (let k = -half + 1; k < half - 1; k++) {
      const seam = (k + half) % 6 === 0;
      s.set(x + k, y, ix(R.WOOD, seam ? 2 : y === 213 ? 3 : hash3(k, y, 4) < 0.15 ? 5 : 4));
    }
  // The sign on the front: cream board, the keeper's name.
  const name = "CINFY'S";
  const tw = tinyWidth(name);
  for (let y = 215; y <= 223; y++)
    for (let k = -Math.ceil(tw / 2) - 2; k <= Math.ceil(tw / 2) + 1; k++)
      s.set(x + k, y, ix(R.CREAM, y === 215 ? 6 : y === 223 ? 2 : 4));
  tinyText(s, name, x - Math.floor(tw / 2), 217, ix(R.CRAB, 1));
  // On the counter: two cones, a jar of Leaf, a little stack of coins.
  for (const cx of [x - 15, x - 11]) {
    s.rect(cx, 208, 3, 3, ix(R.CONE, 4));
    s.set(cx + 1, 207, ix(R.CONE, 6));
    s.set(cx, 209, ix(R.CONE, 2));
    s.set(cx + 2, 210, ix(R.CONE, 2));
  }
  s.rect(x + 9, 205, 5, 6, ix(R.WATER, 5));
  s.rect(x + 10, 206, 3, 4, ix(R.FOLI, 6));
  s.set(x + 11, 207, ix(R.OLIVE, 7));
  s.rect(x + 9, 204, 5, 1, ix(R.WOOD, 3));
  s.set(x + 13, 206, ix(R.WATER, 7));
  for (let k = 0; k < 3; k++) s.rect(x + 15, 210 - k, 3, 1, ix(R.GLOW, k === 2 ? 6 : 3));
  // The vault: a strongbox with an outsized padlock, beside the stall.
  const vx = x + half + 2;
  for (let y = foot - 8; y <= foot; y++)
    for (let k = 0; k < 11; k++) {
      const band = k === 2 || k === 8 || y === foot - 5;
      s.set(vx + k, y, band ? ix(R.METAL, 6) : ix(R.METAL, y === foot - 8 ? 5 : k < 2 ? 4 : 3));
    }
  s.rect(vx + 4, foot - 6, 3, 3, ix(R.GLOW, 3));
  s.set(vx + 4, foot - 7, ix(R.GLOW, 2));
  s.set(vx + 6, foot - 7, ix(R.GLOW, 2));
  s.set(vx + 5, foot - 8, ix(R.GLOW, 2));
  s.set(vx + 5, foot - 5, ix(R.INK, 0));
}

/** The gate: two log posts and a lintel, the fence trailing off either side, broken here and there. */
function gate(s: Surface, x: number, foot: number, winter: boolean): void {
  for (const side of [-1, 1]) {
    const px = x + side * 13;
    for (let y = 192; y <= foot; y++) {
      s.set(px - 1, y, ix(R.WOOD, 5));
      s.set(px, y, ix(R.WOOD, 4));
      s.set(px + 1, y, ix(R.WOOD, 2));
    }
    s.set(px, 191, ix(R.WOOD, 6));
  }
  // The lintel: a log laid across, sagging a pixel in the middle, its ends showing rings.
  for (let k = -17; k <= 17; k++) {
    const sag = Math.abs(k) < 6 ? 1 : 0;
    s.set(x + k, 193 + sag, ix(R.WOOD, 6));
    s.set(x + k, 194 + sag, ix(R.WOOD, 4));
    s.set(x + k, 195 + sag, ix(R.WOOD, 2));
    if (winter && hash3(k, 3, 3) < 0.85) s.set(x + k, 192 + sag, ix(R.SNOW, 6));
  }
  s.set(x - 18, 194, ix(R.WOOD, 7));
  s.set(x + 18, 194, ix(R.WOOD, 7));
  // Split-rail fence: two rails between posts, one rail fallen.
  const spans: [number, number, boolean][] = [
    [x - 58, x - 14, true],
    [x + 14, x + 52, false],
  ];
  for (const [a, b, broken] of spans) {
    for (const px of [a, (a + b) / 2]) {
      const pxr = Math.round(px);
      for (let y = foot - 12; y <= foot; y++) s.set(pxr, y, ix(R.WOOD, 3));
      s.set(pxr, foot - 13, ix(R.WOOD, 5));
    }
    for (let k = a; k <= b; k++) {
      s.set(k, foot - 10, ix(R.WOOD, 5));
      if (broken && k > (a + b) / 2) {
        // The lower rail has come down at one end and rests in the grass.
        const u = (k - (a + b) / 2) / ((b - a) / 2);
        s.set(k, Math.round(foot - 5 + u * 4), ix(R.WOOD, 4));
      } else s.set(k, foot - 5, ix(R.WOOD, 4));
    }
  }
}

/** The world's bottom row: nothing below it. */
export const BOTTOM = WORLD_H - 1;
