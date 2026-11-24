/**
 * Cards: the one way anything in any of the games explains itself.
 *
 * A game registers each kind of thing it has once (`register("item", describe)`), and from then on
 * names a thing by a reference, `"kind:id"`. Anything on the page can be made to stand for a thing
 * (`link`), `thing(ref)` is the standard small picture of one (its icon and name, already linked),
 * and something drawn on a canvas is told about with `point` and `pick` by the game's own
 * hit-testing.
 *
 * It behaves the same everywhere. With a mouse, resting on a thing for a moment shows its card
 * beside it; clicking pins it open, and clicking the thing again, clicking elsewhere, its close
 * button or Escape puts it away. With a finger a tap pins it, as a sheet along the bottom (above the
 * game's bar: `--sheet-floor`). A thing named inside an open card is itself a link: following it
 * shows its card in the same place with a back arrow. One card is up at a time. `hold(true)` keeps every card shut while the game is
 * dragging something, and `watch` tells a game which thing is pointed at or pinned.
 *
 * The rules of that (`Deck`, `partsOf`) touch no page and are tested; the rest draws them.
 */
import { layer } from "./dialog.ts";
import { add, asking, asksAgain, el, icon, pressedTwice, unheld } from "./dom.ts";
import { goesWith, LONG_PRESS, tip, tipAt, tipOff } from "./tip.ts";

/** A thing, named as `"kind:id"`: `"item:gear"`, `"figure:barrow-gnome"`, `"trait:ember"`. */
export type Ref = string;

/** A small labelled chip, which may stand for a thing: "Kin", "Gnome 1/2". */
export interface Chip {
  readonly label?: string;
  readonly text: string;
  readonly icon?: Node | null;
  /** A count after the words, as the trait strip shows it: "1/2". */
  readonly count?: string;
  readonly lit?: boolean;
  readonly ref?: Ref;
  /** A tip on it: what it means, in a sentence. */
  readonly hint?: string;
}

/** A number with its label; raised (green) or lowered (coral) by something. */
export interface Stat {
  readonly label: string;
  readonly value: string;
  readonly mark?: "raised" | "lowered";
}

/** A bold title with a note at its right and words under it: an ability, what a machine does. */
export interface Block {
  readonly title?: string;
  readonly note?: string;
  readonly body?: string | Node;
  /** Title, words and note on one line: a trait's steps. */
  readonly line?: boolean;
  /** Picked out: the step a party has reached. */
  readonly lit?: boolean;
}

/** One thing in a row of a card. */
export interface Entry {
  readonly ref: Ref;
  /** Picked out: one the member has, or fields. */
  readonly lit?: boolean;
  /** A small tag: "have", "bench", "stall". */
  readonly tag?: string;
  /** How many: "×2". */
  readonly count?: string;
  /** Something after the name: a price, how many are owed. */
  readonly note?: string | Node;
  /** It is made with this: the line shows that thing's icon, an arrow, then this thing. */
  readonly from?: Ref;
  /** Not to be had yet, and how it opens: shown as a dark outline with these words. */
  readonly locked?: string;
  /** Its own picture or name here, in place of the ones its card has. */
  readonly icon?: Node;
  readonly name?: string;
}

/** A small label and a list of things: "Made from", "Used in", "Every figure". */
export interface Row {
  readonly label: string;
  readonly things: readonly Entry[];
  /** `list` (icon and name, the usual), `icons` (pictures only) or `tiles` (a picture over its name). */
  readonly look?: "list" | "icons" | "tiles";
}

/** A button at the foot of a pinned card. */
export interface Action {
  readonly label?: string;
  readonly icon?: Node | null;
  /** The kit's button classes after `k-btn` (`"wood sm"`, `"coral sm"`), or `"slot"` for a hollow holding an icon. */
  readonly look?: string;
  readonly lit?: boolean;
  readonly off?: boolean;
  /** After the words: what it pays or costs. */
  readonly after?: Node | null;
  /** A tip on it. */
  readonly hint?: string;
  readonly about?: string;
  /** For what spends: the first press only changes the button's words to these, and a second press does it. */
  readonly ask?: string;
  readonly on: (button: HTMLButtonElement) => void;
}

/** What a thing says about itself. Only the name is needed. */
export interface Description {
  readonly name: string;
  /** A canvas (sized to fit by the card) or an element, shown in a slot at the left of the head. */
  readonly icon?: Node | null;
  /** One line under the name: a role, a kind, "worked once". */
  readonly tag?: string | Node;
  /** At the right of the head: a price, stars. */
  readonly aside?: Node | string | null;
  readonly chips?: readonly Chip[];
  /** Numbers with their labels; a text among them is a heading over the numbers after it, and makes them a sheet. */
  readonly stats?: readonly (Stat | string)[];
  readonly blocks?: readonly Block[];
  readonly rows?: readonly Row[];
  readonly actions?: readonly Action[];
  /** Part of it is still on its way (a person's numbers, from Leaf): its card is not shown until this settles, and is then asked for again. */
  readonly coming?: Promise<unknown>;
}

export type Describe = (id: string) => Description | null;

/** A box on the page, in CSS pixels, for a card to sit beside. */
export interface Spot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

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

/** The parts a description makes, in the order a card shows them. Actions only on a pinned card. */
export function partsOf(
  d: Description,
  pinned: boolean,
): ("head" | "chips" | "stats" | "blocks" | "rows" | "actions")[] {
  const parts: ("head" | "chips" | "stats" | "blocks" | "rows" | "actions")[] = ["head"];
  if (d.chips && d.chips.length > 0) parts.push("chips");
  if (d.stats && d.stats.length > 0) parts.push("stats");
  if (d.blocks && d.blocks.length > 0) parts.push("blocks");
  if (d.rows && d.rows.some((r) => r.things.length > 0)) parts.push("rows");
  if (pinned && d.actions && d.actions.length > 0) parts.push("actions");
  return parts;
}

/**
 * The rules of the cards, with no page in them: what is registered, which card is up and how it
 * got there, what is pointed at, and whether cards are held shut.
 */
export class Deck {
  readonly kinds = new Map<string, Describe>();
  open: Open | null = null;
  pointed: Ref | null = null;
  held = false;
  readonly view: View;
  readonly #watchers = new Set<Watcher>();
  #told: string = "|";
  /** Whoever asked for a card whose description is still coming, and whether to pin it. */
  #awaited: { from: object; pinned: boolean } | null = null;

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
    this.view.render(open, description);
    this.#tell();
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

  /** The pointer has rested on a thing: its card shows beside it, unless one is pinned (or was clicked and is still coming) or cards are held. */
  rest(ref: Ref, at: Spot | object, via: Via, from: object, side = false): boolean {
    if (this.held || this.open?.pinned || this.#awaited?.pinned) return false;
    const d = this.describe(ref);
    if (!d) {
      if (this.open) this.#set(null, null);
      return false;
    }
    if (this.#wait(d, from, false, () => this.rest(ref, at, via, from, side))) return false;
    this.#set({ stack: [ref], pinned: false, via, at, from, side, preview: false }, d);
    return true;
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
    if (o?.pinned && o.from === from && o.stack.length === 1 && o.stack[0] === ref) {
      this.#set(null, null);
      return false;
    }
    const d = this.describe(ref);
    if (!d) return false;
    if (this.#wait(d, from, true, () => this.press(ref, at, via, from, side))) return true;
    // A passing card for the same thing stays where it is and is pinned.
    if (o && !o.pinned && o.from === from && o.stack.at(-1) === ref && via !== "touch") {
      this.#set({ ...o, pinned: true, via, preview: false }, d);
      return true;
    }
    this.#set({ stack: [ref], pinned: true, via, at, from, side, preview: false }, d);
    return true;
  }

  /** A thing named inside the open card was followed: its card takes the place of this one, with a way back. */
  follow(ref: Ref): boolean {
    const o = this.open;
    if (!o || o.stack.at(-1) === ref) return false;
    const d = this.describe(ref);
    if (!d) return false;
    this.#set({ ...o, stack: [...o.stack, ref], pinned: true, preview: false }, d);
    return true;
  }

  /** Back to the card before. */
  back(): boolean {
    const o = this.open;
    if (!o || o.stack.length < 2) return false;
    const stack = o.stack.slice(0, -1);
    const d = this.describe(stack.at(-1) ?? "");
    if (!d) {
      this.#set(null, null);
      return false;
    }
    this.#set({ ...o, stack }, d);
    return true;
  }

  /** Shows what dropping the thing in hand would do, while cards are otherwise held shut. */
  preview(ref: Ref | null, at: Spot, from: object): void {
    const d = ref === null ? null : this.describe(ref);
    if (ref === null || !d) {
      if (this.open?.preview) this.#set(null, null);
      return;
    }
    this.#set({ stack: [ref], pinned: false, via: "mouse", at, from, side: false, preview: true }, d);
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
/** How long the mouse rests on a thing before its card shows. */
const REST_MS = 220;

let node: HTMLElement | null = null;
/** The card's corner when it was last placed, so a card followed to stays put. */
let corner: { x: number; y: number } | null = null;
let lastVia: Via = "mouse";

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

/** Puts the card beside a box: above it where there is room, otherwise below, otherwise to a side. With `side`, to the right (or left) first. */
function place(card: HTMLElement, spot: Spot, side: boolean): void {
  const r = card.getBoundingClientRect();
  const W = window.innerWidth;
  const H = window.innerHeight;
  const gap = 8;
  const clampX = (x: number): number => Math.min(Math.max(4, x), W - r.width - 4);
  const clampY = (y: number): number => Math.min(Math.max(4, y), H - r.height - 4);
  const right = spot.x + spot.w + gap;
  const left = spot.x - r.width - gap;
  let x: number;
  let y: number;
  if (side && (right + r.width <= W - 4 || left >= 4)) {
    x = right + r.width <= W - 4 ? right : left;
    y = clampY(spot.y);
  } else {
    const above = spot.y - r.height - gap;
    const below = spot.y + spot.h + gap;
    x = clampX(spot.x + spot.w / 2 - r.width / 2);
    if (above >= 4) y = above;
    else if (below + r.height <= H - 4) y = below;
    else {
      // No room above or below: beside it, flipped to whichever side has room.
      y = clampY(spot.y + spot.h / 2 - r.height / 2);
      x = right + r.width <= W - 4 ? right : left >= 4 ? left : x;
    }
  }
  corner = { x: Math.round(x), y: Math.round(y) };
  card.style.transform = `translate(${corner.x}px, ${corner.y}px)`;
}

/**
 * A canvas's picture fitted into a box `box` units square: by whole steps (at most `most`) where it
 * fits, and shrunk to the box where it does not.
 */
function fit(art: Node, box: number, most = 1): Node {
  // One of the kit's own icons grows by its own whole steps.
  if (art instanceof HTMLElement && art.classList.contains("k-i")) {
    art.style.setProperty("--s", String(most));
    return art;
  }
  if (!(art instanceof HTMLCanvasElement)) return art;
  const c = document.createElement("canvas");
  c.width = art.width;
  c.height = art.height;
  c.getContext("2d")?.drawImage(art, 0, 0);
  c.className = "k-px";
  const side = Math.max(art.width, art.height, 1);
  const scale = side > box ? box / side : Math.min(most, Math.max(1, Math.floor(box / side)));
  c.style.width = `calc(var(--u) * ${art.width * scale})`;
  c.style.height = `calc(var(--u) * ${art.height * scale})`;
  return c;
}

const words = (v: string | Node, cls: string): HTMLElement =>
  typeof v === "string" ? el("div", cls, { text: v }) : el("div", cls, {}, v);

/** The class of the line under a card's name: a sentence (it ends with a stop) is read, anything else is in the game's face. */
const tagLook = (v: string | Node): string =>
  /[.?!]$/.test(typeof v === "string" ? v : (v.textContent ?? "")) ? "k-d" : "k-dim";

function chipOf(c: Chip): HTMLElement {
  const face = el(
    "span",
    `k-chip${c.lit ? " lit" : ""}`,
    {},
    c.icon ? fit(c.icon, 12) : null,
    c.text,
    c.count ? el("b", "k-info-count", { text: c.count }) : null,
  );
  const box = el(
    c.ref ? "button" : "span",
    "k-info-chip",
    c.ref ? { type: "button", "aria-label": `${c.text}${c.label ? `, ${c.label.toLowerCase()}` : ""}` } : {},
    c.label ? el("span", "k-label", { text: c.label }) : null,
    face,
  );
  if (c.ref) link(box, c.ref);
  if (c.hint) tip(box, c.text, c.hint);
  return box;
}

function statOf(s: Stat): HTMLElement {
  const tone = s.mark === "raised" ? "k-leafy" : s.mark === "lowered" ? "k-coral" : "";
  return el("span", "k-info-stat", {}, el("span", "k-label", { text: s.label }), el("b", tone, { text: s.value }));
}

function blockOf(b: Block): HTMLElement {
  const title = b.title ? el("b", "k-info-title", { text: b.title }) : null;
  const note = b.note ? el("span", "k-info-note", { text: b.note }) : null;
  const body = b.body === undefined ? null : words(b.body, "k-read k-info-body");
  if (b.line) return el("div", `k-info-block line${b.lit ? " lit" : ""}`, {}, title, body, note);
  return el(
    "div",
    `k-info-block${b.lit ? " lit" : ""}`,
    {},
    title || note ? el("div", "k-info-bhead", {}, title, note) : null,
    body,
  );
}

/** The small picture of a thing: its icon and name, linked, so every list of things looks and behaves alike. */
export function thing(
  ref: Ref,
  opts: Omit<Entry, "ref" | "from" | "locked"> & { readonly bare?: boolean } = {},
): HTMLElement {
  const d = deck.describe(ref);
  const name = opts.name ?? d?.name ?? ref;
  const art = opts.icon ?? d?.icon ?? null;
  const t = el(
    "span",
    `k-thing${opts.lit ? " lit" : ""}${opts.bare ? " bare" : ""}`,
    opts.bare ? { "aria-label": name } : {},
    art ? el("span", "k-thing-pic", {}, fit(art, 12)) : null,
    opts.bare ? null : el("span", "k-thing-name", { text: name }),
    opts.count ? el("b", "k-thing-count", { text: opts.count }) : null,
    opts.note === undefined
      ? null
      : typeof opts.note === "string"
        ? el("span", "k-s k-dim", { text: opts.note })
        : opts.note,
    opts.tag ? el("span", "k-info-tagged", { text: opts.tag }) : null,
  );
  link(t, ref);
  return t;
}

function tileOf(e: Entry): HTMLElement {
  const d = deck.describe(e.ref);
  const name = e.name ?? d?.name ?? e.ref;
  const art = e.icon ?? d?.icon ?? null;
  const tile = el(
    "span",
    `k-slot k-info-tile${e.lit ? " lit" : ""}${e.locked ? " locked" : ""}`,
    {},
    el("span", "k-info-tile-pic", {}, art ? fit(art, 24) : null),
    el("span", "k-s k-info-tile-name", { text: name }),
    e.locked
      ? icon("lock")
      : e.note === undefined
        ? null
        : typeof e.note === "string"
          ? el("span", "k-s", { text: e.note })
          : e.note,
    e.tag ? el("span", "k-info-tagged corner", { text: e.tag }) : null,
  );
  if (!e.locked) link(tile, e.ref);
  return tile;
}

function entryOf(e: Entry, look: Row["look"]): HTMLElement {
  if (look === "tiles") return tileOf(e);
  if (look === "icons") {
    const art = e.icon ?? deck.describe(e.ref)?.icon ?? null;
    const s = el("span", `k-slot k-info-icon${e.lit ? " lit" : ""}`, {}, art ? fit(art, 12) : null);
    link(s, e.ref);
    return s;
  }
  const t = thing(e.ref, e);
  if (!e.from) return t;
  const other = deck.describe(e.from);
  const pre = el(
    "span",
    "k-info-with",
    { "aria-label": other?.name ?? e.from },
    other?.icon ? fit(other.icon, 12) : null,
  );
  link(pre, e.from);
  return el("span", `k-info-make${e.lit ? " lit" : ""}`, {}, pre, el("span", "k-dim k-pix", { text: "→" }), t);
}

function actionOf(a: Action, card: Ref): HTMLElement {
  const slot = a.look === "slot";
  const key = `${card}|${a.label}`;
  const ask = a.ask !== undefined && asking(key) ? a.ask : null;
  const b = el(
    "button",
    slot
      ? `k-slot k-info-pin${a.lit ? " lit" : ""}`
      : `k-btn ${a.look ?? "wood sm"}${a.off ? " off" : ""}${ask ? " asking" : ""}`,
    { type: "button", "aria-label": a.label && slot ? a.label : null },
    ...(a.ask !== undefined && !slot
      ? [asksAgain(key, [a.icon ?? null, a.label || null, a.after ?? null], a.ask)]
      : [
          a.icon && !ask ? (slot ? fit(a.icon, 12) : a.icon) : null,
          ask ?? (a.label && !slot ? a.label : null),
          slot || ask ? null : (a.after ?? null),
        ]),
  );
  b.addEventListener("click", () => {
    if (a.ask !== undefined && !pressedTwice(key, () => deck.refresh())) return;
    a.on(b);
    // Done or refused, the button no longer asks.
    if (a.ask !== undefined) deck.refresh();
  });
  if (a.hint) tip(b, a.hint, a.about ?? "");
  return b;
}

/** A card, drawn from its description. */
function drawCard(d: Description, o: Open): HTMLElement {
  const sheet = o.pinned && o.via === "touch";
  const card = el("div", `k-tip k-float k-info${o.pinned ? " pinned" : ""}${sheet ? " sheet" : ""}`, {
    role: o.pinned ? "dialog" : "tooltip",
    "aria-label": d.name,
    tabindex: o.pinned ? -1 : null,
  });
  const backBtn =
    o.stack.length > 1
      ? el(
          "button",
          "k-btn plum icon sm k-info-back",
          { type: "button", "aria-label": "Back", onclick: () => deck.back() },
          icon("back"),
        )
      : null;
  // A passing card keeps the close button's room, unseen, so that pinning it moves nothing: a name
  // that fitted two lines beside no button would take three beside one.
  const closeBtn = o.pinned
    ? el(
        "button",
        "k-btn wood icon sm k-info-x",
        { type: "button", "aria-label": "Close", onclick: () => deck.close() },
        icon("close"),
      )
    : el("span", "k-btn wood icon sm k-info-x unseen", { "aria-hidden": "true" }, icon("close"));
  for (const part of partsOf(d, o.pinned)) {
    if (part === "head") {
      add(
        card,
        el(
          "div",
          "k-info-head",
          {},
          backBtn,
          d.icon ? el("span", "k-slot k-info-pic", {}, fit(d.icon, 40, 2)) : null,
          el(
            "div",
            "k-info-who",
            {},
            el("b", "k-name", { text: d.name }),
            d.tag === undefined ? null : words(d.tag, `${tagLook(d.tag)} k-info-tag`),
          ),
          d.aside ? el("span", "k-info-aside", {}, d.aside) : null,
          closeBtn,
        ),
      );
    } else if (part === "chips") add(card, el("div", "k-info-part k-info-chips", {}, ...(d.chips ?? []).map(chipOf)));
    else if (part === "stats")
      add(
        card,
        el(
          "div",
          // Under headings, the numbers are a sheet: a line each.
          `k-info-part k-info-stats${(d.stats ?? []).some((s) => typeof s === "string") ? " listed" : ""}`,
          {},
          ...(d.stats ?? []).map((s) =>
            typeof s === "string" ? el("span", "k-label k-info-over", { text: s }) : statOf(s),
          ),
        ),
      );
    else if (part === "blocks") add(card, el("div", "k-info-part k-info-blocks", {}, ...(d.blocks ?? []).map(blockOf)));
    else if (part === "rows")
      add(
        card,
        el(
          "div",
          "k-info-part k-info-rows",
          {},
          ...(d.rows ?? [])
            .filter((r) => r.things.length > 0)
            .map((r) =>
              el(
                "div",
                `k-info-row k-look-${r.look ?? "list"}`,
                {},
                el("span", "k-label", { text: r.label }),
                el("div", "k-info-things", {}, ...r.things.map((e) => entryOf(e, r.look))),
                // What opens each locked one, read at the reading size under the tiles.
                ...r.things.flatMap((e) =>
                  r.look === "tiles" && e.locked
                    ? [
                        el(
                          "div",
                          "k-read k-dim k-info-how",
                          {},
                          el("b", "", { text: `${e.name ?? deck.describe(e.ref)?.name ?? e.ref}: ` }),
                          e.locked,
                        ),
                      ]
                    : [],
                ),
              ),
            ),
        ),
      );
    else
      add(
        card,
        el("div", "k-info-part k-info-acts", {}, ...(d.actions ?? []).map((a) => actionOf(a, o.stack.at(-1) ?? ""))),
      );
  }
  return card;
}

/** The card last drawn, to tell a card drawn again from a new one. */
let drawn: Open | null = null;
/** A pinned card is a layer over the page (`dialog.ts`): Escape puts it away, and Tab stays in it. */
let pinnedLayer: (() => void) | null = null;
const unpin = (): void => {
  pinnedLayer?.();
  pinnedLayer = null;
};

const view: View = {
  render(o, d) {
    const was = node;
    const prev = drawn;
    drawn = o;
    node = null;
    if (!o || !d) {
      was?.remove();
      corner = null;
      unpin();
      return;
    }
    const card = drawCard(d, o);
    const scrolled = was?.scrollTop ?? 0;
    const held = was ? [...was.querySelectorAll("button")].findIndex((b) => b === document.activeElement) : -1;
    // The new card goes in beside the old before the old goes. Taking the old one out takes the
    // focus off a button pressed in it, which puts away that button's tip; `replaceWith` puts the
    // new card in before whatever followed the old, and when that was the tip, it was gone.
    if (was) {
      was.before(card);
      was.remove();
    } else document.body.append(card);
    node = card;
    // The same card again (pinned where it was, followed on, refreshed) keeps its corner as far as it fits.
    const same = prev !== null && prev.from === o.from && prev.stack[0] === o.stack[0] && prev.at === o.at;
    // The very card that was up, drawn again (not one followed to from it): it stays scrolled where it was,
    // so what was under a finger is still under it, and whoever was on one of its buttons is still on it.
    if (same && prev.stack.length === o.stack.length && prev.stack.at(-1) === o.stack.at(-1)) {
      card.scrollTop = scrolled;
      card.querySelectorAll("button")[held]?.focus({ preventScroll: true });
    }
    const spot = spotOf(o.at);
    if (card.classList.contains("sheet")) {
      corner = null;
      card.style.transform = "";
    } else if ((same || !spot) && corner) {
      const r = card.getBoundingClientRect();
      corner = {
        x: Math.round(Math.min(Math.max(4, corner.x), window.innerWidth - r.width - 4)),
        y: Math.round(Math.min(Math.max(4, corner.y), window.innerHeight - r.height - 4)),
      };
      card.style.transform = `translate(${corner.x}px, ${corner.y}px)`;
    } else if (spot) place(card, spot, o.side);
    // A card newly pinned is a new layer, which gives the focus back to where it was before this card.
    const fresh = !(prev?.pinned && same);
    if (!o.pinned || fresh) unpin();
    if (o.pinned)
      pinnedLayer ??= layer(
        () => node,
        () => deck.close(),
      );
    if (o.pinned && o.via === "key" && fresh) card.focus({ preventScroll: true });
  },
};

/** The page's one deck. */
export const deck = new Deck(view);

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
  target instanceof Node && (node?.contains(target) ?? false);

/** Options for `link`. */
export interface LinkOpts {
  /**
   * It does something of its own when clicked or tapped (buys, picks up): a click only puts the
   * passing card away, and a finger asks for the card with a long press instead of a tap.
   */
  readonly acts?: boolean;
  /** Its card goes to its side, not above or below it. */
  readonly side?: boolean;
}

/** Makes an element stand for a thing. Inside an open card, it is followed instead. */
export function link(target: HTMLElement, ref: Ref, opts: LinkOpts = {}): void {
  target.dataset.ref = ref;
  target.classList.add("k-link");
  // Something that is not a control already becomes a button, which a picture alone names by its thing.
  if (!target.matches("button, a[href], input, select, textarea, summary")) {
    if (!target.hasAttribute("role")) target.setAttribute("role", "button");
    if (!target.hasAttribute("tabindex")) target.tabIndex = 0;
    if (!target.textContent?.trim() && !target.hasAttribute("aria-label"))
      target.setAttribute("aria-label", deck.describe(ref)?.name ?? ref);
  }
  let timer = 0;
  let press = 0;
  let swallow = false;
  const side = opts.side ?? false;
  const inCard = (): boolean => node?.contains(target) ?? false;
  /** A picture without its name, inside a card, says its name in a plain tip. */
  const named = (): void => {
    if (!inCard() || target.querySelector(".k-thing-name, .k-info-tile-name")) return;
    const r = target.getBoundingClientRect();
    tipAt({ x: r.left, y: r.top, w: r.width, h: r.height }, deck.describe(ref)?.name ?? "", "", target);
  };
  /** After a moment, if the mouse is still on it, its card shows. */
  const rest = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (target.isConnected && target.matches(":hover")) deck.rest(ref, target, "mouse", target, side);
    }, REST_MS);
  };
  target.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse") return;
    deck.point(ref);
    if (inCard()) {
      named();
      return;
    }
    rest();
  });
  target.addEventListener("pointerleave", (e) => {
    window.clearTimeout(timer);
    tipOff(target);
    if (e.pointerType === "mouse" && deck.pointed === ref) deck.point(null);
    deck.leave(target);
  });
  target.addEventListener("focus", () => {
    if (!target.matches(":focus-visible") || inCard()) return;
    deck.point(ref);
    deck.rest(ref, target, "key", target, side);
  });
  target.addEventListener("blur", () => {
    if (deck.pointed === ref) deck.point(null);
    deck.leave(target);
  });
  target.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || (opts.acts && !inCard())) return;
    e.preventDefault();
    if (inCard()) deck.follow(ref);
    else deck.press(ref, target, "key", target, side);
  });
  target.addEventListener("pointerdown", (e) => {
    window.clearTimeout(timer);
    if (e.pointerType === "mouse" || !opts.acts || inCard()) return;
    swallow = false;
    window.clearTimeout(press);
    const x = e.clientX;
    const y = e.clientY;
    const still = (m: PointerEvent): void => {
      if (Math.hypot(m.clientX - x, m.clientY - y) > 9) window.clearTimeout(press);
    };
    target.addEventListener("pointermove", still);
    press = window.setTimeout(() => {
      target.removeEventListener("pointermove", still);
      swallow = true;
      deck.press(ref, target, "touch", target, side);
    }, LONG_PRESS);
    const lift = (): void => {
      window.clearTimeout(press);
      target.removeEventListener("pointermove", still);
    };
    target.addEventListener("pointerup", lift, { once: true });
    target.addEventListener("pointercancel", lift, { once: true });
  });
  target.addEventListener(
    "click",
    (e) => {
      // The tap that ends a long press was asking what the thing is, not using it.
      if (swallow) {
        swallow = false;
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (inCard()) {
        e.preventDefault();
        e.stopPropagation();
        tipOff(target);
        deck.follow(ref);
        return;
      }
      if (opts.acts) {
        deck.leave(target);
        return;
      }
      // A thing shown inside something bigger that can be clicked (a pick) is asked about, not chosen.
      e.stopPropagation();
      const via: Via = e.detail === 0 ? "key" : lastVia;
      // Clicked shut with the mouse still on it: its card comes back as a passing one.
      if (!deck.press(ref, target, via, target, side) && via === "mouse") rest();
    },
    true,
  );
}

let pointing: Ref | null = null;
let pointTimer = 0;
/**
 * Something drawn on a canvas is pointed at (or nothing is), in a box on the page: its card shows
 * after a moment, as for an element.
 */
export function point(ref: Ref | null, x: number, y: number, w = 0, h = 0): void {
  if (ref === pointing) return;
  const was = pointing;
  pointing = ref;
  window.clearTimeout(pointTimer);
  deck.leave(CANVAS);
  // Leaving the canvas for a link: the link has already said what is pointed at.
  if (ref !== null) deck.point(ref);
  else if (deck.pointed === was) deck.point(null);
  if (ref === null) return;
  pointTimer = window.setTimeout(() => {
    if (pointing === ref) deck.rest(ref, { x, y, w, h }, "mouse", CANVAS);
  }, REST_MS);
}

/** Something drawn on a canvas is clicked or tapped (or nothing is): its card is pinned, or put away if it was the one pinned. */
export function pick(ref: Ref | null, x: number, y: number, w = 0, h = 0): boolean {
  window.clearTimeout(pointTimer);
  if (ref === null) {
    deck.close(CANVAS);
    return false;
  }
  return deck.press(ref, { x, y, w, h }, lastVia, CANVAS);
}

/** While the game holds something, shows what letting it go here would do (or nothing). */
export function show(ref: Ref | null, x = 0, y = 0, w = 0, h = 0): void {
  deck.preview(ref, { x, y, w, h }, CANVAS);
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
  if (!o || !node) return;
  if (o.at instanceof Element && !o.at.isConnected) {
    if (!o.pinned) deck.close();
    return;
  }
  if (node.classList.contains("sheet") || (o.pinned && o.stack.length > 1)) return;
  const spot = spotOf(o.at);
  if (spot) place(node, spot, o.side);
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      lastVia = e.pointerType === "mouse" ? "mouse" : "touch";
      if (!deck.open && !deck.waiting()) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t && node?.contains(t)) return;
      // A thing that is a link, or a canvas a game points into, says for itself what a press means.
      if (t?.closest("[data-ref], [data-cards]")) return;
      deck.close();
    },
    true,
  );
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || (!deck.open && !deck.waiting())) return;
    // The card took this Escape: a page listening after it should not put anything else away too.
    e.preventDefault();
    const from = deck.open?.from;
    deck.close();
    if (from instanceof HTMLElement && from.isConnected) from.focus({ preventScroll: true });
  });
  window.addEventListener("resize", settle);
  // A passing card goes with the thing it was shown for, as a tip does: taken off the page (a pick chosen, a list drawn again) or left by the mouse.
  goesWith(() => {
    const o = deck.open;
    return o && !o.pinned ? { by: o.from, key: o.via === "key", off: () => deck.close(o.from) } : null;
  });
}
