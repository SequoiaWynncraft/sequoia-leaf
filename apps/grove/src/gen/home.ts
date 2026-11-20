/**
 * A member's own grove: a small clearing with their sequoia in the middle of it, a fire to sit by,
 * and room for what they will build. The tree's size is its level, so growing it is rebuilding this.
 */
import { B } from "../engine/blocks.ts";
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

export interface Home {
  readonly world: World;
  readonly ground: number;
  readonly fire: V3;
  /** Where leaflings stand, nearest the fire first. */
  readonly spots: readonly V3[];
}
export const treeHeight = (level: number): number => HEIGHT[Math.min(level, HEIGHT.length - 1)]!;

/** Fills the world afresh for a tree of this level. */
export function plant(w: World, level: number): void {
  w.blocks.fill(0);
  const girth = GIRTH[Math.min(level, GIRTH.length - 1)]!;
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - C, z - C);
      // Needles lie under the tree and round the fire; the rest is lawn.
      const litter = d < girth * 1.6 + 1.5 + ihash(x, 0, z, 5) * 1.5 || Math.hypot(x - C - 7, z - C - 6) < 2.6;
      for (let y = 0; y < G; y++) w.set(x, y, z, y === G - 1 ? (litter ? B.duff! : B.moss!) : B.dirt!);
    }
  growSequoia(w, { x: C, z: C, ground: G, height: treeHeight(level), girth, seed: 1 });
  // The old forest stands round the clearing: giants at its edge, so the grove is a room among them.
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * 6.283 + ihash(i, 1, 0, 31) * 0.3;
    const r = 26 + ihash(i, 2, 0, 31) * 3.5;
    // The side the grove is looked at from is left open.
    if (Math.abs(Math.atan2(Math.sin(a - 1.1), Math.cos(a - 1.1))) < 0.75) continue;
    const x = Math.round(C + Math.cos(a) * r);
    const z = Math.round(C + Math.sin(a) * r);
    growSequoia(w, {
      x,
      z,
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
      if (w.get(x, G, z) || w.get(x, G - 1, z) !== B.moss) continue;
      const h = ihash(x, 1, z, 9);
      const wild = 0.25 + noise2(x / 8, z / 8, 6) * 0.5;
      if (h < wild * 0.7) w.set(x, G, z, ihash(x, 2, z, 9) < 0.18 ? B.fern! : B.grass!);
      else if (h > 0.985)
        w.set(x, G, z, [B.dandelion!, B.daisy!, B.cornflower!, B.poppy!][Math.floor(ihash(x, 3, z, 9) * 4)]!);
      else if (h > 0.978) w.set(x, G, z, B.shroom!);
    }
  w.light();
}

export function buildHome(level: number): Home {
  const world = new World(SIZE, 126, SIZE);
  plant(world, level);
  const fire: V3 = [C + 7.5, G + 0.25, C + 6.5];
  const spots: V3[] = Array.from({ length: 10 }, (_, i) => {
    const a = 2.2 + i * 0.83;
    const r = 2.1 + (i % 3) * 0.9;
    return [fire[0] + Math.cos(a) * r, G, fire[2] + Math.sin(a) * r];
  });
  return { world, ground: G, fire, spots };
}
