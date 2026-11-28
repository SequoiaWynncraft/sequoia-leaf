/**
 * A yard as plain values, for the goldens and the stored rows: what the rules left, never how a yard
 * is stored. A piece is where it stands from the yard plot's corner and its kind's name, a thing its
 * name, a goal its id, so that more land round the yard, or a new tier's content anywhere in the
 * tables, moves nothing of a yard that never uses it.
 *
 * `material` is what a stored row must read as for ever: every piece with what it holds and is set
 * to, the Coins, the depot and what the owner last saw of it, plots, clearings, smog, redwoods felled,
 * goals, research, orders, blueprints and the away letter. A row keeps the material it was written
 * from, and is held to each part of it it keeps: a part added here later holds no row written before.
 * `yardState` is that and the clock, the power as the page reads it, Undo's entries and what the yard
 * would tell its owner of their time away, for the goldens.
 */
import * as F from "../src/index.ts";
import { OWN } from "../src/sizes.ts";

export const itemOf = (n: number): string | null => (F.isItem(n) ? F.itemName(n) : null);
const goalOf = (g: number): string => F.GOALS[g]?.id ?? `goal ${g}`;
const plotOf = (p: F.Plot): string => F.plotName(p);
const byName = ([a]: readonly [string, number], [b]: readonly [string, number]): number => (a < b ? -1 : 1);
/** A count of each thing, by name, in the names' order: none of what there is none of. */
export const tallied = (c: F.Counts): [string, number][] =>
  F.ALL_ITEMS.flatMap((n): [string, number][] => ((c[n] ?? 0) > 0 ? [[F.itemName(n), c[n] ?? 0]] : [])).toSorted(
    byName,
  );
/** Where a tile is from the yard plot's corner. */
const placeOf = (y: F.Yard, i: number): [number, number] => [
  (i % y.land.w) - y.land.origin[0],
  Math.floor(i / y.land.w) - y.land.origin[1],
];

/** What a holder holds and is doing; not what it found last time it looked, which it works out again. */
function holding(y: F.Yard, i: number): unknown {
  const h = y.holders;
  const r = F.holderOf(y, i);
  if (r < 0) return null;
  const stock = F.ALL_ITEMS.flatMap((n): [string, number][] =>
    F.held(h, r, n) > 0 ? [[F.itemName(n), F.held(h, r, n)]] : [],
  ).toSorted(byName);
  const [out, also, making] = [h.out[r] ?? F.NONE, h.also[r] ?? F.NONE, h.making[r] ?? F.NONE];
  return {
    out: itemOf(out),
    also: itemOf(also),
    more: h.more[r],
    making: itemOf(making),
    work: h.work[r],
    mix: h.mix[r],
    quarter: h.quarter[r],
    open: h.open[r],
    fuel: h.fuel[r],
    stock,
  };
}
/** What a tunnel's way-in mouth carries under the ground. */
function under(y: F.Yard, i: number): unknown {
  const r = F.tunnelOf(y, i);
  const span = y.span[i] ?? 0;
  if (r < 0 || span <= 0) return null;
  const at = r * F.SPAN_MOST;
  return [[...y.tunnels.under.subarray(at, at + span)].map(itemOf), [...y.tunnels.along.subarray(at, at + span)]];
}
/** A piece on its own tile: where, what, how it is set, what it carries, holds and is doing. */
function piece(y: F.Yard, i: number): unknown {
  const k = y.kind[i] ?? F.NONE;
  if (!F.isKind(k)) return [];
  return {
    at: placeOf(y, i),
    kind: F.kindName(k),
    set: [y.dir[i], y.grade[i], y.tint[i], y.turn[i], y.shut[i], y.first[i], y.ins[i], itemOf(y.set[i] ?? F.NONE)],
    free: y.free[i],
    span: y.span[i],
    carries: [itemOf(y.item[i] ?? F.NONE), y.prog[i]],
    holds: holding(y, i),
    under: under(y, i),
  };
}
const order = (o: F.Standing): unknown => [
  o.id,
  o.title,
  o.from,
  o.line,
  o.pay,
  o.starts,
  tallied(o.want),
  tallied(o.filled),
];
/**
 * A blueprint: a plain one's pieces from the corner of their box, as kept; a plan of the whole
 * yard's from the yard plot's corner, as its tiles are, so that more land round the yard moves none.
 */
const print = (y: F.Yard, b: F.Print): unknown => [
  b.whole,
  F.piecesOf(b.pieces).map((p) => [
    [
      F.kindName(p.kind),
      b.whole ? p.x - y.land.origin[0] : p.x,
      b.whole ? p.y - y.land.origin[1] : p.y,
      p.dir,
      p.span,
      itemOf(p.recipe ?? F.NONE),
    ],
    [p.open ?? true, p.tint ?? 0, p.shut ?? 0, p.first ?? 0, p.ins ?? 0, p.grade ?? 1],
  ]),
];

/** What a stored yard must read as, by part (`material`). */
export type Material = Readonly<Record<string, unknown>>;

/** The tiles of the pieces a yard keeps, as its writer keeps them: each once, on its own tile (`OWN` for one of more than one tile), the depot left out. */
export function ownTiles(y: F.Yard): number[] {
  const own = (i: number): boolean => y.part[i] === 0 || y.part[i] === OWN;
  return Array.from(y.kind.keys()).filter((i) => y.kind[i] !== F.NONE && F.FIXED[y.kind[i] ?? F.NONE] !== 1 && own(i));
}

export function material(y: F.Yard): Material {
  const pieces = ownTiles(y).map((i) => piece(y, i));
  const c = y.clearing;
  return {
    coins: { till: y.till, bank: y.bank, paid: y.paid, sold: y.sold, handed: y.handed, serial: y.serial },
    // How many of the goals done the yard has logged: those past it are logged with the next command.
    told: y.told,
    depot: tallied(y.depot),
    seen: { tick: y.seen.tick, till: y.seen.till, depot: tallied(y.seen.depot) },
    plots: y.plots.map(plotOf),
    cleared: y.cleared.map(plotOf),
    clearing: c && { plot: plotOf(c.plot), start: c.start, want: tallied(c.want), filled: tallied(c.filled) },
    begun: y.begun,
    smog: y.land.plots.flatMap((p, n) =>
      (y.smog.level[n] ?? 0) > 0 || (y.smog.made[n] ?? 0) > 0
        ? [[plotOf(p.plot), y.smog.level[n], y.smog.made[n]]]
        : [],
    ),
    felled: y.land.trees.flatMap((tiles, t) => (y.felled[t] === 1 ? [placeOf(y, tiles[0] ?? 0)] : [])),
    spare: F.ALL_KINDS.flatMap((k) => ((y.spare[k] ?? 0) > 0 ? [[F.kindName(k), y.spare[k]]] : [])),
    goals: {
      done: y.done.map(goalOf),
      hand: y.hand === -1 ? null : goalOf(y.hand),
      queue: y.queue.map(goalOf),
      line: y.line.map(goalOf),
    },
    got: y.got.flatMap((got, g) => (got && tallied(got).length > 0 ? [[goalOf(g), tallied(got)]] : [])),
    board: { orders: y.board.map(order), swapAt: y.swapAt },
    // The places the yard may keep a blueprint in, and each that holds one, by its place.
    blueprints: {
      open: y.open.blueprints,
      kept: y.blueprints.flatMap((b, slot) => (b ? [[slot, print(y, b)]] : [])),
    },
    away: y.away && { seconds: y.away.seconds, coins: y.away.coins, made: tallied(y.away.made) },
    pieces,
  };
}

/** A yard as the rules left it, for the goldens: its material, its clock and power, Undo's entries, and its report of the owner's time away. */
export function yardState(y: F.Yard): Readonly<Record<string, unknown>> {
  const away = F.awayOf(y);
  return {
    ...material(y),
    clock: { tick: y.tick, at: y.at, charge: y.charge },
    // The power as the page reads it (`power`), worked out again if the yard has not since it was read.
    power: F.power(y),
    history: y.history.map((e) => e.id),
    report: away && { seconds: away.seconds, coins: away.coins, made: tallied(away.made) },
  };
}

/** A yard in words: its tier, its pieces, what it has earned and what it has done. */
export function inWords(y: F.Yard): string {
  const pieces = ownTiles(y).length;
  const delivered = tallied(y.depot).reduce((a, [, n]) => a + n, 0);
  const coins = Math.floor((y.paid + y.sold) / F.MILLI);
  return `tier ${y.open.tier}, ${pieces} pieces, ${y.done.length} goals done, ${Math.floor(delivered)} delivered, ${coins} Coins earned, ${Math.floor(y.till / F.MILLI)} in the till`;
}
