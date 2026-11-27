/**
 * Tips: a name and a line said about something, shown by the deck (`card.ts`) as every card is, in
 * the same box, the same look and the same place. A tip is a card with only its glance: the mouse
 * coming onto its owner shows it at once, the keyboard's focus shows it, and a click, Enter, a tap
 * on a thing that does nothing else when tapped, or a long press on one that does (the tap that ends
 * the press then does nothing) pins it open until it is put away: a press anywhere else, a second
 * press on it, its close button or Escape. While it shows, its owner is described by it
 * (`aria-describedby`). A thing that only explains itself is made a button, named by its title and
 * its words, so Tab reaches it and a screen reader says what it is.
 */
import { deck, isSaid, lastVia, link, moveCard, said } from "./card.ts";
import { el } from "./dom.ts";
import { scope } from "./scope.ts";

type Words = string | (() => string);

/** A spot on the page for a tip to sit beside, in CSS pixels. */
export interface TipSpot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Whoever shows a tip at a spot without saying who (`tipAt`): its tips are its own. */
const ANYONE = { tips: true };
/** What each element given a tip (`tip`) says now, as a thing's reference. */
const says = new WeakMap<object, () => string>();

const wordsOf = (w: Words | undefined): string => (typeof w === "function" ? w() : (w ?? ""));

/**
 * Shows a tip beside a spot on the page, for `by` (an element, or a token of the caller's). With
 * `pin`, it stays until put away, as a sheet under a finger.
 */
export function tipAt(
  spot: TipSpot,
  title: string,
  text = "",
  by: object | null = null,
  opts: { readonly pin?: boolean } = {},
): void {
  const owner = by ?? ANYONE;
  if (!title && !text) return tipOff(owner);
  const ref = said(title, text);
  if (opts.pin) deck.pin(ref, spot, lastVia(), owner);
  else deck.glance(ref, spot, "mouse", owner);
}

/** A plain tip beside an element, for as long as the element keeps it. */
export function tipBeside(target: Element, title: string, text = ""): void {
  const r = target.getBoundingClientRect();
  tipAt({ x: r.left, y: r.top, w: r.width, h: r.height }, title, text, target);
}

/** The tip `by` put up goes with its spot, which has moved (a thing walking, the view moving); any other is left. */
export function tipTo(spot: TipSpot, by: object): void {
  moveCard(by, spot);
}

/** Puts the tip away; with `by`, only if it is that owner's. A card that is no tip stays, unless `by` opened it. */
export function tipOff(by: object | null = null): void {
  const o = deck.open;
  if (o && (by ? o.from === by : isSaid(deck.shown()))) deck.close();
}

/** Whose tip is showing, if any. */
export const tipOwner = (): object | null => (deck.open && isSaid(deck.shown()) ? deck.open.from : null);

/**
 * Says the tip that is up again, with its words as they are now: a key it names has changed, or
 * what the keyboard calls it. It stays as it was shown, for the keyboard's focus or a finger.
 */
export function retip(): void {
  const o = deck.open;
  const now = o ? says.get(o.from) : undefined;
  if (!o || !now || (o.from instanceof Element && !o.from.isConnected)) return;
  deck.swap(now());
}

/**
 * Gives an element a tip. `title` is the thing's name and `text` a line about it; either may be a
 * function, asked each time the tip shows.
 */
export function tip(target: HTMLElement, title: Words, text?: Words): void {
  const words = (): string => said(wordsOf(title), wordsOf(text));
  const had = says.has(target);
  says.set(target, words);
  // Given a tip again: it says the new words, as it already shows them.
  if (had) return;
  // Whether a tap does something of its own (a button, a thing whose card it opens), or only asks what it is.
  const acts = target.matches("button, a[href], input, select, textarea, summary, [role], [data-ref]");
  /** Named by its title and its words, as they are now: "Leaf 1,200". */
  const name = (): void => {
    const shown = target.textContent?.trim() ?? "";
    const t = wordsOf(title);
    target.setAttribute("aria-label", shown && shown !== t ? `${t} ${shown}` : t);
  };
  // Its tip names it where it has no name of its own: it only explains itself, or shows only a picture.
  if (!acts || (!target.hasAttribute("aria-label") && !target.textContent?.trim())) {
    name();
    // Its words change (a purse's count): its name changes with them, as the words on screen do.
    scope().observe(target, { childList: true, characterData: true, subtree: true }, name);
  }
  if (!acts) {
    target.setAttribute("role", "button");
    if (target.tabIndex < 0) target.tabIndex = 0;
  }
  link(target, words, { acts, tip: true });
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
