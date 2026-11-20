/** The campfire: a ring of logs round a fire between the giants, a hut, banners, a string of lights. */
import type { Actor, Wearer } from "../engine/actors.ts";
import { cat, leafling, string } from "../engine/actors.ts";
import { B } from "../engine/blocks.ts";
import { ihash, noise2 } from "../engine/rand.ts";
import { World } from "../engine/world.ts";
import { dressLeaves, growSequoia, type Tree } from "./sequoia.ts";

type V3 = [number, number, number];
const SIZE = 96;
const CX = 48;
const CZ = 48;

const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const ground = (x: number, z: number): number => {
  const rough = smoothstep(10, 22, Math.hypot(x - CX, z - CZ));
  return Math.round(10 + (noise2(x / 18, z / 18, 15) - 0.3) * 4 * rough + noise2(x / 6, z / 6, 16) * 1.2 * rough);
};

export interface Camp {
  world: World;
  actors: Actor[];
  fire: V3;
  banners: { at: V3; yaw: number }[];
  strings: { a: V3; b: V3; points: V3[] }[];
  glows: { at: V3; size: number; flicker: boolean }[];
  flies: V3[];
  eye: V3;
  look: V3;
}

export function buildCamp(sun: readonly [number, number, number], cast: Record<string, Wearer | undefined>): Camp {
  const w = new World(SIZE, 104, SIZE);
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) {
      const h = ground(x, z);
      const d = Math.hypot(x - CX, z - CZ);
      const bare =
        d < 3.4 + ihash(x, 0, z, 17) * 1.6 || noise2(x / 9, z / 9, 18) + noise2(x / 4, z / 4, 19) * 0.35 > 0.9;
      for (let y = 0; y < h; y++)
        w.set(x, y, z, y === h - 1 ? (bare ? B.duff! : B.moss!) : y > h - 4 ? B.dirt! : B.stone!);
    }
  const g = ground(CX, CZ);

  const spots: [number, number, number, number][] = [
    [-10, 13, 84, 4.6],
    [13, 11, 78, 4.2],
    [-16, 3, 88, 5.0],
    [-18, -12, 76, 4.2],
    [-5, -17, 90, 5.4],
    [7, -16, 70, 3.8],
    [16, -8, 86, 4.8],
    [18, 3, 74, 4.0],
    [10, -10, 13, 0.7],
  ];
  const trees: Tree[] = spots.map(([dx, dz, height, girth], i) => ({
    x: CX + dx,
    z: CZ + dz,
    ground: ground(CX + dx, CZ + dz),
    height,
    girth,
    seed: 50 + i,
  }));
  for (let i = 0; trees.length < 34 && i < 400; i++) {
    const a = ihash(i, 1, 0, 21) * 6.283;
    const r = 23 + ihash(i, 2, 0, 21) * 22;
    const x = Math.round(CX + Math.cos(a) * r);
    const z = Math.round(CZ + Math.sin(a) * r);
    if (Math.abs(Math.atan2(x - CX, z - CZ)) < 0.36 || x < 5 || z < 5 || x > SIZE - 6 || z > SIZE - 6) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 7 + t.girth)) continue;
    const big = ihash(i, 3, 0, 21);
    trees.push({ x, z, ground: ground(x, z), height: Math.round(50 + big * 40), girth: 2.4 + big * 2.4, seed: 70 + i });
  }
  for (const t of trees) growSequoia(w, t);
  dressLeaves(w, sun[0]);

  // The fire and its seats.
  w.set(CX, g, CZ, B.firepit!);
  for (let i = -1; i <= 1; i++) {
    w.set(CX + i, g, CZ - 4, B.log_x!);
    w.set(CX - 4, g, CZ + i, B.log_z!);
    w.set(CX + 4, g, CZ + i, B.log_z!);
  }
  w.set(CX + 6, g, CZ - 4, B.log!);
  for (const [x, y, z] of [
    [7, 0, 2],
    [8, 0, 2],
    [7, 1, 2],
    [7, 0, 3],
  ] as const)
    w.set(CX + x, g + y, CZ + z, B.log_z!);
  for (let x = -3; x <= -1; x++) for (let z = 3; z <= 4; z++) w.set(CX + x, g, CZ + z, B.rug!);
  w.set(CX - 5, g, CZ + 3, B.crate!);
  w.set(CX - 5, g + 1, CZ + 3, B.lantern!);
  w.set(CX + 8, g, CZ + 6, B.fence!);
  w.set(CX + 8, g + 1, CZ + 6, B.fence!);
  w.set(CX + 8, g + 2, CZ + 6, B.lantern!);

  // The hut: stone footing, log corners, a pitched slate roof with eaves, a chimney, a lit window.
  const hut = { x0: CX - 13, x1: CX - 9, z0: CZ - 8, z1: CZ - 4 };
  for (let z = hut.z0; z <= hut.z1; z++)
    for (let x = hut.x0; x <= hut.x1; x++) {
      const wall = x === hut.x0 || x === hut.x1 || z === hut.z0 || z === hut.z1;
      const corner = (x === hut.x0 || x === hut.x1) && (z === hut.z0 || z === hut.z1);
      for (let y = ground(x, z); y < g; y++) w.set(x, y, z, B.stone!);
      w.set(x, g, z, wall ? B.stone_mossy! : B.planks!);
      for (let y = g + 1; y <= g + 4; y++) w.set(x, y, z, corner ? B.log! : wall ? B.planks! : 0);
    }
  for (const y of [g + 1, g + 2]) w.set(hut.x1, y, CZ - 6, 0);
  w.set(CX - 11, g + 2, hut.z1, B.window!);
  w.set(hut.x1, g + 2, CZ - 5, 0);
  w.set(hut.x1, g + 2, CZ - 5, B.window!);
  w.set(CX - 11, g + 3, CZ - 6, B.lantern_hang!);
  for (let k = 0; k <= 2; k++)
    for (let z = hut.z0 - 1; z <= hut.z1 + 1; z++) {
      w.set(hut.x0 - 1 + k, g + 4 + k, z, B.slate_stairs_e!);
      w.set(hut.x1 + 1 - k, g + 4 + k, z, B.slate_stairs_w!);
      if (z === hut.z0 || z === hut.z1)
        for (let x = hut.x0 + k; x <= hut.x1 - k; x++) if (k > 0) w.set(x, g + 4 + k, z, B.planks!);
    }
  for (let z = hut.z0 - 1; z <= hut.z1 + 1; z++) w.set(CX - 11, g + 7, z, B.slate_slab!);
  for (let y = g + 1; y <= g + 8; y++) w.set(hut.x0 + 1, y, hut.z0 + 1, B.stone!);
  w.set(hut.x1 + 1, g + 3, CZ - 5, B.lantern_hang!);

  // Banner poles, and the string of lights from the hut across them to a tree.
  const poles: V3[] = [
    [CX - 5, g, CZ - 9],
    [CX + 4, g, CZ - 9],
  ];
  for (const [x, , z] of poles) for (let y = 0; y < 6; y++) w.set(x, g + y, z, B.fence!);
  const top = (p: V3): V3 => [p[0] + 0.5, g + 6, p[2] + 0.5];
  const ends: V3[] = [[hut.x1 + 1.5, g + 5, CZ - 5.5], top(poles[0]!), top(poles[1]!), [CX + 14.2, g + 7.5, CZ - 6]];
  const strings = [0, 1, 2].map((i) => ({
    a: ends[i]!,
    b: ends[i + 1]!,
    points: string(ends[i]!, ends[i + 1]!, i === 1 ? 6 : 4, 1.1),
  }));
  for (const s of strings)
    for (const p of s.points)
      if ((Math.round(p[0] * 7) & 1) === 0) w.fill(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]), B.light!);

  // The floor: ferns and grass at the edges, mushrooms by the trunks.
  for (let z = 1; z < SIZE - 1; z++)
    for (let x = 1; x < SIZE - 1; x++) {
      const y = ground(x, z);
      const under = w.get(x, y - 1, z);
      if (w.get(x, y, z) || (under !== B.moss && under !== B.duff)) continue;
      const d = Math.hypot(x - CX, z - CZ);
      const nearTrunk = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ].some(([dx, dz]) => w.get(x + dx!, y, z + dz!) === B.bark);
      const thick = smoothstep(5, 12, d) * (0.1 + noise2(x / 7, z / 7, 23) * 0.3) + (nearTrunk ? 0.3 : 0);
      const h = ihash(x, 0, z, 24);
      if (h < thick * (under === B.duff ? 0.2 : 0.55)) w.set(x, y, z, ihash(x, 1, z, 25) < 0.5 ? B.fern! : B.grass!);
      else if (under === B.moss && h > 0.9 && h < 0.928)
        w.set(x, y, z, h < 0.908 ? B.dandelion! : h < 0.916 ? B.daisy! : h < 0.922 ? B.cornflower! : B.poppy!);
      else if (h > 0.96 && h < 0.966) w.set(x, y, z, B.cone!);
      else if (d > 5 && (h > 0.99 || (nearTrunk && h > 0.93))) w.set(x, y, z, B.shroom!);
    }
  w.light();

  // Who is here.
  // A seated person's hips rest on the log's top.
  const seat = g + 1 - (12 / 16) * 0.9375;
  const standing: V3 = [CX + 2.4, g, CZ + 2.8];
  const people: (Actor | undefined)[] = [
    cast.herald?.([CX - 0.6, seat, CZ - 3.15], 0, 0.3, "sit"),
    cast.keeper?.([CX - 3.15, seat, CZ + 0.4], Math.PI / 2 - 0.25, 2.9, "sit"),
    cast.trader?.([CX + 4.15, seat, CZ - 0.2], -Math.PI / 2 + 0.3, 4.1, "sit"),
    cast.cook?.(standing, Math.atan2(CX + 0.5 - standing[0], CZ + 0.5 - standing[2]), 5.2, "roast"),
    cast.guest?.([CX - 2.5, g, CZ - 3.3], 0.35, 0.8, "wave"),
  ];
  const actors: Actor[] = [
    ...people.filter((p) => p !== undefined),
    leafling([CX + 1.3, g + 1, CZ - 3.45], 0.2, 0.4),
    leafling([CX - 2.2, g + 1 / 16, CZ + 3.7], 0.9, 1.6),
    leafling([CX - 0.9, g + 1 / 16, CZ + 4.5], 0.3, 2.5),
    leafling([CX + 5.6, g, CZ + 3.2], -1.2, 0.9),
    cat([CX + 6.5, g + 1, CZ - 3.5], 0.5),
  ];
  for (const a of actors) a.sun = w.sun(a.pos[0], a.pos[1] + 1, a.pos[2], sun);

  const glows: Camp["glows"] = [
    { at: [CX + 0.5, g + 1.1, CZ + 0.5], size: 9, flicker: true },
    { at: [CX - 4.5, g + 1.4, CZ + 3.5], size: 3.2, flicker: false },
    { at: [CX + 8.5, g + 2.4, CZ + 6.5], size: 3.2, flicker: false },
    { at: [hut.x1 + 1.5, g + 3.4, CZ - 4.5], size: 3.2, flicker: false },
    { at: [CX - 10.5, g + 2.5, hut.z1 + 1.1], size: 2.6, flicker: false },
    ...strings.flatMap((s) => s.points.map((p) => ({ at: p, size: 1.5, flicker: false }))),
  ];
  const flies: V3[] = Array.from({ length: 50 }, (_, i) => {
    const a = ihash(i, 1, 0, 27) * 6.283;
    const r = 7 + ihash(i, 2, 0, 27) * 16;
    return [CX + Math.cos(a) * r, g + 1 + ihash(i, 3, 0, 27) * 7, CZ + Math.sin(a) * r];
  });
  return {
    world: w,
    actors,
    fire: [CX + 0.5, g + 0.25, CZ + 0.5],
    banners: poles.map((p) => ({ at: [p[0] + 0.5, g + 5.6, p[2] + 0.5 + 5 / 16] as V3, yaw: 0 })),
    strings,
    glows,
    flies,
    eye: [CX + 3.5, g + 5.2, CZ + 17],
    look: [CX - 0.5, g + 2.4, CZ - 1.5],
  };
}
