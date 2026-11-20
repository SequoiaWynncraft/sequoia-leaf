/** The world: a box of blocks, with the light worked out for each cell. */
import { GLOW, OCC } from "./blocks.ts";

export class World {
  readonly blocks: Uint8Array;
  /** Light from the open sky, 0 to 15. */
  readonly sky: Float32Array;
  /** Light from lanterns, fires and windows, 0 to 15. */
  readonly glow: Float32Array;

  readonly sx: number;
  readonly sy: number;
  readonly sz: number;

  constructor(sx: number, sy: number, sz: number) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.blocks = new Uint8Array(sx * sy * sz);
    this.sky = new Float32Array(sx * sy * sz);
    this.glow = new Float32Array(sx * sy * sz);
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }
  idx(x: number, y: number, z: number): number {
    return x + this.sx * (z + this.sz * y);
  }
  get(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.blocks[this.idx(x, y, z)]! : 0;
  }
  set(x: number, y: number, z: number, id: number): void {
    if (this.inside(x, y, z)) this.blocks[this.idx(x, y, z)] = id;
  }
  /** Sets a cell only if it is air, so later pieces do not eat earlier ones. */
  fill(x: number, y: number, z: number, id: number): void {
    if (this.inside(x, y, z) && !this.blocks[this.idx(x, y, z)]) this.blocks[this.idx(x, y, z)] = id;
  }
  occ(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? OCC[this.blocks[this.idx(x, y, z)]!]! : y < 0 ? 2 : 0;
  }
  skyAt(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.sky[this.idx(x, y, z)]! : y < 0 ? 0 : 15;
  }
  glowAt(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.glow[this.idx(x, y, z)]! : 0;
  }

  /**
   * Both lights at any point, not only at a cell's middle: the cells round the point blended by
   * how near each is, leaving out solid ones. This is what makes light smooth across a wall, a
   * stair or a figure. `out` gets sky then glow, each 0 to 15.
   */
  lightAt(px: number, py: number, pz: number, out: Float32Array): void {
    const x0 = Math.floor(px - 0.5);
    const y0 = Math.floor(py - 0.5);
    const z0 = Math.floor(pz - 0.5);
    const fx = px - 0.5 - x0;
    const fy = py - 0.5 - y0;
    const fz = pz - 0.5 - z0;
    let sky = 0;
    let glow = 0;
    let total = 0;
    for (let k = 0; k < 8; k++) {
      const x = x0 + (k & 1);
      const y = y0 + ((k >> 1) & 1);
      const z = z0 + (k >> 2);
      const wgt = (k & 1 ? fx : 1 - fx) * ((k >> 1) & 1 ? fy : 1 - fy) * (k >> 2 ? fz : 1 - fz);
      if (wgt <= 0 || this.occ(x, y, z) === 2) continue;
      sky += this.skyAt(x, y, z) * wgt;
      glow += this.glowAt(x, y, z) * wgt;
      total += wgt;
    }
    out[0] = total ? sky / total : 0;
    out[1] = total ? glow / total : 0;
  }

  /**
   * Works out both lights for the whole world by flooding outward from the sky and from every
   * lamp. Light steps to the cells beside a cell and to those diagonal to it across an edge, losing
   * as much as the distance, so a lamp's pool is round rather than a diamond.
   */
  light(): void {
    const { sx, sy, sz, blocks, sky, glow } = this;
    sky.fill(0);
    glow.fill(0);
    const N = sx * sy * sz;
    const queue = new Int32Array(N);
    const queued = new Uint8Array(N);
    const steps: [number, number, number, number][] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const axes = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
          if (axes === 1 || axes === 2) steps.push([dx, dy, dz, axes === 1 ? 1 : Math.SQRT2]);
        }
    const solid = (x: number, y: number, z: number): boolean => OCC[blocks[x + sx * (z + sz * y)]!] === 2;
    const flood = (field: Float32Array, count: number): void => {
      let head = 0;
      let tail = count % N;
      let size = count;
      while (size > 0) {
        const i = queue[head]!;
        head = (head + 1) % N;
        size--;
        queued[i] = 0;
        const v = field[i]!;
        if (v <= 1) continue;
        const x = i % sx;
        const z = Math.floor(i / sx) % sz;
        const y = Math.floor(i / (sx * sz));
        for (const [dx, dy, dz, cost] of steps) {
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
          const j = nx + sx * (nz + sz * ny);
          const o = OCC[blocks[j]!]!;
          if (o === 2) continue;
          const nv = v - cost - (o === 1 ? 1 : 0);
          if (nv <= field[j]! + 0.01) continue;
          // Light does not squeeze between two solid cells that touch along an edge.
          if (cost > 1) {
            const a = dx ? solid(nx, y, z) : solid(x, ny, z);
            const b = dz ? solid(x, y, nz) : solid(x, ny, z);
            if (a && b) continue;
          }
          field[j] = nv;
          if (!queued[j]) {
            queued[j] = 1;
            queue[tail] = j;
            tail = (tail + 1) % N;
            size++;
          }
        }
      }
    };
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        let v = 15;
        for (let y = sy - 1; y >= 0 && v > 0; y--) {
          const i = x + sx * (z + sz * y);
          const o = OCC[blocks[i]!]!;
          if (o === 2) break;
          if (o === 1) v = Math.max(0, v - 2);
          sky[i] = v;
        }
      }
    // Only cells on the edge of the lit air have anything to pass on.
    let n = 0;
    for (let i = 0; i < N; i++) {
      const v = sky[i]!;
      if (v <= 1) continue;
      const x = i % sx;
      const z = Math.floor(i / sx) % sz;
      const edge =
        (x > 0 && sky[i - 1]! < v - 1) ||
        (x < sx - 1 && sky[i + 1]! < v - 1) ||
        (z > 0 && sky[i - sx]! < v - 1) ||
        (z < sz - 1 && sky[i + sx]! < v - 1) ||
        (i >= sx * sz && sky[i - sx * sz]! < v - 1);
      if (edge) {
        queued[i] = 1;
        queue[n++] = i;
      }
    }
    flood(sky, n);
    n = 0;
    for (let i = 0; i < N; i++) {
      const g = GLOW[blocks[i]!]!;
      if (g) {
        glow[i] = g;
        queued[i] = 1;
        queue[n++] = i;
      }
    }
    flood(glow, n);
  }

  /** How much of the low sun reaches a point: 1 in the open, 0 behind wood or earth, between through foliage. */
  sun(px: number, py: number, pz: number, dir: readonly [number, number, number]): number {
    const { sx, sy, sz, blocks } = this;
    let x = px + dir[0] * 0.6;
    let y = py + dir[1] * 0.6;
    let z = pz + dir[2] * 0.6;
    let through = 1;
    for (let i = 0; i < 400; i++) {
      x += dir[0] * 0.5;
      y += dir[1] * 0.5;
      z += dir[2] * 0.5;
      if (y >= sy || x < 0 || z < 0 || x >= sx || z >= sz) return through;
      if (y < 0) return 0;
      const o = OCC[blocks[(x | 0) + sx * ((z | 0) + sz * (y | 0))]!]!;
      if (o === 2) return 0;
      if (o === 1) {
        through *= 0.66;
        if (through < 0.06) return 0;
      }
    }
    return through;
  }
}
