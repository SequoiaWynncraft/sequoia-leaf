/**
 * Cards: the one way anything in any of the games explains itself, and the one tip.
 *
 * A game registers each kind of thing it has once (`register("item", describe)`), and from then on
 * names a thing by a reference, `"kind:id"`. Anything on the page can be made to stand for a thing
 * (`link`), `thing(ref)` is the standard small picture of one (its icon and name, already linked),
 * and something drawn on a canvas is told about with `point` and `pick` by the game's own
 * hit-testing. A tip's words (`tip.ts`) are a thing too, with no kind of its own (`said`).
 *
 * It behaves the same everywhere. With a mouse, coming onto a thing shows its glance beside it at
 * once (its name and a line), and resting on it for a moment grows that into its card; clicking pins
 * it open, and clicking the thing again, clicking elsewhere, its close button or Escape puts it away.
 * The keyboard's focus shows the card, and Enter pins it. With a finger a tap pins it, and on a
 * thing a tap uses (a button, a figure to buy) a long press does: as a sheet the window's width,
 * along the bottom (above the game's bar: `--sheet-floor`) or along the top (under what hangs from
 * the game's top bar: `--sheet-top`) where the bottom would cover the thing, and it stays until put
 * away. A thing named inside an open card is itself a link:
 * pointing at it says its glance, and following it shows its card in the same place with a back
 * arrow. One card is up at a time, placed by one rule (`place.ts`): never over what it is about,
 * always inside the window, floating over the page so it moves nothing. `hold(true)` keeps every card
 * shut while the game is dragging something, and `watch` tells a game which thing is pointed at or pinned.
 *
 * The rules of that (`Deck`) touch no page and are tested; the rest draws them (`face.ts`).
 */
import { givingBack, layer } from "./dialog.ts";
import { pressedTwice, unheld } from "./dom.ts";
import {
  type Action,
  actionSpend,
  deep,
  type Description,
  drawCard,
  type Entry,
  type Face,
  type Hands,
  type Ref,
  SAID,
  saidOf,
  thingOf,
} from "./face.ts";
import { fitHead, length } from "./measure.ts";
import { beside, type Box, clear, sheet, type Side } from "./place.ts";
import { longPress } from "./press.ts";
import { type Release, scope } from "./scope.ts";

export type { Action, Block, Chip, Description, Entry, Line, Part, Ref, Row, Section, Stat, SumRow } from "./face.ts";
export { deep, partsOf, said } from "./face.ts";

export type Describe = (id: string) => Description | null;

/** A box on the page, in CSS pixels, for a card to sit beside. */
export type Spot = Box;

/** How a card was asked for. */
export type Via = "mouse" | "touch" | "key";

/** The card that is up. */
export interface Open {
  /** The things followed to, the first one first; the card shows the last. */
  readonly stack: readonly Ref[];
  readonly pinned: boolean;
  readonly via: Via;
  /** Where it sits: beside an element, or a box on a canvas. */
  readonly at: Spot | object;
  /** Whoever opened it: an element, or a canvas's token. */
  readonly from: object;
  /** Goes to the side of what it is about, rather than above or below. */
  readonly side: boolean;
  /** Shown by the game while it holds something, whatever `hold` says. */
  readonly preview: boolean;
  /** Shows only its glance: the pointer came onto the thing and has not rested on it yet. */
  readonly glance?: boolean;
}

export type Watcher = (pointed: Ref | null, pinned: Ref | null) => void;

/** What a deck asks of whoever draws it. */
export interface View {
  render(open: Open | null, description: Description | null): void;
}

const kindOf = (ref: Ref): [string, string] => {
  const at = ref.indexOf(":");
  return at < 0 ? [ref, ""] : [ref.slice(0, at), ref.slice(at + 1)];
};

/** Whether a reference is a tip's words (`said`), which belong to whoever said them. */
export const isSaid = (ref: Ref | null | undefined): boolean =>
  ref !== null && ref !== undefined && kindOf(ref)[0] === SAID;

/** The same thing, from the same place: the same reference, or a tip's words, whatever they say now. */
const sameThing = (a: Ref | undefined, b: Ref | undefined): boolean => a === b || (isSaid(a) && isSaid(b));

/**
 * The rules of the cards, with no page in them: what is registered, which card is up and how it
 * got there, how deep it shows, what is pointed at, and whether cards are held shut.
 */
export class Deck {
  readonly kinds = new Map<string, Describe>([[SAID, saidOf]]);
  open: Open | null = null;
  pointed: Ref | null = null;
  held = false;
  readonly view: View;
  readonly #watchers = new Set<Watcher>();
  #told: string = "|";
  /** Whoever asked for a card whose description is still coming, and whether to pin it. */
  #awaited: { from: object; pinned: boolean } | null = null;
  /** What the card on show holds while it is the one on show (`confirms`): a scope for each pinned card drawn, kept while it is drawn again. */
  readonly #entries = scope().turns();

  constructor(view: View) {
    this.view = view;
  }

  register(kind: string, describe: Describe): void {
    this.kinds.set(kind, describe);
  }

  describe(ref: Ref): Description | null {
    const [kind, id] = kindOf(ref);
    return this.kinds.get(kind)?.(id) ?? null;
  }

  /** The thing the card that is up is about, if any. */
  shown(): Ref | null {
    return this.open?.stack.at(-1) ?? null;
  }

  /** The thing pinned open, if any. */
  pinned(): Ref | null {
    return this.open?.pinned ? this.shown() : null;
  }

  watch(fn: Watcher): () => void {
    this.#watchers.add(fn);
    fn(this.pointed, this.pinned());
    return () => this.#watchers.delete(fn);
  }

  #tell(): void {
    const now = `${this.pointed ?? ""}|${this.pinned() ?? ""}`;
    if (now === this.#told) return;
    this.#told = now;
    for (const fn of this.#watchers) fn(this.pointed, this.pinned());
  }

  #set(open: Open | null, description: Description | null): void {
    this.open = open;
    // Another card on show (followed to, gone back to, pinned anew, put away): what the last held goes.
    this.#entries(open?.pinned ? open : null);
    this.view.render(open, description);
    this.#tell();
  }

  /**
   * An action of the card on show was pressed: whether it goes ahead. One that does not ask, at
   * once; one that asks (`Action.ask`), on its second press for the same price while this very
   * card is on show, pinned, and nothing has been followed to, gone back from or put away since.
   * Drawn again with what it says changed (`refresh`), it is still the same card.
   */
  confirms(a: Action, redraw: () => void): boolean {
    const life = this.open?.pinned ? this.#entries(this.open) : null;
    return !a.ask || (life !== null && pressedTwice(life, actionSpend(this.shown() ?? "", a), redraw));
  }

  /**
   * A card asked for while its description is still coming is shown once, whole, when it has come
   * (`then` asks again), unless something else was asked for meanwhile or the pointer has left.
   */
  #wait(d: Description, from: object, pinned: boolean, then: () => void): boolean {
    this.#awaited = null;
    if (!d.coming) return false;
    const mine = (this.#awaited = { from, pinned });
    const come = async (coming: Promise<unknown>): Promise<void> => {
      await coming;
      if (this.#awaited !== mine) return;
      this.#awaited = null;
      then();
    };
    void come(d.coming);
    return true;
  }

  /** Whether a card was asked for and is still coming: putting cards away (`close`) drops it. */
  waiting(): boolean {
    return this.#awaited !== null;
  }

  /** Something is pointed at now (or nothing): told to watchers at once, card or no card. */
  point(ref: Ref | null): void {
    this.pointed = ref;
    this.#tell();
  }

  /** A passing card, unless one is pinned (or was clicked and is still coming) or cards are held; `glance`, only its glance where it has more. */
  #pass(ref: Ref, at: Spot | object, via: Via, from: object, side: boolean, glance: boolean): boolean {
    if (this.held || this.open?.pinned || this.#awaited?.pinned) return false;
    const d = this.describe(ref);
    if (!d) {
      if (this.open) this.#set(null, null);
      return false;
    }
    if (this.#wait(d, from, false, () => this.#pass(ref, at, via, from, side, glance))) return false;
    const o = this.open;
    // Up already for this thing from here, as a whole card: drawn again (what it says may have changed), as deep as it was.
    const whole = o !== null && o.from === from && sameThing(o.stack.at(-1), ref) && !o.glance;
    this.#set(
      { stack: [ref], pinned: false, via, at, from, side, preview: false, glance: glance && !whole && deep(d) },
      d,
    );
    return true;
  }

  /** The pointer has come onto a thing: its glance shows beside it at once. */
  glance(ref: Ref, at: Spot | object, via: Via, from: object, side = false): boolean {
    return this.#pass(ref, at, via, from, side, true);
  }

  /** The pointer has rested on a thing (or the keyboard is on it): its whole card shows beside it. */
  rest(ref: Ref, at: Spot | object, via: Via, from: object, side = false): boolean {
    return this.#pass(ref, at, via, from, side, false);
  }

  /** The pointer has left whatever `from` is: its passing card goes. */
  leave(from: object): void {
    if (this.#awaited?.from === from && !this.#awaited.pinned) this.#awaited = null;
    if (this.open && !this.open.pinned && this.open.from === from) this.#set(null, null);
  }

  /**
   * A thing was clicked or tapped: its card is pinned open. Pressed again (the same thing, from the
   * same place, and nothing followed since), it is put away.
   */
  press(ref: Ref, at: Spot | object, via: Via, from: object, side = false): boolean {
    if (this.held) return false;
    const o = this.open;
    if (o?.pinned && o.from === from && o.stack.length === 1 && sameThing(o.stack[0], ref)) {
      this.#set(null, null);
      return false;
    }
    return this.pin(ref, at, via, from, side);
  }

  /** A thing's card is pinned open, whatever was up: pressed again, it stays. */
  pin(ref: Ref, at: Spot | object, via: Via, from: object, side = false): boolean {
    if (this.held) return false;
    const o = this.open;
    const d = this.describe(ref);
    if (!d) return false;
    if (this.#wait(d, from, true, () => this.pin(ref, at, via, from, side))) return true;
    // A passing card for the same thing stays where it is and is pinned.
    if (o && !o.pinned && o.from === from && o.stack.at(-1) === ref && via !== "touch") {
      this.#set({ ...o, pinned: true, via, preview: false, glance: false }, d);
      return true;
    }
    this.#set({ stack: [ref], pinned: true, via, at, from, side, preview: false, glance: false }, d);
    return true;
  }

  /** A thing named inside the open card was followed: its card takes the place of this one, with a way back. */
  follow(ref: Ref): boolean {
    const o = this.open;
    if (!o || o.stack.at(-1) === ref) return false;
    const d = this.describe(ref);
    if (!d) return false;
    this.#set({ ...o, stack: [...o.stack, ref], pinned: true, preview: false, glance: false }, d);
    return true;
  }

  /** Back to the card before. */
  back(): boolean {
    const o = this.open;
    if (!o || o.stack.length < 2) return false;
    const stack = o.stack.slice(0, -1);
    const d = this.describe(stack.at(-1) ?? "");
    // The card before is gone (the thing is no more): the card is put away.
    this.#set(d ? { ...o, stack } : null, d);
    return d !== null;
  }

  /** The card on show is about this now (a tip's words have changed), as it was in every other way. */
  swap(ref: Ref): void {
    const o = this.open;
    const d = o ? this.describe(ref) : null;
    if (o && d) this.#set({ ...o, stack: [...o.stack.slice(0, -1), ref] }, d);
  }

  /** What `from` opened is beside another box now (a thing walking): whether it was, for the page to place it again. */
  moveTo(from: object, at: Spot): boolean {
    if (!this.open || this.open.from !== from) return false;
    this.open = { ...this.open, at };
    return true;
  }

  /** Shows what dropping the thing in hand would do, while cards are otherwise held shut; with `side`, beside it. */
  preview(ref: Ref | null, at: Spot, from: object, side = false): void {
    const d = ref === null ? null : this.describe(ref);
    if (ref === null || !d) {
      if (this.open?.preview) this.#set(null, null);
      return;
    }
    this.#set({ stack: [ref], pinned: false, via: "mouse", at, from, side, preview: true, glance: false }, d);
  }

  /** Puts the card away; with `from`, only if that is who opened it. */
  close(from: object | null = null): void {
    if (from === null || this.#awaited?.from === from) this.#awaited = null;
    if (!this.open || (from !== null && this.open.from !== from)) return;
    this.#set(null, null);
  }

  /** While held, no card opens, and a passing one goes. */
  hold(on: boolean): void {
    this.held = on;
    if (on) this.#awaited = null;
    if (this.open && (on ? !this.open.pinned : this.open.preview)) this.#set(null, null);
  }

  /** Asks the thing shown for its description again (it may have changed), and goes if it has none now. */
  refresh(): void {
    const ref = this.shown();
    if (!this.open || ref === null) return;
    const d = this.describe(ref);
    if (!d) this.#set(null, null);
    else this.view.render(this.open, d);
  }
}

// ---------- on the page ----------

/** Who `point` and `pick` speak for: something drawn on a canvas. */
const CANVAS = { canvas: true };
/** How long the mouse rests on a thing before its glance grows into its card. */
const REST_MS = 220;
/** The passing card's id, by which what it is about is described while it shows. */
const TIP_ID = "k-tip";
/** What can be pressed of itself: anything else that stands for a thing is made a button. */
const CONTROLS = "button, a[href], input, select, textarea, summary";
const nothing: Release = () => undefined;

/** What the page holds of the cards: the card on show and what it was drawn as, where it sits, the glance inside it, and the last pointer. */
const page: {
  node: HTMLElement | null;
  drawn: Open | null;
  corner: { x: number; y: number } | null;
  side: Side | null;
  layer: (() => void) | null;
  peek: { node: HTMLElement; by: HTMLElement } | null;
  described: Element | null;
  via: Via;
  pointing: Ref | null;
  pointAt: Spot | null;
  pointWait: Release;
} = {
  node: null,
  drawn: null,
  corner: null,
  side: null,
  layer: null,
  peek: null,
  described: null,
  via: "mouse",
  pointing: null,
  pointAt: null,
  pointWait: nothing,
};
/** The page's own listeners and waits. */
const live = scope();

const isSpot = (v: unknown): v is Spot =>
  typeof v === "object" && v !== null && "x" in v && "y" in v && "w" in v && "h" in v;
const spotOf = (at: Spot | object): Spot | null => {
  if (at instanceof Element) {
    if (!at.isConnected) return null;
    const r = at.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  return isSpot(at) ? at : null;
};

/** The window, the game's bar along its bottom that a sheet stands on, and where what hangs from its top ends: read as each card is placed. */
const room = (): { w: number; h: number; floor: number; ceiling: number } => ({
  w: window.innerWidth,
  h: window.innerHeight,
  floor: length("--sheet-floor"),
  ceiling: length("--sheet-top"),
});

/** Lets go of the pinned card's layer over the page (`dialog.ts`), where Escape puts it away and Tab stays in it. */
const unpin = (): void => {
  page.layer?.();
  page.layer = null;
};

/** Adds the card's id to what an element is described by, or takes it away, leaving any of the element's own. */
function described(target: Element, on: boolean): void {
  const ids = (target.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id !== "" && id !== TIP_ID);
  if (on) ids.push(TIP_ID);
  if (ids.length > 0) target.setAttribute("aria-describedby", ids.join(" "));
  else target.removeAttribute("aria-describedby");
}

/** What the passing card describes, while it shows: nothing once it has gone. */
function describedBy(by: object | null): void {
  if (page.described) described(page.described, false);
  page.described = by !== null && by instanceof Element ? by : null;
  if (page.described) described(page.described, true);
}

/** Puts a box at a corner, no taller than `most` (it scrolls, or shows what fits). */
function putAt(box: HTMLElement, x: number, y: number, most: number, tall: number): void {
  box.style.maxHeight = most < tall ? `${most}px` : "";
  box.style.transform = `translate(${x}px, ${y}px)`;
}

/**
 * Places the card by the one rule (`place.ts`), scrolled as it was: measuring it takes off the
 * height it was given, which takes away what it was scrolled by, so that is given back once its
 * height is.
 */
function placeCard(card: HTMLElement, o: Open, how: "keep" | "follow" | "new"): void {
  const scrolled = card.scrollTop;
  placeNow(card, o, how);
  card.scrollTop = scrolled;
}

/**
 * `keep`: drawn again, the card keeps its corner while that is still clear of its thing (a card
 * followed to stays put); `follow`: it moves with its thing, on the side it was on; `new`: wherever
 * the rule says first. A sheet goes to whichever edge does not cover its thing.
 */
function placeNow(card: HTMLElement, o: Open, how: "keep" | "follow" | "new"): void {
  const r0 = room();
  const spot = spotOf(o.at);
  card.style.maxHeight = "";
  const r = card.getBoundingClientRect();
  const size = { w: r.width, h: r.height };
  if (card.classList.contains("sheet")) {
    const s = sheet(r.height, spot, r0);
    card.classList.toggle("top", s.edge === "top");
    // As tall as that edge's own rule lets it be, measured there, and no taller than its room: the stricter wins.
    const there = card.getBoundingClientRect().height;
    card.style.maxHeight = s.most < there ? `${s.most}px` : "";
    page.corner = null;
    return;
  }
  const c = page.corner;
  if (c && ((how === "keep" && spot && clear(c, size, spot, r0)) || !spot)) {
    const x = Math.round(Math.max(4, Math.min(c.x, r0.w - size.w - 4)));
    const y = Math.round(Math.max(4, Math.min(c.y, r0.h - size.h - 4)));
    page.corner = { x, y };
    putAt(card, x, y, r0.h - 4 - y, size.h);
    return;
  }
  if (!spot) return;
  const p = beside(size, spot, r0, how === "new" || !page.side ? { side: o.side } : { side: o.side, was: page.side });
  page.corner = { x: p.x, y: p.y };
  page.side = p.side;
  putAt(card, p.x, p.y, p.most, size.h);
}

/** The glance of a thing pointed at inside the open card goes; with `by`, only that thing's. */
function unpeek(by: HTMLElement | null = null): void {
  if (!page.peek || (by && page.peek.by !== by)) return;
  page.peek.node.remove();
  described(page.peek.by, false);
  page.peek = null;
}

/** A thing pointed at inside the open card says its glance beside it: its name too, where only its picture shows. */
function peekAt(target: HTMLElement, ref: Ref): void {
  unpeek();
  const d = deck.describe(ref);
  if (!d) return;
  const line = d.glance ?? d.brief ?? "";
  const name = (target.textContent ?? "").includes(d.name) ? "" : d.name;
  if (!name && !line) return;
  const face = { pinned: false, sheet: false, glance: true, back: false, card: ref };
  const box = drawCard(line ? { name, glance: line } : { name }, face, hands);
  box.id = TIP_ID;
  box.classList.add("peek");
  document.body.append(box);
  const r = box.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  const p = beside({ w: r.width, h: r.height }, { x: t.left, y: t.top, w: t.width, h: t.height }, room());
  putAt(box, p.x, p.y, p.most, r.height);
  described(target, true);
  page.peek = { node: box, by: target };
}

/** How an open card is drawn. */
const faceOf = (o: Open): Face => ({
  pinned: o.pinned,
  sheet: o.pinned && o.via === "touch",
  glance: o.glance ?? false,
  back: o.stack.length > 1,
  card: o.stack.at(-1) ?? "",
});

/** The same card again (pinned where it was, followed on, refreshed, its glance grown), which keeps its place as far as it can. */
const sameCard = (prev: Open | null, o: Open): prev is Open =>
  prev !== null && prev.from === o.from && sameThing(prev.stack[0], o.stack[0]) && prev.at === o.at;

/** How the card is placed: the same card keeps its place, a glance grown follows its thing, anything else is placed anew. */
const howPlaced = (prev: Open | null, o: Open): "keep" | "follow" | "new" =>
  !sameCard(prev, o) ? "new" : prev.glance && !o.glance ? "follow" : "keep";

/** The very card that was up, drawn again: the same card, showing the same thing (not one followed to from it). */
const sameShown = (prev: Open | null, o: Open): boolean =>
  sameCard(prev, o) && prev.stack.length === o.stack.length && sameThing(prev.stack.at(-1), o.stack.at(-1));

/**
 * The new card goes in beside the old before the old goes: taking the old one out takes the focus
 * off a button pressed in it, and `replaceWith` would lose whatever followed the old. The very card
 * that was up, drawn again (`again`, not one followed to from it), keeps whoever was on one of its
 * buttons, and gives back how far it was scrolled, for once it is placed (no taller than it was:
 * scrolled before that, the browser would cut the scroll to what the taller card has); another card
 * in its place (followed to, gone back to) has the focus the old one had.
 */
function swapIn(was: HTMLElement | null, card: HTMLElement, again: boolean): number | null {
  const scrolled = was?.scrollTop ?? 0;
  const held = was ? [...was.querySelectorAll("button")].findIndex((b) => b === document.activeElement) : -1;
  const focused = was?.contains(document.activeElement) ?? false;
  if (was) {
    was.before(card);
    was.remove();
  } else document.body.append(card);
  if (!again) {
    if (focused && card.hasAttribute("tabindex")) card.focus({ preventScroll: true });
    return null;
  }
  card.querySelectorAll("button")[held]?.focus({ preventScroll: true });
  return scrolled;
}

/** Nothing is up: the card, its place and its layer go. */
function putAway(was: HTMLElement | null): void {
  was?.remove();
  page.corner = null;
  page.side = null;
  unpin();
}

const view: View = {
  render(o, d) {
    const was = page.node;
    const prev = page.drawn;
    page.drawn = o;
    page.node = null;
    unpeek();
    describedBy(null);
    if (!o || !d) return putAway(was);
    const card = drawCard(d, faceOf(o), hands);
    const scrolled = swapIn(was, card, sameShown(prev, o));
    page.node = card;
    placeCard(card, o, howPlaced(prev, o));
    // Placed, its head has the width it is shown at: where its name has no room, it is placed again.
    if (fitHead(card)) placeCard(card, o, "keep");
    // The same card, as high as it is to be: scrolled where it was, so what was under a finger is still under it.
    if (scrolled !== null) card.scrollTop = scrolled;
    if (!o.pinned) {
      card.id = TIP_ID;
      describedBy(o.from);
    }
    // A card newly pinned is a new layer, which gives the focus back to where it was before this card.
    const fresh = !(prev?.pinned && sameCard(prev, o));
    if (!o.pinned || fresh) unpin();
    if (!o.pinned) return;
    page.layer ??= layer(() => page.node, close);
    if (o.via === "key" && fresh) card.focus({ preventScroll: true });
  },
};

/** The page's one deck. */
export const deck = new Deck(view);

/** What a card drawn on this page does with what is in it. */
const hands: Hands = {
  describe: (ref) => deck.describe(ref),
  link: (target, ref, opts) => link(target, ref, opts),
  act(a, b) {
    if (!deck.confirms(a, refresh)) return;
    a.on(b);
    // Done or refused, the button no longer asks.
    if (a.ask !== undefined) deck.refresh();
  },
  back: () => deck.back(),
  close: () => deck.close(),
};

/** Registers a kind of thing: `describe(id)` gives its description, or null if there is no such thing. */
export const register = (kind: string, describe: Describe): void => deck.register(kind, describe);
/** A thing's description, or null. */
export const describe = (ref: Ref): Description | null => deck.describe(ref);
/** Asks to be told, now and whenever it changes, which thing is pointed at and which is pinned. */
export const watch = (fn: Watcher): (() => void) => deck.watch(fn);
/** While the game is dragging something, no card opens. */
export const hold = (on: boolean): void => deck.hold(on);
/** Puts the card away; with `from`, only if that is who opened it. */
export const close = (from: object | null = null): void => deck.close(from);
/** Back to the card before, if this one was followed to. */
export const back = (): boolean => deck.back();
/** The card is drawn again from a fresh description: the thing has changed. Under a held mouse button, once it lifts. */
export const refresh: () => void = unheld(() => deck.refresh());
/** The thing whose card is up, and whether it is pinned. */
export const shown = (): { ref: Ref; pinned: boolean } | null => {
  const ref = deck.shown();
  return ref === null || !deck.open ? null : { ref, pinned: deck.open.pinned };
};
/** Whether an element is on the card that is up. */
export const onCard = (target: EventTarget | null): boolean =>
  target instanceof Node && (page.node?.contains(target) ?? false);
/** How the last card was asked for, by the last pointer down: for a card a game pins by itself. */
export const lastVia = (): Via => page.via;
/** The small picture of a thing: its icon and name, linked, so every list of things looks and behaves alike. */
export const thing = (
  ref: Ref,
  opts: Omit<Entry, "ref" | "from" | "locked"> & { readonly bare?: boolean } = {},
): HTMLElement => thingOf(hands, ref, opts);

/** Options for `link`. */
export interface LinkOpts {
  /**
   * It does something of its own when clicked or tapped (buys, picks up): a click only puts the
   * passing card away, and a finger asks for the card with a long press instead of a tap.
   */
  readonly acts?: boolean;
  /** Its card goes to its side, not above or below it. */
  readonly side?: boolean;
  /** It is a tip (`tip.ts`), which is no thing: a press on it puts any other card away, as a press on anything else does. */
  readonly tip?: boolean;
}

/** Makes something that is not a control a button, which a picture alone names by its thing. */
function pressable(target: HTMLElement, ref: Ref): void {
  if (target.matches(CONTROLS)) return;
  if (!target.hasAttribute("role")) target.setAttribute("role", "button");
  if (!target.hasAttribute("tabindex")) target.tabIndex = 0;
  if (!target.textContent?.trim() && !target.hasAttribute("aria-label"))
    target.setAttribute("aria-label", deck.describe(ref)?.name ?? ref);
}

/**
 * Makes an element stand for a thing (`ref`, or what it is now, asked each time). Inside an open
 * card, it says its glance when pointed at and is followed when pressed, unless it acts.
 */
export function link(target: HTMLElement, ref: Ref | (() => Ref), opts: LinkOpts = {}): void {
  const now = typeof ref === "function" ? ref : (): Ref => ref;
  if (opts.tip) target.dataset.tip = "";
  else target.dataset.ref = now();
  target.classList.add("k-link");
  pressable(target, now());
  const { acts = false, side = false, tip = false } = opts;
  const own = scope();
  const inCard = (): boolean => page.node?.contains(target) ?? false;
  /** Whether it is this link that was pressed, not one inside it, which answers for itself. */
  const owns = (e: Event): boolean => (e.target instanceof Element ? e.target.closest(".k-link") : target) === target;
  /** Tells the watchers what is pointed at: a thing, not a tip. */
  const told = (r: Ref | null): void => {
    if (!tip && (r !== null || deck.pointed === now())) deck.point(r);
  };
  let rested = nothing;
  /** After a moment, if the mouse is still on it, its glance grows into its card. */
  const later = (): void => {
    rested();
    rested = own.after(REST_MS, () => {
      if (target.isConnected && target.matches(":hover")) deck.rest(now(), target, "mouse", target, side);
    });
  };
  own.on(target, "pointerenter", (e) => {
    if (e.pointerType !== "mouse") return;
    told(now());
    if (inCard()) return peekAt(target, now());
    deck.glance(now(), target, "mouse", target, side);
    later();
  });
  own.on(target, "pointerleave", (e) => {
    rested();
    unpeek(target);
    if (e.pointerType === "mouse") told(null);
    deck.leave(target);
  });
  own.on(target, "focus", () => {
    if (!target.matches(":focus-visible") || givingBack()) return;
    if (inCard()) return peekAt(target, now());
    told(now());
    deck.rest(now(), target, "key", target, side);
  });
  own.on(target, "blur", () => {
    unpeek(target);
    told(null);
    deck.leave(target);
  });
  own.on(target, "keydown", (e) => {
    // Enter asks about it, and Space as well where it is no control (a control's Space is a click).
    if (acts || !owns(e) || !(e.key === "Enter" || (e.key === " " && !target.matches(CONTROLS)))) return;
    e.preventDefault();
    if (inCard()) deck.follow(now());
    else deck.press(now(), target, "key", target, side);
  });
  own.on(target, "pointerdown", () => rested());
  // A finger asks about a thing that acts by resting on it: its card is pinned (inside a card, followed).
  const asked = longPress(own, target, {
    starts: (e) => e.pointerType !== "mouse" && acts && owns(e),
    asked: () => (inCard() ? deck.follow(now()) : deck.press(now(), target, "touch", target, side)),
  });
  own.on(
    target,
    "click",
    (e) => {
      if (!owns(e)) return;
      // The tap that ends a long press was asking what the thing is, not using it.
      if (asked(e)) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      // Pressed with a pointer, it does its own thing and its passing card goes; the keyboard's stays with the focus.
      if (acts) {
        if (!inCard() && e.detail > 0) deck.leave(target);
        return;
      }
      // A thing shown inside something bigger that can be clicked (a pick) is asked about, not chosen.
      e.stopPropagation();
      if (inCard()) {
        e.preventDefault();
        unpeek(target);
        deck.follow(now());
        return;
      }
      const via: Via = e.detail === 0 ? "key" : page.via;
      // Clicked shut with the mouse still on it: its card comes back as a passing one.
      if (!deck.press(now(), target, via, target, side) && via === "mouse") later();
    },
    { capture: true },
  );
}

/**
 * The same thing pointed at, somewhere else (the view moved under it, or another tile of it): its
 * card grows there, and what shows of it goes there too. A card pinned, or one about something
 * else, stays where it is.
 */
function pointedAgain(ref: Ref | null, spot: Spot): void {
  const at = page.pointAt;
  if (ref === null || (at && at.x === spot.x && at.y === spot.y && at.w === spot.w && at.h === spot.h)) return;
  page.pointAt = spot;
  const o = deck.open;
  if (o && !o.pinned && o.from === CANVAS && deck.shown() === ref) moveCard(CANVAS, spot);
}

/**
 * Something drawn on a canvas is pointed at (or nothing is), in a box on the page: its glance shows
 * at once, and its card after a moment, as for an element.
 */
export function point(ref: Ref | null, x: number, y: number, w = 0, h = 0): void {
  const spot = { x, y, w, h };
  if (ref === page.pointing) return pointedAgain(ref, spot);
  const was = page.pointing;
  page.pointing = ref;
  page.pointWait();
  deck.leave(CANVAS);
  // Leaving the canvas for a link: the link has already said what is pointed at.
  if (ref !== null) deck.point(ref);
  else if (deck.pointed === was) deck.point(null);
  page.pointAt = ref === null ? null : spot;
  if (ref === null) return;
  deck.glance(ref, spot, "mouse", CANVAS);
  page.pointWait = live.after(REST_MS, () => {
    if (page.pointing === ref) deck.rest(ref, page.pointAt ?? spot, "mouse", CANVAS);
  });
}

/** Something drawn on a canvas is clicked or tapped (or nothing is): its card is pinned, or put away if it was the one pinned. */
export function pick(ref: Ref | null, x: number, y: number, w = 0, h = 0): boolean {
  page.pointWait();
  if (ref === null) {
    deck.close(CANVAS);
    return false;
  }
  return deck.press(ref, { x, y, w, h }, page.via, CANVAS);
}

/** While the game holds something, shows what letting it go here would do (or nothing); with `side`, beside the box. */
export function show(ref: Ref | null, x = 0, y = 0, w = 0, h = 0, side = false): void {
  deck.preview(ref, { x, y, w, h }, CANVAS, side);
}

/** The canvas's token, for `close(canvasCard)`: puts away only a card that `point` or `pick` opened. */
export const canvasCard: object = CANVAS;

/**
 * Marks a canvas (or any element) whose game does its own hit-testing: a press on it does not put
 * the card away by itself, since the game says with `pick` what the press meant.
 */
export function surface(target: Pick<HTMLElement, "dataset">): void {
  target.dataset.cards = "";
}

/** The page has been laid out again: the card moves with what it is beside, or goes if that has gone. */
export function settle(): void {
  const o = deck.open;
  const node = page.node;
  if (!o || !node) return;
  if (o.at instanceof Element && !o.at.isConnected) {
    if (!o.pinned) deck.close();
    return;
  }
  // A card followed to stays where it is; a sheet goes to whichever edge keeps it off its thing now.
  if (!node.classList.contains("sheet") && o.pinned && o.stack.length > 1) return;
  placeCard(node, o, "follow");
}

/** What `from` opened (a canvas's card: `canvasCard`) is beside another box now: the view moved under it. It is placed again. */
export function moveCard(from: object, spot: Spot): void {
  if (!deck.moveTo(from, spot)) return;
  // It is still the card that was drawn, now beside the new box.
  page.drawn = deck.open;
  settle();
}

/**
 * Puts away the passing card once what it was shown for leaves the page or, unless it was shown for
 * the keyboard's focus, once the mouse is on something outside it. A panel drawn again under a
 * resting mouse takes its old buttons away with no `pointerleave`, so this is asked whenever the page
 * changes and whenever the mouse comes onto something new.
 */
function sweep(on: EventTarget | null): void {
  if (page.peek && !page.peek.by.isConnected) unpeek();
  const o = deck.open;
  if (!o || o.pinned || !(o.from instanceof Element)) return;
  if (!o.from.isConnected || (o.via !== "key" && on instanceof Node && !o.from.contains(on))) deck.close(o.from);
}

if (typeof window !== "undefined") {
  live.on(
    window,
    "pointerdown",
    (e) => {
      page.via = e.pointerType === "mouse" ? "mouse" : "touch";
      if (!deck.open && !deck.waiting()) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t && page.node?.contains(t)) return;
      // What the card is for, a thing that is a link, or a canvas a game points into, says for itself what a press means.
      const from = deck.open?.from;
      if (t && from instanceof Element && from.contains(t)) return;
      if (t?.closest("[data-ref], [data-cards]")) return;
      deck.close();
    },
    { capture: true },
  );
  live.on(window, "keydown", (e) => {
    // A pinned card is a layer, which has its Escape first (`dialog.ts`); this is for a passing one,
    // which holds no focus, so the focus stays where it is.
    // One press puts away one thing: an Escape something before took is not this card's.
    if (e.key !== "Escape" || e.defaultPrevented || (!deck.open && !deck.waiting())) return;
    // A card took this Escape: a page listening after it should not put anything else away too. A
    // tip's words go with an Escape the page hears as well, as they always have.
    if (!isSaid(deck.shown())) e.preventDefault();
    deck.close();
  });
  live.on(window, "resize", settle);
  // A face that came late changes how long the words are: the card is placed again.
  live.on(document.fonts, "loadingdone", settle);
  live.on(
    window,
    "pointerover",
    (e) => {
      if (e.pointerType === "mouse") sweep(e.target);
    },
    { capture: true },
  );
  live.observe(document.documentElement, { childList: true, subtree: true }, () => sweep(null));
}
