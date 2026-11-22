/**
 * The Works as Leaf plays it. Leaf owns the yard, its clock and its Coins; the page holds a copy,
 * runs it with the same rules ahead of Leaf (`play`, `stepTo`), and takes Leaf's yard whenever it
 * comes.
 *
 * Time is Leaf's. A yard holds `tick`, how many ticks it has run, and `at`, the moment of Leaf's
 * clock that tick stands for; ten ticks are a second, so Leaf's tick for a yard is
 * `tick + floor((now - at) / TICK_MS)` (`clockOf`). Every command carries the tick the page's copy
 * stood at when the player did it, and is done at that tick, so the two yards agree.
 *
 * Coins are the ledger's. What the yard earns gathers in its till; a command with a price pays the
 * till in and then takes the price, `remove` gives back what a piece cost, and `collect` pays the
 * till in. Each change is keyed by the yard's `bank`, so none is made twice, and every one paid in is
 * `free`: a yard cannot earn faster than time passes.
 */
import { type CoinChange, type Ctx, type Done, type Game, LOGGED, type Logged, type Refused } from "@sequoia-leaf/core";

import { build, buyPlan, buyPlot, remove, setOpen, setRecipe, tipOut, turn, turnable } from "./build.ts";
import { AWAY_MOST_MS, forward, TICK_MS } from "./clock.ts";
import { isItem, type Item } from "./content/items.ts";
import { isKind, type Kind, SPAN } from "./content/machines.ts";
import { isPlanId, type PlanId, PLANS } from "./content/plans.ts";
import { isPlotId, type PlotId, PLOTS } from "./content/plots.ts";
import { STORY } from "./content/story.ts";
import { create } from "./create.ts";
import { type Dir, isDir } from "./grid.ts";
import { claim, swap } from "./orders.ts";
import { lay, type Leg } from "./route.ts";
import { load, save } from "./save.ts";
import { step } from "./step.ts";
import { collect, drain, type News, type World } from "./world.ts";

/** How far behind Leaf's clock `advance` leaves a yard, in ticks, so that a command made a moment ago is never in its past; and how far ahead a command may be done. */
export const LEAD = 30;
/** The most ticks `advance` runs one by one; further behind, the yard is moved on quickly (`forward`). */
export const EXACT_MOST = 3000;

interface At {
  readonly x: number;
  readonly y: number;
}

/** Everything a player does to the yard. */
export type WorksAct =
  /** A piece; over the same kind it only turns. */
  | ({ readonly do: "build"; readonly kind: Kind; readonly dir: Dir } & At)
  /** A run, all of it or none, with the first belt already standing turned to meet it. */
  | { readonly do: "lay"; readonly legs: readonly Leg[]; readonly turn?: At & { readonly dir: Dir } }
  | ({ readonly do: "remove" } & At)
  | ({ readonly do: "turn"; readonly dir: Dir } & At)
  | ({ readonly do: "recipe"; readonly item: Item | null } & At)
  | ({ readonly do: "tipOut"; readonly item: Item | null } & At)
  | ({ readonly do: "crate"; readonly open: boolean } & At)
  | { readonly do: "buyPlot"; readonly plot: PlotId }
  | { readonly do: "buyPlan"; readonly plan: PlanId }
  /** A standing order, by its own id. */
  | { readonly do: "swap"; readonly order: number }
  | { readonly do: "handOver"; readonly order: number }
  /** Pays the till in, and puts the letter about a time away away. */
  | { readonly do: "collect" };

/** A command: what the player did, and the tick the page's copy stood at when they did it. */
export type WorksCommand = WorksAct & { readonly tick: number };

/** What the page is given: the yard as stored, without its seed, and Leaf's tick now. */
export interface WorksView {
  readonly yard: string;
  readonly clock: number;
}

/** What a command did, in the yard's own news: an order handed over, and any story order finished on the way to it. */
export type WorksNote = News;

/** A command the rules turned down: the code Leaf answers, and the sentence the page says. */
export type Turned = Refused & { readonly why: string };

/** The code each command is refused with. */
export const REFUSED = {
  build: "cannot_build",
  lay: "cannot_lay",
  remove: "nothing_to_take_away",
  turn: "cannot_turn",
  recipe: "cannot_set_recipe",
  tipOut: "nothing_to_tip_out",
  crate: "not_a_crate",
  buyPlot: "plot_not_for_sale",
  buyPlan: "plan_not_for_sale",
  swap: "cannot_swap",
  handOver: "not_filled",
} as const;

/** Why the Coins of each change move, as the ledger says. */
const REASON = {
  till: "Earned in the Works",
  build: "Built in the Works",
  lay: "Belts laid in the Works",
  remove: "Taken away in the Works",
  buyPlot: "A plot for the Works",
  buyPlan: "A plan for the Works",
} as const;

/** Leaf's tick for a yard at a moment of its clock. */
export const clockOf = (w: World, now: number): number => w.tick + Math.floor((now - w.at) / TICK_MS);

/** Runs the yard on, a tick at a time, to `tick`, moving the moment it stands for with it. */
export function stepTo(w: World, tick: number): void {
  const n = Math.max(0, tick - w.tick);
  for (let k = 0; k < n; k++) step(w);
  w.at += n * TICK_MS;
}

/** Brings a yard that has fallen behind to within `LEAD` of Leaf's clock. */
function advance(w: World, ctx: Ctx): World {
  const n = clockOf(w, ctx.now) - LEAD - w.tick;
  if (n <= 0) return w;
  if (n <= EXACT_MOST) {
    stepTo(w, w.tick + n);
    // What happened unwatched is no command's news.
    drain(w);
    return w;
  }
  // Longer than five minutes: moved on quickly, for at most eight hours, and the time left over is let go.
  const did = forward(w, Math.min(n, AWAY_MOST_MS / TICK_MS));
  w.at = ctx.now - LEAD * TICK_MS;
  w.away = { seconds: (w.away?.seconds ?? 0) + did.seconds, coins: (w.away?.coins ?? 0) + did.coins };
  return w;
}

/** A Coins change, keyed by the yard's next number. */
function change(w: World, amount: number, reason: string, free: boolean): CoinChange {
  const key = `bank:${w.bank++}`;
  return free ? { amount, reason, key, free: true } : { amount, reason, key };
}

/** The till paid in, if it holds a whole Coin. */
function payIn(w: World): CoinChange[] {
  const coins = collect(w);
  return coins > 0 ? [change(w, coins, REASON.till, true)] : [];
}

/** The till paid in, and then a price taken. */
function priced(w: World, price: number, reason: string): CoinChange[] {
  const paid = payIn(w);
  return price > 0 ? [...paid, change(w, -price, reason, false)] : paid;
}

type Did = { readonly coins: CoinChange[]; readonly log: Logged[] } | Turned;

const no = (c: { readonly do: keyof typeof REFUSED }, why: string): Turned => ({ refused: REFUSED[c.do], why });
const done = (coins: CoinChange[] = [], log: Logged[] = []): Did => ({ coins, log });

/** Does a command to a yard already at its tick. Nothing is changed unless it is done. */
function act(w: World, c: WorksCommand): Did {
  switch (c.do) {
    case "build": {
      const did = build(w, c.kind, c.x, c.y, c.dir, Infinity);
      return did.ok ? done(priced(w, did.cost, REASON.build)) : no(c, did.why);
    }
    case "lay": {
      const bend = c.turn;
      if (bend && !turnable(w, bend.x, bend.y)) return no(c, "There is nothing there to turn");
      const did = lay(w, c.legs, Infinity);
      if (!did.ok) return no(c, did.why);
      if (bend) turn(w, bend.x, bend.y, bend.dir);
      return done(priced(w, did.cost, REASON.lay));
    }
    case "remove": {
      const did = remove(w, c.x, c.y);
      if (!did.ok) return no(c, did.why);
      return done(did.refund > 0 ? [change(w, did.refund, REASON.remove, true)] : []);
    }
    case "turn":
      return turn(w, c.x, c.y, c.dir) ? done() : no(c, "That cannot be turned");
    case "recipe":
      return setRecipe(w, c.x, c.y, c.item) ? done() : no(c, "That cannot make it");
    case "tipOut":
      return tipOut(w, c.x, c.y, c.item) > 0 ? done() : no(c, "There is nothing to tip out");
    case "crate":
      return setOpen(w, c.x, c.y, c.open) ? done() : no(c, "There is no crate there");
    case "buyPlot": {
      const did = buyPlot(w, c.plot, Infinity);
      if (!did.ok) return no(c, did.why);
      return done(priced(w, did.cost, REASON.buyPlot), [
        { kind: LOGGED.worksPlot, data: { plot: c.plot, price: did.cost } },
      ]);
    }
    case "buyPlan": {
      const did = buyPlan(w, c.plan, Infinity);
      if (!did.ok) return no(c, did.why);
      return done(priced(w, did.cost, REASON.buyPlan), [
        { kind: LOGGED.worksPlan, data: { plan: c.plan, price: did.cost } },
      ]);
    }
    case "swap":
      return swap(w, c.order) ? done() : no(c, "That order cannot be swapped just now");
    case "handOver": {
      const order = w.board.find((o) => o.id === c.order);
      const pay = claim(w, c.order);
      if (pay === null || !order) return no(c, "That order is not filled");
      return done([], [{ kind: LOGGED.worksOrder, data: { order: order.id, title: order.title, pay } }]);
    }
    case "collect":
      w.away = null;
      return done(payIn(w));
  }
}

/** The story orders finished since the yard last logged one. */
function told(w: World): Logged[] {
  const log = STORY.slice(w.told, w.story).map((o, k): Logged => ({
    kind: LOGGED.worksStory,
    data: { order: w.told + k + 1, title: o.title, pay: o.pay },
  }));
  w.told = w.story;
  return log;
}

/**
 * Does a command at its tick: the yard is run on to it (a tick in the yard's past is done now),
 * and then the command is done, or refused with the yard left as running on alone would leave it.
 * The page does each command to its copy with this, as Leaf does.
 */
export function play(w: World, c: WorksCommand): Done<World, WorksNote> | Turned {
  stepTo(w, c.tick);
  const did = act(w, c);
  if ("refused" in did) return did;
  return { state: w, notes: drain(w), coins: did.coins, log: [...did.log, ...told(w)] };
}

// ---------- off the wire ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, most: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most;
/** The most legs a run may have: every tile of the land. */
const MOST_LEGS = 48 * 36;

function legOf(v: unknown): Leg | null {
  if (!isRecord(v) || (v.kind !== "belt" && v.kind !== "tunnel") || !isDir(v.dir)) return null;
  if (!whole(v.x, 255) || !whole(v.y, 255) || !whole(v.span, SPAN)) return null;
  return { kind: v.kind, x: v.x, y: v.y, dir: v.dir, span: v.span };
}

/** What a command off the wire does, or null. */
function what(v: Record<string, unknown>): WorksAct | null {
  const spot = whole(v.x, 255) && whole(v.y, 255) ? { x: v.x, y: v.y } : null;
  const item = v.item === null ? null : isItem(v.item) ? v.item : undefined;
  switch (v.do) {
    case "build":
      return spot && isKind(v.kind) && isDir(v.dir) ? { do: "build", kind: v.kind, dir: v.dir, ...spot } : null;
    case "lay": {
      if (!Array.isArray(v.legs) || v.legs.length > MOST_LEGS) return null;
      const legs = v.legs.map(legOf);
      if (legs.some((l) => l === null)) return null;
      const t = v.turn;
      if (t === undefined) return { do: "lay", legs: legs.filter((l) => l !== null) };
      if (!isRecord(t) || !whole(t.x, 255) || !whole(t.y, 255) || !isDir(t.dir)) return null;
      return { do: "lay", legs: legs.filter((l) => l !== null), turn: { x: t.x, y: t.y, dir: t.dir } };
    }
    case "remove":
      return spot && { do: "remove", ...spot };
    case "turn":
      return spot && isDir(v.dir) ? { do: "turn", dir: v.dir, ...spot } : null;
    case "recipe":
    case "tipOut":
      return spot && item !== undefined ? { do: v.do, item, ...spot } : null;
    case "crate":
      return spot && typeof v.open === "boolean" ? { do: "crate", open: v.open, ...spot } : null;
    case "buyPlot":
      return isPlotId(v.plot) && PLOTS.some((p) => p.id === v.plot) ? { do: "buyPlot", plot: v.plot } : null;
    case "buyPlan":
      return isPlanId(v.plan) && PLANS.some((p) => p.id === v.plan) ? { do: "buyPlan", plan: v.plan } : null;
    case "swap":
    case "handOver":
      return whole(v.order, 1e9) ? { do: v.do, order: v.order } : null;
    case "collect":
      return { do: "collect" };
    default:
      return null;
  }
}

/**
 * A command off the wire, every field checked, or null. Fields it does not use (the command's own
 * `id`, which the play service gives every command) are let be: so a plot, a plan or an order is
 * named by a field of its own.
 */
export function readCommand(v: unknown): WorksCommand | null {
  if (!isRecord(v) || !whole(v.tick, 1e12)) return null;
  const rest = what(v);
  return rest && { ...rest, tick: v.tick };
}

/** What Leaf sent the page, read back; null for anything these rules could not have made. The yard in it is read on the page. */
export function readView(v: unknown): WorksView | null {
  return isRecord(v) && typeof v.yard === "string" && whole(v.clock, 1e12) ? { yard: v.yard, clock: v.clock } : null;
}

/** One piece of the yard's news, read back. */
function newsOf(n: unknown): WorksNote | null {
  if (!isRecord(n) || typeof n.title !== "string" || !whole(n.pay, 1e9)) return null;
  const { title, pay } = n;
  if (n.kind === "story") return whole(n.index, STORY.length) ? { kind: "story", index: n.index, title, pay } : null;
  return (n.kind === "filled" || n.kind === "standing") && whole(n.id, 1e9)
    ? { kind: n.kind, id: n.id, title, pay }
    : null;
}

/** A command's notes, read back: the yard's news. */
export function readNotes(v: unknown): WorksNote[] | null {
  if (!Array.isArray(v)) return null;
  const notes = v.map(newsOf);
  return notes.every((n) => n !== null) ? notes.filter((n) => n !== null) : null;
}

/** What the page is given of a yard: all of it but its stream, and Leaf's tick now. */
const view = (w: World, ctx: Ctx): WorksView => ({ yard: save({ ...w, seed: null }), clock: clockOf(w, ctx.now) });

/** The Works, for Leaf's play service. */
export const WORKS: Game<World, WorksCommand, WorksView, WorksNote> = {
  id: "works",
  create: (ctx) => {
    const w = create({ seed: ctx.seed });
    w.at = ctx.now;
    return w;
  },
  advance,
  // A tick further ahead than `LEAD` past Leaf's clock is done at `LEAD`.
  apply: (w, c, ctx) => play(w, { ...c, tick: Math.min(c.tick, clockOf(w, ctx.now) + LEAD) }),
  view,
  // A visitor is given what the owner is.
  visit: view,
  decode: (text) => load(text),
  encode: save,
  command: readCommand,
  // The Coins the yard has ever earned, from the depot and from orders, and how many story orders are done.
  standing: (w) => ({ score: Math.floor(w.sold + w.paid), also: { story: w.story } }),
};
