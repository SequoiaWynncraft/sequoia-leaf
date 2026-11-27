/**
 * A party as it comes to the table: who stands where, with how many stars, holding what. It is
 * plain data on purpose. The member's own board is turned into one before a fight, and is what Leaf
 * keeps for other members to meet in that sparring room; the forest's trouble is written as one; and
 * a sparring room's party, a regular's or another member's board, is one stored and sent as it is.
 */
import { type BoonId, isBoonId } from "./content/boons.ts";
import {
  type FigureId,
  FIGURES,
  isFigureId,
  isStars,
  isUnitKind,
  type Stars,
  type UnitKind,
} from "./content/figures.ts";
import { carriedTraits, HOLDS, isItemId, type ItemId } from "./content/items.ts";
import { stepFor, TRAIT_IDS, type TraitId } from "./content/traits.ts";
import { SEATS } from "./hex.ts";

export interface Placed {
  kind: UnitKind;
  stars: Stars;
  /** Where it stands on its own half: `row * 7 + col`, row 0 the front line. */
  seat: number;
  items: ItemId[];
  /** How many times Greg has eaten. */
  fed: number;
  /** Its level (`LEVELS`), in a run with the member's own figures; absent for 0. */
  level?: number;
}
export interface Party {
  /** Whose it is: a handle, or a name for the trouble. */
  who: string;
  /**
   * The Leaf id of the member whose own board it is, met in a sparring room. Absent for the member's
   * own party, the forest's and a regular's.
   */
  by?: string;
  /** A line about it: "A few gnats", "brought Embers and Fangs". */
  title: string;
  figures: Placed[];
  /** Boons that change the fight. */
  boons: BoonId[];
  /** Health and attack, in percent: 100 for plain. */
  might: number;
}

export type TraitCounts = Partial<Record<TraitId, number>>;

/** A figure as far as its traits go: what it is, and what it holds (an emblem makes it one of a kin as well). */
export interface Carrier {
  readonly kind: UnitKind;
  readonly items: readonly ItemId[];
}

/**
 * How many of each trait a party fields: one for each *different* figure that carries it, by its
 * own traits or by an emblem any copy of it holds. Two copies of one figure count once.
 */
export function countTraits(figures: readonly Carrier[]): TraitCounts {
  const carried = new Map<FigureId, Set<TraitId>>();
  for (const p of figures) {
    if (!isFigureId(p.kind)) continue;
    const traits = carried.get(p.kind) ?? new Set<TraitId>();
    for (const trait of carriedTraits(p.kind, p.items)) traits.add(trait);
    carried.set(p.kind, traits);
  }
  const counts: TraitCounts = {};
  for (const traits of carried.values()) for (const trait of traits) counts[trait] = (counts[trait] ?? 0) + 1;
  return counts;
}
export interface TraitState {
  trait: TraitId;
  count: number;
  /** 0 while it is not switched on. */
  step: number;
}
/** Every trait some figures carry, with its count and the step that puts it on; the switched-on ones first. */
export function traitStates(figures: readonly Carrier[]): TraitState[] {
  const counts = countTraits(figures);
  const out: TraitState[] = [];
  for (const trait of TRAIT_IDS) {
    const count = counts[trait] ?? 0;
    if (count > 0) out.push({ trait, count, step: stepFor(trait, count) });
  }
  return out.toSorted((a, b) => b.step - a.step || b.count - a.count);
}
/** The steps a party's traits are on, with nothing for those that are off. */
export function traitSteps(party: Pick<Party, "figures">): Partial<Record<TraitId, number>> {
  const counts = countTraits(party.figures);
  const steps: Partial<Record<TraitId, number>> = {};
  for (const trait of TRAIT_IDS) {
    const step = stepFor(trait, counts[trait] ?? 0);
    if (step > 0) steps[trait] = step;
  }
  return steps;
}

/** Whether plain data is an object of fields, and a whole number in a range: for reading what was stored or sent. */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const isWhole = (v: unknown, least: number, most: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= least && v <= most;

/** Whether something is one figure standing on a party's half, holding no more than it can. */
export function isPlaced(v: unknown): v is Placed {
  return (
    isRecord(v) &&
    isUnitKind(v.kind) &&
    isStars(v.stars) &&
    isWhole(v.seat, 0, SEATS - 1) &&
    Array.isArray(v.items) &&
    v.items.length <= HOLDS &&
    v.items.every(isItemId) &&
    isWhole(v.fed, 0, 1000) &&
    (v.level === undefined || isWhole(v.level, 1, 99))
  );
}
/** Whether a party says whose it is (and, for a member's own board, their id) and has a line about it. */
const isSigned = (v: Record<string, unknown>): boolean =>
  typeof v.who === "string" &&
  v.who.length <= 80 &&
  typeof v.title === "string" &&
  v.title.length <= 200 &&
  (v.by === undefined || (typeof v.by === "string" && v.by.length <= 64));

/**
 * Whether something is a whole party: the check for one that has been stored or sent. Nobody shares a
 * seat. A party stored when charms counted for a kin has `charms` too, which is let be.
 */
export function isParty(v: unknown): v is Party {
  if (!isRecord(v) || !isSigned(v)) return false;
  const { figures, boons } = v;
  if (!Array.isArray(figures) || figures.length > SEATS || !figures.every(isPlaced)) return false;
  if (new Set(figures.map((p) => p.seat)).size !== figures.length) return false;
  if (!Array.isArray(boons) || boons.length > 32 || !boons.every(isBoonId)) return false;
  return isWhole(v.might, 10, 1000);
}

/** What a party has had spent on its figures, in acorns: a rough measure of how strong it is. */
export function partyWorth(party: Pick<Party, "figures">): number {
  let total = 0;
  for (const p of party.figures) {
    if (isFigureId(p.kind)) total += FIGURES[p.kind].tier * (p.stars === 1 ? 1 : p.stars === 2 ? 3 : 9);
  }
  return total;
}
