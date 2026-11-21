/**
 * What the screen keeps in mind: the yard itself, where the member is looking, what they have in
 * hand, and what is being shown about it. Everything the screen's parts share lives here.
 */

import type { Pt } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./art/belts.ts";
import { create, type Dir, type Kind, type Leg, type PlotId, type World } from "./sim/index.ts";

/** What is in the member's hand: something to build, the spade that takes things away, or nothing. */
export type Tool = Kind | "remove" | null;

/** A place being pointed at to build on, and what would come of it. */
export interface Aim {
  x: number;
  y: number;
  /** Why it cannot go there, or nothing if it can. */
  why: string | null;
  /** What it would cost. */
  cost: number;
}

/** A run of belt shown before it is laid. */
export interface Run {
  legs: Leg[];
  /** Belts already standing that the run would turn, as tile and way. */
  turns: { x: number; y: number; dir: Dir }[];
  cost: number;
  why: string | null;
}

export const S: {
  world: World;
  /** Counts every change to what stands where, so that what is worked out from it can be kept until the next. */
  rev: number;
  /** Seconds the screen has been running, and whether its clock is being stepped by hand from outside. */
  t: number;
  held: boolean;
  /** The top-left corner of what is on screen, in the yard's pixels. */
  cam: Pt;
  /** The picture's size in the yard's pixels, how many screen pixels to each, and the screen's own ratio. */
  view: { w: number; h: number; z: number; dpr: number };
  tool: Tool;
  dir: Dir;
  /** The tile the mouse is over, if it is over the yard. */
  hover: { x: number; y: number } | null;
  /** The last touch was a finger, so building is aimed first and built on a second tap. */
  finger: boolean;
  /** Where the next piece is aimed, and for a belt the run that would be laid. */
  aim: Aim | null;
  from: { x: number; y: number } | null;
  run: Run | null;
  /** The tile whose card is open. */
  picked: number;
  /** Plots being cleared before the member's eyes: when each began, in screen seconds, and where from. */
  clearing: Map<PlotId, { at: number; x: number; y: number }>;
  /** Which panel is open. */
  panel: string | null;
  /** The tile a nudge is pointing at, and what it says; and the tool it wants picked up. */
  nudge: { x: number; y: number; text: string; id: string } | null;
  nudgeTool: Tool;
} = {
  world: create(),
  rev: 0,
  t: 0,
  held: false,
  cam: { x: 0, y: 0 },
  view: { w: 320, h: 200, z: 4, dpr: 1 },
  tool: null,
  dir: 0,
  hover: null,
  finger: false,
  aim: null,
  from: null,
  run: null,
  picked: -1,
  clearing: new Map(),
  panel: null,
  nudge: null,
  nudgeTool: null,
};

/** Things to do whenever the yard is changed by hand; `main.ts` sets it to save. */
export const hooks: { changed: () => void } = { changed: () => {} };

/** The yard has been built on, cleared or bought for: whatever was worked out from it is stale. */
export function touched(): void {
  S.rev++;
  hooks.changed();
}

/** A point on the page as a point in the yard, in the yard's pixels. */
export function toYard(pageX: number, pageY: number): Pt {
  const k = S.view.dpr / S.view.z;
  return { x: pageX * k + Math.round(S.cam.x), y: pageY * k + Math.round(S.cam.y) };
}

/** A point in the yard as a point on the page. */
export function toPage(x: number, y: number): Pt {
  const k = S.view.z / S.view.dpr;
  return { x: (x - Math.round(S.cam.x)) * k, y: (y - Math.round(S.cam.y)) * k };
}

/** The tile a point on the page is over. */
export function tileAt(pageX: number, pageY: number): { x: number; y: number } {
  const p = toYard(pageX, pageY);
  return { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
}

/** The middle of a tile, in the yard's pixels. */
export const mid = (x: number, y: number): Pt => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
