/**
 * The content tables as numbers. Every thing, kind of piece, plot and goal (a node or a piece of
 * research) is a small whole number: its place in its table in `content/`. Names are read and
 * written only at the edges (a command read off the wire, a view, the codec); the rules work on the
 * numbers.
 *
 * Each kind of number has a type of its own, so the checker keeps a thing apart from a kind or a
 * tile. A number becomes one only through its guard (`isItem`, `isKind`, ...), which checks it.
 */
import { ITEM, type ItemName, ITEMS, type Wants } from "./content/items.ts";
import { BLUEPRINT, BUFFER, GRADES, TICKS } from "./content/machines.ts";
import { NODES, START, type Tool, TOOLS, type Unlocks } from "./content/nodes.ts";
import { PLOT_IDS, type PlotName, PLOTS } from "./content/plots.ts";
import { RECIPES } from "./content/recipes.ts";
import { RESEARCH } from "./content/research.ts";
import type { KindDef, KindInfo } from "./kinds/kind.ts";
import { KIND_DEFS, type KindName } from "./kinds/list.ts";

export type { KindInfo, KindName };
/** The kinds' names, in kind order: a kind is its number here (`kinds/list.ts`). */
export const KINDS: readonly KindName[] = KIND_DEFS.map((d) => d.name);

declare const no: unique symbol;
type No<T extends string> = number & { readonly [no]: T };
export type Item = No<"item">;
export type Kind = No<"kind">;
export type Plot = No<"plot">;
/** A node, by its place in `NODES`, or a piece of research, by its place in `RESEARCH` after them. */
export type Goal = No<"goal">;
/** A tile's place in the land's arrays: `y * w + x`. */
export type Tile = No<"tile">;

/** What a byte holds where there is no thing, no kind or no recipe. */
export const NONE = 255;

const whole = (n: number, below: number): boolean => n >= 0 && n < below && Math.floor(n) === n;
export const isItem = (n: number): n is Item => whole(n, ITEMS.length);
export const isKind = (n: number): n is Kind => whole(n, KINDS.length);
/** Whether a number is a plot of a plots table: the guild's (`isPlot`), or a longer one a test adds plots to. */
export const isPlotOf =
  (ids: readonly string[]) =>
  (n: number): n is Plot =>
    whole(n, Math.min(ids.length, NONE));
export const isPlot = isPlotOf(PLOT_IDS);
export const isGoal = (n: number): n is Goal => whole(n, NODES.length + RESEARCH.length);

/** A name's number in its table, or null: how a name off the wire is read. */
const numberOf =
  <T extends number>(names: readonly string[], guard: (n: number) => n is T) =>
  (v: unknown): T | null => {
    const n = typeof v === "string" ? names.indexOf(v) : -1;
    return guard(n) ? n : null;
  };
export const itemNamed = numberOf(ITEMS, isItem);
export const kindNamed = numberOf(KINDS, isKind);
export const plotNamed = numberOf(PLOT_IDS, isPlot);
export const goalNamed = numberOf([...NODES.map((n) => n.id), ...RESEARCH.map((r) => r.id)], isGoal);

/** The number of a name the tables are known to hold. */
function sure<T extends number>(n: T | null, name: string): T {
  if (n === null) throw new Error(`the tables have no ${name}`);
  return n;
}
export const item = (name: ItemName): Item => sure(itemNamed(name), name);
export const kind = (name: KindName): Kind => sure(kindNamed(name), name);
export const plot = (name: PlotName): Plot => sure(plotNamed(name), name);
export const goal = (id: string): Goal => sure(goalNamed(id), id);

/** How many colours there are to give a line. */
export const TINTS = 6;

export const ITEM_COUNT = ITEMS.length;
export const KIND_COUNT = KINDS.length;
/** The bits a kind is kept in, in a saved piece and in an Undo entry: the first byte's four, and four more in a part of their own past 15 (`cells.ts`). */
export const KIND_BITS = 8;
/** A kind as it is kept, in its bits: one past them is no yard's yet, and is refused out loud rather than kept as another. */
export function keptKind(k: number): number {
  if (k >= 1 << KIND_BITS) throw new Error(`kind ${k} does not fit in the ${KIND_BITS} bits a save keeps a kind in`);
  return k;
}

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
export const STUDY = kind("study");
export const STOP = kind("stop");
export const SORTER = kind("sorter");
export const DEADFALL = item("deadfall");

/** Every number of a table, in its order. */
const all = <T extends number>(count: number, guard: (n: number) => n is T): T[] => {
  const out: T[] = [];
  for (let n = 0; n < count; n++) if (guard(n)) out.push(n);
  return out;
};
export const ALL_ITEMS = all(ITEM_COUNT, isItem);
export const ALL_KINDS = all(KIND_COUNT, isKind);

export const itemName = (n: Item): ItemName => ITEMS[n] ?? "plank";
export const kindName = (n: Kind): KindName => KINDS[n] ?? "belt";
export const plotName = (n: Plot): PlotName => PLOT_IDS[n] ?? "yard";

/** What each thing is worth, how many machines deep it is, and how it is spoken of. */
export const ITEM_INFO = ALL_ITEMS.map((n) => ITEM[itemName(n)]);
export const KIND_INFO: readonly KindInfo[] = KIND_DEFS.map((d) => d.info);
/** Coins are counted in whole thousandths. */
export const MILLI = 1000;
/** The share of a thing's worth the depot pays for it on arrival, whether or not an order wants it. */
export const DEPOT_SHARE = 0.01;
/** What the depot pays for one of each thing on arrival, in thousandths of a Coin. */
export const ARRIVAL = ITEM_INFO.map((i) => Math.round((i?.worth ?? 0) * MILLI * DEPOT_SHARE));
/** Whether a thing comes from the ground, and whether it is a folio. */
export const isRaw = (n: Item): boolean => ITEM_INFO[n]?.step === 0;
export const isFolio = (n: number): boolean => isItem(n) && ITEM_INFO[n]?.folio === true;
export const FOLIOS = ALL_ITEMS.filter(isFolio);
/** What the next one of a kind costs when none is to hand, and the power it draws and gives. */
export const COST = ALL_KINDS.map((n) => KIND_INFO[n]?.cost ?? 0);
export const DRAW = ALL_KINDS.map((n) => KIND_INFO[n]?.draw ?? 0);
export const GIVES = ALL_KINDS.map((n) => KIND_INFO[n]?.gives ?? 0);
export const STARTING = KIND_DEFS.map((d: KindDef) => d.starters ?? 0);

// ---------- what the rules read of each kind, as data ----------

/** 1 for each kind that a flag of its module says (`KindDef`), by its number; 0 for one that does not, and nothing for no kind. */
const flagOf = (f: (d: KindDef) => unknown): Uint8Array => Uint8Array.from(KIND_DEFS, (d: KindDef) => (f(d) ? 1 : 0));
/** The kinds with a grade, that hold things (a row in `holders`), that may be shut, that carry a thing across their tile. */
export const GRADED = flagOf((d) => d.graded);
export const HOLDS = flagOf((d) => d.holds);
export const SHUTS = flagOf((d) => d.shuts);
export const CARRIES = flagOf((d) => d.carries);
/** The kinds with a line's colour, with their line (`LINED`) or alone; and those that hand by ways (ahead, left, right). */
export const TINTED = flagOf((d) => d.tint);
export const LINED = flagOf((d) => d.tint === "line");
export const WAYS = Uint8Array.from(KIND_DEFS, (d: KindDef) => d.ways ?? 0);
/** The depot; the kinds that cannot be turned; those that run under tiles; those power reaches out from. */
export const FIXED = flagOf((d) => d.fixed);
export const FAST = flagOf((d) => d.fast);
export const SPANS = flagOf((d) => d.spans);
export const REACHES = flagOf((d) => d.reaches);
/** The kinds that work for the research first in the line, and that version 6 kept with no grade. */
export const STUDIES = flagOf((d) => d.studies);
export const REGRADED = flagOf((d) => d.regraded);
/** Half-ticks of work in each thing a kind finishes, where it is the kind's and not a recipe's: 0 for the rest. */
export const WORK_OF = KIND_DEFS.map((d: KindDef) => d.work ?? 0);
/** For each kind, the kinds it may be set down in the place of. */
export const OVER: readonly (readonly number[])[] = KIND_DEFS.map((d: KindDef) =>
  (d.over ?? []).flatMap((name) => kindNamed(name) ?? []),
);
/** For each kind, the numbers a goal raises that come with it; and the number of what is open that limits how many stand. */
export const OWNS: readonly (readonly string[])[] = KIND_DEFS.map((d: KindDef) => d.owns ?? []);
export const MOST: readonly ("stops" | null)[] = KIND_DEFS.map((d: KindDef) => d.most ?? null);
/** What each kind does a minute, as a verb and what it does it to (`KindDef.does`); and whether its price is a tile's. */
export const DOES: readonly (readonly [string, string] | null)[] = KIND_DEFS.map((d: KindDef) => d.does ?? null);
export const PER_TILE = flagOf((d) => d.perTile);
/** Each kind's tiles across and down as it faces east (`KindDef.size`), and whether that is more than one tile (`sizes.ts`). */
export const SIZE_W = Uint8Array.from(KIND_DEFS, (d: KindDef) => d.size?.[0] ?? 1);
export const SIZE_H = Uint8Array.from(KIND_DEFS, (d: KindDef) => d.size?.[1] ?? 1);
export const BIG = Uint8Array.from(SIZE_W, (w, k) => (w * (SIZE_H[k] ?? 1) > 1 ? 1 : 0));
/** The kind that studies, where research is studied (`KindDef.studies`). */
export const STUDYING: Kind = sure(
  kindNamed(KIND_DEFS.find((d: KindDef) => d.studies === true)?.name),
  "kind that studies",
);
/** The kind that gathers the things from the ground (`KindDef.gathers`). */
export const GATHERING: Kind = sure(
  kindNamed(KIND_DEFS.find((d: KindDef) => d.gathers === true)?.name),
  "kind that gathers",
);

// ---------- grades ----------

/** The highest grade there is. */
export const TOP = GRADES.length;
/** Whether a kind has a grade. */
export const isGraded = (k: number): boolean => GRADED[k] === 1;
/** A piece's grade as it is kept: 1 to `TOP` for a kind that has one, 0 for a kind that has none. */
export const gradeOf = (k: number, g = 1): number => (isGraded(k) ? Math.min(TOP, Math.max(1, Math.floor(g))) : 0);
/** A grade's numbers made whole: so far as halves of grade 1 can, and a whole number of them always. */
const halves = (f: (g: (typeof GRADES)[number]) => number): number[] => {
  const out = GRADES.map((g) => f(g) * 2);
  if (!out.every(Number.isInteger)) throw new Error("a grade's pace and power must be whole halves");
  return out;
};
/**
 * How far a piece of each grade moves on a tick in which it works: eighths of a tile along a belt, a
 * tunnel, a splitter, a joiner or a sorter (so a tile in 4 ticks at grade 1), half-ticks of work in a
 * gatherer, a machine or a Study. At 0, a kind with no grade, which neither carries nor works.
 */
export const PACE: readonly number[] = [0, ...halves((g) => g.pace)];
/** Power is counted in halves: a power is 2, and a piece of each grade draws this many halves for each power its kind draws. */
export const HALF = 2;
export const DRAWN: readonly number[] = [HALF, ...halves((g) => g.draw)];
/** The power a piece of a kind at a grade draws where power reaches it, in halves: its kind's, once for each half its grade draws. */
export const drawnAt = (k: number, grade: number): number => (DRAW[k] ?? 0) * (DRAWN[isGraded(k) ? grade : 0] ?? HALF);
/** For each kind that burns for power (`KindDef.burns`): the thing it burns, the ticks a piece burns, how many pieces it holds, and the power it gives while it burns, in halves. */
export interface Burns {
  readonly fuel: Item;
  readonly ticks: number;
  readonly holds: number;
  readonly halves: number;
}
export const BURNS: readonly (Burns | null)[] = KIND_DEFS.map((d: KindDef) => {
  const b = d.burns;
  const fuel = b ? itemNamed(b.fuel) : null;
  return b && fuel !== null ? { fuel, ticks: b.ticks, holds: b.holds, halves: d.info.gives * HALF } : null;
});
/** The work in gathering one thing and in studying one folio, in half-ticks. */
export const WORK = { gather: TICKS.gather * 2, study: TICKS.study * 2 } as const;
/** For each kind that runs under tiles, what each tile past so many adds to its cost (`KindDef.deeper`). */
const DEEPER = KIND_DEFS.map((d: KindDef) => d.deeper ?? null);
/**
 * What a piece of a kind and grade costs to build: its kind's cost, and for one that runs under
 * `span` tiles (a far mouth's, below 0, counts the same) what each tile past its kind's `past` adds,
 * times its grade's price.
 */
export function price(k: number, g: number, span = 0): number {
  const deep = DEEPER[k];
  const more = deep ? deep.each * Math.max(0, Math.abs(span) - deep.past) : 0;
  return ((COST[k] ?? 0) + more) * (g === 0 ? 1 : (GRADES[g - 1]?.price ?? 1));
}

/** A count by name, as numbers. */
export function countsOf(w: Wants): Float64Array {
  const out = new Float64Array(ITEM_COUNT);
  for (const [name, n] of Object.entries(w)) {
    const k = itemNamed(name);
    if (k !== null && typeof n === "number") out[k] = n;
  }
  return out;
}

/** What clearing each plot wants delivered before it is bought (`PlotInfo.clearing`), by its number; null for a plot Coins alone buy. */
export const CLEARING: readonly (Float64Array | null)[] = PLOT_IDS.map((id) => {
  const wants = PLOTS.find((p) => p.id === id)?.clearing;
  return wants ? countsOf(wants) : null;
});

// ---------- recipes ----------

/**
 * A recipe is known by the thing it makes: each made thing has exactly one. It takes `need[p]` of
 * each part `from[p]`, and makes one `out` from `work` units of work: half-ticks at grade 1.
 */
export interface Recipe {
  readonly out: Item;
  /** What is made beside it, one with each (`RecipeInfo.also`), or `NONE`. */
  readonly also: number;
  readonly from: readonly Item[];
  readonly need: readonly number[];
  readonly by: Kind;
  readonly ticks: number;
  readonly work: number;
}
/** Every recipe, in the table's order. */
export const RECIPES_N: readonly Recipe[] = RECIPES.map((r) => {
  const counts = countsOf(r.from);
  const from = Object.keys(r.from).flatMap((name) => itemNamed(name) ?? []);
  const need = from.map((n) => counts[n] ?? 0);
  const also = r.also === undefined ? NONE : item(r.also);
  return { out: item(r.out), also, from, need, by: kind(r.by), ticks: r.ticks, work: r.ticks * 2 };
});
/**
 * The recipe each thing names, the one it is the thing of: what a machine is told to make, and its
 * lock, are by it. What makes a thing, its by-products too, is `makersOf`.
 */
export const RECIPE: readonly (Recipe | null)[] = ALL_ITEMS.map((n) => RECIPES_N.find((r) => r.out === n) ?? null);
/** Every recipe that makes each thing: the one it is the thing of first, then those that make it beside their own. */
const MAKING: readonly (readonly Recipe[])[] = ALL_ITEMS.map((n) => [
  ...RECIPES_N.filter((r) => r.out === n),
  ...RECIPES_N.filter((r) => r.also === n),
]);
/**
 * The recipes that make a thing: the one it is the thing of first, then each that makes it beside its
 * own (`Recipe.also`), one with each. The one place what makes a thing is asked: what the yard can make
 * (`makeableOn`), how a thing is got (`recipeFor`), and so the planner, the work in it and its parts.
 */
export const makersOf = (n: number): readonly Recipe[] => MAKING[n] ?? [];
/** The recipe a thing is got by: none for a thing from the ground, which is gathered; else the first that makes it (`makersOf`). */
export const recipeFor = (n: Item): Recipe | null => (isRaw(n) ? null : (makersOf(n)[0] ?? null));
/**
 * For each kind, by the kind a recipe is made by, how many of that kind one piece of it is on the
 * recipe: 1 where they are the same, as many as it says for a machine that makes what another makes
 * (`KindDef.as`), and 0 where it does not make that kind's recipes.
 */
const TIMES = new Uint8Array(KIND_COUNT * KIND_COUNT);
for (const k of ALL_KINDS) {
  TIMES[k * KIND_COUNT + k] = 1;
  for (const [name, n] of Object.entries(KIND_DEFS[k]?.as ?? {}))
    TIMES[k * KIND_COUNT + sure(kindNamed(name), name)] = n;
}
/** How many of a recipe's own machine one piece of a kind is on it (`TIMES`): 0 for a kind that does not make it. */
export const timesOf = (k: number, r: Recipe): number => TIMES[k * KIND_COUNT + r.by] ?? 0;
/** Whether a kind of machine makes a thing, by the recipe the thing names (`RECIPE`). */
export const makesThing = (k: number, n: number): n is Item => {
  const r = isItem(n) ? RECIPE[n] : null;
  return r !== null && r !== undefined && timesOf(k, r) > 0;
};
/** The kinds of machine that make a thing by the recipe it names: its own first, then those that make it as that one (`KindDef.as`). */
export const kindsMaking = (n: Item): Kind[] => {
  const r = RECIPE[n];
  return r ? [r.by, ...ALL_KINDS.filter((k) => k !== r.by && timesOf(k, r) > 0)] : [];
};
/** For each kind, the most of any machine it is one of (`TIMES`): what its pace on a recipe is at most times its grade's. */
export const TIMES_MOST = Uint8Array.from(ALL_KINDS, (k) =>
  Math.max(...TIMES.subarray(k * KIND_COUNT, (k + 1) * KIND_COUNT)),
);
/** The recipes each kind of machine knows, in the table's order: its own, and those of the machines it makes as. */
export const MADE_BY: readonly (readonly Recipe[])[] = ALL_KINDS.map((k) => RECIPES_N.filter((r) => timesOf(k, r) > 0));
const MAKERS = Uint8Array.from(MADE_BY, (recipes) => (recipes.length > 0 ? 1 : 0));
/** Whether a kind of machine is one that makes things: one some recipe is made by. */
export const isMaker = (k: number): boolean => MAKERS[k] === 1;
/** How many of a thing a recipe takes: 0 for a thing it does not use. */
export function needOf(r: Recipe, n: number): number {
  for (let p = 0; p < r.from.length; p++) if (r.from[p] === n) return r.need[p] ?? 0;
  return 0;
}
/** The most of a thing a machine of a kind keeps by it for some recipes: `BUFFER` recipes' worth for each machine it is, for the one that takes the most of it. */
export const holdsMost = (k: number, recipes: readonly Recipe[], n: number): number =>
  BUFFER * Math.max(0, ...recipes.map((r) => needOf(r, n) * timesOf(k, r)));

/** Everything that goes into a thing, all the way down to the ground, the thing itself included. */
export function partsOf(n: Item): Item[] {
  return [n, ...(recipeFor(n)?.from ?? []).flatMap(partsOf)];
}

/** The work in one of a thing: every tick a gatherer and every machine at grade 1 spends on it, all the way down. */
export function workOf(n: Item): number {
  const r = recipeFor(n);
  if (!r) return TICKS.gather;
  return r.ticks + r.from.reduce((sum, k, p) => sum + (r.need[p] ?? 0) * workOf(k), 0);
}

// ---------- goals: the nodes, then the research ----------

/** A node or a piece of research as the rules read it: what it wants delivered or studied, what it needs first, what it unlocks. */
export interface GoalInfo {
  readonly id: string;
  readonly tier: number;
  readonly kind: "lesson" | "project" | "commission" | "research";
  /** A node's title, or the research's name. */
  readonly title: string;
  readonly want: Float64Array;
  readonly needs: readonly Goal[];
  readonly unlocks: Unlocks;
  /** Coins, for a node that pays. */
  readonly pay: number;
}
export const NODE_COUNT = NODES.length;
export const GOALS: readonly GoalInfo[] = [
  ...NODES.map((n): GoalInfo => ({
    id: n.id,
    tier: n.tier,
    kind: n.kind,
    title: n.title,
    want: countsOf(n.want),
    needs: (n.needs ?? []).map(goal),
    unlocks: n.unlocks,
    pay: n.pay ?? 0,
  })),
  ...RESEARCH.map((r): GoalInfo => ({
    id: r.id,
    tier: r.tier,
    kind: "research",
    title: r.name,
    want: countsOf(r.cost),
    needs: (r.needs ?? []).map(goal),
    unlocks: r.unlocks,
    pay: 0,
  })),
];
export const ALL_GOALS = all(GOALS.length, isGoal);
export const isNode = (g: Goal): boolean => g < NODE_COUNT;
const LESSONS = ALL_GOALS.filter((g) => GOALS[g]?.kind === "lesson");
/** The lessons and the commission of each tier: those that open the next. */
const CLOSERS = ALL_GOALS.reduce<Goal[][]>((by, g) => {
  const info = GOALS[g];
  if (info && (info.kind === "lesson" || info.kind === "commission")) (by[info.tier] ??= []).push(g);
  return by;
}, []);

/** Everything named in some unlock, and in what a new yard has. */
const UNLOCKS = [START, ...GOALS.map((g) => g.unlocks)];
const most = (f: (u: Unlocks) => number | undefined): number => Math.max(0, ...UNLOCKS.map((u) => f(u) ?? 0));
/** The most of these any yard may have: tiles under a tunnel, blueprints, things in a crate, orders on the board. */
export const SPAN_MOST = most((u) => u.span);
// A span is kept in a signed byte (`spanByte`), a far mouth's below 0.
if (SPAN_MOST > 127) throw new Error("a tunnel runs under at most 127 tiles");
export const BLUEPRINTS_MOST = most((u) => u.blueprints?.count);
export const CRATE_MOST = most((u) => u.crate);
export const HOOKS_MOST = most((u) => u.hooks);
/** The recipes some goal unlocks; every other is known from the start. */
const LOCKED = new Set(GOALS.flatMap((g) => (g.unlocks.recipes ?? []).map(item)));

/** What a yard may build, buy and use, worked out from what is done: the same for every yard with the same goals done. */
export interface Open {
  /** 1 for each goal done. */
  readonly done: Uint8Array;
  /** The highest tier open. */
  readonly tier: number;
  /** The highest grade of each kind that may be built: 0 for a kind not unlocked. */
  readonly kinds: Uint8Array;
  /** 1 for each thing whose recipe is known. */
  readonly recipes: Uint8Array;
  /** 1 for each plot for sale, by its number: as many as the plots table has. */
  readonly plots: Uint8Array;
  /** A bit for each tool. */
  readonly tools: number;
  readonly blueprints: number;
  readonly pieces: number;
  readonly stops: number;
  readonly crate: number;
  /** How far a pylon reaches, in hundredths of its plain reach. */
  readonly reach: number;
  readonly depot: number;
  readonly span: number;
  /** The ticks the yard runs after its owner's last command. */
  readonly away: number;
  readonly hooks: number;
  readonly board: boolean;
  /** Whether a splitter may put one of its ways first, and turn its ways out to take things in. */
  readonly first: boolean;
  readonly ins: boolean;
  /** Whether redwoods may be felled; whether a tunnel's way in takes things in from its sides too. */
  readonly felling: boolean;
  readonly mouths: boolean;
  /** How many plots out from the plot you stand on you build (`Unlocks.range`). */
  readonly range: number;
}

/** A tool's bit in `Open.tools`. */
const toolBit = (t: Tool): number => 1 << TOOLS.indexOf(t);

/** The highest tier open with these goals done: the first always, and each next one once every lesson and commission of the one before it is done. */
function tierOf(done: Uint8Array): number {
  let t = 0;
  while (CLOSERS[t]?.every((g) => done[g] === 1)) t++;
  return t;
}

/** What is open once some goals are done, in any order. */
export function openOf(goals: readonly Goal[]): Open {
  const done = new Uint8Array(GOALS.length);
  for (const g of goals) done[g] = 1;
  const kinds = new Uint8Array(KIND_COUNT);
  const recipes = Uint8Array.from(ALL_ITEMS, (n) => (LOCKED.has(n) ? 0 : 1));
  const plots = new Uint8Array(PLOT_IDS.length);
  let tools = 0;
  const unlocks = [START, ...goals.flatMap((g) => GOALS[g]?.unlocks ?? [])];
  for (const u of unlocks) for (const k of u.kinds ?? []) kinds[kind(k)] = 1;
  for (const u of unlocks) {
    // A grade opens a kind only once the kind itself is unlocked: the wax grades the sorter before
    // the sorter is known.
    for (const [k, grade] of Object.entries(u.grades ?? {})) {
      const n = kindNamed(k);
      if (n !== null && grade !== undefined && kinds[n] !== 0) kinds[n] = Math.max(kinds[n] ?? 0, grade);
    }
    for (const r of u.recipes ?? []) recipes[item(r)] = 1;
    for (const p of u.plots ?? []) plots[plot(p)] = 1;
    for (const t of u.tools ?? []) tools |= toolBit(t);
  }
  const top = (f: (u: Unlocks) => number | undefined): number => Math.max(0, ...unlocks.map((u) => f(u) ?? 0));
  return {
    done,
    tier: tierOf(done),
    kinds,
    recipes,
    plots,
    tools,
    blueprints: top((u) => u.blueprints?.count),
    pieces: top((u) => u.blueprints?.pieces),
    stops: top((u) => u.stops),
    crate: top((u) => u.crate),
    reach: top((u) => u.reach),
    depot: top((u) => u.depot),
    span: top((u) => u.span),
    away: top((u) => u.away) * 36_000,
    hooks: top((u) => u.hooks),
    board: unlocks.some((u) => u.board === true),
    first: unlocks.some((u) => u.first === true),
    ins: unlocks.some((u) => u.ins === true),
    felling: unlocks.some((u) => u.felling === true),
    mouths: unlocks.some((u) => u.mouths === true),
    range: top((u) => u.range),
  };
}

// ---------- what a yard may do ----------

/** Something a yard may be locked out of, as `locked` is asked it. */
export type Lock =
  /** Stand a piece of a kind at a grade (1 if not said). */
  | { readonly build: Kind; readonly grade?: number | undefined }
  /** Make a thing by its recipe: be told to make it, start it, take its parts in. */
  | { readonly make: Item }
  | { readonly use: Tool }
  /** Put one of a splitter's ways first, or turn one of its ways out to take things in. */
  | { readonly first: true }
  | { readonly ins: true }
  /** Fell a redwood. */
  | { readonly fell: true }
  /** Have this many cart stops standing. */
  | { readonly stops: number }
  /** Keep a blueprint in a place, of so many pieces in a box of so many tiles across and down. */
  | { readonly blueprint: number; readonly pieces?: number; readonly w?: number; readonly h?: number };

const TOOL_NAME: Readonly<Record<Tool, string>> = {
  paint: "Paint",
  select: "Select",
  upgrade: "Upgrading an area",
  whole: "A plan of the whole yard",
};
/** The locks that are one thing open or not: by what is asked, what of `Open` says, and why not. */
const FLAG_LOCKS = [
  { ask: "first", open: "first", why: "Putting a way first is not unlocked yet" },
  { ask: "ins", open: "ins", why: "Ways in for splitters are not unlocked yet" },
  { ask: "fell", open: "felling", why: "Felling is not unlocked yet" },
] as const;

/** A tool used with another: an area is raised, and the whole yard kept, with Select. */
const TOOL_WITH: Partial<Record<Tool, Tool>> = { upgrade: "select", whole: "select" };
const kindWord = (k: Kind): string => (KIND_INFO[k]?.name ?? "").toLowerCase();

/**
 * Why a yard may not do something yet, or nothing if it may: the one place that says which kinds of
 * piece it may build and to what grade, what its machines may make, which tools it may use, whether
 * a splitter may put a way first or take things in by its ways out, and how many cart stops and blueprints it may have. Everything
 * that builds, sets, makes, takes in, keeps or reads a yard back asks it.
 */
export function locked(open: Open, ask: Lock): string | null {
  if ("build" in ask) {
    const top = open.kinds[ask.build] ?? 0;
    const g = gradeOf(ask.build, ask.grade);
    if (top === 0) return `The ${kindWord(ask.build)} is not unlocked yet`;
    return g > top ? `A grade ${g} ${kindWord(ask.build)} is not unlocked yet` : null;
  }
  if ("make" in ask) {
    const r = RECIPE[ask.make];
    const many = ITEM_INFO[ask.make]?.many ?? "";
    if (!r) return `Nothing makes ${many}`;
    return open.recipes[ask.make] === 1 ? locked(open, { build: r.by }) : `The recipe for ${many} is not unlocked yet`;
  }
  if ("use" in ask) {
    const first = TOOL_WITH[ask.use];
    const before = first === undefined ? null : locked(open, { use: first });
    if (before !== null) return before;
    return (open.tools & toolBit(ask.use)) === 0 ? `${TOOL_NAME[ask.use]} is not unlocked yet` : null;
  }
  if ("stops" in ask)
    return ask.stops > open.stops ? `The yard may have ${open.stops} cart stop${open.stops === 1 ? "" : "s"}` : null;
  if (!("blueprint" in ask)) {
    const flag = FLAG_LOCKS.find((f) => f.ask in ask);
    return flag && !open[flag.open] ? flag.why : null;
  }
  const { blueprint: slot, pieces = 0, w = 0, h = 0 } = ask;
  if (open.blueprints === 0) return "Blueprints are not unlocked yet";
  if (slot < 0 || slot >= open.blueprints) return "There is no such blueprint";
  if (pieces > open.pieces) return `A blueprint holds at most ${open.pieces} pieces. This is ${pieces}`;
  if (w > BLUEPRINT.w || h > BLUEPRINT.h)
    return `A blueprint is at most ${BLUEPRINT.w} tiles by ${BLUEPRINT.h}. This is ${w} by ${h}`;
  return null;
}

/** The recipes a kind of machine may make, in the table's order, as `locked` says. */
export const recipesFor = (open: Open, k: number): Recipe[] =>
  (MADE_BY[k] ?? []).filter((r) => locked(open, { make: r.out }) === null);

/** The highest grade of a kind that may be built, as `locked` says: 0 for a kind not unlocked. */
export function highest(open: Open, k: Kind): number {
  for (let g = TOP; g > 0; g--) if (locked(open, { build: k, grade: g }) === null) return g;
  return 0;
}

/**
 * Whether a goal may be taken up now, a node into hand or research into the line: not done, its
 * tier open, what it needs done, and for a lesson, every lesson before it done.
 */
export function ready(open: Open, g: Goal): boolean {
  const info = GOALS[g];
  if (!info || open.done[g] === 1 || info.tier > open.tier) return false;
  if (info.kind === "lesson" && LESSONS.some((l) => l < g && open.done[l] !== 1)) return false;
  return info.needs.every((n) => open.done[n] === 1);
}

/** Every goal of the tiers below `tier`, in an order play could have done them: each the first that is ready. */
export function goalsBelow(tier: number): Goal[] {
  const done: Goal[] = [];
  const next = (): Goal | undefined => {
    const open = openOf(done);
    return ALL_GOALS.find((g) => (GOALS[g]?.tier ?? 0) < tier && ready(open, g));
  };
  for (let g = next(); g !== undefined; g = next()) done.push(g);
  return done;
}

/** The node that comes into hand by itself: the next lesson, else the commission of the highest tier open, else none. */
export function nextHand(open: Open): Goal | -1 {
  const lesson = LESSONS.find((g) => open.done[g] !== 1);
  if (lesson !== undefined) return lesson;
  const commission = (CLOSERS[open.tier] ?? []).find((g) => ready(open, g));
  return commission ?? -1;
}
