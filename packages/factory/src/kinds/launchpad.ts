/**
 * The launch pad, five tiles by five (tier 8). It is set to a rocket (`ROCKETS`, chosen on its card;
 * kept as what the rocket counts as, `Yard.set`), and takes things in on the fifteen tile-sides of its
 * back and sides: each of its rocket's parts (hull sections, rocket fuel and any load) up to the
 * rocket's number of it; and once it holds all of those (ready), charged cells of any bars, while it
 * holds fewer than its rocket's cells and fewer than `CLOGGED` plain cells. It never takes a plain cell.
 *
 * Its step, where power reaches it: ready and holding at least its rocket's charged cells, it launches.
 * The launch uses its rocket's number of each part and its rocket's cells, those with the fewest bars
 * first, and the rest stays; it counts as 1 of the rocket's thing reaching the depot, and adds 1 to each
 * of the yard's launches of its kinds (`Yard.launches`). Setting it to another rocket takes nothing out:
 * what it holds stays for a rocket that uses it. The beat reaches into it as into any holder: its cells
 * with 1 bar become plain cells, which it goes on holding and lets out by the middle tile of its front,
 * one at a time, once in `LETS_OUT_EVERY` ticks. A kept one reads back up to what it can come to hold
 * (`PAD_HOLDS`).
 *
 * What a screen says of it (its words, its picture, its card) reads one thing: `padReading`.
 */
import { perMinute, whole } from "@sequoia-leaf/core";

import type { Lay } from "../build.ts";
import type { KeptPiece } from "../cells.ts";
import { CLOGGED, LETS_OUT_EVERY } from "../content/rockets.ts";
import type { Rocket } from "../launch.ts";
import type { Kept } from "../pieces.ts";
import type { Item } from "../tables.ts";
import type { Holders, Wire, Yard } from "../yard.ts";
import { firstOut } from "./big.ts";
import { keep, stockOnto } from "./holder.ts";
import { kind, type Unchecked, type Words } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { backAndSides, front } from "./ports.ts";
import { as, many, NO_POWER } from "./say.ts";

/** The rocket the pad on its own tile `i` is set to, or null for no pad. */
const rocketOf = (k: Kit, y: Yard, i: number): Rocket | null => k.rocketSet(y.set[i] ?? k.NONE);

/** How many of a thing a rocket takes beside its charged cells: 0 for a thing it does not. */
function partNeed(rocket: Rocket, n: number): number {
  for (let p = 0; p < rocket.parts.length; p++) if (rocket.parts[p]?.item === n) return rocket.parts[p]?.need ?? 0;
  return 0;
}

/** Whether a thing is a charged cell, of any bars. */
function isBar(k: Kit, n: number): boolean {
  const { bars } = k.CHARGED;
  for (let b = 0; b < bars.length; b++) if (bars[b] === n) return true;
  return false;
}

/** How many charged cells a holder's row holds, of every bars. */
function chargedIn(k: Kit, h: Holders, r: number): number {
  const { bars } = k.CHARGED;
  let n = 0;
  for (let b = 0; b < bars.length; b++) n += k.held(h, r, bars[b] ?? k.NONE);
  return n;
}

/** Whether a holder's row holds every part its rocket takes, each to the rocket's number. */
function isReady(k: Kit, h: Holders, r: number, rocket: Rocket): boolean {
  for (let p = 0; p < rocket.parts.length; p++) {
    const part = rocket.parts[p];
    if (part && k.held(h, r, part.item) < part.need) return false;
  }
  return true;
}

/** It takes its rocket's parts and charged cells; never a plain cell, nor anything else. */
function wants(k: Kit, y: Yard, i: number, n: number): boolean {
  const rocket = rocketOf(k, y, i);
  return rocket !== null && (partNeed(rocket, n) > 0 || isBar(k, n));
}

/** Room for a part below its rocket's number of it; for a charged cell, while it is ready, short of its cells and not clogged. */
function room(k: Kit, y: Yard, i: number, n: number): boolean {
  const rocket = rocketOf(k, y, i);
  if (!rocket) return false;
  const h = y.holders;
  const r = k.holderOf(y, i);
  const need = partNeed(rocket, n);
  if (need > 0) return k.held(h, r, n) < need;
  if (!isBar(k, n) || k.held(h, r, k.CHARGED.plain) >= CLOGGED) return false;
  return chargedIn(k, h, r) < rocket.cells && isReady(k, h, r, rocket);
}

/**
 * Its step in the tick's work, where power reaches it: ready and holding its rocket's charged cells,
 * it launches. It uses its rocket's number of each part and its rocket's cells, those with the fewest
 * bars first; the rocket's thing has reached the depot, and the yard's launches of each of its kinds go
 * up by 1. Says whether it launched.
 */
function work(k: Kit, y: Yard, i: number, r: number, _speed: number, wire: Wire): boolean {
  const rocket = rocketOf(k, y, i);
  const h = y.holders;
  if (!rocket || !isReady(k, h, r, rocket) || chargedIn(k, h, r) < rocket.cells) return false;
  for (let p = 0; p < rocket.parts.length; p++) {
    const part = rocket.parts[p];
    if (part) k.take(h, r, part.item, part.need);
  }
  const { bars } = k.CHARGED;
  let left = rocket.cells;
  for (let b = 0; b < bars.length && left > 0; b++) {
    const n = bars[b] ?? k.NONE;
    const used = Math.min(k.held(h, r, n), left);
    k.take(h, r, n, used);
    left -= used;
  }
  const { ever } = y.launches;
  for (let n = 0; n < rocket.kinds.length; n++) ever[rocket.kinds[n] ?? 0] = (ever[rocket.kinds[n] ?? 0] ?? 0) + 1;
  k.deliver(y, rocket.counts, 1);
  k.roomBeside(y, i, wire.waiting);
  return true;
}

/** It lets a plain cell out by its front, once in `LETS_OUT_EVERY` ticks, where the tile ahead takes it. */
function hands(k: Kit, y: Yard, i: number, wire: Wire): void {
  if (y.tick % LETS_OUT_EVERY === 0) k.sendHeld(y, i, k.holderOf(y, i), 0, k.CHARGED.plain, wire);
}

/** Whether it has a plain cell to let out to the tile `to`, ahead of its way out. */
const ready = (k: Kit, y: Yard, i: number, to: number): boolean =>
  k.portTo(y, i, 0) === to && k.held(y.holders, k.holderOf(y, i), k.CHARGED.plain) > 0;

/**
 * What a launch pad holds and is doing, the one reading its words, its picture and its card take: its
 * rocket; each part it takes, how many it holds and how many it wants; whether it holds them all;
 * its charged cells by bars (1, 2, 3) and in all; its plain cells and whether they clog it; and the
 * ticks to the yard's next beat (`toBeat`).
 */
export interface PadReading {
  readonly rocket: Rocket;
  readonly parts: readonly { readonly item: Item; readonly held: number; readonly need: number }[];
  readonly ready: boolean;
  readonly bars: readonly number[];
  readonly charged: number;
  readonly plain: number;
  readonly clogged: boolean;
  readonly toBeat: number;
}

export function padReading(k: Kit, y: Yard, i: number): PadReading | null {
  const rocket = rocketOf(k, y, i);
  if (!rocket) return null;
  const h = y.holders;
  const r = k.holderOf(y, i);
  const plain = k.held(h, r, k.CHARGED.plain);
  return {
    rocket,
    parts: rocket.parts.map((p) => ({ item: p.item, held: k.held(h, r, p.item), need: p.need })),
    ready: isReady(k, h, r, rocket),
    bars: k.CHARGED.bars.map((b) => k.held(h, r, b)),
    charged: chargedIn(k, h, r),
    plain,
    clogged: plain >= CLOGGED,
    toBeat: k.toBeat(y.tick),
  };
}

/** Whole seconds to a beat so many ticks off: "7 seconds", "1 second". */
export function secondsTo(ticks: number): string {
  const s = Math.ceil(ticks / 10);
  return `${whole(s)} second${s === 1 ? "" : "s"}`;
}

/** How it stands: with no power; clogged with plain cells (in trouble); waiting for its parts; else ready, filling with charged cells. */
function condition(k: Kit, y: Yard, i: number, lit: boolean): number {
  if (!lit) return as("unpowered", true);
  const p = padReading(k, y, i);
  if (!p) return as("idle");
  if (p.clogged) return as("blocked", true);
  return p.ready ? as("working") : as("waiting");
}

/** Its words, from its reading (`padReading`). */
function words(k: Kit, y: Yard, i: number, state: string): Words {
  if (state === "unpowered") return { line: NO_POWER };
  const p = padReading(k, y, i);
  if (!p) return { line: "" };
  if (p.clogged)
    return {
      line: `Clogged: holds ${whole(p.plain)} cells with no charge. They leave by its front, ${perMinute(k.MINUTE / LETS_OUT_EVERY)} at most.`,
      stuck: k.CHARGED.plain,
    };
  if (!p.ready) {
    const short = p.parts.filter((q) => q.held < q.need);
    const said = short.map((q) => `${whole(q.need - q.held)} ${many(k, q.item)}`);
    const last = said.pop() ?? "";
    return {
      line: `Waiting for ${said.length > 0 ? `${said.join(", ")} and ${last}` : last}.`,
      missing: short.map((q) => q.item),
    };
  }
  const one = p.bars[0] ?? 0;
  const fading = one > 0 ? ` ${whole(one)} lose their last bar in ${secondsTo(p.toBeat)}.` : "";
  return { line: `Ready. Holds ${whole(p.charged)} of ${whole(p.rocket.cells)} charged cells.${fading}` };
}

/** How many of a thing a kept one may hold: as many as a pad can come to hold, whatever it has been set to (`PAD_HOLDS`). */
const most = (k: Kit, _y: Yard, _i: number, n: number): number => k.PAD_HOLDS[n] ?? 0;

/** Puts back what a kept one was set to and held: its rocket, if a pad may be set to it, then each thing up to what it may hold. */
function onto(k: Kit, y: Yard, i: number, r: number, o: KeptPiece): void {
  const kept = o.recipe === undefined ? null : k.rocketSet(o.recipe);
  if (kept) y.set[i] = kept.counts;
  stockOnto(k, y, i, r, o, Number.MAX_SAFE_INTEGER);
}

/** A new pad is set to the first rocket; one laid over a pad keeps its rocket. */
function laid(k: Kit, y: Yard, i: number, _lay: Lay): void {
  if (rocketOf(k, y, i) === null) y.set[i] = k.FIRST_ROCKET?.counts ?? k.NONE;
}

/** What a pad keeps in a blueprint or a copy: its rocket, if a pad may be set to it. */
function keeps(k: Kit, _kind: number, v: Unchecked): Kept {
  const rocket = typeof v.recipe === "number" ? k.rocketSet(v.recipe) : null;
  return rocket ? { recipe: rocket.counts } : {};
}

/**
 * Sets its rocket, by the thing it counts as, if the pad is still set to `was`, what its card showed.
 * It takes nothing out: what it holds stays, for this rocket or another. Says why not, or nothing.
 */
function choose(k: Kit, y: Yard, i: number, out: Item | null, was?: Item): string | null {
  const next = out === null ? null : k.rocketSet(out);
  const now = rocketOf(k, y, i);
  if (!next) return "A launch pad launches a test rocket or a rocket.";
  if (now && was !== now.counts) return `It has changed since: it is set to the ${now.name.toLowerCase()} now.`;
  if (now === next) return null;
  y.set[i] = next.counts;
  k.changed(y);
  return null;
}

/** Why it never takes a thing, where it says more: a plain cell. */
const refuses = (k: Kit, _y: Yard, _i: number, n: number): string | null =>
  n === k.CHARGED.plain ? "Cells have nowhere to go: the launch pad takes only charged cells." : null;

export const launchpad = kind({
  name: "launchpad",
  info: {
    name: "Launch pad",
    cost: 400000,
    draw: 200,
    gives: 0,
    what: "Launches a rocket at the moment it holds the rocket's hull sections, its rocket fuel and all of its cells, charged, at the same time. It takes charged cells only once it holds the rest.",
  },
  holds: true,
  size: [5, 5],
  ports: { in: backAndSides(5, 5), out: [{ at: front(5, 2), sends: "out" }] },
  rules: {
    wants,
    refuses,
    room,
    give: keep,
    hands,
    ready,
    next: firstOut,
    work,
    condition,
    words,
    most,
    onto,
    laid,
    keeps,
    set: { recipe: choose },
  },
});
