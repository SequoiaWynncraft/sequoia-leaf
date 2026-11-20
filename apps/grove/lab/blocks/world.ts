/** The voxel grid, the block registry and the chunk mesher (per-corner AO, sky visibility, gentle tints). */
import type { BufferGeometry } from "three";
import { FACES, GeoBuilder, type V3 } from "./geo.ts";
import { clamp, hash3, noise2 } from "./rng.ts";
import { tile } from "./textures.ts";

export const B = {
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  StoneMoss: 4,
  StoneMossy: 5,
  Moss: 6,
  Bark: 7,
  BarkMoss: 8,
  BarkMossy: 9,
  Leaf: 10,
  Litter: 11,
  LogX: 12,
  LogZ: 13,
  Char: 14,
  Boulder: 15,
  BoulderMoss: 16,
  LogY: 17,
} as const;
export type Block = (typeof B)[keyof typeof B];

const TREE = new Set<number>([B.Bark, B.BarkMoss, B.BarkMossy, B.Leaf, B.LogX, B.LogZ, B.Char, B.LogY]);
export const isTree = (b: number): boolean => TREE.has(b);
export const isLeaf = (b: number): boolean => b === B.Leaf;
export const isSolid = (b: number): boolean => b !== B.Air && b !== B.Leaf;

export interface Season {
  winter: boolean;
}

/** Which tile a block shows on a face. Variants come from the position, so neighbours never stamp. */
function faceTile(b: number, face: number, x: number, y: number, z: number, season: Season, snowTop: boolean): string {
  const h = hash3(x, y, z, b);
  const v3 = Math.floor(h * 3);
  const v2 = Math.floor(h * 2);
  const top = face === 2;
  const bottom = face === 3;
  switch (b) {
    case B.Grass:
      if (season.winter) return top ? `snow${v2}` : bottom ? `dirt${v3}` : `snowside${v2}`;
      return top ? `grass${v3}` : bottom ? `dirt${v3}` : `grassside${v3}`;
    case B.Litter:
      if (season.winter && top && snowTop) return `snow${v2}`;
      return top ? `litter${v3}` : bottom ? `dirt${v3}` : season.winter && snowTop ? `snowside${v2}` : `dirt${v3}`;
    case B.Dirt:
      return `dirt${v3}`;
    case B.Stone:
      if (season.winter && top && snowTop) return `snow${v2}`;
      return `stone${v3}`;
    case B.StoneMoss:
      if (season.winter && top && snowTop) return `snow${v2}`;
      return `stonemoss${v2}`;
    case B.StoneMossy:
      if (season.winter && top && snowTop) return `snow${v2}`;
      return top ? `moss${v2}` : `stonemossy${v2}`;
    case B.Moss:
      if (season.winter && top && snowTop) return `snow${v2}`;
      return `moss${v2}`;
    case B.Boulder:
      if (season.winter && top && snowTop) return `snow${v2}`;
      return `boulder${v2}`;
    case B.BoulderMoss:
      if (season.winter && top && snowTop) return `snow${v2}`;
      return top ? `moss${v2}` : `bouldermoss${v2}`;
    case B.Bark:
      if (top || bottom) return season.winter && top && snowTop ? `snow${v2}` : `bark${v3}`;
      return `bark${v3}`;
    case B.BarkMoss:
      if (top) return season.winter && snowTop ? `snow${v2}` : `moss${v2}`;
      return `barkmoss${v2}`;
    case B.BarkMossy:
      if (top) return season.winter && snowTop ? `snow${v2}` : `moss${v2}`;
      return `barkmossy${v2}`;
    case B.LogY:
      return top || bottom ? "logend" : `bark${v3}`;
    case B.LogX:
      if (face === 0 || face === 1) return "logend";
      if (top && season.winter && snowTop) return `snow${v2}`;
      return `bark${v3}`;
    case B.LogZ:
      if (face === 4 || face === 5) return "logend";
      if (top && season.winter && snowTop) return `snow${v2}`;
      return `bark${v3}`;
    case B.Char:
      return `char${v2}`;
    case B.Leaf:
      if (season.winter) {
        if (top && snowTop) return `leafsnowtop${v3}`;
        if (!top && !bottom && snowTop) return `leafsnowside${v3}`;
        return `leafw${v3}`;
      }
      return `leaf${v3}`;
    default:
      return "dirt0";
  }
}

/** Horizontal logs lie on their side: rotate the side texture so the furrows run along the log. */
function rotatedRect(b: number, face: number): [number, number, number, number] | null {
  if (b === B.LogX && (face === 2 || face === 3 || face === 4 || face === 5)) return null;
  if (b === B.LogZ && (face === 0 || face === 1 || face === 2 || face === 3)) return null;
  return [0, 0, 16, 16];
}

const AO = [0.4, 0.6, 0.8, 1.0];

export class Voxels {
  static readonly SX = 64;
  static readonly SY = 104;
  static readonly SZ = 64;
  static readonly OX = 32;
  static readonly OY = 28;
  static readonly OZ = 32;
  readonly data = new Uint8Array(Voxels.SX * Voxels.SY * Voxels.SZ);
  /** Foliage cluster id per cell, for pruning a pad at a time. */
  readonly cluster = new Uint16Array(Voxels.SX * Voxels.SY * Voxels.SZ);
  /** Sway weight per leaf cell (0..1). */
  readonly sway = new Float32Array(Voxels.SX * Voxels.SY * Voxels.SZ);

  index(x: number, y: number, z: number): number {
    const ix = x + Voxels.OX;
    const iy = y + Voxels.OY;
    const iz = z + Voxels.OZ;
    if (ix < 0 || iy < 0 || iz < 0 || ix >= Voxels.SX || iy >= Voxels.SY || iz >= Voxels.SZ) return -1;
    return (iy * Voxels.SZ + iz) * Voxels.SX + ix;
  }
  get(x: number, y: number, z: number): number {
    const i = this.index(x, y, z);
    return i < 0 ? B.Air : (this.data[i] ?? B.Air);
  }
  set(x: number, y: number, z: number, b: number, cluster = 0): void {
    const i = this.index(x, y, z);
    if (i < 0) return;
    this.data[i] = b;
    this.cluster[i] = cluster;
  }
  clusterAt(x: number, y: number, z: number): number {
    const i = this.index(x, y, z);
    return i < 0 ? 0 : (this.cluster[i] ?? 0);
  }
  /** Highest non-air block in a column, or -99. */
  top(x: number, z: number, from = 70): number {
    for (let y = from; y > -Voxels.OY; y--) if (this.get(x, y, z) !== B.Air) return y;
    return -99;
  }
}

export interface MeshSet {
  terrain: BufferGeometry;
  tree: BufferGeometry;
  leaves: BufferGeometry;
}

/** Transmittance toward the sky along five upward rays, 0..1; foliage lets some light through. */
function skyVisibility(w: Voxels, x: number, y: number, z: number, cache: Map<number, number>): number {
  const key = w.index(x, y, z);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const rays = [
    [0, 1, 0, 0.36],
    [1, 1, 0, 0.16],
    [-1, 1, 0, 0.16],
    [0, 1, 1, 0.16],
    [0, 1, -1, 0.16],
  ] as const;
  let vis = 0;
  for (const [dx, dy, dz, weight] of rays) {
    let t = 1;
    for (let k = 1; k <= 16 && t > 0.02; k++) {
      const b = w.get(x + dx * k, y + dy * k, z + dz * k);
      if (b === B.Leaf) t *= 0.72;
      else if (b !== B.Air) t *= 0.1;
    }
    vis += t * weight;
  }
  cache.set(key, vis);
  return vis;
}

/** Low-frequency tint so big surfaces never read as one stamped tile. */
function tintOf(b: number, x: number, y: number, z: number, winter: boolean): V3 {
  const n = noise2(x * 0.11 + 3.1, z * 0.11 - 7.4, 17);
  const m = noise2(x * 0.3, z * 0.3 + y * 0.2, 23);
  if (b === B.Grass && !winter) return [0.93 + 0.12 * n, 0.96 + 0.07 * n, 1.02 - 0.08 * n];
  if (b === B.Leaf) {
    const k = noise2(x * 0.18 + y * 0.12, z * 0.18, 29);
    return [0.94 + 0.1 * k, 0.97 + 0.06 * k, 1.0 - 0.04 * k];
  }
  const s = 0.95 + 0.08 * m;
  return [s, s, s];
}

export function meshWorld(w: Voxels, season: Season, leafDepth: Map<number, number>): MeshSet {
  const terrain = new GeoBuilder();
  const tree = new GeoBuilder();
  const leaves = new GeoBuilder();
  const cache = new Map<number, number>();
  const occludes = (b: number) => (b === B.Leaf ? 0.6 : b === B.Air ? 0 : 1);
  for (let iy = 0; iy < Voxels.SY; iy++)
    for (let iz = 0; iz < Voxels.SZ; iz++)
      for (let ix = 0; ix < Voxels.SX; ix++) {
        const i = (iy * Voxels.SZ + iz) * Voxels.SX + ix;
        const b = w.data[i] ?? 0;
        if (b === B.Air) continue;
        const x = ix - Voxels.OX;
        const y = iy - Voxels.OY;
        const z = iz - Voxels.OZ;
        const leaf = b === B.Leaf;
        const above = w.get(x, y + 1, z);
        const snowTop = season.winter && (above === B.Air || (above === B.Leaf && !leaf) ? true : false) && skyVisibility(w, x, y + 1, z, cache) > 0.18;
        const tint = tintOf(b, x, y, z, season.winter);
        const out = leaf ? leaves : isTree(b) ? tree : terrain;
        const depth = leaf ? (leafDepth.get(i) ?? 1) : 0;
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          if (!face) continue;
          const [nx, ny, nz] = face.n;
          const nb = w.get(x + nx, y + ny, z + nz);
          if (leaf) {
            if (isSolid(nb)) continue;
            if (nb === B.Leaf) {
              const ndepth = leafDepth.get(w.index(x + nx, y + ny, z + nz)) ?? 1;
              if (depth > 2 || ndepth > 2) continue;
            }
          } else if (isSolid(nb)) continue;
          // Corner AO from the layer in front of the face.
          const ao: number[] = [];
          const axes = [0, 1, 2].filter((k) => face.n[k] === 0);
          const ax0 = axes[0] ?? 0;
          const ax1 = axes[1] ?? 2;
          for (const c of face.c) {
            const a = [0, 0, 0];
            const bdir = [0, 0, 0];
            a[ax0] = c[ax0] ? 1 : -1;
            bdir[ax1] = c[ax1] ? 1 : -1;
            const px = x + nx;
            const py = y + ny;
            const pz = z + nz;
            const s1 = occludes(w.get(px + (a[0] ?? 0), py + (a[1] ?? 0), pz + (a[2] ?? 0)));
            const s2 = occludes(w.get(px + (bdir[0] ?? 0), py + (bdir[1] ?? 0), pz + (bdir[2] ?? 0)));
            const cc = occludes(w.get(px + (a[0] ?? 0) + (bdir[0] ?? 0), py + (a[1] ?? 0) + (bdir[1] ?? 0), pz + (a[2] ?? 0) + (bdir[2] ?? 0)));
            const level = s1 >= 1 && s2 >= 1 ? 0 : 3 - (s1 + s2 + cc);
            const lo = Math.floor(clamp(level, 0, 3));
            const frac = clamp(level, 0, 3) - lo;
            ao.push((AO[lo] ?? 1) * (1 - frac) + (AO[Math.min(3, lo + 1)] ?? 1) * frac);
          }
          const sky = 0.22 + 0.78 * skyVisibility(w, x + nx, y + ny, z + nz, cache);
          const name = faceTile(b, f, x, y, z, season, snowTop);
          const corners = face.c.map((c) => [x + c[0], y + c[1], z + c[2]] as V3) as unknown as [V3, V3, V3, V3];
          const sway = leaf ? (w.sway[i] ?? 0) : 0;
          const rect = rotatedRect(b, f);
          if (rect) {
            out.quad(corners, face.n, tile(name), rect, ao as unknown as [number, number, number, number], tint, { emissive: 0, sway, sky, frames: 0 });
          } else {
            // Sideways log: rotate corners so the texture's vertical furrows run along the log's axis.
            const rc: [V3, V3, V3, V3] = [corners[3], corners[0], corners[1], corners[2]];
            const ra = [ao[3], ao[0], ao[1], ao[2]] as unknown as [number, number, number, number];
            out.quad(rc, face.n, tile(name), [0, 0, 16, 16], ra, tint, { emissive: 0, sway, sky, frames: 0 });
          }
        }
      }
  return { terrain: terrain.build(), tree: tree.build(), leaves: leaves.build() };
}

/** Distance from each leaf to open air, up to 3, so inner faces are drawn only near the surface (fancy leaves). */
export function leafDepths(w: Voxels): Map<number, number> {
  const depth = new Map<number, number>();
  let frontier: [number, number, number][] = [];
  for (let iy = 0; iy < Voxels.SY; iy++)
    for (let iz = 0; iz < Voxels.SZ; iz++)
      for (let ix = 0; ix < Voxels.SX; ix++) {
        const i = (iy * Voxels.SZ + iz) * Voxels.SX + ix;
        if (w.data[i] !== B.Leaf) continue;
        const x = ix - Voxels.OX;
        const y = iy - Voxels.OY;
        const z = iz - Voxels.OZ;
        for (const f of FACES) {
          if (w.get(x + f.n[0], y + f.n[1], z + f.n[2]) === B.Air) {
            depth.set(i, 1);
            frontier.push([x, y, z]);
            break;
          }
        }
      }
  for (let d = 2; d <= 3; d++) {
    const next: [number, number, number][] = [];
    for (const [x, y, z] of frontier)
      for (const f of FACES) {
        const nx = x + f.n[0];
        const ny = y + f.n[1];
        const nz = z + f.n[2];
        const j = w.index(nx, ny, nz);
        if (j < 0 || w.data[j] !== B.Leaf || depth.has(j)) continue;
        depth.set(j, d);
        next.push([nx, ny, nz]);
      }
    frontier = next;
  }
  return depth;
}
