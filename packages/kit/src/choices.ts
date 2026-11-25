/**
 * A row of choices, one chosen at a time, as the settings menu's tabs are: tabs, each showing a page
 * of its own, or a radio group, one setting of several. The chosen control is the row's one stop for
 * Tab, and the arrows choose the one beside it, round from the last to the first: Left and Right,
 * and in a radio group Up and Down too. A press or an arrow chooses, the keyboard stays on the
 * chosen control, and the owner is told (`choose`).
 *
 * The controls are made once and kept, so a page drawn again beside the row leaves the keyboard on
 * it. An owner that draws the whole row again finds the keyboard on the chosen control by its id, as
 * the new row has the same ids. What each choice shows and does (a sound, a tip) is the owner's.
 */
import { el } from "./dom.ts";

/** One choice: its id, and the word on its control. */
export interface Choice<Id extends string> {
  readonly id: Id;
  readonly name: string;
}

/** What a row of choices is. */
export interface ChoicesOf<Id extends string> {
  /** Tabs, each with a page of its own, or a radio group. */
  readonly kind: "tabs" | "radio";
  /** What the row is, said by a screen reader: its controls' ids begin with it. */
  readonly name: string;
  readonly chosen: Id;
  /** The row's classes besides `k-tabs`, and each control's besides `k-btn` ("sm"). */
  readonly row?: string;
  readonly look?: string;
  /** For tabs, the page they show: it is named by the chosen tab. */
  readonly page?: Pick<Element, "setAttribute">;
  /** Told when the player chooses, by a press or an arrow; not for `select`. */
  readonly choose: (id: Id) => void;
}

export interface Choices<Id extends string> {
  readonly el: HTMLElement;
  /** Shows `id` as the chosen one, as the owner has it now. */
  select(id: Id): void;
  /** Puts the keyboard on the chosen control. */
  focus(): void;
}

/** The keys that go along a row, by how far: back one or on one. */
const STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 };
const DOWN_THE_LIST: Readonly<Record<string, number>> = { ...STEPS, ArrowUp: -1, ArrowDown: 1 };

/** The choice an arrow goes to from `at` (round from the last to the first), or null for any other key. */
export function stepped<Id extends string>(
  ids: readonly Id[],
  at: Id,
  key: string,
  kind: ChoicesOf<Id>["kind"],
): Id | null {
  const step = (kind === "radio" ? DOWN_THE_LIST : STEPS)[key];
  if (step === undefined || ids.length === 0) return null;
  const i = Math.max(0, ids.indexOf(at));
  return ids[(i + step + ids.length) % ids.length] ?? null;
}

/** A row of choices (`ChoicesOf`). */
export function choices<Id extends string>(items: readonly Choice<Id>[], of: ChoicesOf<Id>): Choices<Id> {
  const tabs = of.kind === "tabs";
  const base = `k-${of.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const idOf = (id: Id): string => `${base}-${id}`;
  const controls = new Map(
    items.map((c) => [
      c.id,
      el("button", `k-btn ${of.look ?? ""}`.trim(), {
        type: "button",
        id: idOf(c.id),
        role: tabs ? "tab" : "radio",
        text: c.name,
      }),
    ]),
  );
  let chosen = of.chosen;
  const select = (id: Id): void => {
    chosen = id;
    for (const [at, b] of controls) {
      b.setAttribute(tabs ? "aria-selected" : "aria-checked", String(at === id));
      b.tabIndex = at === id ? 0 : -1;
    }
    of.page?.setAttribute("aria-labelledby", idOf(id));
  };
  /** The player chooses: shown at once, the keyboard on it, and the owner told. */
  const pick = (id: Id): void => {
    if (id === chosen) return;
    select(id);
    controls.get(id)?.focus();
    of.choose(id);
  };
  const row = el(
    "div",
    `k-tabs ${of.row ?? ""}`.trim(),
    {
      role: tabs ? "tablist" : "radiogroup",
      "aria-label": of.name,
      onclick: (e: Event) => {
        const hit = items.find((c) => controls.get(c.id) === e.target);
        if (hit) pick(hit.id);
      },
      onkeydown: (e: Event) => {
        const next =
          "key" in e && typeof e.key === "string"
            ? stepped(
                items.map((c) => c.id),
                chosen,
                e.key,
                of.kind,
              )
            : null;
        if (next === null) return;
        e.preventDefault();
        pick(next);
      },
    },
    ...controls.values(),
  );
  if (tabs) of.page?.setAttribute("role", "tabpanel");
  select(chosen);
  return {
    el: row,
    select,
    focus: () => controls.get(chosen)?.focus({ preventScroll: true }),
  };
}
