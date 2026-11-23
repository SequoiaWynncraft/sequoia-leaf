/**
 * The Works as Leaf plays it, as today's yard does: Leaf owns the yard, its clock and its Coins; the
 * page holds a copy and runs it ahead with the same rules. A yard holds `tick` and `at`, the moment
 * of Leaf's clock that tick stands for; every command carries the tick the page's copy stood at and
 * is done at that tick. Coins are the ledger's: each change is keyed by the yard's `bank`.
 */
import { type CoinChange, type Ctx, type Done, type Game, LOGGED, type Logged, type Refused } from "@sequoia-leaf/core";

import {
  at,
  build,
  buyPlan,
  buyPlot,
  type Dir,
  isDir,
  remove,
  setOpen,
  setRecipe,
  setWay,
  tipOut,
  turn,
} from "./build.ts";
import { awayOf, here, stillAt, TICK_MS } from "./clock.ts";
import { decode, encode } from "./codec.ts";
import { BLUEPRINTS, SPAN, STAND_MOST } from "./content/machines.ts";
import { STORY } from "./content/story.ts";
import { LAND, type Land } from "./land.ts";
import { paint } from "./lines.ts";
import { claim, fillBoard, swap } from "./orders.ts";
import { clear, deleteBlueprint, keptOf, move, type Piece, saveBlueprint, stand, TINTS } from "./pieces.ts";
import {
  DEPOT,
  type Item,
  itemNamed,
  type Kind,
  kindNamed,
  type Plan,
  planName,
  planNamed,
  type Plot,
  plotName,
  plotNamed,
} from "./tables.ts";
import { step } from "./tick.ts";
import { collect, drain, emptyYard, type News, type Yard } from "./yard.ts";

/** How far behind Leaf's clock `advance` leaves a yard, in ticks; and how far ahead a command may be done. */
export const LEAD = 30;

interface At {
  readonly x: number;
  readonly y: number;
}

/** Everything a player does to the yard, with things, kinds, plots and plans as numbers. */
export type Act =
  | ({ readonly do: "build"; readonly kind: Kind; readonly dir: Dir } & At)
  | { readonly do: "lay"; readonly legs: readonly Piece[]; readonly turn?: At & { readonly dir: Dir } }
  | { readonly do: "stand"; readonly pieces: readonly Piece[] }
  | ({ readonly do: "move"; readonly tiles: readonly number[]; readonly turns: Dir } & At)
  | ({ readonly do: "remove" } & At)
  | { readonly do: "clear"; readonly tiles: readonly number[] }
  | { readonly do: "saveBlueprint"; readonly slot: number; readonly tiles: readonly number[] }
  | { readonly do: "deleteBlueprint"; readonly slot: number }
  | ({ readonly do: "turn"; readonly dir: Dir } & At)
  | ({ readonly do: "paint"; readonly tint: number } & At)
  | ({ readonly do: "recipe"; readonly item: Item | null } & At)
  | ({ readonly do: "tipOut"; readonly item: Item | null } & At)
  | ({ readonly do: "crate"; readonly open: boolean } & At)
  | ({ readonly do: "way"; readonly way: number; readonly open: boolean } & At)
  | { readonly do: "buyPlot"; readonly plot: Plot }
  | { readonly do: "buyPlan"; readonly plan: Plan }
  | { readonly do: "swap"; readonly order: number }
  | { readonly do: "handOver"; readonly order: number }
  | { readonly do: "collect" };

/** A command: what the player did, and the tick the page's copy stood at when they did it. */
export type Command = Act & { readonly tick: number };

/** What the page is given: the yard as kept, without its seed, with its letter, and Leaf's tick now. */
export interface View {
  readonly yard: string;
  readonly clock: number;
}

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

/** A new yard: the depot in the middle, a few pieces to hand, seeded; `story` orders done already, for trying later parts. */
export function create(opts: { readonly seed?: number; readonly land?: Land; readonly story?: number } = {}): Yard {
  const y = emptyYard(opts.land ?? LAND, opts.story ?? 0);
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

function change(y: Yard, amount: number, reason: string, free: boolean): CoinChange {
  const key = `bank:${y.bank++}`;
  return free ? { amount, reason, key, free: true } : { amount, reason, key };
}
function payIn(y: Yard): CoinChange[] {
  const coins = collect(y);
  return coins > 0 ? [change(y, coins, REASON.till, true)] : [];
}
function priced(y: Yard, price: number, reason: string): CoinChange[] {
  const paid = payIn(y);
  if (price < 0) return [...paid, change(y, -price, REASON.remove, true)];
  return price > 0 ? [...paid, change(y, -price, reason, false)] : paid;
}

type Did = { readonly coins: CoinChange[]; readonly log: Logged[] } | Turned;
const no = (c: { readonly do: keyof typeof REFUSED }, why: string): Turned => ({ refused: REFUSED[c.do], why });
const done = (coins: CoinChange[] = [], log: Logged[] = []): Did => ({ coins, log });

/** Does a command to a yard already at its tick. Nothing is changed unless it is done. */
function act(y: Yard, c: Command): Did {
  switch (c.do) {
    case "build": {
      const did = build(y, c.kind, c.x, c.y, c.dir, Infinity);
      return did.ok ? done(priced(y, did.cost, REASON.build)) : no(c, did.why);
    }
    case "lay":
    case "stand": {
      const did = c.do === "lay" ? stand(y, c.legs, Infinity, true, c.turn) : stand(y, c.pieces, Infinity);
      return did.ok ? done(priced(y, did.cost, c.do === "lay" ? REASON.lay : REASON.build)) : no(c, did.why);
    }
    case "move": {
      const why = move(y, c.tiles, c.turns, c.x, c.y);
      return why === null ? done() : no(c, why);
    }
    case "remove":
    case "clear": {
      const did = c.do === "remove" ? remove(y, c.x, c.y) : clear(y, c.tiles);
      if (!did.ok) return no(c, did.why);
      return done(did.refund > 0 ? [change(y, did.refund, REASON.remove, true)] : []);
    }
    case "saveBlueprint": {
      const why = saveBlueprint(y, c.slot, c.tiles);
      return why === null ? done() : no(c, why);
    }
    case "deleteBlueprint":
      return deleteBlueprint(y, c.slot) ? done() : no(c, "There is no blueprint there");
    case "turn":
      return turn(y, c.x, c.y, c.dir) ? done() : no(c, "That cannot be turned");
    case "paint":
      return paint(y, at(y, c.x, c.y), c.tint) ? done() : no(c, "Nothing to paint here");
    case "recipe":
      return setRecipe(y, c.x, c.y, c.item) ? done() : no(c, "That cannot make it");
    case "tipOut":
      return tipOut(y, c.x, c.y, c.item) > 0 ? done() : no(c, "There is nothing to tip out");
    case "crate":
      return setOpen(y, c.x, c.y, c.open) ? done() : no(c, "There is no crate there");
    case "way":
      return setWay(y, c.x, c.y, c.way, c.open) ? done() : no(c, "There is no splitter there");
    case "buyPlot": {
      const did = buyPlot(y, c.plot, Infinity);
      if (!did.ok) return no(c, did.why);
      return done(priced(y, did.cost, REASON.buyPlot), [
        { kind: LOGGED.worksPlot, data: { plot: plotName(c.plot), price: did.cost } },
      ]);
    }
    case "buyPlan": {
      const did = buyPlan(y, c.plan, Infinity);
      if (!did.ok) return no(c, did.why);
      return done(priced(y, did.cost, REASON.buyPlan), [
        { kind: LOGGED.worksPlan, data: { plan: planName(c.plan), price: did.cost } },
      ]);
    }
    case "swap":
      return swap(y, c.order) ? done() : no(c, "That order cannot be swapped just now");
    case "handOver": {
      const order = y.board.find((o) => o.id === c.order);
      const pay = claim(y, c.order);
      if (pay === null || !order) return no(c, "That order is not filled");
      return done([], [{ kind: LOGGED.worksOrder, data: { order: order.id, title: order.title, pay } }]);
    }
    case "collect":
      y.away = null;
      return done(payIn(y));
  }
}

/** The story orders finished since the yard last logged one. */
function told(y: Yard): Logged[] {
  const log = STORY.slice(y.told, y.story).map((o, k): Logged => ({
    kind: LOGGED.worksStory,
    data: { order: y.told + k + 1, title: o.title, pay: o.pay },
  }));
  y.told = y.story;
  return log;
}

/** Does a command at its tick: the yard is run on to it, then the command is done or refused. */
export function play(y: Yard, c: Command): Done<Yard, News> | Turned {
  stepTo(y, c.tick);
  const did = act(y, c);
  if ("refused" in did) return did;
  y.seen = here(y);
  return { state: y, notes: drain(y), coins: did.coins, log: [...did.log, ...told(y)] };
}

// ---------- off the wire ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, most: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most;
/** The most tiles a command may name: every tile of the guild's land. */
const TILES = LAND.w * LAND.h;

/** A piece read off the wire (or out of a kept record), every field checked, on a tile up to (`mx`, `my`); or nothing. */
export function readPiece(v: unknown, mx = 255, my = 255): Piece | null {
  if (!isRecord(v)) return null;
  const k = kindNamed(v.kind);
  if (k === null || k === DEPOT || !isDir(v.dir)) return null;
  if (!whole(v.x, mx) || !whole(v.y, my) || !whole(v.span, SPAN)) return null;
  const recipe = itemNamed(v.recipe);
  return { kind: k, x: v.x, y: v.y, dir: v.dir, span: v.span, ...keptOf({ ...v, recipe: recipe ?? undefined }, k) };
}

function piecesOf(v: unknown, most: number): Piece[] | null {
  if (!Array.isArray(v) || v.length > most) return null;
  const pieces = v.map((p) => readPiece(p)).filter((p) => p !== null);
  return pieces.length === v.length ? pieces : null;
}

function what(v: Record<string, unknown>): Act | null {
  const spot = whole(v.x, 255) && whole(v.y, 255) ? { x: v.x, y: v.y } : null;
  const item = v.item === null ? null : (itemNamed(v.item) ?? undefined);
  const tiles =
    Array.isArray(v.tiles) && v.tiles.length <= TILES && v.tiles.every((t): t is number => whole(t, TILES - 1))
      ? v.tiles
      : null;
  const slot = whole(v.slot, BLUEPRINTS - 1) ? v.slot : null;
  switch (v.do) {
    case "build": {
      const k = kindNamed(v.kind);
      return spot && k !== null && isDir(v.dir) ? { do: "build", kind: k, dir: v.dir, ...spot } : null;
    }
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
    case "buyPlot": {
      const p = plotNamed(v.plot);
      return p === null ? null : { do: "buyPlot", plot: p };
    }
    case "buyPlan": {
      const p = planNamed(v.plan);
      return p === null ? null : { do: "buyPlan", plan: p };
    }
    case "swap":
    case "handOver":
      return whole(v.order, 1e9) ? { do: v.do, order: v.order } : null;
    case "collect":
      return { do: "collect" };
    default:
      return null;
  }
}

/** A command off the wire, every field checked, or null. Fields it does not use are let be. */
export function readCommand(v: unknown): Command | null {
  if (!isRecord(v) || !whole(v.tick, 1e12)) return null;
  const rest = what(v);
  return rest && { ...rest, tick: v.tick };
}

const view = (y: Yard, ctx: Ctx, blueprints = true): View => ({
  yard: encode(y, { seed: false, away: awayOf(y), blueprints }),
  clock: clockOf(y, ctx.now),
});

/** The two things that take the whole yard, by the names the town knows them by. */
const CAPSTONES = ["crab", "beacon"] as const;

/** The Works on flat data, for Leaf's play service. */
export const FACTORY: Game<Yard, Command, View, News> = {
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
  visit: (y, ctx) => view(y, ctx, false),
  decode: (text) => decode(text),
  encode: (y) => encode(y),
  command: readCommand,
  standing: (y) => ({ score: Math.floor(y.sold + y.paid), also: { story: y.story } }),
  awards: (y) => CAPSTONES.filter((name) => (y.depot[itemNamed(name) ?? 0] ?? 0) > 0).map((k) => `model-${k}`),
};
