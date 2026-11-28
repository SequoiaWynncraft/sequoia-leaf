/**
 * The plate over a figure, laid out as TFT's unit frame: a badge for its level joined to the left
 * end of one ink-framed bar, and what it holds under the bar. The same while planning and in a fight.
 *
 * - **The badge**: a square on its point, 9 by 9 with its ink edge, in the level's metal (bronze for
 *   one star, silver for two, gold for three), lit on its top-left sides and shaded on its
 *   bottom-right, a dark hole in its middle. Its right point is the bar's left frame and its middle
 *   row the bar's lower health row, so it stands a row taller than the bar at the top and its lower
 *   point rests on the held row's edge. A summon has none.
 * - **The bar**: an ink frame round health (2 rows, the colour of its side, a tick every 250), a dark
 *   row, and mana (1 row; dark for a figure with none). The frame reaches under the badge's lower
 *   right side, so badge and bar are one piece. Badge and bar together are as wide as three held
 *   items (19), a pixel short of a hex, so two neighbours' plates never touch; a boss's bar is 12 wider.
 * - **What it holds**: each item's own picture in a small box sharing its ink edge with the next,
 *   under the bar from its left end. Two or three are wider than the bar, so they run left under the
 *   badge, as TFT's do, ending at the bar's right end.
 *
 * On the bench, the badge and what it holds and no bar, as nothing there has health to show; the
 * badge centred over the figure, its lower point on what it holds. A figure fallen or hidden has no
 * plate (its drawer does not ask for one). Its foot is on the row over the figure's head, so it covers
 * the feet of the figure behind rather than the face of the one in front. What rises over a head
 * (numbers, signs) starts above it (`aboveHead`).
 */
import { BARK, CORAL, CREAM, GOLD, GREEN, INK, LEAF, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { paint, R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import type { RackItem } from "@sequoia-leaf/raid";

import { HELD_BOX } from "./art/icons.ts";
import { drawHeld, type HeldAt, heldFrom, heldRow, heldWide } from "./held.ts";

export interface Plate {
  /** How many stars it has: 0 for a summon, which has no badge. */
  readonly stars: number;
  /** Whether it is on the side of whoever is looking: its health green, else coral. */
  readonly ours: boolean;
  readonly hp: number;
  readonly maxHp: number;
  readonly shield: number;
  readonly mana: number;
  /** What fills its mana: 0 for a figure with none, whose mana row stays dark. */
  readonly manaFull: number;
  readonly items: readonly RackItem[];
  /** A boss: the bar wider. */
  readonly big: boolean;
  /** On the bench: its badge and what it holds, no bar. */
  readonly resting?: boolean;
  /** Its Huddle group's one shield, as a share of the group's health together. */
  readonly pool?: number;
  /** A friend has just given it mana: the mana bright. */
  readonly gift?: boolean;
  /** Its badge flashing as three became one: bright, and this far up. */
  readonly pop?: { readonly up: number };
}

/** How wide a plate is: three held boxes sharing their edges, a pixel short of a hex. */
export const PLATE_W = heldWide(3);
/** The badge, a square on its point, edge and all. */
export const BADGE = 9;
/** The bar with its frame, its left frame the badge's right point, so badge and bar make a plate; and a boss's, 12 wider. */
export const BAR_W = PLATE_W - BADGE + 1;
export const BIG_BAR_W = BAR_W + 12;
/** The bar's rows: frame, health, health, a dark row, mana, frame. */
export const BAR_H = 6;
/** How far the badge's top stands over the bar's: its middle row is the bar's lower health row. */
const BADGE_UP = 2;
/** How many columns of the frame reach left under the badge's lower right side. */
const UNDER = 2;
/** The badge's metal for its level, light, middle and shade: one bronze, two silver, three gold; bright as it flashes. */
const BRONZE = [GOLD[0], "#a3662a", BARK[2]] as const;
const SILVER = [CREAM, STONE[3], STONE[1]] as const;
const GILT = [CREAM, GOLD[2], GOLD[1]] as const;
const BRIGHT = ["#ffffff", "#ffffff", CREAM] as const;
export const badgeTones = (stars: number, bright = false): readonly [light: string, mid: string, shade: string] =>
  bright ? BRIGHT : stars >= 3 ? GILT : stars === 2 ? SILVER : BRONZE;
/** The empty part of a health bar, and of a mana bar. */
const SPENT = "#3d2050";
const DRAINED = "#211228";
/**
 * Health a tick marks: every 250 while those stand 2.5 pixels apart or more; closer than that, every
 * 1,000 and the bar's full height, and where those would crowd too (late in an endless run), every
 * 5,000, 10,000, 50,000 and so on, so a bar is never more ticks than health.
 */
const TICK = 250;
const BIG_TICK = 1000;
const CLOSEST = 2.5;

/** Whether a level shows a badge: none for a summon's 0. */
const badged = (stars: number): boolean => Math.floor(stars) > 0;

/** Where a plate's parts go, for its foot at `foot` (the row under it) and its middle at `cx`, in whatever pixels those are in. */
export interface PlateAt {
  /** The bar with its frame: its left, top, width and height (0 wide and tall on the bench). */
  readonly left: number;
  readonly top: number;
  readonly w: number;
  readonly h: number;
  /** What it holds, each picture's place. */
  readonly held: readonly HeldAt[];
  /** The top left of the badge's square, if it has one. */
  readonly badge: { readonly x: number; readonly y: number } | null;
  /** The top of the whole plate. */
  readonly peak: number;
}

/**
 * A plate's parts, laid out from its foot up: what it holds; the bar over that; the badge at the
 * bar's left end, its lower point on the held row's edge. On the bench, the badge centred over what
 * it holds.
 */
export function plateAt(p: Plate, cx: number, foot: number): PlateAt {
  const x = Math.round(cx);
  const f = Math.round(foot);
  const has = badged(p.stars);
  // The row under the bar, where the badge's lower point rests: the held row's top edge.
  const under = p.items.length > 0 ? f - HELD_BOX : has ? f - 1 : f;
  if (p.resting) {
    const badge = has ? { x: x - (BADGE - 1) / 2, y: under - BADGE + 1 } : null;
    return { left: x, top: under, w: 0, h: 0, held: heldRow(p.items, x, f - HELD_BOX), badge, peak: badge?.y ?? under };
  }
  const w = p.big ? BIG_BAR_W : BAR_W;
  const wide = BADGE - 1 + w;
  const start = x - Math.floor(wide / 2);
  // A summon's bar is centred on it; its held row keeps to where a badge's plate would be.
  const left = has ? start + BADGE - 1 : x - Math.floor(w / 2);
  const top = under - BAR_H;
  const held = heldFrom(p.items, Math.min(left, start + wide - heldWide(p.items.length)), under);
  const badge = has ? { x: start, y: top - BADGE_UP } : null;
  return { left, top, w, h: BAR_H, held, badge, peak: badge?.y ?? top };
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

/** A figure's plate in a fight without its numbers, as tall as its own: summoned, it has no badge. */
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

/** Only a badge, as on the bench with nothing held: for a figure held in the hand. */
export const badgeOnly = (stars: number): Plate => ({
  ...shapeOf({ summoned: false, stars, items: [], manaFull: 0 }),
  resting: true,
});

/** How far above a figure's head what rises over it starts: the row over its plate's top. */
export const aboveHead = (p: Plate): number => 3 - plateAt(p, 0, 0).peak + 1;

/** The ticks along a health bar `width` wide that spans `whole` health: where each is, and whether it is the full height. */
export function ticksOf(whole: number, width: number): { x: number; full: boolean }[] {
  const full = (TICK / whole) * width < CLOSEST;
  let every = full ? BIG_TICK : TICK;
  if (full) for (let i = 0; (every / whole) * width < CLOSEST; i++) every *= i % 2 === 0 ? 5 : 2;
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

/**
 * The colour of the badge's pixel `x` across and `y` down its square (null outside it): its ink edge,
 * its hole (a small square on its point in the middle), its metal lit on the top-left sides.
 */
export function badgeColour(stars: number, bright: boolean, x: number, y: number): string | null {
  const [light, mid, shade] = badgeTones(stars, bright);
  const m = (BADGE - 1) / 2;
  const dx = x - m;
  const dy = y - m;
  const d = Math.abs(dx) + Math.abs(dy);
  if (d > m) return null;
  if (d === m || d <= 1) return INK;
  if ((dy < 0 && dx <= 0) || (dy === 0 && dx < 0)) return light;
  if ((dy > 0 && dx >= 0) || (dy === 0 && dx > 0)) return shade;
  return mid;
}

/** Each level's badge, and each bright, painted once. */
const BADGES = new Map<string, HTMLCanvasElement>();
function badgePic(stars: number, bright: boolean): HTMLCanvasElement {
  const key = `${Math.min(stars, 3)}${bright ? "!" : ""}`;
  let c = BADGES.get(key);
  if (!c) {
    c = paint(BADGE, BADGE, (x, y) => badgeColour(stars, bright, x, y));
    BADGES.set(key, c);
  }
  return c;
}

/** The bar: its frame (under the badge's lower right side too), health with its shield and ticks, a Huddle group's shield along its foot, the mana. */
function drawBar(g: Ctx, at: PlateAt, p: Plate): void {
  const { left, top, w, h } = at;
  const under = at.badge ? UNDER : 0;
  R(g, left - under, top, w + under, h, INK);
  const x = left + 1;
  const inner = w - 2;
  const { hp, shield, whole } = healthOf(p, inner);
  R(g, x, top + 1, inner, 2, SPENT);
  R(g, x, top + 1, hp, 2, p.ours ? GREEN[4] : CORAL);
  R(g, x, top + 1, hp, 1, p.ours ? LEAF : "#f4a08c");
  if (shield > 0) {
    R(g, x + hp, top + 1, shield, 2, STONE[3]);
    R(g, x + hp, top + 1, shield, 1, CREAM);
  }
  // A tick stands in the lower row; every 1,000, in both.
  for (const tick of ticksOf(whole, inner)) R(g, x + tick.x, top + (tick.full ? 1 : 2), 1, tick.full ? 2 : 1, INK);
  if (p.pool) R(g, x, top + 2, Math.max(1, Math.round(p.pool * inner)), 1, WATER[3]);
  if (p.manaFull > 0) {
    R(g, x, top + 4, inner, 1, DRAINED);
    R(
      g,
      x,
      top + 4,
      Math.round(clamp(p.mana / p.manaFull, 0, 1) * inner),
      1,
      p.gift || p.mana >= p.manaFull ? CREAM : WATER[3],
    );
  }
}

/** Draws a plate with its foot at `foot` (the row under it), centred on `cx`. */
export function drawPlate(g: Ctx, cx: number, foot: number, p: Plate): void {
  const at = plateAt(p, cx, foot);
  drawHeld(g, at.held, 0, 0);
  if (at.h > 0) drawBar(g, at, p);
  if (at.badge) g.drawImage(badgePic(p.stars, p.pop !== undefined), at.badge.x, at.badge.y - (p.pop?.up ?? 0));
}
