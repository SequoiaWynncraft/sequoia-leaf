/** Small helpers for building the interface out of the kit's classes. */

// The words are core's: `say.ts`, which draws with `el`, takes them from there too.
import { whole } from "@sequoia-leaf/core";

import { pressKeysHeld, stillHeld } from "./keys.ts";
import type { Scope } from "./scope.ts";
import { makeCanvas, must } from "./util.ts";

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

/** An amount of Leaf or Coins with its icon: a number as `whole` says it, or words ("free", "+12"). */
export function amount(kind: "leaf" | "coin", n: number | string): HTMLElement {
  return el("span", kind === "leaf" ? "k-cur leaf" : "k-cur", {}, icon(kind), typeof n === "number" ? whole(n) : n);
}

/** A canvas drawn elsewhere, shown `scale` screen pixels to each of its own (in interface units). */
export function shown(c: HTMLCanvasElement, scale = 1): HTMLCanvasElement {
  c.classList.add("k-px");
  c.style.width = `calc(var(--u) * ${c.width * scale})`;
  c.style.height = `calc(var(--u) * ${c.height * scale})`;
  return c;
}

/**
 * Draws what is in `node` again (`draw`), with whoever had the keyboard on a control in it put back
 * on the control drawn for the same thing: the one with the same `data-keep`. With none drawn for
 * it (an offer gone), the keyboard goes where `elsewhere` puts it, such as the tab on show.
 */
export function keepingFocus(node: HTMLElement, draw: () => void, elsewhere: () => void = () => undefined): void {
  const at = document.activeElement;
  const inside = at instanceof HTMLElement && node.contains(at);
  const kept = inside ? at.closest<HTMLElement>("[data-keep]")?.dataset.keep : undefined;
  draw();
  if (!inside) return;
  const again = [...node.querySelectorAll<HTMLElement>("[data-keep]")].find((e) => e.dataset.keep === kept);
  if (kept !== undefined && again) again.focus({ preventScroll: true });
  else elsewhere();
}

/** The page's element with this id: one the page's own HTML has. */
export const $ = (id: string): HTMLElement => must(document.getElementById(id), id);

/** A copy of a small picture, shown `scale` interface units to each of its pixels. */
export function pic(src: HTMLCanvasElement, scale = 1): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  return shown(c, scale);
}

/** Plays an element's one-shot animation class again from the start. */
export function replay(node: HTMLElement, cls: string): void {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

/**
 * What a button that spends would do, as the button says it: what it is for (`on`, by what names
 * it: a plot, a quest, the area marked) and what it costs (`price`: Leaf, Coins, or what is lost,
 * such as what an order has been given; 0 for nothing). A second press does it only for the same
 * thing at the same price: one for another thing, or a price changed since, asks again.
 */
export interface Spend {
  readonly on: string;
  readonly price: number;
}

/** A spend as one value, the same for the same thing at the same price. */
const spendKey = (s: Spend): string => `${s.on}|${s.price}`;

/**
 * The button that has been pressed once and is waiting to be pressed again: what it spends on, the
 * scope it was pressed in, the wait (a scope of that one, holding the four seconds), how it is
 * drawn again, and the keys down when it was pressed.
 */
let asked: {
  readonly key: string;
  readonly within: Scope;
  readonly wait: Scope;
  readonly redraw: () => void;
  readonly keys: ReadonlyMap<string, number>;
} | null = null;

/** Whether the button for `spend` has been pressed once and is waiting: it is drawn asking. */
export const asking = (spend: Spend): boolean => asked?.key === spendKey(spend);

/**
 * What a button that asks is drawn with: its label, or the question in the label's place. Both are
 * in the button, one over the other and only one seen, so asking never changes the button's size.
 */
export function asksAgain(spend: Spend, label: readonly Child[], question: string): HTMLElement {
  const on = asking(spend);
  return el("span", "k-asks", {}, el("span", on ? "hid" : "", {}, ...label), el("span", on ? "" : "hid", {}, question));
}

/**
 * A press on a button that spends. `life` is what the player is looking at while the button
 * waits: the tab on show, the card on top, what the hand is doing (`Scope.turns` gives one for
 * each); leaving it ends the wait. The first press only notes it and gives false: `redraw` is
 * called so the button asks, and again if four seconds pass without a second press. The second
 * press, in the same `life` and for the same `spend`, gives true. Once `life` closes, the button no
 * longer waits, and its next press is a first one. A key that was down at the first press and has
 * not come up since is not a second press (a held Enter says itself again): it gives false and
 * changes nothing. One button waits at a time: a press on another stops the first waiting, and it
 * is drawn as it was.
 */
export function pressedTwice(life: Scope, spend: Spend, redraw: () => void): boolean {
  if (life.closed) return false;
  const key = spendKey(spend);
  const was = asked;
  const second = was !== null && was.key === key && was.within === life;
  if (second && stillHeld(was.keys)) return false;
  asked = null;
  was?.wait.close();
  if (second) return true;
  const wait = life.child();
  asked = { key, within: life, wait, redraw, keys: pressKeysHeld() };
  wait.after(4000, unask);
  // What it is on put away, nothing is drawn: it has gone with it.
  wait.hold(() => {
    if (asked?.wait === wait) asked = null;
  });
  if (was && was.redraw !== redraw) was.redraw();
  // Drawn again, the button is a new one: whoever pressed it with a key is put back on it.
  const keyed = typeof document !== "undefined" && document.activeElement instanceof HTMLButtonElement;
  redraw();
  if (keyed) document.querySelector<HTMLElement>(".k-btn.asking")?.focus();
  return false;
}

/**
 * The button waiting for its second press stops waiting, now, and is drawn as it was: its four
 * seconds are up, or everything it was shown on changed at once (a yard read afresh from Leaf).
 */
export function unask(): void {
  const was = asked;
  if (!was) return;
  asked = null;
  was.wait.close();
  was.redraw();
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
