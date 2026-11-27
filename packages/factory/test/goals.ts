/**
 * Goals as the tests need them, read from the tables, so that a test of a rule holds whatever the
 * tables ask for: the research of a tier with nothing needed first, what a node or a piece of
 * research wants, and the commands and deliveries that finish one.
 */
import * as F from "../src/index.ts";
import { must } from "./yards.ts";

/** The research of a tier, in the order of its table. */
export const researchOf = (tier: number): F.Goal[] =>
  F.ALL_GOALS.filter((g) => F.GOALS[g]?.kind === "research" && F.GOALS[g]?.tier === tier);

/** The research of a tier that needs nothing first, in the order of its table. */
export const freeResearch = (tier: number): F.Goal[] => researchOf(tier).filter((g) => F.GOALS[g]?.needs.length === 0);

/** A goal's id, as commands name it. */
export const idOf = (g: F.Goal): string => F.GOALS[g]?.id ?? "";

/** The first folio a piece of research wants, and how many. */
export function folioOf(g: F.Goal): { folio: F.Item; n: number } {
  const want = F.GOALS[g]?.want;
  for (const folio of F.FOLIOS) {
    const n = want?.[folio] ?? 0;
    if (n > 0) return { folio, n };
  }
  throw new Error(`${idOf(g)} wants no folio`);
}

/** Every goal a goal needs, and what those need, in an order each could be done in: needs first. */
export function needsFirst(g: F.Goal, into: F.Goal[] = []): F.Goal[] {
  for (const n of F.GOALS[g]?.needs ?? []) needsFirst(n, into);
  if (!into.includes(g)) into.push(g);
  return into;
}

/** Puts a piece of research in the line and gives it every folio it wants, as Studies would; what it needs is learned first. */
export function learn(y: F.Yard, g: F.Goal): void {
  for (const n of needsFirst(g)) {
    if (y.open.done[n] === 1) continue;
    must(y, { do: "study", research: idOf(n) });
    for (const f of F.FOLIOS) F.giveGoal(y, n, f, F.GOALS[n]?.want[f] ?? 0);
  }
}

/** Sends the depot everything the node in hand still wants. */
export function fill(y: F.Yard): void {
  const g = y.hand;
  if (g === -1) throw new Error("nothing is in hand");
  const want = F.GOALS[g]?.want ?? F.counts();
  for (const n of F.ALL_ITEMS) F.deliver(y, n, (want[n] ?? 0) - (y.got[g]?.[n] ?? 0));
}

/** The Coins a finished node pays into the till, with what its things paid as they arrived, in thousandths. */
export function paidFor(g: F.Goal): number {
  const info = F.GOALS[g];
  let n = (info?.pay ?? 0) * F.MILLI;
  for (const k of F.ALL_ITEMS) n += (info?.want[k] ?? 0) * (F.ARRIVAL[k] ?? 0);
  return n;
}

/** The research past what the last Leaf of version 10 knew that a yard made at tier 4 or later knows: Long reach. */
const LATER_KNOWN: ReadonlySet<F.Goal> = new Set(["longreach", "longerreach"].map((id) => F.goal(id)));
/** A copy of a yard as it was before reach was research: Long reach and Longer reach forgotten, so it names nothing past version 10. */
export function beforeReach(was: F.Yard): F.Yard {
  const y = structuredClone(was);
  y.done = y.done.filter((g) => !LATER_KNOWN.has(g));
  y.told = Math.min(y.told, y.done.length);
  F.reopen(y);
  return y;
}
