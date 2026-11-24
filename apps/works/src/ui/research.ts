/**
 * Research, as a screen of its own and as a slim bar in the corner. The screen, top to bottom: what
 * is being studied, with each folio it wants and the pace the Studies give it; what waits after it
 * in the line; what may be studied, as the small tree it is (one that needs another hangs off it);
 * and what is known. Every piece of research on it is laid out by `goal.ts`, as a goal is anywhere.
 *
 * Each is kept by what it prints (`researchPrint`, `stripPrint`; `shows`). The screen's bars and the
 * line that says the Studies' pace are asked of the yard at every refresh, so a folio studied moves
 * a bar and builds nothing again.
 */
import {
  condition,
  type Counts,
  type Goal,
  GOALS,
  ITEM_INFO,
  LINE,
  litOf,
  rate,
  STATES,
  status,
  STUDY,
  studyRefusal,
  TROUBLE,
  unlockedBy,
} from "@sequoia-leaf/factory";
import { describe } from "@sequoia-leaf/kit/card.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";

import { yardSfx } from "../sound.ts";
import { S } from "../state.ts";
import { doNow } from "../yard.ts";
import { head, type Listed, lockChip, type Need, needs, some, unlocks, type Wants, wants, wantsIn } from "./goal.ts";
import { $, button, fitted, shows } from "./parts.ts";
import { itemRef } from "./refs.ts";
import { given, lockOf, needsOf, researchOf, studyStands } from "./standing.ts";

/** What the screen asks of the rest of the page: everything over the yard brought up to date. */
export const researchHooks: { changed: () => void } = { changed: () => {} };

const WORKING = STATES.indexOf("working");
/** A number as the screen says it: whole, or to one place. */
const n = (v: number): string => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
/** A list in words: "a, b and c". */
const listed = (parts: readonly string[]): string =>
  parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}` : (parts[0] ?? "");

/** One Study, or several, in words. */
const many = (count: number): string => (count === 1 ? "Study" : "Studies");

/**
 * How the Studies stand toward the research being studied: how many folios a minute those at work
 * take in, and from how many; or, with none at work, why not.
 */
export function studying(): { pace: number; working: number; says: string } {
  const w = S.world;
  const lit = litOf(w);
  let standing = 0;
  let dark = 0;
  let working = 0;
  let pace = 0;
  const missing = new Set<number>();
  for (let i = 0; i < w.kind.length; i++) {
    if (w.kind[i] !== STUDY) continue;
    standing++;
    if (lit[i] !== 1) dark++;
    else if (condition(w, i) % TROUBLE === WORKING) {
      working++;
      pace += rate(w, i);
    } else for (const f of status(w, i)?.missing ?? []) missing.add(f);
  }
  const says =
    standing === 0
      ? "No Study stands."
      : working > 0
        ? `${n(pace)} folios a minute from ${working} ${many(working)}.`
        : dark === standing
          ? `No power reaches the ${many(standing)}.`
          : missing.size > 0
            ? `No ${listed([...missing].map((f) => ITEM_INFO[f]?.many ?? ""))} reach the ${many(standing)}.`
            : "";
  return { pace, working, says };
}

/** Puts a piece of research in the line, or takes it out. */
function setStudied(g: Goal, into: boolean): void {
  const did = doNow({ do: into ? "study" : "unstudy", research: g });
  if ("refused" in did) yardSfx.no();
  else yardSfx.plan();
  researchHooks.changed();
}

/** The button that takes a piece of research out of the line. */
const out = (g: Goal): HTMLElement => button("wood sm", ["Take out"], () => setStudied(g, false));

/** What a piece of research has been given, asked of the yard at every refresh. */
const got = (g: Goal) => (): Counts | null => S.world.got[g] ?? null;

/** What a piece of research wants, as printed. */
const wanted = (g: Goal): Wants => wantsIn(GOALS[g]?.want ?? new Float64Array(0));

/** A piece of research that may be studied, or waits on another, as printed. */
interface Open {
  readonly goal: Goal;
  /** Whether the rules would put it in the line now. */
  readonly may: boolean;
  /** While it waits on research not yet known, what is left before it opens: "1 research left". */
  readonly lock: string | null;
  readonly wants: Wants;
  readonly needs: readonly Need[];
}

/**
 * What the research screen prints: what is being studied and what it wants; the rest of the line;
 * whether the line is full; what is neither known nor in the line; what is known; and whether
 * anything is left to know.
 */
export function researchPrint(): {
  readonly first: { readonly goal: Goal; readonly wants: Wants } | null;
  readonly next: readonly Goal[];
  readonly full: boolean;
  readonly todo: readonly Open[];
  readonly known: readonly Goal[];
  readonly left: boolean;
} {
  const w = S.world;
  const all = researchOf();
  const [first, ...next] = w.line;
  return {
    first: first === undefined ? null : { goal: first, wants: wanted(first) },
    next,
    full: w.line.length >= LINE,
    todo: all
      .filter((g) => w.open.done[g] !== 1 && !w.line.includes(g))
      .map((g) => ({
        goal: g,
        may: studyRefusal(w, g) === null,
        lock: lockOf(g),
        wants: wanted(g),
        needs: needsOf(g),
      })),
    known: all.filter((g) => w.open.done[g] === 1),
    left: all.some((g) => w.open.done[g] !== 1),
  };
}

/** The research screen, built into a panel's body. Gives the way to bring it up to date. */
export function researchScreen(body: HTMLElement): () => void {
  let live: Listed[] = [];
  /** The line that says the Studies' pace, and what it says now. */
  let pace: HTMLElement | null = null;
  let said = "";
  const draw = (p: ReturnType<typeof researchPrint>): void => {
    live = [];
    pace = null;
    said = "";
    const kids: HTMLElement[] = [];
    const lists = (...made: readonly (Listed | null)[]): HTMLElement[] => {
      const shown = some(...made);
      live.push(...shown);
      return shown.map((l) => l.node);
    };
    // 1. What is being studied.
    kids.push(el("div", "k-label", { text: "Being studied" }));
    const first = p.first;
    if (first === null)
      kids.push(
        el(
          "div",
          "k-card",
          {},
          el("div", "k-grow", { text: p.left ? "Nothing is being studied." : "Everything here is known." }),
        ),
      );
    else {
      const [only, more] = unlockedBy(first.goal);
      pace = el("div", "k-read k-dim");
      kids.push(
        el(
          "div",
          "k-card lit goal",
          { "data-research": GOALS[first.goal]?.id ?? "" },
          head(first.goal, out(first.goal)),
          // What it is, in the sentence of the one thing it unlocks; several are shown as things below.
          only && !more ? el("div", "k-read k-dim", { text: only.says }) : null,
          ...lists(wants(first.wants, got(first.goal)), unlocks(first.goal)),
          pace,
        ),
      );
    }
    // 2. The rest of the line.
    if (p.next.length > 0) kids.push(el("div", "k-label", { text: "Next" }));
    for (const g of p.next)
      kids.push(el("div", "k-card goal", { "data-research": GOALS[g]?.id ?? "" }, head(g, out(g))));
    // 3. What may be studied: a tree, one that needs another hanging off it.
    const todo = p.todo.map((o) => o.goal);
    if (todo.length > 0)
      kids.push(el("div", "k-label", { text: p.full ? `To study: the line holds ${LINE}` : "To study" }));
    /** The piece of research in the list that another hangs off: the first it needs that is in the list. */
    const parent = (g: Goal): Goal | undefined => (GOALS[g]?.needs ?? []).find((m) => todo.includes(m));
    const card = (o: Open): HTMLElement => {
      const g = o.goal;
      const study = button(o.may ? "sm" : "sm off", ["Study"], (b) => {
        if (studyRefusal(S.world, g) === null) setStudied(g, true);
        else b.blur();
      });
      return el(
        "div",
        `k-card goal plan${o.lock === null ? "" : " locked"}`,
        { "data-research": GOALS[g]?.id ?? "" },
        head(g, o.lock === null ? study : lockChip(o.lock)),
        ...lists(wants(o.wants, got(g), o.lock !== null), needs(o.needs, { given }), unlocks(g)),
      );
    };
    const branch = (o: Open): HTMLElement[] => {
      const hung: HTMLElement[] = [];
      for (const c of p.todo) if (parent(c.goal) === o.goal) hung.push(el("i", "twig"), ...branch(c));
      return hung.length === 0 ? [card(o)] : [el("div", "branch", {}, card(o), ...hung)];
    };
    for (const o of p.todo) if (parent(o.goal) === undefined) kids.push(...branch(o));
    // 4. What is known.
    if (p.known.length > 0)
      kids.push(el("div", "k-label", { text: "Known" }), el("div", "goals-done", {}, ...p.known.map((g) => head(g))));
    const top = body.scrollTop;
    body.replaceChildren(...kids);
    body.scrollTop = top;
  };
  const shape = shows(researchPrint, draw);
  return () => {
    shape();
    const says = pace ? studying().says : "";
    if (pace && says !== said) {
      pace.textContent = says;
      said = says;
    }
    for (const l of live) l.update();
  };
}

/**
 * What the slim bar prints: whether it is there (once a Study stands and something is in the line,
 * or could be, and not in a visit); the research being studied, and how far it has come of how far.
 */
export function stripPrint(): {
  readonly hidden: boolean;
  readonly goal: Goal | null;
  readonly have: number;
  readonly of: number;
} {
  const w = S.world;
  const g = w.line[0] ?? null;
  const idle = g === null && studyStands() && researchOf().some((r) => w.open.done[r] !== 1);
  const far = g === null ? { have: 0, of: 0 } : given(g);
  return { hidden: S.visiting !== null || (g === null && !idle), goal: g, have: far.have, of: far.of };
}

/**
 * The slim bar under the node in hand: the research being studied, its folio, its name and how far
 * it has come. Pressed, it opens the screen.
 */
export function studyStrip(open: () => void): () => void {
  const host = $("study");
  host.addEventListener("click", open);
  const fill = el("i");
  const bar = el("div", "k-bar", {}, fill);
  const pic = el("span", "pic");
  const name = el("span", "k-grow name");
  host.append(pic, name, bar);
  /** The research whose folio and name are drawn: only the bar moves while it is the same. */
  let drawn: Goal | null | undefined;
  return shows(stripPrint, (p) => {
    host.hidden = p.hidden;
    if (p.hidden) return;
    const g = p.goal;
    if (g !== drawn) {
      drawn = g;
      // The folio it is studied in: the first it wants.
      const folio = g === null ? undefined : wanted(g)[0]?.[0];
      const art = folio === undefined ? null : describe(itemRef(folio))?.icon;
      pic.replaceChildren(...(art instanceof HTMLCanvasElement ? [fitted(art, 12, 12)] : []));
      name.textContent = g === null ? "Nothing is being studied" : (GOALS[g]?.title ?? "");
      bar.hidden = g === null;
    }
    fill.style.setProperty("--v", `${p.of > 0 ? (p.have / p.of) * 100 : 0}%`);
  });
}
