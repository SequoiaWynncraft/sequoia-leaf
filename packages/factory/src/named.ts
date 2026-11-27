/**
 * What a kept yard names, wherever it names it: the goals it has done, holds, has in line or has
 * given anything; the things it counts, by name, and holds, carries, makes or is told to make, by
 * number; the kinds of its pieces; its plots; and the most tiles any of its tunnels passes under. Its
 * pieces, its blueprints and plans of the whole yard, and what Undo would put back all count.
 *
 * One rule reads it: a yard naming anything this Leaf does not know, or a tunnel longer than this
 * Leaf's longest, is a newer Leaf's (`knownHere`, which `decode` and `keptLater` ask), never read with
 * that thing let go or its Coins paid back. And one writes it: a yard naming nothing past what the
 * last Leaf of version 10 knew (`knownAt10`) is kept so that Leaf reads it.
 */
import type { KeptPiece } from "./cells.ts";
import { historyNamed } from "./history.ts";
import { KNOWN_AT_10 } from "./known10.ts";
import type { KeptBlueprint } from "./prints.ts";
import { goalNamed, isItem, isKind, itemName, itemNamed, kindName, NONE, plotNamed, SPAN_MOST } from "./tables.ts";

/** What a kept yard names, as `keptNames` gathers it. */
export interface KeptNames {
  readonly goals: ReadonlySet<string>;
  /** Things by name (in its counts) and by number (in its pieces). */
  readonly things: ReadonlySet<string>;
  readonly items: ReadonlySet<number>;
  readonly kinds: ReadonlySet<number>;
  readonly plots: ReadonlySet<string>;
  /** The most tiles a tunnel in it passes under, from either mouth. */
  readonly span: number;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Each name a kept count (a record of thing to how many) gives. */
const countNames = (v: unknown): string[] => (isRec(v) ? Object.keys(v) : []);

/** The names a kept yard's own record gives: its goals, its counts' things and its plots. */
function recordNames(raw: Rec, goals: Set<string>, things: Set<string>, plots: Set<string>): void {
  const got = isRec(raw.got) ? raw.got : {};
  for (const id of [...list(raw.done), raw.hand, ...list(raw.queue), ...list(raw.line), ...Object.keys(got)])
    if (typeof id === "string") goals.add(id);
  const seen = isRec(raw.seen) ? raw.seen : {};
  const away = isRec(raw.away) ? raw.away : {};
  const orders = list(raw.board).filter(isRec);
  const counted = [
    raw.depot,
    seen.depot,
    away.made,
    ...Object.values(got),
    ...orders.flatMap((o) => [o.want, o.filled]),
  ];
  for (const c of counted) for (const name of countNames(c)) things.add(name);
  for (const id of list(raw.plots)) if (typeof id === "string") plots.add(id);
}

/** The things a kept piece holds, carries, makes or is told to make, by number. */
const pieceItems = (p: KeptPiece): number[] => [
  ...[p.item, p.out, p.also, p.making, p.recipe].flatMap((n) => (n === undefined ? [] : [n])),
  ...(p.held ?? []).map(([n]) => n),
  ...(p.under ?? []),
];

/** What a kept yard names (its record, its pieces, its blueprints, and its history on a land of so many tiles). */
export function keptNames(
  raw: Rec,
  pieces: readonly KeptPiece[],
  prints: readonly KeptBlueprint[],
  tiles: number,
): KeptNames {
  const [goals, things, plots] = [new Set<string>(), new Set<string>(), new Set<string>()];
  const [items, kinds] = [new Set<number>(), new Set<number>()];
  recordNames(raw, goals, things, plots);
  let span = 0;
  const piece = (kind: number, s: number | undefined, made: readonly (number | undefined)[]): void => {
    kinds.add(kind);
    span = Math.max(span, Math.abs(s ?? 0));
    for (const n of made) if (n !== undefined) items.add(n);
  };
  for (const p of pieces) piece(p.kind, p.span, pieceItems(p));
  for (const b of prints) for (const p of b.pieces ?? []) piece(p.kind, p.span, [p.recipe]);
  for (const p of historyNamed(raw.history, tiles)) piece(p.kind, p.span, [p.recipe]);
  items.delete(NONE);
  return { goals, things, items, kinds, plots, span };
}

const every = <T>(set: ReadonlySet<T>, ok: (v: T) => boolean): boolean => [...set].every(ok);

/** Whether this Leaf knows everything a kept yard names, and runs tunnels as long as its longest. */
export const knownHere = (n: KeptNames): boolean =>
  every(n.goals, (id) => goalNamed(id) !== null) &&
  every(n.things, (name) => itemNamed(name) !== null) &&
  every(n.items, isItem) &&
  every(n.kinds, isKind) &&
  every(n.plots, (id) => plotNamed(id) !== null) &&
  n.span <= SPAN_MOST;

const AT_10 = {
  goals: new Set<string>(KNOWN_AT_10.goals),
  things: new Set<string>(KNOWN_AT_10.items),
  plots: new Set<string>(KNOWN_AT_10.plots),
};

/**
 * Whether the last Leaf of version 10 knew everything a yard (known here) names, each thing and kind
 * by the number it gave it, and ran its tunnels as long.
 */
export const knownAt10 = (n: KeptNames): boolean =>
  every(n.goals, (id) => AT_10.goals.has(id)) &&
  every(n.things, (name) => AT_10.things.has(name)) &&
  every(n.items, (k) => isItem(k) && KNOWN_AT_10.items[k] === itemName(k)) &&
  every(n.kinds, (k) => isKind(k) && KNOWN_AT_10.kinds[k] === kindName(k)) &&
  every(n.plots, (id) => AT_10.plots.has(id)) &&
  n.span <= KNOWN_AT_10.span;
