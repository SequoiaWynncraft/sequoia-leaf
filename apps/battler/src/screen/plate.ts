/**
 * The plate over a figure, kept slim so a crowded board reads at a glance: one bar, its stars as
 * pips at the bar's left end, what it holds under the bar. The same while planning and in a fight.
 *
 * - **The bar**: health 2 rows in the colour of its side, a tick every 250 (every 1,000 past 1,250),
 *   a shield after the health, mana 1 row under it, and one dark row under them so they read on any
 *   ground, with no box round them. It is 14 wide (a boss's 26), so two neighbours' bars never touch.
 * - **Pips**: none for one star (the default), two silver for two, three gold for three. A pip is 2
 *   by 2 with an ink edge, the next 1 pixel along, so three are 8 wide (10 with their edge). A summon
 *   has none.
 * - **What it holds**: each item's own picture in a small box with an ink edge, up to three in a row
 *   sharing their edges, as wide as a hex at most (`held.ts`), the bar's dark row their top edge.
 *
 * On the bench, the pips and what it holds and no bar, as nothing there has health to show; the pips
 * then sit centred over what it holds. A figure fallen or hidden has no plate (its drawer does not
 * ask for one). Its foot is on the row over the figure's head, so it covers the feet of the figure
 * behind rather than the face of the one in front. What rises over a head (numbers, signs) starts
 * above it (`aboveHead`).
 */
import { CORAL, CREAM, GOLD, GREEN, INK, LEAF, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import type { RackItem } from "@sequoia-leaf/raid";

import { HELD_BOX } from "./art/icons.ts";
import { drawHeld, type HeldAt, heldRow } from "./held.ts";

export interface Plate {
  /** How many stars it has: 0 for a summon, which shows none. */
  readonly stars: number;
  /** Whether it is on the side of whoever is looking: its health green, else coral. */
  readonly ours: boolean;
  readonly hp: number;
  readonly maxHp: number;
  readonly shield: number;
  readonly mana: number;
  /** What fills its mana: 0 for a figure with none, which has no mana row. */
  readonly manaFull: number;
  readonly items: readonly RackItem[];
  /** A boss: the bar wider. */
  readonly big: boolean;
  /** On the bench: its pips and what it holds, no bar. */
  readonly resting?: boolean;
  /** Its Huddle group's one shield, as a share of the group's health together. */
  readonly pool?: number;
  /** A friend has just given it mana: the mana bright. */
  readonly gift?: boolean;
  /** Its pips popping as three became one: bright, and this far up. */
  readonly pop?: { readonly up: number };
}

/** How wide a bar is, and a boss's. */
export const BAR_W = 14;
export const BIG_BAR_W = 26;
/** A pip, how far one is from the next, and how tall a row of them is with its edge. */
const PIP = 2;
const PIP_STEP = PIP + 1;
const PIPS_H = PIP + 2;
/** A pip's light, body and shade: two stars silver, three gold, all bright as they pop. */
const SILVER = [CREAM, STONE[3], STONE[2]] as const;
const GILT = [GOLD[2], GOLD[1], GOLD[0]] as const;
const BRIGHT = ["#ffffff", CREAM, CREAM] as const;
/** The empty part of a health bar, and of a mana bar. */
const SPENT = "#3d2050";
const DRAINED = "#211228";
/**
 * Health a tick marks: every 250 up to 1,250, past that every 1,000 and the bar's full height; where
 * those would stand closer than 2.5 pixels (late in an endless run), every 5,000, 10,000, 50,000 and
 * so on, so a bar is never more ticks than health.
 */
const TICK = 250;
const BIG_TICK = 1000;
const MANY = 1250;
const CLOSEST = 2.5;

/** How wide a row of pips is with its edge: none for one star or none. */
export const pipsWide = (stars: number): number => (stars > 1 ? PIP_STEP * Math.min(stars, 3) + 1 : 0);

/** How tall a bar is: 2 rows of health, 1 of mana if it has any, and the dark row under them. */
export const barTall = (manaFull: number): number => (manaFull > 0 ? 4 : 3);

/** Where a plate's parts go, for its foot at `foot` (the row under it) and its middle at `cx`, in whatever pixels those are in. */
export interface PlateAt {
  /** The bar: its left, top, width and height (0 on the bench). */
  readonly left: number;
  readonly top: number;
  readonly w: number;
  readonly h: number;
  /** What it holds, each picture's place. */
  readonly held: readonly HeldAt[];
  /** The top left of the pips' edge, if it shows any. */
  readonly pips: { readonly x: number; readonly y: number } | null;
  /** The top of the whole plate, pips and all. */
  readonly peak: number;
}

/** A plate's parts, laid out from its foot up: what it holds, the bar over that, the pips over the bar's left end (on the bench, centred over what it holds). */
export function plateAt(p: Plate, cx: number, foot: number): PlateAt {
  const x = Math.round(cx);
  const held = heldRow(p.items, x, Math.round(foot) - HELD_BOX);
  // The bar's dark row is the boxes' top edge, both ink.
  const bottom = held[0] ? held[0].y + 1 : Math.round(foot);
  const h = p.resting ? 0 : barTall(p.manaFull);
  const w = p.big ? BIG_BAR_W : BAR_W;
  const left = x - Math.floor(w / 2);
  const top = bottom - h;
  const wide = pipsWide(p.stars);
  // Over the bar, the pips' colour flush with its left end; with no bar, centred.
  const pips = wide === 0 ? null : { x: h > 0 ? left - 1 : x - Math.floor(wide / 2), y: top - PIPS_H };
  return { left, top, w, h, held, pips, peak: pips ? pips.y : top };
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

/** A row of pips with the top left of its edge at a point: silver for two stars, gold for three, bright as they pop. */
export function drawPips(g: Ctx, stars: number, x: number, y: number, bright = false): void {
  const w = pipsWide(stars);
  if (w === 0) return;
  const [light, body, shade] = bright ? BRIGHT : stars >= 3 ? GILT : SILVER;
  // The edge, its corners cut.
  R(g, x + 1, y, w - 2, PIPS_H, INK);
  R(g, x, y + 1, w, PIP, INK);
  for (let i = 0; i < Math.min(stars, 3); i++) {
    const px = x + 1 + i * PIP_STEP;
    R(g, px, y + 1, PIP, PIP, body);
    R(g, px, y + 1, 1, 1, light);
    R(g, px + 1, y + 2, 1, 1, shade);
  }
}

/** The bar: health with its shield and ticks, a Huddle group's shield along its foot, the mana under them, the dark row under all. */
function drawBar(g: Ctx, at: PlateAt, p: Plate): void {
  const { left, top, w, h } = at;
  const { hp, shield, whole } = healthOf(p, w);
  R(g, left, top, w, 2, SPENT);
  R(g, left, top, hp, 2, p.ours ? GREEN[4] : CORAL);
  R(g, left, top, hp, 1, p.ours ? LEAF : "#f4a08c");
  if (shield > 0) {
    R(g, left + hp, top, shield, 2, STONE[3]);
    R(g, left + hp, top, shield, 1, CREAM);
  }
  // A tick stands in the lower row, on the dark row under the bar; past 1,250, in both rows.
  for (const tick of ticksOf(p.maxHp, whole, w))
    R(g, left + tick.x, top + (tick.full ? 0 : 1), 1, tick.full ? 2 : 1, INK);
  if (p.pool) R(g, left, top + 1, Math.max(1, Math.round(p.pool * w)), 1, WATER[3]);
  if (p.manaFull > 0) {
    R(g, left, top + 2, w, 1, DRAINED);
    R(
      g,
      left,
      top + 2,
      Math.round(clamp(p.mana / p.manaFull, 0, 1) * w),
      1,
      p.gift || p.mana >= p.manaFull ? CREAM : WATER[3],
    );
  }
  R(g, left, top + h - 1, w, 1, INK);
}

/** Draws a plate with its foot at `foot` (the row under it), centred on `cx`. */
export function drawPlate(g: Ctx, cx: number, foot: number, p: Plate): void {
  const at = plateAt(p, cx, foot);
  drawHeld(g, at.held, 0, 0);
  if (at.h > 0) drawBar(g, at, p);
  if (at.pips) drawPips(g, p.stars, at.pips.x, at.pips.y - (p.pop?.up ?? 0), p.pop !== undefined);
}
