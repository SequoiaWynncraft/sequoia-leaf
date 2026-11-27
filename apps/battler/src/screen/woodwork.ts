/**
 * What Up The Tree's abilities leave on the wood of the table, under the figures: the rings Unc
 * drums into it under whoever it pecked, one more a peck, for the rest of the fight; a card of Ace's
 * Full Deck stuck in its target's hex, for two seconds; and a chip of what Leetanns gathered, for a
 * second: wood, stone, a drop, a stalk. All of it belongs to the fight on show and goes with it.
 */
import { BARK, CORAL, CREAM, GREEN, INK, PAPER, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import type { Ctx } from "@sequoia-leaf/kit/util.ts";
import type { Fight, Suit } from "@sequoia-leaf/raid";

import { clockNow, fightNow } from "./board.ts";
import type { Pt } from "./geometry.ts";
import { V } from "./stage.ts";

/** What Leetanns' tools gather, a chip of each. */
export type Gathered = "wood" | "stone" | "drop" | "stalk";
/** What lies on the wood: a drum's ring, a card, or a chip of something gathered. */
type Kind = "drum" | "card" | Gathered;
interface Left {
  readonly fight: Fight;
  readonly kind: Kind;
  readonly at: Pt;
  /** A drum's ring: which one, counting out from its first. */
  readonly n: number;
  readonly t0: number;
  /** A card's suit. */
  readonly suit?: Suit;
}
const W: { left: Left[]; fight: Fight | null } = { left: [], fight: null };

/** Steps a card stays stuck and a gathered chip lies there; a drum's rings stay for the fight. */
const STUCK = 40;
const CHIP = 20;
const LASTS: Partial<Record<Kind, number>> = { card: STUCK, wood: CHIP, stone: CHIP, drop: CHIP, stalk: CHIP };

/** Forgets what lay on the table of any fight but the one on show. */
function current(): Fight | null {
  const f = fightNow();
  if (W.fight !== f) {
    W.left = [];
    W.fight = f;
  }
  return f;
}

/** Leaves something on the wood at a spot (a figure's feet), from now. */
export function leave(kind: Kind, at: Pt, n = 1, suit?: Suit): void {
  const fight = current();
  if (fight) W.left.push({ fight, kind, at, n, t0: clockNow(), ...(suit ? { suit } : {}) });
}
/** A drum's next ring under a spot: out from the edge of the last one there. */
export function ringOut(at: Pt): void {
  const had = W.left.filter((l) => l.kind === "drum" && Math.hypot(l.at.x - at.x, l.at.y - at.y) < 2).length;
  leave("drum", at, had);
}
/** A card of Ace's stuck in a hex, its suit up, for two seconds. */
export const stick = (at: Pt, suit: Suit): void => leave("card", at, 1, suit);

/** A drum's ring in the wood, the `n`th out: darker grain in the board's slant. */
function ring(g: Ctx, x: number, y: number, n: number): void {
  const r = 10 + n * 2;
  const steps = Math.max(12, r * 5);
  g.globalAlpha = 0.7;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    R(g, Math.round(x + Math.cos(t) * r), Math.round(y + Math.sin(t) * r * 0.5), 1, 1, n % 2 === 0 ? INK : BARK[0]);
  }
  g.globalAlpha = 1;
}

/** The pip of each suit, two pixels square, on a card: hearts and diamonds coral, spades and clubs ink. */
export const PIPS: Readonly<Record<Suit, readonly (readonly [number, number])[]>> = {
  spades: [
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  hearts: [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  diamonds: [
    [1, 0],
    [0, 1],
  ],
  clubs: [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
};
/** An ace's face, five by seven, `i` in its suit's colour: the A over the suit's pip. */
const A = ["..i..", ".i.i.", ".iii.", ".i.i.", "....."] as const;
const PIP: Readonly<Record<Suit, readonly [string, string]>> = {
  spades: ["..i..", ".iii."],
  hearts: [".i.i.", "..i.."],
  diamonds: ["..i..", "..i.."],
  clubs: [".iii.", "..i.."],
};
/** An ace, seven by nine with its ink edge, standing on `x`, `y`: pale, its A and its pip in coral or ink. */
export function card(g: Ctx, x: number, y: number, suit: Suit): void {
  R(g, x - 3, y - 8, 7, 9, INK);
  R(g, x - 2, y - 7, 5, 7, CREAM);
  const col = suit === "hearts" || suit === "diamonds" ? CORAL : INK;
  [...A, ...PIP[suit]].forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) if (row[dx] === "i") R(g, x - 2 + dx, y - 7 + dy, 1, 1, col);
  });
}

/** A chip of what Leetanns gathered: a split of wood, a stone, a drop, a stalk. */
function gathered(g: Ctx, x: number, y: number, what: Gathered): void {
  R(g, x - 2, y - 2, 5, 3, INK);
  if (what === "wood") R(g, x - 1, y - 1, 3, 1, BARK[3]);
  else if (what === "stone") R(g, x - 1, y - 1, 3, 1, STONE[2]);
  else if (what === "drop") R(g, x, y - 1, 1, 1, WATER[3]);
  else {
    R(g, x, y - 4, 1, 4, INK);
    R(g, x - 1, y - 1, 3, 1, GREEN[3]);
    R(g, x, y - 3, 1, 2, PAPER[1]);
  }
}

/** What lies on the wood, under everyone standing on it. */
export function drawWoodwork(g: Ctx): void {
  if (!current()) return;
  const c = clockNow();
  W.left = W.left.filter((l) => c < l.t0 + (LASTS[l.kind] ?? Infinity));
  for (const l of W.left) {
    if (c < l.t0) continue;
    const x = Math.round(V.bx + l.at.x);
    const y = Math.round(V.by + l.at.y);
    if (l.kind === "drum") ring(g, x, y, l.n);
    else if (l.kind === "card") card(g, x + 5, y, l.suit ?? "spades");
    else gathered(g, x + 6, y + 1, l.kind);
  }
}
