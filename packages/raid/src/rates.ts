/** How often fights are won, for the reports on the rules (`review/balance.ts`, Leaf's `raid-stats.ts`). */
import { ROOM_COUNT, TRAIL_COUNT } from "./content/rooms.ts";

/** Where a fight was fought, as a `Tally` keeps it: its room on its trail. */
export const placeOf = (trail: number, room: number): number => trail * ROOM_COUNT + room;

/**
 * Fights won and tried, kept by where each was fought (`placeOf`), so that what turns up only in hard
 * rooms is not held against it: `expected` is the rate the same places are won at by everyone.
 */
export class Tally {
  won = 0;
  tried = 0;
  readonly at = Array.from({ length: ROOM_COUNT * TRAIL_COUNT }, () => ({ won: 0, tried: 0 }));
  add(win: boolean, place = 0): void {
    this.tried++;
    if (win) this.won++;
    const at = this.at[place];
    if (at) {
      at.tried++;
      if (win) at.won++;
    }
  }
  get rate(): number {
    return this.tried === 0 ? 0 : this.won / this.tried;
  }
  /** The rate at each place. */
  get rates(): number[] {
    return this.at.map((at) => (at.tried === 0 ? 0 : at.won / at.tried));
  }
  /** The rate these fights would have been won at if this made no difference: each place's own rate, weighted by how often it was seen there. */
  expected(rates: readonly number[]): number {
    if (this.tried === 0) return 0;
    let sum = 0;
    this.at.forEach((at, i) => (sum += at.tried * (rates[i] ?? 0)));
    return sum / this.tried;
  }
  /** Where the rate lies, 95 times in 100 (Wilson's interval). */
  get interval(): [number, number] {
    const n = this.tried;
    if (n === 0) return [0, 1];
    const z = 1.96;
    const p = this.won / n;
    const d = 1 + (z * z) / n;
    const mid = (p + (z * z) / (2 * n)) / d;
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return [Math.max(0, mid - half), Math.min(1, mid + half)];
  }
}
