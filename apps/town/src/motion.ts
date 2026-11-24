/**
 * The town and the camps, live: the rules with no page in them. Which of Leaf's rooms the page is in
 * for the place on the stage (`liveAt`), what the member's figure tells it (`stepOf`), how anybody
 * else in the room is drawn from what it says of them (`Figure`, `follow`), who is in the room and
 * what each did, as the page hears it (`Company`), what is shown while the connection is not right
 * (`linkShown`), and how many are in it (`othersIn`). `players.ts` is the page that uses them.
 */

import { campRoom, parsePlayerId } from "@sequoia-leaf/core";
import { type Emote, isEmote } from "@sequoia-leaf/kit/emotes.ts";
import {
  Flag,
  type LiveEars,
  type LiveMember,
  type LiveStatus,
  type Motion,
  type RoomState,
  type Step,
} from "@sequoia-leaf/kit/realtime.ts";
import type { Dir } from "@sequoia-leaf/kit/skin.ts";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

import { ROOM } from "./game.ts";
import type { Place } from "./screen.ts";

/** Where the page is live: in a room, out of every room with the connection kept, or with no connection. */
export type LiveAt = { readonly at: "room"; readonly room: string } | { readonly at: "away" } | { readonly at: "shut" };

/**
 * Which room the page is in for the place on the stage (`place`, null under a game): the town's in
 * town; the camp's own in a camp, `owner`'s (the member's own at home, or anybody's); none in the
 * Grove, keeping the connection; and no connection under a game, a page of its own that may go live
 * itself, a player being live on one connection at a time.
 */
export function liveAt(place: Place | null, owner: string): LiveAt {
  if (place === null) return { at: "shut" };
  const camp = parsePlayerId(owner);
  if (place === "town") return { at: "room", room: ROOM };
  return place === "camp" && camp !== undefined ? { at: "room", room: campRoom(camp) } : { at: "away" };
}

/** Whether two of where the page is live are the same: the same room, or both away, or both shut. */
export const sameLive = (a: LiveAt, b: LiveAt): boolean =>
  a.at === "room" && b.at === "room" ? a.room === b.room : a.at === b.at;

/** What a figure's `pose` tells the room: on foot, or sitting. */
export const Pose = { Foot: 0, Sitting: 1 } as const;

/** How long somebody takes to fade in when they arrive, and out when they go, in seconds. */
export const FADE = 0.3;

/** How long a name shows over somebody who has just arrived, in seconds. */
export const NAMED_FOR = 3;

/**
 * How long, after Leaf restarts, somebody who is not back in the room yet stays where they were, in
 * seconds: every page is told to come back at the same moment, and comes back within a second or
 * two, so they are not drawn going and coming again.
 */
export const REJOIN_FOR = 5;

/** The parts of a figure its motion is told from: where its feet are, which way it faces, whether it walks or sits. */
export interface Placed {
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  seat: { x: number; y: number; dir: Dir } | null;
}

/**
 * The member's figure as the room is told it: its feet in the town's art pixels, how fast it goes
 * (from where it was `dt` seconds ago, if anywhere), which way it faces, and whether it walks or
 * sits. Sitting, it is where the seat is, facing the way the seat does, and still.
 */
export function stepOf(a: Placed, was: Pt | null, dt: number): Step {
  if (a.seat) return { x: a.seat.x, y: a.seat.y, vx: 0, vy: 0, facing: a.seat.dir, pose: Pose.Sitting, flags: 0 };
  const going = a.moving && was !== null && dt > 0;
  return {
    x: a.x,
    y: a.y,
    vx: going ? (a.x - was.x) / dt : 0,
    vy: going ? (a.y - was.y) / dt : 0,
    facing: a.dir,
    pose: Pose.Foot,
    flags: a.moving ? Flag.Moving : 0,
  };
}

/** Somebody else in the room as the town draws them. */
export interface Figure {
  x: number;
  y: number;
  dir: Dir;
  /** Their legs are going. */
  moving: boolean;
  /** How far their legs have gone, which picks the step they are drawn on. */
  walked: number;
  seated: boolean;
  /** 0 to 1: fading in when they arrive, out when they go. */
  alpha: number;
  /** Their jump count as last drawn; null until they have been anywhere. */
  jump: number | null;
  /** They have left: they fade out, and are not drawn anywhere else. */
  gone: boolean;
}

export const newFigure = (): Figure => ({
  x: 0,
  y: 0,
  dir: 0,
  moving: false,
  walked: 0,
  seated: false,
  alpha: 0,
  jump: null,
  gone: false,
});

const DIRS: readonly Dir[] = [0, 1, 2, 3];
/** The facing a number says, or `or` where it says none. */
export const dirOf = (facing: number, or: Dir): Dir => DIRS.find((d) => d === facing) ?? or;

/**
 * Draws somebody where the room says they are now (`m`, from `sample`), `dt` seconds after the
 * last time: exactly there, never walked there of the town's own accord. Their legs go only while
 * they are moving, at the pace their speed gives; with `pose` sitting they are seated where they
 * are; when their jump count changes they are put at the new place at once. They fade in from
 * their first motion, and out once they have gone. With nothing new they stand where they were.
 * Says whether this was their first motion or a jump, when they were put somewhere at once.
 */
export function follow(f: Figure, m: Motion | null, dt: number): "first" | "jump" | null {
  if (f.gone) {
    f.alpha = Math.max(0, f.alpha - dt / FADE);
    f.moving = false;
    return null;
  }
  if (!m) {
    f.moving = false;
    if (f.jump !== null) f.alpha = Math.min(1, f.alpha + dt / FADE);
    return null;
  }
  const put = f.jump === null ? "first" : m.jump === f.jump ? null : "jump";
  const seated = m.pose === Pose.Sitting;
  const moving = !seated && (m.flags & Flag.Moving) !== 0;
  if (moving && put === null) {
    const pace = Math.hypot(m.vx, m.vy);
    f.walked += pace > 0 ? pace * dt : Math.hypot(m.x - f.x, m.y - f.y);
  }
  f.x = m.x;
  f.y = m.y;
  f.dir = dirOf(m.facing, f.dir);
  f.moving = moving;
  f.seated = seated;
  f.jump = m.jump;
  if (put !== "first") f.alpha = Math.min(1, f.alpha + dt / FADE);
  return put;
}

/** How many others are in the room, by its roster: everybody but the member. */
export const othersIn = (roster: ReadonlyMap<number, unknown>, you: number | null): number =>
  Math.max(0, roster.size - (you !== null && roster.has(you) ? 1 : 0));

/** What the town shows of its connection to the room: nothing, the small "Reconnecting…", or one of the kit's two cards. */
export type LinkShown = "none" | "reconnecting" | "replaced" | "signedout";

/** How long the connection is down before "Reconnecting…" shows, in milliseconds: a blip is not announced. */
export const QUIET_FOR = 2000;

/**
 * What the town shows of where the page stands with its room (null: no room): a card once Leaf has
 * let it go for good; otherwise "Reconnecting…" once the room has been lost to a drop for `QUIET_FOR`,
 * until the room welcomes the page again.
 */
export function linkShown(state: RoomState | null): LinkShown {
  if (state?.at === "gone" && state.why !== "closed") return state.why;
  return state?.at === "down" && state.ms >= QUIET_FOR ? "reconnecting" : "none";
}

// ---------- who is in the room ----------

/** Somebody else in the room: their number in it now, who they are, their figure, and what the page draws them with. */
export interface Fellow<T> {
  /** Their number in the room now; `NO_ID` while they are awaited back after Leaf restarted. */
  id: number;
  who: LiveMember;
  fig: Figure;
  own: T;
  /** Seconds left of waiting for them to come back after Leaf restarted; 0 when they are not awaited. */
  awaited: number;
}

/** The number of somebody awaited back in the room, which is nobody's: Leaf never numbers anybody 0. */
export const NO_ID = 0;

/** What the page does about what it hears: somebody made an emote or touched a thing, the connection changed. */
export interface Heard<T> {
  emote(f: Fellow<T>, kind: Emote): void;
  touch(name: string): void;
  status(s: LiveStatus): void;
}

/**
 * Everybody else in the town's room, as the page hears of them (`ears`, for `joinLive`), by their
 * account, so that a new connection's numbering never mixes two people up: who arrives, who has
 * gone, what each does, and where each is drawn (`step`). `make` makes what a newcomer is drawn
 * with. Somebody's emote is passed on only once they are drawn.
 */
export class Company<T> {
  private readonly fellows = new Map<string, Fellow<T>>();
  private readonly make: (m: LiveMember) => T;
  private readonly heard: Heard<T>;
  /** The member's own number in the room, once it has welcomed the page. */
  private you: number | null = null;

  constructor(make: (m: LiveMember) => T, heard: Heard<T>) {
    this.make = make;
    this.heard = heard;
  }

  readonly ears: LiveEars = {
    welcome: (you, _room, roster, restarted) => {
      this.you = you;
      const here = new Set<string>();
      for (const m of roster) {
        if (m.id === you) continue;
        here.add(m.player);
        this.arrive(m);
      }
      // Anybody heard of before and not in the room now has gone, unless Leaf has just restarted:
      // then they stand where they were, numbered as nobody, until they are back or `REJOIN_FOR` is up.
      for (const [player, f] of this.fellows) {
        if (here.has(player) || f.fig.gone) continue;
        if (restarted) {
          f.id = NO_ID;
          f.awaited = REJOIN_FOR;
        } else f.fig.gone = true;
      }
    },
    joined: (m) => {
      if (m.id !== this.you) this.arrive(m);
    },
    left: (id) => {
      const f = this.byId(id);
      if (f) f.fig.gone = true;
    },
    act: (id, kind, arg) => {
      const f = this.byId(id);
      if (kind === "emote" && isEmote(arg) && f && f.fig.alpha > 0) this.heard.emote(f, arg);
      else if (kind === "touch" && f) this.heard.touch(arg);
    },
    status: (s) => {
      this.heard.status(s);
    },
  };

  /** Everybody, those fading away included. */
  all(): Fellow<T>[] {
    return [...this.fellows.values()];
  }

  /** Whoever has this number in the room now, and has not gone. */
  byId(id: number): Fellow<T> | undefined {
    return id === NO_ID ? undefined : this.all().find((f) => f.id === id && !f.fig.gone);
  }

  /** Those awaited back after Leaf restarted, standing where they were: in town still, as far as anybody can tell. */
  awaited(): Fellow<T>[] {
    return this.all().filter((f) => f.awaited > 0 && !f.fig.gone);
  }

  /** Somebody is in the room: drawn from their first motion, fading in. */
  private arrive(m: LiveMember): void {
    const f = this.fellows.get(m.player);
    if (!f) {
      this.fellows.set(m.player, { id: m.id, who: m, fig: newFigure(), own: this.make(m), awaited: 0 });
      return;
    }
    // Back before they had faded away: they arrive again, from wherever they are now. Back after Leaf
    // restarted, before anybody saw them go: the same figure, put where they are as at a jump.
    if (f.fig.gone) f.fig = newFigure();
    f.id = m.id;
    f.who = m;
    f.awaited = 0;
  }

  /**
   * Everybody drawn where the room says they are now (`sample`), `dt` seconds on. Says who came
   * into sight (their first motion) and who has faded away since; those are forgotten.
   */
  step(sample: (id: number) => Motion | null, dt: number): { came: Fellow<T>[]; went: Fellow<T>[] } {
    const came: Fellow<T>[] = [];
    const went: Fellow<T>[] = [];
    for (const [player, f] of this.fellows) {
      if (f.awaited > 0) {
        f.awaited = Math.max(0, f.awaited - dt);
        if (f.awaited === 0) f.fig.gone = true;
      }
      if (follow(f.fig, f.fig.gone || f.id === NO_ID ? null : sample(f.id), dt) === "first") came.push(f);
      if (f.fig.gone && f.fig.alpha <= 0) {
        this.fellows.delete(player);
        went.push(f);
      }
    }
    return { came, went };
  }

  /** Everybody fades away: the connection has been down a while, or let go of. */
  goAll(): void {
    for (const f of this.fellows.values()) f.fig.gone = true;
  }

  /** Everybody is gone at once, and the room forgotten: the page has left it. Says who they were. */
  clear(): Fellow<T>[] {
    const all = this.all();
    this.fellows.clear();
    this.you = null;
    return all;
  }
}
