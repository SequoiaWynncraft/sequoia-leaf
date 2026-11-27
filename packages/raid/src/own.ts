/**
 * The second way to set out: a run whose stall sells the figures the member has pulled at the
 * Grove, each a little stronger for every further copy pulled. The run writes its roster down when
 * it starts (`Run.own`) and reads everything here from that; a run on the main way has none, and
 * reads nothing a member owns.
 */
import { available, catalogOf, figureOf, type Figures, type Roster } from "./content/catalog.ts";
import { type FigureId, isFigureId, type Tier, TIERS } from "./content/figures.ts";
import type { Era } from "./content/releases.ts";
import { LEVELS, STALL_ODDS } from "./content/rooms.ts";
import type { Placed } from "./party.ts";

export type { Roster } from "./content/catalog.ts";
/** What of a run says which way it set out: its roster, or none on the main way. */
interface Way {
  readonly own: Roster | null;
}

/**
 * The roster a player's awards come to: a figure for each `pull:<prize>` that is one (`figureOf`),
 * and a level for each further copy (`copies:<prize>:<n>` is the nth copy pulled), `LEVELS.most` at most.
 */
export function rosterOf(awards: readonly string[]): Roster {
  const roster: Partial<Record<FigureId, number>> = {};
  for (const award of awards) {
    const copy = /^copies:((?:figure|headliner):[^:]+):(\d)$/.exec(award);
    const prize = copy?.[1] ?? /^pull:((?:figure|headliner):[^:]+)$/.exec(award)?.[1];
    const id = prize === undefined ? null : figureOf(prize);
    if (id) roster[id] = Math.max(roster[id] ?? 0, copy ? Math.min(LEVELS.most, Number(copy[2]) - 1) : 0);
  }
  return roster;
}

/** A roster from plain data, or null for anything else. */
export function readRoster(v: unknown): Roster | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const roster: Partial<Record<FigureId, number>> = {};
  for (const [id, level] of Object.entries(v)) {
    if (!isFigureId(id) || !Number.isInteger(level) || level < 0 || level > 999) return null;
    roster[id] = level;
  }
  return roster;
}

/** A figure's level in a run: what its roster says, no higher than levels go; 0 on the main way and for a figure not pulled. */
export const levelOf = (run: Way, kind: FigureId): number => Math.min(LEVELS.most, run.own?.[kind] ?? 0);

/** One of a run's figures as it would stand in a fight on a seat, with its level in the run. */
export function placedOf(run: Way, p: Omit<Placed, "seat" | "level"> & { kind: FigureId }, seat: number): Placed {
  const level = levelOf(run, p.kind);
  return { kind: p.kind, stars: p.stars, seat, items: p.items.slice(), fed: p.fed, ...(level > 0 && { level }) };
}

/** Whose figures a run's stall sells: everyone's on the main way, or the roster it started with. */
const figuresOf = ({ own }: Way): Figures => (own ? { pool: "own", roster: own } : { pool: "fair" });

/**
 * Who the stall may offer at a cost, as the run's era has them: on the main way everyone's figures
 * of that cost; in a run with the member's own figures every one-acorn figure, and above one acorn
 * those of its roster, a banner's headliner among them.
 */
export const stallPool = (run: Way & { readonly era: Era }, tier: Tier): readonly FigureId[] =>
  available(catalogOf(run), { for: "stall", figures: figuresOf(run), tier });

/**
 * The stall's odds at a run's level, a weight for each cost from one acorn up: the table's, with
 * nothing for a cost nobody can be offered at, so that its share goes to the others.
 */
export function stallOdds(run: Way & { readonly level: number; readonly era: Era }): number[] {
  const odds = STALL_ODDS[Math.min(run.level, STALL_ODDS.length) - 1] ?? STALL_ODDS[0] ?? [];
  return odds.map((weight, i) => {
    const tier = TIERS[i];
    return tier !== undefined && stallPool(run, tier).length > 0 ? weight : 0;
  });
}
