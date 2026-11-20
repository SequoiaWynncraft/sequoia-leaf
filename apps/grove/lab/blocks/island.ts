/**
 * The floating glade: an island of earth whose sides show grass, dirt, mossy stone and warm stone strata,
 * tapering to a rocky keel. The layout is art-directed (fire front-left, lantern front-right, boulders behind);
 * only the tree comes from the player's seed.
 */
import { fbm2, hash2, noise2 } from "./rng.ts";
import type { TreeInfo } from "./tree.ts";
import { B, Voxels } from "./world.ts";

export const LAYOUT = {
  fire: [-5, 4] as const,
  cone: [-3.35, 5.45] as const,
  seat: { x: -8, z0: 2, z1: 5 },
  lantern: [4, 5] as const,
  crab: [-1.6, 6.6] as const,
  chickaree: [2.6, 2.4] as const,
  /** Mossy stones: centre x, z, base size in texels, mossy, turn. Behind the tree, by the fire, at the rim. */
  stones: [
    [6.2, -5.6, 30, true, 0.3],
    [7.9, -3.4, 16, false, 1.1],
    [8.7, -1.2, 12, true, 2.0],
    [-6.4, -5.8, 22, true, 0.9],
    [-7.6, -4.6, 12, false, 2.4],
    [-5.6, 1.6, 11, false, 0.5],
    [3.4, -8.6, 18, true, 1.7],
  ] as const,
};

/** Island outline radius at an angle: a soft irregular blob, never a circle. */
let islandScale = 1;
/** The glade widens as the tree grows, so a giant never stands on a pebble. */
export function setIslandScale(level: number): void {
  islandScale = 0.9 + Math.max(0, level - 1) * 0.022;
}

export function rim(theta: number): number {
  return islandScale * (11.6 + 1.3 * Math.sin(2 * theta + 0.7) + 0.9 * Math.sin(3 * theta + 2.1) + 0.45 * Math.sin(5 * theta + 4.0));
}

export function inIsland(x: number, z: number): boolean {
  const cx = x + 0.5;
  const cz = z + 0.5;
  return Math.hypot(cx, cz) < rim(Math.atan2(cz, cx));
}

/** Top block height of the island at a column. */
export function groundTop(x: number, z: number): number {
  const cx = x + 0.5;
  const cz = z + 0.5;
  const d = Math.hypot(cx, cz);
  const r = rim(Math.atan2(cz, cx));
  if (d >= r) return -99;
  let top = 0;
  // A low rise behind and to the right, where the boulders sit.
  if (((cx - 6.2) / 5.2) ** 2 + ((cz + 5.4) / 4.2) ** 2 < 1) top = 1;
  // The rim steps down a block in places, so the edge reads as weathered, not cut.
  if (d > r - 1.5 && noise2(x * 0.45, z * 0.45, 5) > 0.55) top -= 1;
  return top;
}

export interface Glade {
  plants: { x: number; y: number; z: number; tile: string; size: number; angle: number }[];
  ground: (x: number, z: number) => number;
}

export function buildIsland(w: Voxels): void {
  for (let x = -19; x <= 19; x++)
    for (let z = -19; z <= 19; z++) {
      const top = groundTop(x, z);
      if (top < -50) continue;
      const cx = x + 0.5;
      const cz = z + 0.5;
      const d = Math.hypot(cx, cz);
      const r = rim(Math.atan2(cz, cx));
      const k = Math.max(0, 1 - d / r);
      let bottom = -Math.round(2 + 9.5 * islandScale * k ** 0.8 + fbm2(x * 0.3, z * 0.3, 9) * 2.4);
      // A few keel spires hang lower: rock teeth under the island.
      for (const [sx, sz, extra] of [
        [1, -1, 5],
        [-3, 2, 3],
        [3, 3, 2],
      ] as const) {
        const dd = Math.hypot(x - sx, z - sz);
        if (dd < 2.2) bottom -= Math.round(extra * (1 - dd / 2.2));
      }
      const dirtDepth = 2 + (hash2(x, z, 11) > 0.6 ? 1 : 0);
      for (let y = bottom; y <= top; y++) {
        const depth = top - y;
        let b: number = B.Stone;
        if (depth === 0) b = B.Grass;
        else if (depth <= dirtDepth) b = B.Dirt;
        w.set(x, y, z, b);
      }
    }
  // Exposed upper stone on the sides grows moss; deeper faces stay bare strata.
  for (let x = -19; x <= 19; x++)
    for (let z = -19; z <= 19; z++) {
      const top = groundTop(x, z);
      if (top < -50) continue;
      for (let y = top - 2; y > top - 9; y--) {
        if (w.get(x, y, z) !== B.Stone) continue;
        const open = w.get(x + 1, y, z) === B.Air || w.get(x - 1, y, z) === B.Air || w.get(x, y, z + 1) === B.Air || w.get(x, y, z - 1) === B.Air || w.get(x, y - 1, z) === B.Air;
        if (!open) continue;
        const depth = top - y;
        const n = noise2(x * 0.5 + y * 0.3, z * 0.5, 13);
        if (depth <= 4 && n > 0.35) w.set(x, y, z, B.StoneMossy);
        else if (depth <= 6 && n > 0.5) w.set(x, y, z, B.StoneMoss);
      }
    }
  // The fallen log by the fire, a seat.
  for (let z = LAYOUT.seat.z0; z <= LAYOUT.seat.z1; z++) w.set(LAYOUT.seat.x, 1, z, B.LogZ);
}

/** Needle duff under the crown, with a ragged edge. */
export function litterUnder(w: Voxels, tree: TreeInfo): void {
  if (tree.seedling) {
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++) if (Math.hypot(x, z) < 1.8 && w.get(x, 0, z) === B.Grass) w.set(x, 0, z, B.Litter);
    return;
  }
  const r = tree.footprint + 1.2 + tree.spread * 0.42;
  for (let x = -18; x <= 18; x++)
    for (let z = -18; z <= 18; z++) {
      const top = w.top(x, z, 3);
      if (top < -50 || w.get(x, top, z) !== B.Grass) continue;
      const d = Math.hypot(x + 0.5 - tree.cx, z + 0.5 - tree.cz);
      const edge = r + (noise2(x * 0.6, z * 0.6, 21) - 0.5) * 2.6;
      if (d < edge) w.set(x, top, z, B.Litter);
    }
}

/** Plants in natural clusters round anchors: ferns between the roots and by the rocks, mushrooms in the shade. */
export function placePlants(w: Voxels, tree: TreeInfo, reserved: (x: number, z: number) => boolean): Glade["plants"] {
  const out: Glade["plants"] = [];
  const taken = new Set<string>();
  const put = (x: number, z: number, tile: string, size: number) => {
    const key = `${x},${z}`;
    if (taken.has(key) || reserved(x, z)) return;
    const top = w.top(x, z, 6);
    if (top < -50) return;
    const ground = w.get(x, top, z);
    if (ground !== B.Grass && ground !== B.Litter && ground !== B.Moss) return;
    if (w.get(x, top + 1, z) !== B.Air) return;
    taken.add(key);
    const jx = (hash2(x, z, 41) - 0.5) * 0.36;
    const jz = (hash2(x, z, 42) - 0.5) * 0.36;
    out.push({ x: x + 0.5 + jx, y: top + 1, z: z + 0.5 + jz, tile, size, angle: hash2(x, z, 43) * 0.6 - 0.3 });
  };
  const cluster = (ax: number, az: number, kinds: [string, number][], count: number, spread: number, salt: number) => {
    for (let i = 0; i < count; i++) {
      const a = hash2(i, salt, 51) * Math.PI * 2;
      const rr = Math.sqrt(hash2(i, salt, 52)) * spread;
      const [tile, size] = kinds[i % kinds.length] ?? ["fern0", 1];
      put(Math.round(ax + Math.cos(a) * rr), Math.round(az + Math.sin(a) * rr), tile, size * (0.85 + hash2(i, salt, 53) * 0.3));
    }
  };
  // Between the roots: ferns at uneven angles round the trunk.
  if (!tree.seedling) {
    const ring = tree.footprint + 1.2;
    const angles = [0.4, 1.9, 2.75, 4.3, 5.4];
    angles.forEach((a, i) => {
      if (i === 1 && tree.footprint < 2) return;
      cluster(tree.cx - 0.5 + Math.cos(a) * ring, tree.cz - 0.5 + Math.sin(a) * ring, i % 2 ? [["fern1", 1.2], ["fern0", 1.05]] : [["fern0", 1.25], ["sorrel", 0.8]], 3, 1.2, 100 + i);
    });
    // Mushrooms in the shade at the trunk's back.
    cluster(tree.cx - 0.5 - ring * 0.7, tree.cz - 0.5 - ring * 0.75, [["mushroom0", 0.8], ["mushroom1", 0.7]], 3, 1.0, 140);
  }
  // By the boulders behind.
  cluster(4.2, -4.0, [["fern0", 1.25], ["fern1", 1.1], ["mushroom1", 0.75]], 5, 1.7, 160);
  cluster(8.5, -0.5, [["fern1", 1.0], ["tuft", 0.9]], 3, 1.2, 170);
  cluster(-5.5, -4.6, [["fern0", 1.1], ["sorrel", 0.8], ["tuft", 0.9]], 4, 1.5, 175);
  // The log seat's ends: mushrooms on the shady side, a fern at the foot.
  put(LAYOUT.seat.x - 1, LAYOUT.seat.z1, "mushroom0", 0.75);
  put(LAYOUT.seat.x + 1, LAYOUT.seat.z0 - 1, "fern1", 1.0);
  put(LAYOUT.seat.x - 1, LAYOUT.seat.z0, "mushroom1", 0.7);
  // Island rim: grass tufts and sorrel where the ground falls away.
  cluster(7.5, 6.5, [["tuft", 0.9], ["sorrel", 0.8]], 4, 1.6, 180);
  cluster(-8.5, 7.5, [["tuft", 0.95], ["fern0", 1.0]], 3, 1.3, 190);
  cluster(0.5, 9.5, [["sorrel", 0.8], ["tuft", 0.85]], 3, 1.5, 200);
  cluster(-1.5, -9.5, [["fern1", 1.1], ["tuft", 0.9]], 4, 1.6, 210);
  cluster(9.5, -6.5, [["tuft", 0.9]], 2, 1.0, 220);
  if (tree.seedling) cluster(0, 0, [["sorrel", 0.7]], 3, 2.2, 230);
  return out;
}

export { Voxels };
