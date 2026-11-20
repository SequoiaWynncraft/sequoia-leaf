/**
 * The members' trees: each grown by the glade's own `growTree`, then set into the forest.
 *
 * A tree is drawn once at its own size, its canopy turned toward the guild's gold as its level
 * rises, and shrunk for its row by area sampling in palette space (the most-covered ramp wins and
 * its levels are averaged), so a far tree keeps its shading rather than breaking into noise.
 *
 * Older members stand nearer the heart and newer ones toward the edges, the way a real grove grows
 * outward. Small trees mostly stand in front and big ones behind, as a guild photo is arranged,
 * with enough exceptions that it reads as a forest and not a seating plan.
 */

import { ix, R, type Season } from "../pixel/palette.ts";
import { type Sprite, sprite, Surface } from "../pixel/raster.ts";
import { hash3, hashString } from "../pixel/rng.ts";
import { blitPad, growTree, type StageName } from "../pixel/tree.ts";
import { type Member, ROSTER } from "./roster.ts";
import { HEART_X, KEEP_CLEAR, type Layer, type Row, ROWS, WORLD_W } from "./world.ts";

export interface Art {
  sprite: Sprite;
  /** The tree's foot within the sprite. */
  ax: number;
  ay: number;
}

export interface Planted {
  id: number;
  member: Member;
  row: Row;
  rowIndex: number;
  /** Nominal x of the foot, and the foot's row. */
  X: number;
  foot: number;
  art: Art;
  /** The seedling's sway frames (front row only), drawn each frame over the still art. */
  sway: Sprite[] | null;
  /** Bounds in the layer, for picking a tooltip's anchor. */
  box: { x0: number; y0: number; x1: number; y1: number };
}

// ---------------------------------------------------------------------------------------------
// Drawing one tree.

const PAD = 120;
const FOOT = 205;

const foli = (l: number): number => ix(R.FOLI, l);
const olive = (l: number): number => ix(R.OLIVE, l);

/** The canopy turns gold as a member levels: summer green at 1, the guild's gold at the top. */
function goldMap(level: number): Uint8Array {
  const map = new Uint8Array(256);
  for (let i = 0; i < 256; i++) map[i] = i;
  if (level >= 5) {
    map[foli(7)] = olive(6);
  }
  if (level >= 7) {
    map[foli(6)] = foli(7);
    map[foli(7)] = olive(6);
    map[olive(6)] = olive(7);
  }
  if (level >= 9) {
    map[foli(5)] = foli(6);
    map[foli(6)] = olive(5);
    map[foli(7)] = olive(7);
  }
  // An old fire scar reads as charred bark at the forest's distance, not a doorway.
  map[ix(R.INK, 1)] = ix(R.BARK, 1);
  map[ix(R.INK, 3)] = ix(R.BARK, 2);
  return map;
}

/** Grows a member's tree. A front-row seedling's body is left out of the art: it sways, drawn live. */
function grow(m: Member, season: Season, live: boolean): { art: Art; frames: Sprite[] | null } {
  const surf = new Surface(PAD * 2, FOOT + 12);
  const tree = growTree(m.level, m.seed, PAD, FOOT, season, new Set());
  tree.paintStill(surf);
  for (const p of tree.pads) if (!p.back) blitPad(surf, p, false, 0);
  let frames: Sprite[] | null = null;
  if (tree.seedling) {
    frames = tree.seedling;
    const f0 = frames[0];
    if (f0 && !live) surf.blit(f0, PAD - Math.floor(f0.w / 2), FOOT - f0.h + 1);
  }
  // Each seedling's stake carries its own coloured tag, so a row of new members is not a row of twins.
  const tags = [ix(R.LIGHTS, 4), ix(R.LIGHTS, 6), ix(R.ROSE, 4), ix(R.GLOW, 4), ix(R.LIGHTS, 7), ix(R.FERN, 6)];
  const tag = tags[hashString(m.seed) % tags.length] ?? ix(R.LIGHTS, 4);
  if (tree.seedling) {
    // The glade's mound, pebble ring, stake and tag are for one tree in its own clearing; in a
    // crowd of new members they read as a nursery. Only the newest few keep the stake and tag:
    // just planted.
    const newest = m.tenure >= ROSTER.length - 3;
    for (let i = 0; i < surf.data.length; i++) {
      const r = (surf.data[i] ?? 0) >> 3;
      if (r === R.SOIL || r === R.STONE || (!newest && (r === R.WOOD || r === R.CREAM || r === R.LIGHTS)))
        surf.data[i] = 0;
    }
  }
  const map = goldMap(m.level);
  // Each tree its own shade of green: some a touch darker, some a touch brighter, as real trees differ.
  const shade = hash3(hashString(m.seed), 3, 1);
  if (shade < 0.3 || shade > 0.75)
    for (let l = 1; l < 7; l++) {
      const i = ix(R.FOLI, l);
      if (map[i] === i) map[i] = ix(R.FOLI, l + (shade < 0.3 ? -1 : 1));
    }
  for (let i = 0; i < surf.data.length; i++) {
    const v = surf.data[i] ?? 0;
    if (!v) continue;
    surf.data[i] = v === ix(R.LIGHTS, 4) ? tag : (map[v] ?? v);
  }
  return { art: crop(surf, PAD, FOOT), frames };
}

function crop(s: Surface, fx: number, fy: number): Art {
  let x0 = s.w;
  let y0 = s.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++)
      if (s.data[y * s.w + x]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  // A seedling drawn live leaves nothing still behind.
  if (x1 < 0) return { sprite: sprite(1, 1), ax: 0, ay: 0 };
  const out = sprite(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = y0; y <= y1; y++) out.data.set(s.data.subarray(y * s.w + x0, y * s.w + x1 + 1), (y - y0) * out.w);
  return { sprite: out, ax: fx - x0, ay: fy - y0 };
}

/**
 * Shrinks indexed art by `k`, sampling each target pixel's footprint: transparent if less than
 * about two fifths of it is covered, else the most-covered ramp at its mean level. A thin trunk or
 * stake survives; a lit top edge is put back afterwards, since averaging dulls it.
 */
export function shrink(art: Art, k: number): Art {
  if (k >= 0.999) return art;
  const src = art.sprite;
  const w = Math.max(1, Math.round(src.w * k));
  const h = Math.max(1, Math.round(src.h * k));
  const out = sprite(w, h);
  const weight = new Float32Array(32);
  const levels = new Float32Array(32);
  for (let ty = 0; ty < h; ty++) {
    const sy0 = ty / k;
    const sy1 = (ty + 1) / k;
    for (let tx = 0; tx < w; tx++) {
      const sx0 = tx / k;
      const sx1 = (tx + 1) / k;
      weight.fill(0);
      levels.fill(0);
      let clear = 0;
      let total = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1) && sy < src.h; sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1) && sx < src.w; sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          const a = wx * wy;
          total += a;
          const v = src.data[sy * src.w + sx] ?? 0;
          if (!v) {
            clear += a;
            continue;
          }
          weight[v >> 3] = (weight[v >> 3] ?? 0) + a;
          levels[v >> 3] = (levels[v >> 3] ?? 0) + a * (v & 7);
        }
      }
      if (total === 0 || clear > total * 0.6) continue;
      let best = 0;
      for (let r = 1; r < 32; r++) if ((weight[r] ?? 0) > (weight[best] ?? 0)) best = r;
      const wb = weight[best] ?? 0;
      if (wb <= 0) continue;
      out.data[ty * w + tx] = ix(best, (levels[best] ?? 0) / wb);
    }
  }
  // Put back the lit crowns: foliage open to the sky above catches the light again.
  const lit = new Uint8Array(out.data);
  for (let y = 1; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = lit[y * w + x] ?? 0;
      if (!v || (lit[(y - 1) * w + x] ?? 0)) continue;
      const r = v >> 3;
      if (r === R.FOLI || r === R.OLIVE || r === R.CANOPY) out.data[y * w + x] = ix(r, (v & 7) + 1);
    }
  return { sprite: out, ax: Math.round(art.ax * k), ay: Math.round(art.ay * k) };
}

// ---------------------------------------------------------------------------------------------
// Where each tree stands.

/** Which row a member's tree stands in: small trees mostly in front, big ones behind. */
function rowFor(m: Member): number {
  const r = hash3(hashString(m.seed), 7, 3);
  const odds: Record<StageName, readonly [number, number]> = {
    // [chance of the back row, chance of back or mid]
    seedling: [0.22, 0.52],
    sapling: [0.2, 0.62],
    young: [0.42, 0.88],
    mature: [0.55, 1],
    ancient: [0, 1],
    giant: [0, 1],
  };
  const [back, mid] = odds[m.stage];
  return r < back ? 0 : r < mid ? 1 : 2;
}

const blocked = (row: Row, X: number, half: number): boolean =>
  X < half + 20 || X > WORLD_W - half - 20 || KEEP_CLEAR[row.name].some(([a, b]) => X + half > a && X - half < b);

/** How far from the heart each row's trees may stand, west and east, and the clearing round it. */
const REACH: Record<Row["name"], { west: number; east: number; clear: number }> = {
  front: { west: 300, east: 1532, clear: 96 },
  mid: { west: 268, east: 1600, clear: 76 },
  back: { west: 214, east: 1640, clear: 84 },
};

interface Seed {
  i: number;
  m: Member;
  rowIndex: number;
  art: Art;
  frames: Sprite[] | null;
  /** Half the room the tree wants, in its layer's pixels. */
  want: number;
}

/**
 * Plants the forest. Each row's members are dealt to the two sides of the heart in tenure order,
 * then spread out along their side, oldest nearest, newest at the valley's edges, with uneven
 * spacing and now and then two friends side by side. Each tree is then moved the least it must be
 * to keep clear of the guild's places and not stand on another tree.
 */
export function plantForest(layers: readonly Layer[], season: Season): Planted[] {
  const seeds: Seed[] = ROSTER.map((m, i) => {
    const rowIndex = rowFor(m);
    const row = ROWS[rowIndex] ?? ROWS[0];
    const grown = grow(m, season, rowIndex === 2);
    // Within a row, trees differ a little in size, as they would at slightly different depths.
    const jitter = rowIndex === 2 ? 1 : 0.92 + hash3(i, 9, 4) * 0.16;
    let art = shrink(grown.art, (row?.scale ?? 1) * jitter);
    if (rowIndex === 0) art = recede(art);
    const body = rowIndex === 2 && grown.frames ? Math.max(art.sprite.w, grown.frames[0]?.w ?? 0) : art.sprite.w;
    return { i, m, rowIndex, art, frames: grown.frames, want: (body / 2) * (rowIndex === 2 ? 0.85 : 0.62) };
  });
  const planted: Planted[] = [];
  for (const rowIndex of [0, 1, 2]) {
    const row = ROWS[rowIndex];
    const layer = layers[rowIndex];
    if (!row || !layer) continue;
    const reach = REACH[row.name];
    const members = seeds.filter((sd) => sd.rowIndex === rowIndex);
    // Deal to sides: alternate, with a nudge now and then so the two sides never mirror.
    const sides: Record<"-1" | "1", Seed[]> = { "-1": [], "1": [] };
    members.forEach((sd, k) => {
      let side = k % 2 === 0 ? -1 : 1;
      if (hash3(sd.i, 5, 9) < 0.2) side = -side;
      sides[side < 0 ? "-1" : "1"].push(sd);
    });
    for (const side of [-1, 1] as const) {
      const list = sides[side < 0 ? "-1" : "1"];
      const limit = side < 0 ? HEART_X - reach.west : reach.east - HEART_X;
      let d = reach.clear;
      list.forEach((sd, k) => {
        // Spacing grows toward the edge: the grove thins outward. Friends stand close.
        const room = (limit - reach.clear) / Math.max(1, list.length);
        const step =
          k === 0
            ? 0
            : hash3(sd.i, 4, 2) < 0.22
              ? room * 0.25
              : room * (0.55 + 0.9 * hash3(sd.i, 3, 1)) * (0.75 + (k / list.length) * 0.5);
        d = Math.min(limit, d + step);
        const target = HEART_X + side * d;
        const X = settle(row, rowIndex, sd, target, side, planted);
        d = Math.max(d, Math.abs(X - HEART_X));
        // Small trees scatter in depth across their row's ground, so new growth never stands in a line.
        const small = sd.m.stage === "seedling" || sd.m.stage === "sapling";
        const spread = rowIndex === 2 ? (small ? 14 : 6) : small ? 7 : 4;
        let foot = row.foot + Math.round((hash3(sd.i, 2, 7) - 0.45) * spread);
        if (rowIndex === 2 && X > 920) foot = Math.min(foot, 229);
        const lx = layer.lx(X);
        const art = sd.art;
        planted.push({
          id: sd.i + 1,
          member: sd.m,
          row,
          rowIndex,
          X,
          foot,
          art,
          sway: rowIndex === 2 && sd.frames ? sd.frames : null,
          box: { x0: lx - art.ax, y0: foot - art.ay, x1: lx - art.ax + art.sprite.w, y1: foot - art.ay + art.sprite.h },
        });
      });
    }
  }
  return planted.toSorted((a, b) => a.id - b.id);
}

/** The nearest spot to `target` (searching outward first) that is clear of places and other trees. */
function settle(
  row: Row,
  rowIndex: number,
  sd: Seed,
  target: number,
  side: number,
  planted: readonly Planted[],
): number {
  const f = row.f;
  const half = sd.want / f;
  const free = (X: number, room: number): boolean =>
    !blocked(row, X, half * room) &&
    !planted.some((p) => p.rowIndex === rowIndex && Math.abs(p.X - X) * f < (seedWant(p) + sd.want) * room);
  for (const room of [1, 0.75, 0.5]) {
    for (let d = 0; d < 700; d++) {
      for (const dir of [side, -side]) {
        const X = target + dir * d;
        if (free(X, room)) return X;
      }
    }
  }
  return target;
}

const seedWant = (p: Planted): number => {
  const body = p.sway ? Math.max(p.art.sprite.w, p.sway[0]?.w ?? 0) : p.art.sprite.w;
  return (body / 2) * (p.rowIndex === 2 ? 0.85 : 0.62);
};

/** The back row sits in the valley's haze: a step darker, its gold kept. */
function recede(art: Art): Art {
  const out = sprite(art.sprite.w, art.sprite.h);
  for (let i = 0; i < out.data.length; i++) {
    const v = art.sprite.data[i] ?? 0;
    if (!v) continue;
    const r = v >> 3;
    const l = v & 7;
    out.data[i] = (r === R.FOLI || r === R.BARK || r === R.MOSS) && l > 0 ? v - 1 : v;
  }
  return { sprite: out, ax: art.ax, ay: art.ay };
}

/**
 * Paints the trees into their row layers, back to front within each row, recording which tree
 * owns each pixel. A tree's needle carpet stays under its neighbours rather than over their roots.
 */
export function paintTrees(layers: readonly Layer[], planted: readonly Planted[]): void {
  const byRow = [0, 1, 2].map((r) => planted.filter((p) => p.rowIndex === r).toSorted((a, b) => a.foot - b.foot));
  byRow.forEach((trees, r) => {
    const layer = layers[r];
    if (!layer) return;
    for (const p of trees) {
      const { sprite: sp, ax, ay } = p.art;
      const x0 = layer.lx(p.X) - ax;
      const y0 = p.foot - ay;
      for (let y = 0; y < sp.h; y++) {
        const ty = y0 + y;
        if (ty < 0 || ty >= layer.s.h) continue;
        for (let x = 0; x < sp.w; x++) {
          const tx = x0 + x;
          if (tx < 0 || tx >= layer.w) continue;
          const v = sp.data[y * sp.w + x] ?? 0;
          if (!v) continue;
          const i = ty * layer.w + tx;
          // Needle carpet and pebbles are ground: under any neighbour, and not part of the tree.
          const ground = y >= ay - 3 && (v >> 3 === R.SOIL || v >> 3 === R.STONE);
          if (ground) {
            if ((layer.owner?.[i] ?? 0) === 0) layer.s.data[i] = v;
            continue;
          }
          layer.s.data[i] = v;
          if (layer.owner) layer.owner[i] = p.id;
        }
      }
    }
  });
}
