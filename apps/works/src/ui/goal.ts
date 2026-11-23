/**
 * What a goal shows, wherever it is shown: its head (its picture in a slot, then its name), and each
 * list of things on it: what it wants, what it needs first, what it unlocks, what it leaves in town.
 * A goal is a lesson, a project, a commission or a piece of research.
 *
 * This is the one place a head or such a list is laid out. A list is a label on a line of its own
 * and, under it, a row for each thing: the thing's picture in a slot of one width, its name, and at
 * the right edge what is counted of it (a bar and `8 / 12`, or a few words, or the button that
 * begins it, or nothing). A long name wraps inside its own column and nothing else moves. Each row
 * is a thing that explains itself: its picture and name are its card's, and pointing at it or
 * tapping it shows the card. Everything on the page that shows a goal calls these (the tier's
 * screen, Orders, the corner, the sheet for a goal finished, research, a goal's own card), and a
 * test (`goal.test.ts`) holds the rest of the page to laying none out by hand.
 *
 * Like `cards.ts`, this draws and reaches no yard: what it shows of one is handed in, as printed
 * values or as a way to ask (a bar kept up to date between drawings). What a goal unlocks is the
 * rules' one list of it (`unlockedBy`): nothing here, or anywhere on the page, reads a field of an
 * `Unlocks`.
 */
import {
  ALL_ITEMS,
  type Counts,
  type Goal,
  GOALS,
  isNode,
  type Item,
  NODES,
  type Unlock,
  unlockedBy,
} from "@sequoia-leaf/factory";
import { describe, link } from "@sequoia-leaf/kit/card.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";

import { fitted, pic } from "./parts.ts";
import { giftRef, itemRef, nodeRef, pictureRef, tierRef, unlockRef } from "./refs.ts";

/** How many pixels of a picture a row's slot shows, and a head's. */
const SLOT = { row: 14, head: 18 } as const;

// ---------- pictures ----------

/**
 * A thing's picture, as its card has it, for a slot `size` pixels of the picture across: shown
 * twice the size where it is small enough to fit so, and cut to the slot where it is larger (a tall
 * machine is known by its head). Nothing for a thing with no card.
 */
function pictureOf(ref: string | null, size: number): Node | null {
  const art = ref === null ? null : (describe(ref)?.icon ?? null);
  if (art instanceof HTMLCanvasElement)
    return Math.max(art.width, art.height) * 2 <= size ? pic(art, 2) : fitted(art, size, size);
  return art instanceof Element ? art.cloneNode(true) : null;
}

// ---------- a list ----------

/** How many have come, of how many. */
export interface Count {
  readonly have: number;
  readonly of: number;
}

/** A thing in a list, and what is counted of it. */
interface Line {
  /** The thing: its picture, its name and its card. */
  readonly ref: string;
  /** Its name here, where that is not its card's. */
  readonly name?: string;
  /** How many have come of how many, asked each time the list is brought up to date: a bar and the two numbers. */
  readonly count?: () => Count;
  /** Or a few words: a number that will be, how a thing stands. */
  readonly note?: string;
  /** Or the button that begins it. */
  readonly act?: HTMLElement | null;
  /** A sentence, not a name: set in the face sentences are read in. */
  readonly read?: boolean;
  /** Reached, done or known: picked out. */
  readonly lit?: boolean;
}

/** A list on the page, and the way to bring its counts up to date without building it again. */
export interface Listed {
  readonly node: HTMLElement;
  readonly update: () => void;
}

/**
 * A label and its rows of things. With no label (the corner, whose own first line says what the rows
 * are of) there is none; with `names` off (the corner again, where a row is its picture, its bar and
 * its count) a row has no name and is not a link, for it sits inside something that is pressed.
 */
function list(label: string | null, lines: readonly Line[], opts: { readonly names?: boolean } = {}): Listed {
  const names = opts.names ?? true;
  const live: (() => void)[] = [];
  const rows = lines.map((line) => {
    const said = describe(line.ref);
    const name = line.name ?? said?.name ?? "";
    const what = el(
      "span",
      "gl-what",
      names ? {} : { title: name },
      el("span", "gl-pic", {}, pictureOf(line.ref, SLOT.row)),
      names ? el("span", line.read ? "gl-name k-read" : "gl-name", { text: name }) : null,
    );
    if (names) link(what, line.ref);
    const end = el("span", "gl-end");
    const count = line.count;
    if (count) {
      const fill = el("i");
      const bar = el("div", "k-bar", {}, fill);
      const n = el("span", "gl-n");
      end.append(bar, n);
      live.push(() => {
        const { have, of } = count();
        const got = Math.min(have, of);
        fill.style.setProperty("--v", `${of > 0 ? (got / of) * 100 : 0}%`);
        n.textContent = `${got.toLocaleString("en-US")} / ${of.toLocaleString("en-US")}`;
        bar.classList.toggle("leaf", got >= of);
      });
    } else if (line.act) end.append(line.act);
    else if (line.note) end.append(el("span", line.lit ? "gl-note lit" : "gl-note", { text: line.note }));
    return el("div", line.lit ? "gl-row lit" : "gl-row", {}, what, end);
  });
  const update = (): void => {
    for (const f of live) f();
  };
  update();
  return {
    node: el(
      "div",
      names ? "gl" : "gl tight",
      {},
      label === null ? null : el("div", "k-label", { text: label }),
      ...rows,
    ),
    update,
  };
}

/** A list, or nothing where it would have no rows. */
const listed = (label: string | null, lines: readonly Line[], names = true): Listed | null =>
  lines.length === 0 ? null : list(label, lines, { names });
/** The lists that have rows, of those asked for. */
export const some = (...lists: readonly (Listed | null)[]): Listed[] => lists.flatMap((l) => (l ? [l] : []));

// ---------- what a goal wants ----------

/** Each thing wanted, with how many of it: as a screen prints what an order or a goal wants. */
export type Wants = readonly (readonly [Item, number])[];
/** Each thing wanted, with how many have come (no more than are wanted) of how many: as a card prints it. */
export type Given = readonly (readonly [Item, number, number])[];

/** What is wanted, read out of the rules' counts. */
export const wantsIn = (want: Counts): Wants =>
  ALL_ITEMS.filter((k) => (want[k] ?? 0) > 0).map((k) => [k, want[k] ?? 0] as const);
/** What is wanted and what has come of it, read out of the rules' counts. */
export const givenIn = (want: Counts, got: Counts | null): Given =>
  wantsIn(want).map(([k, of]) => [k, Math.min(got?.[k] ?? 0, of), of] as const);

/**
 * What an order or a goal wants, each thing with a bar that is kept up to date: `got` is asked each
 * time the list is brought up to date, so the bars are never behind the yard and the list is not
 * built again for a thing delivered.
 */
export const wants = (want: Wants, got: () => Counts | null): Listed | null =>
  listed(
    "Wants",
    want.map(([k, of]): Line => ({ ref: itemRef(k), count: () => ({ have: got()?.[k] ?? 0, of }) })),
  );

const givenLines = (given: Given): Line[] =>
  given.map(([k, have, of]): Line => ({ ref: itemRef(k), count: () => ({ have, of }) }));

/** The same from what a card prints: as many as had come when it was printed. */
export const wantsGiven = (given: Given): Listed | null => listed("Wants", givenLines(given));

/** The same in the corner: no label, and each row its picture, its bar and its count. */
export const wantsShort = (given: Given): Listed | null => listed(null, givenLines(given), false);

// ---------- what a goal needs first ----------

/** How a goal that another waits on stands. */
export type Stands = "done" | "known" | "in hand" | "being studied" | "in the line" | "not begun";
/** What begins a goal another waits on: a node taken in hand, research put in the line, or a Study built for it. */
export type Begin = "take" | "study" | "build";

/** A goal another needs first, as printed: how it stands, and for the one that leads on, what begins it. */
export interface Need {
  readonly goal: Goal;
  readonly stands: Stands;
  readonly begin?: Begin;
}

/**
 * What a goal needs done or known first, each as a thing with how it stands: in a word or two, or
 * for the one being studied a bar and its count (`given`, asked each time the list is brought up to
 * date). A need printed with what begins it carries the button `begin` makes for it, so that a screen
 * leads on.
 */
export function needs(
  all: readonly Need[],
  opts: {
    readonly given?: (g: Goal) => Count;
    readonly begin?: (g: Goal, how: Begin) => HTMLElement;
  } = {},
): Listed | null {
  return listed(
    "Needs",
    all.map((n): Line => {
      const ref = nodeRef(n.goal);
      if (n.begin !== undefined && opts.begin) return { ref, act: opts.begin(n.goal, n.begin) };
      const given = opts.given;
      if (n.stands === "being studied" && given) return { ref, count: () => given(n.goal) };
      return { ref, note: n.stands, lit: n.stands === "done" || n.stands === "known" };
    }),
  );
}

// ---------- what a goal unlocks, and leaves ----------

/** A thing unlocked, as a row: its own card, with the number beside it where it is a number, or a plot's price. */
function unlockLine(u: Unlock): Line {
  const amount = "amount" in u ? u.amount : undefined;
  const note = u.is === "plot" ? `${u.price.toLocaleString("en-US")} Coins` : amount;
  // A grade and a number are called what the rules call them, not what the piece they change is called.
  const named = u.is === "grade" || u.is === "number" || u.is === "blueprints";
  if (named)
    return note === undefined ? { ref: unlockRef(u), name: u.name } : { ref: unlockRef(u), name: u.name, note };
  return note === undefined ? { ref: unlockRef(u) } : { ref: unlockRef(u), note };
}

/**
 * What a goal unlocks, each as a thing with its picture and its card. A commission also opens the
 * next tier, which is the last row: by its number alone until it is open.
 */
export function unlocks(g: Goal): Listed | null {
  const info = GOALS[g];
  const next = info?.kind === "commission" ? [{ ref: tierRef(info.tier + 1) }] : [];
  return listed("Unlocks", [...unlockedBy(g).map(unlockLine), ...next]);
}

/** What a finished goal leaves in the town, in the words its table has for it. */
export function leaves(g: Goal): Listed | null {
  const gift = isNode(g) ? NODES[g]?.gift : undefined;
  return gift ? listed("Leaves in town", [{ ref: giftRef(g), name: gift.line, read: true }]) : null;
}

/** Goals as rows under a label, each its picture and its name: the research that became known while away. */
export const goals = (label: string, these: readonly Goal[]): Listed | null =>
  listed(
    label,
    these.map((g): Line => ({ ref: nodeRef(g) })),
  );

// ---------- a goal's head ----------

/**
 * A goal's head: its picture in a slot, a gap, its name, and at the right what is to be done with it
 * (a button, a mark) or nothing. The picture and the name open the goal's card. Every head has this
 * one layout, so names begin at the same left edge from row to row whatever their length.
 */
export function head(g: Goal, side: Node | null = null): HTMLElement {
  const info = GOALS[g];
  const what = el(
    "span",
    "gh-what",
    {},
    el("span", "gh-pic k-slot", {}, pictureOf(pictureRef(g), SLOT.head)),
    el("span", "gh-name k-name", { text: info?.title ?? "" }),
  );
  link(what, nodeRef(g));
  return el("div", "gh", { "data-goal": info?.id ?? "" }, what, side);
}
