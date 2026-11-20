/**
 * Grows a giant sequoia out of blocks. A sequoia is a massive straight column with a flared foot
 * and a bare lower trunk; its crown is narrow and high, made of separate clumps on stout limbs,
 * widest low in the crown and irregular. A young one is a cone with limbs almost to the ground.
 */
import { B } from "../engine/blocks.ts";
import { ihash } from "../engine/rand.ts";
import type { World } from "../engine/world.ts";

export interface Tree {
  readonly x: number;
  readonly z: number;
  /** The first cell above the ground at the tree's foot. */
  readonly ground: number;
  readonly height: number;
  /** Trunk radius at the ground, before the foot's flare. */
  readonly girth: number;
  readonly seed: number;
}

export const trunkRadius = (t: Tree, y: number): number => {
  const top = Math.max(0.45, t.girth * 0.14);
  return top + (t.girth - top) * Math.pow(Math.max(0, 1 - y / t.height), 0.8);
};

/** One rounded mass of foliage, ragged at its edge, with a few sprays hanging under it. */
function blob(w: World, cx: number, cy: number, cz: number, rx: number, ry: number, seed: number): void {
  const R = Math.ceil(rx);
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++)
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const ey = dy < 0 ? dy / (ry * 0.8) : dy / ry;
        const d = (dx / rx) ** 2 + ey ** 2 + (dz / rx) ** 2;
        const x = Math.round(cx) + dx;
        const y = Math.round(cy) + dy;
        const z = Math.round(cz) + dz;
        const h = ihash(x, y, z, seed);
        if (d >= 1 - h * 0.45) continue;
        w.fill(x, y, z, B.leaves!);
        if (dy < 0 && d > 0.45 && h > 0.72) {
          w.fill(x, y - 1, z, B.leaves!);
          if (h > 0.9) w.fill(x, y - 2, z, B.leaves!);
        }
      }
}

/** A limb's foliage: a few masses run together, so the crown is clumps and not plates. */
function clump(w: World, cx: number, cy: number, cz: number, rx: number, ry: number, seed: number): void {
  blob(w, cx, cy, cz, rx, ry * 1.25, seed);
  const n = rx > 2 ? 3 : 1;
  for (let i = 0; i < n; i++) {
    const a = ihash(i, 1, 0, seed) * 6.283;
    const r = rx * (0.55 + ihash(i, 2, 0, seed) * 0.35);
    blob(
      w,
      cx + Math.cos(a) * r,
      cy + (ihash(i, 3, 0, seed) - 0.3) * ry * 1.6,
      cz + Math.sin(a) * r,
      rx * 0.62,
      ry * 0.85,
      seed + i + 1,
    );
  }
}

export function growSequoia(w: World, t: Tree): void {
  const cx = t.x + 0.5;
  const cz = t.z + 0.5;
  const young = t.height < 30;
  const flareTop = Math.min(10, t.height * 0.12);
  const lobes = 5 + Math.floor(ihash(1, 0, 0, t.seed) * 3);
  const phase = ihash(2, 0, 0, t.seed) * 6.28;

  for (let y = 0; y < t.height; y++) {
    const r = trunkRadius(t, y);
    const flare = y < flareTop ? t.girth * 0.55 * Math.pow(1 - y / flareTop, 2.2) : 0;
    const R = Math.ceil(r + flare) + 1;
    if (r < 0.8) {
      w.set(t.x, t.ground + y, t.z, B.bark!);
      continue;
    }
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const px = t.x + dx + 0.5 - cx;
        const pz = t.z + dz + 0.5 - cz;
        const a = Math.atan2(pz, px);
        const rr =
          r +
          flare * (0.5 + 0.5 * Math.cos(a * lobes + phase)) +
          (ihash(Math.round(a * 5), y >> 3, 3, t.seed) - 0.5) * 0.5;
        if (px * px + pz * pz <= rr * rr) w.set(t.x + dx, t.ground + y, t.z + dz, B.bark!);
      }
  }

  const start = Math.round(t.height * (young ? 0.16 : 0.36 + Math.min(0.1, t.height / 1000)));
  const reach = young ? 1.2 + t.height * 0.17 : Math.min(11, 3 + t.height * 0.085);
  let angle = ihash(3, 0, 0, t.seed) * 6.28;
  let n = 0;
  // A young sequoia is a dense spire, foliage almost to the ground: a full cone, a little uneven
  // at its edge, with sprays hanging under its widest rows.
  if (young)
    for (let y = start; y <= t.height + 1; y++) {
      const k = Math.min(1, (y - start) / (t.height + 1 - start));
      const r = 0.75 + reach * Math.pow(1 - k, 0.85) * (0.9 + 0.1 * Math.sin(y * 2.1 + t.seed));
      const R = Math.ceil(r);
      for (let dz = -R; dz <= R; dz++)
        for (let dx = -R; dx <= R; dx++) {
          const h = ihash(t.x + dx, y, t.z + dz, t.seed);
          const d = dx * dx + dz * dz;
          // Boughs reach further on some sides than others, and turn as they go up, so the spire is not a turned cone.
          const lobe = 1 + 0.2 * Math.cos(Math.atan2(dz, dx) * 3 + t.seed + y * 0.4);
          if (d > r * r * lobe * lobe - h * r * 0.9) continue;
          w.fill(t.x + dx, t.ground + y, t.z + dz, B.leaves!);
          if (y > start && d > (r - 1.2) * (r - 1.2) && h > 0.7)
            w.fill(t.x + dx, t.ground + y - 1, t.z + dz, B.leaves!);
        }
    }
  for (let y = young ? t.height : start; y < t.height - 2;) {
    const k = (y - start) / Math.max(1, t.height - start);
    const profile = young
      ? 1 - k * 0.92
      : (k < 0.18 ? 0.55 + k * 2.5 : 1 - (k - 0.18) * 0.85) * (0.62 + ihash(n, 4, 0, t.seed) * 0.5);
    const len = Math.max(1, reach * profile);
    const r0 = trunkRadius(t, y);
    const rise = 0.12 + ihash(n, 5, 0, t.seed) * 0.25;
    const ax = Math.cos(angle);
    const az = Math.sin(angle);
    for (let s = 0; s <= len; s += 0.5) {
      const bx = cx + ax * (r0 + s);
      const bz = cz + az * (r0 + s);
      const by = t.ground + y + s * rise;
      if (s < len * 0.8) {
        w.fill(Math.floor(bx), Math.round(by), Math.floor(bz), B.bark!);
        if (!young && s < len * 0.35) w.fill(Math.floor(bx), Math.round(by) - 1, Math.floor(bz), B.bark!);
      }
    }
    const tipX = cx + ax * (r0 + len);
    const tipZ = cz + az * (r0 + len);
    const tipY = t.ground + y + len * rise;
    const size = young ? 1.2 + len * 0.28 : 2.1 + len * 0.17 + ihash(n, 6, 0, t.seed) * 0.8;
    clump(w, tipX, tipY + 1, tipZ, size, size * 0.6, t.seed + n * 7);
    if (len > 4)
      blob(
        w,
        cx + ax * (r0 + len * 0.45),
        tipY + 1 - len * rise * 0.4,
        cz + az * (r0 + len * 0.45),
        size * 0.7,
        size * 0.55,
        t.seed + n * 7 + 3,
      );
    angle += 2.4 + (ihash(n, 7, 0, t.seed) - 0.5) * 0.7;
    y += young ? 1 + (n & 1) : 2 + Math.floor(ihash(n, 8, 0, t.seed) * 2.4);
    n++;
  }
  // The top: a rounded tuft on an old tree, a point on a young one.
  if (young) {
    w.fill(t.x, t.ground + t.height + 2, t.z, B.leaves!);
  } else {
    clump(w, cx, t.ground + t.height, cz, 2.8, 2.0, t.seed + 91);
    blob(w, cx, t.ground + t.height + 2, cz, 1.8, 1.6, t.seed + 92);
  }
}

/** Gives each foliage block its tone: lit where it faces the sky or the sun, dark underneath. */
export function dressLeaves(w: World, sunX: number): void {
  const { sx, sy, sz } = w;
  const leaf = B.leaves!;
  const isLeaf = (id: number): boolean => id === leaf || id === B.leaves_lit || id === B.leaves_dark;
  const tones = new Uint8Array(w.blocks.length);
  for (let y = 0; y < sy; y++)
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const i = w.idx(x, y, z);
        if (w.blocks[i] !== leaf) continue;
        const above = w.get(x, y + 1, z);
        const below = w.get(x, y - 1, z);
        const sunward = w.get(x + Math.sign(sunX), y, z);
        const h = ihash(x, y, z, 77);
        if (!above && h < 0.7) tones[i] = B.leaves_lit!;
        else if (!sunward && h < 0.45) tones[i] = B.leaves_lit!;
        else if (!below && isLeaf(above) && h < 0.8) tones[i] = B.leaves_dark!;
      }
  for (let i = 0; i < tones.length; i++) if (tones[i]) w.blocks[i] = tones[i]!;
}
