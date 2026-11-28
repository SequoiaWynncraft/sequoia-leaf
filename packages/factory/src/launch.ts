/**
 * The launch's tables as numbers (tier 8): what a charger does and what the beat does to each thing
 * (`CHARGED`, from `content/charge.ts`), and each rocket a launch pad launches (`ROCKETS_N`, from
 * `content/rockets.ts`). And how the planner counts them (`PLANNED`), as it counts a mix's share or a
 * grower's net: a charged cell is made by a charger from a cell, and a rocket by a launch pad from its
 * parts and its charged cells, though no machine makes either by a recipe.
 *
 * It reads only the content tables and the kinds' list, which `tables.ts` reads too, so that the tables
 * can read it: a thing's number is its place in `ITEMS`, a kind's its place in `KIND_DEFS`.
 */
import { CHARGE } from "./content/charge.ts";
import { type ItemName, ITEMS, type Wants } from "./content/items.ts";
import { CLOGGED, LAUNCH_KINDS, ROCKETS } from "./content/rockets.ts";
import { KIND_DEFS, type KindName } from "./kinds/list.ts";
import type { Item, Kind, Recipe } from "./tables.ts";

/** What a byte holds where there is no thing (`tables.ts`'s `NONE`). */
const NONE = 255;

const isThing = (n: number): n is Item => Number.isInteger(n) && n >= 0 && n < ITEMS.length;
const isKindN = (n: number): n is Kind => Number.isInteger(n) && n >= 0 && n < KIND_DEFS.length;
/** A thing's number, by its name. */
function thing(name: ItemName): Item {
  const n = ITEMS.indexOf(name);
  if (!isThing(n)) throw new Error(`the tables have no ${name}`);
  return n;
}
/** A kind's number, by its name. */
function kindOf(name: KindName): Kind {
  const n = KIND_DEFS.findIndex((d) => d.name === name);
  if (!isKindN(n)) throw new Error(`the tables have no ${name}`);
  return n;
}

/**
 * What a charger does, as numbers: what it takes, in the order it uses them, what it gives, its work in
 * half-ticks at grade 1, and how many it holds; a plain cell, and the charged ones by their bars (1, 2,
 * 3); the ticks between beats; and for every thing, what it is after a beat (`down`): a charged cell
 * the one with a bar less, one with 1 bar a plain cell, and everything else itself.
 */
export interface Charged {
  readonly by: Kind;
  readonly takes: readonly Item[];
  readonly gives: Item;
  readonly work: number;
  readonly holds: number;
  readonly plain: Item;
  readonly bars: readonly Item[];
  readonly beat: number;
  readonly known: string;
  readonly down: Uint8Array;
}

const bars = CHARGE.bars.map(thing);
const down = Uint8Array.from({ length: 256 }, (_, n) => n);
bars.forEach((n, b) => {
  down[n] = b === 0 ? thing(CHARGE.plain) : (bars[b - 1] ?? NONE);
});
export const CHARGED: Charged = {
  by: kindOf(CHARGE.by),
  takes: CHARGE.takes.map(thing),
  gives: thing(CHARGE.gives),
  work: CHARGE.ticks * 2,
  holds: CHARGE.holds,
  plain: thing(CHARGE.plain),
  bars,
  beat: CHARGE.beat,
  known: CHARGE.known,
  down,
};

/** A rocket as numbers: each part and how many, its charged cells at once, what it counts as, and the kinds of launch it counts toward by their places. */
export interface Rocket {
  readonly id: string;
  readonly name: string;
  readonly parts: readonly { readonly item: Item; readonly need: number }[];
  readonly cells: number;
  readonly counts: Item;
  readonly kinds: readonly number[];
  readonly withPad: boolean;
}

/** What a rocket takes beside its charged cells, in the order of the things' table. */
const partsOf = (w: Wants): Rocket["parts"] =>
  ITEMS.flatMap((name, n) => {
    const need = w[name];
    return isThing(n) && need !== undefined ? [{ item: n, need }] : [];
  });

export const ROCKETS_N: readonly Rocket[] = ROCKETS.map((r) => ({
  id: r.id,
  name: r.name,
  parts: partsOf(r.parts),
  cells: r.cells,
  counts: thing(r.counts),
  kinds: r.kinds.map((k) => LAUNCH_KINDS.indexOf(k)),
  withPad: r.withPad,
}));

/** The rockets a pad may be set to now: those that come with the pad. */
const ON_PAD = ROCKETS_N.filter((r) => r.withPad);
/** Each rocket a pad may be set to, by the thing it counts as, which is what a pad keeps (`Yard.set`). */
const SET: readonly (Rocket | null)[] = Array.from(
  { length: ITEMS.length },
  (_, n) => ON_PAD.find((r) => r.counts === n) ?? null,
);
/** The rocket a launch pad set to the thing `n` launches, or null for a thing no rocket a pad may be set to counts as. */
export const rocketSet = (n: number): Rocket | null => SET[n] ?? null;
/**
 * The most of each thing a launch pad can come to hold, whatever rocket it is set to or has been, which
 * is what a kept one reads back up to (`Hooks.most`), so that every yard the tick makes reads back as it
 * was. A pad keeps all it holds when its rocket changes, and takes a part only below its rocket's number
 * of it: so of each part, the most any rocket a pad may be set to takes. It takes charged cells only
 * below its rocket's cells: so of charged cells, of each bars, the most cells any such rocket takes. And
 * it takes them only while it holds fewer than `CLOGGED` plain cells, but the beat may then turn every
 * charged cell it holds plain at once: so of plain cells, one fewer than `CLOGGED` and the most charged
 * cells besides.
 */
export const PAD_HOLDS: Uint32Array = (() => {
  const most = new Uint32Array(ITEMS.length);
  const cells = Math.max(0, ...ON_PAD.map((r) => r.cells));
  for (const r of ON_PAD) for (const p of r.parts) most[p.item] = Math.max(most[p.item] ?? 0, p.need);
  for (const b of CHARGED.bars) most[b] = cells;
  most[CHARGED.plain] = CLOGGED - 1 + cells;
  return most;
})();

/** The rocket a new launch pad is set to: the first. */
export const FIRST_ROCKET: Rocket | null = ROCKETS_N[0] ?? null;

const LAUNCHPAD = kindOf("launchpad");

/**
 * Each thing as the planner counts what makes it, where no recipe does (`makersOf`): a charged cell, of
 * any bars, from a cell by a charger at its work; a rocket from its parts and its charged cells by a
 * launch pad, the first rocket that counts as it, at no work (it launches at once: `lineHours`).
 */
export const PLANNED: readonly (readonly Recipe[])[] = Array.from({ length: ITEMS.length }, (_, n): Recipe[] => {
  if (CHARGED.bars.some((b) => b === n)) {
    const from = [CHARGED.plain];
    return [
      { out: CHARGED.gives, also: NONE, from, need: [1], by: CHARGED.by, ticks: CHARGE.ticks, work: CHARGED.work },
    ];
  }
  const r = ROCKETS_N.find((x) => x.counts === n);
  if (!r) return [];
  const from = [...r.parts.map((p) => p.item), CHARGED.gives];
  const need = [...r.parts.map((p) => p.need), r.cells];
  return [{ out: r.counts, also: NONE, from, need, by: LAUNCHPAD, ticks: 0, work: 0 }];
});
/** The first rocket that counts as each thing, which the planner plans it by; null for a thing none counts as. */
export const ROCKET_OF: readonly (Rocket | null)[] = Array.from(
  { length: ITEMS.length },
  (_, n) => ROCKETS_N.find((r) => r.counts === n) ?? null,
);
