/** What the whole town shares: the clock, the purse, who is about, and where the camera is looking. */

import type { Member } from "./cast.ts";
import type { Body, Dir } from "./skin.ts";
import type { Pt } from "./util.ts";
import type { Errand, PlaceId, Seat, Spot } from "./world.ts";

export type PanelId = PlaceId | "profile";
export type Doing = Errand | "fire" | "bench" | "walk" | "raid";

export interface Actor {
  who: Member;
  body: Body;
  you: boolean;
  x: number;
  y: number;
  dir: Dir;
  speed: number;
  /** Points still to walk to, and what to do on reaching the last. */
  path: Pt[];
  arrive: (() => void) | null;
  walked: number;
  moving: boolean;
  seat: Seat | null;
  /** A seat being walked to, kept for them. */
  goal: Seat | null;
  sat: number;
  /** Seconds to stand still for, when someone has their attention. */
  hold: number;
  /** Seconds left of the hop in hand, and how many more are owed. */
  hop: number;
  hops: number;
  say: string;
  sayFor: number;
  alpha: number;
  away: boolean;
  /** Guild-mates run themselves unless someone is leading them (`led`). */
  mode: "idle" | "going" | "busy" | "led";
  wait: number;
  spot: Spot | null;
  doing: Doing;
  greeted: number;
  crown: boolean;
  mug: number;
}

export interface Quest {
  title: string;
  have: number;
  need: number;
  unit: string;
  reward: number;
  pays: "leaf" | "coins";
  claimed: boolean;
}

export interface Game {
  /** Seconds of town time. */
  t: number;
  leaf: number;
  coins: number;
  level: number;
  player: Actor | null;
  cinfy: Actor | null;
  mates: Actor[];
  /** Top-left of what is on screen, in the town's pixels; and the size of the screen in them. */
  cam: Pt;
  view: { w: number; h: number; z: number; dpr: number };
  panel: PanelId | null;
  /** The arrival card has been put away; the evening has begun. */
  home: boolean;
  owned: Set<string>;
  quests: Quest[];
  /** Crates the Works has finished and not yet sold. */
  crates: number;
  planks: number;
  /** Which crab is missing today, and how often it has been spotted. */
  lostCrab: number;
  sightings: number;
  raidsToday: number;
  lands: number;
}

export const G: Game = {
  t: 0,
  leaf: 128,
  coins: 540,
  level: 64,
  player: null,
  cinfy: null,
  mates: [],
  cam: { x: 96, y: 0 },
  view: { w: 320, h: 190, z: 4, dpr: 1 },
  panel: null,
  home: false,
  owned: new Set(),
  quests: [
    {
      title: "Finish three raids with guild-mates",
      have: 3,
      need: 3,
      unit: "raids",
      reward: 20,
      pays: "leaf",
      claimed: false,
    },
    {
      title: "Send forty planks down the belt",
      have: 31,
      need: 40,
      unit: "planks",
      reward: 150,
      pays: "coins",
      claimed: false,
    },
    {
      title: "Help hold a territory for an hour",
      have: 38,
      need: 60,
      unit: "min",
      reward: 15,
      pays: "leaf",
      claimed: false,
    },
  ],
  crates: 4,
  planks: 31,
  lostCrab: 7,
  sightings: 0,
  raidsToday: 2,
  lands: 0,
};

/** Things one part of the town asks of another without knowing who answers. */
export const hooks: {
  /** Go to a place and open it; `now` opens it at once and walks there meanwhile. */
  visit: (id: PlaceId, now?: boolean) => void;
  /** A line for the guild feed. */
  feed: (text: string, tone?: "leaf" | "coin" | "raid" | "land" | "level" | "crab") => void;
} = {
  visit: () => undefined,
  feed: () => undefined,
};

/** Listeners for "something the panels show has changed". */
const watchers: (() => void)[] = [];
export function watch(fn: () => void): void {
  watchers.push(fn);
}
export function changed(): void {
  for (const fn of watchers) fn();
}

/** A point in the town, as a point on the page in CSS pixels. */
export function toPage(x: number, y: number): Pt {
  const k = G.view.z / G.view.dpr;
  return { x: (x - G.cam.x) * k, y: (y - G.cam.y) * k };
}
