/** Small helpers for building the interface out of the kit's classes. */

// The words are core's: `say.ts`, which draws with `el`, takes them from there too.
import { whole } from "@sequoia-leaf/core";

import { CONTROLS, heldAgain, pressesButtons, pressKeysHeld, stillHeld } from "./keys.ts";
import { type Scope, scope } from "./scope.ts";
import { makeCanvas, must } from "./util.ts";

/** What the kit holds of the page for as long as it stands: its own listeners, and its waits. */
const page = scope();

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
  page.after(0, () => {
    const due = [...owed];
    owed.clear();
    for (const fn of due) fn();
  });
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

/** What the second press of a spend may land on (`landed`). */
type Lands = "asking" | "taps";

/**
 * The spend that has been pressed once and is waiting for its second press: what it spends on, the
 * press that asked (by its number), what its second may land on, the scope it was pressed in, the
 * wait (a scope of that one, holding the four seconds), how it is drawn again, and the keys down
 * when it was pressed.
 */
interface Asked {
  readonly key: string;
  readonly at: number;
  readonly lands: Lands;
  readonly within: Scope;
  readonly wait: Scope;
  readonly redraw: () => void;
  readonly keys: ReadonlyMap<string, number>;
}

/** The class of a button's question (`asksAgain`), whether it shows or not. */
const QUESTION = "k-question";

/** Whether there is a page to press on. The tests have none: nothing is drawn there, and a press lands on nothing in particular. */
const onPage = (): boolean => typeof Element !== "undefined";

/** Whether an element can be seen: on the page, with neither it nor anything holding it hidden. */
const seen = (q: Element): boolean =>
  q.isConnected &&
  (typeof q.checkVisibility === "function"
    ? q.checkVisibility({ visibilityProperty: true })
    : q.getClientRects().length > 0);

/** What the page hears of a press: a pointer going down, a key going down, a click, or a pointer or key coming up. */
export type Heard =
  | { readonly is: "down"; readonly on: EventTarget | null }
  | { readonly is: "key"; readonly key: Pick<KeyboardEvent, "code" | "repeat" | "target"> }
  | { readonly is: "click"; readonly on: EventTarget | null }
  | { readonly is: "up" };

/**
 * The page's presses, counted, and the one spend waiting for its second press. A press is a pointer
 * going down anywhere on the page, or Enter or Space going down (Tab only moves the keyboard). A
 * held key saying itself again is the same press, and so is the click a press makes; a click no
 * press made (a screen reader's) is a press of its own. A spend is confirmed only by the very next
 * press, and once any other press is over, it is drawn as it was.
 */
class Asking {
  /** Presses so far, what the newest landed on, and whether it has made its click yet. */
  #presses = 0;
  #on: EventTarget | null = null;
  #clicked = true;
  #asked: Asked | null = null;
  /** Each question drawn showing (`asksAgain`), by the spend it asks about. */
  readonly #showing = new WeakMap<Element, string>();
  /** While a spend that stopped waiting is drawn again with the keyboard on its button: the question drawn for it in its place. */
  #again: { readonly key: string; drawn: Element | null } | null = null;

  heard(h: Heard): void {
    if (h.is === "down") this.#press(h.on);
    else if (h.is === "key") {
      if (pressesButtons(h.key.code) && !heldAgain(h.key)) this.#press(h.key.target);
    } else if (h.is === "click") {
      if (!this.#clicked) {
        // The press's own click: it lands where the click does.
        this.#clicked = true;
        this.#on = h.on;
      } else if (pressKeysHeld().size === 0) {
        this.#press(h.on);
        this.#clicked = true;
        this.#over();
      }
    } else this.#over();
  }

  #press(on: EventTarget | null): void {
    this.#presses++;
    this.#on = on;
    this.#clicked = false;
  }

  /**
   * A press is over: on the tick after it, once its click has been heard, a spend that an earlier
   * press asked for stops waiting, unless this press landed where it may be its second (a finger's
   * click comes later). Drawn again only then, nothing is replaced under the press it is for.
   */
  #over(): void {
    page.after(0, () => {
      const was = this.#asked;
      if (was && was.at < this.#presses && !this.#landed(was, this.#on)) this.unask();
    });
  }

  asking(key: string): boolean {
    return this.#asked?.key === key;
  }

  /** The question `q` is drawn for `key`, showing (`on`) or not: while it shows, a press on it may be the second for `key`. */
  drawn(key: string, q: Element, on: boolean): void {
    if (on) this.#showing.set(q, key);
    if (this.#again?.key === key) this.#again.drawn = q;
  }

  /** Whether `control` shows the question for `key` now: drawn showing, on the page, and seen. */
  #shows(control: Element, key: string): boolean {
    return [...control.querySelectorAll(`.${QUESTION}`)].some((q) => this.#showing.get(q) === key && seen(q));
  }

  /**
   * Whether a press that landed on `on` may be the second for `ask`. On a control, only on one that
   * shows its question now (`asksAgain`): a control that does not show it, or one it was drawn on
   * that has gone or is hidden, gets a first press. Off every control (a canvas the game reads
   * presses on), only for a spend pressed by taps (`tappedTwice`).
   */
  #landed(ask: Asked, on: EventTarget | null): boolean {
    if (!onPage()) return true;
    if (!(on instanceof Element)) return false;
    const control = on.closest(CONTROLS);
    return control === null ? ask.lands === "taps" : this.#shows(control, ask.key);
  }

  pressed(life: Scope, spend: Spend, redraw: () => void, lands: Lands): boolean {
    if (life.closed) return false;
    const key = spendKey(spend);
    const was = this.#asked;
    // The press that asked, heard again (a held key saying itself again): nothing changes.
    if (was?.key === key && was.at === this.#presses) return false;
    if (was !== null && this.#second(was, key, life)) {
      if (stillHeld(was.keys)) return false;
      this.#asked = null;
      was.wait.close();
      return true;
    }
    this.#asked = null;
    was?.wait.close();
    this.#ask(key, life, redraw, lands);
    if (was && was.redraw !== redraw) was.redraw();
    // Drawn again, the button is a new one: whoever pressed it with a key is put back on it.
    const keyed = onPage() && document.activeElement instanceof HTMLButtonElement;
    redraw();
    if (keyed) document.querySelector<HTMLElement>(".k-btn.asking")?.focus();
    return false;
  }

  /** Whether the press now is the second for `key` in `life`: the very next one after it asked, on what shows the question. */
  #second(was: Asked, key: string, life: Scope): boolean {
    return was.key === key && was.within === life && was.at === this.#presses - 1 && this.#landed(was, this.#on);
  }

  /** `key` waits for its second press, in `life`, for four seconds. */
  #ask(key: string, life: Scope, redraw: () => void, lands: Lands): void {
    const wait = life.child();
    const asked: Asked = {
      key,
      at: this.#presses,
      lands,
      within: life,
      wait,
      redraw,
      keys: pressKeysHeld(),
    };
    this.#asked = asked;
    wait.after(4000, () => this.unask());
    // What it is on put away, nothing is drawn: it has gone with it.
    wait.hold(() => {
      if (this.#asked === asked) this.#asked = null;
    });
  }

  unask(): void {
    const was = this.#asked;
    if (!was) return;
    this.#asked = null;
    was.wait.close();
    // Drawn again, the button is a new one: the keyboard on it goes to the one drawn in its place.
    const at = onPage() ? document.activeElement : null;
    this.#again = at && this.#shows(at, was.key) ? { key: was.key, drawn: null } : null;
    was.redraw();
    const now = this.#again?.drawn;
    this.#again = null;
    if (at && now && !at.isConnected && now.isConnected)
      now.closest<HTMLElement>(CONTROLS)?.focus({ preventScroll: true });
  }
}

const asks = new Asking();

/**
 * A press, or the end of one, as the page hears it: the kit's own listener tells it each, before
 * anything else on the page hears it. Tests may too, with `null` for where a press lands when they
 * have no page.
 */
export const heard = (h: Heard): void => asks.heard(h);

/** Whether the button for `spend` has been pressed once and is waiting: it is drawn asking. */
export const asking = (spend: Spend): boolean => asks.asking(spendKey(spend));

/**
 * What a button that asks is drawn with: its label, or the question in the label's place. Both are
 * in the button, one over the other and only one seen, so asking never changes the button's size.
 * Only a button drawn with its question showing takes the second press (`pressedTwice`).
 */
export function asksAgain(spend: Spend, label: readonly Child[], question: string): HTMLElement {
  const key = spendKey(spend);
  const on = asks.asking(key);
  const q = el("span", on ? QUESTION : `${QUESTION} hid`, {}, question);
  asks.drawn(key, q, on);
  return el("span", "k-asks", {}, el("span", on ? "hid" : "", {}, ...label), q);
}

/**
 * A press on a button that spends. `life` is what the player is looking at while the button
 * waits: the tab on show, the card on top, what the hand is doing (`Scope.turns` gives one for
 * each); leaving it ends the wait. The first press only notes it and gives false: `redraw` is
 * called so the button asks (`asksAgain`), and again if four seconds pass without a second press.
 * The second press gives true only if it is the very next press on the page, in the same `life`,
 * for the same `spend`, and on a button that shows the question now. Any other press first, on
 * another button, a tab or nothing at all, and the button is drawn as it was and its next press is
 * a first one; so once `life` closes. A held key saying itself again is still the first press: it
 * gives false and changes nothing. One button waits at a time: a press on another stops the first
 * waiting, and it is drawn as it was.
 */
export const pressedTwice = (life: Scope, spend: Spend, redraw: () => void): boolean =>
  asks.pressed(life, spend, redraw, "asking");

/**
 * As `pressedTwice`, for a spend a game also takes two taps in a row for, off the page's buttons:
 * the Works' yard puts a plan of the whole yard back by a second tap anywhere on it, where nothing
 * is drawn asking. A second press on a button is still one only on a button that shows the question.
 */
export const tappedTwice = (life: Scope, spend: Spend, redraw: () => void): boolean =>
  asks.pressed(life, spend, redraw, "taps");

/**
 * The button waiting for its second press stops waiting, now, and is drawn as it was: its four
 * seconds are up, or everything it was shown on changed at once (a yard read afresh from Leaf). The
 * keyboard on it stays on the button drawn for the same spend in its place.
 */
export const unask = (): void => asks.unask();

// The kit hears every press first, on its way down. The browser must not take the game for a
// picture either: under a held press it would drag the canvas away, and a long press or a right
// click would open its own menu on it; either one takes the press from the game. Every page uses
// this file, so every page is covered.
if (typeof window !== "undefined") {
  const first = { capture: true };
  page.on(document, "dragstart", (e) => e.preventDefault());
  page.on(document, "contextmenu", (e) => {
    if (e.target instanceof HTMLCanvasElement || e.target instanceof HTMLImageElement) e.preventDefault();
  });
  page.on(
    window,
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse") mouseHeld(true);
      heard({ is: "down", on: e.target });
    },
    first,
  );
  page.on(window, "keydown", (key) => heard({ is: "key", key }), first);
  page.on(window, "click", (e) => heard({ is: "click", on: e.target }), first);
  const up = (): void => {
    mouseHeld(false);
    heard({ is: "up" });
  };
  page.on(window, "pointerup", up, first);
  page.on(window, "pointercancel", up, first);
  page.on(window, "keyup", () => heard({ is: "up" }), first);
  // Let go outside the window, the button's lift never arrives here.
  page.on(window, "blur", up);
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
  page.after(50, () => {
    to.textContent = text;
  });
}

/** One interface unit in CSS pixels, as the stylesheet has it now. */
export function unit(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--u"));
  return v > 0 ? v : 2;
}
