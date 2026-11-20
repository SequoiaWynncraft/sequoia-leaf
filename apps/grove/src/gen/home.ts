/**
 * A member's own grove: a small clearing with their sequoia in the middle of it, a fire to sit by,
 * and room for what they will build. The tree's size is its level, so growing it is rebuilding this.
 */
import { tileIndex } from "../art/tiles.ts";
import { B } from "../engine/blocks.ts";
import { FACES, LAWN, LEAFY, Mesh, PLAIN, uvOf } from "../engine/mesh.ts";
import { ihash, noise2 } from "../engine/rand.ts";
import { World } from "../engine/world.ts";
import { growSequoia } from "./sequoia.ts";

type V3 = [number, number, number];
export const SIZE = 64;
export const C = 32;
const G = 8;
/** The tree's height and girth at each level: a seedling to a giant. */
const HEIGHT = [6, 9, 13, 17, 22, 28, 35, 43, 52, 62, 73, 85, 98];
const GIRTH = [0.5, 0.6, 0.8, 1.0, 1.3, 1.7, 2.1, 2.6, 3.1, 3.6, 4.2, 4.8, 5.4];

export interface Find {
  readonly at: V3;
  readonly tile: string;
  /** The colours it scatters when picked. */
  readonly petals: readonly string[];
}
export interface Home {
  readonly world: World;
  readonly ground: number;
  readonly fire: V3;
  /** Where spirits live, one for each kind, in an arc round the far side of the fire. */
  readonly spots: readonly V3[];
  /** Where cones come to rest, by the tree's foot on the side the grove is looked at from. */
  readonly rest: readonly V3[];
  /** Flowers and mushrooms to find. */
  readonly finds: readonly Find[];
}
export const treeHeight = (level: number): number => HEIGHT[Math.min(level, HEIGHT.length - 1)]!;
export const treeGirth = (level: number): number => GIRTH[Math.min(level, GIRTH.length - 1)]!;

const GIRTHS = GIRTH;
/** The clearing and the old forest round it, without the member's tree: built once, kept, and laid down again at every growth. */
let base: Uint8Array | null = null;
function clearing(w: World): Uint8Array {
  w.blocks.fill(0);
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) {
      const litter = Math.hypot(x - C - 7, z - C - 6) < 2.6;
      for (let y = 0; y < G; y++) w.set(x, y, z, y === G - 1 ? (litter ? B.duff! : B.moss!) : B.dirt!);
    }
  // The old forest stands round the clearing: giants at its edge, so the grove is a room among them.
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * 6.283 + ihash(i, 1, 0, 31) * 0.3;
    const r = 26 + ihash(i, 2, 0, 31) * 3.5;
    // The side the grove is looked at from is left open.
    if (Math.abs(Math.atan2(Math.sin(a - 1.1), Math.cos(a - 1.1))) < 0.75) continue;
    growSequoia(w, {
      x: Math.round(C + Math.cos(a) * r),
      z: Math.round(C + Math.sin(a) * r),
      ground: G,
      height: 74 + Math.round(ihash(i, 3, 0, 31) * 30),
      girth: 2.6 + ihash(i, 4, 0, 31) * 1.6,
      seed: 40 + i,
    });
  }
  // The fire, a seat, a lantern on a barrel.
  w.set(C + 7, G, C + 6, B.firepit!);
  for (const dx of [-1, 0, 1]) w.set(C + 7 + dx, G, C + 9, B.log_x!);
  w.set(C + 10, G, C + 5, B.crate!);
  w.set(C + 10, G + 1, C + 5, B.lantern!);
  for (let z = 2; z < SIZE - 2; z++)
    for (let x = 2; x < SIZE - 2; x++) {
      if (w.get(x, G, z) || w.get(x, G - 1, z) !== B.moss || Math.hypot(x - C, z - C) < 9) continue;
      const h = ihash(x, 1, z, 9);
      const wild = 0.25 + noise2(x / 8, z / 8, 6) * 0.5;
      // Flowers and mushrooms are not blocks here: they are things to find, and the game draws and regrows them.
      if (h < wild * 0.7 && h < 0.97) w.set(x, G, z, ihash(x, 2, z, 9) < 0.18 ? B.fern! : B.grass!);
    }
  return w.blocks.slice();
}

/** Lays the grove down for a tree of this level. */
export function plant(w: World, level: number): void {
  base ??= clearing(w);
  w.blocks.set(base);
  const girth = GIRTHS[Math.min(level, GIRTHS.length - 1)]!;
  // Needles lie under the tree.
  for (let z = C - 12; z <= C + 12; z++)
    for (let x = C - 12; x <= C + 12; x++)
      if (Math.hypot(x - C, z - C) < girth * 1.6 + 1.5 + ihash(x, 0, z, 5) * 1.5) w.set(x, G - 1, z, B.duff!);
  growSequoia(w, { x: C, z: C, ground: G, height: treeHeight(level), girth, seed: 1 });
  w.light();
}

/**
 * What lies beyond the grove, built once: the meadow running on to the horizon, and the forest
 * standing in it as far as the haze. The trees are plain square trunks with a few masses of
 * foliage, a tile to a block like everything else; from the clearing they are the forest's depth.
 */
export function beyond(): Mesh {
  const m = new Mesh();
  const lights = new Array<number>(16).fill(0);
  const light = (sky: number, sun: number, ao: number): void => {
    for (let k = 0; k < 4; k++) lights.splice(k * 4, 4, sky, 0, sun, ao);
  };
  const UV: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  // The meadow: one great sheet, coloured by the world as every lawn is, so it has no seam with the grove's own.
  const R = 420;
  light(1, 1, 1);
  m.quad(
    [
      [C - R, G - 0.02, C + R],
      [C + R, G - 0.02, C + R],
      [C + R, G - 0.02, C - R],
      [C - R, G - 0.02, C - R],
    ],
    UV,
    tileIndex("grass_top"),
    LAWN,
    [0, 1, 0],
    lights,
  );
  const bark = [tileIndex("log"), tileIndex("log1"), tileIndex("log2")];
  const leaves = [tileIndex("leaves"), tileIndex("leaves1")];
  /** A box of whole blocks from (x0, y0, z0), `sx` by `sy` by `sz`, its faces one tile to a block. */
  const box = (
    x0: number,
    y0: number,
    z0: number,
    sx: number,
    sy: number,
    sz: number,
    tiles: number[],
    kind: number,
    sky: number,
  ): void => {
    const size = [sx, sy, sz];
    const from = [x0, y0, z0];
    for (let f = 0; f < 6; f++) {
      if (f === 3) continue;
      const { n, c } = FACES[f]!;
      const axis = n[0] ? 0 : n[1] ? 1 : 2;
      const a1 = (axis + 1) % 3;
      const a2 = (axis + 2) % 3;
      light(sky * (f === 2 ? 1 : 0.9), 1, f === 2 ? 1 : 0.85);
      for (let u = 0; u < size[a1]!; u++)
        for (let v = 0; v < size[a2]!; v++) {
          const cell = [0, 0, 0];
          cell[axis] = from[axis]! + (n[axis]! > 0 ? size[axis]! - 1 : 0);
          cell[a1] = from[a1]! + u;
          cell[a2] = from[a2]! + v;
          const pos = c.map((k) => [cell[0]! + k[0], cell[1]! + k[1], cell[2]! + k[2]] as const);
          const uv = c.map((k) => uvOf(f, k[0], k[1], k[2]));
          m.quad(pos, uv, tiles[Math.floor(ihash(cell[0]!, cell[1]!, cell[2]!, 3) * tiles.length)]!, kind, n, lights);
        }
    }
  };
  for (let i = 0; i < 42; i++) {
    const a = ihash(i, 1, 0, 61) * 6.283;
    const r = 40 + ihash(i, 2, 0, 61) ** 1.4 * 150;
    const x = Math.round(C + Math.cos(a) * r);
    const z = Math.round(C + Math.sin(a) * r);
    const wide = 4 + Math.floor(ihash(i, 3, 0, 61) * 4);
    // Far off, only the lower trunk is ever seen through the haze, so less of it is built.
    const tall = Math.round((r > 80 ? 40 : 62) + ihash(i, 4, 0, 61) * 24);
    box(x, G, z, wide, tall, wide, bark, PLAIN, 0.8);
    if (r > 80) continue;
    for (let k = 0; k < 3; k++) {
      const s = 5 + Math.floor(ihash(i, 5, k, 61) * 3);
      const bx = x + Math.round((ihash(i, 6, k, 61) - 0.5) * 12) - (s >> 1) + (wide >> 1);
      const bz = z + Math.round((ihash(i, 7, k, 61) - 0.5) * 12) - (s >> 1) + (wide >> 1);
      box(bx, G + Math.round(tall * (0.55 + k * 0.16)), bz, s, 3, s, leaves, LEAFY, 1);
    }
  }
  return m;
}

const FOUND: readonly (readonly [string, readonly string[]])[] = [
  ["dandelion", ["#fed639", "#ffec4f", "#f19d25"]],
  ["daisy", ["#f7f7f7", "#d6e8e8", "#faca34"]],
  ["cornflower", ["#466aeb", "#6c83e7", "#2a4cc7"]],
  ["poppy", ["#ed302c", "#bf2529", "#912214"]],
  ["mushroom_brown", ["#cc9978", "#b5947d", "#916d55"]],
  ["mushroom_red", ["#fe2a2a", "#e21212", "#f0ece0"]],
];
export function buildHome(level: number): Home {
  const world = new World(SIZE, 126, SIZE);
  plant(world, level);
  const fire: V3 = [C + 7.5, G + 0.25, C + 6.5];
  // An arc round the fire on the side away from the eye, in two rows.
  const spots: V3[] = Array.from({ length: 12 }, (_, i) => {
    const a = 3.86 + (i - 5.5) * 0.31;
    const r = 2.5 + (i % 2) * 1.5;
    return [fire[0] + Math.cos(a) * r, G, fire[2] + Math.sin(a) * r];
  });
  const rest: V3[] = Array.from({ length: 6 }, (_, i) => {
    const a = -0.35 + i * 0.36;
    const r = 6.2 + (i % 2) * 1.1;
    return [C + 0.5 + Math.cos(a) * r, G, C + 0.5 + Math.sin(a) * r];
  });
  // Things to find, in the lawn within reach of the eye: never under the tree, on the fire or where a spirit lives.
  const finds: Find[] = [];
  for (let i = 0; finds.length < 26 && i < 400; i++) {
    const x = C + Math.round((ihash(i, 1, 0, 77) - 0.35) * 40);
    const z = C + Math.round((ihash(i, 2, 0, 77) - 0.35) * 40);
    if (world.get(x, G, z) || world.get(x, G - 1, z) !== B.moss) continue;
    if (Math.hypot(x - C, z - C) < 10 || Math.hypot(x + 0.5 - fire[0], z + 0.5 - fire[2]) < 5.2) continue;
    if (finds.some((f) => Math.hypot(f.at[0] - x - 0.5, f.at[2] - z - 0.5) < 2.5)) continue;
    const [tile, petals] = FOUND[Math.floor(ihash(i, 3, 0, 77) * FOUND.length)]!;
    finds.push({ at: [x + 0.5, G, z + 0.5], tile, petals });
  }
  return { world, ground: G, fire, spots, rest, finds };
}
