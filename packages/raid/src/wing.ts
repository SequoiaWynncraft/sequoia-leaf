/**
 * The rule a run of the Wilds picked for a wing (`Wing`), and which rooms a wing is. The rule holds
 * while the run is in that wing, and nowhere else; `room.ts` is the only reader of it (`roomOf`),
 * and what it sets is the rule's row (`content/rules.ts`). Seating round the seats a room closes is
 * here too (`nearestOpen`, `seatOpen`).
 */
import { type RuleId, WILDS } from "./content/wilds.ts";
import { distance, seatCell, SEATS } from "./hex.ts";
import type { Placed } from "./party.ts";

/** The rule a run picked for a wing. */
export interface Wing {
  rule: RuleId;
  /** Which wing: the room, counting from 0, over `WILDS.wing`. Rooms 6 to 10 are wing 1. */
  at: number;
  /** What the rule drew for the room the run is in (`RuleRow.draws`): under Stumps its stumps, as seats, the same on both halves; none under any other rule. */
  stumps: number[];
}

/** The wing a room is in, counting from 0: rooms 1 to 5 are wing 0. */
export const wingOf = (room: number): number => Math.floor(room / WILDS.wing);
/** The last room of a room's wing, counting from 0. */
export const wingEnd = (room: number): number => (wingOf(room) + 1) * WILDS.wing - 1;

const ALL_SEATS = Array.from({ length: SEATS }, (_, seat) => seat);

/** The open seat nearest a seat on its own half that `free` says is empty: fewest hex steps, then the first; -1 for none. */
export function nearestOpen(seat: number, closed: ReadonlySet<number>, free: (seat: number) => boolean): number {
  let best = -1;
  let bestAway = Infinity;
  for (const s of ALL_SEATS) {
    if (closed.has(s) || !free(s)) continue;
    const away = distance(seatCell(0, seat), seatCell(0, s));
    if (away < bestAway) {
      best = s;
      bestAway = away;
    }
  }
  return best;
}

/** A party's figures with everyone on a closed seat moved to the nearest open one (`nearestOpen`), in the order they are listed. */
export function seatOpen(figures: readonly Placed[], closed: ReadonlySet<number>): Placed[] {
  const taken = new Set(figures.flatMap((p) => (closed.has(p.seat) ? [] : [p.seat])));
  return figures.map((p) => {
    if (!closed.has(p.seat)) return p;
    const to = nearestOpen(p.seat, closed, (s) => !taken.has(s));
    if (to < 0) return p;
    taken.add(to);
    return { ...p, seat: to };
  });
}
