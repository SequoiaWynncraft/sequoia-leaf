/**
 * The second way to set out: a run whose stall sells the figures the member has pulled at the
 * Grove, each a little stronger for every further copy pulled. The run writes its roster down when
 * it starts (`Run.own`) and reads everything here from that; a run on the main way has none, and
 * reads nothing a member owns.
 */
import { FIGURE_IDS, type FigureId, FIGURES, isFigureId } from "./content/figures.ts";
import { LEVELS, STALL_ODDS } from "./content/rooms.ts";
import type { Placed } from "./party.ts";

/** The figures a member has pulled, each with its level. */
export type Roster = Partial<Record<FigureId, number>>;
/** What of a run says which way it set out: its roster, or none on the main way. */
interface Way {
  readonly own: Roster | null;
}

/**
 * The roster a player's awards come to: a figure for each `pull:figure:<id>`, and a level for each
 * further copy (`copies:figure:<id>:<n>` is the nth copy pulled), `LEVELS.most` at most.
 */
export function rosterOf(awards: readonly string[]): Roster {
  const roster: Roster = {};
  for (const award of awards) {
    const copy = /^copies:figure:([^:]+):(\d)$/.exec(award);
    const id = (copy ?? /^pull:figure:([^:]+)$/.exec(award))?.[1];
    if (isFigureId(id)) roster[id] = Math.max(roster[id] ?? 0, copy ? Math.min(LEVELS.most, Number(copy[2]) - 1) : 0);
  }
  return roster;
}

/** A roster from plain data, or null for anything else. */
export function readRoster(v: unknown): Roster | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const roster: Roster = {};
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

/**
 * Who the stall may offer at a cost: on the main way everyone of that cost; in a run with the
 * member's own figures every one-acorn figure, and above one acorn those of its roster.
 */
export const stallPool = ({ own }: Way, tier: number): FigureId[] =>
  FIGURE_IDS.filter((id) => FIGURES[id].tier === tier && (tier === 1 || !own || own[id] !== undefined));

/**
 * The stall's odds at a run's level, a weight for each cost from one acorn up: the table's, with
 * nothing for a cost nobody can be offered at, so that its share goes to the others.
 */
export function stallOdds(run: Way & { readonly level: number }): number[] {
  const odds = STALL_ODDS[Math.min(run.level, STALL_ODDS.length) - 1] ?? STALL_ODDS[0] ?? [];
  return odds.map((weight, i) => (stallPool(run, i + 1).length > 0 ? weight : 0));
}
