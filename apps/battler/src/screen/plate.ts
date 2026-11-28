/**
 * The plate over a figure (`RAID-BOARD.md` section 9): one, over its head, the same while planning
 * and in a fight. Its stars sit on top of it in their level's colour (one bronze, two silver, three
 * gold); under them its health in the colour of its side, a tick every 250 (every 1,000 for a big
 * health), a shield after the health, its mana under an ink row; under the bars what it holds. On
 * the bench, the stars and what it holds and no bars, as nothing there has health to show. A summon
 * has no stars; a figure fallen or hidden has no plate (its drawer does not ask for one).
 *
 * Its foot is on the row above the figure's head, so a plate covers the feet of the figure behind
 * rather than the face of the one in front. It is 19 wide, a hex 20: two neighbours' plates never
 * overlap on one row. What rises over a head (numbers, signs) starts above it (`aboveHead`).
 */
import { drawStars, type StarTones } from "@sequoia-leaf/figures/sprites.ts";
import { CORAL, CREAM, GOLD, GREEN, INK, LEAF, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import type { RackItem } from "@sequoia-leaf/raid";

import { drawHeld, type HeldAt } from "./held.ts";

export interface Plate {
  /** How many stars it has: 0 for a summon, which shows none. */
  readonly stars: number;
  /** Whether it is on the side of whoever is looking: its health green, else coral. */
  readonly ours: boolean;
  readonly hp: number;
  readonly maxHp: number;
  readonly shield: number;
  readonly mana: number;
  /** What fills its mana: 0 for a figure with none, which has no mana rows. */
  readonly manaFull: number;
  readonly items: readonly RackItem[];
  /** A boss: the plate as wide as its base. */
  readonly big: boolean;
  /** On the bench: its stars and what it holds, no bars. */
  readonly resting?: boolean;
  /** Its Huddle group's one shield, as a share of the group's health together. */
  readonly pool?: number;
  /** A friend has just given it mana: the mana bright. */
  readonly gift?: boolean;
  /** Its stars popping as three became one: bright, and this far up. */
  readonly pop?: { readonly up: number };
}

/** How wide a plate is (a boss's), a held item's picture, how far apart they are (sharing an edge), and a star's height. */
export const PLATE_W = 19;
export const BIG_PLATE_W = 31;
const ITEM = 7;
const STEP = ITEM - 1;
const STAR_H = 6;
const BRONZE = "#a3662a";
/** The stars' tones by how many: bronze, silver, gold. */
const STAR_TONES: readonly StarTones[] = [
  [BRONZE, GOLD[0]],
  [STONE[3], CREAM],
  [GOLD[2], CREAM],
];
/** Health a tick marks: every 250 up to 1,250, past that every 1,000 and the full height. */
const TICK = 250;
const BIG_TICK = 1000;
const MANY = 1250;

/** How tall the bars are: an ink frame round 3 rows of health, an ink row and 2 of mana; with no mana, 4 rows of health. */
export const barsTall = (manaFull: number): number => (manaFull > 0 ? 8 : 6);

/** Where a plate's parts go, for its foot at `foot` (the row under it) and its middle at `cx`, in whatever pixels those are in. */
export interface PlateAt {
  /** The bars' frame: its left, top, width and height (0 on the bench). */
  readonly left: number;
  readonly top: number;
  readonly w: number;
  readonly h: number;
  /** What it holds, each picture's place. */
  readonly held: readonly HeldAt[];
  /** Where the stars' feet are, and the top of the whole plate, stars and all. */
  readonly starsAt: number;
  readonly peak: number;
}

/** A plate's parts, laid out from its foot up: what it holds, the bars over that sharing an edge, the stars on the bars' top. */
export function plateAt(p: Plate, cx: number, foot: number): PlateAt {
  const x = Math.round(cx);
  const shown = p.items.slice(0, 3);
  const wide = STEP * (shown.length - 1) + ITEM;
  const held = shown.map((item, i) => ({
    item,
    x: x - Math.floor(wide / 2) + i * STEP,
    y: Math.round(foot) - ITEM,
    w: ITEM,
    h: ITEM,
  }));
  const bottom = Math.round(foot) - (held.length > 0 ? STEP : 0);
  const h = p.resting ? 0 : barsTall(p.manaFull);
  const w = p.big ? BIG_PLATE_W : PLATE_W;
  const top = bottom - h;
  // The stars' ink edge shares the row of the frame's top (on the bench, the held pictures' top) under them.
  const starsAt = h > 0 ? top + 1 : bottom;
  return { left: x - Math.floor(w / 2), top, w, h, held, starsAt, peak: p.stars > 0 ? starsAt - STAR_H : top };
}

/**
 * Whether a figure in a fight shows its plate: alive and standing, not on its way under the board,
 * and not hidden (up the tree, in its shell, gone to ground, in one of Yule's bubbles) unless its
 * own bubble has not closed yet. One that drops in from hiding shows it from then.
 */
export const plated = (
  u: { readonly alive: boolean; readonly hiddenUntil: number },
  tick: number,
  how: { readonly down: boolean; readonly sunk: boolean; readonly waiting: boolean },
): boolean => u.alive && !how.down && !how.sunk && (u.hiddenUntil <= tick || how.waiting);

/** A figure's plate in a fight without its numbers, as tall as its own: summoned, it has no stars. */
export const shapeOf = (u: {
  readonly summoned: boolean;
  readonly stars: number;
  readonly items: readonly RackItem[];
  readonly manaFull: number;
}): Plate => ({
  stars: u.summoned ? 0 : u.stars,
  ours: true,
  hp: 0,
  maxHp: 0,
  shield: 0,
  mana: 0,
  manaFull: u.manaFull,
  items: u.items,
  big: false,
});

/** How far above a figure's head what rises over it starts: the row over its plate's top. */
export const aboveHead = (p: Plate): number => 3 - plateAt(p, 0, 0).peak + 1;

/** The ticks along a health bar `width` wide that spans `whole` health, for a figure of `maxHp`: where each is, and whether it is the full height. */
export function ticksOf(maxHp: number, whole: number, width: number): { x: number; full: boolean }[] {
  const full = maxHp > MANY;
  const every = full ? BIG_TICK : TICK;
  const out: { x: number; full: boolean }[] = [];
  for (let at = every; at < whole; at += every) {
    const x = Math.round((at / whole) * width);
    if (x > 0 && x < width) out.push({ x, full });
  }
  return out;
}

/** How much of a bar `width` wide health and a shield take: the bar is full health, or health and shield together when they are more. */
export function healthOf(
  p: Pick<Plate, "hp" | "maxHp" | "shield">,
  width: number,
): { hp: number; shield: number; whole: number } {
  const whole = Math.max(p.maxHp, p.hp + p.shield, 1);
  const hp = p.hp <= 0 ? 0 : Math.max(1, Math.round((clamp(p.hp, 0, whole) / whole) * width));
  const shield = p.shield <= 0 ? 0 : Math.min(width - hp, Math.max(1, Math.round((p.shield / whole) * width)));
  return { hp, shield: Math.max(0, shield), whole };
}

/** The bars: health with its shield and ticks, a Huddle group's shield along its foot, the mana under them. */
function drawBars(g: Ctx, at: PlateAt, p: Plate): void {
  const { left, top, w, h } = at;
  R(g, left, top, w, h, INK);
  const x0 = left + 1;
  const bw = w - 2;
  const rows = p.manaFull > 0 ? 3 : 4;
  const { hp, shield, whole } = healthOf(p, bw);
  R(g, x0, top + 1, bw, rows, SKY[1]);
  R(g, x0, top + 1, hp, rows, p.ours ? GREEN[4] : CORAL);
  R(g, x0, top + 1, hp, 1, p.ours ? LEAF : "#f4a08c");
  if (shield > 0) {
    R(g, x0 + hp, top + 1, shield, rows, STONE[3]);
    R(g, x0 + hp, top + 1, shield, 1, CREAM);
  }
  for (const tick of ticksOf(p.maxHp, whole, bw)) R(g, x0 + tick.x, top + 1, 1, tick.full ? rows : 2, INK);
  if (p.pool) R(g, x0, top + rows, Math.max(1, Math.round(p.pool * bw)), 1, WATER[3]);
  if (p.manaFull <= 0) return;
  const m = Math.round(clamp(p.mana / p.manaFull, 0, 1) * bw);
  const bright = p.gift || p.mana >= p.manaFull;
  R(g, x0, top + 5, bw, 2, "#211228");
  R(g, x0, top + 5, m, 2, bright ? CREAM : WATER[2]);
  R(g, x0, top + 5, m, 1, bright ? CREAM : WATER[3]);
}

/** Draws a plate with its foot at `foot` (the row under it), centred on `cx`. */
export function drawPlate(g: Ctx, cx: number, foot: number, p: Plate): void {
  const at = plateAt(p, cx, foot);
  drawHeld(g, at.held, 0, 0);
  if (at.h > 0) drawBars(g, at, p);
  const tones = STAR_TONES[clamp(p.stars, 1, 3) - 1];
  if (p.stars > 0) drawStars(g, p.stars, cx, at.starsAt - (p.pop?.up ?? 0), p.pop !== undefined, tones);
}
