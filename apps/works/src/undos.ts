/**
 * What may be undone, as one value moved by one function (`undoStep`): what was done, oldest first,
 * each with how many of its commands Leaf has still to answer (`left`) and whether Undo was pressed
 * for it (`asked`). Undo is pressed for the last thing not yet asked for. Pressed before Leaf has
 * answered, it waits: what it was pressed for is undone once Leaf has done all of it (`due`), the
 * last first. One Leaf turned down is let go, and so is one that no longer stands as it was just
 * after when Leaf's yard is taken; if Undo was pressed for it, a line says why nothing is undone.
 * Nothing here touches the yard: `tools.ts` keeps what each did, and undoes it.
 */
import type { Piece } from "@sequoia-leaf/factory";

export interface Entry<D> {
  /** What was done, as `tools.ts` undoes it. */
  readonly done: D;
  readonly id: number;
  /** The tiles it touched, and what stood on them just after it was done: it is undone only while they stand so. */
  readonly tiles: readonly number[];
  readonly after: readonly Piece[];
  /** How many of its commands Leaf has still to answer. */
  readonly left: number;
  /** Whether Undo was pressed for it. */
  readonly asked: boolean;
}

export type Undos<D> = readonly Entry<D>[];

/** What an entry is, as it is kept or grows: what was done, and what it touched. */
export type Kept<D> = Pick<Entry<D>, "done" | "id" | "tiles" | "after">;

export type UndoEvent<D> =
  /** Something was done, and its command sent: on top. */
  | { readonly do: "keep"; readonly entry: Kept<D> }
  /** An entry grew by one more command sent (a stroke of the brush colouring one more line). */
  | { readonly do: "grow"; readonly entry: Kept<D> }
  /** Leaf's word on one of an entry's commands: done, or turned down. */
  | { readonly do: "heard"; readonly id: number; readonly yes: boolean }
  /** Undo was pressed. */
  | { readonly do: "press" }
  /** Leaf's yard was taken: what no longer stands as it was just after is let go. */
  | { readonly do: "took"; readonly holds: (e: Entry<D>) => boolean }
  /** An entry was taken off to be undone now (`due`). */
  | { readonly do: "undone"; readonly id: number };

/** The value after an event, and what the line over the dock says of it, if anything. */
export interface Stepped<D> {
  readonly undos: Undos<D>;
  readonly said: string | null;
}

/** How many things done are kept to be undone. */
export const KEPT = 60;

export const NOTHING = "Nothing to undo.";
export const NOT_DONE = "Nothing to undo: the guild's server did not do it.";
export const CHANGED = "Cannot undo: it has changed since.";

const same = <D>(undos: Undos<D>): Stepped<D> => ({ undos, said: null });

export function undoStep<D>(s: Undos<D>, e: UndoEvent<D>): Stepped<D> {
  switch (e.do) {
    case "keep":
      return same([...s, { ...e.entry, left: 1, asked: false }].slice(-KEPT));
    case "grow":
      return same(s.map((u) => (u.id === e.entry.id ? { ...u, ...e.entry, left: u.left + 1 } : u)));
    case "heard": {
      const u = s.find((v) => v.id === e.id);
      if (!u) return same(s);
      if (e.yes) return same(s.map((v) => (v === u ? { ...v, left: Math.max(0, v.left - 1) } : v)));
      return { undos: s.filter((v) => v !== u), said: u.asked ? NOT_DONE : null };
    }
    case "press": {
      const u = s.findLast((v) => !v.asked);
      if (!u) return { undos: s, said: NOTHING };
      return same(s.map((v) => (v === u ? { ...v, asked: true } : v)));
    }
    case "took": {
      const kept = s.filter(e.holds);
      const lost = s.some((v) => v.asked && !kept.includes(v));
      return { undos: kept.length === s.length ? s : kept, said: lost ? CHANGED : null };
    }
    case "undone":
      return same(s.filter((v) => v.id !== e.id));
  }
}

/**
 * What is to be undone now: the last thing Undo was pressed for, once Leaf has done all of it. While
 * Leaf has still to answer for it, nothing is, so what was pressed for is undone the last first.
 */
export function due<D>(s: Undos<D>): Entry<D> | undefined {
  const u = s.findLast((v) => v.asked);
  return u && u.left === 0 ? u : undefined;
}
