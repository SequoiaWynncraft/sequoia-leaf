/**
 * What the glade's moments draw with: the picture under way, the welcome's palette in the loop's
 * light, the member's tree (its box and mask from the bundle), the cast's sheets when there are
 * some, and the places in the welcome's clearing where things happen. Every place is in the
 * picture's own pixels (256x144); the tree's foot and the path come from the manifest.
 */

import type { Mask } from "../../bundle/art.ts";
import type { CastFrame, CastSheet } from "../../bundle/cast.ts";
import type { Box } from "../../bundle/manifest.ts";
import type { Ambiance, Ink, Key } from "../../bundle/palette.ts";
import type { Picture } from "../../bundle/picture.ts";

export interface Point {
  x: number;
  y: number;
}

/** The member's tree in the picture. */
export interface TreeShape {
  level: number;
  box: Box;
  foot: Point;
  /** Its pixels, once the mask is in. */
  mask: Mask | null;
}

export interface Fx {
  pic: Picture;
  ink: Ink;
  tree: TreeShape;
  season: string;
  ambiance: Ambiance;
  /** The front path's row, where characters stand. */
  ground: number;
  places: Places;
  cast: CastSheet | null;
  props: CastSheet | null;
}

/** Where things happen in the clearing. */
export interface Places {
  /** The member's hearth, the small fire beside the tree where cones open. */
  hearth: Point;
  /** The next cone, resting on the moss by the hearth. */
  cone: Point;
  /** Where a spirit lands, out of the fire. */
  landing: Point;
  /** Where your companion waits. */
  companion: Point;
  /** Where the heralds stop, and from which side (-1 left, 1 right) each comes. */
  heralds: readonly { x: number; from: -1 | 1 }[];
}

/**
 * The places, from the tree's foot, the hearth and the path. On a wide screen the hotbar covers the
 * path's middle, so characters stand either side of it; a phone's crop shows the middle only, so
 * they stand between the tree and the hearth.
 */
export function places(foot: Point, hearth: Point, ground: number, narrow: boolean): Places {
  const cone = { x: hearth.x - 12, y: hearth.y - 2 };
  return narrow
    ? {
        hearth,
        cone,
        landing: { x: foot.x + 20, y: ground + 2 },
        companion: { x: foot.x - 34, y: ground + 1 },
        heralds: [
          { x: foot.x - 24, from: -1 },
          { x: foot.x - 12, from: -1 },
          { x: foot.x + 24, from: 1 },
        ],
      }
    : {
        hearth,
        cone,
        landing: { x: hearth.x + 20, y: ground },
        companion: { x: foot.x - 34, y: ground },
        heralds: [
          { x: foot.x - 20, from: -1 },
          { x: hearth.x + 14, from: 1 },
          { x: hearth.x + 27, from: 1 },
        ],
      };
}

/** The first row of the tree in column `x`, or -1 where the tree is not. */
export function treeTop(tree: TreeShape, x: number): number {
  const m = tree.mask;
  x = Math.round(x);
  if (!m || x < 0 || x >= m.w) return -1;
  let cache = TOPS.get(m);
  if (!cache) {
    cache = new Int16Array(m.w).fill(-1);
    for (let c = 0; c < m.w; c++)
      for (let y = 0; y < m.h; y++)
        if (m.bits[y * m.w + c]) {
          cache[c] = y;
          break;
        }
    TOPS.set(m, cache);
  }
  return cache[x] ?? -1;
}
const TOPS = new WeakMap<Mask, Int16Array>();

/** Whether (x, y) is one of the tree's pixels. */
export function isTree(tree: TreeShape, x: number, y: number): boolean {
  const m = tree.mask;
  x = Math.round(x);
  y = Math.round(y);
  if (!m) {
    const b = tree.box;
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  }
  return x >= 0 && y >= 0 && x < m.w && y < m.h && m.bits[y * m.w + x] === 1;
}

/** A tap on the tree: on its pixels or within `slack` of them (a seedling is small under a thumb). */
export function tapsTree(tree: TreeShape, x: number, y: number, slack: number): boolean {
  const b = tree.box;
  if (x < b.x - slack || x >= b.x + b.w + slack || y < b.y - slack || y >= b.y + b.h + slack) return false;
  // A small tree's whole box is the target; a big one's, its own pixels.
  if (b.w * b.h < 400 || !tree.mask) return true;
  for (let dy = -slack; dy <= slack; dy++)
    for (let dx = -slack; dx <= slack; dx++) if (isTree(tree, x + dx, y + dy)) return true;
  return false;
}

/** The crown: the tree's box above its bare trunk. */
export function crown(tree: TreeShape): Box {
  const b = tree.box;
  const h = Math.max(4, Math.round(b.h * (tree.level >= 9 ? 0.62 : tree.level >= 2 ? 0.8 : 1)));
  return { x: b.x, y: b.y, w: b.w, h };
}

/** A cast member's frame, or null while the bundle has no sheet for it (nothing is drawn then). */
export function castFrame(fx: Fx, ids: readonly string[], anims: readonly string[], ms: number): CastFrame | null {
  const cast = fx.cast;
  if (!cast) return null;
  const id = cast.find(...ids);
  if (!id) return null;
  const entry = cast.entries.get(id);
  const anim = anims.find((a) => entry?.anims.has(a)) ?? anims[0] ?? "idle";
  return cast.frame(id, anim, ms, fx.season, fx.ambiance);
}

/** A prop's frame (the cone, a drop of raid water), or null while the bundle has none. */
export function propFrame(fx: Fx, id: string, anim: string, ms: number): CastFrame | null {
  return fx.props?.frame(id, anim, ms, fx.season, fx.ambiance) ?? null;
}

/** The welcome's falling leaf (welcome/scene.py `LEAF_FRAMES`), `light` and `dark` its two colours. */
const LEAF_FRAMES = [
  ["ll.", ".ld"],
  [".l", "ll", "d."],
] as const;

export function leaf(fx: Fx, x: number, y: number, tilt: number, light: number, dark: number): void {
  const rows = LEAF_FRAMES[tilt % 2] ?? LEAF_FRAMES[0];
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === "l") fx.pic.set(x + c, y + r, light);
      else if (ch === "d") fx.pic.set(x + c, y + r, dark);
    }
  });
}

/** The tree's own leaf colours: olive while young, the canopy's gold once old (grove/tree.py). */
export function leafKeys(tree: TreeShape, season: string): [Key, Key] {
  if (season === "winter") return ["evergreen_4", "evergreen_3"];
  return tree.level >= 9 ? ["falling_leaf", "falling_leaf_dark"] : ["olive", "olive_dark"];
}

/**
 * A firefly-ramp mote, as the welcome draws a firefly: dim, lit, or bright with a soft halo
 * blended into what is round it (welcome/fireflies.py `paint`).
 */
export function mote(fx: Fx, x: number, y: number, glow: number): void {
  const { pic, ink } = fx;
  if (glow <= 0) return;
  if (glow < 0.22) {
    pic.set(x, y, ink.c("firefly_dim"));
    return;
  }
  if (glow > 0.55)
    for (const [dx, dy] of NEIGHBOURS) pic.blend(x + dx, y + dy, ink.c("firefly"), glow > 0.8 ? 0.45 : 0.3);
  pic.set(x, y, ink.c(glow > 0.8 ? "firefly_core" : "firefly"));
}

export const NEIGHBOURS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

/** A sparkle's stage through its life (0 to 1): dot, plus, big plus, plus, dot, as the welcome's stars. */
export const sparkleStage = (u: number, big = true): number => {
  const steps = big ? [0, 1, 2, 1, 0] : [0, 1, 0];
  return steps[Math.min(steps.length - 1, Math.max(0, Math.floor(u * steps.length)))] ?? 0;
};

/** A soft warm light passing up the tree from its foot: the crown drinking. `u` runs 0 to 1. */
export function drinkWave(fx: Fx, u: number, strength = 0.32): void {
  const { tree, pic, ink } = fx;
  if (u < 0 || u > 1 || !tree.mask) return;
  const b = tree.box;
  const edge = b.y + b.h - (b.h + 6) * u;
  const band = Math.max(4, b.h * 0.18);
  const lit = ink.c("lantern_light");
  for (let y = Math.max(0, Math.floor(edge - band)); y <= Math.min(pic.H - 1, Math.ceil(edge + 2)); y++) {
    const k = 1 - Math.abs(y - edge) / band;
    if (k <= 0) continue;
    for (let x = b.x; x < b.x + b.w; x++) if (isTree(fx.tree, x, y)) pic.light(x, y, lit, strength * k);
  }
}
