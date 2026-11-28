/**
 * The planner's estimate of a tier the pace player cannot lay out yet (`bun pace.ts --from 5`), as
 * tier 3's once was: from a staged top yard at the tier's opening (every goal below it done, the
 * guild's first nine plots, 100,000 Coins), its commission's path, each goal by the planner. A node
 * takes the minutes its lines are built for (`MINUTES_FROM`), and the pieces of grade III lines
 * enough for that, set down by hand; a piece of research takes its folios at what the Studies are
 * built for (`FOLIOS_FROM`) of each kind at once, one piece at a time, and the lines that make them
 * that fast are set down too. Nodes and research go on side by side. Waiting for Coins, and the clearing and the plots, are not counted: the line-hour test
 * (`thewire.test.ts`) is what holds the tables.
 */
import * as F from "../src/index.ts";

/** What SPEC-2 section 8 means tiers 5 to 8 to take, in minutes from the opening to the commission done, and the part of that spent building. */
export const TARGETS_FROM: Readonly<
  Record<number, { minutes: readonly [number, number]; building: readonly [number, number] }>
> = {
  5: { minutes: [2880, 4320], building: [300, 420] },
  6: { minutes: [2880, 4320], building: [360, 480] },
  7: { minutes: [4320, 5760], building: [480, 660] },
  8: { minutes: [5760, 7200], building: [600, 780] },
};
/** The minutes of waiting a goal's lines are built for, tiers 5 to 8. */
export const MINUTES_FROM: Readonly<Record<number, number>> = { 5: 20, 6: 20, 7: 30, 8: 30 };
/** Folios a minute the Studies are built for, of each kind, in the Spark and Star eras. */
export const FOLIOS_FROM = 60;
/** Seconds of a person's time for a piece set down, as the pace player counts it (`HANDS.piece` at `CARE`). */
const PIECE_SECONDS = 16;

/** The research a goal needs, all the way down, each after what it needs, once. */
function path(g: F.Goal, out: F.Goal[] = []): F.Goal[] {
  for (const n of F.GOALS[g]?.needs ?? []) if (!out.includes(n)) path(n, out);
  if (!F.isNode(g) && !out.includes(g)) out.push(g);
  return out;
}

/** A goal's grade III line-hours: each thing it wants, at what one grade III machine of its maker makes of it a minute. */
function lineHours(g: F.Goal): number {
  const want = F.GOALS[g]?.want ?? F.counts();
  return F.ALL_ITEMS.reduce((sum, n) => {
    const count = want[n] ?? 0;
    if (count === 0) return sum;
    const { kind, recipe } = F.makerOf(n);
    return sum + count / F.makes(kind, 3, recipe) / 60;
  }, 0);
}

/** The pieces of the grade III lines that make what a goal wants in `minutes`. */
function pieces(g: F.Goal, minutes: number): number {
  const want = F.GOALS[g]?.want ?? F.counts();
  return F.ALL_ITEMS.reduce((sum, n) => {
    const count = want[n] ?? 0;
    if (count === 0 || F.isFolio(n)) return sum;
    return sum + F.bill(F.tree(n, count / minutes, 3)).reduce((s, b) => s + Math.ceil(b.count), 0);
  }, 0);
}

export interface Estimate {
  readonly tier: number;
  readonly rows: readonly {
    readonly goal: string;
    readonly hours: number;
    readonly folios: number;
    readonly minutes: number;
    readonly pieces: number;
  }[];
  readonly nodes: number;
  readonly research: number;
  readonly building: number;
  readonly minutes: number;
}

/**
 * The estimate for a tier: its nodes in the tables' order up to its commission (the long works after
 * it are no part of the path), beside the research on the commission's path.
 */
export function estimate(tier: number): Estimate {
  const all = F.ALL_GOALS.filter((g) => F.isNode(g) && F.GOALS[g]?.tier === tier);
  const commission = all.find((g) => F.GOALS[g]?.kind === "commission");
  const nodes = commission === undefined ? all : all.slice(0, all.indexOf(commission) + 1);
  const research = commission === undefined ? [] : path(commission).filter((g) => F.GOALS[g]?.tier === tier);
  const per = MINUTES_FROM[tier] ?? 20;
  const rows = [...nodes, ...research].map((g) => {
    const want = F.GOALS[g]?.want ?? F.counts();
    const folios = Math.max(0, ...F.ALL_ITEMS.filter(F.isFolio).map((k) => want[k] ?? 0));
    const node = F.isNode(g);
    return {
      goal: F.GOALS[g]?.id ?? "",
      hours: lineHours(g),
      folios,
      minutes: node ? per : folios / FOLIOS_FROM,
      pieces: node ? pieces(g, per) : 0,
    };
  });
  const sum = (f: (r: (typeof rows)[number]) => number, node: boolean): number =>
    rows.filter((r) => F.isNode(F.goal(r.goal)) === node).reduce((s, r) => s + f(r), 0);
  // The lines that make the folios the path studies, of each kind, as fast as the Studies take them.
  const kinds = F.ALL_ITEMS.filter((k) => F.isFolio(k) && research.some((g) => (F.GOALS[g]?.want[k] ?? 0) > 0));
  const folioPieces = kinds.reduce(
    (s, k) => s + F.bill(F.tree(k, FOLIOS_FROM, 3)).reduce((t, b) => t + Math.ceil(b.count), 0),
    0,
  );
  const building = ((sum((r) => r.pieces, true) + folioPieces) * PIECE_SECONDS) / 60;
  const onNodes = sum((r) => r.minutes, true) + building;
  const onResearch = sum((r) => r.minutes, false);
  return { tier, rows, nodes: onNodes, research: onResearch, building, minutes: Math.max(onNodes, onResearch) };
}

/** A number of the table, whole. */
const n = (v: number): string => String(Math.round(v));

/** The estimate as a table, against SPEC-2's targets. */
export function estimateText(e: Estimate): string {
  const t = TARGETS_FROM[e.tier];
  return [
    `Tier ${e.tier}, the planner's estimate (the pace player cannot lay it out yet): ${MINUTES_FROM[e.tier] ?? 20} minutes a goal's lines are built for, ${FOLIOS_FROM} folios a minute of each kind.`,
    "",
    "| goal | grade III line-hours | folios | minutes | pieces set down |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...e.rows.map((r) => `| ${r.goal} | ${r.hours.toFixed(2)} | ${n(r.folios)} | ${n(r.minutes)} | ${n(r.pieces)} |`),
    "",
    `Nodes and their building: ${n(e.nodes)} minutes (building ${n(e.building)}). Research on the commission's path: ${n(e.research)} minutes.`,
    `The tier, opening to commission: ${n(e.minutes)} minutes${t ? `; the target ${t.minutes[0]} to ${t.minutes[1]}, building ${t.building[0]} to ${t.building[1]}` : ""}.`,
  ].join("\n");
}
