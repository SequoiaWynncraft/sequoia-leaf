/**
 * Tips: what a thing is, said in a `k-tip` beside it. A tip shows while the mouse rests on its
 * owner and while the owner has the keyboard's attention. With a finger, a tap shows it on a thing
 * that does nothing else when tapped, and a long press on one that does (the tap that ends the
 * press then does nothing); a tap anywhere else, a second tap on it, or Escape puts it away. One
 * tip is on the page at a time, and while it shows, its owner is described by it
 * (`aria-describedby`). A thing that only explains itself is made a button, named by its title and
 * its words, so Tab reaches it and a screen reader says what it is.
 */
import { givingBack } from "./dialog.ts";
import { add, el } from "./dom.ts";
import { longPress } from "./press.ts";
import { scope } from "./scope.ts";

type Words = string | (() => string);

/** A spot on the page for a tip to sit beside, in CSS pixels. */
export interface TipSpot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The one tip's id, by which its owner is described while it shows. */
const ID = "k-tip";

let box: HTMLElement | null = null;
let owner: object | null = null;
/** How each element given a tip (`tip`) shows it again, with its words as they are now. */
const shows = new WeakMap<object, () => void>();
/** The tip was shown for the keyboard's focus, so where the mouse goes does not matter to it. */
let byKey = false;
let hideAt = 0;

const said = (w: Words | undefined): string => (typeof w === "function" ? w() : (w ?? ""));

/** Shows a tip beside a spot on the page: above it where there is room, otherwise below. */
export function tipAt(spot: TipSpot, title: string, text = "", by: object | null = null): void {
  tipOff();
  if (!title && !text) return;
  const node = el("div", "k-tip k-float", { role: "tooltip", id: ID });
  if (title) add(node, el("b", "k-name", { text: title }));
  if (text) add(node, el("div", "k-dim", { text }));
  document.body.append(node);
  putBeside(node, spot);
  box = node;
  owner = by;
  if (by instanceof Element) by.setAttribute("aria-describedby", ID);
}

/** A plain tip beside an element, for as long as the element keeps it. */
export function tipBeside(target: Element, title: string, text = ""): void {
  const r = target.getBoundingClientRect();
  tipAt({ x: r.left, y: r.top, w: r.width, h: r.height }, title, text, target);
}

/** Puts a tip beside a spot: above it where there is room, otherwise below, and inside the window. */
function putBeside(node: HTMLElement, spot: TipSpot): void {
  const r = node.getBoundingClientRect();
  const gap = 6;
  const x = Math.round(Math.min(Math.max(4, spot.x + spot.w / 2 - r.width / 2), window.innerWidth - r.width - 4));
  const above = spot.y - r.height - gap;
  const y = Math.round(above >= 4 ? above : Math.min(spot.y + spot.h + gap, window.innerHeight - r.height - 4));
  node.style.transform = `translate(${x}px, ${y}px)`;
}

/** The tip `by` put up goes with its spot, which has moved (a thing walking, the view moving); any other is left. */
export function tipTo(spot: TipSpot, by: object): void {
  if (box && owner === by) putBeside(box, spot);
}

/** Puts the tip away; with `by`, only if it is that owner's tip. */
export function tipOff(by: object | null = null): void {
  if (by && owner !== by) return;
  if (owner instanceof Element && owner.getAttribute("aria-describedby") === ID)
    owner.removeAttribute("aria-describedby");
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
  // A press anywhere but on the tip's owner puts the tip away.
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (box && !(owner instanceof Element && e.target instanceof Node && owner.contains(e.target))) tipOff();
    },
    true,
  );
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") tipOff();
  });
  new MutationObserver(() => {
    sweep(null);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

/** Whose tip is showing, if any. */
export const tipOwner = (): object | null => owner;

/**
 * Says the tip that is up again, with its words as they are now: a key it names has changed, or
 * what the keyboard calls it. It stays as it was shown, for the keyboard's focus or a finger.
 */
export function retip(): void {
  const show = owner === null ? undefined : shows.get(owner);
  if (!show || (owner instanceof Element && !owner.isConnected)) return;
  const [key, hide] = [byKey, hideAt];
  show();
  byKey = key;
  hideAt = hide;
}

/**
 * Gives an element a tip. `title` is the thing's name and `text` a line about it; either may be a
 * function, asked each time the tip shows.
 */
export function tip(target: HTMLElement, title: Words, text?: Words): void {
  // Whether a tap does something of its own (a button, a thing whose card it opens), or only asks what it is.
  const acts = target.matches("button, a[href], input, select, textarea, summary, [role], [data-ref]");
  /** Named by its title and its words, as they are now: "Leaf 1,200". */
  const name = (): void => {
    const words = target.textContent?.trim() ?? "";
    const t = said(title);
    target.setAttribute("aria-label", words && words !== t ? `${t} ${words}` : t);
  };
  // Its tip names it where it has no name of its own: it only explains itself, or shows only a picture.
  const named = !acts || (!target.hasAttribute("aria-label") && !target.textContent?.trim());
  if (!acts) {
    target.setAttribute("role", "button");
    if (target.tabIndex < 0) target.tabIndex = 0;
  }
  if (named) {
    name();
    // Its words change (a purse's count): its name changes with them, as the words on screen do.
    new MutationObserver(name).observe(target, { childList: true, characterData: true, subtree: true });
  }
  const beside = (): void => {
    if (named) name();
    const r = target.getBoundingClientRect();
    tipAt({ x: r.left, y: r.top, w: r.width, h: r.height }, said(title), said(text), target);
  };
  shows.set(target, beside);
  const toggle = (): void => {
    if (owner === target) tipOff(target);
    else beside();
  };
  let finger = false;
  target.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse") beside();
  });
  target.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") tipOff(target);
  });
  target.addEventListener("focus", () => {
    if (!target.matches(":focus-visible") || givingBack()) return;
    beside();
    byKey = true;
  });
  target.addEventListener("blur", () => {
    tipOff(target);
  });
  target.addEventListener("pointerdown", (e) => {
    finger = e.pointerType !== "mouse";
    if (!finger) tipOff(target);
  });
  // A finger asks about a thing that acts by resting on it, and the tip goes by itself. Each press,
  // and the wait for the tip to go, are held in a scope of the thing's own, which goes with it.
  const own = scope();
  const asked = longPress(own, target, {
    starts: (e) => e.pointerType !== "mouse" && acts,
    asked: () => {
      beside();
      hideAt = performance.now() + 2200;
      own.after(2250, () => {
        if (hideAt > 0 && performance.now() >= hideAt) tipOff(target);
      });
    },
  });
  target.addEventListener(
    "click",
    (e) => {
      // The tap that ends a long press was asking what the thing is, not using it.
      if (asked(e)) {
        e.stopPropagation();
        e.preventDefault();
      } else if (!acts && finger) toggle();
    },
    true,
  );
  if (!acts)
    target.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggle();
      byKey = owner === target;
    });
}

/**
 * A button showing only a picture, which cannot be made without a name: `name` is what a screen
 * reader says, and the title of its tip when it has `line` (the words under the title, "" for
 * none). A picture whose meaning is plain (close, back) needs no tip. `look` is the kit's button
 * classes after `k-btn icon` ("wood sm").
 */
export function iconButton(
  look: string,
  art: Node,
  name: string,
  on: (e: Event) => void,
  line?: string,
): HTMLButtonElement {
  const b = el("button", `k-btn icon ${look}`.trim(), { type: "button", "aria-label": name, onclick: on }, art);
  if (line !== undefined) tip(b, name, line);
  return b;
}
