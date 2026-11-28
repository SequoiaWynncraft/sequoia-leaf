/**
 * Moving the yard on by one tick. Ten ticks are a second.
 *
 * A tick has three parts. Power: what burns for power burns (a boiler), and what there is is set
 * against what is drawn. Work: things on belts move along their tile, and every piece that works does
 * its work (a gatherer gathers, a machine makes, a Study studies). Handing on: every tile hands on
 * what it has finished with, each after the tile it hands to (`wire.ts`), so a full belt moves as one.
 * Then smog is counted every `SMOG.every` ticks, and on the beat, every 200 ticks in a yard that knows
 * the charger, every charged cell loses a bar (`beat.ts`).
 * Each step of a piece is its kind's (`kinds/`): this runs down the plumbing's lists and asks each
 * piece's kind for its step, and names no kind.
 *
 * Every number is whole. Work is counted in half-ticks: a machine at grade 1 does 2 a tick, at grade
 * 2 3 and at grade 3 4 (`PACE`), and a recipe of 12 ticks wants 24. Power is counted in halves. When the yard is short of power the machines work on only some
 * ticks: each tick the power there is goes into a store (`charge`), and when the store holds all
 * that is drawn it is spent and every gatherer and machine works that tick. So with 3 power of every
 * 4 drawn they work 3 ticks in 4, exactly, and nothing is lost over time. A yard with power enough
 * works every tick and keeps nothing in the store. A piece on a plot its smog slows works at a share of
 * its pace on each tick it works (`smog.ts`), so the two shares multiply, and never cancel out.
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
 * far mouth hands on. Nothing else in a tick changes what a waiting tile holds or
 * whether the tiles it hands to have room but a goal finished in it, which may let a crate hold more:
 * that lets the plumbing go (`changed`), and every waiting tile with it, at once, so no tile later in
 * the tick is passed over. A change from outside the tick works the plumbing out again, or is a
 * command, and either forgets every waiting tile. A thing refused by a tile whose ways in take turns
 * does not wait (`refused`).
 *
 * This is the hot path: it loops over the plumbing's lists, which hold only tiles where something
 * stands, and makes no arrays, objects, closures or strings (but for the rare order filled). A kind's
 * step is looked up in a table by the kind's number, one call for each piece that has a step.
 */
import { beat, beats } from "./beat.ts";
import { BURNS, type Burns } from "./burns.ts";
import { SMOG } from "./content/smog.ts";
import { handOut } from "./kinds/holder.ts";
import { carryOn } from "./kinds/line.ts";
import { RULES } from "./kinds/list.ts";
import { work as make } from "./kinds/maker.ts";
import { passUnder } from "./kinds/under.ts";
import { countSmog, FULL, smogged } from "./smog.ts";
import { CARRIES, ITEM_COUNT, NONE, PACE, SPAN_MOST, TIMES_MOST } from "./tables.ts";
import { KIT, rewire, roomAt } from "./wire.ts";
import { holderOf, take, tunnelOf, type Wire, type Yard } from "./yard.ts";

/**
 * Each kind's steps, by its number: in work and in handing on. A step many kinds share (a
 * belt's, a machine's) is called by its own name where a kind has it, not through the table: one
 * call site for a dozen kinds' steps costs the tick more than the steps.
 */
const WORK = RULES.map((r) => r.work);
const HANDS = RULES.map((r) => r.hands);

/** Moves the whole yard on by one tick. */
export function step(y: Yard): void {
  const wire = y.wire ?? rewire(y);
  const waiting = waitingOf(y, wire);
  y.tick++;
  const works = power(y, wire, waiting);
  carry(y, wire);
  carryUnder(y, wire);
  if (works) working(y, wire);
  handOn(y, wire, waiting);
  if (y.tick % SMOG.every === 0) countSmog(y);
  if (beats(y)) beat(y, wire);
}

/**
 * Power: what burns for power burns what it holds, as its kind says it burns (`KindDef.burns`): once
 * the last piece has burned out it takes another (`takeFuel`), and gives its power each tick one
 * burns. What there is is set against what is drawn. Says whether the pieces that work work this tick.
 */
function power(y: Yard, wire: Wire, waiting: Uint8Array): boolean {
  let supply = wire.steady;
  const h = y.holders;
  const burners = wire.burners;
  for (let b = 0; b < burners.length; b++) {
    const i = burners[b] ?? 0;
    const burns = BURNS[y.kind[i] ?? NONE];
    if (!burns) continue;
    const r = holderOf(y, i);
    if ((h.fuel[r] ?? 0) <= 0) takeFuel(y, i, r, burns, waiting);
    if ((h.fuel[r] ?? 0) > 0) {
      h.fuel[r] = (h.fuel[r] ?? 1) - 1;
      supply += burns.halves;
    }
  }
  y.supply = supply;
  const demand = wire.demand;
  const store = y.charge + supply;
  const works = store >= demand;
  y.charge = supply >= demand ? 0 : works ? store - demand : store;
  return works;
}

/**
 * A burner with nothing burning takes a piece of the first of its fuels it holds, if it holds any: it
 * burns for that fuel's ticks, adds its smog to the plot, and one with more than one fuel notes which
 * it burns (`Holders.making`), for its words.
 */
function takeFuel(y: Yard, i: number, r: number, burns: Burns, waiting: Uint8Array): void {
  const h = y.holders;
  const { fuels } = burns;
  for (let f = 0; f < fuels.length; f++) {
    const fuel = fuels[f];
    if (!fuel || (h.stock[r * ITEM_COUNT + fuel.fuel] ?? 0) === 0) continue;
    take(h, r, fuel.fuel);
    h.fuel[r] = fuel.ticks;
    if (fuels.length > 1) h.making[r] = fuel.fuel;
    if (fuel.smog > 0) smogged(y, i, fuel.smog);
    roomAt(y, i, waiting);
    return;
  }
}

/** Things on what carries (belts, splitters, joiners, sorters and tunnel mouths) move along, in eighths of a tile, each at its own grade's pace. */
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

/**
 * Every piece that works does its work, at its own grade's pace, in the plumbing's order: but one
 * holding as many finished things as it may (one, or for a machine that stands in for several, one for
 * each: `Holders.more`). While no plot is slowed (`Yard.smog.slowed`) that is all; while one is, each
 * piece reads its plot's pace, and one slowed works at its share of its pace (`workSlowed`).
 */
function working(y: Yard, wire: Wire): void {
  const workers = wire.work;
  if (y.smog.slowed === 0) {
    for (let c = 0; c < workers.length; c++) workOne(y, wire, workers[c] ?? 0);
    return;
  }
  const { pace } = y.smog;
  const plot = y.land.plot;
  for (let c = 0; c < workers.length; c++) {
    const i = workers[c] ?? 0;
    const quarters = pace[plot[i] ?? 0] ?? FULL;
    if (quarters < FULL) workSlowed(y, wire, i, quarters);
    else workOne(y, wire, i);
  }
}

/** The piece on the tile `i` does its work at its grade's pace, unless it holds as many finished things as it may. */
function workOne(y: Yard, wire: Wire, i: number): void {
  const h = y.holders;
  const r = holderOf(y, i);
  const k = y.kind[i] ?? NONE;
  if (h.out[r] !== NONE && (h.more[r] ?? 0) + 1 >= (TIMES_MOST[k] ?? 1)) return;
  const work = WORK[k];
  const speed = PACE[y.grade[i] ?? 0] ?? 0;
  if (work === make) make(KIT, y, i, r, speed, wire);
  else if (work) work(KIT, y, i, r, speed, wire);
}

/**
 * The piece on the tile `i`, on a plot its smog slows, does its work at `quarters` fourths of its
 * grade's pace, unless it holds as many finished things as it may: the quarters of a half-tick past
 * the whole ones are carried on its row (`Holders.quarter`) to its next tick's work, only on a tick it
 * works (one with nothing to work on carries nothing over), so it does exactly that share of its work.
 */
function workSlowed(y: Yard, wire: Wire, i: number, quarters: number): void {
  const h = y.holders;
  const r = holderOf(y, i);
  const k = y.kind[i] ?? NONE;
  if (h.out[r] !== NONE && (h.more[r] ?? 0) + 1 >= (TIMES_MOST[k] ?? 1)) return;
  const work = WORK[k];
  const q = (PACE[y.grade[i] ?? 0] ?? 0) * quarters + (h.quarter[r] ?? 0);
  if (work?.(KIT, y, i, r, q >> 2, wire)) h.quarter[r] = q & 3;
}

/**
 * Every tile hands on what it has finished with, each after the tiles it hands to: but a tile that
 * waits. A tile that carries hands on nothing until what it carries has crossed it (each carrier's
 * step asks it first, `kinds/line.ts`), so that is asked here, without the call. A way-in mouth of
 * what runs under tiles (a tunnel's) moves what is under the ground every tick, called by name.
 */
function handOn(y: Yard, wire: Wire, waiting: Uint8Array): void {
  const { kind, item, prog, span } = y;
  const order = wire.order;
  for (let o = 0; o < order.length; o++) {
    const i = order[o] ?? 0;
    if (waiting[i] === 1) continue;
    const k = kind[i] ?? NONE;
    if (CARRIES[k] === 1) {
      // A way-in mouth moves what is under the ground every tick (`kinds/under.ts`).
      if ((span[i] ?? 0) > 0) {
        passUnder(KIT, y, i, waiting);
        continue;
      }
      if (item[i] === NONE || (prog[i] ?? 0) < 8) continue;
    }
    const hands = HANDS[k];
    if (hands === carryOn) carryOn(KIT, y, i, wire);
    else if (hands === handOut) handOut(KIT, y, i, wire);
    else if (hands) hands(KIT, y, i, wire);
  }
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
