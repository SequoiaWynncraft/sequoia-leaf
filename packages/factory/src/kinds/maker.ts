/**
 * The machines' way of playing, shared by every kind that makes things by recipes (the mill, the
 * bench, the workshop, the assembler): which parts it takes in and how many (`room`), choosing and making a recipe,
 * the recipe it works toward (`aim`), how it stands and the words for it, what it makes and needs a
 * minute, being told to make one thing, and what a kept one may be put back holding and making.
 *
 * A machine makes, and takes parts in for, only the recipes the plumbing says it may (`Wire.recipes`,
 * asked of `locked` when the plumbing is worked out). One that makes what other machines make (`KindDef.as`)
 * works on their recipes as many times as fast as it is of them, and keeps as many times their parts
 * (`timesOf`, `holdsMost`).
 */
import type { KeptPiece } from "../cells.ts";
import type { Kept } from "../pieces.ts";
import type { Item, Recipe } from "../tables.ts";
import type { Counts, Holders, Wire, Yard } from "../yard.ts";
import { handOut, keep, readyOut, stockOnto, workOnto } from "./holder.ts";
import { gradeKept } from "./kept.ts";
import type { Hooks, Unchecked, Words } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { aheadOf, everySide } from "./line.ts";
import { as, asItem, holding, list, many, NO_POWER, nowhere, rateOf, slow, stuckAs, TROUBLE } from "./say.ts";

const NO_RECIPES: readonly Recipe[] = [];

/** The recipes the machine on a tile may make, as the plumbing has them (`recipesFor`, worked out once a change). */
const recipesOf = (k: Kit, y: Yard, i: number): readonly Recipe[] =>
  (y.wire ?? k.wireOf(y)).recipes[y.kind[i] ?? k.NONE] ?? NO_RECIPES;

/** Whether the thing `n` goes into a recipe the machine on a tile may make: the one it is told to, or any. */
export function wants(k: Kit, y: Yard, i: number, n: number): boolean {
  const recipes = recipesOf(k, y, i);
  const only = y.set[i] ?? k.NONE;
  for (let c = 0; c < recipes.length; c++) {
    const rec = recipes[c];
    if (!rec || (only !== k.NONE && rec.out !== only)) continue;
    for (let p = 0; p < rec.from.length; p++) if (rec.from[p] === n) return true;
  }
  return false;
}

/**
 * How many of the thing `n` it takes, as it stands: the one limit both what it takes in (`room`) and
 * what it says (`condition`, `words`) ask. It takes a thing some recipe it may make uses together with
 * everything it holds, up to `BUFFER` recipes' worth for each machine it is (`timesOf`) of the fewest of it any such recipe takes; 0
 * for a thing no such recipe uses.
 */
export function takesUpTo(k: Kit, y: Yard, i: number, n: number, wire: Wire): number {
  const r = k.holderOf(y, i);
  const kind = y.kind[i] ?? k.NONE;
  const recipes = wire.recipes[kind] ?? NO_RECIPES;
  const only = y.set[i] ?? k.NONE;
  let least = 0;
  for (let c = 0; c < recipes.length; c++) {
    const rec = recipes[c];
    if (!rec || (only !== k.NONE && rec.out !== only)) continue;
    const need = needWith(k, y.holders, r, rec, n) * k.timesOf(kind, rec);
    if (need > 0 && (least === 0 || need < least)) least = need;
  }
  return k.BUFFER * least;
}

/** Whether it has room for the thing `n`: while it holds fewer than it takes (`takesUpTo`). */
export const room = (k: Kit, y: Yard, i: number, n: number, _side: number, wire: Wire): boolean =>
  (y.holders.stock[k.holderOf(y, i) * k.ITEM_COUNT + n] ?? 0) < takesUpTo(k, y, i, n, wire);

/** Whether it is full of a thing it holds: it takes no more of it as it stands (`takesUpTo`), so the next one blocks the belt bringing it. */
function fullOf(k: Kit, y: Yard, i: number, n: number): boolean {
  const have = k.held(y.holders, k.holderOf(y, i), n);
  return have > 0 && have >= takesUpTo(k, y, i, n, y.wire ?? k.wireOf(y));
}

/** How many of the thing `n` a recipe takes, where it uses everything the holder's row `r` holds; 0 where it does not. */
function needWith(k: Kit, h: Holders, r: number, rec: Recipe, n: number): number {
  let need = 0;
  let held = 0;
  for (let p = 0; p < rec.from.length; p++) {
    const part = rec.from[p] ?? k.NONE;
    if (part === n) need = rec.need[p] ?? 0;
    if ((h.stock[r * k.ITEM_COUNT + part] ?? 0) > 0) held++;
  }
  return held === h.kinds[r] ? need : 0;
}

/** All the parts a recipe takes, of every kind. */
function partsIn(rec: Recipe): number {
  let n = 0;
  for (let p = 0; p < rec.need.length; p++) n += rec.need[p] ?? 0;
  return n;
}

/**
 * Whether a recipe is made before another a machine could make too: the one of more kinds of part,
 * then of more parts. Neither, and it is the table's order. Within one machine's own recipes no
 * recipe's parts are all another's (the content's rule); a machine that makes what others make
 * (`KindDef.as`) joins their lists, where one may be (a banner pole's frame and gear, a clock's).
 */
const before = (a: Recipe, b: Recipe): boolean =>
  a.from.length !== b.from.length ? a.from.length > b.from.length : partsIn(a) > partsIn(b);

/**
 * The recipe a machine can start on with what it holds, by what it makes, or `NONE`: of those it may
 * make, or the one it is told to make (`only`), with as many of each part as it takes, the one made
 * first (`before`).
 */
function choose(k: Kit, h: Holders, r: number, recipes: readonly Recipe[], only: number): number {
  let best: Recipe | null = null;
  for (let n = 0; n < recipes.length; n++) {
    const rec = recipes[n];
    if (rec && (only === k.NONE || rec.out === only) && k.enough(h, r, rec) && (!best || before(rec, best))) best = rec;
  }
  return best ? best.out : k.NONE;
}

/** A machine makes, at its grade's pace: it chooses a recipe it holds the parts for, and works on it until it is made. */
export function work(k: Kit, y: Yard, i: number, r: number, speed: number, wire: Wire): void {
  const h = y.holders;
  if (h.making[r] === k.NONE && !begin(k, y, i, r, wire)) return;
  const rec = k.RECIPE[h.making[r] ?? k.NONE];
  if (!rec) return;
  h.work[r] = (h.work[r] ?? 0) + speed * k.timesOf(y.kind[i] ?? k.NONE, rec);
  if ((h.work[r] ?? 0) >= rec.work) {
    h.work[r] = (h.work[r] ?? 0) - rec.work;
    for (let p = 0; p < rec.from.length; p++) k.take(h, r, rec.from[p] ?? k.NONE, rec.need[p] ?? 1);
    // One already finished waits to leave: this one waits behind it (`Holders.more`).
    if (h.out[r] === k.NONE) h.out[r] = rec.out;
    else h.more[r] = (h.more[r] ?? 0) + 1;
    h.also[r] = rec.also;
    h.making[r] = k.NONE;
    k.roomBeside(y, i, wire.waiting);
  }
}

/**
 * A machine making nothing begins the recipe it holds the parts for, if there is one: says whether it
 * did. One that found none looks again only once it is given something; one still holding a
 * by-product begins nothing until that has left too, nor one holding finished things other than
 * what its card now says to make.
 */
function begin(k: Kit, y: Yard, i: number, r: number, wire: Wire): boolean {
  const h = y.holders;
  if (h.idle[r] === 1 || h.also[r] !== k.NONE) return false;
  const held = h.out[r] ?? k.NONE;
  const set = y.set[i] ?? k.NONE;
  // Holding finished things, it makes only more of them, to wait behind them; told on its card to
  // make something else, it starts nothing until they have left, so they do.
  if (held !== k.NONE && set !== k.NONE && set !== held) return false;
  const only = held !== k.NONE ? held : set;
  const found = choose(k, h, r, wire.recipes[y.kind[i] ?? k.NONE] ?? NO_RECIPES, only);
  if (found === k.NONE) {
    // Only a machine free to choose keeps that it found nothing, to look again once given something.
    // One held to more of what it holds looks again each tick, so a recipe newly set on its card
    // starts once those have left, whether or not anything more comes in.
    if (h.out[r] === k.NONE) h.idle[r] = 1;
    return false;
  }
  h.making[r] = found;
  h.last[r] = found;
  return true;
}

/** Whether a holder's row holds nothing a recipe does not use. */
function onlyFor(k: Kit, y: Yard, r: number, rec: Recipe): boolean {
  for (const n of k.ALL_ITEMS) if (k.held(y.holders, r, n) > 0 && !rec.from.includes(n)) return false;
  return true;
}

/** The recipe a machine is working toward: the one it is making or pinned to, or the first that uses everything it holds. */
function aim(k: Kit, y: Yard, i: number): Recipe | null {
  const h = y.holders;
  const r = k.holderOf(y, i);
  if (h.making[r] !== k.NONE) return k.RECIPE[h.making[r] ?? k.NONE] ?? null;
  if (y.set[i] !== k.NONE) return k.RECIPE[y.set[i] ?? k.NONE] ?? null;
  if (h.count[r] === 0) return null;
  for (const rec of recipesOf(k, y, i)) if (onlyFor(k, y, r, rec)) return rec;
  return null;
}

/** The recipe it last began, while it stands: none before it has begun one. */
const last = (k: Kit, y: Yard, i: number): Recipe | null =>
  k.RECIPE[y.holders.last[k.holderOf(y, i)] ?? k.NONE] ?? null;

/** How a machine stands. */
function condition(k: Kit, y: Yard, i: number, lit: boolean): number {
  if (!lit) return as("unpowered", true);
  const h = y.holders;
  const r = k.holderOf(y, i);
  const held = waitsOn(k, y, i, r);
  if (held) return stuckAs(k, y, i, held.n, held.also);
  if (k.isItem(h.making[r] ?? k.NONE)) return as("working");
  const rec = aim(k, y, i);
  if (!rec) return as("idle", (h.count[r] ?? 0) > 0);
  let missing = false;
  let full = false;
  for (let p = 0; p < rec.from.length; p++) {
    const n = rec.from[p] ?? k.NONE;
    if (k.held(h, r, n) < (rec.need[p] ?? 1)) missing = true;
    if (fullOf(k, y, i, n)) full = true;
  }
  return !missing ? as("working") : full ? as("starved", true) : as("waiting");
}

/**
 * What a machine holds ready to leave that it is to be told by: its finished thing or its by-product,
 * whichever cannot leave by its way out (the by-product only when the thing can), else the one it holds.
 */
function heldOut(k: Kit, y: Yard, i: number, r: number): { n: Item; also: boolean } | null {
  const out = asItem(k, y.holders.out[r] ?? k.NONE);
  const also = asItem(k, y.holders.also[r] ?? k.NONE);
  const thing = out === null ? null : { n: out, also: false };
  const beside = also === null ? null : { n: also, also: true };
  if (thing && beside && stuckAs(k, y, i, thing.n) < TROUBLE && stuckAs(k, y, i, beside.n, true) >= TROUBLE)
    return beside;
  return thing ?? beside;
}

/**
 * What a machine holds ready that it stands by (`heldOut`): for one that may finish more behind it
 * (`Holders.more`), only once it holds all it may, or while nothing ahead could ever take it; until
 * then it goes on working, and says so.
 */
function waitsOn(k: Kit, y: Yard, i: number, r: number): { n: Item; also: boolean } | null {
  const held = heldOut(k, y, i, r);
  if (!held) return null;
  const more = (y.holders.more[r] ?? 0) + 1 < (k.TIMES_MOST[y.kind[i] ?? k.NONE] ?? 1);
  return more && stuckAs(k, y, i, held.n, held.also) < TROUBLE ? null : held;
}

/** What a machine holds ready with nowhere to send it says (with `also`, its by-product), for one that hands on ahead or by its ways out. */
export function outWords(k: Kit, y: Yard, i: number, state: string, out: Item, also = false): Words {
  return state === "blocked"
    ? { line: nowhere(k, y, i, out, also), stuck: out }
    : { line: `Waiting: no room ahead for its ${many(k, out)}.` };
}

/** The words for how a machine stands. */
function words(k: Kit, y: Yard, i: number, state: string): Words {
  if (state === "unpowered") return { line: NO_POWER };
  const h = y.holders;
  const r = k.holderOf(y, i);
  const held = waitsOn(k, y, i, r);
  if (held) return outWords(k, y, i, state, held.n, held.also);
  const making = asItem(k, h.making[r] ?? k.NONE);
  if (making !== null) return { line: `Making ${many(k, making)}${slow(k, y, i)}.` };
  const rec = aim(k, y, i);
  if (!rec)
    return { line: h.count[r] === 0 ? "Waiting for items." : `Holds ${holding(k, y, r)}. No recipe combines these.` };
  if (state === "working") return { line: `Making ${many(k, rec.out)}${slow(k, y, i)}.` };
  const missing = rec.from.filter((n, p) => k.held(h, r, n) < (rec.need[p] ?? 1));
  const full = rec.from.find((n) => fullOf(k, y, i, n));
  if (state === "starved" && full !== undefined)
    return {
      line: `Full of ${many(k, full)} and waiting for ${list(k, missing)}. If both come in on one belt, the ${many(k, full)} will be blocking it.`,
      spare: full,
      missing,
    };
  return { line: `Waiting for ${list(k, missing)} to make ${many(k, rec.out)}.`, missing };
}

/**
 * What a machine adds a minute to what the yard makes and needs: for the recipe it is working toward,
 * or holding nothing and told nothing, the one it last began.
 */
function flow(k: Kit, y: Yard, i: number, made: Counts, needed: Counts): void {
  const rec = aim(k, y, i) ?? last(k, y, i);
  if (!rec) return;
  const batches = rateOf(k, y, i, rec).effective;
  made[rec.out] = (made[rec.out] ?? 0) + batches;
  if (rec.also !== k.NONE) made[rec.also] = (made[rec.also] ?? 0) + batches;
  for (let p = 0; p < rec.from.length; p++) {
    const n = rec.from[p] ?? k.NONE;
    needed[n] = (needed[n] ?? 0) + batches * (rec.need[p] ?? 1);
  }
}

/** The recipes whose parts the machine on a tile keeps by it: the one it is told to make, or each it may make. */
export function keepsFor(k: Kit, y: Yard, i: number): readonly Recipe[] {
  const told = k.RECIPE[y.set[i] ?? k.NONE];
  return told ? [told] : k.recipesFor(y.open, y.kind[i] ?? k.NONE);
}

/** How many of a thing a machine may hold: as many as it keeps for what it may make. */
const most = (k: Kit, y: Yard, i: number, n: number): number => k.holdsMost(y.kind[i] ?? k.NONE, keepsFor(k, y, i), n);

/** Whether the machine on a tile may make a thing in the yard: its recipe is the machine's, and unlocked. */
const mayMake = (k: Kit, y: Yard, i: number, n: number | undefined): n is Item =>
  n !== undefined && k.isItem(n) && k.makesThing(y.kind[i] ?? k.NONE, n) && k.locked(y.open, { make: n }) === null;

/** Puts back a kept machine's finished thing, and as many more of it as it may hold behind it (`Holders.more`), and no more. */
function outOnto(k: Kit, y: Yard, i: number, r: number, out: Item, more: unknown): void {
  y.holders.out[r] = out;
  y.holders.more[r] = Math.min(k.whole(more, 255) ?? 0, (k.TIMES_MOST[y.kind[i] ?? k.NONE] ?? 1) - 1);
}

/**
 * Puts back what a kept machine was told to make, held and was doing, only as the rules let it be now:
 * told to make and holding only what it may make, no more than it keeps (and a by-product only of
 * such a recipe); making only what it keeps a
 * recipe for and holds all of; work only toward that, below what it takes.
 */
function onto(k: Kit, y: Yard, i: number, r: number, o: KeptPiece): void {
  const h = y.holders;
  if (mayMake(k, y, i, o.recipe)) y.set[i] = o.recipe;
  stockOnto(k, y, i, r, o, 1e6);
  if (mayMake(k, y, i, o.out)) outOnto(k, y, i, r, o.out, o.more);
  // A by-product held only where it is one of a recipe the machine may make.
  const also = o.also;
  if (also !== undefined && k.recipesFor(y.open, y.kind[i] ?? k.NONE).some((rec) => rec.also === also))
    h.also[r] = also;
  const m = o.making;
  const making = m !== undefined && keepsFor(k, y, i).some((rec) => rec.out === m && k.enough(h, r, rec)) ? m : k.NONE;
  if (making !== k.NONE) {
    h.making[r] = making;
    // What a machine is making is what it last began (`lastRecipe`), though no save keeps that apart.
    h.last[r] = making;
  }
  const fastest = Math.max(...k.PACE) * (k.TIMES_MOST[y.kind[i] ?? k.NONE] ?? 1);
  workOnto(k, y, r, o, making === k.NONE ? fastest : (k.RECIPE[making]?.work ?? 0));
}

/**
 * Tells a machine to make one thing only, or with nothing to make whatever arrives. What it holds
 * beyond what it keeps for that (`keepsFor`, `holdsMost`) is tipped out. Says why it could not, or nothing.
 */
function tell(k: Kit, y: Yard, i: number, out: Item | null): string | null {
  if (out !== null && !k.makesThing(y.kind[i] ?? k.NONE, out)) return "That cannot make it";
  const lock = out === null ? null : k.locked(y.open, { make: out });
  if (lock !== null) return lock;
  const h = y.holders;
  const r = k.holderOf(y, i);
  y.set[i] = out ?? k.NONE;
  h.making[r] = k.NONE;
  h.work[r] = 0;
  h.idle[r] = 0;
  const kept = keepsFor(k, y, i);
  const kind = y.kind[i] ?? k.NONE;
  for (const n of k.ALL_ITEMS) k.take(h, r, n, k.held(h, r, n) - k.holdsMost(kind, kept, n));
  k.changed(y);
  return null;
}

/** What a machine keeps in a blueprint or a copy: what it is told to make, if its recipe is the machine's; its grade. */
const keeps = (k: Kit, kind: number, v: Unchecked): Kept => ({
  ...(typeof v.recipe === "number" && k.makesThing(kind, v.recipe) ? { recipe: v.recipe } : {}),
  ...gradeKept(k, v),
});

/** A machine: every hook a kind that makes things by recipes plays with. */
export const MAKER: Hooks = {
  sides: everySide,
  next: aheadOf,
  wants,
  room,
  give: keep,
  hands: handOut,
  ready: readyOut,
  work,
  condition,
  words,
  aim,
  last,
  flow,
  most,
  onto,
  keeps,
  set: { recipe: tell },
};
