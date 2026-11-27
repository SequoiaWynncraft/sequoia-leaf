/**
 * Which of the Wilds' rules (`content/wilds.ts`) a room is played under, and the seats it closes.
 * A run of the Wilds keeps the wing it picked a rule for (`Wing`); the rule holds while the run is
 * in that wing, and nowhere else. The run, the fight, the bot and the page all read it from here.
 */
import { type RuleId, WILDS } from "./content/wilds.ts";
import type { FightRule } from "./fight/types.ts";
import { COLS, distance, seatCell, SEATS } from "./hex.ts";
import type { Placed } from "./party.ts";

/** The rule a run picked for a wing. */
export interface Wing {
  rule: RuleId;
  /** Which wing: the room, counting from 0, over `WILDS.wing`. Rooms 6 to 10 are wing 1. */
  at: number;
  /** Under Stumps, the room's stumps, as seats, the same on both halves; none under any other rule. */
  stumps: number[];
}

/** The wing a room is in, counting from 0: rooms 1 to 5 are wing 0. */
export const wingOf = (room: number): number => Math.floor(room / WILDS.wing);
/** The last room of a room's wing, counting from 0. */
export const wingEnd = (room: number): number => (wingOf(room) + 1) * WILDS.wing - 1;

/** The rule the room a run is in is played under, as a fight is set up with it; null for none. */
export function ruleOf(run: { readonly room: number; readonly wing: Wing | null }): FightRule | null {
  const { wing } = run;
  return wing && wing.at === wingOf(run.room) ? { id: wing.rule, stumps: wing.stumps.slice() } : null;
}

/** What a fight set up in the room a run is in adds for its rule (`FightSetup.rule`): the rule, or nothing. */
export function ruleSetup(run: { readonly room: number; readonly wing: Wing | null }): { rule?: FightRule } {
  const rule = ruleOf(run);
  return rule ? { rule } : {};
}

const NONE: ReadonlySet<number> = new Set();
const ALL_SEATS = Array.from({ length: SEATS }, (_, seat) => seat);
/** The seats a rule closes, the same on both halves: Stumps' stumps, Narrow Table's outside columns, Long Table's front row. */
export function closedSeats(rule: FightRule | null | undefined): ReadonlySet<number> {
  if (rule?.id === "stumps") return new Set(rule.stumps);
  if (rule?.id === "narrow") return new Set(ALL_SEATS.filter((s) => WILDS.narrow.some((col) => col === s % COLS)));
  if (rule?.id === "long") return new Set(ALL_SEATS.filter((s) => s < COLS));
  return NONE;
}
/** The seats closed in the room a run is in. */
export const closedNow = (run: { readonly room: number; readonly wing: Wing | null }): ReadonlySet<number> =>
  closedSeats(ruleOf(run));

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
