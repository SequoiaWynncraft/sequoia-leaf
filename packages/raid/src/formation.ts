/**
 * Where to stand: a plain, sensible way of seating a party on its half of the board. The bot uses
 * it, and so do the sparring partners. Sturdy close fighters go in the front row from the middle
 * out, anyone with reach goes behind them in the row its reach is for (`standRow`), and Sneaks that
 * are going to leap anyway wait at the back corners. Seqwawa, who never attacks, has the reach of
 * the back row, and stays there. A figure whose release says where it would rather sit (`stands`)
 * sits there instead: one that sits touching (`touching`, Huddle) moves to the free seat touching the
 * most figures of its origin, so that they start the fight in one group round the frontmost of them.
 */
import type { Catalog } from "./content/catalog.ts";
import { type FigureId, figureIn } from "./content/figures.ts";
import { KINS, type TraitId } from "./content/traits.ts";
import { besideOf, COLS, HOME_ROWS, standRow } from "./hex.ts";

/** Columns from the middle out. */
const MIDDLE_OUT = [3, 2, 4, 1, 5, 0, 6] as const;
const NONE: ReadonlySet<number> = new Set();
/** Where a column comes from the middle out. */
const middleRank = (col: number): number => MIDDLE_OUT.findIndex((c) => c === col);
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
      .filter((i) => spec(i).rooted !== true && spec(i).stands !== "room")
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
  for (const i of far.filter((f) => spec(f).stands === "room")) {
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
  for (const i of everyone.filter((f) => spec(f).stands === "mana")) {
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
  sitTouching(cat, party, seats, taken, free);
  return seats;
}

/** A figure's origins: its kin, and a kin it carries as a third trait (Larp's Huddle). */
function originsOf(cat: Catalog, kind: FigureId): TraitId[] {
  const f = figureIn(cat, kind);
  return [f.kin, ...f.extra].filter((t) => KINS.some((k) => k === t));
}
/**
 * Those who sit touching move, frontmost first, to the free seat touching the most of those of their
 * origin already where they will stay; the first of an origin stays where it sat, and so does one
 * already touching one of its own. Ties go to the row its reach gives, then to the middle.
 */
function sitTouching(
  cat: Catalog,
  party: readonly Standing[],
  seats: number[],
  taken: Set<number>,
  free: (seat: number) => boolean,
): void {
  const kind = (i: number): FigureId => party[i]?.kind ?? "rock";
  const movers = party
    .map((_, i) => i)
    .filter((i) => figureIn(cat, kind(i)).stands === "touching" && (seats[i] ?? -1) >= 0)
    .toSorted((a, b) => Math.floor((seats[a] ?? 0) / COLS) - Math.floor((seats[b] ?? 0) / COLS) || a - b);
  const settled: number[] = [];
  const allOf = (origins: readonly TraitId[]): number[] =>
    settled.filter((j) => originsOf(cat, kind(j)).some((t) => origins.includes(t))).map((j) => seats[j] ?? -1);
  for (const i of movers) {
    const was = seats[i] ?? -1;
    const own = allOf(originsOf(cat, kind(i)));
    const touches = (seat: number): number => besideOf(seat).filter((s) => own.includes(s)).length;
    settled.push(i);
    if (own.length === 0 || touches(was) > 0) continue;
    const home = standRow(figureIn(cat, kind(i)).range);
    const best = Array.from({ length: HOME_ROWS * COLS }, (_, n) => n)
      .filter((seat) => free(seat) && touches(seat) > 0)
      .toSorted(
        (a, b) =>
          touches(b) - touches(a) ||
          Math.abs(Math.floor(a / COLS) - home) - Math.abs(Math.floor(b / COLS) - home) ||
          middleRank(a % COLS) - middleRank(b % COLS),
      )[0];
    if (best === undefined) continue;
    taken.delete(was);
    taken.add(best);
    seats[i] = best;
  }
}
