/**
 * Building in the yard, taking things away, turning and setting pieces, and buying plots.
 * Everything that costs Coins is told the balance and says what it took. What only some kinds of
 * piece may be or be set to is each kind's to say (`kinds/`): where it may stand, what it is laid
 * over, the other tiles it stands on, and what each command that sets something on a piece does.
 */
import { coinsText } from "@sequoia-leaf/core";

import { FELLING } from "./content/plots.ts";
import { coverRefusal } from "./footprint.ts";
import type { Setters } from "./kinds/kind.ts";
import { RULES } from "./kinds/list.ts";
import { keepsFor } from "./kinds/maker.ts";
import { digs, exitOf } from "./kinds/tunnel.ts";
import { plotPrice, type Plotted, touching } from "./land.ts";
import { join } from "./lines.ts";
import { isBig, pieceOf } from "./sizes.ts";
import {
  ALL_ITEMS,
  CLEARING,
  FAST,
  FIXED,
  gradeOf,
  isKind,
  type Item,
  type Kind,
  KIND_INFO,
  LINED,
  locked,
  MOST,
  NONE,
  OVER,
  type Plot,
  price,
  REACHES,
  RECIPE,
  type Recipe,
  SPANS,
  STUDIES,
} from "./tables.ts";
import { at, type Dir, ground, kindAt } from "./tiles.ts";
import { KIT } from "./wire.ts";
import {
  changed,
  enough,
  face,
  held,
  holderOf,
  holds,
  place,
  redwoodAt,
  standingTree,
  take,
  vacate,
  type Yard,
} from "./yard.ts";

export { at, BACK, type Dir, DX, DY, isDir, kindAt, LEFT, otherMouth, RIGHT, right } from "./tiles.ts";
export { insTo } from "./yard.ts";

/** What came of trying to spend Coins: what it cost, or why not, in plain words. */
export type Spent = { readonly ok: true; readonly cost: number } | { readonly ok: false; readonly why: string };
/** What came of taking something away: the Coins that come back, or why not. */
export type Refund = { readonly ok: true; readonly refund: number } | { readonly ok: false; readonly why: string };
/** What came of setting a piece down: what it cost and the tiles it was laid on, or why not. */
export type Laid =
  | { readonly ok: true; readonly cost: number; readonly laid: readonly number[] }
  | { readonly ok: false; readonly why: string };

/**
 * How a piece is to be set down beyond its kind, tile and way: its grade (1 if not said), a
 * tunnel's span (if not said, the nearest it can come up at; over a tunnel, if said, that tunnel's),
 * and whether a sorter sends what it is set to its right (if not said, a new one sends it left and
 * one set down over a sorter sends it as that one did).
 */
export interface Lay {
  readonly grade?: number;
  readonly span?: number;
  readonly right?: boolean;
}

/**
 * What it costs to stand one more of a kind at a grade, a tunnel under `span` tiles: its price, less
 * the plain price of one (grade 1, as short as its kind is priced alike) while the yard has one to hand (`spare`).
 */
export const costOf = (y: Yard, k: Kind, g = 1, spare: Uint8Array = y.spare, span = 0): number =>
  price(k, gradeOf(k, g), span) - ((spare[k] ?? 0) > 0 ? price(k, gradeOf(k)) : 0);

/** What comes back for the piece on a tile taken away: what it cost at its grade and span, less the plain price of one for one the yard had to hand. */
export function worthAt(y: Yard, t: number): number {
  const i = pieceOf(y, t);
  const k = y.kind[i] ?? NONE;
  return price(k, y.grade[i] ?? 0, y.span[i] ?? 0) - (y.free[i] === 1 ? price(k, gradeOf(k)) : 0);
}

/** Whether a kind may be set down in the place of what stands: one its kind says it goes over (a splitter on a belt). */
export const replaces = (k: number, there: number): boolean => there !== k && (OVER[k] ?? []).includes(there);

/**
 * What building a kind at a grade on a tile takes from the purse, a tunnel to run under `span` tiles:
 * over one of its kind, what its grade costs more (or, lower, gives back), at the span it has; else
 * its cost, less what a replaced piece gives back.
 */
export function priceAt(y: Yard, k: Kind, x: number, z: number, g = 1, spare: Uint8Array = y.spare, span = 0): number {
  const t = at(y, x, z);
  const i = t < 0 ? t : pieceOf(y, t);
  const there = i < 0 ? NONE : (y.kind[i] ?? NONE);
  if (there === NONE) return costOf(y, k, g, spare, span);
  const has = y.span[i] ?? 0;
  if (there === k) return price(k, gradeOf(k, g), has) - price(k, y.grade[i] ?? 0, has);
  return costOf(y, k, g, spare, span) - worthAt(y, i);
}

/** How many tiles a piece set down here facing `d` runs under: for a tunnel, the span asked for, or the nearest it can come up at; 0 for the rest. */
const spanFor = (y: Yard, k: Kind, x: number, z: number, d: number, lay: Lay): number =>
  SPANS[k] === 1 ? (lay.span ?? exitOf(KIT, y, x, z, d)?.span ?? 0) : 0;

/** Whether a tunnel may pass under a tile: under anything but the depot. */
export const digsUnder = (y: Yard, x: number, z: number): boolean => digs(KIT, y, x, z);

/** Where a tunnel going in at a tile would come up: the nearest clear tile beyond one to three others, or the end of `span`. */
export const tunnelExit = (
  y: Yard,
  x: number,
  z: number,
  d: number,
  span?: number,
): { x: number; y: number; span: number } | null => exitOf(KIT, y, x, z, d, span);

/** What a kind is called in a sentence: "the depot". */
const lower = (k: number): string => (KIND_INFO[k]?.name ?? "").toLowerCase();

/** Why one more of a kind may not stand, by the limit its kind has (`KindDef.most`); nothing for one with none. */
const overLimit = (y: Yard, k: number, more = 1): string | null =>
  MOST[k] === "stops" ? locked(y.open, { stops: stops(y) + more }) : null;

/** Why a kind cannot be built here with `coins` in the purse, or nothing if it can. */
export function refusal(
  y: Yard,
  k: Kind,
  x: number,
  z: number,
  coins: number,
  d: number = 0,
  lay: Lay = {},
): string | null {
  const bad = ground(y, x, z);
  if (bad !== null) return bad;
  if (FIXED[k] === 1) return `There is only one ${lower(k)}`;
  const g = gradeOf(k, lay.grade);
  const lock = locked(y.open, { build: k, grade: g });
  if (lock !== null) return lock;
  const i = at(y, x, z);
  const there = y.kind[i] ?? NONE;
  if (FIXED[there] === 1) return `The ${lower(there)} stands here`;
  const why = standsOver(y, k, i, d, g, lay);
  if (why !== null) return why;
  if (coins < priceAt(y, k, x, z, g, y.spare, spanFor(y, k, x, z, d, lay))) return "Not enough Coins";
  return null;
}

/**
 * Why a kind cannot stand on the tile `i` over what stands there, as its kind says: laid over one of
 * its kind, a piece turns it and raises or lowers it to its grade, as its kind lets it (`Hooks.over`);
 * else where it goes, nothing or what it may take the place of, its own checks and how many may stand.
 */
function standsOver(y: Yard, k: Kind, i: number, d: number, g: number, lay: Lay): string | null {
  const there = y.kind[i] ?? NONE;
  const r = RULES[k];
  if (!r) return null;
  // One of more than one tile is laid again only from its own tile, and turned only where it fits.
  if (there === k && pieceOf(y, i) === i) return r.over(KIT, y, i, d, g, lay) ?? covers(y, k, i, d, i);
  if (isBig(k)) return covers(y, k, i, d) ?? r.refusal(KIT, y, i, d, lay) ?? overLimit(y, k);
  if (there !== NONE && !replaces(k, there)) return "Something is here already";
  return r.refusal(KIT, y, i, d, lay) ?? overLimit(y, k);
}

/** Why a kind of more than one tile cannot stand on the tile `i` facing `d` (over the piece on `self`); nothing for one of one tile. */
const covers = (y: Yard, k: Kind, i: number, d: number, self = -1): string | null =>
  isBig(k) ? coverRefusal(y, k, i % y.land.w, Math.floor(i / y.land.w), d, self) : null;

/**
 * Builds something and says what it cost: over one of its kind it turns it and raises or lowers it
 * to the grade asked for (a sorter to the side asked for too), keeping what it holds, its colour and
 * its other settings; a splitter or a joiner
 * set down on a belt takes its place, keeping what the belt carried and its colour; a tunnel is both
 * mouths at once. A new belt or tunnel takes the colour of the line it joins (`join`).
 */
export function build(y: Yard, k: Kind, x: number, z: number, d: Dir, coins: number, lay: Lay = {}): Spent {
  const did = setDown(y, k, x, z, d, coins, lay);
  if (!did.ok) return did;
  if (LINED[k] === 1) join(y, did.laid);
  return { ok: true, cost: did.cost };
}

/** Sets a piece down as `build` does, leaving a new belt or tunnel uncoloured. Says what it cost and the tiles laid on. */
export function setDown(y: Yard, k: Kind, x: number, z: number, d: Dir, coins: number, lay: Lay = {}): Laid {
  const why = refusal(y, k, x, z, coins, d, lay);
  if (why !== null) return { ok: false, why };
  const i = at(y, x, z);
  const there = y.kind[i] ?? NONE;
  const g = gradeOf(k, lay.grade);
  const cost = priceAt(y, k, x, z, g, y.spare, spanFor(y, k, x, z, d, lay));
  if (there === k) {
    relay(y, k, i, d, g, lay);
    return { ok: true, cost, laid: [] };
  }
  // A replaced belt goes back as if taken away; what it carried and its colour stay.
  const kept =
    there === NONE ? null : { item: y.item[i] ?? NONE, prog: y.prog[i] ?? 0, via: y.via[i] ?? 0, tint: y.tint[i] ?? 0 };
  if (there !== NONE && y.free[i] === 1) y.spare[there] = (y.spare[there] ?? 0) + 1;
  place(y, i, k, d, g);
  RULES[k]?.laid(KIT, y, i, lay);
  if ((y.spare[k] ?? 0) > 0) {
    // One of the pieces the yard has to hand.
    y.free[i] = 1;
    y.spare[k] = (y.spare[k] ?? 0) - 1;
  }
  if (kept) {
    y.item[i] = kept.item;
    y.prog[i] = kept.prog;
    y.via[i] = kept.via;
    y.tint[i] = kept.tint;
  }
  const laid = [i, ...(RULES[k]?.lays(KIT, y, i, d, g, lay) ?? [])];
  changed(y);
  if (REACHES[k] === 1) y.powered = false;
  return { ok: true, cost, laid };
}

/** A piece laid over one of its kind turns it (but one its kind keeps fast) and raises or lowers it to its grade, both mouths of a tunnel. */
function relay(y: Yard, k: Kind, i: number, d: Dir, g: number, lay: Lay): void {
  const mouth = KIT.otherMouth(y, i);
  const turns = FAST[k] !== 1;
  if (y.grade[i] !== g || (turns && y.dir[i] !== d)) changed(y);
  if (turns) face(y, i, d);
  y.grade[i] = g;
  if (mouth >= 0) y.grade[mouth] = g;
  RULES[k]?.laid(KIT, y, i, lay);
}

/** How many pieces stand that the yard's cart stops limit (`KindDef.most`). */
export const stops = (y: Yard): number => y.kind.reduce((n, k) => (MOST[k] === "stops" ? n + 1 : n), 0);

/** Whether what stands on a tile can be turned: anything but what its kind keeps fast (the depot, a tunnel). */
export function turnable(y: Yard, x: number, z: number): boolean {
  const there = kindAt(y, x, z);
  return there !== NONE && FAST[there] !== 1;
}

/** Turns something to face another way, whichever of its tiles is named: one of more than one tile only where it fits turned. Costs nothing. */
export function turn(y: Yard, x: number, z: number, d: Dir): boolean {
  if (!turnable(y, x, z)) return false;
  const i = pieceOf(y, at(y, x, z));
  const k = y.kind[i] ?? NONE;
  if (y.dir[i] === d) return true;
  if (!isKind(k) || covers(y, k, i, d, i) !== null) return false;
  face(y, i, d);
  changed(y);
  return true;
}

/** Takes something away and says what comes back. Whatever it was holding is lost. The depot stays. */
export function remove(y: Yard, x: number, z: number): Refund {
  const t = at(y, x, z);
  const i = t < 0 ? t : pieceOf(y, t);
  const there = i < 0 ? NONE : (y.kind[i] ?? NONE);
  if (there === NONE) return { ok: false, why: "There is nothing here" };
  if (FIXED[there] === 1) return { ok: false, why: `The ${lower(there)} cannot be removed` };
  const refund = worthAt(y, i);
  const free = y.free[i] === 1;
  // Both mouths of a tunnel go together.
  const mouth = KIT.otherMouth(y, i);
  vacate(y, i);
  if (mouth >= 0) vacate(y, mouth);
  changed(y);
  if (REACHES[there] === 1) y.powered = false;
  if (free) y.spare[there] = (y.spare[there] ?? 0) + 1;
  return { ok: true, refund };
}

/** The recipes whose parts the machine on a tile keeps by it: the one it is told to make, or each it may make. */
export const keeps = (y: Yard, i: number): readonly Recipe[] => keepsFor(KIT, y, i);

/** What the piece on a tile takes being set by a command, by what the command sets; nothing where nothing stands or its kind takes none. */
function setter<S extends keyof Setters>(
  y: Yard,
  x: number,
  z: number,
  what: S,
): { i: number; set: NonNullable<Setters[S]> } | null {
  const t = at(y, x, z);
  const i = t < 0 ? t : pieceOf(y, t);
  const set = i < 0 ? undefined : RULES[y.kind[i] ?? NONE]?.set[what];
  return set ? { i, set } : null;
}

/**
 * Tells a machine to make one thing only, or with nothing to make whatever arrives. What it holds
 * beyond what it keeps for that (`keeps`, `holdsMost`) is tipped out. Says why it could not, or nothing.
 */
export function setRecipe(y: Yard, x: number, z: number, out: Item | null): string | null {
  const s = setter(y, x, z, "recipe");
  return s ? s.set(KIT, y, s.i, out) : "That cannot make it";
}

/** Sets the one thing a sorter sends to its side, or with nothing makes it a belt. Says whether there was a sorter. */
export function setSort(y: Yard, x: number, z: number, n: Item | null): boolean {
  const s = setter(y, x, z, "sort");
  s?.set(KIT, y, s.i, n);
  return s !== null;
}

/** Sets the side a sorter sends the thing it is set to: its right, or its left. Says whether there was a sorter. */
export function setSide(y: Yard, x: number, z: number, toRight: boolean): boolean {
  const s = setter(y, x, z, "side");
  s?.set(KIT, y, s.i, toRight);
  return s !== null;
}

/** Empties what a machine, crate or boiler holds, all of it or one kind of thing. Says how many went. */
export function tipOut(y: Yard, x: number, z: number, only: Item | null = null): number {
  const t = at(y, x, z);
  const i = t < 0 ? t : pieceOf(y, t);
  if (i < 0 || !holds(y.kind[i] ?? NONE)) return 0;
  const h = y.holders;
  const r = holderOf(y, i);
  if (h.count[r] === 0) return 0;
  let gone = 0;
  for (const n of ALL_ITEMS) {
    if (only !== null && n !== only) continue;
    gone += held(h, r, n);
    take(h, r, n, held(h, r, n));
  }
  if (gone === 0) return 0;
  if (lostPart(y, i, r)) {
    h.making[r] = NONE;
    h.work[r] = 0;
  }
  h.idle[r] = 0;
  changed(y);
  return gone;
}

/** Whether what the holder on a tile (its row `r`) was part-way through has lost a part: a recipe's, or the folio a Study works on. */
function lostPart(y: Yard, i: number, r: number): boolean {
  const h = y.holders;
  const making = h.making[r] ?? NONE;
  if (STUDIES[y.kind[i] ?? NONE] === 1) return making !== NONE && held(h, r, making) === 0;
  const recipe = RECIPE[making];
  return !!recipe && !enough(h, r, recipe);
}

/** Opens or shuts a crate: shut, it takes things in and lets nothing out. Says whether there was a crate. */
export function setOpen(y: Yard, x: number, z: number, open: boolean): boolean {
  const s = setter(y, x, z, "open");
  s?.set(KIT, y, s.i, open);
  return s !== null;
}

/** Whether a number is one of a splitter's ways out: 0 ahead, 1 left, 2 right. */
const isWay = (way: number): boolean => way === 0 || way === 1 || way === 2;

/**
 * Shuts or opens one of a splitter's ways out: 0 for ahead, 1 for left, 2 for right. Shutting the
 * way it puts first puts none first. A way it took things in by takes nothing in, opened or shut.
 * Says whether there was a splitter.
 */
export function setWay(y: Yard, x: number, z: number, way: number, open: boolean): boolean {
  const s = isWay(way) ? setter(y, x, z, "way") : null;
  s?.set(KIT, y, s.i, way, open);
  return s !== null;
}

/**
 * Puts one of a splitter's open ways out first (0 ahead, 1 left, 2 right), or with null none: what
 * it carries goes that way while the tile there takes it, and only the rest to its other ways. Who
 * hands to whom is the same, so the plumbing stands. Says why it could not, or nothing.
 */
export function setFirst(y: Yard, x: number, z: number, way: number | null): string | null {
  const s = setter(y, x, z, "first");
  return s ? s.set(KIT, y, s.i, way) : "There is no splitter there";
}

/**
 * Turns one of a splitter's ways out (0 ahead, 1 left, 2 right) to take things in, as it does from
 * behind, or with `on` false back to sending them out. A way turned in is neither shut nor put first.
 * Says whether there was a splitter.
 */
export function setIn(y: Yard, x: number, z: number, way: number, on: boolean): boolean {
  const s = isWay(way) ? setter(y, x, z, "in") : null;
  s?.set(KIT, y, s.i, way, on);
  return s !== null;
}

// ---------- land ----------

const plotOf = (y: Yard, id: Plot): Plotted | null => y.land.plots.find((p) => p.plot === id) ?? null;

/** Where a plot stands: the yard's already, for sale now, or not yet (and why). */
export function plotState(y: Yard, id: Plot): { state: "owned" | "for sale" | "not yet"; why: string | null } {
  const plot = plotOf(y, id);
  if (!plot) return { state: "not yet", why: "There is no such plot" };
  if (y.plots.includes(id)) return { state: "owned", why: null };
  if (y.open.plots[id] !== 1) return { state: "not yet", why: `${plot.name} is not for sale yet` };
  const reached = y.land.plots.some((p) => y.plots.includes(p.plot) && touching(p, plot));
  if (!reached) return { state: "not yet", why: `${plot.name} does not touch the yard's land yet` };
  return { state: "for sale", why: null };
}

/**
 * Why a plot cannot be bought at `shown` with `coins` in the purse, or nothing if it can. The price is
 * the one the player was shown: a plot that rises costs more once another is bought (from another
 * tab, or earlier in the same batch), and then it is not bought at all.
 */
export function plotRefusal(y: Yard, id: Plot, shown: number, coins: number): string | null {
  const { state, why } = plotState(y, id);
  if (state === "owned") return "You already own that plot";
  if (state === "not yet") return why;
  if (CLEARING[id] && !y.cleared.includes(id)) return `${plotOf(y, id)?.name ?? "That plot"} must be cleared first`;
  const now = plotPrice(y, id);
  if (shown !== now) return `The price has changed: it is now ${coinsText(now)}`;
  return coins < now ? "Not enough Coins" : null;
}

/**
 * What the next redwood costs to fell, by how many the yard has felled (every one, whenever): the
 * first `FELLING.first`, each after half as much again, rounded down to a whole `FELLING.round`.
 */
export function fellPrice(y: Yard): number {
  let p: number = FELLING.first;
  for (const t of y.felled) if (t === 1) p = Math.floor((p + Math.floor(p / 2)) / FELLING.round) * FELLING.round;
  return p;
}

/** Why the redwood on a tile cannot be felled with `coins` in the purse, or nothing if it can. */
export function fellRefusal(y: Yard, x: number, z: number, coins: number, shown?: number): string | null {
  const i = at(y, x, z);
  if (i < 0 || !redwoodAt(y, i)) return "There is no redwood here";
  const plot = y.land.plots[y.land.plot[i] ?? NONE];
  if (!plot || !y.plots.includes(plot.plot)) return plot ? `${plot.name} is not the yard's yet` : "That is off the map";
  const now = fellPrice(y);
  if (shown !== undefined && shown !== now) return `The price has changed: it is now ${coinsText(now)}`;
  return coins < now ? "Not enough Coins" : null;
}

/**
 * Fells the redwood on a tile, every tile of it, at the price the player was shown (`shown`: refused
 * as a plot is if it has changed since), and says what it cost. It is never undone, and its Coins
 * never come back.
 */
export function fell(y: Yard, x: number, z: number, shown: number, coins: number): Spent {
  const why = fellRefusal(y, x, z, coins, shown);
  if (why !== null) return { ok: false, why };
  const cost = fellPrice(y);
  y.felled[standingTree(y, at(y, x, z))] = 1;
  return { ok: true, cost };
}

/** Buys a plot at the price the player was shown, and says what it cost. */
export function buyPlot(y: Yard, id: Plot, shown: number, coins: number): Spent {
  const why = plotRefusal(y, id, shown, coins);
  if (why !== null) return { ok: false, why };
  // Its price before it is the yard's: owned, it would count toward its own rise.
  const cost = plotPrice(y, id);
  y.plots.push(id);
  changed(y);
  return { ok: true, cost };
}
