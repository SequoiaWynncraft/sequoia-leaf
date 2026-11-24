/**
 * The Works as Leaf plays it: Leaf owns the yard, its clock and its Coins; the
 * page holds a copy and runs it ahead with the same rules. A yard holds `tick` and `at`, the moment
 * of Leaf's clock that tick stands for; every command carries the tick the page's copy stood at and
 * is done at that tick. Coins are the ledger's: each change is keyed by the yard's `bank`.
 */
import { type Ctx, type Done, type Game, LOGGED, type Logged } from "@sequoia-leaf/core";

import { check } from "./check.ts";
import { awayOf, here, stillAt, TICK_MS } from "./clock.ts";
import { decode, encode, type KeptOrder } from "./codec.ts";
import { type Act, act, readAct, type Turned } from "./commands.ts";
import { LAND, type Land } from "./land.ts";
import { fillBoard, ORDER_TOLD, ORDER_WAITS } from "./orders.ts";
import { shortOf, writeCommand } from "./page.ts";
import { capstonesMade } from "./postcard.ts";
import { GOALS, isNode, MILLI } from "./tables.ts";
import { step } from "./tick.ts";
import { drain, emptyYard, type News, type Standing, type Yard } from "./yard.ts";

/** How far behind Leaf's clock `advance` leaves a yard, in ticks; and how far ahead a command may be done. */
export const LEAD = 30;

/** A command: what the player did, and the tick the page's copy stood at when they did it. */
export type Command = Act & { readonly tick: number };

/** What the page is given: the yard as kept, without its seed, with its letter, and Leaf's tick now. */
export interface View {
  readonly yard: string;
  readonly clock: number;
}

/**
 * What Leaf answers a batch of commands with, in place of the yard the page already holds: the
 * yard's tick after the batch and its check there (`check.ts`), and the orders hung on its board in
 * the last minute, which only Leaf, holding the seed, can draw. An order goes with every answer for
 * a minute, counting or not, so that a batch that runs past the tick an order counts from still
 * tells the page of it: the page passes over one it has, and takes Leaf's yard for one it hears
 * of too late.
 */
export interface Answer {
  readonly tick: number;
  readonly check: number;
  readonly hung: readonly Standing[];
}
export const answer = (y: Yard): Answer => ({
  tick: y.tick,
  check: check(y),
  hung: y.board.filter((o) => y.tick < o.starts - ORDER_WAITS + ORDER_TOLD),
});

/** The answer as it goes on the wire (`FACTORY.answer`): Leaf's tick now beside it, and each order by name (`keptOrder`). */
export interface Short {
  readonly clock: number;
  readonly tick: number;
  readonly check: number;
  readonly hung: readonly KeptOrder[];
}

/** A new yard: the depot in the middle, a few pieces to hand, seeded; every goal below `tier` done already, for trying later parts. */
export function create(opts: { readonly seed?: number; readonly land?: Land; readonly tier?: number } = {}): Yard {
  const y = emptyYard(opts.land ?? LAND, opts.tier ?? 0);
  y.seed = (opts.seed ?? 1) >>> 0;
  fillBoard(y);
  return y;
}

/** Leaf's tick for a yard at a moment of its clock. */
export const clockOf = (y: Yard, now: number): number => y.tick + Math.floor((now - y.at) / TICK_MS);

/** Runs the yard on, a tick at a time, to `tick` or to where it stands still, moving its moment with it. */
export function stepTo(y: Yard, tick: number): void {
  const n = Math.max(0, Math.min(tick, stillAt(y)) - y.tick);
  for (let k = 0; k < n; k++) step(y);
  y.at += n * TICK_MS;
}

const tickOf = (y: Yard, c: Command, now: number): number => Math.min(c.tick, clockOf(y, now) + LEAD);

/** Runs a yard toward a tick while `more` says, never past where it stands still; says whether it has further to go. */
function runTo(y: Yard, tick: number, more: () => boolean): boolean {
  const to = Math.min(tick, stillAt(y));
  while (y.tick < to && more()) stepTo(y, y.tick + 1);
  return y.tick < to;
}

/** Runs a yard toward `LEAD` short of Leaf's clock, or toward a command's tick, whose news is what happened on the way. */
function runOn(y: Yard, now: number, more: () => boolean, c?: Command): boolean {
  if (c) return runTo(y, tickOf(y, c, now), more);
  const further = runTo(y, clockOf(y, now) - LEAD, more);
  drain(y);
  return further;
}

function advance(y: Yard, ctx: Ctx): Yard {
  runOn(y, ctx.now, () => true);
  if (y.tick >= stillAt(y)) y.at = ctx.now;
  return y;
}

/** The nodes finished since the yard last logged one. */
function told(y: Yard): Logged[] {
  const log = y.done.slice(y.told).flatMap((g): Logged[] => {
    const info = GOALS[g];
    return info && isNode(g)
      ? [{ kind: LOGGED.worksStory, data: { node: info.id, title: info.title, pay: info.pay } }]
      : [];
  });
  y.told = y.done.length;
  return log;
}

/**
 * Does a command at its tick: the yard is run on to it, then the command is done or refused. With
 * the purse (the member's Coins in the ledger), a command that costs more than the purse and the
 * till's whole Coins is refused, with the rules' own sentence, as the ledger would refuse its price:
 * so the page asks at the moment it sends. Leaf plays with none, and its ledger is what refuses.
 */
export function play(y: Yard, c: Command, purse = Infinity): Done<Yard, News> | Turned {
  stepTo(y, c.tick);
  const did = act(y, c, purse + Math.floor(y.till / MILLI));
  if ("refused" in did) return did;
  y.seen = here(y);
  y.rev++;
  return { state: y, notes: drain(y), coins: did.coins, log: [...did.log, ...told(y)] };
}

// ---------- off the wire ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, most: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most;

/** A command off the wire, every field checked, or null. Fields it does not use are let be. */
export function readCommand(v: unknown): Command | null {
  if (!isRecord(v) || !whole(v.tick, 1e12)) return null;
  const rest = readAct(v);
  return rest && { ...rest, tick: v.tick };
}

const view = (y: Yard, ctx: Ctx): View => ({
  yard: encode(y, { seed: false, away: awayOf(y) }),
  clock: clockOf(y, ctx.now),
});

/** The Works on flat data, for Leaf's play service. */
export const FACTORY: Game<Yard, Command, View, News, Short> = {
  id: "works",
  create: (ctx) => {
    const y = create({ seed: ctx.seed });
    y.at = ctx.now;
    return y;
  },
  advance,
  tend: (y, ctx, more, c) => runOn(y, ctx.now, more, c),
  apply: (y, c, ctx) => play(y, { ...c, tick: tickOf(y, c, ctx.now) }),
  view: (y, ctx) => view(y, ctx),
  answer: (y, ctx) => shortOf(clockOf(y, ctx.now), answer(y)),
  // A visitor is given the yard as its owner's page is, blueprints and all, so that its copy can do
  // each command the owner does (a blueprint set down among them); the page shows none of them.
  visit: (y, ctx) => view(y, ctx),
  // The command as the owner's page wrote it, at the tick it was done at: the yard's, after it.
  echo: (y, c) => writeCommand({ ...c, tick: y.tick }),
  decode: (text) => decode(text),
  encode: (y) => encode(y),
  command: readCommand,
  // The page collects once a minute while the yard is watched, whether or not anybody is.
  chore: (c) => c.do === "collect",
  standing: (y) => ({ score: Math.floor((y.sold + y.paid) / MILLI), also: { tier: y.open.tier } }),
  // A model of each capstone the depot has taken in, for the member's camp.
  awards: (y) => capstonesMade(y).map((k) => `model-${k}`),
};
