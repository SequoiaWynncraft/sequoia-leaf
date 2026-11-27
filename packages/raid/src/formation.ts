/**
 * Where to stand: a plain, sensible way of seating a party on its half of the board. The bot uses
 * it, and so do the sparring partners. Sturdy close fighters go in the front row from the middle
 * out, anyone with reach goes behind them in the row its reach is for (`standRow`), and Sneaks that
 * are going to leap anyway wait at the back corners.
 */
import { type FigureId, FIGURES } from "./content/figures.ts";
import { COLS, HOME_ROWS, standRow } from "./hex.ts";

/** Columns from the middle out. */
const MIDDLE_OUT = [3, 2, 4, 1, 5, 0, 6] as const;
const NONE: ReadonlySet<number> = new Set();
/** Columns from the edges in. */
const EDGES_IN = [0, 6, 1, 5, 2, 4, 3] as const;

export interface Standing {
  kind: FigureId;
  /** Health with stars counted in, for who goes in front. */
  health: number;
}

/**
 * A seat for each of a party, in the order given. `leaping` says whether its Sneaks will leap when
 * the fight starts; if not, they line up with the other close fighters. Nobody sits on a seat a
 * Wilds rule has `closed` (`wing.ts`).
 */
export function arrange(party: readonly Standing[], leaping: boolean, closed: ReadonlySet<number> = NONE): number[] {
  const seats = party.map(() => -1);
  const taken = new Set<number>();
  const sit = (who: number, row: number, cols: readonly number[]): boolean => {
    for (const col of cols) {
      const seat = row * COLS + col;
      if (taken.has(seat) || closed.has(seat)) continue;
      taken.add(seat);
      seats[who] = seat;
      return true;
    }
    return false;
  };
  /** Sits somebody in the first of some rows that has room. */
  const sitIn = (who: number, rows: readonly number[], cols: readonly number[]): void => {
    for (const row of rows) if (sit(who, row, cols)) return;
    for (let row = 0; row < HOME_ROWS; row++) if (sit(who, row, cols)) return;
  };
  const spec = (i: number) => FIGURES[party[i]?.kind ?? "rock"];
  const health = (i: number): number => party[i]?.health ?? 0;
  const everyone = party.map((_, i) => i);
  const isSneak = (i: number): boolean => leaping && spec(i).calling === "sneak";
  const close = everyone
    .filter((i) => spec(i).range <= 1 && !isSneak(i))
    .toSorted(
      (a, b) =>
        Number(spec(b).calling === "bulwark") - Number(spec(a).calling === "bulwark") || health(b) - health(a) || a - b,
    );
  const sneaks = everyone.filter(isSneak);
  const far = everyone
    .filter((i) => spec(i).range > 1)
    .toSorted((a, b) => spec(a).range - spec(b).range || health(b) - health(a) || a - b);
  // With nobody to stand in front, the sturdiest of the rest does.
  if (close.length === 0 && far.length > 1) {
    const sturdiest = far.toSorted((a, b) => health(b) - health(a) || a - b)[0];
    if (sturdiest !== undefined) {
      far.splice(far.indexOf(sturdiest), 1);
      close.push(sturdiest);
    }
  }
  for (const i of close) sitIn(i, [0, 1], MIDDLE_OUT);
  // Each as far back as it still reaches from, as its card says; a full row spills one forward.
  for (const i of far) sitIn(i, [standRow(spec(i).range), standRow(spec(i).range) - 1], MIDDLE_OUT);
  for (const i of sneaks) sitIn(i, [3, 2], EDGES_IN);
  return seats;
}
