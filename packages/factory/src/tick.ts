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
 * A tile that could not hand on what it holds because the tile it hands to has no room waits
 * (`Wire.waiting`), and handing on passes it over: tried again, it would be refused again, and
 * nothing would change. It waits until a tile beside it may have room (`roomBeside`): something
 * handed on from it, taken from what it holds, or given to it, for a thing given to a machine may
 * narrow the recipes it keeps parts for and so make room for more of another part. A tunnel's
 * way-in mouth waits while it is full under the ground behind a far mouth with no room, until that
 * far mouth hands on (`passUnder`). Nothing else in a tick changes what a waiting tile holds or
 * whether the tiles it hands to have room but a goal finished in it, which may let a crate hold more:
 * that lets the plumbing go (`changed`), and every waiting tile with it, at once, so no tile later in
 * the tick is passed over. A change from outside the tick works the plumbing out again, or is a
 * command, and either forgets every waiting tile. A thing refused by a tile whose ways in take turns
 * does not wait (`refused`).
 *
 * This is the hot path: it loops over the plumbing's lists, which hold only tiles where something
 * stands, and makes no arrays, objects, closures or strings (but for the rare order filled).
 */
import { otherMouth } from "./build.ts";
import { BUFFER, FUEL, STUDY_HOLDS, TICKS } from "./content/machines.ts";
import { toward } from "./land.ts";
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
import { ahead, carries, farMouth, nextOf, rewire, sortWay, WAY_TURN, wayIn, wayOut } from "./wire.ts";
import { enough, holderOf, type Holders, put, take, tunnelOf, type Wire, type Yard } from "./yard.ts";

const BURNS = (GIVES[BOILER] ?? 0) * HALF;
const NO_RECIPES: readonly Recipe[] = [];

/** Moves the whole yard on by one tick. */
export function step(y: Yard): void {
  const wire = y.wire ?? rewire(y);
  const waiting = waitingOf(y, wire);
  y.tick++;
  const works = power(y, wire, waiting);
  carry(y, wire);
  carryUnder(y, wire);
  if (works) work(y, wire, waiting);
  handOn(y, wire, waiting);
}

/**
 * Power: boilers burn what they hold, and what there is is set against what is drawn. Says whether
 * the gatherers and machines work this tick.
 */
function power(y: Yard, wire: Wire, waiting: Uint8Array): boolean {
  const h = y.holders;
  let supply = wire.steady;
  const boilers = wire.boilers;
  for (let b = 0; b < boilers.length; b++) {
    const r = holderOf(y, boilers[b] ?? 0);
    if ((h.fuel[r] ?? 0) <= 0 && (h.stock[r * ITEM_COUNT + DEADFALL] ?? 0) > 0) {
      take(h, r, DEADFALL);
      h.fuel[r] = TICKS.burn;
      roomBeside(y, boilers[b] ?? 0, waiting);
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
  return works;
}

/** Things on belts, splitters, joiners, sorters and tunnel mouths move along, in eighths of a tile, each at its own grade's pace. */
function carry(y: Yard, wire: Wire): void {
  const { item, prog, grade } = y;
  const carriers = wire.carry;
  for (let c = 0; c < carriers.length; c++) {
    const i = carriers[c] ?? 0;
    if (item[i] !== NONE && (prog[i] ?? 0) < 8) prog[i] = (prog[i] ?? 0) + (PACE[grade[i] ?? 0] ?? 0);
  }
}

/** Things under the ground move along each tile a tunnel passes under, at the tunnel's pace. */
function carryUnder(y: Yard, wire: Wire): void {
  const { span, grade } = y;
  const under = y.tunnels.under;
  const below = y.tunnels.along;
  const mouths = wire.mouths;
  for (let c = 0; c < mouths.length; c++) {
    const i = mouths[c] ?? 0;
    const along = PACE[grade[i] ?? 0] ?? 0;
    const at = tunnelOf(y, i) * SPAN_MOST;
    const s = span[i] ?? 0;
    for (let k = at; k < at + s; k++) if (under[k] !== NONE && (below[k] ?? 0) < 8) below[k] = (below[k] ?? 0) + along;
  }
}

/** Gatherers gather and machines make, each at its own grade's pace. */
function work(y: Yard, wire: Wire, waiting: Uint8Array): void {
  const { kind, grade } = y;
  const h = y.holders;
  const workers = wire.work;
  for (let c = 0; c < workers.length; c++) {
    const i = workers[c] ?? 0;
    const r = holderOf(y, i);
    const speed = PACE[grade[i] ?? 0] ?? 0;
    if (h.out[r] !== NONE) continue;
    if (kind[i] === STUDY) {
      learn(y, i, r, speed, waiting);
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
      roomBeside(y, i, waiting);
    }
  }
}

/**
 * Every tile hands on what it has finished with, each after the tiles it hands to: but a tile that
 * waits, and one with nothing finished. A tunnel's way-in mouth moves what is under the ground too.
 */
function handOn(y: Yard, wire: Wire, waiting: Uint8Array): void {
  const { kind, item, prog, span } = y;
  const h = y.holders;
  const order = wire.order;
  for (let o = 0; o < order.length; o++) {
    const i = order[o] ?? 0;
    if (waiting[i] === 1) continue;
    const k = kind[i] ?? NONE;
    if (k === TUNNEL && (span[i] ?? 0) > 0) passUnder(y, i, waiting);
    else if (carries(k)) {
      if (item[i] === NONE || (prog[i] ?? 0) < 8) continue;
      if (k === SPLITTER) split(y, i, wire);
      else if (k === SORTER) sort(y, i, wire);
      else carryOn(y, i, wire);
    } else {
      const r = holderOf(y, i);
      if (k === CRATE) letOut(y, i, r, wire);
      else if (h.out[r] !== NONE) sendOut(y, i, r, wire);
    }
  }
}

/** An open crate lets out whatever it holds most of, one at a time. */
function letOut(y: Yard, i: number, r: number, wire: Wire): void {
  const h = y.holders;
  if (h.open[r] === 0) return;
  if (h.out[r] === NONE && (h.count[r] ?? 0) > 0) {
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
      roomBeside(y, i, wire.waiting);
    }
  }
  if (h.out[r] !== NONE) sendOut(y, i, r, wire);
}

/**
 * A Study works as a machine does, on one folio at a time that the research being studied still
 * wants, and when it is done the folio goes toward the research. One the research has stopped wanting
 * meanwhile (another Study gave it the last) stays in the Study.
 */
function learn(y: Yard, i: number, r: number, speed: number, waiting: Uint8Array): void {
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
  if (giveGoal(y, g, n, 1) > 0) {
    take(h, r, n);
    roomBeside(y, i, waiting);
  }
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
    return nextOf(y, i) === to && handsOn(y, i);
  return false;
}

/** Whether a gatherer, machine or crate has its finished piece out to hand on: a shut crate lets nothing out (`step`). */
function handsOn(y: Yard, i: number): boolean {
  const r = holderOf(y, i);
  return y.holders.out[r] !== NONE && (y.kind[i] !== CRATE || y.holders.open[r] === 1);
}

/** Which of a joiner's ways in (0 behind, 1 left, 2 right) is on the side `side` of it, or -1 for ahead. */
function wayInOn(y: Yard, to: number, side: number): number {
  const d = y.dir[to] ?? 0;
  return side === ((d + 2) & 3) ? 0 : side === ((d + 3) & 3) ? 1 : side === ((d + 1) & 3) ? 2 : -1;
}

/** A splitter's way in on each side, by how far round from ahead it is in quarter turns right: 1 ahead, 3 right, 0 behind, 2 left. */
const SLOT_ON = [1, 3, 0, 2] as const;

/**
 * Which of its ways in is on the side `side` of a joiner (0 behind, 1 left, 2 right) or of a splitter
 * (0 behind, then 1 + its way out turned in: 1 ahead, 2 left, 3 right), in the order they take turns.
 */
const slotOn = (y: Yard, to: number, side: number): number =>
  y.kind[to] === JOINER ? wayInOn(y, to, side) : (SLOT_ON[(side - (y.dir[to] ?? 0)) & 3] ?? 0);

/** The tile a joiner's or a splitter's way in `s` (as `slotOn` numbers them) takes from; -1 for a splitter's way that takes nothing in. */
function slotTile(y: Yard, to: number, s: number): number {
  if (y.kind[to] === JOINER || s === 0) return wayIn(y, to, s);
  const way = s - 1;
  return ((y.ins[to] ?? 0) >> way) & 1 ? toward(y.land, to, (y.dir[to] ?? 0) + (WAY_TURN[way] ?? 0)) : -1;
}

/**
 * Whether a joiner, or a splitter with ways in, takes a thing in on its side `side` now. Its ways in
 * take turns: it waits for whoever's turn it is, so long as they have something ready to give. A
 * splitter that takes in from behind alone takes whatever comes. A splitter keeps its next way in
 * over its next way out in `turn` (`(turn >> 2)`, `turn & 3`).
 */
function onTurn(y: Yard, to: number, side: number): boolean {
  const joiner = y.kind[to] === JOINER;
  if (!joiner && (y.ins[to] ?? 0) === 0) return true;
  const slot = slotOn(y, to, side);
  if (slot < 0) return false;
  const ways = joiner ? 3 : 4;
  const turn = joiner ? (y.turn[to] ?? 0) : (y.turn[to] ?? 0) >> 2;
  for (let s = turn % ways; s !== slot; s = (s + 1) % ways) if (ready(y, slotTile(y, to, s), to)) return false;
  return true;
}

/** Once a joiner, or a splitter with ways in, has taken a thing in on its side `side`, the turn is the next way in's. */
function turnOn(y: Yard, to: number, side: number): void {
  const next = slotOn(y, to, side) + 1;
  if (y.kind[to] === JOINER) y.turn[to] = next % 3;
  else if ((y.ins[to] ?? 0) !== 0) y.turn[to] = ((next % 4) << 2) | ((y.turn[to] ?? 0) & 3);
}

/**
 * Whether the tile at `to` will take the thing `n` handed to it from the tile beside it on its side
 * `side` (a way), by the plumbing: which sides each tile takes from, and what each machine may make.
 */
function accepts(y: Yard, to: number, n: number, side: number, wire: Wire): boolean {
  if (to < 0 || (((wire.taken[to] ?? 0) >> side) & 1) === 0) return false;
  const k = y.kind[to];
  if (k === DEPOT || k === STOP) return true;
  if (k === BELT || k === TUNNEL || k === SORTER) return y.item[to] === NONE;
  if (k === JOINER || k === SPLITTER) return y.item[to] === NONE && onTurn(y, to, side);
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
function give(y: Yard, to: number, n: number, side: number, over: number, waiting: Uint8Array): void {
  const k = y.kind[to];
  if (k === DEPOT || k === STOP) {
    deliver(y, n, 1);
    return;
  }
  if (k === JOINER || k === SPLITTER) turnOn(y, to, side);
  if (k === JOINER || k === BELT || k === SPLITTER || k === TUNNEL || k === SORTER) {
    y.item[to] = n;
    y.prog[to] = over;
    y.via[to] = 1 + side;
    return;
  }
  put(y.holders, holderOf(y, to), n);
  roomBeside(y, to, waiting);
}

/** Moves what is under a tunnel along, and brings it up at the far mouth. */
function passUnder(y: Yard, i: number, waiting: Uint8Array): void {
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
    roomBeside(y, i, waiting);
  }
  if (jammed(y, i, at, last)) waiting[i] = 1;
}

/**
 * Whether a tunnel is full under the ground, everything across its tile, behind its own far mouth:
 * nothing in it moved, as the far mouth had no room, and nothing will until that mouth hands on
 * (`roomBeside`), whatever comes in at the way-in mouth meanwhile.
 */
function jammed(y: Yard, i: number, at: number, last: number): boolean {
  const { under, along } = y.tunnels;
  for (let k = at; k <= last; k++) if (under[k] === NONE || (along[k] ?? 0) < 8) return false;
  return otherMouth(y, farMouth(y, i)) === i;
}

/** A belt, joiner or tunnel's far mouth hands on the thing it carries, which has crossed the tile. */
function carryOn(y: Yard, i: number, wire: Wire): void {
  const to = ahead(y, i);
  if (!passTo(y, i, to, ((y.dir[i] ?? 0) + 2) & 3, wire)) refused(y, i, to, wire);
}

/**
 * A splitter sends what it carries to its ways out in turn: ahead, left, right, from the way after
 * the last. One with a way put first sends it that way whenever the tile there takes it, and only
 * otherwise to the others in turn.
 */
function split(y: Yard, i: number, wire: Wire): void {
  const first = (y.first[i] ?? 0) - 1;
  if (first >= 0 && pass(y, i, first, wire)) return;
  // Its next way out is under its next way in (`onTurn`).
  const turn = (y.turn[i] ?? 0) & 3;
  for (let k = 0; k < 3; k++) {
    const way = (k + turn) % 3;
    if (way === first || !pass(y, i, way, wire)) continue;
    y.turn[i] = ((y.turn[i] ?? 0) & ~3) | ((way + 1) % 3);
    return;
  }
  // Refused every way it sends: it waits, unless one of them takes turns.
  for (let way = 0; way < 3; way++) if (takesTurns(y, wayOut(y, i, way))) return;
  wire.waiting[i] = 1;
}

/** Hands what a splitter or sorter carries to its way out `way`, if the tile there takes it. Says whether it did. */
const pass = (y: Yard, i: number, way: number, wire: Wire): boolean =>
  passTo(y, i, wayOut(y, i, way), ((y.dir[i] ?? 0) + (way === 0 ? 2 : way === 1 ? 1 : 3)) & 3, wire);

/** The way a sorter sends what it carries: the thing it is set to to its side (`sortWay`), anything else ahead. */
const sortedWay = (y: Yard, i: number): number => (y.item[i] === y.set[i] ? sortWay(y, i) : 0);
const sortedTo = (y: Yard, i: number): number => wayOut(y, i, sortedWay(y, i));

/** A sorter hands on what it carries, which has crossed the tile, the one way it goes, when the tile there takes it. */
function sort(y: Yard, i: number, wire: Wire): void {
  if (!pass(y, i, sortedWay(y, i), wire)) refused(y, i, sortedTo(y, i), wire);
}

/**
 * Hands what the tile at `i` carries to the tile at `to`, which it comes into by its side `side`, if
 * that tile takes it, with how far past the edge it had come. Says whether it did.
 */
function passTo(y: Yard, i: number, to: number, side: number, wire: Wire): boolean {
  const n = y.item[i] ?? NONE;
  if (!accepts(y, to, n, side, wire)) return false;
  give(y, to, n, side, (y.prog[i] ?? 8) - 8, wire.waiting);
  y.item[i] = NONE;
  y.prog[i] = 0;
  y.via[i] = 0;
  roomBeside(y, i, wire.waiting);
  return true;
}

/** A gatherer, machine or crate hands on its finished piece. */
function sendOut(y: Yard, i: number, r: number, wire: Wire): void {
  const h = y.holders;
  const n = h.out[r] ?? NONE;
  const to = ahead(y, i);
  const side = ((y.dir[i] ?? 0) + 2) & 3;
  if (!accepts(y, to, n, side, wire)) {
    refused(y, i, to, wire);
    return;
  }
  give(y, to, n, side, 0, wire.waiting);
  h.out[r] = NONE;
  roomBeside(y, i, wire.waiting);
}

// ---------- waiting ----------

/** The tiles that wait: none, if a command has changed the yard since they were last forgotten. */
function waitingOf(y: Yard, wire: Wire): Uint8Array {
  if (wire.waitingFrom !== y.rev) {
    wire.waiting.fill(0);
    wire.waitingFrom = y.rev;
  }
  return wire.waiting;
}

/**
 * The tile at `i` could not hand on what it holds to the tile at `to`, which had no room for it: it
 * waits. Not at a tile whose ways in take turns, which may let it in once the thing whose turn it is
 * goes another way, with nothing beside that tile changed; there it tries again each tick.
 */
function refused(y: Yard, i: number, to: number, wire: Wire): void {
  if (!takesTurns(y, to)) wire.waiting[i] = 1;
}

/** Whether the tile at `to` lets things in by turns: a joiner, or a splitter with ways in. */
const takesTurns = (y: Yard, to: number): boolean =>
  to >= 0 && (y.kind[to] === JOINER || (y.kind[to] === SPLITTER && (y.ins[to] ?? 0) !== 0));

/**
 * The tile at `i` may have room for more, or for another thing: the tiles that may hand to it stop
 * waiting. They are the tiles beside it, and for a tunnel's far mouth, its way-in mouth. Each side is
 * woken without asking first whether it is on the map, which every hand-off would pay for: past the
 * end of a row is a tile at the other end of the next, which at worst tries again for nothing, and
 * past the top or bottom row is outside the array, where writing does nothing.
 */
function roomBeside(y: Yard, i: number, waiting: Uint8Array): void {
  const w = y.land.w;
  waiting[i + 1] = 0;
  waiting[i - 1] = 0;
  waiting[i + w] = 0;
  waiting[i - w] = 0;
  if (y.kind[i] === TUNNEL && (y.span[i] ?? 0) < 0) {
    const mouth = otherMouth(y, i);
    if (mouth >= 0) waiting[mouth] = 0;
  }
}
