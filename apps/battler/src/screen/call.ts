/**
 * The Commodore's "Any grooters in chat?" on the table, in five beats (`LOOK-BAR.md`):
 *
 * 1. Wind-up (`LOOKS.commodore.wind`): the bell arm goes up, the other hand to his mouth, knees
 *    bent (`ringing` in the figures' `acts.ts`).
 * 2. The catch (the step it goes off): one hard ring. A pair of gold arcs leaves the bell and
 *    stops; the empty places beside him get gold corners.
 * 3. Dread (the rules' own delay): the table dims to those places, and a note rises over each, one
 *    after another, each higher. Nobody has come.
 * 4. Release (the step it lands): the dark is gone; they run in from his own table edge and skid
 *    onto their places together (`arrive`), and as they do: dust, a bump, the clock held.
 * 5. Aftermath: the bell arm comes down, the corners fade, and each grooter's name floats small
 *    over it for a second, one after another (nobody's until Leaf has named them).
 *
 * Grooters still standing are healed instead: their green numbers are the heal's own. Everything
 * is counted from the step it goes off, on the fight's clock, as `hung.ts` counts gaz's.
 */
import { nameOf } from "@sequoia-leaf/figures/sprites.ts";
import { CREAM, GOLD, INK, PAPER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import type { Fight, FightEvent } from "@sequoia-leaf/raid";
import { specOf } from "@sequoia-leaf/raid/content/figures.ts";

import { handAt } from "./acting.ts";
import { clockNow, feetAt, fightNow, FOOT, FV, travel } from "./board.ts";
import { burst, say } from "./fx.ts";
import type { Pt } from "./geometry.ts";
import { fateOf, hangs, type Hung } from "./hung.ts";
import type { Actor } from "./motion.ts";
import { snd } from "./sounds.ts";
import { dimRounds, hushing } from "./spells.ts";
import { V } from "./stage.ts";
import { bump, weigh } from "./weight.ts";

interface Call {
  readonly fight: Fight;
  readonly by: number;
  /** The empty places beside him, as spots on the board. */
  readonly places: readonly Pt[];
  readonly hung: Hung;
  /** How many of the notes have risen. */
  notes: number;
  /** Who has been called and is running in, and the step they arrive. */
  coming: number[];
  arrives: number;
  /** Landed, and arrived (the bump and the held clock given); how many of the names have floated. */
  landed: boolean;
  arrived: boolean;
  named: number;
  /** What happens as it lands: its mark. */
  readonly land: () => void;
}
const calls: Call[] = [];

/** Steps the grooters take to run in from the table's edge, and the steps the corners take to fade after. */
export const RUN = 6;
const FADES = 10;
/** Steps between one grooter's name floating up and the next's. */
const NAMES = 8;
/** How far behind him his own table edge is, and how far over a note rises, the later ones higher. */
const EDGE = 40;
const NOTE_RISE = 8;
const HIGHER = 3;
/** The dread's pools: half the width and height of the light round each place. */
const POOL = { rx: 12, ry: 9 } as const;

/** Rings for whoever is called: the places marked from step `at`, landing `ticks` steps on with `land`. */
export function hangCall(ev: Extract<FightEvent, { t: "cast" }>, at: number, land: () => void): void {
  const fight = fightNow();
  const a = FV.actors[ev.id];
  if (!fight || !a) return land();
  const hung = hangs(at, ev.ticks);
  a.held = { at, lands: hung.lands, aim: 8, left: a.left };
  const places = ev.cells.map(feetAt);
  calls.push({
    fight,
    by: ev.id,
    places,
    hung,
    notes: 0,
    coming: [],
    arrives: -1,
    landed: false,
    arrived: false,
    named: 0,
    land,
  });
  // One hard ring: a puff of gold off the bell.
  const bell = handAt(a, at, fight.tick);
  if (bell) burst(bell.x, bell.y, 6, [GOLD[1], GOLD[2], CREAM], { speed: 40, grav: 0, ttl: 0.25 });
}

/**
 * A grooter the Commodore called comes in: from his own table edge, at a run, onto its place,
 * where it skids to a stop with the others. Gives back whether it was one of his.
 */
export function arrive(a: Actor, by: Actor | undefined, spot: Pt, at: number): boolean {
  const call = calls.find((c) => c.by === by?.unit.id && c.fight === fightNow() && !c.arrived);
  if (!call || !by) return false;
  const behind = by.unit.side === FV.ours ? 1 : -1;
  a.x = spot.x;
  a.y = by.y + behind * EDGE;
  travel(a, spot, at, RUN, 0);
  a.landAt = at + RUN;
  call.coming.push(a.unit.id);
  call.arrives = Math.max(call.arrives, at + RUN);
  return true;
}

/** They are here: dust off every one of them as they skid, the board bumps, the clock holds. */
function arrived(call: Call): void {
  call.arrived = true;
  for (const id of call.coming) {
    const a = FV.actors[id];
    if (a) burst(a.x, a.y, 8, [PAPER[1], CREAM], { speed: 30, toward: Math.PI, spread: 1.2, ttl: 0.35, above: false });
  }
  if (call.coming.length > 0) {
    bump(2);
    weigh(0.12);
  }
}

/** The notes rising over the places, each as its turn comes, a little higher than the last. */
function sing(call: Call, c: number): void {
  const k = clamp((c - call.hung.at) / Math.max(1, call.hung.lands - call.hung.at), 0, 1);
  const due = Math.min(call.places.length, Math.floor(k * (call.places.length + 1)));
  for (; call.notes < due; call.notes++) snd.ability({ n: 7 + call.notes * 4, wave: "triangle", vol: 0.05 });
}

/** Lands what is due, brings in whoever was called, and forgets what has faded or will never land. */
export function stepCalls(c: number): void {
  for (const call of calls.splice(0)) {
    const live = call.fight === fightNow();
    const fate = live ? fateOf(call.hung, c, call.fight) : "never";
    if (fate === "never" && !call.landed) continue;
    if (!live || c >= call.hung.lands + RUN + FADES) continue;
    calls.push(call);
    if (fate === "hangs") sing(call, c);
    else if (!call.landed) {
      call.landed = true;
      call.land();
    }
    if (call.landed && !call.arrived && call.arrives >= 0 && c >= call.arrives) arrived(call);
    if (call.arrived) named(call, c);
  }
}

/** Each grooter's name floats small over it in turn, once Leaf has said who it is. */
function named(call: Call, c: number): void {
  for (; call.named < call.coming.length && c >= call.arrives + call.named * NAMES; call.named++) {
    const a = FV.actors[call.coming[call.named] ?? -1];
    const name = a ? nameOf(call.fight.cat, a.unit.kind) : "";
    if (a && name !== specOf(call.fight.cat, a.unit.kind).name)
      say(a.x, a.y - 24, name, CREAM, { small: true, ttl: 1.2, rise: 6 });
  }
}

/** Gold corners round a place on the board, a screen point at its middle, closing in as they are put down. */
export function hexCorners(g: Ctx, x: number, y: number, since: number): void {
  const out = Math.max(0, 3 - Math.floor(since)) * 2;
  for (const sx of [-1, 1] as const)
    for (const sy of [-1, 1] as const) {
      const cx = x + sx * (8 + out);
      const cy = y + sy * (6 + out);
      R(g, cx - (sx === 1 ? 3 : 0) - 1, cy - 1, 5, 3, INK);
      R(g, cx - 1, cy - (sy === 1 ? 3 : 0) - 1, 3, 5, INK);
      R(g, cx - (sx === 1 ? 3 : 0), cy, 4, 1, GOLD[2]);
      R(g, cx, cy - (sy === 1 ? 3 : 0), 1, 4, GOLD[2]);
    }
}

/** A note: a head two pixels square, its stem and flag, gold, edged. */
function note(g: Ctx, x: number, y: number): void {
  R(g, x - 2, y - 1, 4, 4, INK);
  R(g, x, y - 7, 4, 7, INK);
  R(g, x - 1, y, 2, 2, GOLD[2]);
  R(g, x + 1, y - 6, 1, 6, GOLD[2]);
  R(g, x + 2, y - 5, 1, 2, GOLD[1]);
}

/** Whether a call is waiting on somebody now, the table dark round its places. */
export const calling = (): boolean => calls.some((x) => x.fight === fightNow() && !x.landed);

/** The dark round the places while nobody has come, under everyone standing on the table; none while a seal has the table dark. */
export function drawCallsUnder(g: Ctx): void {
  const c = clockNow();
  const call = calls.find((x) => x.fight === fightNow() && !x.landed);
  if (!call || hushing()) return;
  const pools = call.places.map((p) => ({ x: Math.round(V.bx + p.x), y: Math.round(V.by + p.y) - FOOT }));
  dimRounds(g, pools, POOL.rx, POOL.ry, (c - call.hung.at) / 3);
}

/** Over everyone: the arcs leaving the bell, the corners on the places, the notes over them. */
export function drawCalls(g: Ctx): void {
  const c = clockNow();
  for (const call of calls) {
    if (call.fight !== fightNow()) continue;
    const since = c - call.hung.at;
    const after = c - call.hung.lands;
    g.globalAlpha = after > RUN ? clamp(1 - (after - RUN) / FADES, 0, 1) : 1;
    call.places.forEach((p, i) => {
      const x = Math.round(V.bx + p.x);
      const y = Math.round(V.by + p.y) - FOOT;
      hexCorners(g, x, y, since);
      if (call.landed || i >= call.notes) return;
      const risen = clamp((c - call.hung.at) / 8 - i, 0, 1);
      note(g, x, y - 12 - Math.round(risen * NOTE_RISE) - i * HIGHER);
    });
    g.globalAlpha = 1;
    if (since >= 0 && since < 4) rang(g, call, c, since);
  }
}

/** The ring of the bell: a pair of gold arcs going out from it, which stop where they are. */
function rang(g: Ctx, call: Call, c: number, since: number): void {
  const a = FV.actors[call.by];
  const bell = a ? handAt(a, c, call.fight.tick) : null;
  if (!bell) return;
  const x = Math.round(V.bx + bell.x);
  const y = Math.round(V.by + bell.y) + 2;
  const r = 3 + Math.min(2, Math.floor(since)) * 2;
  for (const side of [-1, 1] as const)
    for (const [d, col] of [
      [r, GOLD[2]],
      [r + 2, GOLD[1]],
    ] as const)
      for (let i = -2; i <= 2; i++) R(g, x + side * d, y + i, 1, 1, col);
}
