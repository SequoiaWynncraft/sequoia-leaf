/**
 * The yard's floor, worked out a pixel at a time and kept. It is painted twice: once as the yard
 * keeps it (grass, packed earth round the depot, the path to the gate) and once as the forest
 * left it. The screen shows the first wherever the yard owns the land and the second elsewhere.
 * What lies in the ground is the same in both, and so is the stream.
 */

import { isItem, itemName, type Land, RAW, type RawName } from "@sequoia-leaf/factory";
import { BARK, CREAM, EARTH, GOLD, GREEN, INK, PAPER, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, ell, outlined, paint, R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx, hash, must, vnoise } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./belts.ts";
import { nearFerns, rock, stump, trunk } from "./nature.ts";
import { CLAY, DEEP, PAL, tone } from "./pal.ts";

/** How far the picture runs past the map on each side, for the forest that rings the clearing. */
export const MARGIN = { l: 56, r: 56, t: 88, b: 56 } as const;

export interface Ground {
  owned: HTMLCanvasElement;
  wild: HTMLCanvasElement;
  /** Where the pictures' top-left corner is, in the yard's pixels (the map's own corner is 0, 0). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Whether something holds at all four points `r` pixels out from a point. */
const ringed = (x: number, y: number, r: number, of: (ax: number, ay: number) => boolean): boolean =>
  of(x - r, y) && of(x + r, y) && of(x, y - r) && of(x, y + r);

const RAWS: readonly RawName[] = ["deadfall", "stone", "ore", "clay", "sand", "resin"];
/** What lies in the ground on a tile of a land, by name, or nothing. */
const rawAt = (land: Land, i: number): RawName | null => {
  const n = land.deposit[i] ?? -1;
  const name = isItem(n) ? itemName(n) : null;
  return RAW.find((r) => r === name) ?? null;
};

function floor(land: Land, wild: boolean): HTMLCanvasElement {
  const mw = land.w * TILE;
  const mh = land.h * TILE;
  const dep = new Uint8Array(land.w * land.h);
  for (let i = 0; i < dep.length; i++) {
    const raw = rawAt(land, i);
    dep[i] = raw ? RAWS.indexOf(raw) + 1 : 0;
  }
  const tile = (x: number, y: number): number =>
    clamp(Math.floor(y / TILE), 0, land.h - 1) * land.w + clamp(Math.floor(x / TILE), 0, land.w - 1);
  const wet = (x: number, y: number): boolean => land.water[tile(x, y)] === 1;
  const cxp = (land.depot[0] + 0.5) * TILE;
  const cyp = (land.depot[1] + 0.5) * TILE;

  return paint(mw + MARGIN.l + MARGIN.r, mh + MARGIN.t + MARGIN.b, (px, py) => {
    const x = px - MARGIN.l;
    const y = py - MARGIN.t;
    // Beyond the map: the forest floor, darker the further out.
    if (x < 0 || y < 0 || x >= mw || y >= mh) return tone(DEEP, vnoise(x / 12, y / 9, 72) * 2.4);
    // Nothing in the ground keeps to the grid: every edge wanders a few pixels.
    const jx = x + (vnoise(x / 6, y / 6, 21) - 0.5) * 7;
    const jy = y + (vnoise(x / 6, y / 6, 22) - 0.5) * 7;
    const i = tile(jx, jy);

    if (land.water[i] === 1) {
      if (!ringed(jx, jy, 3, wet)) return WATER[2];
      if (!ringed(jx, jy, 8, wet)) return WATER[1];
      return (y & 3) === 0 && hash(x >> 2, y, 52) > 0.86 ? WATER[1] : WATER[0];
    }
    if (!ringed(jx, jy, 3, (ax, ay) => !wet(ax, ay))) {
      const peb = hash(x >> 1, y >> 1, 53);
      return peb > 0.9 ? STONE[2] : peb > 0.8 ? STONE[1] : EARTH[2];
    }
    if (!ringed(jx, jy, 5, (ax, ay) => !wet(ax, ay))) return EARTH[0];

    // What lies in the ground makes a soft-edged patch round every tile that holds it.
    let d = 0;
    let near = 99;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        if (tx + ox < 0 || ty + oy < 0 || tx + ox >= land.w || ty + oy >= land.h) continue;
        const k = dep[(ty + oy) * land.w + tx + ox] ?? 0;
        if (k === 0) continue;
        const far = Math.hypot(x - (tx + ox + 0.5) * TILE, y - (ty + oy + 0.5) * TILE);
        if (far < near) {
          near = far;
          d = k;
        }
      }
    const reach = 12.5 + (vnoise(x / 5, y / 5, 23) - 0.5) * 6;
    if (d > 0 && near < reach) {
      const rim = near > reach - 1.5;
      const f = hash(x, y, 30 + d);
      const g2 = hash(x >> 1, y >> 1, 40 + d);
      switch (d) {
        case 1: // Deadfall: leaf litter over the grass, dark and soft.
          return rim ? GREEN[0] : g2 > 0.55 ? EARTH[0] : f > 0.9 ? BARK[1] : f < 0.08 ? GREEN[1] : GREEN[0];
        case 2: // Stone: bare rock showing through.
          return rim ? EARTH[0] : g2 > 0.8 ? STONE[1] : f > 0.95 ? STONE[2] : STONE[0];
        case 3: // Ore: dark red earth, with a glint in it.
          return rim ? BARK[0] : f > 0.965 ? GOLD[0] : g2 > 0.8 ? BARK[2] : BARK[1];
        case 4: // Clay: a red bank, laid down in bands.
          return rim
            ? CLAY[0]
            : Math.floor(jy + vnoise(x / 9, y / 30, 47) * 6) % 5 === 0
              ? CLAY[0]
              : g2 > 0.84
                ? CLAY[2]
                : CLAY[1];
        case 5: // Sand: pale, and brighter where it is dry.
          return rim ? EARTH[2] : g2 > 0.7 ? PAPER[1] : f > 0.95 ? CREAM : PAPER[0];
        default: // Resin: the litter under old stumps, spotted with amber.
          return rim ? GREEN[0] : f > 0.975 ? GOLD[0] : g2 > 0.6 ? EARTH[0] : GREEN[0];
      }
    }

    if (wild) {
      // Uncleared forest floor: dark, with a little green coming through.
      const n = vnoise(x / 22, y / 16, 7);
      if (hash(x, y, 8) > 0.975) return GREEN[1];
      return n > 0.62 ? GREEN[0] : n < 0.3 ? DEEP[1] : DEEP[2];
    }

    // The packed earth of the yard round the depot, and the path from its door down to the gate.
    const yard = Math.hypot((x - cxp) / 1.35, y - cyp) - (62 + (vnoise(x / 24, y / 24, 5) - 0.5) * 34);
    const path = y > cyp ? Math.abs(x - cxp + (vnoise(3, y / 30, 6) - 0.5) * 8) - (6 + vnoise(5, y / 14, 6) * 4) : 99;
    const td = Math.min(yard, path);
    if (td < 0) {
      if (td > -2.2) return EARTH[0];
      if (hash(x >> 1, y, 43) > 0.994) return STONE[1];
      if (hash(x, y >> 1, 44) > 0.985) return EARTH[0];
      return vnoise(x / 15, y / 8, 41) > 0.62 ? EARTH[2] : EARTH[1];
    }

    // Grass, as in the town: one green with lighter and darker drifts across it, and tufts.
    const n = vnoise(x / 34, y / 13, 3);
    let idx = n > 0.7 ? 3 : n < 0.27 ? 1 : 2;
    const edge = Math.min(x, mw - x, y, mh - y);
    if (edge < 4 + vnoise(x / 26, y / 20, 8) * 30) idx -= 1;
    if (td < 1.6) idx -= 1;
    idx = clamp(idx, 0, 3);
    const gx = Math.floor(x / 13);
    const gy = Math.floor(y / 9);
    if (hash(gx, gy, 31) > 0.62) {
      const dx = x - (gx * 13 + 1 + Math.floor(hash(gx, gy, 32) * 9));
      const dy = y - (gy * 9 + 3 + Math.floor(hash(gx, gy, 33) * 5));
      if ((dx === 0 && dy === 0) || (dx === 2 && dy === 0)) return tone(GREEN, idx - 1);
      if (dx === 1 && dy === -1) return tone(GREEN, idx + 1);
    }
    return tone(GREEN, idx);
  });
}

function line(g: Ctx, x0: number, y0: number, x1: number, y1: number, col: string): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let k = 0; k <= n; k++)
    R(g, Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), 1, 1, col);
}

/** A fallen bough: pale where the light catches it, dark under, a twig or two, sometimes still in leaf. */
function branch(g: Ctx, x: number, y: number, seed: number): void {
  const len = 7 + Math.floor(hash(seed, 1, 61) * 6);
  const lean = Math.round((hash(seed, 2, 61) - 0.5) * 6);
  const x1 = x + len;
  const y1 = y + lean;
  line(g, x, y + 2, x1, y1 + 2, BARK[0]);
  line(g, x, y + 1, x1, y1 + 1, BARK[2]);
  line(g, x, y, x1, y1, hash(seed, 3, 61) > 0.5 ? BARK[4] : BARK[3]);
  R(g, x, y, 1, 2, PAPER[0]);
  R(g, x1, y1, 1, 2, GOLD[0]);
  const mid = Math.floor(len / 2);
  const my = y + Math.round((lean * mid) / len);
  const up = hash(seed, 4, 61) > 0.5 ? -1 : 1;
  line(g, x + mid, my + (up > 0 ? 2 : 0), x + mid + 3, my + up * 4, BARK[3]);
  if (hash(seed, 5, 61) > 0.45) {
    R(g, x + mid + 3, my + up * 4 - 1, 2, 2, GREEN[3]);
    R(g, x + mid + 4, my + up * 4 - 2, 1, 1, GREEN[4]);
  }
}

const ORE_ROCK = [BARK[0], STONE[0], STONE[1], STONE[2]];
const FLOWERS = [
  ["..p..", ".pyp.", "..p..", "..G..", ".GG..", "..G.."],
  ["..w..", ".wyw.", "..w..", "..G..", "..GG.", "..G.."],
  [".y.y.", "..r..", ".y.y.", "..G..", ".GG..", "..G.."],
];

/** What lies in the ground, drawn over the floor: branches, rocks, banks and stumps, none of them in ranks. */
function deposits(g: Ctx, land: Land): void {
  for (let ty = 0; ty < land.h; ty++)
    for (let tx = 0; tx < land.w; tx++) {
      const d = rawAt(land, ty * land.w + tx);
      if (!d) continue;
      const ox = tx * TILE + MARGIN.l;
      const oy = ty * TILE + MARGIN.t;
      const seed = Math.floor(hash(tx, ty, 90) * 9973);
      const a = hash(tx, ty, 91);
      const b = hash(tx, ty, 92);
      switch (d) {
        case "deadfall":
          branch(g, ox + 1 + Math.floor(a * 4), oy + 4 + Math.floor(b * 3), seed);
          branch(g, ox + 3 + Math.floor(b * 4), oy + 10 + Math.floor(a * 3), seed + 7);
          if (a > 0.6) branch(g, ox + Math.floor(b * 6), oy + 7, seed + 13);
          break;
        case "stone":
        case "ore": {
          const ramp = d === "ore" ? ORE_ROCK : STONE;
          const big = outlined(rock(9 + Math.floor(a * 4), 7 + Math.floor(b * 3), seed, ramp), INK);
          const bx = ox + Math.floor(a * (TILE - big.width));
          const by = oy + 1 + Math.floor(b * (TILE - big.height - 3));
          g.drawImage(big, bx, by);
          if (d === "ore") {
            for (let k = 0; k < 4; k++) {
              const fx = bx + 2 + Math.floor(hash(seed, k, 93) * (big.width - 5));
              const fy = by + 2 + Math.floor(hash(seed, k, 94) * (big.height - 5));
              R(g, fx, fy, k % 2 ? 1 : 2, 1, k === 0 ? GOLD[2] : GOLD[1]);
              R(g, fx, fy + 1, 1, 1, GOLD[0]);
            }
          }
          if (b > 0.45) g.drawImage(outlined(rock(5, 4, seed + 3, ramp), INK), ox + Math.floor((1 - a) * 9), oy + 10);
          break;
        }
        case "clay": {
          const cx = ox + 5 + Math.floor(a * 6);
          const cy = oy + 6 + Math.floor(b * 5);
          ell(g, cx, cy + 1, 6, 3.4, CLAY[0]);
          ell(g, cx, cy, 6, 3.2, CLAY[1]);
          ell(g, cx - 1, cy - 1, 3.6, 1.6, CLAY[2]);
          R(g, cx - 3, cy - 2, 2, 1, CLAY[3]);
          break;
        }
        case "sand": {
          const cx = ox + 5 + Math.floor(a * 6);
          const cy = oy + 7 + Math.floor(b * 5);
          ell(g, cx, cy + 1, 6, 2.6, PAPER[0]);
          ell(g, cx, cy, 5.4, 2.2, PAPER[1]);
          R(g, cx - 3, cy - 1, 4, 1, CREAM);
          if (a > 0.7) R(g, cx + 5, cy + 3, 1, 1, CREAM);
          break;
        }
        case "resin":
          g.drawImage(stump(seed, true), ox + Math.floor(a * 3), oy + 1 + Math.floor(b * 3));
          R(g, ox + 12 + Math.floor(a * 2), oy + 12 - Math.floor(b * 3), 2, 1, GOLD[1]);
          break;
      }
    }
}

/** The great trunks that ring the clearing, and the dark ferns along its near edge. */
function forest(g: Ctx, land: Land): void {
  const mw = land.w * TILE;
  const mh = land.h * TILE;
  // The far side: a rank of trunks with their feet just beyond the map, rising out of the picture.
  for (let x = -30, k = 0; x < mw + 40; k++) {
    const hw = 16 + Math.floor(hash(k, 1, 95) * 14);
    const t = trunk(hw, 120, 3 + k * 1.7, 84);
    const foot = -4 - Math.floor(hash(k, 2, 95) * 14);
    g.drawImage(t.c, x + MARGIN.l - t.ax, foot + MARGIN.t - t.ay);
    x += hw * 2 + 18 + Math.floor(hash(k, 3, 95) * 40);
  }
  // Either side: trunks standing one behind another down the edge.
  for (const side of [0, 1])
    for (let y = 70, k = 0; y < mh + 40; k++) {
      const hw = 15 + Math.floor(hash(k, 4 + side, 96) * 6);
      const t = trunk(hw, 230, 11 + k * 2.3 + side * 5, 150);
      const cx = side === 0 ? -27 - Math.floor(hash(k, 6, 96) * 6) : mw + 27 + Math.floor(hash(k, 7, 96) * 6);
      g.drawImage(t.c, cx + MARGIN.l - t.ax, y + MARGIN.t - t.ay);
      y += 96 + Math.floor(hash(k, 8 + side, 96) * 50);
    }
  g.drawImage(nearFerns(mw + MARGIN.l + MARGIN.r, 70), 0, mh + MARGIN.t - 12);
}

/** Small flowers in the grass of the yard's own land, where nothing lies in the ground. */
function flowers(g: Ctx, land: Land): void {
  const pics = FLOWERS.map((rows) => bitmap(rows, PAL));
  for (let ty = 0; ty < land.h; ty++)
    for (let tx = 0; tx < land.w; tx++) {
      const i = ty * land.w + tx;
      if (rawAt(land, i) || land.water[i] || (land.tree[i] ?? -1) >= 0 || hash(tx, ty, 97) < 0.86) continue;
      if (Math.hypot(tx - land.depot[0], ty - land.depot[1]) < 6) continue;
      const pic = pics[Math.floor(hash(tx, ty, 98) * pics.length)];
      if (pic) g.drawImage(pic, tx * TILE + MARGIN.l + 3 + Math.floor(hash(tx, ty, 99) * 8), ty * TILE + MARGIN.t + 5);
    }
}

export function paintGround(land: Land): Ground {
  const make = (wild: boolean): HTMLCanvasElement => {
    const c = floor(land, wild);
    const g = must(c.getContext("2d"), "2d context");
    if (!wild) flowers(g, land);
    deposits(g, land);
    forest(g, land);
    return c;
  };
  const owned = make(false);
  return { owned, wild: make(true), x: -MARGIN.l, y: -MARGIN.t, w: owned.width, h: owned.height };
}

/** A patch of water's glints for one moment: a few short bright dashes that drift with the stream. */
export function glint(g: Ctx, land: Land, tx: number, ty: number, sx: number, sy: number, t: number): void {
  if (land.water[ty * land.w + tx] !== 1) return;
  const k = hash(tx, ty, 54);
  const phase = (t * 0.35 + k * 7) % 1;
  if (k < 0.45 || phase > 0.6) return;
  const x = sx + 2 + Math.floor(hash(tx, ty, 55) * 9);
  const y = sy + 2 + Math.floor(((k * 31 + t * 5) % 1) * 12);
  R(g, x, y, phase < 0.3 ? 3 : 2, 1, phase < 0.15 ? WATER[3] : WATER[2]);
}

/** The colour the view is cleared to before the floor is drawn. */
export const BEYOND = DEEP[0];
export const SHADE = SKY[0];
