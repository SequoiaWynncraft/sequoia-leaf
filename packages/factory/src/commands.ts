/**
 * Every command a player gives the yard, in one table (`COMMANDS`): for each, what it needs
 * unlocked, the code it is refused with, how it is read off the wire (each field checked), how it is
 * written onto it, and what it does to a yard at its tick. A new command is one entry here.
 *
 * On the wire things, kinds, plots and goals go by their names; everywhere else they are numbers.
 */
import { LOGGED } from "@sequoia-leaf/core";

import {
  at,
  build,
  buyPlot,
  type Dir,
  fell,
  isDir,
  remove,
  setFirst,
  setIn,
  setOpen,
  setRecipe,
  setSide,
  setSort,
  setWay,
  tipOut,
  turn,
} from "./build.ts";
import { clearRefusal, handClearing, isStart, stopClearing, takeClearing } from "./clearing.ts";
import { isCode, pasteBlueprint } from "./code.ts";
import { STAND_MOST } from "./content/machines.ts";
import { type Did, done, doneUnless, payIn, priced, refunded, spent, type Turned } from "./did.ts";
import {
  type At,
  type Fields,
  fieldsOf,
  gradeOf,
  isRecord,
  legOnWire,
  listOf,
  named,
  nodeOf,
  orderOf,
  readLeg,
  readPiece,
  researchOf,
  TILES,
  whole,
} from "./fields.ts";
import { after, before, isId, undo } from "./history.ts";
import { RULES } from "./kinds/list.ts";
import { paint } from "./lines.ts";
import {
  claim,
  queue,
  queueRefusal,
  study,
  studyRefusal,
  swap,
  takeNode,
  takeRefusal,
  unqueue,
  unstudy,
} from "./orders.ts";
import { blueprintAt, clear, copyOf, deleteBlueprint, move, type Piece, saveBlueprint, stand } from "./pieces.ts";
import { type Raise, upgradeAs } from "./raised.ts";
import { REASON } from "./reasons.ts";
import { type Leg, legPiece } from "./route.ts";
import {
  type Goal,
  GOALS,
  type Item,
  itemName,
  type Kind,
  kindName,
  kindNamed,
  type Lock,
  locked,
  type Plot,
  plotName,
  plotNamed,
  TINTS,
} from "./tables.ts";
import { placeYard, saveYard } from "./whole.ts";
import type { Yard } from "./yard.ts";

/** What each command carries, by its name. */
interface Carries {
  build: At & { readonly kind: Kind; readonly dir: Dir; readonly grade: number; readonly right?: boolean };
  lay: { readonly legs: readonly Leg[]; readonly turn?: At & { readonly dir: Dir } };
  stand: { readonly pieces: readonly Piece[] };
  placeBlueprint: At & { readonly slot: number; readonly turns: Dir };
  move: At & { readonly tiles: readonly number[]; readonly turns: Dir };
  copy: At & { readonly tiles: readonly number[]; readonly turns: Dir };
  remove: At;
  clear: { readonly tiles: readonly number[] };
  /** With `grade`, raised to it, not the highest; for one tile (a card's Upgrade) with no tool. */
  upgrade: { readonly tiles: readonly number[]; readonly raise?: Raise };
  saveBlueprint: { readonly slot: number; readonly tiles: readonly number[] };
  /** Every piece in the yard, as a plan of the whole yard (`whole.ts`). */
  saveYard: { readonly slot: number };
  /** A blueprint's code, as pasted (`code.ts`): the rules read it. */
  pasteBlueprint: { readonly slot: number; readonly code: string };
  deleteBlueprint: { readonly slot: number };
  turn: At & { readonly dir: Dir };
  /** `onto`: the stroke this adds to, by its first command's id: the newest entry (`history.ts`). */
  paint: At & { readonly tint: number; readonly onto?: string };
  recipe: At & { readonly item: Item | null };
  sort: At & { readonly item: Item | null };
  side: At & { readonly right: boolean };
  tipOut: At & { readonly item: Item | null };
  crate: At & { readonly open: boolean };
  way: At & { readonly way: number; readonly open: boolean };
  first: At & { readonly way: number | null };
  wayIn: At & { readonly way: number; readonly on: boolean };
  /** At the price the player was shown: refused if it is not the price now. */
  buyPlot: { readonly plot: Plot; readonly price: number };
  /**
   * Takes on clearing a plot; hands the clearing over once it has all it wants; or stops it
   * (`clearing.ts`): each of the last two by the clearing's plot and the number it was begun as,
   * refused if that is not the clearing being done.
   */
  clearPlot: { readonly plot: Plot };
  handClearing: { readonly plot: Plot; readonly start: string };
  stopClearing: { readonly plot: Plot; readonly start: string };
  /** Any tile of the redwood. */
  fell: At;
  take: { readonly node: Goal };
  queue: { readonly node: Goal };
  unqueue: { readonly node: Goal };
  study: { readonly research: Goal };
  unstudy: { readonly research: Goal };
  swap: { readonly order: number };
  handOver: { readonly order: number };
  // Nothing: it pays the till in.
  collect: object;
  /**
   * `entry`: the newest entry, as the page shows it, by the id of the command that made it. On the
   * wire `id` is each command's own, so the entry has a name of its own.
   */
  undo: { readonly entry: string };
}
type Name = keyof Carries;

/** One command, with things, kinds, plots and goals as numbers. */
export type ActOf<D extends Name> = { readonly do: D } & Carries[D];
/** Everything a player does to the yard. */
export type Act = { [D in Name]: ActOf<D> }[Name];

/** A command as it goes on the wire: what was done, with every thing, kind, plot and goal by its name. */
export type Wired = { readonly do: Act["do"]; readonly [field: string]: unknown };

/** The code a command is refused with when it needs what the yard has not unlocked: a tool, or putting a way first. */
export const LOCKED = "locked";

const goalId = (g: Goal): string => GOALS[g]?.id ?? "";

/** One command's entry in the table. */
interface Spec<D extends Name> {
  /** The code it is refused with, but for wanting an unlock (`LOCKED`); none for one never refused. */
  readonly refused: string | null;
  /** What it needs unlocked (asked of `locked`): its tool, or putting a way first. */
  readonly lock?: (a: ActOf<D>) => Lock | null;
  /** Reads it off the wire, every field checked; null for anything else. */
  readonly read: (v: Record<string, unknown>, f: Fields) => ActOf<D> | null;
  /** What it carries as the wire names it. */
  readonly write: (a: ActOf<D>) => Record<string, unknown>;
  /** Does it to a yard at its tick, with `coins` to spend (the purse's and the till's whole Coins), its id `id` ("" for none). Nothing changes unless it is done. */
  readonly act: (y: Yard, a: ActOf<D>, coins: number, no: (why: string) => Turned, id: string) => Did;
}

const needs = (lock: Lock) => (): Lock | null => lock;
const spot = ({ x, y }: At): Record<string, unknown> => ({ x, y });
/** Reads a tile and a thing (or none), for a command that sets a thing on a piece. */
const itemAt =
  <D extends "recipe" | "sort" | "tipOut">(name: D) =>
  (_v: Record<string, unknown>, f: Fields): ActOf<D> | null =>
    f.spot && f.item !== undefined ? { do: name, ...f.spot, item: f.item } : null;
const writeItem = (a: At & { readonly item: Item | null }): Record<string, unknown> => ({
  item: a.item === null ? null : itemName(a.item),
  ...spot(a),
});

/** Reads a command for one clearing: its plot, and its name (`start`, not `id`, which on the wire is each command's own). */
const oneClearing =
  <D extends "handClearing" | "stopClearing">(name: D) =>
  (v: Record<string, unknown>): ActOf<D> | null => {
    const plot = plotNamed(v.plot);
    return plot !== null && isStart(v.start) ? { do: name, plot, start: v.start } : null;
  };
const writeClearing = (a: { readonly plot: Plot; readonly start: string }): Record<string, unknown> => ({
  plot: plotName(a.plot),
  start: a.start,
});

/** Every command, by its name. */
export const COMMANDS: { readonly [D in Name]: Spec<D> } = {
  build: {
    refused: "cannot_build",
    read: (v, f) => {
      const k = kindNamed(v.kind);
      const grade = gradeOf(v.grade);
      // Which side a sorter sends to is said for a kind that has a side alone, and kept as it is where it is not said.
      const side = k !== null && RULES[k]?.set.side && typeof v.right === "boolean" ? { right: v.right } : {};
      return f.spot && k !== null && isDir(v.dir) && grade !== null
        ? { do: "build", kind: k, dir: v.dir, grade, ...side, ...f.spot }
        : null;
    },
    write: (a) => ({
      kind: kindName(a.kind),
      ...spot(a),
      dir: a.dir,
      ...(a.grade === 1 ? {} : { grade: a.grade }),
      ...(a.right === undefined ? {} : { right: a.right }),
    }),
    act: (y, a, coins, no) => {
      const did = build(y, a.kind, a.x, a.y, a.dir, coins, {
        grade: a.grade,
        ...(a.right === undefined ? {} : { right: a.right }),
      });
      return did.ok ? done(priced(y, did.cost, REASON.build)) : no(did.why);
    },
  },
  lay: {
    refused: "cannot_lay",
    read: (v) => {
      const legs = listOf(v.legs, TILES, readLeg);
      if (!legs) return null;
      const t = v.turn;
      if (t === undefined) return { do: "lay", legs };
      if (!isRecord(t) || !whole(t.x, 255) || !whole(t.y, 255) || !isDir(t.dir)) return null;
      return { do: "lay", legs, turn: { x: t.x, y: t.y, dir: t.dir } };
    },
    write: (a) => ({
      legs: a.legs.map(legOnWire),
      ...(a.turn ? { turn: { x: a.turn.x, y: a.turn.y, dir: a.turn.dir } } : {}),
    }),
    act: (y, a, coins, no) => {
      // A run stands its legs as pieces made of what a leg holds, and nothing else.
      const did = stand(y, a.legs.map(legPiece), coins, true, a.turn);
      return did.ok ? done(priced(y, did.cost, REASON.lay)) : no(did.why);
    },
  },
  stand: {
    refused: "cannot_stand",
    // One piece stood is a piece built: it is of no tool.
    lock: (a) => (a.pieces.length === 1 ? null : { use: "select" }),
    read: (v) => {
      const pieces = listOf(v.pieces, STAND_MOST, (p) => readPiece(p));
      return pieces && { do: "stand", pieces };
    },
    write: (a) => ({ pieces: a.pieces.map(named) }),
    act: (y, a, coins, no) => {
      const did = stand(y, a.pieces, coins);
      return did.ok ? done(priced(y, did.cost, REASON.build)) : no(did.why);
    },
  },
  placeBlueprint: {
    refused: "cannot_place_blueprint",
    lock: needs({ use: "select" }),
    read: (v, f) =>
      f.spot && f.slot !== null && isDir(v.turns)
        ? { do: "placeBlueprint", slot: f.slot, turns: v.turns, ...f.spot }
        : null,
    write: (a) => ({ slot: a.slot, turns: a.turns, ...spot(a) }),
    act: (y, a, coins, no) => {
      const print = y.blueprints[a.slot];
      // A plan of the whole yard goes back where it was taken, however it is aimed, and makes the yard its layout.
      if (print?.whole) {
        const did = placeYard(y, print, coins);
        return did.ok ? done(priced(y, did.cost, REASON.build, REASON.remove)) : no(did.why);
      }
      const pieces = blueprintAt(y, a.slot, a.turns, a.x, a.y);
      if (!pieces) return no("There is no blueprint there");
      const did = stand(y, pieces, coins);
      return did.ok ? done(priced(y, did.cost, REASON.build)) : no(did.why);
    },
  },
  move: {
    refused: "cannot_move",
    lock: needs({ use: "select" }),
    read: (v, f) =>
      f.spot && f.tiles && isDir(v.turns) ? { do: "move", tiles: f.tiles, turns: v.turns, ...f.spot } : null,
    write: (a) => ({ tiles: a.tiles, turns: a.turns, ...spot(a) }),
    act: (y, a, _coins, no) => doneUnless(move(y, a.tiles, a.turns, a.x, a.y), no),
  },
  copy: {
    refused: "cannot_copy",
    lock: needs({ use: "select" }),
    read: (v, f) =>
      f.spot && f.tiles && isDir(v.turns) ? { do: "copy", tiles: f.tiles, turns: v.turns, ...f.spot } : null,
    write: (a) => ({ tiles: a.tiles, turns: a.turns, ...spot(a) }),
    act: (y, a, coins, no) => {
      const pieces = copyOf(y, a.tiles, a.turns, a.x, a.y);
      if (!pieces) return no("There is nothing here to copy");
      const did = stand(y, pieces, coins);
      return did.ok ? done(priced(y, did.cost, REASON.build)) : no(did.why);
    },
  },
  remove: {
    refused: "nothing_to_take_away",
    read: (_v, f) => f.spot && { do: "remove", ...f.spot },
    write: spot,
    act: (y, a, _coins, no) => refunded(y, remove(y, a.x, a.y), no),
  },
  clear: {
    refused: "nothing_to_clear",
    lock: needs({ use: "select" }),
    read: (_v, f) => f.tiles && { do: "clear", tiles: f.tiles },
    write: (a) => ({ tiles: a.tiles }),
    act: (y, a, _coins, no) => refunded(y, clear(y, a.tiles), no),
  },
  upgrade: {
    refused: "cannot_upgrade",
    lock: (a) => (a.raise && a.tiles.length === 1 ? null : { use: "upgrade" }),
    read: (_v, f) => f.tiles && f.raise && { do: "upgrade", tiles: f.tiles, ...f.raise },
    write: ({ tiles, raise: r }) => ({ tiles, ...(r && { grade: r.grade, kind: kindName(r.kind), from: r.from }) }),
    act: (y, a, coins, no) => spent(y, upgradeAs(y, a.tiles, coins, a.raise), REASON.upgrade, no),
  },
  saveBlueprint: {
    refused: "cannot_save_blueprint",
    lock: needs({ blueprint: 0 }),
    read: (_v, f) => (f.tiles && f.slot !== null ? { do: "saveBlueprint", slot: f.slot, tiles: f.tiles } : null),
    write: (a) => ({ slot: a.slot, tiles: a.tiles }),
    act: (y, a, _coins, no) => doneUnless(saveBlueprint(y, a.slot, a.tiles), no),
  },
  saveYard: {
    refused: "cannot_save_blueprint",
    lock: needs({ use: "whole" }),
    read: (_v, f) => (f.slot === null ? null : { do: "saveYard", slot: f.slot }),
    write: (a) => ({ slot: a.slot }),
    act: (y, a, _coins, no) => doneUnless(saveYard(y, a.slot), no),
  },
  pasteBlueprint: {
    refused: "cannot_paste_blueprint",
    lock: needs({ blueprint: 0 }),
    read: (v, f) => (f.slot !== null && isCode(v.code) ? { do: "pasteBlueprint", slot: f.slot, code: v.code } : null),
    write: (a) => ({ slot: a.slot, code: a.code }),
    act: (y, a, _coins, no) => doneUnless(pasteBlueprint(y, a.slot, a.code), no),
  },
  deleteBlueprint: {
    refused: "no_blueprint",
    read: (_v, f) => (f.slot === null ? null : { do: "deleteBlueprint", slot: f.slot }),
    write: (a) => ({ slot: a.slot }),
    act: (y, a, _coins, no) => (deleteBlueprint(y, a.slot) ? done() : no("There is no blueprint there")),
  },
  turn: {
    refused: "cannot_turn",
    read: (v, f) => (f.spot && isDir(v.dir) ? { do: "turn", dir: v.dir, ...f.spot } : null),
    write: (a) => ({ dir: a.dir, ...spot(a) }),
    act: (y, a, _coins, no) => (turn(y, a.x, a.y, a.dir) ? done() : no("That cannot be turned")),
  },
  paint: {
    refused: "nothing_to_paint",
    lock: needs({ use: "paint" }),
    read: (v, f) =>
      f.spot && whole(v.tint, TINTS) && (v.onto === undefined || isId(v.onto))
        ? { do: "paint", tint: v.tint, ...(v.onto === undefined ? {} : { onto: v.onto }), ...f.spot }
        : null,
    write: (a) => ({ tint: a.tint, ...spot(a), ...(a.onto === undefined ? {} : { onto: a.onto }) }),
    act: (y, a, _coins, no) => (paint(y, at(y, a.x, a.y), a.tint) ? done() : no("Nothing to paint here")),
  },
  recipe: {
    refused: "cannot_set_recipe",
    read: itemAt("recipe"),
    write: writeItem,
    act: (y, a, _coins, no) => doneUnless(setRecipe(y, a.x, a.y, a.item), no),
  },
  sort: {
    refused: "not_a_sorter",
    read: itemAt("sort"),
    write: writeItem,
    act: (y, a, _coins, no) => (setSort(y, a.x, a.y, a.item) ? done() : no("There is no sorter there")),
  },
  side: {
    refused: "not_a_sorter",
    read: (v, f) => (f.spot && typeof v.right === "boolean" ? { do: "side", right: v.right, ...f.spot } : null),
    write: (a) => ({ right: a.right, ...spot(a) }),
    act: (y, a, _coins, no) => (setSide(y, a.x, a.y, a.right) ? done() : no("There is no sorter there")),
  },
  tipOut: {
    refused: "nothing_to_tip_out",
    read: itemAt("tipOut"),
    write: writeItem,
    act: (y, a, _coins, no) => (tipOut(y, a.x, a.y, a.item) > 0 ? done() : no("There is nothing to tip out")),
  },
  crate: {
    refused: "not_a_crate",
    read: (v, f) => (f.spot && typeof v.open === "boolean" ? { do: "crate", open: v.open, ...f.spot } : null),
    write: (a) => ({ open: a.open, ...spot(a) }),
    act: (y, a, _coins, no) => (setOpen(y, a.x, a.y, a.open) ? done() : no("There is no crate there")),
  },
  way: {
    refused: "not_a_splitter",
    read: (v, f) =>
      f.spot && whole(v.way, 2) && typeof v.open === "boolean"
        ? { do: "way", way: v.way, open: v.open, ...f.spot }
        : null,
    write: (a) => ({ way: a.way, open: a.open, ...spot(a) }),
    act: (y, a, _coins, no) => (setWay(y, a.x, a.y, a.way, a.open) ? done() : no("There is no splitter there")),
  },
  first: {
    refused: "cannot_put_first",
    lock: needs({ first: true }),
    read: (v, f) => (f.spot && (v.way === null || whole(v.way, 2)) ? { do: "first", way: v.way, ...f.spot } : null),
    write: (a) => ({ way: a.way, ...spot(a) }),
    act: (y, a, _coins, no) => doneUnless(setFirst(y, a.x, a.y, a.way), no),
  },
  wayIn: {
    refused: "not_a_splitter",
    lock: needs({ ins: true }),
    read: (v, f) =>
      f.spot && whole(v.way, 2) && typeof v.on === "boolean" ? { do: "wayIn", way: v.way, on: v.on, ...f.spot } : null,
    write: (a) => ({ way: a.way, on: a.on, ...spot(a) }),
    act: (y, a, _coins, no) => (setIn(y, a.x, a.y, a.way, a.on) ? done() : no("There is no splitter there")),
  },
  buyPlot: {
    refused: "plot_not_for_sale",
    read: (v) => {
      const p = plotNamed(v.plot);
      return p === null || !whole(v.price, Number.MAX_SAFE_INTEGER) ? null : { do: "buyPlot", plot: p, price: v.price };
    },
    write: (a) => ({ plot: plotName(a.plot), price: a.price }),
    act: (y, a, coins, no) => {
      const did = buyPlot(y, a.plot, a.price, coins);
      if (!did.ok) return no(did.why);
      return done(priced(y, did.cost, REASON.buyPlot), [
        { kind: LOGGED.worksPlot, data: { plot: plotName(a.plot), price: did.cost } },
      ]);
    },
  },
  clearPlot: {
    refused: "cannot_clear",
    read: (v) => {
      const p = plotNamed(v.plot);
      return p === null ? null : { do: "clearPlot", plot: p };
    },
    write: (a) => ({ plot: plotName(a.plot) }),
    act: (y, a, _coins, no, id) => doneUnless(clearRefusal(y, a.plot), no, () => takeClearing(y, a.plot, id)),
  },
  handClearing: {
    refused: "not_cleared",
    read: oneClearing("handClearing"),
    write: writeClearing,
    act: (y, a, _coins, no) => doneUnless(handClearing(y, a.plot, a.start), no),
  },
  stopClearing: {
    refused: "not_clearing",
    read: oneClearing("stopClearing"),
    write: writeClearing,
    act: (y, a, _coins, no) => doneUnless(stopClearing(y, a.plot, a.start), no),
  },
  fell: {
    refused: "cannot_fell",
    lock: needs({ fell: true }),
    read: (_v, f) => f.spot && { do: "fell", ...f.spot },
    write: spot,
    act: (y, a, coins, no) => spent(y, fell(y, a.x, a.y, coins), REASON.fell, no),
  },
  take: {
    refused: "cannot_take",
    read: (v) => nodeOf(v, "take"),
    write: (a) => ({ node: goalId(a.node) }),
    act: (y, a, _coins, no) => doneUnless(takeRefusal(y, a.node), no, () => takeNode(y, a.node)),
  },
  queue: {
    refused: "cannot_queue",
    read: (v) => nodeOf(v, "queue"),
    write: (a) => ({ node: goalId(a.node) }),
    act: (y, a, _coins, no) => doneUnless(queueRefusal(y, a.node), no, () => queue(y, a.node)),
  },
  unqueue: {
    refused: "not_queued",
    read: (v) => nodeOf(v, "unqueue"),
    write: (a) => ({ node: goalId(a.node) }),
    act: (y, a, _coins, no) => (unqueue(y, a.node) ? done() : no("That is not in the line")),
  },
  study: {
    refused: "cannot_study",
    read: (v) => researchOf(v, "study"),
    write: (a) => ({ research: goalId(a.research) }),
    act: (y, a, _coins, no) => doneUnless(studyRefusal(y, a.research), no, () => study(y, a.research)),
  },
  unstudy: {
    refused: "not_studied",
    read: (v) => researchOf(v, "unstudy"),
    write: (a) => ({ research: goalId(a.research) }),
    act: (y, a, _coins, no) => (unstudy(y, a.research) ? done() : no("That is not in the line")),
  },
  swap: {
    refused: "cannot_swap",
    read: (v) => orderOf(v, "swap"),
    write: (a) => ({ order: a.order }),
    act: (y, a, _coins, no) => (swap(y, a.order) ? done() : no("That order cannot be swapped just now")),
  },
  handOver: {
    refused: "not_filled",
    read: (v) => orderOf(v, "handOver"),
    write: (a) => ({ order: a.order }),
    act: (y, a, _coins, no) => {
      const order = y.board.find((o) => o.id === a.order);
      const pay = claim(y, a.order);
      if (pay === null || !order) return no("That order is not filled");
      return done([], [{ kind: LOGGED.worksOrder, data: { order: order.id, title: order.title, pay } }]);
    },
  },
  collect: {
    refused: null,
    read: () => ({ do: "collect" }),
    write: () => ({}),
    act: (y) => {
      y.away = null;
      return done(payIn(y));
    },
  },
  undo: {
    refused: "cannot_undo",
    read: (v) => (isId(v.entry) ? { do: "undo", entry: v.entry } : null),
    write: (a) => ({ entry: a.entry }),
    act: (y, a, coins, no) => {
      const did = undo(y, a.entry, coins);
      // What the command cost comes back free, as given back; what it gave back is taken, as a price is.
      return did.ok ? done(priced(y, -did.coins, REASON.undo, REASON.undo)) : no(did.why);
    },
  },
};

/** The code each command is refused with, but for wanting an unlock, by name: every command but those never refused. */
export const REFUSED: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(COMMANDS).flatMap(([name, spec]) => (spec.refused === null ? [] : [[name, spec.refused]])),
);

const isName = (v: unknown): v is Name => typeof v === "string" && Object.hasOwn(COMMANDS, v);

/** Does one command, as its entry has it: refused `LOCKED` first if the yard has not unlocked what it needs. */
function actOne<D extends Name>(y: Yard, a: ActOf<D>, coins: number, id: string): Did {
  const spec: Spec<D> = COMMANDS[a.do];
  const lock = spec.lock?.(a) ?? null;
  const why = lock === null ? null : locked(y.open, lock);
  if (why !== null) return { refused: LOCKED, why };
  return spec.act(y, a, coins, (said) => ({ refused: spec.refused ?? LOCKED, why: said }), id);
}

/**
 * Does a command (its id `id`) to a yard already at its tick, with `coins` to spend. Nothing is changed
 * unless it is done; done, what Undo would need to undo it is kept under its id, or the history
 * forgotten (`history.ts`).
 */
export function act(y: Yard, a: Act, coins: number, id = ""): Did {
  const was = before(y, a);
  const did = actOne(y, a, coins, id);
  if (!("refused" in did)) after(y, a, was, did.coins, id);
  return did;
}

/** A command's act off the wire, every field checked; null for anything else. Fields it does not use are let be. */
export function readAct(v: Record<string, unknown>): Act | null {
  const name = v.do;
  return isName(name) ? COMMANDS[name].read(v, fieldsOf(v)) : null;
}

/** What goes on the wire for an act: `readCommand` reads it back, with its tick, as the same act. */
export const writeAct = (a: Act): Wired => writeOne(a);
function writeOne<D extends Name>(a: ActOf<D>): Wired {
  return { do: a.do, ...COMMANDS[a.do].write(a) };
}
