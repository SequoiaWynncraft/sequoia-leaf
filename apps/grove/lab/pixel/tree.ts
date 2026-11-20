/**
 * The player's giant sequoia, from seedling to giant over SEQ levels 1 to 13.
 *
 * Six hand-designed stages. Within a stage the seed varies the tree's lean, where its limbs come
 * out, the size and place of its crown pads, its top and whether it carries an old fire scar, all
 * inside bounds the stage sets, so every tree is someone's own and none looks random.
 *
 * The crown is drawn in FOLI. Its colours are the renderer's: `Tree.gold` says how far toward the
 * guild's gold the crown has turned (`canopyGold(level)` unless overridden), and
 * `buildLut(time, season, rarity, tree.gold)` gives FOLI those colours.
 */

import { drawTrunk, type TrunkSpec } from "./bark.ts";
import { type Lobe, type PadArt, renderPad, snowCap } from "./foliage.ts";
import { canopyGold, ix, R, type Season } from "./palette.ts";
import { fromRows, type Sprite, type Surface } from "./raster.ts";
import { hash3, hashString, Rng } from "./rng.ts";

export type StageName = "seedling" | "sapling" | "young" | "mature" | "ancient" | "giant";

export const STAGE_OF_LEVEL: readonly StageName[] = [
  "seedling",
  "seedling",
  "sapling",
  "sapling",
  "young",
  "mature",
  "mature",
  "mature",
  "ancient",
  "ancient",
  "ancient",
  "ancient",
  "giant",
];

/** The stage's name as the GG card and the HUD show it. */
export const STAGE_TITLE: Record<StageName, string> = {
  seedling: "Seedling",
  sapling: "Sapling",
  young: "Young sequoia",
  mature: "Mature sequoia",
  ancient: "Ancient sequoia",
  giant: "Giant sequoia",
};

export interface Pad {
  id: number;
  lobes: Lobe[];
  art: PadArt;
  pruned: PadArt;
  /** Behind the trunk: drawn into the still layer, darker. */
  back: boolean;
  /** Sway in pixels at the pad's height, and its phase. */
  sway: number;
  phase: number;
  /** A box for hit testing, in glade pixels. */
  box: { x0: number; y0: number; x1: number; y1: number };
}

export interface Tree {
  stage: StageName;
  level: number;
  foot: { x: number; y: number };
  top: number;
  pads: Pad[];
  /** Where water and mist land: the crown's box. */
  crown: { x0: number; y0: number; x1: number; y1: number };
  /** The seedling's frames, drawn each frame for its sway. */
  seedling: Sprite[] | null;
  /** Lanterns hung in a giant's lower crown, as the guild hangs them in the Great Sequoia. */
  lanterns: { x: number; y: number }[];
  /** Draws the still parts: back pads, trunk, limbs, roots. */
  paintStill(s: Surface): void;
  /** How far the crown has turned toward the guild's gold, 0 to 1. Pass it to `buildLut`. */
  gold?: number;
}

export interface GrowOptions {
  /** Override the crown's gold (0 summer green to 1 the guild's gold) instead of the level's. */
  gold?: number;
}

interface Ctx {
  rng: Rng;
  seed: number;
  x: number;
  foot: number;
  season: Season;
  pruned: ReadonlySet<number>;
}

export function growTree(
  level: number,
  seedText: string,
  x: number,
  foot: number,
  season: Season,
  pruned: ReadonlySet<number>,
  options: GrowOptions = {},
): Tree {
  const stage = STAGE_OF_LEVEL[Math.max(0, Math.min(12, level - 1))] ?? "mature";
  const seed = hashString(`${seedText}:tree`);
  const c: Ctx = { rng: new Rng(seed), seed, x, foot, season, pruned };
  const tree = grow(c, stage, level);
  tree.gold = options.gold ?? canopyGold(level);
  return tree;
}

function grow(c: Ctx, stage: StageName, level: number): Tree {
  switch (stage) {
    case "seedling":
      return seedlingTree(c, level);
    case "sapling":
    case "young":
      return spireTree(c, stage, level);
    case "mature":
      return matureTree(c, level);
    case "ancient":
    case "giant":
      return cloudTree(c, stage, level);
  }
}

// ---------------------------------------------------------------------------------------------
// Seedling: hand drawn. A red stem, two whorls of soft scale-leaves, cotyledons, a twine stake.

/**
 * Young growth is the freshest green in the glade: the crown's own ramp at its lightest, so it
 * stands out from the olive moss, a red stem, and the sun's gold on the very tips.
 */
const SEEDLING_LEGEND = {
  s: ix(R.BARK, 6),
  S: ix(R.BARK, 5),
  r: ix(R.BARK, 7),
  g: ix(R.FOLI, 6),
  G: ix(R.FOLI, 7),
  d: ix(R.FOLI, 4),
  h: ix(R.OLIVE, 7),
};

const SEEDLINGS: readonly (readonly string[])[] = [
  // Level 1: a red stem, a star of needle-like cotyledons, and the first tuft of true needles.
  [
    ".........h.........",
    "........GhG........",
    ".......GgGgG.......",
    "......h.drd.h......",
    "...G....gsg....G...",
    "....GgG.gsg.GgG....",
    "......GgGsGgG......",
    "hGgg.....s.....ggGh",
    "..dGggG..s..GggGd..",
    "....ddd..s..ddd....",
    ".........s.........",
    ".........s.........",
    ".........s.........",
    ".........S.........",
  ],
  // Level 2: whorls of short needle sprays up a taller stem, the cotyledons below.
  [
    "..........h..........",
    ".........GhG.........",
    "........GgGgG........",
    ".......h..r..h.......",
    "......GgG.s.GgG......",
    ".....G...gsg...G.....",
    "..........s..........",
    "...hGgG...s...GgGh...",
    "..G...ggG.s.Ggg...G..",
    "......dd..s..dd......",
    "..........s..........",
    ".hGggG....s....GggGh.",
    "G....gggG.s.Gggg....G",
    "...ddd....s....ddd...",
    "..........s..........",
    "hGgg......s......ggGh",
    "..dGggG...s...GggGd..",
    "....ddd...s...ddd....",
    "..........s..........",
    "..........S..........",
  ],
];

/** The same seedling a pixel to the left and right, for its sway. */
function swayFrames(rows: readonly string[]): Sprite[] {
  const lean = (dir: number): string[] =>
    rows.map((row, i) => {
      // The top half leans; the stem's base stays put.
      if (i >= rows.length / 2) return row;
      return dir > 0 ? "." + row.slice(0, -1) : row.slice(1) + ".";
    });
  return [fromRows(rows, SEEDLING_LEGEND), fromRows(lean(1), SEEDLING_LEGEND), fromRows(lean(-1), SEEDLING_LEGEND)];
}

function seedlingTree(c: Ctx, level: number): Tree {
  const rows = SEEDLINGS[Math.min(1, level - 1)] ?? SEEDLINGS[0] ?? [];
  const frames = swayFrames(rows);
  const first = frames[0];
  const h = first?.h ?? 10;
  const w = first?.w ?? 9;
  return {
    stage: "seedling",
    level,
    foot: { x: c.x, y: c.foot },
    top: c.foot - h,
    pads: [],
    crown: { x0: c.x - w, y0: c.foot - h - 4, x1: c.x + w, y1: c.foot + 2 },
    seedling: frames,
    lanterns: [],
    paintStill(s) {
      // A bed of dark turned soil, so the sprout stands clear of the moss, mounded at its foot,
      // a ring of pebbles round it and a twine stake with a tag beside it.
      for (let y = c.foot - 4; y <= c.foot + 4; y++) {
        for (let x = c.x - 12; x <= c.x + 12; x++) {
          const d = ((x - c.x) / 12) ** 2 + ((y - c.foot - 0.5) / 4) ** 2;
          if (d > 1 - hash3(x, y, 3) * 0.12) continue;
          s.set(x, y, ix(R.SOIL, d > 0.75 ? 3 : hash3(x, y, 5) < 0.18 ? 2 : 1));
        }
      }
      for (let dx = -5; dx <= 5; dx++) {
        const d = Math.abs(dx) / 5;
        const rows2 = d < 0.5 ? 2 : 1;
        for (let dy = 0; dy < rows2; dy++) s.set(c.x + dx, c.foot - dy, ix(R.SOIL, dy === rows2 - 1 ? 4 : 2));
      }
      for (const [px, py] of [
        [-11, 0],
        [-9, 3],
        [-4, 4],
        [4, 4],
        [9, 3],
        [11, 0],
        [-7, -3],
        [7, -3],
      ] as const) {
        s.set(c.x + px, c.foot + py, ix(R.STONE, 5));
        s.set(c.x + px + 1, c.foot + py, ix(R.STONE, 3));
        s.set(c.x + px, c.foot + py - 1, ix(R.STONE, 6));
      }
      const sx = c.x + Math.ceil(w / 2) + 3;
      const stakeTop = c.foot - h - 2;
      for (let y = stakeTop; y <= c.foot; y++) {
        s.set(sx, y, ix(R.WOOD, y < stakeTop + 2 ? 6 : 4));
        s.set(sx + 1, y, ix(R.WOOD, 2));
      }
      // A little tag tied to the stake, and twine to the stem.
      s.rect(sx + 2, stakeTop + 3, 3, 4, ix(R.CREAM, 5));
      s.rect(sx + 2, stakeTop + 6, 3, 1, ix(R.CREAM, 3));
      s.set(sx + 3, stakeTop + 4, ix(R.LIGHTS, 4));
      const ty = c.foot - Math.round(h * 0.5);
      for (let x = c.x + 1; x < sx; x++) s.set(x, ty + ((x - c.x) % 3 === 0 ? 0 : 0), ix(R.CREAM, 3));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Sapling and young: a dense spire of drooping tiers, opening into separate clumps as it ages.

interface SpireSpec {
  h: number;
  halfW: number;
  bare: number;
  tierH: number;
  clump: number;
  trunkBase: number;
  flare: number;
  /** 0 a tight spire, 1 tiers broken into separate pads with sky between. */
  open: number;
}

const SPIRES: Record<"sapling" | "young", (level: number) => SpireSpec> = {
  sapling: (l) => ({
    h: l === 3 ? 40 : 52,
    halfW: l === 3 ? 10 : 13,
    bare: 5,
    tierH: 4.5,
    clump: 1.8,
    trunkBase: 1.2,
    flare: 1.5,
    open: 0,
  }),
  young: () => ({
    h: 100,
    halfW: 20,
    bare: 8,
    tierH: 6.5,
    clump: 2.3,
    trunkBase: 3,
    flare: 3,
    open: 0.12,
  }),
};

function spireTree(c: Ctx, stage: "sapling" | "young", level: number): Tree {
  const spec = SPIRES[stage](level);
  const rng = c.rng;
  const lean = rng.range(-1, 1) * 2;
  const top = c.foot - spec.h;
  const cxAt = (y: number): number => c.x + lean * Math.pow((c.foot - y) / spec.h, 1.6);
  const trunk: TrunkSpec = {
    top: top + 2,
    foot: c.foot,
    cx: cxAt,
    hw: (y) => {
      const t = (c.foot - y) / spec.h;
      return Math.max(0.6, spec.trunkBase * (1 - t * 0.85)) + spec.flare * Math.exp(-(c.foot - y) / 4);
    },
    light: 0.3,
    rimLeft: stage !== "sapling",
    rimRight: false,
    seed: c.seed,
    furrow: 2.6,
    moss: 0,
  };

  const pads: Pad[] = [];
  const crownBottom = c.foot - spec.bare;
  const crownH = crownBottom - top;
  let y = crownBottom;
  let id = 0;
  const tiers: { y: number; t: number }[] = [];
  while (y > top + spec.tierH * 0.6) {
    tiers.push({ y, t: (crownBottom - y) / crownH });
    y -= spec.tierH * rng.range(0.85, 1.12);
  }
  // Painted from the bottom up: each tier's dark belly lies over the tier below, the shelf of
  // shade that makes a conifer read as layered branches. Each tier is a drooping spray whose
  // tips turn up at the ends.
  for (const tier of tiers) {
    const env = Math.pow(1 - tier.t, 0.9);
    const half = Math.max(2, spec.halfW * env);
    const left = half * rng.range(0.82, 1.05);
    const right = half * rng.range(0.82, 1.05);
    const cx = cxAt(tier.y);
    const ry = Math.max(1.6, spec.tierH * (0.5 + 0.18 * (1 - tier.t)));
    const droop = Math.max(1, spec.tierH * 0.35);
    const split = spec.open > 0 && half > 10 && rng.chance(spec.open);
    if (split) {
      // Two sprays on short limbs with a gap of trunk between: the crown opening as it ages.
      for (const side of [-1, 1] as const) {
        const reach = side < 0 ? left : right;
        const lobes: Lobe[] = [
          { x: cx + side * reach * 0.55, y: tier.y + droop * 0.5, rx: reach * 0.47, ry },
          { x: cx + side * reach * 0.3, y: tier.y - ry * 0.3, rx: reach * 0.28, ry: ry * 0.7 },
          { x: cx + side * reach * 0.9, y: tier.y + droop * 0.2 - 1, rx: reach * 0.14, ry: ry * 0.5 },
        ];
        pads.push(makePad(c, id++, lobes, false, tier.t, stage));
      }
    } else {
      const lobes: Lobe[] = [
        { x: cx, y: tier.y - ry * 0.15, rx: half * 0.45, ry },
        { x: cx - left * 0.55, y: tier.y + droop, rx: left * 0.46, ry: ry * 0.78 },
        { x: cx + right * 0.55, y: tier.y + droop, rx: right * 0.46, ry: ry * 0.78 },
        { x: cx - left * 0.92, y: tier.y + droop * 0.6 - 1, rx: Math.max(1, left * 0.13), ry: ry * 0.5 },
        { x: cx + right * 0.92, y: tier.y + droop * 0.6 - 1, rx: Math.max(1, right * 0.13), ry: ry * 0.5 },
      ];
      pads.push(makePad(c, id++, lobes, false, tier.t, stage));
    }
  }
  // The leader: a soft spike above the last tier.
  const leaderX = Math.round(cxAt(top));
  return finishTree(c, stage, level, top, pads, (s) => {
    drawTrunk(s, trunk);
    for (let i = 0; i < 4; i++) s.set(leaderX, top + i - 1, ix(R.FOLI, i === 0 ? 7 : 5));
    s.set(leaderX - 1, top + 2, ix(R.FOLI, 4));
    s.set(leaderX + 1, top + 3, ix(R.FOLI, 3));
    if (stage !== "sapling") roots(s, c, trunk, 2);
    if (stage !== "sapling") litter(s, c.x, c.foot, 20, c.season);
  });
}

// ---------------------------------------------------------------------------------------------
// Mature: a sequoia a century or two old. The cinnamon trunk shows bare for its lower quarter and
// flares into its roots; above, the crown is a narrow bullet of clumped, clouded masses on short
// drooping limbs, alternating side to side with trunk and sky showing between them, closing in a
// rounded top, never a spire's point. Denser and narrower than an ancient's broad clouds.

function matureTree(c: Ctx, level: number): Tree {
  const k = Math.max(0, Math.min(2, level - 6));
  const rng = c.rng;
  const h = 118 + k * 12;
  const top = c.foot - h;
  const crownBottom = Math.round(c.foot - h * (0.25 + k * 0.012));
  const crownH = crownBottom - top;
  const halfW = 17 + k * 3;
  const lean = rng.range(-1, 1) * 1.5;
  const cxAt = (y: number): number => c.x + lean * Math.pow(Math.max(0, c.foot - y) / h, 1.5);
  const base = 4.6 + k * 0.7;
  const flare = 5 + k;
  const hwAt = (y: number): number => {
    const t = Math.max(0, (c.foot - y) / h);
    return Math.max(0.8, base * (1 - t * 0.82)) + flare * Math.exp(-(c.foot - y) / 5.5);
  };
  const trunk: TrunkSpec = {
    top: top + 8,
    foot: c.foot,
    cx: cxAt,
    hw: hwAt,
    light: 0.3,
    rimLeft: true,
    rimRight: false,
    seed: c.seed,
    furrow: 2.8,
    moss: 0.35,
  };

  // The crown's outline: broadest low down, narrowing slowly, then rounding over the top.
  const env = (t: number): number => {
    const u = Math.max(0, Math.min(1, t));
    return halfW * Math.sqrt(1 - Math.pow(u, 2.6)) * (1 - 0.22 * u);
  };

  const pads: Pad[] = [];
  let id = 0;
  const lumpy = (x: number, y: number, r: number, flat: number): Lobe[] => {
    const rx = r * rng.range(0.9, 1.1);
    const ry = rx * flat * rng.range(0.92, 1.08);
    const lobes: Lobe[] = [{ x, y, rx, ry }];
    const bumps = rng.int(1, 2);
    for (let b = 0; b < bumps; b++) {
      const side = b === 0 ? (rng.chance(0.5) ? -1 : 1) : -1;
      lobes.push({
        x: x + side * rx * rng.range(0.25, 0.5),
        y: y - ry * rng.range(0.35, 0.6),
        rx: rx * rng.range(0.45, 0.62),
        ry: ry * rng.range(0.7, 0.9),
      });
    }
    return lobes;
  };

  // Shade behind the trunk, so gaps between the masses have depth rather than sky.
  for (let i = 0; i < 3; i++) {
    const t = 0.12 + i * 0.3;
    const y = crownBottom - t * crownH;
    const r = env(t) * 0.5;
    pads.push(makePad(c, id++, lumpy(cxAt(y) + (i % 2 ? 2 : -2), y, r, 0.75), true, t, "mature"));
  }

  // The masses, bottom up: one on a short limb to one side, now and then a smaller one across the
  // trunk a little higher, mostly alternating as real crowns grow.
  interface Mass {
    x: number;
    y: number;
    r: number;
    flat: number;
    limb: boolean;
  }
  const masses: Mass[] = [];
  let side = rng.chance(0.5) ? -1 : 1;
  let y = crownBottom + 1;
  while (y > top + 20) {
    const t = (crownBottom - y) / crownH;
    const e = env(t);
    // Each mass reaches from near the trunk out to the crown's edge: drooping, flat beneath.
    const r = e * rng.range(0.5, 0.58) + 2;
    masses.push({ x: cxAt(y) + side * (e - r * 0.85), y, r, flat: 0.4, limb: true });
    if (rng.chance(t < 0.6 ? 0.55 : 0.35)) {
      const y2 = y - rng.range(3, 5);
      const r2 = r * rng.range(0.6, 0.72);
      masses.push({ x: cxAt(y2) - side * (e * 0.9 - r2 * 0.8), y: y2, r: r2, flat: 0.42, limb: true });
    }
    y -= rng.range(7, 9.5) * (1 - t * 0.2);
    if (rng.chance(0.82)) side = -side;
  }
  // The rounded top: a dome over the head of the trunk and a shoulder just under it.
  const domeR = halfW * 0.42 + 1.5;
  masses.push({ x: cxAt(top + 9) + rng.range(-1, 1), y: top + domeR * 0.7, r: domeR, flat: 0.72, limb: false });
  masses.push({
    x: cxAt(top + 18) + (rng.chance(0.5) ? -1 : 1) * halfW * 0.22,
    y: top + domeR * 0.7 + 9,
    r: domeR * 0.95,
    flat: 0.58,
    limb: false,
  });
  for (const m of masses.toSorted((a, b) => b.y - a.y)) {
    const t = (crownBottom - m.y) / crownH;
    pads.push(makePad(c, id++, lumpy(m.x, m.y, m.r, m.flat), false, t, "mature"));
  }

  const limbs = masses.filter((m) => m.limb);
  return finishTree(c, "mature", level, top, pads, (s) => {
    for (const p of pads) if (p.back) blitPad(s, p, c.pruned.has(p.id), 0);
    drawTrunk(s, trunk);
    // Short limbs out to each mass, drooping a little before they turn up, lit along their tops.
    for (const m of limbs) {
      const y0 = Math.round(m.y + 4);
      const dir = Math.sign(m.x - cxAt(y0)) || 1;
      const x0 = cxAt(y0) + dir * hwAt(y0) * 0.5;
      const x1 = m.x - dir * m.r * 0.25;
      const n = Math.ceil(Math.abs(x1 - x0)) + 1;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const x = Math.round(x0 + (x1 - x0) * u);
        const yy = Math.round(y0 + Math.sin(u * Math.PI) * 1.5 - u * u * 3);
        const thick = u < 0.55;
        s.set(x, yy - 1, ix(R.BARK, 6));
        s.set(x, yy, ix(R.BARK, thick ? 4 : 3));
        if (thick) s.set(x, yy + 1, ix(R.BARK, 2));
      }
    }
    roots(s, c, trunk, 3);
    litter(s, c.x, c.foot, 30, c.season);
  });
}

// ---------------------------------------------------------------------------------------------
// Ancient and giant: a bare cinnamon column on a buttressed foot, great limbs, a rounded crown of
// clouded pads with sky between them.

interface CloudSpec {
  h: number;
  bare: number;
  crownW: number;
  hwBase: number;
  hwTop: number;
  flare: number;
  limbs: number;
  pad: number;
  clump: number;
}

const CLOUDS: Record<"ancient" | "giant", (level: number) => CloudSpec> = {
  ancient: (l) => ({
    h: 154 + (l - 9) * 7,
    bare: 0.44,
    crownW: 37 + (l - 9) * 3,
    hwBase: 11 + (l - 9),
    hwTop: 4.5,
    flare: 11,
    limbs: 5 + (l > 10 ? 1 : 0),
    pad: 13.5 + (l - 9),
    clump: 3,
  }),
  giant: () => ({ h: 232, bare: 0.37, crownW: 66, hwBase: 19, hwTop: 7, flare: 17, limbs: 8, pad: 19, clump: 3.3 }),
};

function cloudTree(c: Ctx, stage: "ancient" | "giant", level: number): Tree {
  const spec = CLOUDS[stage](level);
  const rng = c.rng;
  const top = c.foot - spec.h;
  const crownBottom = Math.round(c.foot - spec.h * spec.bare);
  const lean = rng.range(-1, 1) * 4;
  const bend = rng.range(-1, 1) * 2;
  const cxAt = (y: number): number => {
    const t = (c.foot - y) / spec.h;
    return c.x + lean * Math.pow(t, 1.5) + bend * Math.sin(Math.PI * t);
  };
  const buttress = rng.range(0.85, 1.15);
  const hwAt = (y: number): number => {
    const t = Math.max(0, (c.foot - y) / spec.h);
    const flare = spec.flare * buttress * Math.exp(-(c.foot - y) / (spec.h * 0.07));
    return spec.hwBase + (spec.hwTop - spec.hwBase) * Math.pow(t, 0.8) + flare;
  };
  const trunk: TrunkSpec = {
    top: top + 6,
    foot: c.foot,
    cx: cxAt,
    hw: hwAt,
    light: 0.32,
    rimLeft: true,
    rimRight: false,
    seed: c.seed,
    furrow: stage === "giant" ? 4.2 : 3.4,
    moss: rng.range(0.3, 0.8),
  };

  // Crown envelope: broadest a third of the way up the crown, rounded over the top.
  const crownH = crownBottom - top;
  const envelope = (t: number): number =>
    spec.crownW * Math.pow(Math.sin(Math.PI * (0.1 + 0.86 * Math.min(1, t))), 0.55) * (1 - 0.22 * t);

  interface Limb {
    side: number;
    y0: number;
    x1: number;
    y1: number;
    t: number;
  }
  const limbs: Limb[] = [];
  let side = rng.chance(0.5) ? -1 : 1;
  for (let i = 0; i < spec.limbs; i++) {
    const t = 0.02 + (i / (spec.limbs - 1 || 1)) * 0.72 + rng.range(-0.03, 0.03);
    const y0 = Math.round(crownBottom - t * crownH);
    const reach = envelope(t + 0.12) * rng.range(0.55, 0.8);
    const rise = rng.range(8, 14) * (stage === "giant" ? 1.3 : 1);
    limbs.push({ side, y0, x1: cxAt(y0) + side * reach, y1: y0 - rise, t });
    // Mostly alternating, now and then two on one side, as real crowns grow.
    if (rng.chance(0.78)) side = -side;
  }

  const pads: Pad[] = [];
  let id = 0;
  const padLobes = (x: number, y: number, size: number, flat = 0.52): Lobe[] => {
    const rx = size * rng.range(0.88, 1.12);
    const ry = rx * flat * rng.range(0.9, 1.1);
    const lobes: Lobe[] = [{ x, y, rx, ry }];
    // One or two smaller clouds riding on its shoulders make it lumpy, never round.
    const bumps = rng.int(1, 2);
    for (let b = 0; b < bumps; b++) {
      const s2 = b === 0 ? (rng.chance(0.5) ? -1 : 1) : -1;
      lobes.push({
        x: x + s2 * rx * rng.range(0.25, 0.5),
        y: y - ry * rng.range(0.35, 0.65),
        rx: rx * rng.range(0.42, 0.6),
        ry: ry * rng.range(0.7, 0.9),
      });
    }
    return lobes;
  };

  // A little dark interior close round the trunk, so the gaps between clouds have depth.
  for (let i = 0; i < 2; i++) {
    const t = 0.3 + i * 0.35;
    const y = crownBottom - t * crownH;
    pads.push(makePad(c, id++, padLobes(cxAt(y) + (i ? 1 : -1) * 3, y, envelope(t) * 0.42, 0.7), true, t, stage));
  }

  // Cloud tiers: each limb carries a broad cloud at its end and a smaller one riding on its
  // shoulder; across the trunk sits a companion cloud a little higher. Sky shows between tiers.
  const clouds: { x: number; y: number; r: number; flat: number }[] = [];
  for (const limb of limbs) {
    const e = envelope(limb.t + 0.1);
    const r = Math.max(spec.pad * 0.7, e * rng.range(0.5, 0.62));
    clouds.push({ x: limb.x1 - limb.side * r * 0.15, y: limb.y1 + 1, r, flat: 0.44 });
    const cy = limb.y1 - rng.range(3, 7);
    clouds.push({ x: cxAt(cy) - limb.side * e * rng.range(0.15, 0.35), y: cy, r: r * rng.range(0.55, 0.7), flat: 0.5 });
  }
  // The rounded top: a dome over the head of the trunk, and a cloud just below it.
  const topY = top + spec.pad * 0.55;
  clouds.push({
    x: cxAt(topY) + rng.range(-2, 2),
    y: topY,
    r: Math.max(spec.pad * 0.85, envelope(0.92) * 0.85),
    flat: 0.6,
  });
  clouds.push({
    x: cxAt(topY + spec.pad) + (rng.chance(0.5) ? -1 : 1) * spec.pad * 0.55,
    y: topY + spec.pad * 0.85,
    r: spec.pad * 0.75,
    flat: 0.5,
  });
  // Bottom-up, as the spire: upper clouds' bellies lie over the tops of those below.
  for (const cl of clouds.toSorted((a, b) => b.y - a.y)) {
    const t = (crownBottom - cl.y) / crownH;
    pads.push(makePad(c, id++, padLobes(cl.x, cl.y, cl.r, cl.flat), false, t, stage));
  }

  const scar = rng.chance(0.6);
  const scarSide = rng.chance(0.5) ? -1 : 1;
  return finishTree(c, stage, level, top, pads, (s) => {
    for (const p of pads) if (p.back) blitPad(s, p, c.pruned.has(p.id), 0);
    drawTrunk(s, trunk);
    for (const limb of limbs)
      drawLimb(s, cxAt(limb.y0) + limb.side * hwAt(limb.y0) * 0.6, limb.y0, limb, stage === "giant" ? 3.4 : 2.6);
    roots(s, c, trunk, stage === "giant" ? 5 : 4);
    litter(s, c.x, c.foot, stage === "giant" ? 54 : 40, c.season);
    if (scar)
      fireScar(
        s,
        cxAt(c.foot - 4) + scarSide * hwAt(c.foot - 4) * 0.2,
        c.foot,
        spec.h * 0.16,
        hwAt(c.foot - 10) * 0.55,
        c.seed,
      );
  });

  function drawLimb(s: Surface, x0: number, y0: number, limb: Limb, w0: number): void {
    // A quadratic curve out then up, tapering, lit along its top.
    const cxp = x0 + (limb.x1 - x0) * 0.75;
    const cyp = y0 + 1;
    const steps = Math.ceil(Math.abs(limb.x1 - x0) * 1.5 + 8);
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const x = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * cxp + u * u * limb.x1;
      const y = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * cyp + u * u * limb.y1;
      const r = Math.max(0.6, w0 * (1 - u * 0.75)) / 2;
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
          if (dx * dx + dy * dy > r * r + 0.3) continue;
          const shade = dy < -r * 0.3 ? 6 : dy > r * 0.3 ? 2 : 4;
          s.set(Math.round(x + dx), Math.round(y + dy), ix(R.BARK, shade));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------

function makePad(c: Ctx, id: number, lobes: Lobe[], back: boolean, t: number, stage: StageName): Pad {
  const clump =
    stage === "sapling" ? 1.8 : stage === "young" ? 2.3 : stage === "mature" ? 2.7 : stage === "giant" ? 3.3 : 3;
  const spec = {
    lobes,
    ramp: R.FOLI,
    lightX: -1,
    clump,
    seed: c.seed + id * 977,
    bias: back ? -1.6 : stage === "sapling" ? 0.4 : 0.2,
    gold: back ? 0 : 0.3 + 0.3 * Math.min(1, t),
    // The sunlit tips are the crown's own lightest colour, so they turn gold with it.
    goldIndex: ix(R.FOLI, 7),
  };
  let art = renderPad(spec);
  // Pruned: the outer growth clipped back to a neater, flatter cloud, its cut faces lit fresh.
  const trimmed = lobes.map((l, i) => ({
    ...l,
    rx: l.rx * (i === 0 ? 0.74 : 0.5),
    ry: l.ry * (i === 0 ? 0.82 : 0.6),
    y: l.y + (i === 0 ? 0 : l.ry * 0.3),
  }));
  let pruned = renderPad({ ...spec, lobes: trimmed, gold: 0.55, bias: (spec.bias ?? 0) + 0.3 });
  if (c.season === "winter" && !back) {
    art = { sprite: snowCap(art.sprite, c.seed + id), ox: art.ox, oy: art.oy - 1 };
    pruned = { sprite: snowCap(pruned.sprite, c.seed + id + 1), ox: pruned.ox, oy: pruned.oy - 1 };
  }
  const x0 = art.ox;
  const y0 = art.oy;
  return {
    id,
    lobes,
    art,
    pruned,
    back,
    sway: back ? 0 : Math.min(1, 0.3 + t),
    phase: hash3(id, c.seed, 5) * Math.PI * 2,
    box: { x0, y0, x1: x0 + art.sprite.w, y1: y0 + art.sprite.h },
  };
}

export function blitPad(s: Surface, p: Pad, pruned: boolean, dx: number, map?: Uint8Array): void {
  const a = pruned ? p.pruned : p.art;
  s.blit(a.sprite, a.ox + dx, a.oy, map ? { map } : {});
}

/** Is the glade pixel (x, y) on this pad's foliage? */
export function padHit(p: Pad, pruned: boolean, x: number, y: number): boolean {
  const a = pruned ? p.pruned : p.art;
  const px = Math.round(x - a.ox);
  const py = Math.round(y - a.oy);
  if (px < 0 || py < 0 || px >= a.sprite.w || py >= a.sprite.h) return false;
  return (a.sprite.data[py * a.sprite.w + px] ?? 0) !== 0;
}

function finishTree(
  c: Ctx,
  stage: StageName,
  level: number,
  top: number,
  pads: Pad[],
  paint: (s: Surface) => void,
): Tree {
  let x0 = c.x - 6;
  let x1 = c.x + 6;
  let y0 = top;
  for (const p of pads) {
    x0 = Math.min(x0, p.box.x0);
    x1 = Math.max(x1, p.box.x1);
    y0 = Math.min(y0, p.box.y0);
  }
  return {
    stage,
    level,
    foot: { x: c.x, y: c.foot },
    top,
    pads,
    crown: { x0, y0, x1, y1: c.foot },
    seedling: null,
    lanterns:
      stage === "giant"
        ? pads
            .filter((p) => !p.back && p.box.y1 > 10)
            .toSorted((a, b) => b.box.y1 - a.box.y1)
            .slice(0, 4)
            .map((p) => ({ x: Math.round((p.box.x0 + p.box.x1) / 2), y: p.box.y1 - 2 }))
        : [],
    paintStill: paint,
  };
}

/** Buttress roots gripping the soil, spreading from the flare, lit along their backs. */
function roots(s: Surface, c: Ctx, trunk: TrunkSpec, count: number): void {
  const rng = new Rng(c.seed + 31);
  const hw = trunk.hw(c.foot);
  const cx = trunk.cx(c.foot);
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const spread = hw * (0.55 + 0.45 * (i / count)) + rng.range(-1, 1);
    const len = hw * rng.range(0.55, 0.95) + 3;
    const hgt = Math.max(2, hw * rng.range(0.32, 0.5));
    const x0 = cx + side * spread * 0.55;
    for (let k = 0; k <= len; k++) {
      const u = k / len;
      const x = Math.round(x0 + side * (spread * 0.45 + k));
      const top = Math.round(c.foot - hgt * Math.pow(1 - u, 1.6));
      for (let y = top; y <= c.foot + (u < 0.85 ? 1 : 0); y++) {
        const level = y === top ? 6 : y === top + 1 ? 5 : y >= c.foot ? 1 : hash3(x, y, c.seed) < 0.3 ? 2 : 3;
        s.set(x, y, ix(R.BARK, level));
      }
      if (u > 0.3 && hash3(x, top, 3) < 0.45) s.set(x, top - 1, ix(R.OLIVE, 4));
    }
  }
}

/** The cinnamon carpet of needles a sequoia sheds round its foot. Drawn under the trunk's roots. */
function litter(s: Surface, x0: number, foot: number, rx: number, season: Season): void {
  if (season === "winter") return;
  const ry = 6;
  for (let y = foot - ry; y <= foot + ry + 2; y++) {
    for (let x = x0 - rx; x <= x0 + rx; x++) {
      const d = ((x - x0) / rx) ** 2 + ((y - foot - 1) / ry) ** 2;
      if (d > 1) continue;
      const v = hash3(x, y, 77);
      if (v > 0.75 - d * 0.5) continue;
      if (rampOfIndex(s.get(x, y)) === R.BARK) continue;
      s.set(x, y, v < 0.15 ? ix(R.BARK, 6) : v < 0.4 ? ix(R.SOIL, 6) : ix(R.SOIL, 5));
    }
  }
}

const rampOfIndex = (i: number): number => i >> 3;

/** An old fire scar: a tall dark hollow at the foot, its lip lit by the campfire. */
function fireScar(s: Surface, cx: number, foot: number, h: number, w: number, seed: number): void {
  for (let y = Math.round(foot - h); y <= foot; y++) {
    const t = (y - (foot - h)) / h;
    const half = w * Math.pow(t, 0.7) * (0.85 + 0.3 * hash3(y, seed, 8));
    const x0 = Math.round(cx - half);
    const x1 = Math.round(cx + half);
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1;
      s.set(x, y, edge ? ix(R.BARK, 7) : ix(R.INK, hash3(x, y, seed) < 0.2 ? 3 : 1));
    }
  }
}
