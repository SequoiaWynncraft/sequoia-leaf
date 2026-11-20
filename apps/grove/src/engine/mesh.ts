/**
 * Turns a part of the world into triangles. Every corner carries its own light: the sky's, the
 * lamps', how much of the low sun reaches it, and how tucked into a corner it is. Smooth light and
 * soft corners come from that, not from anything painted.
 */
import { BLOCKS, type Box, type FaceTiles, OCC } from "./blocks.ts";
import { ihash } from "./rand.ts";
import type { World } from "./world.ts";

type V3 = readonly [number, number, number];
export const FACES: readonly { n: V3; c: readonly [V3, V3, V3, V3] }[] = [
  {
    n: [1, 0, 0],
    c: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    n: [-1, 0, 0],
    c: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    n: [0, 1, 0],
    c: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    n: [0, -1, 0],
    c: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    n: [0, 0, 1],
    c: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    n: [0, 0, -1],
    c: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
];

export const uvOf = (face: number, x: number, y: number, z: number): [number, number] =>
  face === 0
    ? [1 - z, y]
    : face === 1
      ? [z, y]
      : face === 2
        ? [x, 1 - z]
        : face === 3
          ? [x, z]
          : face === 4
            ? [x, y]
            : [1 - x, y];

/** How dark a corner is with none, one, two or three of the cells round it solid. */
const AO = [1, 0.8, 0.62, 0.46];
/** What a face is, for the shader: plain, giving its own light, foliage (which sways and lets light through), or a plant. */
export const PLAIN = 0;
export const GLOWS = 1;
export const LEAFY = 2;
export const PLANT = 3;
/** A lawn's top, and the grass and fern that grow on it: both take the meadow's drifting colour. */
export const LAWN = 4;
export const WILD = 5;
/** Floats per corner: position 3, uv 2, tile 1, kind 1, normal 3, sky 1, glow 1, sun 1, ao 1. */
export const STRIDE = 14;

export class Mesh {
  data = new Float32Array(1 << 16);
  index = new Uint32Array(1 << 14);
  nv = 0;
  ni = 0;

  private room(): void {
    if ((this.nv + 4) * STRIDE > this.data.length) {
      const d = new Float32Array(this.data.length * 2);
      d.set(this.data);
      this.data = d;
    }
    if (this.ni + 6 > this.index.length) {
      const d = new Uint32Array(this.index.length * 2);
      d.set(this.index);
      this.index = d;
    }
  }

  /** One four-cornered face. `lights` holds sky, glow, sun and ao for each corner. */
  quad(
    pos: readonly V3[],
    uv: readonly (readonly [number, number])[],
    tile: number,
    emit: number,
    n: V3,
    lights: readonly number[],
  ): void {
    this.room();
    const base = this.nv;
    for (let k = 0; k < 4; k++) {
      const o = this.nv * STRIDE;
      const p = pos[k]!;
      this.data.set(
        [
          p[0],
          p[1],
          p[2],
          uv[k]![0],
          uv[k]![1],
          tile,
          emit,
          n[0],
          n[1],
          n[2],
          lights[k * 4]!,
          lights[k * 4 + 1]!,
          lights[k * 4 + 2]!,
          lights[k * 4 + 3]!,
        ],
        o,
      );
      this.nv++;
    }
    // Split the face along the diagonal that keeps the corner shading even.
    const a = lights[3]! + lights[11]! + (lights[0]! + lights[8]!) * 0.01;
    const b = lights[7]! + lights[15]! + (lights[4]! + lights[12]!) * 0.01;
    if (a >= b) this.index.set([base, base + 1, base + 2, base, base + 2, base + 3], this.ni);
    else this.index.set([base + 1, base + 2, base + 3, base + 1, base + 3, base], this.ni);
    this.ni += 6;
  }
}

const FULL: Box["from"] = [0, 0, 0];
const FULL_TO: Box["to"] = [16, 16, 16];

/** Meshes the cells in a box of the world. */
export function meshRegion(w: World, sun: V3, x0: number, z0: number, x1: number, z1: number): Mesh {
  const m = new Mesh();
  const lights = new Array<number>(16).fill(0);
  const shade = new Float32Array(4);

  /**
   * How much of the sun reaches the air of one cell, seen from a face looking along `f`: four rays
   * from just off the surface, so the edge of a shadow is a soft step and not a hard one. Asked for
   * again and again by neighbouring corners, so it is kept.
   */
  const sunny = new Map<number, number>();
  const sunCell = (x: number, y: number, z: number, f: number): number => {
    if (!w.inside(x, y, z)) return 1;
    const key = w.idx(x, y, z) * 6 + f;
    const known = sunny.get(key);
    if (known !== undefined) return known;
    const n = FACES[f]!.n;
    const axis = n[0] ? 0 : n[1] ? 1 : 2;
    let lit = 0;
    if (w.skyAt(x, y, z) > 0)
      for (let k = 0; k < 4; k++) {
        const p = [x + 0.5 - n[0] * 0.42, y + 0.5 - n[1] * 0.42, z + 0.5 - n[2] * 0.42];
        p[(axis + 1) % 3]! += k & 1 ? 0.25 : -0.25;
        p[(axis + 2) % 3]! += k & 2 ? 0.25 : -0.25;
        lit += w.sun(p[0]!, p[1]!, p[2]!, sun) / 4;
      }
    sunny.set(key, lit);
    return lit;
  };

  /**
   * The light at a point of a surface facing along `f`: the four cells of air round the point, in
   * the layer the surface looks into, blended by how near each is. Every surface in the world asks
   * here (a cube's corner, a stair's edge, a fence post), so light runs smoothly from one to the
   * next. `shade` gets sky, glow, sun and how tucked into a corner the point is.
   */
  const corner = (px: number, py: number, pz: number, f: number, sunFacing: boolean, soft: number): void => {
    const n = FACES[f]!.n;
    const axis = n[0] ? 0 : n[1] ? 1 : 2;
    const a1 = (axis + 1) % 3;
    const a2 = (axis + 2) % 3;
    const p = [px, py, pz];
    const cell = [0, 0, 0];
    cell[axis] = Math.floor(p[axis]! + n[axis]! * 0.01);
    const u0 = Math.floor(p[a1]! - 0.5);
    const v0 = Math.floor(p[a2]! - 0.5);
    const fu = p[a1]! - 0.5 - u0;
    const fv = p[a2]! - 0.5 - v0;
    const open = [false, false, false, false];
    for (let k = 0; k < 4; k++) {
      cell[a1] = u0 + (k & 1);
      cell[a2] = v0 + (k >> 1);
      open[k] = w.occ(cell[0]!, cell[1]!, cell[2]!) !== 2;
    }
    let sky = 0;
    let glow = 0;
    let lit = 0;
    let total = 0;
    let shut = 0;
    for (let k = 0; k < 4; k++) {
      const wgt = (k & 1 ? fu : 1 - fu) * (k >> 1 ? fv : 1 - fv);
      // A cell reached only between two solid ones is as good as solid: no light comes that way.
      if (!open[k] || (!open[k ^ 1] && !open[k ^ 2] && open[k ^ 3])) {
        shut += wgt;
        continue;
      }
      cell[a1] = u0 + (k & 1);
      cell[a2] = v0 + (k >> 1);
      sky += w.skyAt(cell[0]!, cell[1]!, cell[2]!) * wgt;
      glow += w.glowAt(cell[0]!, cell[1]!, cell[2]!) * wgt;
      if (sunFacing) lit += sunCell(cell[0]!, cell[1]!, cell[2]!, f) * wgt;
      total += wgt;
    }
    const steps = Math.min(3, shut * 4);
    const lo = Math.floor(steps);
    const ao = AO[lo]! + (AO[Math.min(3, lo + 1)]! - AO[lo]!) * (steps - lo);
    shade[0] = total ? sky / total / 15 : 0;
    shade[1] = total ? glow / total / 15 : 0;
    shade[2] = total ? lit / total : 0;
    shade[3] = 1 - (1 - ao) * soft;
  };

  /** Whether a cell has open air on any side. */
  const open = (x: number, y: number, z: number): boolean =>
    w.occ(x + 1, y, z) === 0 ||
    w.occ(x - 1, y, z) === 0 ||
    w.occ(x, y + 1, z) === 0 ||
    w.occ(x, y - 1, z) === 0 ||
    w.occ(x, y, z + 1) === 0 ||
    w.occ(x, y, z - 1) === 0;

  /** A box inside a cell: a whole cube, or a slab, a stair's step, a post. Each corner takes the light of where it is. */
  const boxAt = (
    x: number,
    y: number,
    z: number,
    from: Box["from"],
    to: Box["to"],
    tiles: FaceTiles,
    kind: number,
    turned?: readonly boolean[],
    spin = 0,
    top = kind,
  ): void => {
    const leafy = kind === LEAFY;
    const soft = leafy ? 0.5 : 1;
    for (let f = 0; f < 6; f++) {
      const { n, c } = FACES[f]!;
      // A face flush against a solid neighbour is never seen.
      const flush =
        (n[0] > 0 && to[0] === 16) ||
        (n[0] < 0 && from[0] === 0) ||
        (n[1] > 0 && to[1] === 16) ||
        (n[1] < 0 && from[1] === 0) ||
        (n[2] > 0 && to[2] === 16) ||
        (n[2] < 0 && from[2] === 0);
      if (flush) {
        const o = w.occ(x + n[0], y + n[1], z + n[2]);
        // Between two blocks of foliage a face is kept near the outside of a crown, where it is
        // seen through the gaps in the leaves, and dropped deep inside, where it never is.
        if (o === 2 || (leafy && o === 1 && !(open(x, y, z) && open(x + n[0], y + n[1], z + n[2])))) continue;
      }
      // Light comes through foliage, so its faces turned from the sun take some too.
      const facing = leafy || n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2] > 0.02;
      const pos: V3[] = [];
      const uv: [number, number][] = [];
      for (let k = 0; k < 4; k++) {
        const lx = (c[k]![0] ? to[0] : from[0]) / 16;
        const ly = (c[k]![1] ? to[1] : from[1]) / 16;
        const lz = (c[k]![2] ? to[2] : from[2]) / 16;
        pos.push([x + lx, y + ly, z + lz]);
        const [u, v] = uvOf(f, lx, ly, lz);
        const [tu, tv] = turned?.[f] ? [v, 1 - u] : [u, v];
        const s = f === 2 ? spin : 0;
        uv.push(s === 1 ? [tv, 1 - tu] : s === 2 ? [1 - tu, 1 - tv] : s === 3 ? [1 - tv, tu] : [tu, tv]);
        corner(x + lx, y + ly, z + lz, f, facing, soft);
        lights.splice(k * 4, 4, shade[0]!, shade[1]!, shade[2]!, shade[3]!);
      }
      m.quad(pos, uv, tiles[f]!, f === 2 ? top : kind, n, lights);
    }
  };

  /**
   * A plant: two crossed sheets. As in the block games this follows, no two stand quite alike: each
   * is nudged off the middle of its block by where it stands, some are mirrored, and wild grass
   * sits a little lower on some blocks than on others. That is what keeps a meadow off the grid.
   */
  const crossAt = (x: number, y: number, z: number, tile: number, emit: boolean, wild: boolean): void => {
    w.lightAt(x + 0.5, y + 0.5, z + 0.5, shade);
    const sky = shade[0]! / 15;
    const glow = shade[1]! / 15;
    const lit = sunCell(x, y, z, 2);
    for (let k = 0; k < 4; k++) lights.splice(k * 4, 4, sky, glow, lit, 1);
    const up: V3 = [0, 1, 0];
    const flip = !emit && ihash(x, z, 1, 91) < 0.5;
    const uv: [number, number][] = flip
      ? [
          [1, 0],
          [0, 0],
          [0, 1],
          [1, 1],
        ]
      : [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ];
    const dx = emit ? 0 : (ihash(x, z, 2, 91) - 0.5) * 0.5;
    const dz = emit ? 0 : (ihash(x, z, 3, 91) - 0.5) * 0.5;
    const sink = wild ? ihash(x, z, 4, 91) * 0.22 : 0;
    const kind = emit ? GLOWS : wild ? WILD : PLANT;
    const sheets: [number, number, number, number][] = [
      [0.1, 0.1, 0.9, 0.9],
      [0.1, 0.9, 0.9, 0.1],
    ];
    for (const [ax, az, bx, bz] of sheets) {
      const p: V3[] = [
        [x + ax + dx, y - sink, z + az + dz],
        [x + bx + dx, y - sink, z + bz + dz],
        [x + bx + dx, y + 1 - sink, z + bz + dz],
        [x + ax + dx, y + 1 - sink, z + az + dz],
      ];
      m.quad(p, uv, tile, kind, up, lights);
      m.quad([p[1]!, p[0]!, p[3]!, p[2]!], [uv[1]!, uv[0]!, uv[3]!, uv[2]!], tile, kind, up, lights);
    }
  };

  for (let y = 0; y < w.sy; y++)
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) {
        const id = w.blocks[w.idx(x, y, z)]!;
        if (!id) continue;
        const def = BLOCKS[id]!;
        // Each block wears one of its drawings and turns its top one of four ways, by where it stands.
        const pick = Math.floor(ihash(x, y, z, 3) * ((def.alts?.length ?? 0) + 1));
        if (def.tiles) {
          const tiles = pick ? def.alts![pick - 1]! : def.tiles;
          const spin = def.scatter ? Math.floor(ihash(x, y, z, 5) * 4) : 0;
          const kind = def.foliage ? LEAFY : def.glows ? GLOWS : PLAIN;
          boxAt(x, y, z, FULL, FULL_TO, tiles, kind, def.turned, spin, def.lawn ? LAWN : kind);
          continue;
        }
        for (const b of def.boxes ?? []) boxAt(x, y, z, b.from, b.to, b.tiles, b.emit ? GLOWS : PLAIN);
        if (def.cross) {
          const tiles = def.cross.tiles;
          crossAt(x, y, z, tiles[Math.floor(ihash(x, y, z, 7) * tiles.length)]!, !!def.cross.emit, !!def.cross.wild);
        }
        if (def.fence) {
          const arms: [number, number, Box["from"], Box["to"], Box["from"], Box["to"]][] = [
            [1, 0, [10, 11, 7], [16, 14, 9], [10, 5, 7], [16, 8, 9]],
            [-1, 0, [0, 11, 7], [6, 14, 9], [0, 5, 7], [6, 8, 9]],
            [0, 1, [7, 11, 10], [9, 14, 16], [7, 5, 10], [9, 8, 16]],
            [0, -1, [7, 11, 0], [9, 14, 6], [7, 5, 0], [9, 8, 6]],
          ];
          for (const [dx, dz, f1, t1, f2, t2] of arms) {
            const nb = w.get(x + dx, y, z + dz);
            if (nb !== id && OCC[nb] !== 2) continue;
            boxAt(x, y, z, f1, t1, def.boxes![0]!.tiles, PLAIN);
            boxAt(x, y, z, f2, t2, def.boxes![0]!.tiles, PLAIN);
          }
        }
      }
  return m;
}
