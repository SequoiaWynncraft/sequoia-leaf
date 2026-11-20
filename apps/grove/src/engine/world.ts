/** The world: a box of blocks, with the light worked out for each cell. */
import { GLOW, OCC } from "./blocks.ts";

export class World {
  readonly blocks: Uint8Array;
  /** Light from the open sky, 0 to 15. */
  readonly sky: Uint8Array;
  /** Light from lanterns, fires and windows, 0 to 15. */
  readonly glow: Uint8Array;

  readonly sx: number;
  readonly sy: number;
  readonly sz: number;

  constructor(sx: number, sy: number, sz: number) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.blocks = new Uint8Array(sx * sy * sz);
    this.sky = new Uint8Array(sx * sy * sz);
    this.glow = new Uint8Array(sx * sy * sz);
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

  /** Works out both lights for the whole world by flooding outward from the sky and from every lamp. */
  light(): void {
    const { sx, sy, sz, blocks, sky, glow } = this;
    sky.fill(0);
    glow.fill(0);
    const queue = new Int32Array(sx * sy * sz);
    const flood = (field: Uint8Array, count: number): void => {
      let head = 0;
      let tail = count;
      const step = [1, -1, sx, -sx, sx * sz, -sx * sz];
      while (head < tail) {
        const i = queue[head++ % queue.length]!;
        const v = field[i]!;
        if (v <= 1) continue;
        const x = i % sx;
        const z = Math.floor(i / sx) % sz;
        const y = Math.floor(i / (sx * sz));
        for (let d = 0; d < 6; d++) {
          if ((d === 0 && x === sx - 1) || (d === 1 && x === 0)) continue;
          if ((d === 2 && z === sz - 1) || (d === 3 && z === 0)) continue;
          if ((d === 4 && y === sy - 1) || (d === 5 && y === 0)) continue;
          const j = i + step[d]!;
          const o = OCC[blocks[j]!]!;
          if (o === 2) continue;
          const nv = v - (o === 1 ? 2 : 1);
          if (nv > field[j]!) {
            field[j] = nv;
            queue[tail++ % queue.length] = j;
          }
        }
      }
    };
    let n = 0;
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        let v = 15;
        for (let y = sy - 1; y >= 0 && v > 0; y--) {
          const i = x + sx * (z + sz * y);
          const o = OCC[blocks[i]!]!;
          if (o === 2) break;
          if (o === 1) v = Math.max(0, v - 2);
          sky[i] = v;
          queue[n++] = i;
        }
      }
    flood(sky, n);
    n = 0;
    for (let i = 0; i < blocks.length; i++) {
      const g = GLOW[blocks[i]!]!;
      if (g) {
        glow[i] = g;
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
