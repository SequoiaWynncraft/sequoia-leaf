/**
 * The giant sequoia, placed block by block from a seed and an SEQ level (1–13), in six stages.
 * Seeds vary branch azimuths and lengths, lean, flare fins and crown clusters, always inside art-directed bounds:
 * nothing is per-block noise, every shape is a designed form with seeded proportions.
 */
import { clamp, Rng } from "./rng.ts";
import { B, Voxels } from "./world.ts";

export type StageName = "Seedling" | "Sapling" | "Young" | "Mature" | "Ancient" | "Giant";

interface Section {
  w: number;
  to: number;
}

interface Spec {
  stage: StageName;
  height: number;
  trunk: Section[];
  crownBase: number;
  maxR: number;
  flare: number;
}

const SPECS: Record<number, Spec> = {
  1: { stage: "Seedling", height: 0, trunk: [], crownBase: 0, maxR: 0, flare: 0 },
  2: { stage: "Sapling", height: 3, trunk: [{ w: 1, to: 1 }], crownBase: 0, maxR: 1.3, flare: 0 },
  3: { stage: "Sapling", height: 5, trunk: [{ w: 1, to: 1 }], crownBase: 0, maxR: 1.7, flare: 0 },
  4: { stage: "Young", height: 10, trunk: [{ w: 1, to: 1 }], crownBase: 0.1, maxR: 1.8, flare: 0 },
  5: { stage: "Young", height: 13, trunk: [{ w: 1, to: 1 }], crownBase: 0.1, maxR: 2.15, flare: 0 },
  6: { stage: "Mature", height: 16, trunk: [{ w: 2, to: 0.3 }, { w: 1, to: 1 }], crownBase: 0.28, maxR: 3.6, flare: 1 },
  7: { stage: "Mature", height: 19, trunk: [{ w: 2, to: 0.42 }, { w: 1, to: 1 }], crownBase: 0.3, maxR: 4.2, flare: 1 },
  8: { stage: "Mature", height: 22, trunk: [{ w: 2, to: 0.52 }, { w: 1, to: 1 }], crownBase: 0.32, maxR: 4.8, flare: 1 },
  9: { stage: "Ancient", height: 26, trunk: [{ w: 3, to: 0.3 }, { w: 2, to: 0.66 }, { w: 1, to: 1 }], crownBase: 0.44, maxR: 6.0, flare: 2 },
  10: { stage: "Ancient", height: 29, trunk: [{ w: 3, to: 0.38 }, { w: 2, to: 0.72 }, { w: 1, to: 1 }], crownBase: 0.46, maxR: 6.8, flare: 2 },
  11: { stage: "Ancient", height: 32, trunk: [{ w: 3, to: 0.46 }, { w: 2, to: 0.78 }, { w: 1, to: 1 }], crownBase: 0.48, maxR: 7.4, flare: 2 },
  12: { stage: "Giant", height: 35, trunk: [{ w: 4, to: 0.3 }, { w: 3, to: 0.6 }, { w: 2, to: 0.85 }, { w: 1, to: 1 }], crownBase: 0.5, maxR: 8.2, flare: 3 },
  13: { stage: "Giant", height: 39, trunk: [{ w: 4, to: 0.36 }, { w: 3, to: 0.64 }, { w: 2, to: 0.88 }, { w: 1, to: 1 }], crownBase: 0.52, maxR: 9.0, flare: 3 },
};

export interface TreeInfo {
  stage: StageName;
  level: number;
  height: number;
  /** Top of the foliage, in blocks above the ground. */
  top: number;
  /** Widest foliage radius. */
  spread: number;
  /** Radius of the root flare at the ground. */
  footprint: number;
  /** World x/z of the trunk's centre at the ground. */
  cx: number;
  cz: number;
  /** Lower fringe of the crown, for fairy-light festoons: points under cluster tips. */
  fringe: [number, number, number][];
  /** Where a watering can should pour: the trunk base. */
  base: [number, number, number];
  seedling: boolean;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function stageOf(level: number): StageName {
  return (SPECS[clamp(Math.round(level), 1, 13)] ?? SPECS[1]!).stage;
}

export function growTree(w: Voxels, seed: string, level: number): TreeInfo {
  const lvl = clamp(Math.round(level), 1, 13);
  const spec = SPECS[lvl] ?? SPECS[1]!;
  const rng = new Rng(`${seed}:tree`);
  const info: TreeInfo = {
    stage: spec.stage,
    level: lvl,
    height: spec.height,
    top: 1,
    spread: 0,
    footprint: 1,
    cx: 0.5,
    cz: 0.5,
    fringe: [],
    base: [0.5, 1, 0.5],
    seedling: lvl === 1,
  };
  if (lvl === 1) return info;

  const H = spec.height;
  // Lean: one direction per seed; the trunk steps at most a block per section change.
  const leanDirs: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  const lean = rng.pick(leanDirs);
  const leanSteps = spec.stage === "Ancient" || spec.stage === "Giant" ? rng.int(1, 2) : spec.stage === "Mature" ? rng.int(0, 1) : 0;

  // Trunk: square sections, each starting where the last ended. Offsets keep sections centred over each other.
  const centreAt: [number, number][] = [];
  let shift = 0;
  let prevW = spec.trunk[0]?.w ?? 1;
  let minX = 0;
  let minZ = 0;
  let y0 = 0;
  for (const [si, s] of spec.trunk.entries()) {
    const yTop = si === spec.trunk.length - 1 ? H : Math.max(1, Math.round(s.to * H));
    if (si === 0) {
      minX = -Math.floor((s.w - 1) / 2);
      minZ = minX;
    } else {
      // Narrowing: sit inside the old footprint, toward the lean; sometimes step a whole block with it.
      const dw = prevW - s.w;
      const off = (l: number) => (l > 0 ? dw : l < 0 ? 0 : rng.int(0, dw));
      minX += off(lean[0]);
      minZ += off(lean[1]);
      if (shift < leanSteps && rng.chance(0.6)) {
        minX += lean[0];
        minZ += lean[1];
        shift++;
      }
    }
    for (let y = y0; y < yTop; y++) {
      for (let dx = 0; dx < s.w; dx++) for (let dz = 0; dz < s.w; dz++) w.set(minX + dx, y, minZ + dz, B.Bark);
      centreAt[y] = [minX + s.w / 2, minZ + s.w / 2];
    }
    y0 = yTop;
    prevW = s.w;
  }
  const centre = (y: number): [number, number] => centreAt[clamp(Math.round(y), 0, centreAt.length - 1)] ?? [0.5, 0.5];
  const [bx, bz] = centre(0);
  info.cx = bx;
  info.cz = bz;
  const baseW = spec.trunk[0]?.w ?? 1;

  // Root flare: a skirt round the trunk, then buttress fins stepping down outward, spaced unevenly.
  let footprint = baseW / 2;
  if (spec.flare > 0) {
    const skirtH = spec.flare;
    const half = Math.floor((baseW - 1) / 2);
    const minX = -half;
    const minZ = -half;
    const maxX = minX + baseW - 1;
    const maxZ = minZ + baseW - 1;
    for (let x = minX - 1; x <= maxX + 1; x++)
      for (let z = minZ - 1; z <= maxZ + 1; z++) {
        const edgeX = x < minX || x > maxX;
        const edgeZ = z < minZ || z > maxZ;
        if (edgeX && edgeZ) continue;
        if (!edgeX && !edgeZ) continue;
        const hgt = skirtH - (rng.chance(0.35) ? 1 : 0);
        for (let y = 0; y <= hgt; y++) w.set(x, y, z, B.Bark);
      }
    const fins = spec.flare === 1 ? 3 : spec.flare === 2 ? 4 : 5;
    const start = rng.next() * Math.PI * 2;
    let angle = start;
    const finLen = spec.flare + 1;
    for (let f = 0; f < fins; f++) {
      angle += ((Math.PI * 2) / fins) * (0.7 + rng.next() * 0.6);
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const len = finLen + rng.int(0, 1);
      const r0 = baseW / 2 + 0.5;
      for (let i = 0; i <= len; i++) {
        const fx = Math.floor(bx + dx * (r0 + i));
        const fz = Math.floor(bz + dz * (r0 + i));
        const hgt = Math.max(0, Math.round((spec.flare + 1.5) * (1 - i / (len + 0.6))));
        for (let y = 0; y <= hgt; y++) w.set(fx, y, fz, B.Bark);
        footprint = Math.max(footprint, r0 + i);
      }
    }
  }
  info.footprint = footprint;

  // Fire scar on the giants: charred bark and a shallow hollow on one face. Sequoias wear them proudly.
  if (spec.stage === "Giant") {
    const face = rng.pick<[number, number]>([
      [-1, 0],
      [0, -1],
      [-1, -1],
    ]);
    const half = Math.floor((baseW - 1) / 2);
    for (let y = 0; y < 6; y++) {
      const width = y < 3 ? 3 : y < 5 ? 2 : 1;
      for (let k = 0; k < width; k++) {
        const along = k - Math.floor(width / 2);
        const tx = face[0] !== 0 ? (face[0] < 0 ? -half : half) : along;
        const tz = face[1] !== 0 ? (face[1] < 0 ? -half : half) : along;
        if (w.get(tx, y, tz) !== B.Air) w.set(tx, y, tz, B.Char);
        const ex = tx + face[0];
        const ez = tz + face[1];
        if (w.get(ex, y, ez) !== B.Air) w.set(ex, y, ez, y < 3 && k === Math.floor(width / 2) ? B.Air : B.Char);
      }
    }
  }

  // Moss creeps up the lower trunk and flare.
  for (let y = 0; y <= 6; y++)
    for (let x = -6; x <= 6; x++)
      for (let z = -6; z <= 6; z++) {
        if (w.get(x, y, z) !== B.Bark) continue;
        const exposedUp = w.get(x, y + 1, z) === B.Air;
        if (y <= 1 || (exposedUp && y <= 3)) w.set(x, y, z, B.BarkMossy);
        else if (y <= 3 || (y <= 6 && (x * 7 + z * 13 + y * 5) % 3 === 0)) w.set(x, y, z, B.BarkMoss);
      }

  let clusterId = 1;
  let spread = 0;
  let top = H;
  const leaf = (x: number, y: number, z: number, id: number) => {
    if (w.get(x, y, z) !== B.Air) return;
    w.set(x, y, z, B.Leaf, id);
    const i = w.index(x, y, z);
    if (i >= 0) w.sway[i] = clamp(0.25 + (0.75 * y) / Math.max(8, H), 0, 1);
    spread = Math.max(spread, Math.hypot(x + 0.5 - bx, z + 0.5 - bz));
    top = Math.max(top, y + 1);
  };
  /** A cloud of foliage: an ellipsoid, rounder on top and flatter underneath, its corners trimmed. */
  const cloud = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, id: number) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
        for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
          const dy = y + 0.5 - cy;
          const k = dy < 0 ? 1.45 : 1.0;
          const d = ((x + 0.5 - cx) / rx) ** 2 + ((dy * k) / ry) ** 2 + ((z + 0.5 - cz) / rz) ** 2;
          if (d <= 1.0) leaf(x, y, z, id);
        }
  };
  const branch = (sy: number, angle: number, len: number, rise: number): [number, number, number] => {
    const [cx, cz] = centre(sy);
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    let last: [number, number, number] = [Math.floor(cx), sy, Math.floor(cz)];
    for (let s = 0.6; s <= len; s += 0.5) {
      const x = Math.floor(cx + dx * s);
      const z = Math.floor(cz + dz * s);
      const y = Math.floor(sy + rise * (s / len) ** 1.6);
      if (w.get(x, y, z) === B.Air || w.get(x, y, z) === B.Leaf) w.set(x, y, z, Math.abs(dx) > Math.abs(dz) ? B.LogX : B.LogZ);
      last = [x, y, z];
    }
    return last;
  };

  if (spec.stage === "Sapling" || spec.stage === "Young") {
    // A dense narrow spire in whorled tiers, a leader at the tip.
    const base = Math.max(1, Math.round(spec.crownBase * H));
    const topY = H + 1;
    const tierGap = spec.stage === "Young" ? rng.int(2, 3) : 2;
    const tierPhase = rng.int(0, tierGap - 1);
    const wobble = Array.from({ length: 24 }, () => rng.range(0, Math.PI * 2));
    for (let y = base; y <= topY; y++) {
      const t = (topY - y) / Math.max(1, topY - base);
      let r = spec.maxR * t ** 0.85 + 0.35;
      const tier = (y - base + tierPhase) % tierGap === 0;
      if (tier && y < topY - 1) r += 0.55;
      const [cx, cz] = centre(Math.min(y, H - 1));
      const tierIndex = Math.floor((y - base) / tierGap);
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++)
        for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r + 1); z++) {
          const ang = Math.atan2(z + 0.5 - cz, x + 0.5 - cx);
          const rr = r * (1 + 0.12 * Math.sin(ang * 2 + (wobble[tierIndex % 24] ?? 0)));
          if ((x + 0.5 - cx) ** 2 + (z + 0.5 - cz) ** 2 <= rr * rr + 0.25) {
            const sector = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 6) % 6;
            leaf(x, y, z, 1 + tierIndex * 8 + sector);
          }
        }
    }
    const [cx, cz] = centre(H - 1);
    leaf(Math.floor(cx), topY + 1, Math.floor(cz), 999);
    for (let y = base; y <= topY; y += tierGap) info.fringe.push([cx + spec.maxR * 0.6, y, cz]);
  } else {
    const ancient = spec.stage === "Ancient" || spec.stage === "Giant";
    const base = Math.round(spec.crownBase * H);
    const topY = H;
    // Short stubs below the crown, like old self-pruned branches.
    if (ancient) {
      // Three stubs at well-separated heights and directions, so they never pair up into a face.
      const a0 = rng.next() * Math.PI * 2;
      [0.38, 0.62, 0.86].forEach((f, k) => branch(Math.round(base * f), Math.round((a0 + k * 2.3) / (Math.PI / 2)) * (Math.PI / 2), spec.trunk[0]!.w / 2 + 0.9, 0));
    }
    // Branches climb the trunk on a golden-angle spiral with seeded jitter, so no two whorls repeat.
    let angle = rng.next() * Math.PI * 2;
    let y = base;
    const clusters: { x: number; y: number; z: number; rx: number; ry: number; rz: number }[] = [];
    const giant = spec.stage === "Giant";
    while (y < topY - 1) {
      const t = (y - base) / Math.max(1, topY - base);
      // Envelope: mature crowns are long cones; ancient crowns are rounded domes, widest low in the crown.
      const env = ancient ? Math.sin(Math.PI * (0.18 + 0.82 * t)) ** 0.7 * (t < 0.12 ? 0.75 + t * 2 : 1) : (1 - t) ** 0.8 * Math.min(1, 0.55 + t * 3);
      const count = ancient && env > 0.7 && rng.chance(0.3) ? 2 : 1;
      for (let c = 0; c < count; c++) {
        const a = angle + c * (Math.PI * 0.85 + rng.range(-0.3, 0.3));
        const len = Math.max(1.2, spec.maxR * env - (ancient ? 2.1 : 1.2) + rng.range(-0.6, 0.6));
        const rise = ancient ? rng.range(1.2, 2.6) : rng.range(0.4, 1.2);
        const tip = branch(y, a, len, rise);
        const size = ancient ? rng.range(2.5, 3.3) * (0.72 + env * 0.42) * (giant ? 1.1 : 1) : rng.range(1.4, 2.3);
        clusters.push({ x: tip[0] + 0.5, y: tip[1] + (ancient ? 0.8 : 0.5), z: tip[2] + 0.5, rx: size, ry: size * (ancient ? 0.74 : 0.88), rz: size * rng.range(0.85, 1.1) });
      }
      angle += GOLDEN + rng.range(-0.35, 0.35);
      y += ancient ? (t > 0.55 ? rng.int(2, 3) : rng.int(1, 2)) : rng.int(1, 2);
    }
    for (const c of clusters) {
      const id = clusterId++;
      cloud(c.x, c.y, c.z, c.rx, c.ry, c.rz, id);
      // Lumps round the cloud's upper rim so pads read soft and clumpy, never as plates.
      if (ancient) {
        const lumps = 1 + Math.floor(rng.next() * 2);
        for (let k = 0; k < lumps; k++) {
          const a = rng.next() * Math.PI * 2;
          const r = c.rx * rng.range(0.45, 0.75);
          cloud(c.x + Math.cos(a) * r, c.y + c.ry * rng.range(0.25, 0.6), c.z + Math.sin(a) * r, c.rx * 0.5, c.ry * 0.7, c.rz * 0.5, id);
        }
      }
      info.fringe.push([c.x, c.y - c.ry * 0.7, c.z]);
    }
    // A core of foliage round the upper trunk so the crown reads full, and a rounded top.
    const coreFrom = ancient ? Math.round(base + (topY - base) * 0.35) : base + 1;
    for (let yy = coreFrom; yy <= topY; yy++) {
      const t = (yy - coreFrom) / Math.max(1, topY - coreFrom);
      const r = ancient ? 1.7 + 1.1 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)) : 1.4 + (1 - t) * 1.2;
      const [cx, cz] = centre(Math.min(yy, H - 1));
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
          if ((x + 0.5 - cx) ** 2 + (z + 0.5 - cz) ** 2 <= r * r) leaf(x, yy, z, 0);
    }
    const [tx, tz] = centre(H - 1);
    if (ancient) {
      cloud(tx, topY + 0.6, tz, giant ? 3.6 : 3.1, giant ? 2.6 : 2.3, giant ? 3.4 : 3.0, clusterId++);
      // Old giants often carry a dead spike top above the living crown.
      if (spec.stage === "Giant" || rng.chance(0.5)) {
        const spike = rng.int(2, 4);
        for (let k = 0; k < spike; k++) w.set(Math.floor(tx), Math.ceil(topY + 2.2) + k, Math.floor(tz), B.LogY);
        top = Math.max(top, Math.ceil(topY + 2.2) + spike);
      }
    } else {
      cloud(tx, topY + 0.5, tz, 1.4, 1.8, 1.4, clusterId++);
      leaf(Math.floor(tx), topY + 2, Math.floor(tz), clusterId++);
    }
  }
  info.top = top;
  info.spread = spread;
  info.base = [bx, 1, bz];
  return info;
}

/** Removes a pad: the foliage of one cluster within reach of the tapped block. Returns the removed cells. */
export function prune(w: Voxels, x: number, y: number, z: number): [number, number, number][] {
  if (w.get(x, y, z) !== B.Leaf) return [];
  const id = w.clusterAt(x, y, z);
  const removed: [number, number, number][] = [];
  const r = id === 0 ? 1.6 : 2.4;
  for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++)
    for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++)
      for (let zz = Math.floor(z - r); zz <= Math.ceil(z + r); zz++) {
        if (w.get(xx, yy, zz) !== B.Leaf || w.clusterAt(xx, yy, zz) !== id) continue;
        if ((xx - x) ** 2 + (yy - y) ** 2 * 1.4 + (zz - z) ** 2 > r * r) continue;
        w.set(xx, yy, zz, B.Air);
        removed.push([xx, yy, zz]);
      }
  return removed;
}

export { Voxels };
