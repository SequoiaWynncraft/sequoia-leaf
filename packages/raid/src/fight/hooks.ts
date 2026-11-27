/**
 * When a trait, an item, a boon or a figure acts in a fight: hooks at fixed moments, one shape for
 * all four. What each thing does is its entry in a `Tables` (the fight's own are `HOOKS`, in
 * `effects.ts`). The moments of sitting down are asked in `seating.ts`, and the rest from one place
 * each in the engine and the verbs, which name nothing they ask. The order a moment asks what
 * touches a figure is `ORDER`, said once here.
 *
 * Who a hook touches: a trait, whom its `on` gave back (its carriers, or its whole side); an item,
 * its holder; a boon, its party's figures as they sat down; a figure's own (`kinds`), itself, however
 * it came into the fight. A figure holding two of one item has that item's `on` twice (its numbers
 * add, or the second sets them again) and its other moments once.
 *
 * After a room, on the run, a trait acts through `ROOM_HOOKS`.
 */
import type { BoonId } from "../content/boons.ts";
import { type Catalog, catalogAt } from "../content/catalog.ts";
import { abilityNumber, type UnitKind } from "../content/figures.ts";
import type { ItemId, ItemStats } from "../content/items.ts";
import { type TraitId, traitNumber } from "../content/traits.ts";
import type { Side } from "../hex.ts";
import type { Placed } from "../party.ts";
import type { Fought, Note, Run } from "../run.ts";
import type { Fight, Unit } from "./types.ts";

/** What a hook is handed: the side it acts for, that side's figures as they sat down, those it touches, its step and its numbers there. */
export interface Switching {
  readonly side: Side;
  readonly mine: readonly Unit[];
  readonly members: readonly Unit[];
  /** A trait's step; 1 for an item, a boon or a figure's own. */
  readonly step: number;
  /** Its numbers by name: a trait's at its step, an item's, a boon's, or a figure's ability's at its stars. */
  readonly v: (name: string) => number;
}
/** What a hook is handed before anybody is on the board. */
export type Numbers = Pick<Switching, "side" | "step" | "v">;
/** More of a figure's numbers as it sits down, counted with its items' stats before anything is rounded. */
export type Grows = Partial<ItemStats>;
/**
 * A figure that would fall and gets back up: at once, never having fallen (`now`), or `back` steps
 * after falling, still counting as standing meanwhile. Its hook has seen to the getting up.
 */
export type Rise = { readonly up: "now" } | { readonly up: "later"; readonly back: number };

export interface Hooks {
  /** A figure it touches is sitting down: more of its numbers (Greg's meals, Small Fry). */
  sits?: (f: Fight, p: Placed, s: Numbers) => Grows | null;
  /** As its side's figures are all seated: set numbers on those it touches. Gives back whom it touched. */
  on?: (f: Fight, s: Switching) => readonly Unit[];
  /** Everyone is seated and switched on, and nobody summoned yet: roll call, shells, groups, hiding. */
  seated?: (f: Fight, s: Switching) => void;
  /** Once a second, for each figure it touches that is up. */
  second?: (f: Fight, u: Unit, s: Switching) => void;
  /** A figure it touches attacks: how many more times the attack lands. */
  attacks?: (f: Fight, u: Unit, s: Switching) => number;
  /** A figure it touches has cast its ability. */
  casts?: (f: Fight, u: Unit, s: Switching) => void;
  /** An enemy's ability is about to land on a figure it touches: true blocks it, and nothing of it lands. */
  struck?: (f: Fight, u: Unit, by: Unit, s: Switching) => boolean;
  /** A figure it touches was hurt and is still up. */
  hurt?: (f: Fight, u: Unit, s: Switching) => void;
  /** A figure it touches would fall: whether it gets back up, and when. */
  falls?: (f: Fight, u: Unit, s: Switching) => Rise | null;
  /** A figure it touches has fallen, for a moment or for good. */
  fell?: (f: Fight, u: Unit, s: Switching) => void;
}
export type Moment = keyof Hooks;

/** Every trait's, item's, boon's and figure's hooks. A trait with no entry does not compile. */
export interface Tables {
  readonly traits: Readonly<Record<TraitId, Hooks>>;
  readonly items: Readonly<Partial<Record<ItemId, Hooks>>>;
  readonly boons: Readonly<Partial<Record<BoonId, Hooks>>>;
  /** What a figure does by being what it is, besides its ability. */
  readonly kinds: Readonly<Partial<Record<UnitKind, Hooks>>>;
}

/** Where a hook comes from. */
export type From = "trait" | "item" | "boon" | "kind";
const PLAIN = ["trait", "item", "boon", "kind"] as const;
/**
 * The order each moment asks: traits in the catalogue's order, items figure by figure and each
 * figure's in the catalogue's order, boons in the catalogue's order, and a figure's own. Two moments
 * differ, as the fight always has: Second Wind takes a fall before Graid does, and the crabs' shells
 * go up before roll call.
 */
export const ORDER: Readonly<Record<Moment, readonly From[]>> = {
  sits: PLAIN,
  on: PLAIN,
  seated: ["kind", "trait", "item", "boon"],
  second: PLAIN,
  attacks: PLAIN,
  casts: PLAIN,
  struck: PLAIN,
  hurt: PLAIN,
  falls: ["boon", "trait", "item", "kind"],
  fell: PLAIN,
};

/** One hook armed on a side: its hooks, what it is handed, and whom it touches. */
export interface Armed {
  readonly from: Exclude<From, "kind">;
  readonly hooks: Hooks;
  readonly s: Switching;
  /** The ids (`Unit.id`) of those it touches. */
  readonly touches: readonly number[];
}
/** Whether a hook does anything after its side switches on: only those that do are armed. */
export const actsLater = (h: Hooks): boolean =>
  h.seated !== undefined ||
  h.second !== undefined ||
  h.attacks !== undefined ||
  h.casts !== undefined ||
  h.struck !== undefined ||
  h.hurt !== undefined ||
  h.falls !== undefined ||
  h.fell !== undefined;
/** The moments asked of one figure at a time. */
export type UnitMoment = Exclude<Moment, "sits" | "on" | "seated">;
/** A hook as one figure is asked it: its hooks, and what it is handed. */
interface Asked {
  readonly hooks: Hooks;
  readonly s: Switching;
}
/** What a fight's hooks are: the tables, each side's figures and armed hooks, and each figure's as it is asked them. */
export interface Hooked {
  readonly tables: Tables;
  readonly sides: [SideHooks, SideHooks];
  /** For each moment, by figure (`Unit.id`), what touches it in the moment's order: worked out when first asked. */
  asked: Record<UnitMoment, (readonly Asked[] | undefined)[]>;
}
export interface SideHooks {
  /** Its figures as they sat down. */
  readonly mine: readonly Unit[];
  /** Every hook armed on it, in the order it switched on. */
  readonly armed: readonly Armed[];
}

const NONE: readonly Asked[] = [];
const notAsked = (): Hooked["asked"] => ({
  second: [],
  attacks: [],
  casts: [],
  struck: [],
  hurt: [],
  falls: [],
  fell: [],
});
/** A fight's hooks before either side has switched on. */
export const unarmed = (tables: Tables): Hooked => ({
  tables,
  sides: [
    { mine: [], armed: [] },
    { mine: [], armed: [] },
  ],
  asked: notAsked(),
});
/** Arms a side's hooks: its figures, and every hook that switched on for it. */
export function arm(f: Fight, side: Side, mine: readonly Unit[], armed: readonly Armed[]): void {
  f.hooks.sides[side] = { mine, armed };
  f.hooks.asked = notAsked();
}

/** What a figure's own hooks are handed: itself, its side's figures, and its ability's numbers at its stars. */
export const ownOf = (f: Fight, u: Unit, mine = f.hooks.sides[u.side].mine): Switching => ({
  side: u.side,
  mine,
  members: [u],
  step: 1,
  v: (name) => abilityNumber(f.cat, u.kind, name, u.stars),
});

/** Everything a moment asks of a figure, in the moment's order: worked out once (`build`). */
const askedOf = (f: Fight, u: Unit, m: UnitMoment): readonly Asked[] => f.hooks.asked[m][u.id] ?? build(f, u, m);
function build(f: Fight, u: Unit, m: UnitMoment): readonly Asked[] {
  const { armed } = f.hooks.sides[u.side];
  const own = f.hooks.tables.kinds[u.kind];
  const out: Asked[] = [];
  for (const from of ORDER[m]) {
    if (from === "kind") {
      if (own?.[m]) out.push({ hooks: own, s: ownOf(f, u) });
    } else for (const a of armed) if (a.from === from && a.hooks[m] && a.touches.includes(u.id)) out.push(a);
  }
  const asked = out.length > 0 ? out : NONE;
  f.hooks.asked[m][u.id] = asked;
  return asked;
}

/** Once a second, for a figure that is up. */
export function whenSecond(f: Fight, u: Unit): void {
  for (const { hooks, s } of askedOf(f, u, "second")) hooks.second?.(f, u, s);
}
/** A figure attacks: how many more times the attack lands. */
export function whenAttacks(f: Fight, u: Unit): number {
  let more = 0;
  for (const { hooks, s } of askedOf(f, u, "attacks")) more += hooks.attacks?.(f, u, s) ?? 0;
  return more;
}
/** A figure has cast its ability. */
export function whenCasts(f: Fight, u: Unit): void {
  for (const { hooks, s } of askedOf(f, u, "casts")) hooks.casts?.(f, u, s);
}
/** Whether an enemy's ability landing on a figure is blocked: the first hook to block it does. */
export function whenStruck(f: Fight, u: Unit, by: Unit): boolean {
  for (const { hooks, s } of askedOf(f, u, "struck")) if (hooks.struck?.(f, u, by, s) === true) return true;
  return false;
}
/** A figure was hurt and is still up. */
export function whenHurt(f: Fight, u: Unit): void {
  for (const { hooks, s } of askedOf(f, u, "hurt")) hooks.hurt?.(f, u, s);
}
/** A figure would fall: the first hook to get it back up does. */
export function whenFalls(f: Fight, u: Unit): Rise | null {
  for (const { hooks, s } of askedOf(f, u, "falls")) {
    const rise = hooks.falls?.(f, u, s) ?? null;
    if (rise) return rise;
  }
  return null;
}
/** A figure has fallen. */
export function whenFell(f: Fight, u: Unit): void {
  for (const { hooks, s } of askedOf(f, u, "fell")) hooks.fell?.(f, u, s);
}

// ---------- after a room ----------

/** What a trait does on the run after a room, at the step the board has it, by the catalogue of the fight's era: the notes it gives. */
export type RoomHook = (run: Run, fight: Fought, step: number, cat: Catalog) => Note[];
export const ROOM_HOOKS: Readonly<Partial<Record<TraitId, RoomHook>>> = {
  // The gnomes find acorns, more for a win.
  gnome: (run, fight, step, cat) => {
    const won = fight.outcome.result === "win";
    const amount = traitNumber(cat, "gnome", won ? "win" : "loss", step);
    if (amount <= 0) return [];
    run.acorns += amount;
    return [{ t: "acorns", why: "gnomes", amount }];
  },
};
/**
 * Every trait's doing after a room, in the catalogue's order, for those the board has on (`steps`),
 * by the catalogue of the era the fight was locked in (its setup's), never the clock's.
 */
export function afterRoom(run: Run, fight: Fought, steps: Partial<Record<TraitId, number>>): Note[] {
  const cat = catalogAt(fight.setup.era);
  return cat.ids.traits.flatMap((trait) => {
    const step = steps[trait] ?? 0;
    const hook = ROOM_HOOKS[trait];
    return hook && step > 0 ? hook(run, fight, step, cat) : [];
  });
}
