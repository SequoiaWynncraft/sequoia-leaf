/**
 * Folds on the tier's and the research screens: the list of those done and the list of research
 * known, shut at first, each under a label that opens it; and each goal's card, open at first, with
 * a button at the end of its head that folds it to the head. What the player chose is kept on this
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

/** What folds: the list of those done, the list of research known, or a goal's card. */
export type Fold = "done" | "known" | Goal;
type List = "done" | "known";

/** Where the choices are kept. */
export const FOLDS = "works.folds.v1";

/** The choices made, as kept: each list's by its name, each card's by its goal's id; `true` is open. */
interface Choices {
  done?: boolean;
  known?: boolean;
  goals: Record<string, boolean>;
}

/** The choices kept on this device. Text missing or not read is no choice; a choice that does not read is left out alone. */
function kept(): Choices {
  const out: Choices = { goals: {} };
  try {
    const raw: unknown = JSON.parse(keptText(FOLDS) ?? "null");
    if (!isRecord(raw)) return out;
    if (typeof raw.done === "boolean") out.done = raw.done;
    if (typeof raw.known === "boolean") out.known = raw.known;
    if (isRecord(raw.goals))
      for (const [id, open] of Object.entries(raw.goals)) if (typeof open === "boolean") out.goals[id] = open;
  } catch {
    // Nonsense in it: no choice made.
  }
  return out;
}

const idOf = (g: Goal): string => GOALS[g]?.id ?? "";

/** Whether a fold is open: as the player left it, or else a list shut and a card open. */
export function opened(f: Fold): boolean {
  const c = kept();
  return typeof f === "number" ? (c.goals[idOf(f)] ?? true) : (c[f] ?? false);
}

/** Keeps a choice made, beside those made before. */
export function keepFold(f: Fold, open: boolean): void {
  const c = kept();
  if (typeof f === "number") c.goals[idOf(f)] = open;
  else c[f] = open;
  keepText(FOLDS, JSON.stringify(c));
}

/**
 * Makes `b` the fold of `parts`, which it names for whoever cannot see them: draws them from the kept
 * choice now, and gives what a press does: shows them if they were hidden or hides them, says so on
 * the button (in `name`'s words too, where the button is only a picture), keeps the choice and taps.
 * Nothing else is touched, so nothing is built again and the scroll does not move.
 */
function fold(b: HTMLElement, f: Fold, parts: readonly HTMLElement[], name?: (open: boolean) => string): () => void {
  const key = typeof f === "number" ? idOf(f) : f;
  b.setAttribute("aria-controls", parts.map((p, i) => (p.id ||= `fold-${key}-${i}`)).join(" "));
  const set = (open: boolean): void => {
    for (const p of parts) p.hidden = !open;
    b.setAttribute("aria-expanded", String(open));
    if (name) b.setAttribute("aria-label", name(open));
  };
  set(opened(f));
  return () => {
    const open = b.getAttribute("aria-expanded") !== "true";
    set(open);
    keepFold(f, open);
    sfx.tap();
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
  const press = fold(label, f, [list]);
  return [label, list];
}

/** A goal's head with `side` at its right as `head` has it, and after it the button that folds the rest of the card (`parts`). */
export function foldedHead(g: Goal, side: HTMLElement | null, parts: readonly HTMLElement[]): HTMLElement {
  const title = GOALS[g]?.title ?? "";
  const name = (open: boolean): string => `${open ? "Hide" : "Show"} ${title}`;
  const b = iconButton("wood sm fold", icon("fold"), name(true), () => press());
  const press = fold(b, g, parts, name);
  return head(g, side, b);
}
