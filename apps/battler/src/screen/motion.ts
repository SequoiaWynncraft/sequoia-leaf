/**
 * How a figure's body moves in a fight, made from the pictures it has: leaning, squashing and
 * stretching, bobbing and tumbling. Each figure on the table is an `Actor`, which keeps when each
 * thing that moves it began, by the fight's clock; `poseOf` says how it stands at a moment, adding
 * up everything that is moving it then (a figure may lunge while it winds up, or be hit mid-step).
 *
 * Squash and stretch are whole pixels added to the picture's width and height, so it stays crisp.
 */
import { type Move, moveAt } from "@sequoia-leaf/figures/move.ts";
import type { Unit } from "@sequoia-leaf/raid";

import { FV } from "./board.ts";
import type { Pt } from "./geometry.ts";
import type { Body } from "./looks.ts";

/** A blow: it draws back from `from`, strikes at `at`, `bx`, `by` pixels toward its target, and comes back; `hop` lifts it on the way, as a pounce does. */
export interface Blow {
  readonly from: number;
  readonly at: number;
  readonly bx: number;
  readonly by: number;
  readonly hop: number;
}

export interface Actor {
  unit: Unit;
  /** Feet, from the board's corner, with the halves together. */
  x: number;
  y: number;
  /** Where it is going, by the fight's clock, and whether it goes under the board for the middle of the way; null standing. */
  move: (Move & { under: boolean }) | null;
  left: boolean;
  /** Not yet on the board: one that turns up later. */
  bornAt: number;
  blow: Blow | null;
  /** When it was last hit, how far that knocked it, and whether it landed hard. */
  hurtAt: number;
  hx: number;
  hy: number;
  hard: boolean;
  /** Winding up for its ability, from `from` until it goes off `at`. */
  wind: { readonly from: number; readonly at: number; readonly body: Body } | null;
  /** In its ability's pose until then. */
  castUntil: number;
  /** An ability of its own that has gone off and not yet landed: when each, and how it points at whoever it is for (`aim`, as `acts.ts` has it; `left` for our left). */
  held: { readonly at: number; readonly lands: number; readonly aim: number; readonly left: boolean } | null;
  /** Caught by somebody's ability that has not yet landed: it shrinks, and shakes as the moment comes. */
  dread: { readonly from: number; readonly until: number } | null;
  /** When it fell (`Infinity` standing), which way it tumbles, and whether its puff has been made and it is gone. */
  fallAt: number;
  tumble: 1 | -1;
  gone: boolean;
  hopAt: number;
  /** When it last came down from a leap or a hop, for the squash of landing. */
  landAt: number;
  shieldAt: number;
  hpShown: number;
  phase: number;
}

export function actorFor(unit: Unit, at: Pt, bornAt: number): Actor {
  return {
    unit,
    x: at.x,
    y: at.y,
    move: null,
    left: unit.side !== FV.ours,
    bornAt,
    blow: null,
    hurtAt: -99,
    hx: 0,
    hy: 0,
    hard: false,
    wind: null,
    castUntil: -99,
    held: null,
    dread: null,
    fallAt: Infinity,
    tumble: 1,
    gone: false,
    hopAt: -99,
    landAt: -99,
    shieldAt: -99,
    hpShown: unit.hp,
    phase: (unit.id * 0.37) % 1,
  };
}

/** How a figure stands at a moment. */
export interface Pose {
  /** How far the figure and its base are moved, and how high off the board. */
  dx: number;
  dy: number;
  lift: number;
  /** How far the figure is off its base (tumbling off it). */
  rise: number;
  /** Pixels wider and taller than its picture, its top leaned forward (toward where it faces) by `lean` pixels, and turned by `turn`. */
  sx: number;
  sy: number;
  lean: number;
  turn: number;
  /** In its ability's pose; drawn pale (just hit) or in the hurt colour; how solid; turned the other way. */
  cast: boolean;
  tint: "flash" | "hurt" | null;
  alpha: number;
  flip: boolean;
}

/** Steps a fall takes, from the blow to the puff that it goes in. */
export const TUMBLE = 8;
/** Steps a blow takes to come back after it lands. */
const BACK = 3;

function blowPose(p: Pose, b: Blow | null, c: number): void {
  if (!b || c < b.from || c >= b.at + BACK) return;
  let k: number;
  if (c < b.at) {
    // Drawn back for the first part, then driven forward to land as the clock reaches `at`.
    const t = (c - b.from) / Math.max(1e-9, b.at - b.from);
    k = t < 0.45 ? -0.35 * (t / 0.45) : -0.35 + 1.35 * ((t - 0.45) / 0.55) ** 2;
    p.lean += t < 0.45 ? -1 : 1;
    p.lift += Math.sin(t * Math.PI) * b.hop;
    if (b.hop > 0 && t > 0.3) {
      p.sy += 1;
      p.sx -= 1;
    }
  } else {
    k = 1 - (c - b.at) / BACK;
    if (c - b.at < 1) {
      p.sx += 1;
      p.sy -= 1;
      p.lean += 1;
    }
  }
  p.dx += b.bx * k;
  p.dy += b.by * k;
}

function hurtPose(p: Pose, a: Actor, c: number): void {
  const d = c - a.hurtAt;
  if (d < 0 || d >= 4) return;
  const k = 1 - d / 4;
  p.dx += a.hx * k;
  p.dy += a.hy * k;
  if (d < 2) {
    p.sx += a.hard ? 2 : 1;
    p.sy -= a.hard ? 2 : 1;
  }
  if (d < 3) p.tint = d < 1 ? "flash" : "hurt";
}

/** A hop on the spot (a trait switching on, a win, coming back up), and coming down from one or from a leap. */
function hopPose(p: Pose, a: Actor, c: number): void {
  const d = c - a.hopAt;
  if (d >= 0 && d < 6) {
    p.lift += Math.sin((d / 6) * Math.PI) * 5;
    if (d < 3) {
      p.sy += 1;
      p.sx -= 1;
    }
  } else if (d >= 6 && d < 8) {
    p.sx += 1;
    p.sy -= 1;
  }
  const landed = c - a.landAt;
  if (landed >= 0 && landed < 3) {
    const s = landed < 1.5 ? 2 : 1;
    p.sx += s;
    p.sy -= s;
  }
  // Dropped onto the board as it turns up.
  const born = c - a.bornAt;
  if (born >= 0 && born < 4) p.lift += (4 - born) * 2;
}

function movePose(p: Pose, a: Actor, c: number): void {
  if (!a.move) return;
  const m = moveAt(a.move, c);
  p.lift += m.lift;
  if (a.move.arc >= 6) {
    // Stretched out in the air.
    if (m.k > 0.15 && m.k < 0.85) {
      p.sy += 2;
      p.sx -= 1;
    }
  } else if (m.k < 0.15) p.sy -= 1;
  else if (m.k > 0.85) {
    p.sx += 1;
    p.sy -= 1;
  } else p.lean += 1;
}

/** Each body's wind-up, `k` of the way from its beginning to the ability going off; and after it goes off, `d` steps on. */
const BODIES: Readonly<
  Record<Body, { wind: (p: Pose, k: number, c: number) => void; after?: (p: Pose, d: number) => void }>
> = {
  rear: { wind: (p, k) => (p.sy += Math.round(2 * k)) },
  crouch: {
    wind: (p, k) => {
      p.sy -= Math.round(2 * k);
      p.sx += Math.round(k);
    },
    after: (p, d) => {
      if (d < 1.5) p.sy += 2;
    },
  },
  // Up on its toes, then down hard: Greg sitting down.
  rise: {
    wind: (p, k) => {
      p.sy += Math.round(3 * k);
      p.lift += Math.round(2 * k);
      p.sx -= Math.round(k);
    },
    after: (p, d) => {
      const s = Math.round(4 * (1 - d / 4));
      p.sx += s;
      p.sy -= s;
    },
  },
  shake: { wind: (p, k, c) => (p.dx += k > 0.15 ? (Math.floor(c * 2) % 2 === 0 ? 1 : -1) : 0) },
  lean: { wind: (p, k) => (p.lean -= Math.round(2 * k)), after: (p, d) => (p.lean += d < 2 ? 2 : 0) },
  puff: {
    wind: (p, k) => {
      p.sx += Math.round(2 * k);
      p.sy += Math.round(k);
    },
    after: (p, d) => {
      if (d < 2) p.sy -= 1;
    },
  },
  wobble: {
    wind: (p, k, c) => {
      const w = Math.round(Math.sin(c * 1.4) * 1.5 * k);
      p.sx += w;
      p.sy -= w;
    },
  },
  stare: { wind: (p, k) => (p.lean += Math.round(1.5 * k)), after: (p, d) => (p.lean += d < 2 ? 2 : 0) },
  still: { wind: () => undefined },
  dig: { wind: (p, k) => (p.sy -= Math.round(5 * k)) },
  fade: {
    wind: (p, k) => {
      p.lift += Math.round(5 * k);
      p.alpha *= 1 - 0.5 * k;
    },
  },
  spin: {
    wind: (p, k, c) => {
      p.sy -= Math.round(k);
      if (k > 0.6) p.flip = Math.floor(c) % 2 === 0;
    },
    after: (p, d) => (p.flip = d < 3 && Math.floor(d * 2) % 2 === 0),
  },
};

function windPose(p: Pose, a: Actor, c: number): void {
  const w = a.wind;
  if (!w || c < w.from) return;
  const body = BODIES[w.body];
  if (c < w.at) {
    const k = (c - w.from) / Math.max(1e-9, w.at - w.from);
    body.wind(p, k, c);
    if (k > 0.4 && w.body !== "still") p.cast = true;
  } else if (c - w.at < 4) body.after?.(p, c - w.at);
}

/** Caught, and waiting for it to land: smaller and smaller, and shaking for the last of it. */
function dreadPose(p: Pose, a: Actor, c: number): void {
  const d = a.dread;
  if (!d || c < d.from || c >= d.until) return;
  const k = (c - d.from) / Math.max(1e-9, d.until - d.from);
  p.sy -= k > 0.5 ? 2 : 1;
  p.sx += 1;
  if (k > 0.65) p.dx += Math.floor(c) % 2 === 0 ? 1 : -1;
}

/** A fall: knocked up off its base, a quarter turn over, and down. */
function fallPose(p: Pose, a: Actor, c: number): void {
  const d = c - a.fallAt;
  if (d < 0) return;
  const t = Math.min(1, d / (TUMBLE - 1));
  p.rise += Math.round(Math.sin(t * Math.PI) * 5);
  p.turn = a.tumble * (Math.PI / 2) * (1 - (1 - t) * (1 - t));
  if (t >= 1) p.sx += 1;
}

/** How a figure stands at the fight's clock `c`, from everything that is moving it. */
export function poseOf(a: Actor, c: number): Pose {
  const p: Pose = {
    dx: 0,
    dy: 0,
    lift: 0,
    rise: 0,
    sx: 0,
    sy: 0,
    lean: 0,
    turn: 0,
    cast: c < a.castUntil,
    tint: null,
    alpha: 1,
    flip: false,
  };
  movePose(p, a, c);
  hopPose(p, a, c);
  windPose(p, a, c);
  blowPose(p, a.blow, c);
  hurtPose(p, a, c);
  dreadPose(p, a, c);
  fallPose(p, a, c);
  return p;
}
