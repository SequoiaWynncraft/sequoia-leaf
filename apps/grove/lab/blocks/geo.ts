/** A merged-geometry builder for block faces, box-model elements and crossed-quad plants. */
import { BufferAttribute, BufferGeometry, type Matrix4, Vector3 } from "three";
import { ATLAS, type Tile } from "./textures.ts";

export type V3 = readonly [number, number, number];

/** Per-vertex effects: emissive strength, sway weight, sky light, animation frames. */
export interface Fx {
  emissive: number;
  sway: number;
  sky: number;
  frames: number;
}

export const FX: Fx = { emissive: 0, sway: 0, sky: 1, frames: 0 };

/** Face order: +X, -X, +Y, -Y, +Z, -Z. Corners TL, TR, BR, BL as seen from outside, texture top at the top. */
export const FACES: { n: V3; c: [V3, V3, V3, V3] }[] = [
  {
    n: [1, 0, 0],
    c: [
      [1, 1, 1],
      [1, 1, 0],
      [1, 0, 0],
      [1, 0, 1],
    ],
  },
  {
    n: [-1, 0, 0],
    c: [
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
      [0, 0, 0],
    ],
  },
  {
    n: [0, 1, 0],
    c: [
      [0, 1, 0],
      [1, 1, 0],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    n: [0, -1, 0],
    c: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 0, 0],
      [0, 0, 0],
    ],
  },
  {
    n: [0, 0, 1],
    c: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    n: [0, 0, -1],
    c: [
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 0],
      [1, 0, 0],
    ],
  },
];

const tmp = new Vector3();
const tmpN = new Vector3();

export class GeoBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private loc: number[] = [];
  private ao: number[] = [];
  private tint: number[] = [];
  private fx: number[] = [];
  private bone: number[] = [];
  private idx: number[] = [];
  private count = 0;

  /** `texSize` is the texture's width in texels: the atlas by default, or a mob's skin. */
  private readonly texSize: number;
  constructor(texSize = ATLAS) {
    this.texSize = texSize;
  }

  get vertexCount(): number {
    return this.count;
  }

  /**
   * One textured quad. `rect` is the texel rectangle [u0, v0, u1, v1] inside the tile (0..16),
   * mapped TL→(u0,v0), TR→(u1,v0), BR→(u1,v1), BL→(u0,v1).
   */
  quad(
    corners: readonly [V3, V3, V3, V3],
    normal: V3,
    tile: Tile,
    rect: readonly [number, number, number, number] = [0, 0, 16, 16],
    ao: readonly [number, number, number, number] = [1, 1, 1, 1],
    tint: V3 = [1, 1, 1],
    fx: Fx = FX,
    bone = 0,
    sway?: readonly [number, number, number, number],
  ): void {
    const [u0, v0, u1, v1] = rect;
    const uvs = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ] as const;
    const locs = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const;
    for (let i = 0; i < 4; i++) {
      const c = corners[i] ?? [0, 0, 0];
      this.pos.push(c[0], c[1], c[2]);
      this.nrm.push(normal[0], normal[1], normal[2]);
      const t = uvs[i] ?? [0, 0];
      this.uv.push(tile.u + t[0] / this.texSize, tile.v + t[1] / this.texSize);
      const l = locs[i] ?? [0, 0];
      this.loc.push(l[0], l[1]);
      this.ao.push(ao[0], ao[1], ao[2], ao[3]);
      this.tint.push(tint[0], tint[1], tint[2]);
      this.fx.push(fx.emissive, sway ? (sway[i] ?? 0) : fx.sway, fx.sky, fx.frames);
      this.bone.push(bone);
    }
    const b = this.count;
    this.idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
    this.count += 4;
  }

  /**
   * A box-model element from `from` to `to` in sixteenths of a block. Each face takes a tile and an optional
   * texel rect; the default rect projects the box onto the face, the way block models auto-map UVs.
   */
  box(
    from: V3,
    to: V3,
    faces: (null | { tile: Tile; rect?: readonly [number, number, number, number]; ao?: readonly [number, number, number, number] })[],
    opts: { matrix?: Matrix4; tint?: V3; fx?: Fx; bone?: number; origin?: V3; scale?: number } = {},
  ): void {
    const s = (opts.scale ?? 1) / 16;
    const o = opts.origin ?? [0, 0, 0];
    FACES.forEach((face, fi) => {
      const spec = faces[fi];
      if (!spec) return;
      const corners = face.c.map((c) => {
        tmp.set(
          o[0] + (c[0] ? to[0] : from[0]) * s,
          o[1] + (c[1] ? to[1] : from[1]) * s,
          o[2] + (c[2] ? to[2] : from[2]) * s,
        );
        if (opts.matrix) tmp.applyMatrix4(opts.matrix);
        return [tmp.x, tmp.y, tmp.z] as V3;
      }) as unknown as [V3, V3, V3, V3];
      tmpN.set(face.n[0], face.n[1], face.n[2]);
      if (opts.matrix) tmpN.transformDirection(opts.matrix);
      const rect = spec.rect ?? autoRect(fi, from, to);
      this.quad(corners, [tmpN.x, tmpN.y, tmpN.z], spec.tile, rect, spec.ao, opts.tint, opts.fx, opts.bone ?? 0);
    });
  }

  /** Two crossed quads, Minecraft plant style; the top edge sways. Normals point up so plants light like the ground. */
  cross(x: number, y: number, z: number, tile: Tile, size = 1, height = 1, tint: V3 = [1, 1, 1], fx: Fx = FX, angle = 0): void {
    const h = size * height;
    const r = (size * Math.SQRT1_2) / 1;
    for (let k = 0; k < 2; k++) {
      const a = angle + Math.PI / 4 + (k * Math.PI) / 2;
      const dx = Math.cos(a) * r * 0.5 * Math.SQRT2;
      const dz = Math.sin(a) * r * 0.5 * Math.SQRT2;
      const corners: [V3, V3, V3, V3] = [
        [x - dx, y + h, z - dz],
        [x + dx, y + h, z + dz],
        [x + dx, y, z + dz],
        [x - dx, y, z - dz],
      ];
      this.quad(corners, [0, 1, 0], tile, [0, 16 - 16 * height, 16, 16], [1, 1, 1, 1], tint, fx, 0, [fx.sway, fx.sway, 0, 0]);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute("local", new BufferAttribute(new Float32Array(this.loc), 2));
    g.setAttribute("aoc", new BufferAttribute(new Float32Array(this.ao), 4));
    g.setAttribute("tint", new BufferAttribute(new Float32Array(this.tint), 3));
    g.setAttribute("fx", new BufferAttribute(new Float32Array(this.fx), 4));
    g.setAttribute("bone", new BufferAttribute(new Float32Array(this.bone), 1));
    g.setIndex(this.count > 65535 ? new BufferAttribute(new Uint32Array(this.idx), 1) : new BufferAttribute(new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Block-model style automatic UVs: the box's footprint on each face, in texels, texture top up. */
function autoRect(face: number, f: V3, t: V3): [number, number, number, number] {
  switch (face) {
    case 0:
      return [16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1]];
    case 1:
      return [f[2], 16 - t[1], t[2], 16 - f[1]];
    case 2:
      return [f[0], f[2], t[0], t[2]];
    case 3:
      return [f[0], 16 - t[2], t[0], 16 - f[2]];
    case 4:
      return [f[0], 16 - t[1], t[0], 16 - f[1]];
    default:
      return [16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]];
  }
}
