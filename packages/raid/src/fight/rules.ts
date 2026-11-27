/**
 * What binds a fight (`FightSetup.rules`, `content/rules.ts`), played. A closed hex holds nobody
 * (`CLOSED`): the seats a room closes all fight long, on both halves, so nobody stands on them or
 * walks through them; and those closed only while the parties sit down (Long Table's front rows),
 * until everyone has. Once everyone is seated and their traits are on, a figure with no friend
 * touching it has `alone` percent more attack. No attack reaches further than `reach`
 * (`attackReach`); an ability reaches as far as its figure does (`Unit.range`). Dusk falls at
 * `dusk`. The fight reads these numbers and never which rule set them, and a fight set up with
 * none is played as it always was.
 */
import { type FightRules, ruled } from "../content/rules.ts";
import { CELLS, seatCell, touching } from "../hex.ts";
import { emit } from "./core.ts";
import type { Fight, FightSetup, Unit } from "./types.ts";

/** What a closed hex holds in `Fight.taken`: neither free (-1) nor anybody's number. */
export const CLOSED = -2;

/** What binds a fight set up so: what its room set, and every other number plain. */
export const rulesOf = (setup: Pick<FightSetup, "rules">): FightRules => ruled(setup.rules);

/** The fight hexes of some seats, on both halves. */
const cellsOf = (seats: readonly number[]): number[] => seats.flatMap((s) => [seatCell(0, s), seatCell(1, s)]);
/** The hexes closed all fight long, on both halves. */
export const closedCells = (rules: Pick<FightRules, "closed">): number[] => cellsOf(rules.closed);

/** The board as the parties sit down (`Fight.taken`): every hex free, but those closed and those closed for sitting down. */
export function boardFor(setup: Pick<FightSetup, "rules">): number[] {
  const { closed, closedToSit } = rulesOf(setup);
  const taken = Array.from({ length: CELLS }, () => -1);
  for (const c of cellsOf([...closed, ...closedToSit])) taken[c] = CLOSED;
  return taken;
}

/** What binds a fight (`Fight.wilds`). */
export const wildsOf = (setup: Pick<FightSetup, "rules">): Fight["wilds"] => rulesOf(setup);
/** How far a figure's attacks reach: its own reach, no further than the fight's rules let (Fog). */
export const attackReach = (f: Pick<Fight, "wilds">, u: Pick<Unit, "range">): number =>
  Math.min(u.range, f.wilds.reach);

/**
 * With everyone seated and their traits on, before anybody is summoned: the hexes closed only for
 * sitting down open, and a figure with no friend touching it has `alone` percent more attack (and the
 * fight's opening says so).
 */
export function ruleSeated(f: Fight, setup: Pick<FightSetup, "rules">): void {
  const rules = rulesOf(setup);
  const kept = new Set(closedCells(rules));
  f.taken.forEach((v, c) => {
    if (v === CLOSED && !kept.has(c)) f.taken[c] = -1;
  });
  if (rules.alone <= 0) return;
  const alone = f.units.filter((u) => !f.units.some((o) => o !== u && o.side === u.side && touching(o.cell, u.cell)));
  for (const u of alone) {
    const more = Math.round((u.attack * rules.alone) / 100);
    u.attack += more;
    emit(f, { t: "boost", id: u.id, by: u.id, stat: "attack", amount: more });
  }
}
