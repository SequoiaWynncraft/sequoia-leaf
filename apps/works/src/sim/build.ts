/**
 * Building in the yard, taking things away, and buying plots and plans. Everything that costs
 * Coins is told the balance and says what it took; nothing here keeps a purse.
 */
import type { Item } from "./content/items.ts";
import { ITEMS } from "./content/items.ts";
import { KIND, type Kind, SPAN } from "./content/machines.ts";
import { type PlanId, type PlanInfo, PLANS } from "./content/plans.ts";
import type { PlotId } from "./content/plots.ts";
import { RECIPE } from "./content/recipes.ts";
import { type Dir, DX, DY } from "./grid.ts";
import { besideWater, type Plot, touching } from "./land.ts";
import { fillBoard } from "./orders.ts";
import { repower } from "./power.ts";
import { at, blank, changed, reopen, take, type World } from "./world.ts";

/** What came of trying to spend Coins: what it cost, or why not, in plain words. */
export type Spent = { readonly ok: true; readonly cost: number } | { readonly ok: false; readonly why: string };
/** What came of taking something away: the Coins that come back, or why not. */
export type Refund = { readonly ok: true; readonly refund: number } | { readonly ok: false; readonly why: string };

/** Why nothing can stand on a tile, whatever it is: off the map, not the yard's land, water, or a redwood. */
function ground(w: World, x: number, y: number): string | null {
  const i = at(w, x, y);
  if (i < 0) return "That is off the map";
  const plot = w.land.plots[w.land.plot[i] ?? -1];
  if (!plot || !w.plots.includes(plot.id)) return plot ? `${plot.name} is not the yard's yet` : "That is off the map";
  if (w.land.water[i] === 1) return "The stream runs here";
  if (w.land.trunk[i] === 1) return "A redwood stands here";
  return null;
}

/** What it costs to stand one more of a thing: nothing while the yard has one to hand, else its price. */
export const costOf = (w: World, kind: Kind): number => ((w.spare[kind] ?? 0) > 0 ? 0 : KIND[kind].cost);

/** Whether a tunnel may pass under a tile. It goes under belts, roots and the stream, but never under the depot. */
export const digsUnder = (w: World, x: number, y: number): boolean => w.cells[at(w, x, y)]?.kind !== "depot";

/**
 * Where a tunnel going in at a tile would come up: the nearest clear tile beyond one to three
 * others, or the far end of `span` if one is asked for. Nothing if there is nowhere, or if the
 * depot is in the way.
 */
export function tunnelExit(
  w: World,
  x: number,
  y: number,
  dir: Dir,
  span?: number,
): { x: number; y: number; span: number } | null {
  const most = span ?? SPAN;
  if (most < 1 || most > SPAN) return null;
  for (let s = 1; s <= most; s++) {
    if (!digsUnder(w, x + DX[dir] * s, y + DY[dir] * s)) return null;
    if (span !== undefined && s < span) continue;
    const ex = x + DX[dir] * (s + 1);
    const ey = y + DY[dir] * (s + 1);
    if (ground(w, ex, ey) === null && !w.cells[at(w, ex, ey)]) return { x: ex, y: ey, span: s };
  }
  return null;
}

/** Whether the depot is what stops a tunnel going in at a tile from coming up. */
function depotInTheWay(w: World, x: number, y: number, dir: Dir, span?: number): boolean {
  for (let s = 1; s <= (span ?? SPAN); s++) if (!digsUnder(w, x + DX[dir] * s, y + DY[dir] * s)) return true;
  return false;
}

/** Why something cannot be built here with `coins` in the purse, or nothing if it can. */
export function refusal(
  w: World,
  kind: Kind,
  x: number,
  y: number,
  coins: number,
  dir: Dir = 0,
  span?: number,
): string | null {
  const bad = ground(w, x, y);
  if (bad !== null) return bad;
  if (kind === "depot") return "There is only the one depot";
  if (!w.open.kinds.has(kind)) return `The ${KIND[kind].name.toLowerCase()} has not been opened yet`;
  const i = at(w, x, y);
  const there = w.cells[i];
  if (there?.kind === "depot") return "The depot stands here";
  // Laying a thing over another of its kind only turns it, and costs nothing.
  if (there) return there.kind === kind && kind !== "tunnel" ? null : "Something is here already";
  if (kind === "gatherer" && !w.land.deposit[i]) return "A gatherer needs something in the ground under it";
  if (kind === "wheel" && !besideWater(w.land, x, y)) return "A waterwheel needs the stream beside it";
  if (kind === "tunnel" && !tunnelExit(w, x, y, dir, span))
    return depotInTheWay(w, x, y, dir, span)
      ? "A tunnel cannot go under the depot"
      : "A tunnel needs a clear tile to come up at, one to three tiles on";
  if (coins < costOf(w, kind)) return "Not enough Coins";
  return null;
}

/**
 * Builds something and says what it cost. A thing laid over another of its kind only turns it. A
 * tunnel is built as its two mouths at once: in at this tile, and up at the nearest clear tile
 * beyond (or `span` tiles beyond, if given).
 */
export function build(w: World, kind: Kind, x: number, y: number, dir: Dir, coins: number, span?: number): Spent {
  const why = refusal(w, kind, x, y, coins, dir, span);
  if (why !== null) return { ok: false, why };
  const i = at(w, x, y);
  const there = w.cells[i];
  if (there) {
    if (there.dir !== dir) {
      there.dir = dir;
      changed(w);
    }
    return { ok: true, cost: 0 };
  }
  const made = blank(kind, dir);
  const cost = costOf(w, kind);
  if ((w.spare[kind] ?? 0) > 0) {
    // One of the pieces the yard has to hand.
    made.free = true;
    w.spare[kind] = (w.spare[kind] ?? 0) - 1;
  }
  w.cells[i] = made;
  if (kind === "tunnel") {
    const exit = tunnelExit(w, x, y, dir, span);
    if (exit) {
      made.span = exit.span;
      made.under = Array.from({ length: exit.span }, () => null);
      made.underProg = Array.from({ length: exit.span }, () => 0);
      const far = blank("tunnel", dir);
      far.span = -exit.span;
      w.cells[at(w, exit.x, exit.y)] = far;
    }
  }
  changed(w);
  if (kind === "pylon") repower(w);
  return { ok: true, cost };
}

/** Turns something to face another way. Costs nothing. A tunnel is not turned: take it away and dig again. */
export function turn(w: World, x: number, y: number, dir: Dir): boolean {
  const there = w.cells[at(w, x, y)];
  if (!there || there.kind === "depot" || there.kind === "tunnel") return false;
  if (there.dir !== dir) {
    there.dir = dir;
    changed(w);
  }
  return true;
}

/**
 * Takes something away and says what comes back: all it cost (nothing, for one of the pieces the
 * yard had to hand, which goes back to hand). Whatever it was holding is lost. The depot stays.
 */
export function remove(w: World, x: number, y: number): Refund {
  const i = at(w, x, y);
  const there = i < 0 ? null : w.cells[i];
  if (!there) return { ok: false, why: "There is nothing here" };
  if (there.kind === "depot") return { ok: false, why: "The depot stays" };
  w.cells[i] = null;
  if (there.kind === "tunnel") {
    // Both mouths go together.
    const far = (Math.abs(there.span) + 1) * Math.sign(there.span);
    w.cells[at(w, x + DX[there.dir] * far, y + DY[there.dir] * far)] = null;
  }
  changed(w);
  if (there.kind === "pylon") repower(w);
  if (there.free) w.spare[there.kind] = (w.spare[there.kind] ?? 0) + 1;
  return { ok: true, refund: there.free ? 0 : KIND[there.kind].cost };
}

/**
 * Tells a machine to make one thing only, or (with nothing) to go back to making whatever arrives.
 * Anything it holds that the new recipe has no use for is lost. Says whether it could.
 */
export function setRecipe(w: World, x: number, y: number, out: Item | null): boolean {
  const there = w.cells[at(w, x, y)];
  if (!there) return false;
  const recipe = out === null ? null : RECIPE[out];
  if (out !== null && recipe?.by !== there.kind) return false;
  if (there.kind !== "mill" && there.kind !== "bench" && there.kind !== "workshop") return false;
  there.recipe = out;
  there.making = null;
  there.work = 0;
  there.idle = false;
  if (recipe) for (const k of ITEMS) while (!recipe.from.includes(k) && (there.buf[k] ?? 0) > 0) take(there, k);
  changed(w);
  return true;
}

/**
 * Empties what a machine, crate or boiler holds, all of it or one kind of thing. What is tipped out
 * is lost. It is the way to free a machine that has filled up with one part while it waits for
 * another. Says how many things went.
 */
export function tipOut(w: World, x: number, y: number, only: Item | null = null): number {
  const there = w.cells[at(w, x, y)];
  if (!there || there.count === 0) return 0;
  let gone = 0;
  for (const k of ITEMS) {
    if (only !== null && k !== only) continue;
    while ((there.buf[k] ?? 0) > 0) {
      take(there, k);
      gone++;
    }
  }
  if (gone === 0) return 0;
  // Whatever it was part-way through making may have lost a part.
  const making = there.making === null ? null : RECIPE[there.making];
  if (making && !making.from.every((k) => (there.buf[k] ?? 0) > 0)) {
    there.making = null;
    there.work = 0;
  }
  there.idle = false;
  changed(w);
  return gone;
}

/** Opens or shuts a crate: shut, it takes things in and lets nothing out. Says whether there was a crate. */
export function setOpen(w: World, x: number, y: number, open: boolean): boolean {
  const there = w.cells[at(w, x, y)];
  if (there?.kind !== "crate") return false;
  if (there.open !== open) {
    there.open = open;
    changed(w);
  }
  return true;
}

// ---------- land ----------

const plotOf = (w: World, id: PlotId): Plot | null => w.land.plots.find((p) => p.id === id) ?? null;

/** Where a plot stands: the yard's already, for sale now, or not yet (and why). */
export function plotState(w: World, id: PlotId): { state: "owned" | "for sale" | "not yet"; why: string | null } {
  const plot = plotOf(w, id);
  if (!plot) return { state: "not yet", why: "There is no such plot" };
  if (w.plots.includes(id)) return { state: "owned", why: null };
  if (!w.open.plots.has(id)) return { state: "not yet", why: `${plot.name} is not for sale yet` };
  const reached = w.land.plots.some((p) => w.plots.includes(p.id) && touching(p, plot));
  if (!reached) return { state: "not yet", why: `${plot.name} does not touch the yard's land yet` };
  return { state: "for sale", why: null };
}

/** Why a plot cannot be bought with `coins` in the purse, or nothing if it can. */
export function plotRefusal(w: World, id: PlotId, coins: number): string | null {
  const { state, why } = plotState(w, id);
  if (state === "owned") return "That plot is the yard's already";
  if (state === "not yet") return why;
  return coins < (plotOf(w, id)?.price ?? 0) ? "Not enough Coins" : null;
}

/** Buys a plot and says what it cost. */
export function buyPlot(w: World, id: PlotId, coins: number): Spent {
  const why = plotRefusal(w, id, coins);
  if (why !== null) return { ok: false, why };
  w.plots.push(id);
  changed(w);
  return { ok: true, cost: plotOf(w, id)?.price ?? 0 };
}

// ---------- plans ----------

const planOf = (id: PlanId): PlanInfo | null => PLANS.find((p) => p.id === id) ?? null;

/** Where a plan stands: owned, for sale now, or not yet (and why). */
export function planState(w: World, id: PlanId): { state: "owned" | "for sale" | "not yet"; why: string | null } {
  const plan = planOf(id);
  if (!plan) return { state: "not yet", why: "There is no such plan" };
  if (w.plans.includes(id)) return { state: "owned", why: null };
  if (!w.open.plans.has(id)) return { state: "not yet", why: `${plan.name} comes with a later order` };
  const missing = plan.needs.find((n) => !w.plans.includes(n));
  if (missing !== undefined)
    return { state: "not yet", why: `${plan.name} needs ${planOf(missing)?.name ?? missing} first` };
  return { state: "for sale", why: null };
}

/** Why a plan cannot be bought with `coins` in the purse, or nothing if it can. */
export function planRefusal(w: World, id: PlanId, coins: number): string | null {
  const { state, why } = planState(w, id);
  if (state === "owned") return "That plan is bought already";
  if (state === "not yet") return why;
  return coins < (planOf(id)?.price ?? 0) ? "Not enough Coins" : null;
}

/** Buys a plan and says what it cost. Its change holds from the next tick. */
export function buyPlan(w: World, id: PlanId, coins: number): Spent {
  const why = planRefusal(w, id, coins);
  if (why !== null) return { ok: false, why };
  w.plans.push(id);
  reopen(w);
  changed(w);
  repower(w);
  fillBoard(w);
  return { ok: true, cost: planOf(id)?.price ?? 0 };
}
