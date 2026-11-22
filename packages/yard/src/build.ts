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
import { STORY } from "./content/story.ts";
import { BACK, type Dir, DX, DY, LEFT, RIGHT } from "./grid.ts";
import { besideWater, type Plot, touching } from "./land.ts";
import { fillBoard } from "./orders.ts";
import { repower } from "./power.ts";
import { rewire, takes } from "./step.ts";
import { at, blank, type Building, changed, reopen, take, type Wire, type World } from "./world.ts";

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
  if (w.land.water[i] === 1) return "Nothing can be built on the stream";
  if (w.land.trunk[i] === 1) return "Nothing can be built on a tree";
  return null;
}

/** What it costs to stand one more of a thing: nothing while the yard has one to hand, else its price. */
export const costOf = (w: World, kind: Kind): number => ((w.spare[kind] ?? 0) > 0 ? 0 : KIND[kind].cost);

/** What comes back for a piece taken away: all it cost, or nothing for one the yard had to hand. */
export const worth = (there: Building): number => (there.free ? 0 : KIND[there.kind].cost);

/**
 * Whether a thing may be set down on what stands on a tile, in its place: a splitter or a joiner on
 * a belt, or on one another.
 */
export const replaces = (kind: Kind, there: Building): boolean =>
  (kind === "splitter" || kind === "joiner") &&
  there.kind !== kind &&
  (there.kind === "belt" || there.kind === "splitter" || there.kind === "joiner");

/**
 * What building a thing on a tile takes from the purse: nothing to turn one of its kind, and less
 * by what comes back for a piece it takes the place of (so it can be less than nothing).
 */
export function priceAt(w: World, kind: Kind, x: number, y: number): number {
  const there = w.cells[at(w, x, y)];
  if (!there) return costOf(w, kind);
  return there.kind === kind ? 0 : costOf(w, kind) - worth(there);
}

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
  if (kind === "depot") return "There is only one depot";
  if (!w.open.kinds.has(kind)) return `The ${KIND[kind].name.toLowerCase()} is not unlocked yet`;
  const i = at(w, x, y);
  const there = w.cells[i];
  if (there?.kind === "depot") return "The depot stands here";
  // Laying a thing over another of its kind only turns it, and costs nothing.
  if (there?.kind === kind && kind !== "tunnel") return null;
  if (there && !replaces(kind, there)) return "Something is here already";
  if (kind === "gatherer" && !w.land.deposit[i]) return "A gatherer must be placed on a deposit";
  if (kind === "wheel" && !besideWater(w.land, x, y)) return "A waterwheel must be beside the stream";
  if (kind === "tunnel" && !tunnelExit(w, x, y, dir, span))
    return depotInTheWay(w, x, y, dir, span)
      ? "A tunnel cannot go under the depot"
      : "A tunnel needs a free tile to come up on, 1 to 3 tiles ahead";
  if (coins < priceAt(w, kind, x, y)) return "Not enough Coins";
  return null;
}

/**
 * Builds something and says what it cost. A thing laid over another of its kind only turns it. A
 * splitter or a joiner set down on a belt (or on one another) takes its place: the piece that was
 * there goes back as if taken away, and what it was carrying and its colour stay. A tunnel is built
 * as its two mouths at once: in at this tile, and up at the nearest clear tile beyond (or `span`
 * tiles beyond, if given). A new belt or tunnel takes the colour of the line it joins (`join`).
 */
export function build(w: World, kind: Kind, x: number, y: number, dir: Dir, coins: number, span?: number): Spent {
  const why = refusal(w, kind, x, y, coins, dir, span);
  if (why !== null) return { ok: false, why };
  const i = at(w, x, y);
  const there = w.cells[i];
  if (there?.kind === kind) {
    if (there.dir !== dir) {
      there.dir = dir;
      changed(w);
    }
    return { ok: true, cost: 0 };
  }
  const made = blank(kind, dir);
  const cost = priceAt(w, kind, x, y);
  if ((w.spare[kind] ?? 0) > 0) {
    // One of the pieces the yard has to hand.
    made.free = true;
    w.spare[kind] = (w.spare[kind] ?? 0) - 1;
  }
  if (there) {
    if (there.free) w.spare[there.kind] = (w.spare[there.kind] ?? 0) + 1;
    made.item = there.item;
    made.prog = there.prog;
    made.via = there.via;
    made.tint = there.tint;
  }
  w.cells[i] = made;
  const laid = [i];
  if (kind === "tunnel") {
    const exit = tunnelExit(w, x, y, dir, span);
    if (exit) {
      made.span = exit.span;
      made.under = Array.from({ length: exit.span }, () => null);
      made.underProg = Array.from({ length: exit.span }, () => 0);
      const far = blank("tunnel", dir);
      far.span = -exit.span;
      laid.push(at(w, exit.x, exit.y));
      w.cells[at(w, exit.x, exit.y)] = far;
    }
  }
  changed(w);
  if (kind === "pylon") repower(w);
  if (kind === "belt" || kind === "tunnel") join(w, laid);
  return { ok: true, cost };
}

// ---------- colour ----------

const inLine = (b: Building | null | undefined): b is Building => b?.kind === "belt" || b?.kind === "tunnel";

/**
 * The belt or tunnel mouth a line comes onto a tile from, or -1: a tunnel's other mouth, the one
 * straight behind if it hands to this tile, or else the only one that does. So a belt that joins
 * the side of a line running straight on is a line of its own.
 */
function before(w: World, wire: Wire, j: number): number {
  const b = w.cells[j];
  if (!inLine(b)) return -1;
  const W = w.land.w;
  if (b.span < 0) return j + (b.span - 1) * (DX[b.dir] + DY[b.dir] * W);
  const from = [BACK[b.dir], LEFT[b.dir], RIGHT[b.dir]]
    .map((d) => at(w, (j % W) + DX[d], Math.floor(j / W) + DY[d]))
    .filter((k) => inLine(w.cells[k]) && wire.next[k] === j && takes(w, wire, j, k));
  return from.length === 1 || from[0] === wire.back[j] ? (from[0] ?? -1) : -1;
}

/** The belt or tunnel mouth a line goes on to from a tile, or -1. */
function after(w: World, wire: Wire, i: number): number {
  const j = wire.next[i] ?? -1;
  return before(w, wire, j) === i ? j : -1;
}

/**
 * The tiles that are coloured together with a tile: a splitter or a joiner by itself; a belt or a
 * tunnel mouth with its whole line, every belt and tunnel joined end to end with it both ways, as
 * far as the next thing that is neither. Nothing for anything else.
 */
export function lineOf(w: World, i: number): number[] {
  const b = w.cells[i];
  if (b?.kind === "splitter" || b?.kind === "joiner") return [i];
  if (!inLine(b)) return [];
  const wire = w.wire ?? rewire(w);
  const line = [i];
  for (const step of [after, before])
    for (let j = step(w, wire, i); j >= 0 && !line.includes(j); j = step(w, wire, j)) line.push(j);
  return line;
}

/** Gives the line through a tile a colour, 1 to 6, or with 0 takes it off. Says whether anything there can be coloured. */
export function paint(w: World, x: number, y: number, tint: number): boolean {
  const line = lineOf(w, at(w, x, y));
  for (const i of line) {
    const b = w.cells[i];
    if (b) b.tint = tint;
  }
  return line.length > 0;
}

/**
 * Gives tiles just laid, in any order, the colour of the line they join: the line that feeds them,
 * or else the line they feed.
 */
export function join(w: World, laid: readonly number[]): void {
  // No colour beside them, none to take: so a yard with no colour in it works nothing out here.
  const W = w.land.w;
  if (!laid.some((i) => [1, -1, W, -W].some((d) => (w.cells[i + d]?.tint ?? 0) > 0))) return;
  const wire = w.wire ?? rewire(w);
  const bare = new Set(laid.filter((i) => w.cells[i]?.tint === 0));
  for (const step of [before, after]) {
    // From each, along the tiles just laid to the first with a colour, going over no tile twice.
    const seen = new Set<number>();
    for (const i of bare) {
      const run: number[] = [];
      let j = i;
      for (; bare.has(j) && !seen.has(j); j = step(w, wire, j)) run.push(seen.add(j) && j);
      const tint = w.cells[j]?.tint ?? 0;
      for (const k of run) {
        const b = w.cells[k];
        if (b && tint > 0 && bare.delete(k)) b.tint = tint;
      }
    }
  }
}

/** Whether what stands on a tile can be turned: anything but the depot and a tunnel. */
export function turnable(w: World, x: number, y: number): boolean {
  const there = w.cells[at(w, x, y)];
  return there !== null && there !== undefined && there.kind !== "depot" && there.kind !== "tunnel";
}

/** Turns something to face another way. Costs nothing. A tunnel is not turned: take it away and dig again. */
export function turn(w: World, x: number, y: number, dir: Dir): boolean {
  const there = w.cells[at(w, x, y)];
  if (!there || !turnable(w, x, y)) return false;
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
  if (there.kind === "depot") return { ok: false, why: "The depot cannot be removed" };
  w.cells[i] = null;
  if (there.kind === "tunnel") {
    // Both mouths go together.
    const far = (Math.abs(there.span) + 1) * Math.sign(there.span);
    w.cells[at(w, x + DX[there.dir] * far, y + DY[there.dir] * far)] = null;
  }
  changed(w);
  if (there.kind === "pylon") repower(w);
  if (there.free) w.spare[there.kind] = (w.spare[there.kind] ?? 0) + 1;
  return { ok: true, refund: worth(there) };
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

/**
 * Shuts or opens one of a splitter's ways out: 0 for ahead, 1 for left, 2 for right. It sends
 * nothing to a shut way. Says whether there was a splitter.
 */
export function setWay(w: World, x: number, y: number, way: number, open: boolean): boolean {
  const there = w.cells[at(w, x, y)];
  if (there?.kind !== "splitter" || (way !== 0 && way !== 1 && way !== 2)) return false;
  const shut = open ? there.shut & ~(1 << way) : there.shut | (1 << way);
  if (there.shut !== shut) {
    there.shut = shut;
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
  if (state === "owned") return "You already own that plot";
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

/** Which story order puts a plan up for sale, as the yard counts them ("order 3"), and its title. */
function openedBy(id: PlanId): { n: number; title: string } | null {
  const i = STORY.findIndex((order) => order.opens.plans?.includes(id) === true);
  const order = STORY[i];
  return order ? { n: i + 1, title: order.title } : null;
}

/** Where a plan stands: owned, for sale now, or not yet (and why). */
export function planState(w: World, id: PlanId): { state: "owned" | "for sale" | "not yet"; why: string | null } {
  const plan = planOf(id);
  if (!plan) return { state: "not yet", why: "There is no such plan" };
  if (w.plans.includes(id)) return { state: "owned", why: null };
  if (!w.open.plans.has(id)) {
    const by = openedBy(id);
    const why = by ? `unlocks when you fill order ${by.n}: ${by.title}` : "unlocks later in the story";
    return { state: "not yet", why: `${plan.name} ${why}` };
  }
  const missing = plan.needs.find((n) => !w.plans.includes(n));
  if (missing !== undefined)
    return { state: "not yet", why: `${plan.name} needs ${planOf(missing)?.name ?? missing} first` };
  return { state: "for sale", why: null };
}

/** Why a plan cannot be bought with `coins` in the purse, or nothing if it can. */
export function planRefusal(w: World, id: PlanId, coins: number): string | null {
  const { state, why } = planState(w, id);
  if (state === "owned") return "You already have that plan";
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
