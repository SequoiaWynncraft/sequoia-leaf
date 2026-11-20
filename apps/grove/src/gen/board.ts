/**
 * The material board: every building material on one wall, in the game's own light, half of it by a
 * fire. It is where a texture is judged before it goes into a scene (`?scene=board`).
 */
import { B } from "../engine/blocks.ts";
import { World } from "../engine/world.ts";

type V3 = [number, number, number];
export interface Board {
  world: World;
  fire: V3;
  glows: { at: V3; size: number; flicker: boolean }[];
  views: Record<string, { eye: V3; at: V3; fov: number }>;
}

const G = 8;
const BAY = 7;

export function buildBoard(): Board {
  const w = new World(72, 40, 44);
  for (let z = 0; z < 44; z++)
    for (let x = 0; x < 72; x++) {
      for (let y = 0; y < G; y++) w.set(x, y, z, y === G - 1 ? (z > 24 && x > 40 ? B.duff! : B.moss!) : B.dirt!);
    }
  const Z = 14;
  const bay = (i: number): number => 6 + i * (BAY + 2);
  const wall = (i: number, h: number, pick: (x: number, y: number) => number): void => {
    for (let x = 0; x < BAY; x++)
      for (let y = 0; y < h; y++) for (let z = 0; z < 2; z++) w.set(bay(i) + x, G + y, Z - z, pick(x, y));
  };

  // 0: a trunk face, wide enough for the bark's whole drawing, with a round young trunk beside it.
  wall(0, 12, () => B.bark!);
  // 1: logs, lying both ways and standing, so their sides and ends all show.
  for (let x = 0; x < BAY; x++) {
    w.set(bay(1) + x, G, Z, B.log_x!);
    w.set(bay(1) + x, G, Z + 1, B.log_x!);
    if (x > 0 && x < BAY - 1) w.set(bay(1) + x, G + 1, Z, B.log_x!);
  }
  for (let z = 0; z < 4; z++)
    for (const x of [1, 2, 4, 5]) w.set(bay(1) + x, G + (z < 3 && x % 3 ? 1 : 0) * 0, Z + 4 + z * 0, B.log_z!);
  for (const [x, y] of [
    [1, 0],
    [2, 0],
    [3, 0],
    [2, 1],
  ] as const)
    for (let z = 0; z < 3; z++) w.set(bay(1) + x + 1, G + y, Z + 4 + z, B.log_z!);
  for (let y = 0; y < 3; y++) w.set(bay(1) + 6, G + y, Z + 4, B.log!);
  w.set(bay(1), G, Z + 5, B.log!);
  // 2: a plank wall with a window and a door's worth of floor.
  wall(2, 7, (x, y) => (x === 3 && (y === 3 || y === 4) ? B.window! : B.planks!));
  for (let x = 0; x < BAY; x++) for (let z = 1; z < 5; z++) w.set(bay(2) + x, G - 1, Z + z, B.planks!);
  w.set(bay(2) + 1, G, Z + 2, B.crate!);
  w.set(bay(2) + 1, G + 1, Z + 2, B.lantern!);
  w.set(bay(2) + 5, G, Z + 1, B.fence!);
  w.set(bay(2) + 5, G, Z + 2, B.fence!);
  w.set(bay(2) + 5, G, Z + 3, B.fence!);
  for (let y = 0; y < 5; y++) w.set(bay(2) + 6, G + y, Z + 1, B.ladder_s!);
  // 3: a roof, its courses stepping back, over a plank gable.
  wall(3, 3, () => B.planks!);
  for (let s = 0; s < 6; s++)
    for (let x = -1; x <= BAY; x++) {
      w.set(bay(3) + x, G + 3 + Math.floor(s / 2), Z + 2 - s, s % 2 ? B.slate! : B.slate_slab!);
      if (s % 2 === 0) w.set(bay(3) + x, G + 3 + s / 2, Z + 2 - s, B.slate_stairs_n!);
    }
  // 4: stone, clean below and mossy above, with a stair.
  wall(4, 6, (_x, y) => (y >= 4 ? B.stone_mossy! : B.stone!));
  for (let s = 0; s < 3; s++) w.set(bay(4) + 1 + s, G + s, Z + 1, B.planks_stairs_e!);
  // 5: charred bark and a bare plank deck on posts.
  wall(5, 6, (x) => (x < 3 ? B.bark_char! : B.bark!));
  for (let x = 0; x < BAY; x++) for (let z = 1; z < 4; z++) w.set(bay(5) + x, G + 2, Z + z, B.planks_slab_top!);
  w.set(bay(5), G, Z + 3, B.fence!);
  w.set(bay(5), G + 1, Z + 3, B.fence!);
  w.set(bay(5) + 6, G, Z + 3, B.fence!);
  w.set(bay(5) + 6, G + 1, Z + 3, B.fence!);

  const fire: V3 = [bay(4) - 1.5, G, Z + 6.5];
  w.set(Math.floor(fire[0]), G, Math.floor(fire[2]), B.firepit!);
  w.set(bay(0) + 3, G + 5, Z + 1, B.lantern_hang!);
  w.set(bay(0) + 3, G + 6, Z + 1, B.fence!);
  w.light();

  const mid = bay(2) + BAY + 1;
  const views: Board["views"] = {
    hero: { eye: [mid, G + 6, Z + 27], at: [mid, G + 4.5, Z], fov: 46 },
  };
  for (let i = 0; i < 6; i++)
    views[`b${i}`] = { eye: [bay(i) + 5.5, G + 4.5, Z + 13], at: [bay(i) + 3.5, G + 3, Z], fov: 34 };
  return {
    world: w,
    fire: [fire[0], G, fire[2]],
    glows: [{ at: [fire[0], G + 0.9, fire[2]], size: 4, flicker: true }],
    views,
  };
}
