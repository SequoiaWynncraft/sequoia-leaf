/**
 * The level-up ceremony. Gnome heralds march in and trumpet, ta, ta, taaa; the tree glows and
 * light climbs it; on a flash the world opens (the canvas grows, see layout.ts) and the tree of
 * the new level rises from its foot, its masses popping in as the growth passes them, and throws
 * a handful of gold leaves. Then a GG card in the mod's milestone style: "No gg left behind."
 *
 * Timeline, in seconds from the start:
 *   0.2  heralds march in, one after another      2.7  the tree glows; light climbs the trunk
 *   2.1  ta   2.5  ta   2.9  taaa                  3.5  flash: the new tree, rising from its foot
 *   4.7  the GG card opens; the heralds cheer       12   all done
 */

import { blitFrame, heraldFrame, type HeraldPose } from "./actors.ts";
import { type Canvas, drawLevelBadge, mix, type PopupSpec, UI } from "./hud.ts";
import type { Layout } from "./layout.ts";
import { ix, R } from "./palette.ts";
import type { Light, Surface } from "./raster.ts";
import { hash3 } from "./rng.ts";
import { STAGE_OF_LEVEL, STAGE_TITLE, type Tree } from "./tree.ts";

export interface LevelUpEvent {
  t0: number;
  from: number;
  to: number;
}

const ARRIVE = 1.9;
const TOOTS = [2.1, 2.5, 2.9] as const;
const GLOW = 2.7;
export const LEVELUP_SWAP = 3.5;
const GROW = 1.5;
const CARD = 4.7;
const END = 12;

export const shownLevel = (ev: LevelUpEvent, t: number): number => (t - ev.t0 >= LEVELUP_SWAP ? ev.to : ev.from);

const ease = (u: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, u)), 3);

// ---------------------------------------------------------------------------------------------
// The heralds.

interface Herald {
  /** Where it stops, relative to the tree's foot, and which way it came from. */
  dx: number;
  dy: number;
  from: -1 | 1;
  delay: number;
}

const HERALDS: readonly Herald[] = [
  { dx: -27, dy: 9, from: -1, delay: 0.2 },
  { dx: -15, dy: 11, from: -1, delay: 0.45 },
  { dx: 17, dy: 10, from: 1, delay: 0.35 },
];

/**
 * The heralds: their sprites into the cast surface (they are the cast's gnomes), their shadows and
 * the notes from their trumpets into the glade's.
 */
export function drawHeralds(s: Surface, cast: Surface, light: Light, L: Layout, ev: LevelUpEvent, t: number): void {
  const tau = t - ev.t0;
  if (tau > END) return;
  HERALDS.forEach((h, i) => {
    const stopX = L.treeX + h.dx * (L.narrow ? 0.7 : 1);
    const y = L.ground + h.dy;
    const startX = h.from < 0 ? -16 : L.W + 16;
    const walk = Math.max(0.6, ARRIVE - h.delay);
    const u = (tau - h.delay) / walk;
    if (u < 0) return;
    const x = Math.round(u < 1 ? startX + (stopX - startX) * u : stopX);
    let pose: HeraldPose = "stand";
    let ms = (tau - h.delay) * 1000;
    if (u < 1) pose = "march";
    else if (tau >= CARD - 0.2) {
      // The cheer: each herald pops with joy on its own beat.
      pose = "cheer";
      ms = ((tau - CARD + 0.2 + i * 0.23) % 1.1) * 1000;
    } else {
      // Ta, ta, each herald on its beat; all three on the long taaa.
      const beat = TOOTS.findIndex((at, k) => tau >= at && tau < at + (k === 2 ? 0.55 : 0.25));
      if (beat === 2 || beat === i) pose = "toot";
    }
    const facing = -h.from;
    // A soft shadow under each.
    for (let k = -4; k <= 4; k++) s.set(x + k, y + 1, ix(R.SOIL, Math.abs(k) > 3 ? 1 : 0));
    blitFrame(cast, heraldFrame(pose, ms), x, y, facing < 0);
    const bellX = x + facing * 6;
    const bellY = y - 13;
    if (pose === "toot") light.pool(bellX, bellY, 6, 1.4, 1);
    // Notes rising from the bell on each toot.
    TOOTS.forEach((at, k) => {
      if (k !== 2 && k !== i) return;
      const v = (tau - at) / 1.4;
      if (v < 0 || v > 1) return;
      const nx = Math.round(bellX + facing * (2 + v * 8) + Math.sin(v * 9 + i) * 1.5);
      const ny = Math.round(bellY - 2 - v * 20);
      if (v > 0.75 && Math.floor(t * 12) % 2) return;
      note(s, nx, ny, k === 2 ? ix(R.GLOW, 7) : ix(R.GLOW, 6));
    });
  });
}

/** A quaver: a head and a stem with a flag. */
function note(s: Surface, x: number, y: number, c: number): void {
  s.set(x, y, c);
  s.set(x + 1, y, c);
  s.set(x + 1, y - 1, c);
  s.set(x + 1, y - 2, c);
  s.set(x + 1, y - 3, c);
  s.set(x + 2, y - 3, c);
  s.set(x + 2, y - 2, ix(R.GLOW, 4));
}

// ---------------------------------------------------------------------------------------------
// The tree's transformation.

export interface Reveal {
  /** Rows above this are not yet grown. */
  from: number;
  /** The growth's leading edge, or -1 before it starts. */
  edge: number;
  /** The old tree glowing as the light climbs it. */
  bright: boolean;
}

export function treeReveal(ev: LevelUpEvent, t: number, tree: Tree): Reveal | null {
  const tau = t - ev.t0;
  if (tau < GLOW) return null;
  if (tau < LEVELUP_SWAP)
    return { from: 0, edge: -1, bright: Math.floor(tau * 8) % 3 !== 0 || tau > LEVELUP_SWAP - 0.3 };
  const u = (tau - LEVELUP_SWAP) / GROW;
  if (u >= 1) return null;
  const top = Math.min(tree.crown.y0, tree.top) - 3;
  // Slow off the ground, quick through the trunk, easing into the crown.
  const e = u * u * (3 - 2 * u);
  const edge = Math.round(tree.foot.y + 3 - (tree.foot.y + 3 - top) * e);
  return { from: edge, edge, bright: false };
}

export function drawGrowth(s: Surface, light: Light, tree: Tree, ev: LevelUpEvent, t: number): void {
  const tau = t - ev.t0;
  const { foot, crown } = tree;
  if (tau >= GLOW && tau < LEVELUP_SWAP) {
    // Light climbs the trunk in a spiral of motes, and pools at the foot.
    const u = (tau - GLOW) / (LEVELUP_SWAP - GLOW);
    light.pool(foot.x, foot.y - 4, 16 + u * 30, 2.2 + u, 1.4);
    const h = foot.y - Math.min(crown.y0, tree.top);
    for (let i = 0; i < 18; i++) {
      const v = (((u * 1.6 + i / 18) % 1) + 1) % 1;
      if (v > u * 1.4 + 0.1) continue;
      const a = v * 14 + i;
      const x = Math.round(foot.x + Math.sin(a) * (4 + (crown.x1 - crown.x0) * 0.25 * v));
      const y = Math.round(foot.y - v * h);
      s.set(x, y, ix(i % 3 === 0 ? R.STAR : R.GLOW, 7));
      if (Math.cos(a) > 0.5) s.set(x, y - 1, ix(R.GLOW, 5));
    }
  }
  const r = treeReveal(ev, t, tree);
  if (r && r.edge >= 0) {
    // The growth's leading edge: sparks across the tree's width, and light following it up.
    const halfW = Math.max(6, ((crown.x1 - crown.x0) / 2) * Math.min(1, (foot.y - r.edge) / 40 + 0.2));
    for (let i = 0; i < 16; i++) {
      const x = Math.round(foot.x + (hash3(i, Math.floor(t * 20), 3) - 0.5) * 2 * halfW);
      const y = r.edge + Math.round(hash3(i, Math.floor(t * 20), 4) * 3) - 1;
      s.set(x, y, ix(i % 2 ? R.GLOW : R.STAR, 7));
    }
    light.pool(foot.x, r.edge, 18, 2.6, 1.6);
  }
  // Gold leaves thrown from the crown as it settles, fluttering down.
  const since = tau - LEVELUP_SWAP - GROW * 0.85;
  if (since > 0 && since < 3.2) {
    for (let i = 0; i < 26; i++) {
      const born = hash3(i, 1, 13) * 0.4;
      const v = (since - born) / (2.4 + hash3(i, 2, 13));
      if (v < 0 || v > 1) continue;
      const x0 = crown.x0 + (crown.x1 - crown.x0) * hash3(i, 3, 13);
      const y0 = crown.y0 + (foot.y - crown.y0) * 0.35 * hash3(i, 4, 13);
      const out = (hash3(i, 5, 13) - 0.5) * 50;
      const x = Math.round(x0 + out * ease(v * 3) + Math.sin(v * 12 + i) * 3);
      const y = Math.round(y0 - 10 * Math.sin(Math.min(1, v * 4) * Math.PI) + v * v * (foot.y - y0 + 10));
      const flip = Math.floor(v * 14 + i) % 2;
      const c = i % 3 === 0 ? ix(R.GLOW, 5) : ix(R.FOLI, 7);
      s.set(x, y, c);
      s.set(x + (flip ? 1 : -1), y + (flip ? 0 : 1), i % 3 === 0 ? ix(R.GLOW, 3) : ix(R.FOLI, 5));
    }
  }
}

/** The flash that covers the world opening: 0 to 1. */
export function levelUpFlash(ev: LevelUpEvent, t: number): number {
  const since = t - ev.t0 - LEVELUP_SWAP;
  if (since < -0.12 || since > 0.5) return 0;
  return since < 0 ? (since + 0.12) / 0.12 : ([1, 0.8, 0.55, 0.35, 0.2, 0.08][Math.floor(since / 0.08)] ?? 0);
}

// ---------------------------------------------------------------------------------------------
// The GG card.

export function ggPopupOpen(ev: LevelUpEvent, t: number): number {
  const tau = t - ev.t0;
  if (tau < CARD || tau > END) return 0;
  if (tau > END - 0.3) return Math.max(0.01, (END - tau) / 0.3);
  return Math.min(1, (tau - CARD) / 0.15);
}

export function ggPopup(ev: LevelUpEvent, stage: string): PopupSpec {
  const before = STAGE_OF_LEVEL[ev.from - 1];
  const after = STAGE_OF_LEVEL[ev.to - 1];
  const grew = before !== after && after !== undefined;
  return {
    accent: UI.gold,
    label: "GG!",
    title: `Level ${ev.to}!`,
    lines: [
      { text: "No gg left behind.", colour: UI.lore },
      {
        text: grew ? `Your tree is now a ${after ? STAGE_TITLE[after] : stage}.` : "Your tree grew taller.",
        colour: mix(UI.leaf, UI.text, 0.25),
      },
    ],
    medal: (c: Canvas, x: number, y: number) => drawLevelBadge(c, ev.to, x, y, true, 0.25),
  };
}
