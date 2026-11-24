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
 * tapping it shows the card. What a goal wants has no label: it is the rows with bars under its
 * head. A goal that is not open shows each thing it wants behind a lock, with the number wanted and
 * no bar, for nothing counts toward it yet, and what opens it as a count beside a lock (`lockChip`).
 * Everything on the page that shows a goal calls these (the tier's screen, Orders, the corner, the
 * sheet for a goal finished, research, a goal's own card), and a test (`goal.test.ts`) holds the
 * rest of the page to laying none out by hand.
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
import { el, icon } from "@sequoia-leaf/kit/dom.ts";

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
  /** Or the number wanted behind a lock, with no bar: the goal is not open, and nothing counts toward it yet. */
  readonly locked?: number;
}

/** A list on the page, and the way to bring its counts up to date without building it again. */
export interface Listed {
  readonly node: HTMLElement;
  readonly update: () => void;
}

/**
 * A label and its rows of things. With no label (what a goal wants, the first rows under its head)
 * there is none; with `names` off (the corner and an order, where a row is its picture, its bar and
 * its count) a row has no name, and with `links` off it is not a link either, for it sits inside
 * something that is pressed (the corner).
 */
function list(
  label: string | null,
  lines: readonly Line[],
  opts: { readonly names?: boolean; readonly links?: boolean } = {},
): Listed {
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
    if (opts.links ?? names) link(what, line.ref);
    const end = el("span", "gl-end");
    const count = line.count;
    if (line.locked !== undefined) end.append(icon("lock"), el("span", "gl-n", { text: num(line.locked) }));
    else if (count) {
      const fill = el("i");
      const bar = el("div", "k-bar", {}, fill);
      const counted = el("span", "gl-n");
      end.append(bar, counted);
      live.push(() => {
        const { have, of } = count();
        const got = Math.min(have, of);
        fill.style.setProperty("--v", `${of > 0 ? (got / of) * 100 : 0}%`);
        counted.textContent = `${num(got)} / ${num(of)}`;
        bar.classList.toggle("leaf", got >= of);
      });
    } else if (line.act) end.append(line.act);
    else if (line.note) end.append(el("span", line.lit ? "gl-note lit" : "gl-note", { text: line.note }));
    return el("div", `gl-row${line.lit ? " lit" : ""}${line.locked === undefined ? "" : " locked"}`, {}, what, end);
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

/** A number as a list shows it: "1,200". */
const num = (v: number): string => v.toLocaleString("en-US");

/** A list, or nothing where it would have no rows. */
const listed = (
  label: string | null,
  lines: readonly Line[],
  opts: { readonly names?: boolean; readonly links?: boolean } = {},
): Listed | null => (lines.length === 0 ? null : list(label, lines, opts));
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
 * What a goal wants, each thing with a bar that is kept up to date: `got` is asked each time the
 * list is brought up to date, so the bars are never behind the yard and the list is not built again
 * for a thing delivered. It has no label: the rows with bars under a goal's head are what it wants.
 * A goal that is not open (`locked`) shows each thing with a lock and the number wanted, and no bar.
 */
export const wants = (want: Wants, got: () => Counts | null, locked = false): Listed | null =>
  listed(
    null,
    want.map(([k, of]): Line =>
      locked ? { ref: itemRef(k), locked: of } : { ref: itemRef(k), count: () => ({ have: got()?.[k] ?? 0, of }) },
    ),
  );

const givenLines = (given: Given, locked = false): Line[] =>
  given.map(([k, have, of]): Line =>
    locked ? { ref: itemRef(k), locked: of } : { ref: itemRef(k), count: () => ({ have, of }) },
  );

/** The same from what a card prints: as many as had come when it was printed. */
export const wantsGiven = (given: Given, locked = false): Listed | null => listed(null, givenLines(given, locked));

/** The same in the corner: each row its picture, its bar and its count, and nothing in it pressed. */
export const wantsShort = (given: Given): Listed | null =>
  listed(null, givenLines(given), { names: false, links: false });

/**
 * What an order wants, kept up to date as `wants` is: each row its picture, its bar and its count, for
 * the order's title names the things. The picture shows the thing's card.
 */
export const wantsOrder = (want: Wants, got: () => Counts | null): Listed | null =>
  listed(
    null,
    want.map(([k, of]): Line => ({ ref: itemRef(k), count: () => ({ have: got()?.[k] ?? 0, of }) })),
    { names: false, links: true },
  );

/** What opens a goal that is not open, as a count beside a lock: "9 research left". */
export const lockChip = (words: string): HTMLElement => el("span", "k-chip", {}, icon("lock"), words);

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

/** Things as rows under a label, each its picture, its name and a number at the right: what the depot took in while away. */
export const counted = (label: string, these: readonly (readonly [ref: string, note: string])[]): Listed | null =>
  listed(
    label,
    these.map(([ref, note]): Line => ({ ref, note })),
  );

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
 * one layout, so names begin at the same left edge from row to row whatever their length. A card
 * that folds (`folds.ts`) has its fold after the side, the two together, so that where the head is
 * narrow they go under the name together.
 */
export function head(g: Goal, side: Node | null = null, fold: Node | null = null): HTMLElement {
  const info = GOALS[g];
  const what = el(
    "span",
    "gh-what",
    {},
    el("span", "gh-pic k-slot", {}, pictureOf(pictureRef(g), SLOT.head)),
    el("span", "gh-name k-name", { text: info?.title ?? "" }),
  );
  link(what, nodeRef(g));
  const end = fold === null ? side : el("span", "gh-side", {}, side, fold);
  return el("div", "gh", { "data-goal": info?.id ?? "" }, what, end);
}

/** How a node is spoken of: "Lesson 2 of 4", "Tier 1 project", "Tier 1 commission". */
export function nodeKind(g: Goal): string {
  const info = GOALS[g];
  if (!info) return "";
  if (info.kind !== "lesson") return `Tier ${info.tier} ${info.kind}`;
  const lessons = GOALS.flatMap((o, k) => (o.kind === "lesson" ? [k] : []));
  return `Lesson ${lessons.indexOf(g) + 1} of ${lessons.length}`;
}

/**
 * A node on a card picked out in gold, as the tier's screen shows its commission and Orders the node
 * in hand: what kind of node it is and who asks, small; its head; its lists; and last and quietest,
 * what they say.
 */
export function goalCard(g: Goal, side: Node | null, lists: readonly Listed[]): HTMLElement {
  const node = NODES[g];
  return el(
    "div",
    "k-card lit goal",
    {},
    el("div", "k-label", { text: node ? `${nodeKind(g)} · from ${node.from}` : nodeKind(g) }),
    head(g, side),
    ...lists.map((l) => l.node),
    node ? el("div", "k-d", { text: node.say }) : null,
  );
}
