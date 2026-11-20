/** Box-model props in sixteenths of a block: the campfire, the cone, the lantern on its post, fairy lights, plants. */
import { Matrix4, Vector3 } from "three";

const ZERO = new Vector3();
const UP = new Vector3(0, 1, 0);
const dir = new Vector3();
import { GeoBuilder, type V3 } from "./geo.ts";
import { LAYOUT } from "./island.ts";
import { hash2 } from "./rng.ts";
import { tile } from "./textures.ts";
import type { TreeInfo } from "./tree.ts";

const all = (name: string, rect?: readonly [number, number, number, number]) => {
  const t = tile(name);
  return [0, 1, 2, 3, 4, 5].map(() => (rect ? { tile: t, rect } : { tile: t }));
};

export interface Lights {
  fire: V3;
  lantern: V3;
}

/**
 * The campfire: a ring of warm stones, three crossed logs, a glowing ember bed and crossed flame quads.
 * Opaque parts go to `solid`, the flames to `cut`.
 */
export function campfire(solid: GeoBuilder, cut: GeoBuilder, gx: number, gy: number, gz: number): V3 {
  const origin: V3 = [gx, gy, gz];
  // Stones round the pit, uneven sizes, a gap at the front where the cone rests.
  const stones = [
    [0.0, 5, 4],
    [0.9, 4, 3],
    [1.75, 5, 4],
    [2.6, 4, 3],
    [3.4, 5, 5],
    [4.3, 4, 3],
    [5.2, 5, 4],
  ];
  for (const [a, s, h] of stones) {
    const r = 9.5;
    const cx = 8 + Math.cos(a ?? 0) * r;
    const cz = 8 + Math.sin(a ?? 0) * r;
    const half = (s ?? 4) / 2;
    const v = Math.floor(hash2(Math.round(cx), Math.round(cz), 3) * 2);
    solid.box([cx - half, 0, cz - half], [cx + half, h ?? 3, cz + half], all(`boulder${v}`, [4, 4, 4 + (s ?? 4), 4 + (h ?? 3)]), { origin });
  }
  // Ember bed.
  solid.box([3, 0, 3], [13, 1, 13], [null, null, { tile: tile("embers"), rect: [3, 3, 13, 13] }, null, null, null], {
    origin,
    fx: { emissive: 1, sway: 0, sky: 1, frames: 4 },
  });
  // Three logs crossed in a star, each a little higher than the last.
  const logs = [0.3, 1.35, 2.4];
  logs.forEach((a, i) => {
    const m = new Matrix4().makeTranslation(gx + 0.5, gy + (i * 1.2) / 16, gz + 0.5).multiply(new Matrix4().makeRotationY(a));
    const bark = tile(`bark${i % 3}`);
    const end = tile("logend");
    solid.box(
      [-9, 0, -2],
      [9, 4, 2],
      [
        { tile: end, rect: [6, 6, 10, 10] },
        { tile: end, rect: [6, 6, 10, 10] },
        { tile: bark, rect: [0, 2, 16, 6] },
        null,
        { tile: bark, rect: [0, 6, 16, 10] },
        { tile: bark, rect: [0, 10, 16, 14] },
      ],
      { matrix: m, fx: { emissive: 0.15, sway: 0, sky: 1, frames: 0 } },
    );
  });
  // Flames: two crossed pairs at different sizes, animated through six frames.
  const flame = tile("flame");
  const fx = { emissive: 1, sway: 0, sky: 1, frames: 6 };
  cut.cross(gx + 0.5, gy + 0.1, gz + 0.5, flame, 1.15, 1, [1, 1, 1], fx, 0.2);
  cut.cross(gx + 0.47, gy + 0.08, gz + 0.53, flame, 0.8, 1, [1, 1, 1], fx, 0.95);
  return [gx + 0.5, gy + 0.75, gz + 0.5];
}

/** A sequoia cone: an egg of stacked layers so it reads round, scales on every face. Built at the origin. */
export function cone(b: GeoBuilder, scale = 1): void {
  const layer = (w: number, y0: number, y1: number) => {
    const h = w / 2;
    b.box([-h, y0, -h], [h, y1, h], all("cone", [8 - h, 16 - y1, 8 + h, 16 - y0]), { scale });
  };
  layer(3, 0, 1);
  layer(5, 1, 2);
  layer(6, 2, 4);
  layer(7, 4, 7);
  layer(6, 7, 9);
  layer(4, 9, 10);
  layer(2, 10, 11);
  b.box([-0.5, 11, -0.5], [0.5, 12.5, 0.5], all("wood"), { scale });
}

/** The lantern on a crooked post with an arm; the glass glows. Returns the light's position. */
export function lantern(b: GeoBuilder, gx: number, gy: number, gz: number): V3 {
  const origin: V3 = [gx, gy, gz];
  const wood = tile("wood");
  const iron = tile("iron");
  const glass = tile("lantern");
  // Post and arm.
  b.box([6, 0, 6], [10, 22, 10], all("wood").map((f) => ({ ...f, tile: wood, rect: [6, 0, 10, 16] as const })), { origin });
  b.box([6, 22, 6], [10, 24, 10], all("logend", [6, 6, 10, 10]), { origin });
  b.box([10, 20, 7], [19, 22, 9], all("wood", [0, 4, 9, 6]), { origin });
  // Hook and lantern.
  b.box([16.5, 17, 7.5], [17.5, 20, 8.5], all("iron", [0, 0, 1, 3]), { origin });
  b.box([14.5, 16, 5.5], [19.5, 17, 10.5], all("iron", [0, 0, 5, 5]), { origin });
  b.box([15, 9, 6], [19, 16, 10], all("lantern", [0, 0, 16, 16]).map((f) => ({ ...f, tile: glass })), {
    origin,
    fx: { emissive: 1, sway: 0, sky: 1, frames: 0 },
  });
  b.box([14.5, 8, 5.5], [19.5, 9, 10.5], all("iron", [0, 0, 5, 5]).map((f) => ({ ...f, tile: iron })), { origin });
  b.box([16.5, 17, 7.5], [17.5, 17.5, 8.5], all("iron"), { origin });
  return [gx + 17 / 16, gy + 12.5 / 16, gz + 0.5];
}

/**
 * A mossy stone: a base, a smaller upper mass, a cap and a side bump, so it reads rounded the way a builder
 * shapes boulders from stairs and slabs. Moss on the upward faces; snow in winter.
 */
export function stone(b: GeoBuilder, cx: number, y: number, cz: number, size: number, mossy: boolean, turn: number, winter: boolean): void {
  const m = new Matrix4().makeTranslation(cx, y, cz).multiply(new Matrix4().makeRotationY(turn));
  const r = (v: number) => Math.round(v);
  const s = size;
  const parts: [number, number, number, number, number, number][] = [
    [-s / 2, 0, -s * 0.42, s / 2, s * 0.4, s * 0.42],
    [-s * 0.36, s * 0.4, -s * 0.3, s * 0.32, s * 0.64, s * 0.3],
    [-s * 0.18, s * 0.64, -s * 0.16, s * 0.14, s * 0.76, s * 0.16],
    [s * 0.32, 0, -s * 0.2, s * 0.62, s * 0.28, s * 0.22],
  ];
  const v = Math.floor(Math.abs(Math.sin(cx * 3.1 + cz * 1.7)) * 2);
  parts.forEach(([x0, y0, z0, x1, y1, z1], k) => {
    const from: V3 = [r(x0), r(y0), r(z0)];
    const to: V3 = [Math.max(r(x0) + 2, r(x1)), Math.max(r(y0) + 2, r(y1)), Math.max(r(z0) + 2, r(z1))];
    const w = to[0] - from[0];
    const h = to[1] - from[1];
    const d = to[2] - from[2];
    const rect = (a: number, c: number) => [8 - a / 2, 8 - c / 2, 8 + a / 2, 8 + c / 2] as const;
    const side = tile(mossy && k > 0 ? `bouldermoss${v}` : `boulder${v}`);
    const top = tile(winter ? `snow${v}` : mossy ? `moss${v}` : `boulder${v}`);
    b.box(from, to, [
      { tile: side, rect: rect(d, h) },
      { tile: side, rect: rect(d, h) },
      { tile: top, rect: rect(w, d) },
      { tile: side, rect: rect(w, d) },
      { tile: side, rect: rect(w, h) },
      { tile: side, rect: rect(w, h) },
    ], { matrix: m });
  });
}

/** Fairy lights: wire festoons that sag between points, a bulb every few pixels in warm, a little red and ice blue. */
export function festoon(b: GeoBuilder, from: V3, to: V3, sag: number, salt: number): V3[] {
  const bulbs: V3[] = [];
  const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const steps = Math.max(4, Math.round(len * 5));
  let prev: V3 = from;
  const wire = tile("wire");
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p: V3 = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t - sag * 4 * t * (1 - t), from[2] + (to[2] - from[2]) * t];
    // Wire segment: a thin box along the chord.
    const dx = p[0] - prev[0];
    const dy = p[1] - prev[1];
    const dz = p[2] - prev[2];
    const seg = Math.hypot(dx, dy, dz);
    const m = new Matrix4().lookAt(ZERO, dir.set(dx, dy, dz), UP);
    m.setPosition((p[0] + prev[0]) / 2, (p[1] + prev[1]) / 2, (p[2] + prev[2]) / 2);
    const half = (seg * 16) / 2;
    b.box([-0.25, -0.25, -half], [0.25, 0.25, half], all("wire").map((f) => ({ ...f, tile: wire, rect: [0, 0, 1, 1] as const })), { matrix: m });
    prev = p;
    if (i % 2 === 0 && i < steps) bulbs.push(p);
  }
  bulbs.forEach((p, k) => {
    const pick = hash2(k, salt, 7);
    const name = pick > 0.86 ? "bulbred" : pick > 0.74 ? "bulbblue" : "bulbwarm";
    const m = new Matrix4().makeTranslation(p[0], p[1] - 0.06, p[2]);
    b.box([-1, -2, -1], [1, 0.25, 1], all(name, [0, 0, 2, 2]), { matrix: m, fx: { emissive: 2.2, sway: 0, sky: 1, frames: 0 } });
  });
  return bulbs;
}

/** Festoons for winter: from cluster to cluster along the crown's lower fringe, and across the camp. */
export function winterLights(b: GeoBuilder, tree: TreeInfo, lanternTop: V3, fireAt: V3): V3[] {
  const bulbs: V3[] = [];
  const fringe = tree.fringe
    .filter((p) => p[1] < tree.top - 3)
    .sort((a, c) => a[1] - c[1])
    .slice(0, 14)
    .sort((a, c) => Math.atan2(a[2] - tree.cz, a[0] - tree.cx) - Math.atan2(c[2] - tree.cz, c[0] - tree.cx));
  for (let i = 0; i + 1 < fringe.length; i++) {
    const a = fringe[i];
    const c = fringe[i + 1];
    if (!a || !c) continue;
    // Only swag between neighbours at a similar height: festoons hang, they never zigzag.
    if (Math.hypot(a[0] - c[0], a[2] - c[2]) > 7 || Math.abs(a[1] - c[1]) > 2.5) continue;
    bulbs.push(...festoon(b, a, c, 0.5 + hash2(i, 3, 9) * 0.4, i + 11));
  }
  // Across the camp: from the lantern post to a pole stuck in the ground by the log seat.
  const pole: V3 = [LAYOUT.seat.x + 1.5, 2.6, LAYOUT.seat.z1 + 1.5];
  b.box([7, 0, 7], [9, 26, 9], all("wood", [7, 0, 9, 16]), { origin: [pole[0] - 0.5, 1, pole[2] - 0.5] });
  bulbs.push(...festoon(b, [lanternTop[0] - 0.55, lanternTop[1] + 0.7, lanternTop[2]], [pole[0], pole[1], pole[2]], 0.7, 77));
  void fireAt;
  return bulbs;
}

export function plants(b: GeoBuilder, list: { x: number; y: number; z: number; tile: string; size: number; angle: number }[], winter: boolean): void {
  for (const p of list) {
    const tint: V3 = winter ? [0.82, 0.86, 0.95] : [1, 1, 1];
    b.cross(p.x, p.y + (winter ? 0.12 : 0), p.z, tile(p.tile), p.size, 1, tint, { emissive: 0, sway: p.tile.startsWith("mushroom") ? 0 : 0.7, sky: 1, frames: 0 }, p.angle);
  }
}

export function seedlingPlant(b: GeoBuilder, x: number, y: number, z: number): void {
  b.cross(x, y, z, tile("seedling"), 1.25, 1, [1, 1, 1], { emissive: 0, sway: 0.5, sky: 1, frames: 0 }, 0.3);
}

/** A little copper watering can, box-model, built at the origin with its spout pointing +X. */
export function wateringCan(b: GeoBuilder): void {
  const cu = "copper";
  b.box([-3, 0, -2.5], [3, 6, 2.5], all(cu, [5, 5, 11, 11]));
  b.box([-3.5, 6, -3], [3.5, 6.5, 3], all(cu, [4, 0, 11, 2]));
  b.box([-1.5, 6.5, -0.5], [1.5, 9.5, 0.5], all(cu, [6, 0, 9, 3]));
  b.box([-1.5, 9.5, -0.5], [2.5, 10.5, 0.5], all(cu, [6, 0, 10, 1]));
  b.box([3, 1, -0.75], [8, 2.5, 0.75], all(cu, [2, 2, 7, 4]));
  b.box([7, 2, -1], [9.5, 4, 1], all(cu, [2, 2, 5, 4]));
}

/** Garden shears: two blades on a rivet, each its own builder so they can close. */
export function shearBlade(b: GeoBuilder, side: number): void {
  b.box([-0.5, 0, -0.5], [0.5, 9, 0.5], all("iron", [0, 0, 1, 9]), { fx: { emissive: 0.5, sway: 0, sky: 1, frames: 0 } });
  b.box([-0.75, -5, -0.75], [0.75, 0, 0.75], all("wood", [0, 0, 2, 5]));
  b.box([side * 0.5 - 1.25, -7, -0.6], [side * 0.5 + 1.25, -5, 0.6], all("wood", [0, 0, 2, 2]));
}
