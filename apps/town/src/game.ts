/** What the whole town shares: the clock, who is about, what the member has, and where the camera is looking. */

import type { Body, Dir } from "@sequoia-leaf/kit/skin.ts";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

import type { GameId } from "./games.ts";
import type { Member, Tone } from "./guild.ts";
import type { Errand, PlaceId, Seat, Spot } from "./world.ts";

export type PanelId = PlaceId | "profile";
/** What somebody is about: an errand in town, sitting somewhere, or (in a camp) calling in or being at home. */
export type Doing = Errand | "fire" | "bench" | "play" | "walk" | "raid" | "call" | "home";

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
  /** Real members who are in the game just now, standing about the town as themselves. */
  visitors: Actor[];
  /** Top-left of what is on screen, in the town's pixels; and the size of the screen in them. */
  cam: Pt;
  view: { w: number; h: number; z: number; dpr: number };
  /** The panel that is open, by its name; the town's are named for its places. */
  panel: string | null;
  /** The arrival letter has been put away; the evening has begun. */
  home: boolean;
  /** The place the member is standing at, if any, by the name its dock button has. */
  near: string | null;
  /** The member is stepping through a door, and whoever is taking them through has their fading in hand. */
  inDoor: boolean;
  /** Which place is on the stage: the town, or a camp. */
  where: "town" | "camp";
  /** How far night has closed in on the walk between two places: 0 for not at all, 1 for dark. */
  dark: number;
  /** What the member has bought and still has, which of it they have on, and the quests they have claimed. */
  owned: Set<string>;
  wearing: Set<string>;
  claimed: Set<string>;
  /** Which crab is missing, and how often it has been spotted. */
  lostCrab: number;
  sightings: number;
  raidsToday: number;
  lands: number;
  /** Which of the market's stalls the member last looked at. */
  stall: number;
}

export const G: Game = {
  t: 0,
  player: null,
  cinfy: null,
  mates: [],
  visitors: [],
  cam: { x: 96, y: 0 },
  view: { w: 320, h: 190, z: 4, dpr: 1 },
  panel: null,
  home: false,
  near: null,
  inDoor: false,
  where: "town",
  dark: 0,
  owned: new Set(),
  wearing: new Set(),
  claimed: new Set(),
  lostCrab: 7,
  sightings: 0,
  raidsToday: 2,
  lands: 0,
  stall: 0,
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
  /** Walk out through the gate and down the trail to the member's own camp. */
  toCamp: () => void;
  /** Whether anything is waiting at the camp: a letter, a parcel. */
  campNews: () => boolean;
} = {
  visit: () => undefined,
  feed: () => undefined,
  goIn: () => undefined,
  looted: () => true,
  toCamp: () => undefined,
  campNews: () => false,
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

// ---------- a little later ----------

interface Later {
  at: number;
  where: Game["where"];
  fn: () => void;
}
const later: Later[] = [];

/**
 * Something to happen a little later, by the clock of the place that is on the stage now. If the
 * member has gone somewhere else by then, it waits until they are back.
 */
export function after(secs: number, fn: () => void): void {
  later.push({ at: G.t + secs, where: G.where, fn });
}

/** Does whatever has come due in the place that is on the stage. */
export function stepLater(): void {
  for (let i = later.length - 1; i >= 0; i--) {
    const l = later[i];
    if (!l || G.t < l.at || l.where !== G.where) continue;
    later.splice(i, 1);
    l.fn();
  }
}

/** Forgets everything still to happen in a place: it is being cleared away. */
export function forgetLater(where: Game["where"]): void {
  for (let i = later.length - 1; i >= 0; i--) if (later[i]?.where === where) later.splice(i, 1);
}
