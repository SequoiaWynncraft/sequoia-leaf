/** What the whole town shares: the clock, who is about, and where the camera is looking. The member's town is Leaf's (`leaf.ts`). */

import { DAY_MS, utcDay } from "@sequoia-leaf/core";
import type { Body, Dir } from "@sequoia-leaf/kit/skin.ts";
import type { Pt, Rect } from "@sequoia-leaf/kit/util.ts";
import { seedOf, stagedBy } from "@sequoia-leaf/town/clock.ts";
import type { Doing as FolkDoing, Townsperson } from "@sequoia-leaf/town/folk.ts";
import type { SeatAt } from "@sequoia-leaf/town/map/kinds.ts";
import { RESTS } from "@sequoia-leaf/town/map/map.ts";
import type { PlaceId } from "@sequoia-leaf/town/map/rows.ts";

import type { FolkArt } from "./folkart.ts";
import type { GameId } from "./games.ts";
import type { Deeds, Moment, Tone } from "./guild.ts";
import type { Place } from "./screen.ts";

export type PanelId = PlaceId | "profile";

/** Somewhere to sit, as the page keeps it: in town one of the map's rest spots (a camp makes its own). */
export interface Seat {
  /** Where the sitter is drawn, and which way they face. */
  x: number;
  y: number;
  dir: Dir;
  /** The clear spot they step up from. */
  from: Pt;
  /** By the fire, on the garden bench or the bench by the Works' door, or at the stump. */
  at: SeatAt;
  taken: boolean;
  /** Left for the member: nobody else sits there. */
  yours?: boolean;
}

/** The town's seats: the map's rest spots, in its order. */
export const SEATS: Seat[] = RESTS.map((r) => ({
  x: r.x,
  y: r.y,
  dir: r.dir,
  from: { ...r.from },
  at: r.at,
  taken: false,
  yours: r.yours,
}));
/**
 * What somebody is about: what one of the town's own is doing (`folk.ts`), or for a member where
 * they are (about the town, by the Works, at the stump, before the Grove's stone, at home in a camp).
 */
export type Doing = FolkDoing | "table" | "grove" | "home";

/** Who somebody is, as a name plate and a card say: their name, and a member's rank and level. */
export interface Who {
  name: string;
  /** A member's rank as the town writes it; empty when it is not known. The town's own have none. */
  rank: string;
  level: number;
  /** How high their voice is, for the blips when they speak. */
  voice: number;
}

/**
 * What somebody's feet are doing: standing still; walking a way, with what to do at its end;
 * walking to a seat kept for them on the way, told the seat they sat on (none: somebody was there
 * by then); sitting on a seat; or put where somebody else says, each frame (a live player, a member
 * visiting), on their feet or on a seat of their own. A walk's end and its seat go with the walk:
 * nothing of a walk outlives it.
 */
export type Move =
  | { readonly kind: "still" }
  | { readonly kind: "walking"; readonly path: Pt[]; readonly done: (() => void) | null }
  | {
      readonly kind: "toSeat";
      readonly seat: Seat;
      readonly path: Pt[];
      readonly done: ((sat: Seat | null) => void) | null;
    }
  | { readonly kind: "seated"; readonly seat: Seat }
  | { readonly kind: "puppet"; readonly seat: Seat | null };

export interface Actor {
  /** A member's account, the same on every page; empty for the town's own. */
  id: string;
  who: Who;
  /** A member's figure, from their own skin (or a made-up one until it arrives); none for the town's own. */
  body: Body | null;
  /** One of the town's own: who it is and its own pictures; none for a member. */
  folk: { t: Townsperson; art: FolkArt } | null;
  /** Drawn this many pixels above where it stands: on a stool behind a counter, curled up on a stall. */
  lift: number;
  /** A member who has gone, dozing where they sat: when the game last saw them, in milliseconds since 1970. */
  dozing: number | null;
  you: boolean;
  x: number;
  y: number;
  /** How far from where they stand they are drawn, to stand apart from others on one spot (`apart.ts`). */
  aside: Pt;
  dir: Dir;
  /** Which way they last went across: -1 left, 1 right (for a sprite that is only drawn side on). */
  side: -1 | 1;
  speed: number;
  /** What their feet are doing (`actors.ts` moves it): the one record of where they are going and what they sit on. */
  move: Move;
  /** The seat they sit on (a seat of their own, for somebody put where others say), if any: from `move`. */
  readonly seat: Seat | null;
  /** A seat being walked to, kept for them: from `move`. */
  readonly goal: Seat | null;
  /** Points still to walk to: from `move`. */
  readonly path: readonly Pt[];
  walked: number;
  /** Whether they went anywhere this step. */
  moving: boolean;
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
  doing: Doing;
  /** A member at the Works with a crate in their arms, on the way to the belt. */
  carry: boolean;
  greeted: number;
  /** Their name shows until this moment of the town's clock, whatever else: somebody who has just arrived. */
  named: number;
}

/** The town's live room, by name; and its seed, which with Leaf's clock (`G.now`) says what the town does by itself. */
export const ROOM = "town";
export const SEED = seedOf(ROOM);

export interface Game {
  /** Seconds of town time. */
  t: number;
  /** Leaf's clock as of this step, in milliseconds since 1970 (the page's own, out of a room): what the town goes by. */
  now: number;
  player: Actor | null;
  cinfy: Actor | null;
  /** The town's own, about the town: the keepers and the creatures. */
  folk: Actor[];
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
  /** Which place is on the stage: the town, a camp, or the Grove. Only the stage sets it (`main.ts`). */
  where: Place;
  /** How far night has closed in on the walk between two places: 0 for not at all, 1 for dark. Only the stage sets it. */
  dark: number;
  /** Which of the market's stalls the member last looked at. */
  stall: number;
}

export const G: Game = {
  t: 0,
  now: 0,
  player: null,
  cinfy: null,
  folk: [],
  visitors: [],
  cam: { x: 96, y: 0 },
  view: { w: 320, h: 190, z: 4, dpr: 1 },
  panel: null,
  home: false,
  near: null,
  where: "town",
  dark: 0,
  stall: 0,
};

/** Somewhere the member is standing at, as the prompt by it needs to know it. */
export interface Prompted {
  name: string;
  /** Where its prompt floats. */
  prompt: Pt;
}

/** What is to be shown besides the place itself. */
export const show: {
  prompt: Prompted | null;
  promptT: number;
  dest: Pt | null;
  /** The last touch was a finger, so the prompt says "Tap". */
  touch: boolean;
  /** Where the prompt was last written, in the place's pixels: a touch there is a touch on it. */
  sign: Rect | null;
  hover: Rect | null;
  /** Whoever the pointer is resting on, and whoever's card is open: their names show. */
  pointed: Actor | null;
  card: Actor | null;
  /**
   * Somebody chosen in "Who is about", until when (the town's clock): a ring at their feet and their
   * name over them; `glide` while the view goes to them, because they were out of it (null until
   * the next step decides).
   */
  found: { a: Actor; until: number; glide: boolean | null } | null;
} = {
  prompt: null,
  promptT: 0,
  dest: null,
  touch: false,
  sign: null,
  hover: null,
  pointed: null,
  card: null,
  found: null,
};

/**
 * Somewhere the member asks to go: the town or the Grove; somebody's camp by their id (`name`, if
 * known, is theirs), or the member's own without one or with their own id; or through a game's
 * door, walking up to it first (for the Works, to `of`'s yard, if given).
 */
export type Going =
  | { readonly to: "town" | "grove" }
  | { readonly to: "camp"; readonly of?: string; readonly name?: string }
  | { readonly to: "game"; readonly game: GameId; readonly of?: string };

/** Things one part of the town asks of another without knowing who answers. Each is set once, as the page starts. */
export const hooks: {
  /** Open a place at once, and walk there meanwhile. */
  visit: (id: PlaceId) => void;
  /** A line for the guild feed. */
  feed: (text: string, tone?: Tone) => void;
  /** Go somewhere, as the stage allows (`main.ts`): it is the one way between places and into games. */
  go: (where: Going) => void;
  /** The banner open in the Grove, whose it is and until when, in a line; null while there is none or Leaf has not said whose. */
  groveBanner: () => string | null;
  /** Tell the town's room that the member touched a thing in town, by its name. */
  tell: (name: string) => void;
  /** The guild's raid parties and wars, as the guild has them (`guild.deeds`). */
  deeds: () => Deeds;
} = {
  visit: () => undefined,
  feed: () => undefined,
  go: () => undefined,
  groveBanner: () => null,
  tell: () => undefined,
  deeds: () => ({ moments: [], day: { from: 0, party: 0, war: 0 } }),
};

/**
 * The guild's raids (`party`) or wars of today (UTC, by Leaf's clock) that the town has staged for
 * `ms`: how many, and when each of those it still knows of got there (`stagedBy`). The count is
 * Leaf's, so it is the same on a page just opened as on one open all day.
 */
export function today(kind: Moment["kind"], ms = 0): ReturnType<typeof stagedBy> {
  const { moments, day } = hooks.deeds();
  const now = utcDay(G.now);
  const whens = moments.flatMap((m) => (m.kind === kind && utcDay(m.happened) === now ? [m.at + ms] : []));
  return stagedBy(day.from === now * DAY_MS ? day[kind] : 0, whens, G.now);
}

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

// ---------- at a moment of Leaf's clock ----------

/** How late something timed by Leaf's clock may still be played, in milliseconds: later, the page was not looking. */
const LATE = 1000;
const cues: { at: number; where: Game["where"]; play: () => void }[] = [];
/** Leaf's clock when this page first looked for what was due. */
let since: number | null = null;

/**
 * Something seen or heard once, at a moment of Leaf's clock, in the place on the stage now. It is
 * not played if the page was not there for it: the moment was before the page came, the page was
 * put away, or the member has gone somewhere else. Whatever lasts is drawn from the clock instead.
 */
export function cue(at: number, play: () => void): void {
  cues.push({ at, where: G.where, play });
}

/** Plays whatever has come due by Leaf's clock (`G.now`). */
export function stepCues(): void {
  since ??= G.now;
  for (let i = cues.length - 1; i >= 0; i--) {
    const c = cues[i];
    if (!c || c.at > G.now) continue;
    cues.splice(i, 1);
    if (c.where === G.where && c.at >= since && G.now - c.at < LATE) c.play();
  }
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
