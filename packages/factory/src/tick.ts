/**
 * Moving the yard on by one tick. Ten ticks are a second.
 *
 * A tick has three parts. Power: boilers burn, and what there is is set against
 * what is drawn. Work: things on belts move along their tile, gatherers gather, machines make.
 * Handing on: every tile hands on what it has finished with, each after the tile it hands to
 * (`wire.ts`), so a full belt moves as one.
 *
 * Every number is whole. Work is counted in half-ticks: a machine at grade 1 does 2 a tick, at grade
 * 2 3 and at grade 3 4 (`PACE`), and a recipe of 12 ticks wants 24. Power is counted in halves. When the yard is short of power the machines work on only some
 * ticks: each tick the power there is goes into a store (`charge`), and when the store holds all
 * that is drawn it is spent and every gatherer and machine works that tick. So with 3 power of every
 * 4 drawn they work 3 ticks in 4, exactly, and nothing is lost over time. A yard with power enough
 * works every tick and keeps nothing in the store.
 *
 * A machine makes, and takes parts in for, only the recipes the plumbing says it may (`Wire.recipes`,
 * asked of `locked` when the plumbing is worked out).
 *
 * This is the hot path: it loops over the plumbing's lists, which hold only tiles where something
 * stands, and makes no arrays, objects, closures or strings (but for the rare order filled).
 */
import { BUFFER, FUEL, STUDY_HOLDS, TICKS } from "./content/machines.ts";
import { deliver, giveGoal } from "./orders.ts";
import {
  BELT,
  BENCH,
  BOILER,
  CRATE,
  DEADFALL,
  DEPOT,
  FOLIOS,
  GATHERER,
  GIVES,
  type Goal,
  GOALS,
  HALF,
  isFolio,
  ITEM_COUNT,
  JOINER,
  MILL,
  NONE,
  PACE,
  RECIPE,
  type Recipe,
  SORTER,
  SPAN_MOST,
  SPLITTER,
  STOP,
  STUDY,
  TUNNEL,
  WORK,
  WORKSHOP,
} from "./tables.ts";
import { ahead, farMouth, nextOf, rewire, sortWay, wayIn, wayOut } from "./wire.ts";
import { enough, holderOf, type Holders, put, take, tunnelOf, type Wire, type Yard } from "./yard.ts";

const BURNS = (GIVES[BOILER] ?? 0) * HALF;
const NO_RECIPES: readonly Recipe[] = [];
const NO_TILES = new Int32Array(0);

/** Moves the whole yard on by one tick. */
export function step(y: Yard): void {
  const wire = y.wire ?? rewire(y);
  const { kind, item, prog, span } = y;
  const h = y.holders;
  y.tick++;

  // Power: boilers burn what they hold, and what there is is set against what is drawn.
  let supply = wire.steady;
  const boilers = wire.boilers;
  for (let b = 0; b < boilers.length; b++) {
    const r = holderOf(y, boilers[b] ?? 0);
    if ((h.fuel[r] ?? 0) <= 0 && (h.stock[r * ITEM_COUNT + DEADFALL] ?? 0) > 0) {
      take(h, r, DEADFALL);
      h.fuel[r] = TICKS.burn;
    }
    if ((h.fuel[r] ?? 0) > 0) {
      h.fuel[r] = (h.fuel[r] ?? 1) - 1;
      supply += BURNS;
    }
  }
  y.supply = supply;
  const demand = wire.demand;
  const store = y.charge + supply;
  const works = store >= demand;
  y.charge = supply >= demand ? 0 : works ? store - demand : store;

  // Work: things on belts move along (in eighths of a tile), gatherers gather, machines make, each
  // at its own grade's pace.
  const grade = y.grade;
  const carry = wire.carry;
  const under = y.tunnels.under;
  const below = y.tunnels.along;
  for (let c = 0; c < carry.length; c++) {
    const i = carry[c] ?? 0;
    const along = PACE[grade[i] ?? 0] ?? 0;
    if (item[i] !== NONE && (prog[i] ?? 0) < 8) prog[i] = (prog[i] ?? 0) + along;
    const t = tunnelOf(y, i);
    if (t < 0) continue;
    const s = span[i] ?? 0;
    const at = t * SPAN_MOST;
    for (let k = at; k < at + s; k++) if (under[k] !== NONE && (below[k] ?? 0) < 8) below[k] = (below[k] ?? 0) + along;
  }
  const work = works ? wire.work : NO_TILES;
  for (let c = 0; c < work.length; c++) {
    const i = work[c] ?? 0;
    const r = holderOf(y, i);
    const speed = PACE[grade[i] ?? 0] ?? 0;
    if (h.out[r] !== NONE) continue;
    if (kind[i] === STUDY) {
      learn(y, r, speed);
      continue;
    }
    if (kind[i] === GATHERER) {
      h.work[r] = (h.work[r] ?? 0) + speed;
      if ((h.work[r] ?? 0) >= WORK.gather) {
        h.work[r] = (h.work[r] ?? 0) - WORK.gather;
        h.out[r] = y.land.deposit[i] ?? NONE;
      }
      continue;
    }
    if (h.making[r] === NONE) {
      if (h.idle[r] === 1) continue;
      const found = choose(h, r, wire.recipes[kind[i] ?? NONE] ?? NO_RECIPES, y.set[i] ?? NONE);
      if (found === NONE) {
        h.idle[r] = 1;
        continue;
      }
      h.making[r] = found;
    }
    const recipe = RECIPE[h.making[r] ?? NONE];
    if (!recipe) continue;
    h.work[r] = (h.work[r] ?? 0) + speed;
    if ((h.work[r] ?? 0) >= recipe.work) {
      h.work[r] = (h.work[r] ?? 0) - recipe.work;
      for (let p = 0; p < recipe.from.length; p++) take(h, r, recipe.from[p] ?? NONE, recipe.need[p] ?? 1);
      h.out[r] = recipe.out;
      h.making[r] = NONE;
    }
  }

  // Then hand things on.
  const order = wire.order;
  for (let o = 0; o < order.length; o++) {
    const i = order[o] ?? 0;
    const k = kind[i];
    if (k === TUNNEL) {
      if ((span[i] ?? 0) > 0) passUnder(y, i);
      else carryOn(y, i, wire);
    } else if (k === BELT || k === JOINER) carryOn(y, i, wire);
    else if (k === SPLITTER) split(y, i, wire);
    else if (k === SORTER) sort(y, i, wire);
    else {
      const r = holderOf(y, i);
      if (k === CRATE) {
        if (h.open[r] === 0) continue;
        if (h.out[r] === NONE && (h.count[r] ?? 0) > 0) {
          // It lets out whatever it holds most of.
          let most = NONE;
          let mostHas = 0;
          for (let n = 0; n < ITEM_COUNT; n++) {
            const has = h.stock[r * ITEM_COUNT + n] ?? 0;
            if (has > mostHas) {
              most = n;
              mostHas = has;
            }
          }
          if (most !== NONE) {
            take(h, r, most);
            h.out[r] = most;
          }
        }
      }
      sendOut(y, i, r, wire);
    }
  }
}

/**
 * A Study works as a machine does, on one folio at a time that the research being studied still
 * wants, and when it is done the folio goes toward the research. One the research has stopped wanting
 * meanwhile (another Study gave it the last) stays in the Study.
 */
function learn(y: Yard, r: number, speed: number): void {
  const g = y.line[0];
  if (g === undefined) return;
  const h = y.holders;
  if (h.making[r] === NONE) {
    if (h.idle[r] === 1) return;
    const found = wanted(y, g, h, r);
    if (found === NONE) {
      h.idle[r] = 1;
      return;
    }
    h.making[r] = found;
  }
  h.work[r] = (h.work[r] ?? 0) + speed;
  if ((h.work[r] ?? 0) < WORK.study) return;
  h.work[r] = (h.work[r] ?? 0) - WORK.study;
  const n = h.making[r] ?? NONE;
  h.making[r] = NONE;
  if (giveGoal(y, g, n, 1) > 0) take(h, r, n);
}

/** The first folio a Study holds that a piece of research still wants, or `NONE`. */
function wanted(y: Yard, g: Goal, h: Holders, r: number): number {
  const want = GOALS[g]?.want;
  const got = y.got[g];
  if (!want || !got) return NONE;
  for (let f = 0; f < FOLIOS.length; f++) {
    const n = FOLIOS[f] ?? NONE;
    if ((h.stock[r * ITEM_COUNT + n] ?? 0) > 0 && (want[n] ?? 0) > (got[n] ?? 0)) return n;
  }
  return NONE;
}

/**
 * The recipe a machine can start on with what it holds, by what it makes, or `NONE`: the first of
 * those it may make, or the one it is told to make (`only`), with as many of each part as it takes.
 */
function choose(h: Holders, r: number, recipes: readonly Recipe[], only: number): number {
  for (let n = 0; n < recipes.length; n++) {
    const recipe = recipes[n];
    if (recipe && (only === NONE || recipe.out === only) && enough(h, r, recipe)) return recipe.out;
  }
  return NONE;
}

/** Whether the tile at `i` has something finished that it means to hand to the tile at `to`. */
function ready(y: Yard, i: number, to: number): boolean {
  if (i < 0) return false;
  const k = y.kind[i];
  if (k === BELT || k === JOINER || k === TUNNEL)
    return nextOf(y, i) === to && y.item[i] !== NONE && (y.prog[i] ?? 0) >= 8;
  if (k === SPLITTER)
    return (
      y.item[i] !== NONE &&
      (y.prog[i] ?? 0) >= 8 &&
      (wayOut(y, i, 0) === to || wayOut(y, i, 1) === to || wayOut(y, i, 2) === to)
    );
  if (k === SORTER) return y.item[i] !== NONE && (y.prog[i] ?? 0) >= 8 && sortedTo(y, i) === to;
  if (k === GATHERER || k === MILL || k === BENCH || k === WORKSHOP || k === CRATE)
    return nextOf(y, i) === to && y.holders.out[holderOf(y, i)] !== NONE;
  return false;
}

/** Which of a joiner's ways in (0 behind, 1 left, 2 right) is on the side `side` of it, or -1 for ahead. */
function wayInOn(y: Yard, to: number, side: number): number {
  const d = y.dir[to] ?? 0;
  return side === ((d + 2) & 3) ? 0 : side === ((d + 3) & 3) ? 1 : side === ((d + 1) & 3) ? 2 : -1;
}

/**
 * Whether the tile at `to` will take the thing `n` handed to it from the tile beside it on its side
 * `side` (a way), by the plumbing: which sides each tile takes from, and what each machine may make.
 */
function accepts(y: Yard, to: number, n: number, side: number, wire: Wire): boolean {
  if (to < 0 || (((wire.taken[to] ?? 0) >> side) & 1) === 0) return false;
  const k = y.kind[to];
  if (k === DEPOT || k === STOP) return true;
  if (k === BELT || k === SPLITTER || k === TUNNEL || k === SORTER) return y.item[to] === NONE;
  if (k === JOINER) {
    if (y.item[to] !== NONE) return false;
    const way = wayInOn(y, to, side);
    if (way < 0) return false;
    // It waits for whoever's turn it is, so long as they have something to give.
    for (let w = y.turn[to] ?? 0; w !== way; w = (w + 1) % 3) if (ready(y, wayIn(y, to, w), to)) return false;
    return true;
  }
  const h = y.holders;
  const r = holderOf(y, to);
  const have = h.stock[r * ITEM_COUNT + n] ?? 0;
  if (k === MILL || k === BENCH || k === WORKSHOP) {
    // It takes a thing that some recipe it may make uses together with everything it holds, while it
    // holds fewer than `BUFFER` of the fewest of it any such recipe takes.
    const recipes = wire.recipes[k] ?? NO_RECIPES;
    const only = y.set[to] ?? NONE;
    let least = 0;
    for (let c = 0; c < recipes.length; c++) {
      const recipe = recipes[c];
      if (!recipe || (only !== NONE && recipe.out !== only)) continue;
      let need = 0;
      let held = 0;
      for (let p = 0; p < recipe.from.length; p++) {
        const part = recipe.from[p] ?? NONE;
        if (part === n) need = recipe.need[p] ?? 0;
        if ((h.stock[r * ITEM_COUNT + part] ?? 0) > 0) held++;
      }
      if (need > 0 && held === h.kinds[r] && (least === 0 || need < least)) least = need;
    }
    return have < BUFFER * least;
  }
  if (k === CRATE) return (h.count[r] ?? 0) + (h.out[r] === NONE ? 0 : 1) < y.open.crate;
  if (k === BOILER) return n === DEADFALL && have < FUEL;
  if (k === STUDY) return isFolio(n) && have < STUDY_HOLDS;
  return false;
}

/**
 * Hands the thing `n` to the tile at `to` from the tile beside it on its side `side` (a way).
 * `over` is how far past the edge of its last tile it had already come, in eighths.
 */
function give(y: Yard, to: number, n: number, side: number, over: number): void {
  const k = y.kind[to];
  if (k === DEPOT || k === STOP) {
    deliver(y, n, 1);
    return;
  }
  if (k === JOINER) {
    const way = wayInOn(y, to, side);
    y.turn[to] = way + 1 > 2 ? 0 : way + 1;
  }
  if (k === JOINER || k === BELT || k === SPLITTER || k === TUNNEL || k === SORTER) {
    y.item[to] = n;
    y.prog[to] = over;
    y.via[to] = 1 + side;
    return;
  }
  put(y.holders, holderOf(y, to), n);
}

/** Moves what is under a tunnel along, and brings it up at the far mouth. */
function passUnder(y: Yard, i: number): void {
  const under = y.tunnels.under;
  const along = y.tunnels.along;
  const at = tunnelOf(y, i) * SPAN_MOST;
  const last = at + (y.span[i] ?? 0) - 1;
  const mouth = farMouth(y, i);
  for (let k = last; k >= at; k--) {
    const n = under[k] ?? NONE;
    const over = (along[k] ?? 0) - 8;
    if (n === NONE || over < 0) continue;
    if (k === last) {
      if (mouth < 0 || y.kind[mouth] === NONE || y.item[mouth] !== NONE) continue;
      y.item[mouth] = n;
      y.prog[mouth] = over;
      y.via[mouth] = 0;
    } else {
      if (under[k + 1] !== NONE) continue;
      under[k + 1] = n;
      along[k + 1] = over;
    }
    under[k] = NONE;
    along[k] = 0;
  }
  if (y.item[i] !== NONE && (y.prog[i] ?? 0) >= 8 && under[at] === NONE) {
    under[at] = y.item[i] ?? NONE;
    along[at] = (y.prog[i] ?? 8) - 8;
    y.item[i] = NONE;
    y.prog[i] = 0;
    y.via[i] = 0;
  }
}

/** A belt, joiner or tunnel's far mouth hands on the thing it carries once it has crossed the tile. */
function carryOn(y: Yard, i: number, wire: Wire): void {
  const n = y.item[i] ?? NONE;
  if (n === NONE || (y.prog[i] ?? 0) < 8) return;
  const to = ahead(y, i);
  const side = ((y.dir[i] ?? 0) + 2) & 3;
  if (!accepts(y, to, n, side, wire)) return;
  give(y, to, n, side, (y.prog[i] ?? 8) - 8);
  y.item[i] = NONE;
  y.prog[i] = 0;
  y.via[i] = 0;
}

/**
 * A splitter sends what it carries to its ways out in turn: ahead, left, right, from the way after
 * the last. One with a way put first sends it that way whenever the tile there takes it, and only
 * otherwise to the others in turn.
 */
function split(y: Yard, i: number, wire: Wire): void {
  const n = y.item[i] ?? NONE;
  if (n === NONE || (y.prog[i] ?? 0) < 8) return;
  const first = (y.first[i] ?? 0) - 1;
  if (first >= 0 && pass(y, i, n, first, wire)) return;
  const turn = y.turn[i] ?? 0;
  for (let k = 0; k < 3; k++) {
    const way = (k + turn) % 3;
    if (way === first || !pass(y, i, n, way, wire)) continue;
    y.turn[i] = (way + 1) % 3;
    return;
  }
}

/** Hands the thing `n` a splitter or sorter carries to its way out `way`, if the tile there takes it. Says whether it did. */
function pass(y: Yard, i: number, n: number, way: number, wire: Wire): boolean {
  const to = wayOut(y, i, way);
  const side = ((y.dir[i] ?? 0) + (way === 0 ? 2 : way === 1 ? 1 : 3)) & 3;
  if (!accepts(y, to, n, side, wire)) return false;
  give(y, to, n, side, (y.prog[i] ?? 8) - 8);
  y.item[i] = NONE;
  y.prog[i] = 0;
  y.via[i] = 0;
  return true;
}

/** The way a sorter sends what it carries: the thing it is set to to its side (`sortWay`), anything else ahead. */
const sortedWay = (y: Yard, i: number): number => (y.item[i] === y.set[i] ? sortWay(y, i) : 0);
const sortedTo = (y: Yard, i: number): number => wayOut(y, i, sortedWay(y, i));

/** A sorter hands on what it carries, once it has crossed the tile, the one way it goes, when the tile there takes it. */
function sort(y: Yard, i: number, wire: Wire): void {
  const n = y.item[i] ?? NONE;
  if (n !== NONE && (y.prog[i] ?? 0) >= 8) pass(y, i, n, sortedWay(y, i), wire);
}

/** A gatherer, machine or crate hands on its finished piece. */
function sendOut(y: Yard, i: number, r: number, wire: Wire): void {
  const h = y.holders;
  const n = h.out[r] ?? NONE;
  if (n === NONE) return;
  const to = ahead(y, i);
  const side = ((y.dir[i] ?? 0) + 2) & 3;
  if (!accepts(y, to, n, side, wire)) return;
  give(y, to, n, side, 0);
  h.out[r] = NONE;
}
