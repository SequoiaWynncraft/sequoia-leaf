/** Small helpers for building the interface out of the kit's classes. */

import { pressKeysHeld, stillHeld } from "./keys.ts";

/** What waits for a held mouse button to lift (`unheld`). */
const owed = new Set<() => void>();
let mouseDown = false;

/**
 * A mouse button goes down (`true`) or comes up on the page. Chromium makes no click when what a
 * mouse press began on is replaced before the release, so nothing is drawn again under a held
 * button: `when` waits for the next call after it lifts, and `unheld` for the next tick after the
 * click it ends in. The kit's own listeners call this; tests may too.
 */
export function mouseHeld(down: boolean): void {
  mouseDown = down;
  if (down || owed.size === 0) return;
  setTimeout(() => {
    const due = [...owed];
    owed.clear();
    for (const fn of due) fn();
  }, 0);
}

/** `fn`, done now, or under a held mouse button once, on the tick after it lifts. */
export const unheld =
  (fn: () => void): (() => void) =>
  () => {
    if (mouseDown) owed.add(fn);
    else fn();
  };

/** Draws a part of the interface again only when what it shows has changed, and not under a held mouse button. */
export function when(key: () => string, draw: () => void): () => void {
  let last: string | null = null;
  return () => {
    if (last !== null && mouseDown) return;
    const k = key();
    if (k === last) return;
    last = k;
    draw();
  };
}

// The browser must not take the game for a picture. Under a held press it would drag the canvas
// away, and a long press or a right click would open its own menu on it; either one takes the press
// from the game. Every page uses this file, so every page is covered.
if (typeof document !== "undefined") {
  document.addEventListener("dragstart", (e) => {
    e.preventDefault();
  });
  document.addEventListener("contextmenu", (e) => {
    if (e.target instanceof HTMLCanvasElement || e.target instanceof HTMLImageElement) e.preventDefault();
  });
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse") mouseHeld(true);
    },
    true,
  );
  window.addEventListener("pointerup", () => mouseHeld(false), true);
  window.addEventListener("pointercancel", () => mouseHeld(false), true);
  // Let go outside the window, the button's lift never arrives here.
  window.addEventListener("blur", () => mouseHeld(false));
}

type Child = Node | string | number | null | undefined | false;
type Props = Readonly<Record<string, string | number | boolean | ((e: Event) => void) | null | undefined>>;

/**
 * Makes an element with the given classes. Props starting with `on` are listeners, `text` sets the
 * words, and anything else is an attribute (left out when null, undefined or false).
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classes = "",
  props: Props = {},
  ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (classes) node.className = classes;
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === "function") node.addEventListener(k.replace(/^on/, "").toLowerCase(), v);
    else if (k === "text") node.textContent = String(v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  add(node, ...kids);
  return node;
}

export function add(parent: Node, ...kids: Child[]): void {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    parent.appendChild(typeof k === "object" ? k : document.createTextNode(String(k)));
  }
}

export type IconName =
  | "leaf"
  | "coin"
  | "acorn"
  | "close"
  | "back"
  | "sound"
  | "mute"
  | "check"
  | "lock"
  | "star"
  | "heart"
  | "gear"
  | "play"
  | "hammer"
  | "mail"
  | "gift"
  | "turn"
  | "tray"
  | "home"
  | "paw"
  | "visit"
  | "more"
  | "up"
  | "down"
  | "fold"
  | "show"
  | "hide"
  | "wave"
  | "cheer"
  | "laugh";

/** One of the kit's pixel icons, `scale` whole steps large. */
export function icon(name: IconName, scale = 1): HTMLElement {
  const i = el("i", `k-i k-i-${name}`);
  if (scale !== 1) i.style.setProperty("--s", String(scale));
  return i;
}

/** An amount of Leaf or Coins with its icon. */
export function amount(kind: "leaf" | "coin", n: number | string): HTMLElement {
  return el("span", kind === "leaf" ? "k-cur leaf" : "k-cur", {}, icon(kind), String(n));
}

/** A canvas drawn elsewhere, shown `scale` screen pixels to each of its own (in interface units). */
export function shown(c: HTMLCanvasElement, scale = 1): HTMLCanvasElement {
  c.classList.add("k-px");
  c.style.width = `calc(var(--u) * ${c.width * scale})`;
  c.style.height = `calc(var(--u) * ${c.height * scale})`;
  return c;
}

/** Plays an element's one-shot animation class again from the start. */
export function replay(node: HTMLElement, cls: string): void {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

/** The button that has been pressed once and is waiting to be pressed again, and the keys down when it was. */
let asked: {
  key: string;
  timer: ReturnType<typeof setTimeout>;
  redraw: () => void;
  keys: ReadonlyMap<string, number>;
} | null = null;

/** Whether the button `key` has been pressed once and is waiting: it is drawn asking. */
export const asking = (key: string): boolean => asked?.key === key;

/**
 * What a button that asks is drawn with: its label, or the question in the label's place. Both are
 * in the button, one over the other and only one seen, so asking never changes the button's size.
 */
export function asksAgain(key: string, label: readonly Child[], question: string): HTMLElement {
  const on = asking(key);
  return el("span", "k-asks", {}, el("span", on ? "hid" : "", {}, ...label), el("span", on ? "" : "hid", {}, question));
}

/**
 * A press on a button that spends. The first press only notes it and gives false: `redraw` is
 * called so the button asks, and again if four seconds pass without a second press. The second
 * press gives true. A key that was down at the first press and has not come up since is not a
 * second press (a held Enter says itself again): it gives false and changes nothing.
 */
export function pressedTwice(key: string, redraw: () => void): boolean {
  const second = asking(key);
  if (second && asked && stillHeld(asked.keys)) return false;
  clearTimeout(asked?.timer);
  asked = second ? null : { key, timer: setTimeout(unask, 4000), redraw, keys: pressKeysHeld() };
  if (!second) {
    // Drawn again, the button is a new one: whoever pressed it with a key is put back on it.
    const keyed = typeof document !== "undefined" && document.activeElement instanceof HTMLButtonElement;
    redraw();
    if (keyed) document.querySelector<HTMLElement>(".k-btn.asking")?.focus();
  }
  return second;
}

/** The button waiting for its second press stops waiting, now, and is drawn as it was. */
export function unask(): void {
  if (!asked) return;
  clearTimeout(asked.timer);
  const { redraw } = asked;
  asked = null;
  redraw();
}

let region: HTMLElement | null = null;

/**
 * Tells a screen reader something the player must notice (a press refused, an order filled), in
 * the page's one polite live region; nothing is shown. Not for what changes every moment.
 */
export function say(text: string): void {
  if (!region?.isConnected) region = document.body.appendChild(el("div", "k-said", { role: "status" }));
  const to = region;
  // Emptied first and filled a moment later, so the same words said twice are heard twice.
  to.textContent = "";
  setTimeout(() => {
    to.textContent = text;
  }, 50);
}

/** One interface unit in CSS pixels, as the stylesheet has it now. */
export function unit(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--u"));
  return v > 0 ? v : 2;
}
