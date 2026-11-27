/**
 * The fight as the table plays it, with nothing of the page in it, so that it can be tested.
 *
 * The rules' own fight is stepped to the shown clock, and whatever a step gives back is shown at
 * that step. A second copy of the same fight runs a few steps ahead of it: the same setup always
 * plays the same way, so what that copy does is what is about to happen. The table uses it to
 * begin a blow before it lands (a lunge that peaks as its hit lands, a wind-up before a cast, a
 * leap that comes down as its damage does). Only that lead-in is the table's; every event is shown
 * at the step the rules say it happens.
 *
 * Also the fight's weight: the hit-stop that holds the clock a moment on a hard blow, how far the
 * board bumps on a big one, and how many sparks the table keeps at once.
 */
import { type Fight, type FightEvent, type FightSetup, HZ, openFight, stepFight } from "@sequoia-leaf/raid";

import type { Speed } from "./keep.ts";

/** Something that happens in the fight, at the step it happens (negative during the run-in). */
export interface Cue {
  readonly at: number;
  readonly ev: FightEvent;
}
/** The lead-in to something about to happen: the table begins showing it at `from`, and it happens at `at`. */
export interface Lead extends Cue {
  readonly from: number;
}

/** How many steps the second copy runs ahead: the longest lead-in there is. */
export const LOOK = 24;

export interface Playback {
  /** The fight as shown, and the same fight a few steps further on. */
  readonly fight: Fight;
  readonly ahead: Fight;
  /** The clock as shown, in steps: negative during the run-in. */
  clock: number;
  /** Seconds the clock is still held for a hit-stop, and seconds since the last one began. */
  held: number;
  since: number;
  /** What the opening did, at its place in the run-in, not yet shown. */
  opening: Cue[];
  /** Lead-ins worked out from the copy ahead that have not begun. */
  coming: Lead[];
  /** How many steps before it happens an event's lead-in begins; 0 for none. */
  readonly leadOf: (ev: FightEvent, f: Fight) => number;
}

/**
 * Opens a fight to play. Before its first step comes the run-in: the halves meet, then what the
 * opening did is shown one thing after another (traits switching on, late crabs, Sneaks leaping).
 */
export function openPlayback(setup: FightSetup, leadOf: Playback["leadOf"]): Playback {
  const fight = openFight(setup);
  const opening: Cue[] = [];
  let at = 14;
  let last = "";
  for (const ev of fight.opening) {
    if (ev.t === "trait") at += 7;
    else if (ev.t === "summon") at += 8;
    else if (ev.t === "leap") at += last === "leap" ? 2 : 8;
    else if (ev.t === "end") at += 4;
    opening.push({ at, ev });
    last = ev.t;
  }
  const total = at + 12;
  return {
    fight,
    ahead: openFight(setup),
    clock: -total,
    held: 0,
    since: 99,
    opening: opening.map((c) => ({ at: c.at - total, ev: c.ev })),
    coming: [],
    leadOf,
  };
}

/**
 * Steps the copy ahead once, and writes down the lead-ins of what it did. A lead-in begins its full
 * length before what it leads into, whatever its owner is doing then: most abilities go off the step
 * after the attack that filled the bar, so that attack is struck already winding up.
 */
function lookAhead(pb: Playback): void {
  const events = stepFight(pb.ahead);
  const at = pb.ahead.tick;
  for (const ev of events) {
    const lead = Math.min(LOOK, pb.leadOf(ev, pb.ahead));
    if (lead > 0) pb.coming.push({ at, ev, from: at - lead });
  }
}

/** What moving the clock on brought: lead-ins that begin, and things that happen, each in order. */
export interface Moved {
  readonly begun: Lead[];
  readonly happened: Cue[];
}

/**
 * Moves the clock on by `dt` seconds at a speed (less whatever a hit-stop holds it for), and gives
 * back what begins and what happens in that time. The fight shown is only ever stepped by the
 * rules, one step after another.
 */
export function advance(pb: Playback, dt: number, speed: Speed): Moved {
  const held = Math.min(pb.held, dt);
  pb.held -= held;
  pb.since += dt;
  pb.clock += (dt - held) * HZ * speed;
  const happened: Cue[] = [];
  while (pb.opening.length > 0 && (pb.opening[0]?.at ?? 0) <= pb.clock) {
    const cue = pb.opening.shift();
    if (cue) happened.push(cue);
  }
  // Nothing is stepped during the run-in: the clock is below the first step until the opening has been shown.
  while (!pb.ahead.over && pb.ahead.tick < Math.floor(pb.clock) + LOOK) lookAhead(pb);
  while (!pb.fight.over && pb.fight.tick < Math.floor(pb.clock)) {
    for (const ev of stepFight(pb.fight)) happened.push({ at: pb.fight.tick, ev });
  }
  const begun = pb.coming.filter((l) => l.from <= pb.clock);
  if (begun.length > 0) pb.coming = pb.coming.filter((l) => l.from > pb.clock);
  return { begun, happened };
}

/** Plays the rest of the fight at once, giving back everything still to be shown. */
export function playOut(pb: Playback): FightEvent[] {
  const rest = pb.opening.map((c) => c.ev);
  pb.opening = [];
  pb.coming = [];
  while (!pb.fight.over) rest.push(...stepFight(pb.fight));
  pb.clock = pb.fight.tick;
  return rest;
}

// ---------- weight ----------

/** The blows that hold the clock: one landing hard, an ability that hits two or more, a fall, and a big moment. */
export type Weight = "hard" | "many" | "fall" | "big";
/** Seconds the clock holds for each, watched at 1x. */
const STOP: Readonly<Record<Weight, number>> = { hard: 0.045, many: 0.06, fall: 0.07, big: 0.1 };
/** How much of that is kept at each speed: half at 2x, almost none at 4x. */
const STOP_SHARE: Readonly<Record<Speed, number>> = { 1: 1, 2: 0.5, 4: 0.12 };
/** Seconds after one hit-stop begins in which another only makes the hold as long as the longer of the two. */
export const STOP_GAP = 0.25;

/** How long the clock holds for a blow of a weight, at a speed, in seconds. */
export const stopFor = (w: Weight, speed: Speed): number => STOP[w] * STOP_SHARE[speed];

/** Holds the clock for a blow of a weight, or for some seconds at 1x. Blows close together never add up: they hold as long as the longest of them. */
export function holdFor(pb: Playback, w: Weight | number, speed: Speed): void {
  const len = typeof w === "number" ? w * STOP_SHARE[speed] : stopFor(w, speed);
  if (pb.since >= STOP_GAP) {
    pb.held = len;
    pb.since = 0;
  } else pb.held = Math.max(pb.held, len - pb.since);
}

/** How far the board bumps, in art pixels, for a moment of a strength (its pixels at 1x): less at 2x and 4x, and not at all for a player who asked for less motion. */
export function bumpFor(strength: number, speed: Speed, lessMotion: boolean): number {
  if (lessMotion) return 0;
  return Math.round(strength * { 1: 1, 2: 0.6, 4: 0.3 }[speed]);
}

/** How many sparks the table keeps at once: half as many on a screen the size of a phone. */
export const sparksFor = (cssWidth: number, cssHeight: number): number =>
  Math.min(cssWidth, cssHeight) < 520 ? 240 : 480;

/** Drops the oldest of a list until it holds no more than `most`. */
export function keepNewest(list: unknown[], most: number): void {
  if (list.length > most) list.splice(0, list.length - most);
}
