/**
 * Sitting down: the three moments asked of a whole side, in their order (`ORDER`). `sits` as each of
 * its figures does (`growing`), `on` once all of a side's are seated (`switchOn`, which arms what
 * each hook touches for the moments after), and `seated` once both sides are switched on
 * (`seatedAll`), with the leaps round the back last.
 */
import { type BoonId, boonNumber } from "../content/boons.ts";
import type { Catalog } from "../content/catalog.ts";
import { abilityNumber } from "../content/figures.ts";
import { carries, type ItemId, itemNumber, type ItemStats, itemStats } from "../content/items.ts";
import { type TraitId, traitNumber } from "../content/traits.ts";
import { backRow, cellAt, colOf, type Side } from "../hex.ts";
import type { Party, Placed } from "../party.ts";
import { emit, freeNear, leap, otherSide } from "./core.ts";
import {
  actsLater,
  arm,
  type Armed,
  type From,
  type Hooks,
  type Numbers,
  ORDER,
  ownOf,
  type Switching,
  type Tables,
} from "./hooks.ts";
import type { Fight, Unit } from "./types.ts";

/** A figure's numbers as it sits down, as items' stats are counted. */
export type Stats = { -readonly [K in keyof ItemStats]: number };
const STATS = ["attack", "speed", "power", "armour", "ward", "health"] as const satisfies readonly (keyof ItemStats)[];
const RANKS = new WeakMap<Catalog, ReadonlyMap<ItemId, number>>();
/** Where each item comes in the catalogue's order. */
function ranksOf(cat: Catalog): ReadonlyMap<ItemId, number> {
  const known = RANKS.get(cat);
  if (known) return known;
  const ranks = new Map([...cat.ids.components, ...cat.ids.finished, ...cat.ids.emblems].map((id, n) => [id, n]));
  RANKS.set(cat, ranks);
  return ranks;
}
type Sits = NonNullable<Hooks["sits"]>;
/** A hook with a `sits` on a side, what it is handed, and which figures sitting down it touches. */
interface Sitter {
  readonly sits: Sits;
  readonly s: Numbers;
  readonly touches: (p: Placed) => boolean;
}
/** The traits, items and boons whose hooks have a `sits`, in the catalogue's order. */
interface SitIds {
  readonly traits: readonly TraitId[];
  readonly items: readonly ItemId[];
  readonly boons: readonly BoonId[];
}
const SIT_IDS = new WeakMap<Tables, WeakMap<Catalog, SitIds>>();
function sitIds(tables: Tables, cat: Catalog): SitIds {
  const byCat = SIT_IDS.get(tables) ?? new WeakMap<Catalog, SitIds>();
  SIT_IDS.set(tables, byCat);
  const known = byCat.get(cat);
  if (known) return known;
  const ids: SitIds = {
    traits: cat.ids.traits.filter((id) => tables.traits[id].sits),
    items: [...ranksOf(cat).keys()].filter((id) => tables.items[id]?.sits),
    boons: cat.ids.boons.filter((id) => tables.boons[id]?.sits),
  };
  byCat.set(cat, ids);
  return ids;
}
/** For each place a hook comes from but a figure's own, its hooks on a side that have a `sits`. */
const SITTERS: Readonly<Record<Exclude<From, "kind">, (f: Fight, side: Side, party: Party) => Sitter[]>> = {
  trait: (f, side) =>
    sitIds(f.hooks.tables, f.cat).traits.flatMap((trait): Sitter[] => {
      const sits = f.hooks.tables.traits[trait].sits;
      const step = f.traits[side][trait] ?? 0;
      if (!sits || step <= 0) return [];
      const s: Numbers = { side, step, v: (name) => traitNumber(f.cat, trait, name, step) };
      return [{ sits, s, touches: (p) => carries(f.cat, p.kind, p.items, trait) }];
    }),
  item: (f, side) =>
    sitIds(f.hooks.tables, f.cat).items.flatMap((id): Sitter[] => {
      const sits = f.hooks.tables.items[id]?.sits;
      const s: Numbers = { side, step: 1, v: (name) => itemNumber(f.cat, id, name) };
      return sits ? [{ sits, s, touches: (p) => p.items.includes(id) }] : [];
    }),
  boon: (f, side, party) =>
    sitIds(f.hooks.tables, f.cat).boons.flatMap((boon): Sitter[] => {
      const sits = f.hooks.tables.boons[boon]?.sits;
      const s: Numbers = { side, step: 1, v: (name) => boonNumber(f.cat, boon, name) };
      return sits && party.boons.includes(boon) ? [{ sits, s, touches: () => true }] : [];
    }),
};

/**
 * How a side's figures grow as they sit down: each one's items' stats, then what touches it adds
 * (`sits`, in its order), summed before anything is rounded.
 */
export function growing(f: Fight, side: Side, party: Party): (p: Placed) => Stats {
  const sitters = ORDER.sits.map((from) => (from === "kind" ? from : SITTERS[from](f, side, party)));
  return (p) => {
    const sum: Stats = { attack: 0, speed: 0, power: 0, armour: 0, ward: 0, health: 0 };
    const add = (more: Partial<ItemStats> | null): void => {
      if (more) for (const stat of STATS) sum[stat] += more[stat] ?? 0;
    };
    for (const item of p.items) add(itemStats(f.cat, item));
    for (const these of sitters) {
      if (these !== "kind") for (const t of these) if (t.touches(p)) add(t.sits(f, p, t.s));
      const own = these === "kind" ? f.hooks.tables.kinds[p.kind]?.sits : undefined;
      if (own) add(own(f, p, { side, step: 1, v: (name) => abilityNumber(f.cat, p.kind, name, p.stars) }));
    }
    return sum;
  };
}

/** A side's traits switching on, in the catalogue's order, each saying whom it touched. */
function traitsOn(f: Fight, side: Side, mine: readonly Unit[]): Armed[] {
  const out: Armed[] = [];
  for (const trait of f.cat.ids.traits) {
    const step = f.traits[side][trait] ?? 0;
    if (step <= 0) continue;
    const hooks = f.hooks.tables.traits[trait];
    // Whoever carries it: as one of its own traits, or by an emblem it holds.
    const members = mine.filter((u) => carries(f.cat, u.kind, u.items, trait));
    const s: Switching = { side, mine, members, step, v: (name) => traitNumber(f.cat, trait, name, step) };
    const touched = hooks.on?.(f, s) ?? members;
    emit(f, { t: "trait", side, trait, step, ids: touched.map((u) => u.id) });
    if (actsLater(hooks)) out.push({ from: "trait", hooks, s, touches: touched.map((u) => u.id) });
  }
  return out;
}
/** Each figure's items switching on, one by one as it holds them; armed once each, in the catalogue's order. */
function itemsOn(f: Fight, side: Side, mine: readonly Unit[]): Armed[] {
  const out: Armed[] = [];
  const { items } = f.hooks.tables;
  const ranks = ranksOf(f.cat);
  for (const u of mine) {
    const held: ItemId[] = [];
    for (const id of u.items) if (items[id] && !held.includes(id)) held.push(id);
    if (held.length === 0) continue;
    held.sort((a, b) => (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0));
    const of = held.map((id): Switching => ({
      side,
      mine,
      members: [u],
      step: 1,
      v: (name) => itemNumber(f.cat, id, name),
    }));
    for (const id of u.items) {
      const s = of[held.indexOf(id)];
      if (s) items[id]?.on?.(f, s);
    }
    held.forEach((id, n) => {
      const [hooks, s] = [items[id], of[n]];
      if (hooks && s && actsLater(hooks)) out.push({ from: "item", hooks, s, touches: [u.id] });
    });
  }
  return out;
}
/** A party's boons switching on, in the catalogue's order. */
function boonsOn(f: Fight, side: Side, mine: readonly Unit[], party: Party): Armed[] {
  const out: Armed[] = [];
  if (party.boons.length === 0) return out;
  for (const boon of f.cat.ids.boons) {
    const hooks = f.hooks.tables.boons[boon];
    if (!hooks || !party.boons.includes(boon)) continue;
    const s: Switching = { side, mine, members: mine, step: 1, v: (name) => boonNumber(f.cat, boon, name) };
    const touched = hooks.on?.(f, s) ?? mine;
    if (actsLater(hooks)) out.push({ from: "boon", hooks, s, touches: touched.map((u) => u.id) });
  }
  return out;
}

/** A side, all seated, switches on: its traits (which say so), its figures' items, its boons and its figures' own, and arms what each touches. */
export function switchOn(f: Fight, side: Side, party: Party): void {
  const mine = f.units.filter((u) => u.side === side);
  const armed: Armed[] = [];
  for (const from of ORDER.on) {
    if (from === "trait") armed.push(...traitsOn(f, side, mine));
    else if (from === "item") armed.push(...itemsOn(f, side, mine));
    else if (from === "boon") armed.push(...boonsOn(f, side, mine, party));
    else for (const u of mine) f.hooks.tables.kinds[u.kind]?.on?.(f, ownOf(f, u, mine));
  }
  arm(f, side, mine, armed);
}

/** Those who start round the back (`leaps`: Sneaks with their trait on, and magpies) get there, in the order they sat down. */
function roundTheBack(f: Fight): void {
  for (const u of f.units.slice()) {
    if (!u.leaps || !u.alive || u.rooted) continue;
    const to = freeNear(f, cellAt(colOf(u.cell), backRow(otherSide(u.side))), 3);
    if (to >= 0) leap(f, u, to, "sneak");
    u.busyUntil = 0;
  }
}
/** Both sides are seated and switched on: `seated` is asked, in its order, side by side in `order`; then the leaps round the back. */
export function seatedAll(f: Fight, order: readonly Side[]): void {
  for (const from of ORDER.seated) {
    if (from === "kind") for (const u of f.units.slice()) f.hooks.tables.kinds[u.kind]?.seated?.(f, ownOf(f, u));
    else
      for (const side of order)
        for (const a of f.hooks.sides[side].armed) if (a.from === from) a.hooks.seated?.(f, a.s);
  }
  roundTheBack(f);
}
