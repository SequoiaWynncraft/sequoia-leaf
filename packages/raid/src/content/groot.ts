/**
 * Groot's true forms: the five figures named after the guild's raids, as the raiders saw them. A
 * Groot figure that gets back up (the Groot trait, `traits.ts`) does so in its true form: the same
 * figure with the same ability, with more attack and ability power (Groot's `more`), and the one
 * change each has here. Words and numbers only; what a form changes in a fight is in `fight/`
 * (`enter.ts` for the Rock's numbers, `abilities.ts` for the rest).
 *
 * A figure that carries Groot and has no true form here (one made Groot by an emblem, when there is
 * one) gets back up as itself.
 */
import type { FigureId } from "./figures.ts";

export interface TrueForm {
  readonly name: string;
  /** The one thing that changes besides the look, in a sentence; `{name}` is filled from `n`. */
  readonly text: string;
  readonly n: Readonly<Record<string, number>>;
}

export const TRUE_FORM_IDS = ["worm", "moth", "rock", "greg", "whitefox"] as const satisfies readonly FigureId[];
export type TrueFormId = (typeof TRUE_FORM_IDS)[number];

export const TRUE_FORMS: Readonly<Record<TrueFormId, TrueForm>> = {
  worm: { name: "Real Worm", text: "Under And Up also hits every enemy touching where it comes up.", n: {} },
  moth: { name: "Real Moth", text: "Wing Dust covers the hexes {reach} away as well.", n: { reach: 2 } },
  rock: {
    name: "Real Rock",
    text: "It has {attack} attack and attacks {speed} times a second.",
    n: { attack: 60, speed: 0.6 },
  },
  greg: {
    name: "Real Greg",
    text: "Greg Sits Down first pulls every enemy within {pull} hexes 1 hex nearer.",
    n: { pull: 3 },
  },
  whitefox: {
    name: "Real Orphion",
    text: "Antlers Ring also gives the party {heal}% of its health back.",
    n: { heal: 8 },
  },
};

export const hasTrueForm = (kind: string): kind is TrueFormId => TRUE_FORM_IDS.some((id) => id === kind);
/** One of a true form's numbers; 0 for a figure with no true form, or a form with no such number. */
export const formNumber = (kind: string, name: string): number =>
  hasTrueForm(kind) ? (TRUE_FORMS[kind].n[name] ?? 0) : 0;
/** A true form's change in a sentence, its numbers filled in; empty for a figure with none. */
export function formText(kind: string): string {
  if (!hasTrueForm(kind)) return "";
  const form = TRUE_FORMS[kind];
  return form.text.replaceAll(/\{(\w+)\}/g, (whole: string, key: string) => {
    const v = form.n[key];
    return v === undefined ? whole : String(v);
  });
}
