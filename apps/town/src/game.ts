/** What the whole town shares: the clock, who is about, what the member has, and where the camera is looking. */

import type { Body, Dir } from "@sequoia-leaf/kit/skin.ts";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

import type { GameId } from "./games.ts";
import type { Member, Tone } from "./guild.ts";
import type { Errand, PlaceId, Seat, Spot } from "./world.ts";

export type PanelId = PlaceId | "profile";
export type Doing = Errand | "fire" | "bench" | "play" | "walk" | "raid";

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
  mug: number;
}

export interface Game {
  /** Seconds of town time. */
  t: number;
  player: Actor | null;
  cinfy: Actor | null;
  mates: Actor[];
  /** Top-left of what is on screen, in the town's pixels; and the size of the screen in them. */
  cam: Pt;
  view: { w: number; h: number; z: number; dpr: number };
  panel: PanelId | null;
  /** The arrival letter has been put away; the evening has begun. */
  home: boolean;
  /** The place the member is standing at, if any. */
  near: PlaceId | null;
  /** The member is stepping through a door, and whoever is taking them through has their fading in hand. */
  inDoor: boolean;
  /** What the member has bought and still has, which of it they have on, and the quests they have claimed. */
  owned: Set<string>;
  wearing: Set<string>;
  claimed: Set<string>;
  /** Which crab is missing, and how often it has been spotted. */
  lostCrab: number;
  sightings: number;
  raidsToday: number;
  lands: number;
}

export const G: Game = {
  t: 0,
  player: null,
  cinfy: null,
  mates: [],
  cam: { x: 96, y: 0 },
  view: { w: 320, h: 190, z: 4, dpr: 1 },
  panel: null,
  home: false,
  near: null,
  inDoor: false,
  owned: new Set(),
  wearing: new Set(),
  claimed: new Set(),
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
  feed: (text: string, tone?: Tone) => void;
  /** Go through a game's door: walk up to it and on inside. */
  goIn: (id: GameId) => void;
  /** The chest's gift for today has been taken. */
  looted: () => boolean;
} = {
  visit: () => undefined,
  feed: () => undefined,
  goIn: () => undefined,
  looted: () => true,
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
  return { x: (x - Math.round(G.cam.x)) * k, y: (y - Math.round(G.cam.y)) * k };
}
