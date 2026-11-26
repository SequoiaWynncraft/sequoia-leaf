/**
 * Blueprint codes on the page: Copy code beside the bin, for a blueprint in hand that is not a plan of
 * the whole yard, puts its code on the clipboard; where the browser will not, the code is shown in a
 * box to copy by hand. Paste code beside Save yard opens the box with a field to paste a code into:
 * a code the rules read as a blueprint is offered the places to keep it in, as Save offers them; one
 * they do not is said why. Kept, the blueprint is taken in hand.
 *
 * The box (`#code`, over the yard under the top bar) is one at a time, a layer that Escape or Close
 * puts away, and it goes with what is held (`handSession`).
 */
import { cleanCode, codeRefusal } from "@sequoia-leaf/factory";
import { dialog } from "@sequoia-leaf/kit/dialog.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";
import { type Scope, scope } from "@sequoia-leaf/kit/scope.ts";

import { codeIn, type CopyPrint, pasteIn } from "../plans.ts";
import { yardSfx } from "../sound.ts";
import { handSession, S, toolHooks } from "../state.ts";
import { hold } from "../tools.ts";
import { $, button } from "./parts.ts";
import { pastePlaces } from "./places.ts";

/** The box's openings, one at a time: each new one closes the one before. */
const boxes = scope().turns();

/** How long Copy code says it copied: as long as the town says a link was. */
const COPIED_MS = 2000;

/** Opens the box named `title`, filled by `fill` for as long as it is up; Close, Escape and a change of what is held put it away. */
function open(title: string, fill: (life: Scope, close: () => void) => HTMLElement[]): void {
  const root = $("code");
  const life = boxes({});
  const close = (): void => life.close();
  life.hold(handSession().hold(close));
  root.replaceChildren(el("h2", "k-title", { text: title }), ...fill(life, close));
  root.hidden = false;
  life.hold(() => {
    root.hidden = true;
    root.replaceChildren();
  });
  life.hold(dialog(root, title, close));
}

/** The box with a blueprint's code in it, chosen, to copy by hand. */
function showCode(code: string): void {
  const field = el("textarea", "k-field", { readonly: "", rows: 4, "aria-label": "Blueprint code" });
  field.value = code;
  open("Blueprint code", (life, close) => {
    life.on(field, "focus", () => field.setSelectionRange(0, field.value.length));
    return [field, el("div", "k-row end", {}, button("wood sm", ["Close"], close))];
  });
  field.focus({ preventScroll: true });
  field.setSelectionRange(0, field.value.length);
}

/**
 * Copy code pressed: the code of the blueprint in a place on the clipboard, and the button says so
 * for a moment while it is held (`S.copied`); where the browser refuses, the box.
 */
async function copyCode(slot: number): Promise<void> {
  const code = codeIn(slot);
  if (code === null) return;
  const session = handSession();
  const forget = (): void => {
    if (S.copied !== slot) return;
    S.copied = -1;
    toolHooks.changed();
  };
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    forget();
    // Refused after the hand moved on (another tool, or Paste code open): the box is not shown over it.
    if (!session.closed) showCode(code);
    return;
  }
  if (session.closed) return;
  yardSfx.pick();
  S.copied = slot;
  session.hold(forget);
  session.after(COPIED_MS, forget);
  toolHooks.changed();
}

/** Copy code, for the blueprint in hand when the line's print offers it: "Copied" for a moment once it has. */
export function copyButton(copy: CopyPrint | null): HTMLElement[] {
  if (copy === null) return [];
  const b = button("sm", [copy.copied ? "Copied" : "Copy code"], () => void copyCode(copy.slot));
  b.dataset.act = "copy-code";
  return [b];
}

/** Paste code, when the line's print offers it. */
export function pasteButton(offered: boolean): HTMLElement[] {
  if (!offered) return [];
  const b = button("sm", ["Paste code"], askCode);
  b.dataset.act = "paste-code";
  return [b];
}

/**
 * The box with a field to paste a code into. A code the rules read as a blueprint that fits the yard's
 * places is offered them; one they do not is said why. Kept, the box goes and the blueprint is in hand.
 */
function askCode(): void {
  const field = el("input", "k-field", {
    type: "text",
    placeholder: "Blueprint code",
    "aria-label": "Blueprint code",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
  });
  const line = el("div", "say");
  const places = el("div", "places");
  const keep = (slot: number): void => {
    const why = pasteIn(slot, field.value);
    if (why === null) hold(slot);
    else said(why, true);
  };
  const said = (text: string, bad: boolean): void => {
    line.textContent = text;
    line.classList.toggle("bad", bad);
  };
  const draw = (): void => {
    const code = cleanCode(field.value);
    const why = code === "" ? null : codeRefusal(S.world.open, code);
    said(code === "" ? "" : why === null ? "Paste it in which place?" : `${why}.`, why !== null);
    places.replaceChildren(...(code !== "" && why === null ? pastePlaces(code, keep, draw) : []));
  };
  open("Paste code", (life, close) => {
    life.on(field, "input", draw);
    return [field, line, places, el("div", "k-row end", {}, button("wood sm", ["Cancel"], close))];
  });
  field.focus({ preventScroll: true });
}
