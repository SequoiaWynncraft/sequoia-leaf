/**
 * How the yard's goals stand, read from the yard as plain values: which screens there are yet, the
 * goals of the tiers open, what a goal has been given, and how each goal another waits on stands.
 * The prints of the cards (`prints.ts`) and of the screens (the tier's, research, Orders, the top
 * bar) are made of these, so each says the same of a goal.
 */
import {
  ALL_GOALS,
  ALL_ITEMS,
  type Goal,
  GOALS,
  isNode,
  locked,
  ready,
  STUDY,
  studyRefusal,
  takeRefusal,
} from "@sequoia-leaf/factory";

import { S } from "../state.ts";
import { type Begin, type Count, type Given, givenIn, type Need, nodeKind, type Stands } from "./goal.ts";

/** Whether the tier has a screen of its own: from tier 1 on, and not in somebody else's yard. */
export const tierOpen = (): boolean => S.world.open.tier >= 1 && S.visiting === null;
/** Whether research has a screen: once the yard may build a Study, and not in somebody else's yard. */
export const researchOpen = (): boolean => locked(S.world.open, { build: STUDY }) === null && S.visiting === null;

/** The projects and commissions of the tiers open, in their order. */
export const nodesOpen = (): Goal[] =>
  ALL_GOALS.filter((g) => {
    const info = GOALS[g];
    return isNode(g) && info !== undefined && info.kind !== "lesson" && info.tier <= S.world.open.tier;
  });

/** The projects and the commission that may be taken in hand now, but for the one in hand. */
export const takeable = (): Goal[] => nodesOpen().filter((g) => g !== S.world.hand && ready(S.world.open, g));

/**
 * What a goal waits on before anything counts toward it, as a count of what it needs first: "9
 * research left", "1 project left"; nothing for a goal that is open or done.
 */
export function lockOf(g: Goal): string | null {
  const w = S.world;
  if (w.open.done[g] === 1 || ready(w.open, g)) return null;
  const left = needsOf(g).filter((n) => n.stands !== "done" && n.stands !== "known");
  if (left.length === 0) return "Not open yet";
  const nodes = left.filter((n) => isNode(n.goal)).length;
  const noun = nodes === 0 ? " research" : nodes < left.length ? "" : left.length === 1 ? " project" : " projects";
  return `${left.length}${noun} left`;
}

/**
 * What comes next with nothing in hand: projects to take, and how many; else the goal the tiers open
 * wait on (the tier's commission first), with what opens it; else nothing, every project being done.
 */
export type Next =
  | { readonly is: "take"; readonly count: number }
  | { readonly is: "locked"; readonly goal: Goal; readonly lock: string }
  | { readonly is: "done" };

export function nextUp(): Next {
  const w = S.world;
  const count = takeable().length;
  if (count > 0) return { is: "take", count };
  const open = nodesOpen().filter((g) => w.open.done[g] !== 1);
  const goal = open.find((g) => GOALS[g]?.kind === "commission") ?? open[0];
  const lock = goal === undefined ? null : lockOf(goal);
  return goal === undefined || lock === null ? { is: "done" } : { is: "locked", goal, lock };
}

/** What comes next, in the words every screen says it in: a small line over a title, the title, and a line under it. */
export function nextWords(n: Next): { readonly label: string; readonly title: string; readonly line: string } {
  if (n.is === "take") return { label: `Tier ${S.world.open.tier}`, title: "Take a project", line: `${n.count} ready` };
  if (n.is === "locked") return { label: `Next: ${nodeKind(n.goal)}`, title: GOALS[n.goal]?.title ?? "", line: n.lock };
  return { label: "", title: "Every project is done", line: "More tiers are coming." };
}

/** The research of the tiers open, in the table's order. */
export const researchOf = (): Goal[] =>
  ALL_GOALS.filter((g) => !isNode(g) && (GOALS[g]?.tier ?? 0) <= S.world.open.tier);

/** Whether a Study stands in the yard. */
export const studyStands = (): boolean => S.world.kind.includes(STUDY);

/** What a goal wants, each thing with how many have come of how many: all of them, once it is done. */
export function givenTo(g: Goal): Given {
  const want = GOALS[g]?.want;
  if (!want) return [];
  return givenIn(want, S.world.open.done[g] === 1 ? want : (S.world.got[g] ?? null));
}

/** How much of what a goal wants it has been given, of how much, over everything it wants. */
export function given(g: Goal): Count {
  const want = GOALS[g]?.want;
  const got = S.world.got[g];
  let have = 0;
  let of = 0;
  for (const k of ALL_ITEMS) {
    of += want?.[k] ?? 0;
    have += Math.min(got?.[k] ?? 0, want?.[k] ?? 0);
  }
  return { have, of };
}

/** How a goal that another needs stands. */
function standsOf(g: Goal): Stands {
  const w = S.world;
  if (w.open.done[g] === 1) return isNode(g) ? "done" : "known";
  if (isNode(g)) return w.hand === g ? "in hand" : "not begun";
  return w.line[0] === g ? "being studied" : w.line.includes(g) ? "in the line" : "not begun";
}

/**
 * What begins a goal another waits on, or nothing where it cannot be begun yet: a node is taken in
 * hand; research is put in the line, or with no Study standing, a Study is built, since nothing is
 * studied without one.
 */
function beginOf(g: Goal): Begin | null {
  const w = S.world;
  if (isNode(g)) return takeRefusal(w, g) === null ? "take" : null;
  if (!ready(w.open, g)) return null;
  if (!studyStands()) return locked(w.open, { build: STUDY }) === null ? "build" : null;
  return studyRefusal(w, g) === null ? "study" : null;
}

/** The research that may be put in the line now: none while the line is full. */
export const studiable = (): Goal[] => researchOf().filter((g) => studyRefusal(S.world, g) === null);

/**
 * The first piece of research, in the table's order, that is neither known nor in the line and can
 * be begun now, and what begins it: where the tier's screen leads on while nothing is being studied.
 */
export function firstToStudy(): { readonly goal: Goal; readonly begin: Begin } | null {
  const w = S.world;
  for (const g of researchOf()) {
    const begin = w.open.done[g] === 1 || w.line.includes(g) ? null : beginOf(g);
    if (begin !== null) return { goal: g, begin };
  }
  return null;
}

/**
 * What a goal still waits on: everything it needs done or known first, each with how it stands, or
 * nothing once all of it is. With `lead`, the first of them that is not begun and can be begun now
 * is printed with what begins it, so that the screen leads on.
 */
export function needsOf(g: Goal, lead = false): Need[] {
  const all = GOALS[g]?.needs ?? [];
  const needs = all.map((n): Need => ({ goal: n, stands: standsOf(n) }));
  if (needs.every((n) => n.stands === "done" || n.stands === "known")) return [];
  if (!lead) return needs;
  for (const [k, n] of needs.entries()) {
    const begin = n.stands === "not begun" ? beginOf(n.goal) : null;
    if (begin !== null) return needs.map((m, j) => (j === k ? { ...m, begin } : m));
  }
  return needs;
}
