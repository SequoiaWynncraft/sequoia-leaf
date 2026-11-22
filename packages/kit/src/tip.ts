/**
 * Tips: what a thing is, said in a `k-tip` beside it. A tip shows while the mouse rests on its
 * owner, while the owner has the keyboard's attention, and after a long press with a finger (which
 * then does not count as a tap). One tip is on the page at a time.
 */
import { add, el } from "./dom.ts";

type Words = string | (() => string);

/** A spot on the page for a tip to sit beside, in CSS pixels. */
export interface TipSpot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** How long a finger must rest before its tip shows. */
export const LONG_PRESS = 450;

let box: HTMLElement | null = null;
let owner: object | null = null;
/** The tip was shown for the keyboard's focus, so where the mouse goes does not matter to it. */
let byKey = false;
let hideAt = 0;

const said = (w: Words | undefined): string => (typeof w === "function" ? w() : (w ?? ""));

/** Shows a tip beside a spot on the page: above it where there is room, otherwise below. */
export function tipAt(spot: TipSpot, title: string, text = "", by: object | null = null): void {
  tipOff();
  if (!title && !text) return;
  const node = el("div", "k-tip k-float", { role: "tooltip" });
  if (title) add(node, el("b", "k-name", { text: title }));
  if (text) add(node, el("div", "k-dim", { text }));
  document.body.append(node);
  const r = node.getBoundingClientRect();
  const gap = 6;
  const x = Math.round(Math.min(Math.max(4, spot.x + spot.w / 2 - r.width / 2), window.innerWidth - r.width - 4));
  const above = spot.y - r.height - gap;
  const y = Math.round(above >= 4 ? above : Math.min(spot.y + spot.h + gap, window.innerHeight - r.height - 4));
  node.style.transform = `translate(${x}px, ${y}px)`;
  box = node;
  owner = by;
}

/** Puts the tip away; with `by`, only if it is that owner's tip. */
export function tipOff(by: object | null = null): void {
  if (by && owner !== by) return;
  box?.remove();
  box = null;
  owner = null;
  byKey = false;
  hideAt = 0;
}

/** Something shown for an element: the element, whether for the keyboard's focus, and how it is put away. */
type Shown = { readonly by: object | null; readonly key: boolean; readonly off: () => void };

/** What is shown for an element now: the tip, and whatever `goesWith` adds (a passing card). */
const shown: (() => Shown | null)[] = [() => (box ? { by: owner, key: byKey, off: tipOff } : null)];

/**
 * Puts away what `what` says is shown once its element leaves the page or, unless it was shown for
 * the keyboard's focus, once the mouse is on something outside it. A panel drawn again under a
 * resting mouse takes its old buttons away with no `pointerleave`, so this is asked whenever the page
 * changes and whenever the mouse comes onto something new.
 */
export function goesWith(what: () => Shown | null): void {
  shown.push(what);
}

if (typeof window !== "undefined") {
  const sweep = (on: EventTarget | null): void => {
    for (const what of shown) {
      const s = what();
      if (s?.by instanceof Element && (!s.by.isConnected || (!s.key && on instanceof Node && !s.by.contains(on))))
        s.off();
    }
  };
  window.addEventListener(
    "pointerover",
    (e) => {
      if (e.pointerType === "mouse") sweep(e.target);
    },
    true,
  );
  new MutationObserver(() => {
    sweep(null);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

/** Whose tip is showing, if any. */
export const tipOwner = (): object | null => owner;

function beside(target: HTMLElement, title: Words, text: Words | undefined): void {
  const r = target.getBoundingClientRect();
  tipAt({ x: r.left, y: r.top, w: r.width, h: r.height }, said(title), said(text), target);
}

/**
 * Gives an element a tip. `title` is the thing's name and `text` a line about it; either may be a
 * function, asked each time the tip shows.
 */
export function tip(target: HTMLElement, title: Words, text?: Words): void {
  let press = 0;
  let swallow = false;
  target.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse") beside(target, title, text);
  });
  target.addEventListener("pointerleave", () => {
    tipOff(target);
  });
  target.addEventListener("focus", () => {
    if (!target.matches(":focus-visible")) return;
    beside(target, title, text);
    byKey = true;
  });
  target.addEventListener("blur", () => {
    tipOff(target);
  });
  target.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") {
      tipOff(target);
      return;
    }
    swallow = false;
    window.clearTimeout(press);
    press = window.setTimeout(() => {
      swallow = true;
      beside(target, title, text);
      hideAt = performance.now() + 2200;
      window.setTimeout(() => {
        if (hideAt > 0 && performance.now() >= hideAt) tipOff(target);
      }, 2250);
    }, LONG_PRESS);
  });
  const lift = (): void => {
    window.clearTimeout(press);
  };
  target.addEventListener("pointerup", lift);
  target.addEventListener("pointercancel", lift);
  // The tap that ends a long press was asking what the thing is, not using it.
  target.addEventListener(
    "click",
    (e) => {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
}
