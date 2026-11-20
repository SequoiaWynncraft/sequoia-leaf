/** A glade in the redwoods with one giant tree and a small house in it: the prototype's world. */
import { B, OCC } from "../engine/blocks.ts";
import { ihash, noise2 } from "../engine/rand.ts";
import { World } from "../engine/world.ts";
import { dressLeaves, growSequoia, type Tree, trunkRadius } from "./sequoia.ts";

export const SIZE = 144;
export const HEIGHT = 126;
export const CX = 72;
export const CZ = 70;
/** The low sun, behind the tree and to the right, as in the welcome scenes. */
export const SUN: readonly [number, number, number] = (() => {
  const v = [0.8, 0.3, -0.52];
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l] as const;
})();

const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function ground(x: number, z: number): number {
  const d = Math.hypot(x - CX, z - CZ);
  const rough = smoothstep(16, 44, d);
  return Math.round(
    10 +
      (noise2(x / 24, z / 24, 5) - 0.4) * 5 * rough +
      noise2(x / 7, z / 7, 6) * 1.3 * (0.25 + rough) +
      noise2(x / 13, z / 13, 7) * 1.1,
  );
}

export interface Glade {
  readonly world: World;
  readonly main: Tree;
  readonly deck: number;
}

export function buildGlade(): Glade {
  const w = new World(SIZE, HEIGHT, SIZE);
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) {
      const h = ground(x, z);
      const bare = noise2(x / 11, z / 11, 8) + noise2(x / 4, z / 4, 9) * 0.35 > 0.86;
      for (let y = 0; y < h; y++)
        w.set(x, y, z, y === h - 1 ? (bare ? B.duff! : B.moss!) : y > h - 4 ? B.dirt! : B.stone!);
    }

  // The trees: the member's giant, two young ones, a neighbour for the bridge, and the forest round them.
  const main: Tree = { x: CX, z: CZ, ground: ground(CX, CZ), height: 104, girth: 5.6, seed: 1 };
  const trees: Tree[] = [
    main,
    { x: CX + 31, z: CZ + 3, ground: ground(CX + 31, CZ + 3), height: 78, girth: 3.7, seed: 2 },
    { x: CX + 16, z: CZ + 17, ground: ground(CX + 16, CZ + 17), height: 12, girth: 0.6, seed: 3 },
    { x: CX - 19, z: CZ + 13, ground: ground(CX - 19, CZ + 13), height: 26, girth: 1.4, seed: 4 },
  ];
  for (let i = 0; trees.length < 46 && i < 400; i++) {
    const a = ihash(i, 1, 0, 9) * 6.283;
    const r = 34 + ihash(i, 2, 0, 9) * 36;
    const x = Math.round(CX + Math.cos(a) * r);
    const z = Math.round(CZ + Math.sin(a) * r);
    // The glade stays open to the south, where it is looked at from.
    if (Math.abs(Math.atan2(x - CX, z - CZ)) < 0.42) continue;
    if (x < 6 || z < 6 || x > SIZE - 7 || z > SIZE - 7) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 8 + t.girth)) continue;
    const big = ihash(i, 3, 0, 9);
    trees.push({ x, z, ground: ground(x, z), height: Math.round(48 + big * 58), girth: 2.2 + big * 2.6, seed: 20 + i });
  }
  for (const t of trees) growSequoia(w, t);
  dressLeaves(w, SUN[0]);

  // The fire scar: a hollow in the giant's foot, a lantern inside.
  const g = main.ground;
  const south = (x: number, y: number): number => {
    let z = CZ + 12;
    while (z > CZ && OCC[w.get(x, y, z - 1)] !== 2) z--;
    return z;
  };
  const carved: [number, number, number][] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let y = 0; y < (dx ? 4 : 6); y++) {
      const hx = CX - 2 + dx;
      const z0 = south(hx, g + y);
      for (let z = z0 - 4; z < z0; z++) {
        w.set(hx, g + y, z, 0);
        carved.push([hx, g + y, z]);
      }
    }
  for (const [x, y, z] of carved)
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const)
      if (w.get(x + dx, y + dy, z + dz) === B.bark) w.set(x + dx, y + dy, z + dz, B.bark_char!);
  w.set(CX - 2, g, south(CX - 2, g) - 3, B.lantern!);

  // The house: a deck round the trunk, a cabin on its south-west lobe.
  const deck = g + 15;
  const rt = trunkRadius(main, 15);
  const onDeck = (x: number, z: number): boolean => {
    const d = Math.hypot(x + 0.5 - (CX + 0.5), z + 0.5 - (CZ + 0.5));
    return d <= rt + 4.6 || (x >= CX - 13 && x <= CX - 3 && z >= CZ + 2 && z <= CZ + 11);
  };
  const cab = { x0: CX - 12, x1: CX - 6, z0: CZ + 4, z1: CZ + 10 };
  const inCabin = (x: number, z: number): boolean => x >= cab.x0 && x <= cab.x1 && z >= cab.z0 && z <= cab.z1;
  const ladderX = CX + 3;
  for (let z = CZ - 16; z <= CZ + 16; z++)
    for (let x = CX - 16; x <= CX + 16; x++) {
      if (!onDeck(x, z)) continue;
      w.fill(x, deck, z, B.planks!);
      const edge = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dz]) => !onDeck(x + dx!, z + dz!));
      if (edge && !inCabin(x, z)) w.fill(x, deck + 1, z, B.fence!);
    }
  // Beams under the deck, and braces down to the trunk.
  for (let s = 0; s < 11; s++) {
    for (const [dx, dz, id] of [
      [1, 0, B.log_x!],
      [-1, 0, B.log_x!],
      [0, 1, B.log_z!],
      [0, -1, B.log_z!],
    ] as const) {
      const x = CX + dx * s;
      const z = CZ + dz * s;
      if (onDeck(x, z)) w.fill(x, deck - 1, z, id);
    }
  }
  // The cabin.
  for (let y = deck + 1; y <= deck + 4; y++)
    for (let z = cab.z0; z <= cab.z1; z++)
      for (let x = cab.x0; x <= cab.x1; x++) {
        const wallX = x === cab.x0 || x === cab.x1;
        const wallZ = z === cab.z0 || z === cab.z1;
        if (!wallX && !wallZ) continue;
        w.set(x, y, z, wallX && wallZ ? B.log! : B.planks!);
      }
  for (const x of [CX - 10, CX - 8]) w.set(x, deck + 3, cab.z1, B.window!);
  w.set(cab.x0, deck + 3, CZ + 7, B.window!);
  for (const y of [deck + 1, deck + 2]) w.set(cab.x1, y, CZ + 7, 0);
  w.set(CX - 9, deck + 4, CZ + 7, B.lantern_hang!);
  for (let k = 0; k <= 4; k++)
    for (let z = cab.z0 - 1; z <= cab.z1 + 1; z++) {
      const xa = cab.x0 - 1 + k;
      const xb = cab.x1 + 1 - k;
      w.set(xa, deck + 4 + k, z, B.slate!);
      w.set(xb, deck + 4 + k, z, B.slate!);
      if (k > 0 && (z === cab.z0 || z === cab.z1))
        for (let x = xa + 1; x < xb; x++) w.set(x, deck + 4 + k, z, B.planks!);
    }
  w.set(CX - 9, deck + 6, cab.z1, B.window!);
  w.set(cab.x1 + 1, deck + 3, CZ + 8, B.lantern_hang!);
  // The ladder up the trunk's south face, through a gap in the deck.
  for (let y = g; y <= deck + 1; y++) {
    const z = south(ladderX, y);
    if (y >= deck) {
      w.set(ladderX, y, z, 0);
      if (y === deck) w.set(ladderX, y, z, B.ladder_s!);
    } else w.fill(ladderX, y, z, B.ladder_s!);
  }
  // Lanterns on the rail and under the deck.
  for (const [x, z] of [
    [CX + 9, CZ + 4],
    [CX - 2, CZ + 11],
    [CX - 13, CZ + 11],
    [CX + 4, CZ - 9],
  ] as const)
    if (w.get(x, deck + 1, z) === B.fence) w.set(x, deck + 2, z, B.lantern!);
  for (const [x, z] of [
    [CX + 7, CZ + 5],
    [CX - 6, CZ + 8],
    [CX + 1, CZ + 9],
  ] as const)
    w.fill(x, deck - 1, z, B.lantern_hang!);

  // The bridge to the neighbour, sagging in the middle, and the neighbour's lookout.
  const nb = trees[1]!;
  const nr = trunkRadius(nb, deck - nb.ground);
  for (let z = nb.z - 7; z <= nb.z + 7; z++)
    for (let x = nb.x - 7; x <= nb.x + 7; x++) {
      const d = Math.hypot(x - nb.x, z - nb.z);
      if (d > nr + 3.4) continue;
      w.fill(x, deck, z, B.planks!);
      if (d > nr + 2.4) w.fill(x, deck + 1, z, B.fence!);
    }
  const bx0 = CX + Math.floor(rt + 4.6);
  const bx1 = nb.x - Math.floor(nr + 3.4);
  for (let x = bx0; x <= bx1; x++) {
    const sag = Math.round(2.4 * Math.sin((Math.PI * (x - bx0)) / (bx1 - bx0)));
    for (let dz = -1; dz <= 1; dz++) {
      w.set(x, deck - sag, CZ + 2 + dz, B.planks!);
      w.set(x, deck - sag + 1, CZ + 2 + dz, dz ? B.fence! : 0);
      if (!dz) w.set(x, deck - sag + 2, CZ + 2, 0);
    }
  }
  for (const x of [bx0 + 1, bx1 - 1]) w.set(x, deck + 2, CZ + 3, B.lantern!);
  w.set(Math.round((bx0 + bx1) / 2), deck - 1, CZ + 3, B.lantern!);

  // The floor of the glade: a path, a fire with two seats, a fallen log, boulders, ferns and mushrooms.
  const top = (x: number, z: number, id: number): void => w.set(x, ground(x, z) - 1, z, id);
  for (let z = CZ + 7; z < SIZE; z++) {
    const x = CX + 1 + Math.round(3.5 * Math.sin((z - CZ) / 10));
    for (let dx = 0; dx < 2; dx++) if (w.get(x + dx, ground(x + dx, z), z) === 0) top(x + dx, z, B.path!);
  }
  const fire = { x: CX + 11, z: CZ + 24 };
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) if (Math.hypot(dx, dz) < 2.6) top(fire.x + dx, fire.z + dz, B.path!);
  w.set(fire.x, ground(fire.x, fire.z), fire.z, B.campfire!);
  for (let i = -1; i <= 1; i++) {
    w.set(fire.x + i, ground(fire.x + i, fire.z + 4), fire.z + 4, B.log_x!);
    w.set(fire.x + 4, ground(fire.x + 4, fire.z + i), fire.z + i, B.log_z!);
  }
  for (let i = 0; i < 9; i++) w.fill(CX - 26 + i, ground(CX - 26 + i, CZ + 22), CZ + 22, B.log_x!);
  for (let i = 0; i < 16; i++) {
    const a = ihash(i, 1, 0, 33) * 6.283;
    const r = 14 + ihash(i, 2, 0, 33) * 26;
    const bx = Math.round(CX + Math.cos(a) * r);
    const bz = Math.round(CZ + Math.sin(a) * r);
    const size = 1 + ihash(i, 3, 0, 33) * 1.6;
    for (let dy = 0; dy <= 2; dy++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++)
          if (Math.hypot(dx, dy * 1.4, dz) < size - ihash(bx + dx, dy, bz + dz, 34) * 0.5)
            w.fill(
              bx + dx,
              ground(bx, bz) + dy,
              bz + dz,
              ihash(bx + dx, dy, bz + dz, 35) < 0.6 ? B.stone_mossy! : B.stone!,
            );
  }
  for (const [x, z] of [
    [CX + 2, CZ + 16],
    [CX + 5, CZ + 34],
  ] as const) {
    w.fill(x, ground(x, z), z, B.fence!);
    w.fill(x, ground(x, z) + 1, z, B.lantern!);
  }
  w.fill(CX + 8, ground(CX + 8, CZ + 14), CZ + 14, B.sprout!);
  for (let z = 1; z < SIZE - 1; z++)
    for (let x = 1; x < SIZE - 1; x++) {
      const y = ground(x, z);
      const under = w.get(x, y - 1, z);
      if (w.get(x, y, z) || (under !== B.moss && under !== B.duff)) continue;
      const nearTrunk = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ].some(([dx, dz]) => OCC[w.get(x + dx!, y, z + dz!)] === 2);
      const thick =
        noise2(x / 9, z / 9, 44) * 0.34 + (nearTrunk ? 0.3 : 0) + smoothstep(18, 34, Math.hypot(x - CX, z - CZ)) * 0.12;
      const h = ihash(x, 0, z, 45);
      if (h < thick * (under === B.duff ? 0.12 : 0.42)) w.set(x, y, z, ihash(x, 1, z, 46) < 0.55 ? B.fern! : B.grass!);
      else if (under === B.moss && h > 0.9 && h < 0.96)
        w.set(x, y, z, h < 0.925 ? B.d_needles! : h < 0.95 ? B.d_clover! : B.d_pebbles!);
      else if (h > 0.96 && h < 0.966) w.set(x, y, z, B.cone!);
      else if (h > 0.992 || (nearTrunk && h > 0.95)) w.set(x, y, z, B.shroom!);
    }

  w.light();
  return { world: w, main, deck };
}
