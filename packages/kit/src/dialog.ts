/**
 * What opens over the page and is put away again: a panel, a pinned card, a notice. Each is a
 * layer, the newest on top. While one is open, Tab goes round inside the newest, and Escape puts
 * away the newest only (none other hears that Escape: one layer a press). When one goes, the focus
 * goes back to where it was before it opened, if the keyboard was the last used in it.
 *
 * `dialog(node, title, close)` makes an element such a layer and tells a screen reader it is a
 * dialog named by its title; `layer(at, close)` is the same without that, for a thing that names
 * itself and is drawn again as a new element (the card).
 */
import { heldAgain } from "./keys.ts";

interface Layer {
  /** Its element now. */
  readonly at: () => HTMLElement | null;
  /** Puts it away (the page's own way), or null for a notice that must be answered. */
  readonly close: (() => void) | null;
  /** Where the focus was as it opened. */
  readonly back: Element | null;
  /** The keyboard was the last used in it, so the focus goes back as it goes. */
  keyed: boolean;
}

const layers: Layer[] = [];
let made = 0;
let quiet = false;

/** Whether the focus is being given back (`giveBack`): nothing that shows itself on focus (a tip, a card) does. */
export const givingBack = (): boolean => quiet;

/**
 * Puts the focus back on what had it, with nothing showing itself for that focus: a link given the
 * focus back must not open its card again, nor a button show its tip.
 */
export function giveBack(to: HTMLElement): void {
  quiet = true;
  try {
    to.focus({ preventScroll: true });
  } finally {
    quiet = false;
  }
}

/** The things in an element Tab stops at, in order. */
const stops = (node: HTMLElement): HTMLElement[] =>
  [...node.querySelectorAll("*")].filter(
    (e): e is HTMLElement =>
      e instanceof HTMLElement && e.tabIndex >= 0 && !e.matches(":disabled") && e.getClientRects().length > 0,
  );

/** Something opens over the page. Returns what to call once it has been put away. */
export function layer(at: () => HTMLElement | null, close: (() => void) | null): () => void {
  const l: Layer = { at, close, back: typeof document === "undefined" ? null : document.activeElement, keyed: false };
  layers.push(l);
  return () => {
    const i = layers.indexOf(l);
    if (i < 0) return;
    layers.splice(i, 1);
    const now = document.activeElement;
    const lost = now === null || now === document.body || !now.isConnected || (at()?.contains(now) ?? false);
    if (l.keyed && lost && l.back instanceof HTMLElement && l.back.isConnected) giveBack(l.back);
  };
}

/**
 * Makes `node` a dialog named by `title` (its title's element, or words), holds it as a layer, and
 * puts the focus in it unless it is there already. `close` is what Escape does (null: it must be
 * answered). Returns what to call once it has been put away.
 */
export function dialog(node: HTMLElement, title: HTMLElement | string, close: (() => void) | null): () => void {
  if (!node.hasAttribute("role")) node.setAttribute("role", "dialog");
  if (typeof title === "string") node.setAttribute("aria-label", title);
  else {
    if (!title.id) title.id = `k-dialog-${++made}`;
    node.setAttribute("aria-labelledby", title.id);
  }
  const done = layer(() => node, close);
  if (!node.contains(document.activeElement)) {
    if (!node.hasAttribute("tabindex")) node.tabIndex = -1;
    node.focus({ preventScroll: true });
  }
  return done;
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => {
    const top = layers.at(-1);
    if (top && e.target instanceof Node && top.at()?.contains(e.target)) top.keyed = false;
  });
  // Before the page's own keys: the newest layer has Escape and Tab first.
  window.addEventListener(
    "keydown",
    (e) => {
      const top = layers.at(-1);
      const node = top?.at();
      if (!top) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (heldAgain(e)) return;
        top.keyed = true;
        top.close?.();
        return;
      }
      if (node && e.target instanceof Node && node.contains(e.target)) top.keyed = true;
      if (e.key !== "Tab" || !node) return;
      const all = stops(node);
      const [first, last] = [all[0], all.at(-1)];
      const at = document.activeElement;
      const inside = at instanceof Node && node.contains(at);
      if (!first || !last) {
        e.preventDefault();
        node.focus({ preventScroll: true });
      } else if (!inside || (e.shiftKey ? at === first || at === node : at === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus({ preventScroll: true });
      }
      top.keyed = true;
    },
    true,
  );
}
