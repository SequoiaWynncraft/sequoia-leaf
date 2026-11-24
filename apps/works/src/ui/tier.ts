/**
 * The tier's own screen: its commission, picked out; from the tier that has research, its research
 * (`researchPart`); its projects, each with what it wants and what it unlocks, each card folding to
 * its head; and those done, a line each, folded under their label at first (`folds.ts`). Every
 * goal on it is laid out by `goal.ts`: one head, and its lists. Nothing is said of a tier not yet
 * open but that the commission opens it. A goal that waits on another is locked: a lock and what is
 * left before it opens at its head, and what it wants behind a lock, with no bar, since nothing
 * counts toward it yet. With every project done, it says so. While a node is in hand, one that may be taken can be put
 * in line after it (Next); one in the line shows its place after the hand ("2nd") and Take out.
 *
 * The screen always leads on: a goal that waits on another shows what it needs as things with how
 * each stands, and the first of those that can be begun carries the button that begins it.
 *
 * It is kept by what it prints (`tierPrint`, `shows`); its bars are asked of the yard at every
 * refresh, so a thing delivered moves a bar and builds nothing again.
 */
import { type Goal, GOALS, QUEUE, ready, STUDY } from "@sequoia-leaf/factory";
import { el, icon, replay } from "@sequoia-leaf/kit/dom.ts";

import { takeInHand } from "../plots.ts";
import { yardSfx } from "../sound.ts";
import { S } from "../state.ts";
import { setTool } from "../tools.ts";
import { doNow } from "../yard.ts";
import { foldedHead, foldedList } from "./folds.ts";
import {
  type Begin,
  goalCard,
  head,
  leaves,
  type Listed,
  lockChip,
  type Need,
  needs,
  some,
  unlocks,
  type Wants,
  wants,
  wantsIn,
} from "./goal.ts";
import { feed } from "./notes.ts";
import { button, shows } from "./parts.ts";
import { type Studied, studiedNow, studiedWants } from "./research.ts";
import { firstToStudy, given, lockOf, needsOf, nextWords, nodesOpen, researchOf } from "./standing.ts";

/** What the screen asks of the rest of the page. */
export const tierHooks: {
  /** Something on it was done: everything over the yard is brought up to date. */
  changed: () => void;
  /** The research screen is asked for. */
  research: () => void;
  /** The screen is put away, for the yard to be built on. */
  close: () => void;
} = { changed: () => {}, research: () => {}, close: () => {} };

/** Takes a node in hand from a button, and says so. */
function take(g: Goal, b: HTMLElement): void {
  if (takeInHand(g) !== null) replay(b, "shake");
  else feed(`In hand: ${GOALS[g]?.title ?? ""}.`, "gold");
  tierHooks.changed();
}

/** Puts a node in line after the one in hand, or takes it out of the line. */
function line(g: Goal, into: boolean, b: HTMLElement): void {
  const did = doNow({ do: into ? "queue" : "unqueue", node: g });
  if ("refused" in did) {
    yardSfx.no();
    replay(b, "shake");
  } else yardSfx.plan();
  tierHooks.changed();
}

/** A place in the line, counting the node in hand as the first: "2nd", "3rd". */
const placed = (n: number): string => `${n}${n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

/**
 * The button that begins a goal another waits on: a node is taken in hand; research is put in the
 * line, or with no Study standing, the Study is taken up as the tool, since nothing is studied
 * without one.
 */
export function beginButton(g: Goal, how: Begin): HTMLElement {
  if (how === "take") return button("sm", ["Take"], (b) => take(g, b));
  if (how === "build")
    return button("sm", ["Build a Study"], () => {
      setTool(STUDY);
      tierHooks.close();
    });
  return button("sm", ["Study"], () => {
    if (!("refused" in doNow({ do: "study", research: g }))) yardSfx.plan();
    tierHooks.changed();
  });
}

/** A goal on the screen, as printed: whether it may be taken in hand, what opens it while it is not open, what it wants, and what it still waits on. */
interface Shown {
  readonly goal: Goal;
  readonly take: boolean;
  readonly lock: string | null;
  readonly wants: Wants;
  readonly needs: readonly Need[];
}

/**
 * The research of the tiers open, as the tier's screen prints it: how much of it is known, of how
 * much; the piece being studied; and while nothing is, the first piece that can be begun, with what
 * begins it.
 */
interface TierResearch {
  readonly known: number;
  readonly all: number;
  readonly studied: Studied | null;
  readonly ready: { readonly goal: Goal; readonly begin: Begin } | null;
}

/**
 * What the tier's screen prints: the tier, the node in hand and those in line after it; the tier's
 * commission, while it is not done; its research, where the tiers open have any; the projects not
 * done, the tier's own first; and the projects and commissions done.
 */
export function tierPrint(): {
  readonly tier: number;
  readonly hand: Goal | -1;
  readonly queue: readonly Goal[];
  readonly commission: Shown | null;
  readonly research: TierResearch | null;
  readonly projects: readonly Shown[];
  readonly done: readonly Goal[];
} {
  const w = S.world;
  const tier = w.open.tier;
  const shown = (g: Goal): Shown => ({
    goal: g,
    take: ready(w.open, g),
    lock: lockOf(g),
    wants: wantsIn(GOALS[g]?.want ?? new Float64Array(0)),
    needs: needsOf(g, true),
  });
  const nodes = nodesOpen();
  const open = nodes.filter((g) => w.open.done[g] !== 1);
  const commission = open.find((g) => GOALS[g]?.kind === "commission" && GOALS[g]?.tier === tier);
  const research = researchOf();
  const studied = studiedNow();
  return {
    tier,
    hand: w.hand,
    queue: [...w.queue],
    commission: commission === undefined ? null : shown(commission),
    research:
      research.length === 0
        ? null
        : {
            known: research.filter((g) => w.open.done[g] === 1).length,
            all: research.length,
            studied,
            ready: studied === null ? firstToStudy() : null,
          },
    // The tier's own projects first, then any of an earlier tier not yet done.
    projects: open
      .filter((g) => GOALS[g]?.kind === "project")
      .toSorted((a, b) => (GOALS[b]?.tier ?? 0) - (GOALS[a]?.tier ?? 0))
      .map(shown),
    done: nodes.filter((g) => w.open.done[g] === 1),
  };
}

/**
 * The tier's research, as a section like its projects: a label with how much is known; the piece
 * being studied, with a bar for each folio it wants; or while nothing is, says so, with the first
 * piece that can be begun and the button that begins it; and the way to the research screen. With
 * everything known, the label and the way alone. It does not fold: it is what is being worked on.
 * `keep` keeps its lists, for their bars to be brought up to date between drawings.
 */
function researchPart(r: TierResearch, keep: (made: Listed[]) => Listed[]): HTMLElement[] {
  const label = el("div", "k-label", {}, "Research", el("span", "k-faint", { text: `${r.known} of ${r.all} known` }));
  const all = button("wood sm all-research", ["All research"], () => tierHooks.research());
  const { studied, ready: first } = r;
  if (studied) return [label, researchCard(studied.goal, null, keep(some(studiedWants(studied)))), all];
  if (r.known === r.all) return [label, all];
  const idle = el("div", "k-dim research-idle", { text: "Nothing is being studied." });
  const begin = first ? [researchCard(first.goal, beginButton(first.goal, first.begin), [])] : [];
  return [label, idle, ...begin, all];
}

/** A piece of research on the tier's screen, as a card: its head, with `side` at its right, and its lists. */
const researchCard = (g: Goal, side: HTMLElement | null, lists: readonly Listed[]): HTMLElement =>
  el("div", "k-card goal", { "data-research": GOALS[g]?.id ?? "" }, head(g, side), ...lists.map((l) => l.node));

/** The tier's screen, built into a panel's body. Gives the way to bring it up to date. */
export function tierScreen(body: HTMLElement): () => void {
  let live: Listed[] = [];
  const draw = (p: ReturnType<typeof tierPrint>): void => {
    live = [];
    const kids: HTMLElement[] = [];
    /** Lists kept so that their bars are brought up to date between drawings. */
    const keep = (made: Listed[]): Listed[] => {
      live.push(...made);
      return made;
    };
    /** A goal's lists. */
    const lists = ({ goal: g, wants: want, needs: waits, lock }: Shown): Listed[] =>
      keep(
        some(
          wants(want, () => S.world.got[g] ?? null, lock !== null),
          needs(waits, { given, begin: beginButton }),
          unlocks(g),
          leaves(g),
        ),
      );
    /**
     * What stands at the right of a goal's head: that it is in hand; its place in the line, with the
     * button that takes it out; the buttons that put it in the line (while a node is in hand) and take
     * it; or while it waits on another, a lock and what opens it.
     */
    const side = ({ goal: g, take: may, lock }: Shown, label: string): HTMLElement | null => {
      if (p.hand === g) return el("span", "k-chip lit", {}, icon("check"), "In hand");
      if (lock !== null) return lockChip(lock);
      const at = p.queue.indexOf(g);
      if (at >= 0)
        return el(
          "span",
          "k-row",
          {},
          el("span", "k-chip", { text: placed(at + 2) }),
          button("wood sm", ["Take out"], (b) => line(g, false, b)),
        );
      if (!may) return null;
      const taking = button("sm", [label], (b) => take(g, b));
      if (p.hand === -1) return taking;
      const full = p.queue.length >= QUEUE;
      return el(
        "span",
        "k-row",
        {},
        button(full ? "wood sm off" : "wood sm", ["Next"], (b) => line(g, true, b)),
        taking,
      );
    };
    const c = p.commission;
    if (c) kids.push(goalCard(c.goal, side(c, "Take in hand"), lists(c)));
    // Every project of the tiers open is done, and there is no next tier yet: it says so, first.
    else if (p.projects.length === 0) {
      const end = nextWords({ is: "done" });
      kids.push(
        el("div", "k-card goal", {}, el("div", "k-title", { text: end.title }), el("div", "k-d", { text: end.line })),
      );
    }
    if (p.research) kids.push(...researchPart(p.research, keep));
    if (p.projects.length > 0) kids.push(el("div", "k-label", { text: "Projects" }));
    for (const g of p.projects) {
      const parts = lists(g).map((l) => l.node);
      const lit = p.hand === g.goal ? " lit" : g.lock === null ? "" : " locked";
      kids.push(el("div", `k-card goal${lit}`, {}, foldedHead(g.goal, side(g, "Take"), parts), ...parts));
    }
    if (p.done.length > 0)
      kids.push(...foldedList("done", "Done", el("div", "goals-done", {}, ...p.done.map((g) => head(g)))));
    const top = body.scrollTop;
    body.replaceChildren(...kids);
    body.scrollTop = top;
  };
  const shape = shows(tierPrint, draw);
  return () => {
    shape();
    for (const l of live) l.update();
  };
}
