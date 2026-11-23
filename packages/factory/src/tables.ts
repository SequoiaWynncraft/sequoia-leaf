/**
 * The content tables as numbers. Every thing, kind of piece, plan and plot is a small whole number:
 * its place in its table in `content/`. Names are read and written only at the edges (a command
 * read off the wire, a view, the codec); the rules work on the numbers.
 *
 * Each kind of number has a type of its own, so the checker keeps a thing apart from a kind or a
 * tile. A number becomes one only through its guard (`isItem`, `isKind`, ...), which checks it.
 */
import { ITEM, type ItemName, ITEMS } from "./content/items.ts";
import { KIND, type KindName, KINDS, START_KINDS, STARTERS, TICKS } from "./content/machines.ts";
import { PLAN_IDS, type PlanName, PLANS } from "./content/plans.ts";
import { PLOT_IDS, type PlotName } from "./content/plots.ts";
import { RECIPES } from "./content/recipes.ts";

declare const no: unique symbol;
type No<T extends string> = number & { readonly [no]: T };
export type Item = No<"item">;
export type Kind = No<"kind">;
export type Plan = No<"plan">;
export type Plot = No<"plot">;
/** A tile's place in the land's arrays: `y * w + x`. */
export type Tile = No<"tile">;

/** What a byte holds where there is no thing, no kind or no recipe. */
export const NONE = 255;

const whole = (n: number, below: number): boolean => n >= 0 && n < below && Math.floor(n) === n;
export const isItem = (n: number): n is Item => whole(n, ITEMS.length);
export const isKind = (n: number): n is Kind => whole(n, KINDS.length);
export const isPlan = (n: number): n is Plan => whole(n, PLAN_IDS.length);
export const isPlot = (n: number): n is Plot => whole(n, PLOT_IDS.length);

/** A name's number in its table, or null: how a name off the wire is read. */
const numberOf =
  <T extends number>(names: readonly string[], guard: (n: number) => n is T) =>
  (v: unknown): T | null => {
    const n = typeof v === "string" ? names.indexOf(v) : -1;
    return guard(n) ? n : null;
  };
export const itemNamed = numberOf(ITEMS, isItem);
export const kindNamed = numberOf(KINDS, isKind);
export const planNamed = numberOf(PLAN_IDS, isPlan);
export const plotNamed = numberOf(PLOT_IDS, isPlot);

/** The number of a name the tables are known to hold. */
function sure<T extends number>(n: T | null, name: string): T {
  if (n === null) throw new Error(`the tables have no ${name}`);
  return n;
}
export const item = (name: ItemName): Item => sure(itemNamed(name), name);
export const kind = (name: KindName): Kind => sure(kindNamed(name), name);
export const plan = (name: PlanName): Plan => sure(planNamed(name), name);
export const plot = (name: PlotName): Plot => sure(plotNamed(name), name);

export const ITEM_COUNT = ITEMS.length;
export const KIND_COUNT = KINDS.length;

export const BELT = kind("belt");
export const GATHERER = kind("gatherer");
export const MILL = kind("mill");
export const BENCH = kind("bench");
export const WORKSHOP = kind("workshop");
export const SPLITTER = kind("splitter");
export const JOINER = kind("joiner");
export const TUNNEL = kind("tunnel");
export const CRATE = kind("crate");
export const PYLON = kind("pylon");
export const WHEEL = kind("wheel");
export const BOILER = kind("boiler");
export const DEPOT = kind("depot");
export const DEADFALL = item("deadfall");

/** Every number of a table, in its order. */
const all = <T extends number>(count: number, guard: (n: number) => n is T): T[] => {
  const out: T[] = [];
  for (let n = 0; n < count; n++) if (guard(n)) out.push(n);
  return out;
};
export const ALL_ITEMS = all(ITEM_COUNT, isItem);
export const ALL_KINDS = all(KIND_COUNT, isKind);
export const ALL_PLANS = all(PLAN_IDS.length, isPlan);

export const itemName = (n: Item): ItemName => ITEMS[n] ?? "plank";
export const kindName = (n: Kind): KindName => KINDS[n] ?? "belt";
export const planName = (n: Plan): PlanName => PLAN_IDS[n] ?? "rakes";
export const plotName = (n: Plot): PlotName => PLOT_IDS[n] ?? "yard";

/** What each thing is worth, how many machines deep it is, and how it is spoken of. */
export const ITEM_INFO = ALL_ITEMS.map((n) => ITEM[itemName(n)]);
export const KIND_INFO = ALL_KINDS.map((n) => KIND[kindName(n)]);
/** Whether a thing comes from the ground. */
export const isRaw = (n: Item): boolean => ITEM_INFO[n]?.step === 0;
/** What the next one of a kind costs when none is to hand, and the power it draws and gives. */
export const COST = ALL_KINDS.map((n) => KIND_INFO[n]?.cost ?? 0);
export const DRAW = ALL_KINDS.map((n) => KIND_INFO[n]?.draw ?? 0);
export const GIVES = ALL_KINDS.map((n) => KIND_INFO[n]?.gives ?? 0);

/** A set of kinds as one number, a bit for each. */
export const kindBit = (k: Kind): number => 1 << k;
export const START_OPEN = START_KINDS.reduce((bits, name) => bits | kindBit(kind(name)), 0);
export const STARTING = ALL_KINDS.map((n) => STARTERS[kindName(n)] ?? 0);

// ---------- recipes ----------

/** A recipe is known by the thing it makes: each made thing has exactly one. */
export interface Recipe {
  readonly out: Item;
  readonly from: readonly Item[];
  readonly by: Kind;
  readonly ticks: number;
}
/** Every recipe, in the table's order. */
export const RECIPES_N: readonly Recipe[] = RECIPES.map((r) => ({
  out: item(r.out),
  from: r.from.map(item),
  by: kind(r.by),
  ticks: r.ticks,
}));
/** The recipe that makes each thing, or null for things from the ground. */
export const RECIPE: readonly (Recipe | null)[] = ALL_ITEMS.map((n) => RECIPES_N.find((r) => r.out === n) ?? null);
/** The recipes each kind of machine knows, in the table's order. */
export const MADE_BY: readonly (readonly Recipe[])[] = ALL_KINDS.map((k) => RECIPES_N.filter((r) => r.by === k));
/** What a mill makes of each thing it is fed, or null. */
export const MILLED: readonly (Recipe | null)[] = ALL_ITEMS.map(
  (n) => RECIPES_N.find((r) => r.by === MILL && r.from[0] === n) ?? null,
);
/** Whether a kind of machine is one that makes things. */
export const isMaker = (k: number): boolean => k === MILL || k === BENCH || k === WORKSHOP;
/** Whether a machine of a kind has a use for a thing at all. */
export const uses = (k: Kind, n: Item): boolean => (MADE_BY[k] ?? []).some((r) => r.from.includes(n));

/** Everything that goes into a thing, all the way down to the ground, the thing itself included. */
export function partsOf(n: Item): Item[] {
  return [n, ...(RECIPE[n]?.from ?? []).flatMap(partsOf)];
}

/** The work in a thing: every tick a gatherer and every machine spends on one of it, all the way down. */
export function workOf(n: Item): number {
  const r = RECIPE[n];
  return r ? r.ticks + r.from.reduce((sum, k) => sum + workOf(k), 0) : TICKS.gather;
}

/** Each plan's entry in its table, what it needs first, and the kinds it opens. */
export const PLAN_INFO = ALL_PLANS.map((n) => PLANS.find((p) => p.id === planName(n)) ?? PLANS[0]);
export const PLAN_NEEDS = PLAN_INFO.map((p) => (p?.needs ?? []).map(plan));
export const PLAN_OPENS = PLAN_INFO.map((p) => (p?.effect.opens ?? []).reduce((b, k) => b | kindBit(kind(k)), 0));
