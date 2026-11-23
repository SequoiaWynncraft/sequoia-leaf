/**
 * Small helpers for the tests beside this file: ways to put a few figures on a board, make some of
 * them stand still as targets, and pick out what happened. Nothing in the game uses this.
 */
import type { Stars, UnitKind } from "./content/figures.ts";
import type { ItemId } from "./content/items.ts";
import { openFight, stepFight } from "./fight/engine.ts";
import type { Fight, FightEvent, Unit } from "./fight/types.ts";
import { cellSeat, COLS, type Side } from "./hex.ts";
import type { Party, Placed } from "./party.ts";

/** Numbers in order, and words in order, for comparing lists whose order does not matter. */
export const inOrder = (numbers: readonly number[]): number[] => numbers.toSorted((a, b) => a - b);
export const abc = (words: readonly string[]): string[] => words.toSorted((a, b) => a.localeCompare(b));

/** A figure at a column and row of its own half (row 0 is its front line). */
export const at = (kind: UnitKind, col: number, row: number, stars: Stars = 1, items: ItemId[] = []): Placed => ({
  kind,
  stars,
  seat: row * COLS + col,
  items,
  fed: 0,
});
/** A figure on a hex of the fight board, for the side whose half that hex is on. */
export function onCell(kind: UnitKind, side: Side, cell: number, stars: Stars = 1, items: ItemId[] = []): Placed {
  const seat = cellSeat(side, cell);
  if (seat < 0) throw new Error(`hex ${cell} is not on side ${side}'s half`);
  return { kind, stars, seat, items, fed: 0 };
}
export const partyOfFigures = (figures: Placed[], more: Partial<Party> = {}): Party => ({
  who: "test",
  title: "",
  figures,
  boons: [],
  might: 100,
  ...more,
});
/** A fight between two lists of figures, opened and not yet stepped. */
export function fightOf(
  ours: Placed[],
  theirs: Placed[],
  more: { seed?: number; ours?: Partial<Party>; theirs?: Partial<Party> } = {},
): Fight {
  return openFight({
    seed: more.seed ?? 7,
    sides: [partyOfFigures(ours, more.ours), partyOfFigures(theirs, more.theirs)],
  });
}
/** The first figure of a kind on a side. */
export function unitOf(f: Fight, kind: UnitKind, side: Side = 0): Unit {
  const u = f.units.find((o) => o.kind === kind && o.side === side);
  if (!u) throw new Error(`no ${kind} on side ${side}`);
  return u;
}
export const unitsOf = (f: Fight, kind: UnitKind, side: Side): Unit[] =>
  f.units.filter((o) => o.kind === kind && o.side === side);
/** Makes a figure a plain target: it never attacks, casts or walks, and has no armour or ward, so damage on it is exact. */
export function still(u: Unit, health = 100_000): Unit {
  u.attack = 0;
  u.attack0 = 0;
  u.manaFull = 0;
  u.mana = 0;
  u.rooted = true;
  u.armour = 0;
  u.ward = 0;
  u.slip = 0;
  u.thorns = 0;
  u.maxHp = health;
  u.hp = health;
  u.shield = 0;
  u.digs = false;
  return u;
}
/** Everyone on a side made a plain target. */
export function stillSide(f: Fight, side: Side, health = 100_000): void {
  for (const u of f.units) if (u.side === side) still(u, health);
}
/** Fills a figure's mana, so that it uses its ability on its next turn. */
export function ready(u: Unit): Unit {
  u.mana = u.manaFull;
  return u;
}
/** Steps a fight a number of times and gives back everything that happened. */
export function steps(f: Fight, count: number): FightEvent[] {
  const out: FightEvent[] = [];
  for (let i = 0; i < count && !f.over; i++) out.push(...stepFight(f));
  return out;
}
/** Steps a fight until something happens that a check accepts (or a limit), and gives back everything up to and including that step. */
export function stepUntil(f: Fight, found: (ev: FightEvent) => boolean, most = 1200): FightEvent[] {
  const out: FightEvent[] = [];
  for (let i = 0; i < most && !f.over; i++) {
    const step = stepFight(f);
    out.push(...step);
    if (step.some(found)) break;
  }
  return out;
}
/** The events of one sort. */
export function only<T extends FightEvent["t"]>(events: readonly FightEvent[], t: T): Extract<FightEvent, { t: T }>[] {
  const out: Extract<FightEvent, { t: T }>[] = [];
  for (const ev of events) if (isSort(ev, t)) out.push(ev);
  return out;
}
function isSort<T extends FightEvent["t"]>(ev: FightEvent, t: T): ev is Extract<FightEvent, { t: T }> {
  return ev.t === t;
}
