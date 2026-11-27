/**
 * Where to stand: a plain, sensible way of seating a party on its half of the board. The bot uses
 * it, and so do the sparring partners. Sturdy close fighters go in the front row from the middle
 * out, anyone with reach goes behind them in the row its reach is for (`standRow`), and Sneaks that
 * are going to leap anyway wait at the back corners. Seqwawa, who never attacks, has the reach of
 * the back row, and stays there.
 */
import type { Catalog } from "./content/catalog.ts";
import { type FigureId, figureIn } from "./content/figures.ts";
import { besideOf, COLS, HOME_ROWS, standRow } from "./hex.ts";

/** Columns from the middle out. */
const MIDDLE_OUT = [3, 2, 4, 1, 5, 0, 6] as const;
const NONE: ReadonlySet<number> = new Set();
/** Columns from the edges in. */
const EDGES_IN = [0, 6, 1, 5, 2, 4, 3] as const;
/**
 * Figures that sit for what their ability does, not only for their reach: beside the two friends
 * with the dearest mana bars, to give them mana (`mana`), or with two free seats beside them for
 * what they call (`room`).
 */
const SITS: Readonly<Partial<Record<FigureId, "mana" | "room">>> = { crab31: "mana", commodore: "room" };

export interface Standing {
  kind: FigureId;
  /** Health with stars counted in, for who goes in front. */
  health: number;
}

/**
 * A seat for each of a party, in the order given. `leaping` says whether its Sneaks will leap when
 * the fight starts; if not, they line up with the other close fighters. Nobody sits on a seat a
 * room closes (`closed`, `room.ts`).
 */
export function arrange(
  cat: Catalog,
  party: readonly Standing[],
  leaping: boolean,
  closed: ReadonlySet<number> = NONE,
): number[] {
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
  const spec = (i: number) => figureIn(cat, party[i]?.kind ?? "rock");
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
  // With nobody to stand in front, the sturdiest of the rest does: never one rooted to its hex (Seqwawa), which cannot go to anybody, nor one who calls others to him (the Commodore).
  if (close.length === 0 && far.length > 1) {
    const sturdiest = far
      .filter((i) => spec(i).rooted !== true && SITS[party[i]?.kind ?? "rock"] !== "room")
      .toSorted((a, b) => health(b) - health(a) || a - b)[0];
    if (sturdiest !== undefined) {
      far.splice(far.indexOf(sturdiest), 1);
      close.push(sturdiest);
    }
  }
  const free = (seat: number): boolean => !taken.has(seat) && !closed.has(seat);
  // One who calls others sits first, as far back as it reaches from, where two seats beside it are
  // free, and they are kept free while the rest sit down.
  const kept: number[] = [];
  for (const i of far.filter((f) => SITS[party[f]?.kind ?? "rock"] === "room")) {
    const rows = [standRow(spec(i).range), standRow(spec(i).range) - 1];
    const seat = rows
      .flatMap((row) => MIDDLE_OUT.map((col) => row * COLS + col))
      .find((s) => free(s) && besideOf(s).filter(free).length >= 2);
    if (seat === undefined) continue;
    taken.add(seat);
    seats[i] = seat;
    for (const s of besideOf(seat).filter(free).slice(0, 2)) {
      taken.add(s);
      kept.push(s);
    }
  }
  for (const i of close) sitIn(i, [0, 1], MIDDLE_OUT);
  // Each as far back as it still reaches from, as its card says; a full row spills one forward.
  for (const i of far)
    if (seats[i] === -1) sitIn(i, [standRow(spec(i).range), standRow(spec(i).range) - 1], MIDDLE_OUT);
  for (const i of sneaks) sitIn(i, [3, 2], EDGES_IN);
  for (const s of kept) taken.delete(s);
  // One who gives mana moves to the free seat touching the most of the two dearest mana bars, the furthest back of those.
  for (const i of everyone.filter((f) => SITS[party[f]?.kind ?? "rock"] === "mana")) {
    const dearest = new Set(
      everyone
        .filter((f) => f !== i && spec(f).mana[1] > 0)
        .toSorted((a, b) => spec(b).mana[1] - spec(a).mana[1] || a - b)
        .slice(0, 2)
        .map((f) => seats[f] ?? -1),
    );
    const touches = (seat: number): number => besideOf(seat).filter((s) => dearest.has(s)).length;
    const was = seats[i] ?? -1;
    taken.delete(was);
    const best = Array.from({ length: HOME_ROWS * COLS }, (_, n) => {
      const row = HOME_ROWS - 1 - Math.floor(n / COLS);
      return row * COLS + (MIDDLE_OUT[n % COLS] ?? 0);
    })
      .filter((seat) => free(seat))
      .reduce((top, seat) => (touches(seat) > touches(top) ? seat : top), was);
    taken.add(best);
    seats[i] = best;
  }
  return seats;
}
