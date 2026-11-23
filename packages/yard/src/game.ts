/**
 * The Works as Leaf plays it. Leaf owns the yard, its clock and its Coins; the page holds a copy,
 * runs it with the same rules ahead of Leaf (`play`, `stepTo`), and takes Leaf's yard whenever it
 * comes.
 *
 * Time is Leaf's. A yard holds `tick`, how many ticks it has run, and `at`, the moment of Leaf's
 * clock that tick stands for; ten ticks are a second, so Leaf's tick for a yard is
 * `tick + floor((now - at) / TICK_MS)` (`clockOf`). Every command carries the tick the page's copy
 * stood at when the player did it, and is done at that tick, so the two yards agree. A yard runs
 * tick for tick for eight hours after its owner's last command, and then stands still (`clock.ts`).
 *
 * Coins are the ledger's. What the yard earns gathers in its till; a command with a price pays the
 * till in and then takes the price, `remove` gives back what a piece cost, and `collect` pays the
 * till in. Each change is keyed by the yard's `bank`, so none is made twice, and every one paid in is
 * `free`: a yard cannot earn faster than time passes.
 */
import { type CoinChange, type Ctx, type Done, type Game, LOGGED, type Logged, type Refused } from "@sequoia-leaf/core";

import { build, buyPlan, buyPlot, paint, remove, setOpen, setRecipe, setWay, tipOut, turn } from "./build.ts";
import { check } from "./check.ts";
import { awayOf, here, stillAt, TICK_MS } from "./clock.ts";
import { isItem, type Item } from "./content/items.ts";
import { BLUEPRINTS, isKind, type Kind, STAND_MOST } from "./content/machines.ts";
import { isPlanId, type PlanId, PLANS } from "./content/plans.ts";
import { isPlotId, type PlotId, PLOTS } from "./content/plots.ts";
import { STORY } from "./content/story.ts";
import { create } from "./create.ts";
import { type Dir, isDir } from "./grid.ts";
import { claim, counts, swap } from "./orders.ts";
import { clear, deleteBlueprint, move, type Piece, saveBlueprint, stand } from "./pieces.ts";
import { postcard } from "./postcard.ts";
import { load, readPiece, readStanding, save } from "./save.ts";
import { step } from "./step.ts";
import { collect, drain, type News, type Standing, TINTS, type World } from "./world.ts";

/** How far behind Leaf's clock `advance` leaves a yard, in ticks, so that a command made a moment ago is never in its past; and how far ahead a command may be done. */
export const LEAD = 30;

interface At {
  readonly x: number;
  readonly y: number;
}

/** Everything a player does to the yard. */
export type WorksAct =
  /** A piece; over the same kind it only turns. */
  | ({ readonly do: "build"; readonly kind: Kind; readonly dir: Dir } & At)
  /** A run, all of it or none, with the first belt already standing turned to meet it. */
  | { readonly do: "lay"; readonly legs: readonly Piece[]; readonly turn?: At & { readonly dir: Dir } }
  /** A set of pieces (a copy, a blueprint set down), all of it or none. */
  | { readonly do: "stand"; readonly pieces: readonly Piece[] }
  /** The pieces on some tiles moved as one: turned so many quarter turns, the corner of their box set on a tile. */
  | ({ readonly do: "move"; readonly tiles: readonly number[]; readonly turns: Dir } & At)
  | ({ readonly do: "remove" } & At)
  /** Every piece on some tiles taken away. */
  | { readonly do: "clear"; readonly tiles: readonly number[] }
  /** The pieces on some tiles kept as the blueprint in a place; and the blueprint in a place thrown away. */
  | { readonly do: "saveBlueprint"; readonly slot: number; readonly tiles: readonly number[] }
  | { readonly do: "deleteBlueprint"; readonly slot: number }
  | ({ readonly do: "turn"; readonly dir: Dir } & At)
  /** A colour, 1 to 6, for the line through a tile, or 0 to take it off. */
  | ({ readonly do: "paint"; readonly tint: number } & At)
  | ({ readonly do: "recipe"; readonly item: Item | null } & At)
  | ({ readonly do: "tipOut"; readonly item: Item | null } & At)
  | ({ readonly do: "crate"; readonly open: boolean } & At)
  /** One of a splitter's ways out, 0 for ahead, 1 for left, 2 for right, opened or shut. */
  | ({ readonly do: "way"; readonly way: number; readonly open: boolean } & At)
  | { readonly do: "buyPlot"; readonly plot: PlotId }
  | { readonly do: "buyPlan"; readonly plan: PlanId }
  /** A standing order, by its own id. */
  | { readonly do: "swap"; readonly order: number }
  | { readonly do: "handOver"; readonly order: number }
  /** Pays the till in, and puts the letter about a time away away. */
  | { readonly do: "collect" };

/** A command: what the player did, and the tick the page's copy stood at when they did it. */
export type WorksCommand = WorksAct & { readonly tick: number };

/** What the page is given: the yard as stored, without its seed, with what it did while its owner was away, and Leaf's tick now. */
export interface WorksView {
  readonly yard: string;
  readonly clock: number;
}

/**
 * What Leaf answers a batch with, in place of the yard the page already holds: Leaf's tick now; the
 * yard's tick after the batch, and its check there (`check.ts`); and the orders on its board that do
 * not count yet (`hung`), which only Leaf, holding the seed, can draw.
 */
export interface WorksAnswer {
  readonly clock: number;
  readonly tick: number;
  readonly check: number;
  readonly hung: readonly Standing[];
}

/** What a command did, in the yard's own news: an order handed over, and any story order finished on the way to it. */
export type WorksNote = News;

/** A command the rules turned down: the code Leaf answers, and the sentence the page says. */
export type Turned = Refused & { readonly why: string };

/** The code each command is refused with. */
export const REFUSED = {
  build: "cannot_build",
  lay: "cannot_lay",
  stand: "cannot_stand",
  move: "cannot_move",
  remove: "nothing_to_take_away",
  clear: "nothing_to_clear",
  saveBlueprint: "cannot_save_blueprint",
  deleteBlueprint: "no_blueprint",
  turn: "cannot_turn",
  paint: "nothing_to_paint",
  recipe: "cannot_set_recipe",
  tipOut: "nothing_to_tip_out",
  crate: "not_a_crate",
  way: "not_a_splitter",
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

/** Runs the yard on, a tick at a time, to `tick` or to where it stands still, moving the moment it stands for with it. */
export function stepTo(w: World, tick: number): void {
  const n = Math.max(0, Math.min(tick, stillAt(w)) - w.tick);
  for (let k = 0; k < n; k++) step(w);
  w.at += n * TICK_MS;
}

/** The tick a command is done at by Leaf's clock: its own, but none further than `LEAD` past the clock. */
const tickOf = (w: World, c: WorksCommand, now: number): number => Math.min(c.tick, clockOf(w, now) + LEAD);

/**
 * Runs a yard toward a tick, a tick at a time for as long as `more` says and never past where it
 * stands still, and says whether it has further to go.
 */
function runTo(w: World, tick: number, more: () => boolean): boolean {
  const to = Math.min(tick, stillAt(w));
  while (w.tick < to && more()) stepTo(w, w.tick + 1);
  return w.tick < to;
}

/**
 * Runs a yard toward `LEAD` short of Leaf's clock while `more` says, and says whether it has
 * further to go; or toward the tick a command is done at, whose news is what happened on the way.
 * What happened unwatched is no command's news.
 */
function runOn(w: World, now: number, more: () => boolean, c?: WorksCommand): boolean {
  if (c) return runTo(w, tickOf(w, c, now), more);
  const further = runTo(w, clockOf(w, now) - LEAD, more);
  drain(w);
  return further;
}

/**
 * Brings a yard to within `LEAD` of Leaf's clock. One standing still keeps Leaf's clock with it:
 * the time since is let go, and it starts again from its owner's next command.
 */
function advance(w: World, ctx: Ctx): World {
  runOn(w, ctx.now, () => true);
  if (w.tick >= stillAt(w)) w.at = ctx.now;
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

/**
 * The till paid in, and then a price taken. A price below nothing (a piece set down in the place
 * of a dearer one) gives the difference back, as taking the dearer one away would.
 */
function priced(w: World, price: number, reason: string): CoinChange[] {
  const paid = payIn(w);
  if (price < 0) return [...paid, change(w, -price, REASON.remove, true)];
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
    case "lay":
    case "stand": {
      const did = c.do === "lay" ? stand(w, c.legs, Infinity, true, c.turn) : stand(w, c.pieces, Infinity);
      return did.ok ? done(priced(w, did.cost, c.do === "lay" ? REASON.lay : REASON.build)) : no(c, did.why);
    }
    case "move": {
      const why = move(w, c.tiles, c.turns, c.x, c.y);
      return why === null ? done() : no(c, why);
    }
    case "remove":
    case "clear": {
      const did = c.do === "remove" ? remove(w, c.x, c.y) : clear(w, c.tiles);
      if (!did.ok) return no(c, did.why);
      return done(did.refund > 0 ? [change(w, did.refund, REASON.remove, true)] : []);
    }
    case "saveBlueprint": {
      const why = saveBlueprint(w, c.slot, c.tiles);
      return why === null ? done() : no(c, why);
    }
    case "deleteBlueprint":
      return deleteBlueprint(w, c.slot) ? done() : no(c, "There is no blueprint there");
    case "turn":
      return turn(w, c.x, c.y, c.dir) ? done() : no(c, "That cannot be turned");
    case "paint":
      return paint(w, c.x, c.y, c.tint) ? done() : no(c, "Nothing to paint here");
    case "recipe":
      return setRecipe(w, c.x, c.y, c.item) ? done() : no(c, "That cannot make it");
    case "tipOut":
      return tipOut(w, c.x, c.y, c.item) > 0 ? done() : no(c, "There is nothing to tip out");
    case "crate":
      return setOpen(w, c.x, c.y, c.open) ? done() : no(c, "There is no crate there");
    case "way":
      return setWay(w, c.x, c.y, c.way, c.open) ? done() : no(c, "There is no splitter there");
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
  w.seen = here(w);
  return { state: w, notes: drain(w), coins: did.coins, log: [...did.log, ...told(w)] };
}

// ---------- off the wire ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, most: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most;
/** The most legs a run may have, and the most tiles a command may name: every tile of the land. */
const TILES = 48 * 36;
/** The most orders an answer may say were hung: more than a board holds. */
const HUNG_MOST = 8;

/** A list of at most `most` pieces off the wire, or null. */
function piecesOf(v: unknown, most: number): Piece[] | null {
  if (!Array.isArray(v) || v.length > most) return null;
  const pieces = v.map((p) => readPiece(p)).filter((p) => p !== null);
  return pieces.length === v.length ? pieces : null;
}

/** What a command off the wire does, or null. */
function what(v: Record<string, unknown>): WorksAct | null {
  const spot = whole(v.x, 255) && whole(v.y, 255) ? { x: v.x, y: v.y } : null;
  const item = v.item === null ? null : isItem(v.item) ? v.item : undefined;
  const tiles =
    Array.isArray(v.tiles) && v.tiles.length <= TILES && v.tiles.every((t): t is number => whole(t, TILES - 1))
      ? v.tiles
      : null;
  const slot = whole(v.slot, BLUEPRINTS - 1) ? v.slot : null;
  switch (v.do) {
    case "build":
      return spot && isKind(v.kind) && isDir(v.dir) ? { do: "build", kind: v.kind, dir: v.dir, ...spot } : null;
    case "lay": {
      const legs = piecesOf(v.legs, TILES);
      if (!legs) return null;
      const t = v.turn;
      if (t === undefined) return { do: "lay", legs };
      if (!isRecord(t) || !whole(t.x, 255) || !whole(t.y, 255) || !isDir(t.dir)) return null;
      return { do: "lay", legs, turn: { x: t.x, y: t.y, dir: t.dir } };
    }
    case "stand": {
      const pieces = piecesOf(v.pieces, STAND_MOST);
      return pieces && { do: "stand", pieces };
    }
    case "move":
      return spot && tiles && isDir(v.turns) ? { do: "move", tiles, turns: v.turns, ...spot } : null;
    case "remove":
      return spot && { do: "remove", ...spot };
    case "clear":
      return tiles && { do: "clear", tiles };
    case "saveBlueprint":
      return tiles && slot !== null ? { do: "saveBlueprint", slot, tiles } : null;
    case "deleteBlueprint":
      return slot === null ? null : { do: "deleteBlueprint", slot };
    case "turn":
      return spot && isDir(v.dir) ? { do: "turn", dir: v.dir, ...spot } : null;
    case "paint":
      return spot && whole(v.tint, TINTS) ? { do: "paint", tint: v.tint, ...spot } : null;
    case "recipe":
    case "tipOut":
      return spot && item !== undefined ? { do: v.do, item, ...spot } : null;
    case "crate":
      return spot && typeof v.open === "boolean" ? { do: "crate", open: v.open, ...spot } : null;
    case "way":
      return spot && whole(v.way, 2) && typeof v.open === "boolean"
        ? { do: "way", way: v.way, open: v.open, ...spot }
        : null;
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

/** What Leaf answered a batch with, read back; null for anything these rules could not have made. */
export function readAnswer(v: unknown): WorksAnswer | null {
  if (!isRecord(v) || !whole(v.clock, 1e12) || !whole(v.tick, 1e12) || !whole(v.check, 0xffffffff)) return null;
  if (!Array.isArray(v.hung) || v.hung.length > HUNG_MOST) return null;
  const hung = v.hung.map(readStanding).filter((o) => o !== null);
  return hung.length === v.hung.length ? { clock: v.clock, tick: v.tick, check: v.check, hung } : null;
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

/** What the page is given of a yard: all of it but its stream, with what it did while its owner was away, and Leaf's tick now. */
const view = (w: World, ctx: Ctx): WorksView => ({
  yard: save({ ...w, seed: null, away: awayOf(w) }),
  clock: clockOf(w, ctx.now),
});

/** The Works, for Leaf's play service. */
export const WORKS: Game<World, WorksCommand, WorksView, WorksNote, WorksAnswer> = {
  id: "works",
  create: (ctx) => {
    const w = create({ seed: ctx.seed });
    w.at = ctx.now;
    return w;
  },
  advance,
  tend: (w, ctx, more, c) => runOn(w, ctx.now, more, c),
  // A tick further ahead than `LEAD` past Leaf's clock is done at `LEAD`.
  apply: (w, c, ctx) => play(w, { ...c, tick: tickOf(w, c, ctx.now) }),
  view,
  answer: (w, ctx) => ({
    clock: clockOf(w, ctx.now),
    tick: w.tick,
    check: check(w),
    hung: w.board.filter((o) => !counts(o, w.tick)),
  }),
  // A visitor is given what the owner is, but for the blueprints.
  visit: (w, ctx) => view({ ...w, blueprints: [] }, ctx),
  decode: (text) => load(text),
  encode: save,
  command: readCommand,
  // The Coins the yard has ever earned, from the depot and from orders, and how many story orders are done.
  standing: (w) => ({ score: Math.floor(w.sold + w.paid), also: { story: w.story } }),
  // A model of each capstone the depot has taken in, for the member's camp.
  awards: (w) => postcard(w).trophies.map((k) => `model-${k}`),
};
