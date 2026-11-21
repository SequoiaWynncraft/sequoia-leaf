/**
 * A party as it comes to the table: who stands where, with how many stars, holding what. It is
 * plain data on purpose. The member's own board is turned into one before a fight; the forest's
 * trouble is written as one; and a guild-mate's party for sparring is one that could be stored and
 * sent as it is.
 */
import { type BoonId, BOONS, isBoonId } from "./content/boons.ts";
import {
  type FigureId,
  FIGURES,
  isFigureId,
  isStars,
  isUnitKind,
  type Stars,
  traitsOf,
  type UnitKind,
} from "./content/figures.ts";
import { HOLDS, isItemId, type ItemId } from "./content/items.ts";
import { isTraitId, stepFor, TRAIT_IDS, type TraitId } from "./content/traits.ts";
import { SEATS } from "./hex.ts";

export interface Placed {
  kind: UnitKind;
  stars: Stars;
  /** Where it stands on its own half: `row * 7 + col`, row 0 the front line. */
  seat: number;
  items: ItemId[];
  /** How many times Greg has eaten. */
  fed: number;
}
export interface Party {
  /** Whose it is: a handle, or a name for the trouble. */
  who: string;
  /** A line about it: "A few gnats", "brought Embers and Fangs". */
  title: string;
  figures: Placed[];
  /** Each counts as one more of a trait. */
  charms: TraitId[];
  /** Boons that change the fight. */
  boons: BoonId[];
  /** Health and attack, in percent: 100 for plain. */
  might: number;
}

export type TraitCounts = Partial<Record<TraitId, number>>;

/** How many of each trait a party fields: one for each *different* figure that carries it, and one for each charm. */
export function countTraits(kinds: readonly UnitKind[], charms: readonly TraitId[] = []): TraitCounts {
  const counts: TraitCounts = {};
  const seen = new Set<FigureId>();
  for (const kind of kinds) {
    if (!isFigureId(kind) || seen.has(kind)) continue;
    seen.add(kind);
    for (const trait of traitsOf(kind)) counts[trait] = (counts[trait] ?? 0) + 1;
  }
  for (const trait of charms) counts[trait] = (counts[trait] ?? 0) + 1;
  return counts;
}
export interface TraitState {
  trait: TraitId;
  count: number;
  /** 0 while it is not switched on. */
  step: number;
}
/** Every trait a party has any of, with its count and the step that puts it on; the switched-on ones first. */
export function traitStates(counts: TraitCounts): TraitState[] {
  const out: TraitState[] = [];
  for (const trait of TRAIT_IDS) {
    const count = counts[trait] ?? 0;
    if (count > 0) out.push({ trait, count, step: stepFor(trait, count) });
  }
  return out.toSorted((a, b) => b.step - a.step || b.count - a.count);
}
/** The steps a party's traits are on, with nothing for those that are off. */
export function traitSteps(party: Pick<Party, "figures" | "charms">): Partial<Record<TraitId, number>> {
  const counts = countTraits(
    party.figures.map((p) => p.kind),
    party.charms,
  );
  const steps: Partial<Record<TraitId, number>> = {};
  for (const trait of TRAIT_IDS) {
    const step = stepFor(trait, counts[trait] ?? 0);
    if (step > 0) steps[trait] = step;
  }
  return steps;
}

/** The kins that charms held as boons count toward. */
export function charmsOf(boons: readonly BoonId[]): TraitId[] {
  const out: TraitId[] = [];
  for (const id of boons) {
    const charm = BOONS[id].charm;
    if (charm !== undefined) out.push(charm);
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isWhole = (v: unknown, least: number, most: number): v is number =>
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
    isWhole(v.fed, 0, 1000)
  );
}
/** Whether something is a whole party: the check for one that has been stored or sent. Nobody shares a seat. */
export function isParty(v: unknown): v is Party {
  if (!isRecord(v)) return false;
  const { figures, charms, boons } = v;
  if (typeof v.who !== "string" || v.who.length > 80 || typeof v.title !== "string" || v.title.length > 200)
    return false;
  if (!Array.isArray(figures) || figures.length > SEATS || !figures.every(isPlaced)) return false;
  if (new Set(figures.map((p) => p.seat)).size !== figures.length) return false;
  if (!Array.isArray(charms) || charms.length > 32 || !charms.every(isTraitId)) return false;
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
