/**
 * The second way to set out: a run whose stall sells the figures the member has pulled at the
 * Grove, each a little stronger for every further copy pulled. The run writes its roster down when
 * it starts (its way's `figures`) and reads everything here from that; a run with everyone's
 * figures has none, and reads nothing a member owns.
 */
import { available, catalogOf, figureOf, type Roster } from "./content/catalog.ts";
import { type FigureId, isFigureId, type Stars, type Tier, TIERS } from "./content/figures.ts";
import type { Era } from "./content/releases.ts";
import { LEVELS, STALL_ODDS } from "./content/rooms.ts";
import type { Way } from "./content/ways.ts";
import type { Placed } from "./party.ts";

export type { Roster } from "./content/catalog.ts";
/** What of a run says whose figures it set out with. */
interface OnWay {
  readonly way: Way;
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

/** The roster a run set out with: none with everyone's figures. */
const rosterIn = ({ way: { figures } }: OnWay): Roster | null => (figures.pool === "own" ? figures.roster : null);
/** A figure's level in a run: what its roster says, no higher than levels go; 0 with everyone's figures and for a figure not pulled. */
export const levelOf = (run: OnWay, kind: FigureId): number => Math.min(LEVELS.most, rosterIn(run)?.[kind] ?? 0);

/** One of a run's figures as it would stand in a fight on a seat, with its level in the run. */
export function placedOf(run: OnWay, p: Omit<Placed, "seat" | "level"> & { kind: FigureId }, seat: number): Placed {
  const level = levelOf(run, p.kind);
  return { kind: p.kind, stars: p.stars, seat, items: p.items.slice(), fed: p.fed, ...(level > 0 && { level }) };
}

/** A run's board and bench: the copies it holds. */
export interface Holding {
  readonly board: readonly ({ readonly kind: FigureId; readonly stars: Stars } | null)[];
  readonly bench: readonly ({ readonly kind: FigureId; readonly stars: Stars } | null)[];
}
/** The figures a run holds a copy of that can still star up: on its board or bench, under three stars. */
export const heldOf = (run: Holding): FigureId[] =>
  [...run.board, ...run.bench].flatMap((p) => (p && p.stars < 3 ? [p.kind] : []));

/**
 * Who the stall may offer at a cost, as the run's era has them: on the main way the set's figures
 * of that cost, and each retired one the run still holds a copy of to star up; in a run with the
 * member's own figures those of its roster, a banner's headliner among them, and at one acorn the
 * set's to anyone.
 */
export const stallPool = (run: OnWay & Holding & { readonly era: Era }, tier: Tier): readonly FigureId[] =>
  available(catalogOf(run), { for: "stall", figures: run.way.figures, tier, holds: heldOf(run) });

/**
 * The stall's odds at a run's level, a weight for each cost from one acorn up: the table's, with
 * nothing for a cost nobody can be offered at, so that its share goes to the others.
 */
export function stallOdds(run: OnWay & Holding & { readonly level: number; readonly era: Era }): number[] {
  const odds = STALL_ODDS[Math.min(run.level, STALL_ODDS.length) - 1] ?? STALL_ODDS[0] ?? [];
  return odds.map((weight, i) => {
    const tier = TIERS[i];
    return tier !== undefined && stallPool(run, tier).length > 0 ? weight : 0;
  });
}
