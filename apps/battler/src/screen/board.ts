/**
 * The fight on the table as it stands: the fight being played (`playback.ts`) and everyone in it
 * as the table draws them (`motion.ts`), what is in the air, the hexes lit, the signs over heads,
 * dusk, and the bump of a big moment. `fightview.ts` plays and draws it, `fightshow.ts` turns what
 * happens into what is seen, and both keep it here.
 */
import type { BaseLook } from "@sequoia-leaf/figures/sprites.ts";
import { GREEN } from "@sequoia-leaf/kit/palette.ts";
import type { Fight, FightEvent, TraitId } from "@sequoia-leaf/raid";
import type { Catalog } from "@sequoia-leaf/raid/content/catalog.ts";
import { figureIn, isFigureId, type UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import { mirror, type Side } from "@sequoia-leaf/raid/hex.ts";

import { TRAIT_COLOUR } from "./art/pal.ts";
import { cellXY, type Pt } from "./geometry.ts";
import type { Speed } from "./keep.ts";
import type { Shot } from "./marks.ts";
import type { Actor } from "./motion.ts";
import type { Playback } from "./playback.ts";

/** A hex lit by an ability, from when, in its owner's colour. */
export interface Flash {
  cell: number;
  t0: number;
  col: string;
}
/** A small sign over a figure: a trait switching on, an item doing its trick. */
export interface Sign {
  pic: HTMLCanvasElement;
  id: number;
  t0: number;
}

/** How far the fight on the table has been played: not at all, the run-in, the steps, or done (when, by the stage's clock). */
export type Stage = "off" | "run-in" | "run" | { done: number };

export const FV: {
  pb: Playback | null;
  actors: (Actor | undefined)[];
  speed: Speed;
  stage: Stage;
  shots: Shot[];
  flashes: Flash[];
  signs: Sign[];
  dusk: number;
  clacked: boolean;
  /** When the board last bumped for a big moment, and how far, in art pixels. */
  bump: { at: number; px: number };
  /** The look of the bases the member's figures stand on. */
  bases: BaseLook;
  /** Told once, when the fight has been played to its end and shown a moment longer. */
  done: (() => void) | null;
  /** Everything that has been shown happening so far, the opening first: what the tally is counted from. */
  seen: FightEvent[];
  /** Told when one of the member's traits switches on as a fight starts, to light its chip. */
  woke: ((trait: TraitId) => void) | null;
  /** The member's own side (`sides.ts`): drawn on the near half, the board turned round when it is the second. */
  ours: Side;
} = {
  pb: null,
  actors: [],
  speed: 1,
  stage: "off",
  shots: [],
  flashes: [],
  signs: [],
  dusk: 0,
  clacked: false,
  bump: { at: -99, px: 0 },
  bases: "plain",
  done: null,
  seen: [],
  woke: null,
  ours: 0,
};

/** The fight being shown, if one is. */
export const fightNow = (): Fight | null => FV.pb?.fight ?? null;
/** The fight's clock as shown, in steps. */
export const clockNow = (): number => FV.pb?.clock ?? 0;

/** The hex a fight cell is drawn at: the cell itself, or with the member on the second side, the board turned round. */
export const shownCell = (cell: number): number => (FV.ours === 0 ? cell : mirror(cell));

/** How far below the middle of its hex a figure's feet are (the same as while planning). */
export const FOOT = 3;
export const feetAt = (cell: number): Pt => {
  const p = cellXY(shownCell(cell));
  return { x: p.x, y: p.y + FOOT };
};
/** The colour an ability is drawn in: its owner's kin, or moss green for the forest's own. */
export const colourOf = (cat: Catalog, kind: UnitKind): string =>
  isFigureId(kind) ? TRAIT_COLOUR[figureIn(cat, kind).kin] : GREEN[3];

/** Sends a figure from where it is drawn to a spot, over `ticks` steps from `t0`, in an arc; `under` goes under the board on the way. */
export function travel(a: Actor, to: Pt, t0: number, ticks: number, arc: number, under = false): void {
  a.move = { from: { x: a.x, y: a.y }, to, t0, dur: Math.max(1, ticks), arc, smooth: false, under };
  if (Math.abs(to.x - a.x) > 1) a.left = to.x < a.x;
}

/** Turns a figure toward another. */
export function face(a: Actor, toward: Actor | undefined): void {
  if (toward && Math.abs(toward.x - a.x) > 1) a.left = toward.x < a.x;
}
