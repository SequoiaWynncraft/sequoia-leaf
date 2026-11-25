/**
 * Folds on the tier's and the research screens: the list of those done and the list of research
 * known, shut at first, and the list of projects, open at first, each under a label that folds it;
 * and each goal's card, open at first, with a button at the end of its head that folds it to the head.
 * And the card in the corner of the yard (`hud.ts`), open at first, which folds to one line. What the player chose is kept on this
 * device under `FOLDS`, beside the screen's other settings: a view, so nothing of it goes to Leaf.
 *
 * A fold is drawn from the kept choices on every drawing, so it stands as the player left it when
 * the screen is drawn again, the panel opened again or the page loaded again. Pressed, a fold only
 * shows or hides what it folds: nothing is built again, so the scroll does not move.
 */
import { type Goal, GOALS } from "@sequoia-leaf/factory";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";
import { isRecord } from "@sequoia-leaf/kit/net.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";

import { head } from "./goal.ts";
import { iconButton } from "./parts.ts";

/** The lists that fold, and the card in the corner (`track`), and whether each is open at first. */
const LISTS = { done: false, known: false, projects: true, track: true } as const;
type List = keyof typeof LISTS;
/** What folds: one of the lists, or a goal's card. */
export type Fold = List | Goal;

const isList = (k: string): k is List => k in LISTS;

/** Where the choices are kept. */
export const FOLDS = "works.folds.v1";

/** The choices made, as kept: each list's by its name, each card's by its goal's id; `true` is open. */
interface Choices {
  lists: Partial<Record<List, boolean>>;
  goals: Record<string, boolean>;
}

/** The choices kept on this device. Text missing or not read is no choice; a choice that does not read is left out alone. */
function kept(): Choices {
  const out: Choices = { lists: {}, goals: {} };
  try {
    const raw: unknown = JSON.parse(keptText(FOLDS) ?? "null");
    if (!isRecord(raw)) return out;
    for (const [list, open] of Object.entries(raw))
      if (isList(list) && typeof open === "boolean") out.lists[list] = open;
    if (isRecord(raw.goals))
      for (const [id, open] of Object.entries(raw.goals)) if (typeof open === "boolean") out.goals[id] = open;
  } catch {
    // Nonsense in it: no choice made.
  }
  return out;
}

const idOf = (g: Goal): string => GOALS[g]?.id ?? "";

/** Whether a fold is open: as the player left it, or else as `first` says, or as `LISTS` says for a list, and open for a card. */
export function opened(f: Fold, first?: boolean): boolean {
  const c = kept();
  return (typeof f === "number" ? c.goals[idOf(f)] : c.lists[f]) ?? first ?? (typeof f === "number" || LISTS[f]);
}

/** Keeps a choice made, beside those made before: the lists' by name, as they have always been kept, and the cards' under `goals`. */
export function keepFold(f: Fold, open: boolean): void {
  const c = kept();
  if (typeof f === "number") c.goals[idOf(f)] = open;
  else c.lists[f] = open;
  keepText(FOLDS, JSON.stringify({ ...c.lists, goals: c.goals }));
}

/** What a fold does besides showing or hiding its parts. */
interface Also {
  /** Shown in the parts' place while they are folded, and hidden while they are open. */
  readonly shut?: readonly HTMLElement[];
  /** Hidden with the parts by the page's style (`index.html`) rather than here, each with an id of its own: only named as what the button folds. */
  readonly styled?: readonly HTMLElement[];
  /** Whether it is open until the player chooses, where that is not as `opened` has it: asked each time it is drawn. */
  readonly first?: () => boolean;
}

/**
 * Makes `b` the fold of `parts`, which it names for whoever cannot see them: draws them from the kept
 * choice now, and gives what a press does: shows them if they were hidden or hides them, says so on
 * the button (in `name`'s words too, where the button is only a picture), keeps the choice and taps.
 * Nothing else is touched, so nothing is built again and the scroll does not move.
 */
function fold(
  b: HTMLElement,
  f: Fold,
  parts: readonly HTMLElement[],
  name?: (open: boolean) => string,
  { shut = [], styled = [], first }: Also = {},
): { press: () => void; again: () => void } {
  // Lists and cards have ids of their own kinds, so a goal called "done" is never the list's.
  const key = typeof f === "number" ? `goal-${idOf(f)}` : `list-${f}`;
  const ids = [...parts, ...shut].map((p, i) => (p.id ||= `fold-${key}-${i}`));
  b.setAttribute("aria-controls", [...ids, ...styled.map((p) => p.id)].join(" "));
  const set = (open: boolean): void => {
    for (const p of parts) p.hidden = !open;
    for (const p of shut) p.hidden = open;
    b.setAttribute("aria-expanded", String(open));
    if (name) b.setAttribute("aria-label", name(open));
  };
  const again = (): void => set(opened(f, first?.()));
  again();
  return {
    press: () => {
      const open = b.getAttribute("aria-expanded") !== "true";
      set(open);
      keepFold(f, open);
      sfx.tap();
    },
    again,
  };
}

/** A list under a label that folds it, with how many are in it: "Done 9". Gives the label, then the list. */
export function foldedList(f: List, word: string, list: HTMLElement): HTMLElement[] {
  const label = el(
    "button",
    "k-label fold",
    { type: "button", onclick: () => press() },
    icon("fold"),
    word,
    el("span", "k-faint", { text: String(list.childElementCount) }),
  );
  const { press } = fold(label, f, [list]);
  return [label, list];
}

/** A goal's head with `side` at its right as `head` has it, and after it the button that folds the rest of the card (`parts`). */
export function foldedHead(g: Goal, side: HTMLElement | null, parts: readonly HTMLElement[]): HTMLElement {
  const title = GOALS[g]?.title ?? "";
  const name = (open: boolean): string => `${open ? "Hide" : "Show"} ${title}`;
  const b = iconButton("wood sm fold", icon("fold"), name(true), () => press());
  const { press } = fold(b, g, parts, name);
  return head(g, side, b);
}

/**
 * The button that folds the card in the corner (`hud.ts`) to one line, `short` shown in `full`'s
 * place, and the research under the card (`under`) hidden with it by the page's style; open, until
 * the player chooses, while `first` says so. It stays on the page while the card is drawn again, so
 * that whoever is on it stays on it: `named` names it again for the card's title (`title`) as it is
 * now, and `again` folds it as `first` says now, where the player has not chosen.
 */
export function foldedCard(
  title: () => string,
  full: HTMLElement,
  short: HTMLElement,
  under: HTMLElement,
  first: () => boolean,
): { button: HTMLElement; named: () => void; again: () => void } {
  const name = (open: boolean): string => `${open ? "Hide" : "Show"} ${title()}`;
  const b = iconButton("wood sm fold", icon("fold"), name(first()), () => press());
  const { press, again } = fold(b, "track", [full], name, { shut: [short], styled: [under], first });
  return {
    button: b,
    named: () => b.setAttribute("aria-label", name(b.getAttribute("aria-expanded") === "true")),
    again,
  };
}
