import { tileIndex } from "../art/tiles.ts";
/**
 * Turns a part of the world into triangles. Every corner carries its own light: the sky's, the
 * lamps', how much of the low sun reaches it, and how tucked into a corner it is. Smooth light and
 * soft corners come from that, not from anything painted.
 */
import { B, BLOCKS, type Box, type FaceTiles, OCC } from "./blocks.ts";
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

const FRINGE = [tileIndex("moss_fringe0"), tileIndex("moss_fringe1")];
const CREEP = [tileIndex("moss_creep0"), tileIndex("moss_creep1")];
const AO = [1, 0.8, 0.62, 0.46];
/** Floats per corner: position 3, uv 2, tile 1, emit 1, normal 3, sky 1, glow 1, sun 1, ao 1. */
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

  /** A cube face on the cell grid, lit and shaded corner by corner from the cells in front of it. */
  const cubeFace = (
    x: number,
    y: number,
    z: number,
    f: number,
    tile: number,
    turned: boolean,
    foliage: boolean,
    spin: number,
    lift = 0,
  ): void => {
    const { n, c } = FACES[f]!;
    const qx = x + n[0];
    const qy = y + n[1];
    const qz = z + n[2];
    const facing = n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2];
    const pos: V3[] = [];
    const uv: [number, number][] = [];
    for (let k = 0; k < 4; k++) {
      const [cx, cy, cz] = c[k]!;
      pos.push([x + cx + n[0] * lift, y + cy + n[1] * lift, z + cz + n[2] * lift]);
      const [u, v] = uvOf(f, cx, cy, cz);
      const [tu, tv] = turned ? [v, 1 - u] : [u, v];
      uv.push(spin === 1 ? [tv, 1 - tu] : spin === 2 ? [1 - tu, 1 - tv] : spin === 3 ? [1 - tv, tu] : [tu, tv]);
      // The two cells beside this corner in the layer in front of the face, and the one diagonal to it.
      const d: [number, number, number] = [cx ? 1 : -1, cy ? 1 : -1, cz ? 1 : -1];
      const axis = n[0] ? 0 : n[1] ? 1 : 2;
      const a1 = (axis + 1) % 3;
      const a2 = (axis + 2) % 3;
      const s1: [number, number, number] = [qx, qy, qz];
      const s2: [number, number, number] = [qx, qy, qz];
      const cr: [number, number, number] = [qx, qy, qz];
      s1[a1]! += d[a1]!;
      s2[a2]! += d[a2]!;
      cr[a1]! += d[a1]!;
      cr[a2]! += d[a2]!;
      const o1 = w.occ(s1[0], s1[1], s1[2]) === 2;
      const o2 = w.occ(s2[0], s2[1], s2[2]) === 2;
      const oc = (o1 && o2) || w.occ(cr[0], cr[1], cr[2]) === 2;
      let sky = w.skyAt(qx, qy, qz);
      let glow = w.glowAt(qx, qy, qz);
      let cells = 1;
      if (!o1) {
        sky += w.skyAt(s1[0], s1[1], s1[2]);
        glow += w.glowAt(s1[0], s1[1], s1[2]);
        cells++;
      }
      if (!o2) {
        sky += w.skyAt(s2[0], s2[1], s2[2]);
        glow += w.glowAt(s2[0], s2[1], s2[2]);
        cells++;
      }
      if (!oc) {
        sky += w.skyAt(cr[0], cr[1], cr[2]);
        glow += w.glowAt(cr[0], cr[1], cr[2]);
        cells++;
      }
      let lit = 0;
      if (facing > 0.02 && sky > 0) {
        // A point a little in from the corner, just off the face.
        lit = w.sun(
          x + cx + (0.5 - cx) * 0.5 + n[0] * 0.05,
          y + cy + (0.5 - cy) * 0.5 + n[1] * 0.05,
          z + cz + (0.5 - cz) * 0.5 + n[2] * 0.05,
          sun,
        );
      }
      const soft = foliage ? 0.5 : 1;
      lights[k * 4] = sky / cells / 15;
      lights[k * 4 + 1] = glow / cells / 15;
      lights[k * 4 + 2] = lit;
      lights[k * 4 + 3] = 1 - (1 - AO[(o1 ? 1 : 0) + (o2 ? 1 : 0) + (oc ? 1 : 0)]!) * soft;
    }
    m.quad(pos, uv, tile, 0, n, lights);
  };

  /** The tile of a drawing N blocks wide that belongs to the block at x, y, z on face f. */
  const piece = (wide: number, N: number, f: number, x: number, y: number, z: number): number => {
    const mod = (v: number): number => ((v % N) + N) % N;
    const col = f === 0 ? mod(-z) : f === 1 ? mod(z) : f === 5 ? mod(-x) : mod(x);
    const row = f === 2 ? mod(z) : f === 3 ? mod(-z) : mod(-y);
    return wide + row * N + col;
  };

  /** A box inside a cell, lit flat by the cell's own light. */
  const boxAt = (
    x: number,
    y: number,
    z: number,
    from: Box["from"],
    to: Box["to"],
    tiles: FaceTiles,
    emit: boolean,
    wide?: number,
    wideN = 1,
  ): void => {
    const sky = w.skyAt(x, y, z) / 15;
    const glow = w.glowAt(x, y, z) / 15;
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
      if (flush && w.occ(x + n[0], y + n[1], z + n[2]) === 2) continue;
      const pos: V3[] = [];
      const uv: [number, number][] = [];
      for (let k = 0; k < 4; k++) {
        const lx = (c[k]![0] ? to[0] : from[0]) / 16;
        const ly = (c[k]![1] ? to[1] : from[1]) / 16;
        const lz = (c[k]![2] ? to[2] : from[2]) / 16;
        pos.push([x + lx, y + ly, z + lz]);
        uv.push(uvOf(f, lx, ly, lz));
      }
      const facing = n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2];
      const lit =
        facing > 0.02 && sky > 0 ? w.sun(x + 0.5 + n[0] * 0.3, y + 0.5 + n[1] * 0.3, z + 0.5 + n[2] * 0.3, sun) : 0;
      for (let k = 0; k < 4; k++) lights.splice(k * 4, 4, sky, glow, lit, 1);
      m.quad(pos, uv, wide == null ? tiles[f]! : piece(wide, wideN, f, x, y, z), emit ? 1 : 0, n, lights);
    }
  };

  const crossAt = (x: number, y: number, z: number, tile: number, emit: boolean): void => {
    const sky = w.skyAt(x, y, z) / 15;
    const glow = w.glowAt(x, y, z) / 15;
    const lit = sky > 0 ? w.sun(x + 0.5, y + 0.6, z + 0.5, sun) : 0;
    for (let k = 0; k < 4; k++) lights.splice(k * 4, 4, sky, glow, lit, 1);
    const up: V3 = [0, 1, 0];
    const uv: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const sheets: [number, number, number, number][] = [
      [0.1, 0.1, 0.9, 0.9],
      [0.1, 0.9, 0.9, 0.1],
    ];
    for (const [ax, az, bx, bz] of sheets) {
      const p: V3[] = [
        [x + ax, y, z + az],
        [x + bx, y, z + bz],
        [x + bx, y + 1, z + bz],
        [x + ax, y + 1, z + az],
      ];
      m.quad(p, uv, tile, emit ? 1 : 0, up, lights);
      m.quad([p[1]!, p[0]!, p[3]!, p[2]!], [uv[1]!, uv[0]!, uv[3]!, uv[2]!], tile, emit ? 1 : 0, up, lights);
    }
  };

  for (let y = 0; y < w.sy; y++)
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) {
        const id = w.blocks[w.idx(x, y, z)]!;
        if (!id) continue;
        const def = BLOCKS[id]!;
        if (def.opaque || def.foliage) {
          for (let f = 0; f < 6; f++) {
            const n = FACES[f]!.n;
            const there = w.inside(x + n[0], y + n[1], z + n[2])
              ? w.blocks[w.idx(x + n[0], y + n[1], z + n[2])]!
              : y + n[1] < 0
                ? id
                : 0;
            const o = OCC[there]!;
            if (o === 2 || (def.foliage && o === 1)) continue;
            // Only faces that have no up or down are turned: a mossy side keeps its moss on top.
            let spin = def.scatter && (def.foliage || f === 2) ? Math.floor(ihash(x, y, z, f) * 4) : 0;
            let tile = def.tiles![f]!;
            const wide = def.macro?.[f];
            if (wide != null) {
              // The piece of the wide drawing that belongs to this block's place on this face.
              tile = piece(wide, def.macroN ?? 1, f, x, y, z);
              spin = 0;
            }
            cubeFace(x, y, z, f, tile, def.turned?.[f] ?? false, !!def.foliage, spin);
            const pick = ihash(x, y, z, 11 + f) < 0.5 ? 0 : 1;
            if (f === 2 && def.fringed) {
              // Moss on a neighbouring block creeps over this bare block's edge.
              const sides = [
                [0, -1, 0],
                [-1, 0, 1],
                [0, 1, 2],
                [1, 0, 3],
              ] as const;
              for (const [dx, dz, turn] of sides)
                if (w.get(x + dx, y, z + dz) === B.moss && OCC[w.get(x + dx, y + 1, z + dz)] !== 2)
                  cubeFace(x, y, z, 2, FRINGE[pick]!, false, false, turn, 0.012);
            }
            if (f !== 2 && f !== 3 && id === B.bark) {
              const under = w.get(x, y - 1, z);
              if (under === B.moss || under === B.duff) cubeFace(x, y, z, f, CREEP[pick]!, false, false, 0, 0.012);
            }
          }
          continue;
        }
        for (const b of def.boxes ?? []) boxAt(x, y, z, b.from, b.to, b.tiles, !!b.emit, b.wide, b.wideN);
        if (def.cross) crossAt(x, y, z, def.cross.tile, !!def.cross.emit);
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
            boxAt(x, y, z, f1, t1, def.boxes![0]!.tiles, false, def.boxes![0]!.wide, def.boxes![0]!.wideN);
            boxAt(x, y, z, f2, t2, def.boxes![0]!.tiles, false, def.boxes![0]!.wide, def.boxes![0]!.wideN);
          }
        }
      }
  void FULL;
  void FULL_TO;
  return m;
}
