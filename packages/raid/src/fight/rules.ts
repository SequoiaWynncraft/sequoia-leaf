/**
 * The Wilds' rules in a fight (`FightSetup.rule`, `content/wilds.ts`). A closed hex holds nobody
 * (`CLOSED`): Stumps' stumps and Narrow Table's columns all fight long, so nobody stands on them or
 * walks through them; Long Table's front rows only while the parties sit down. Once everyone is
 * seated and their traits are on, a figure with no friend touching it has Elbow Room's attack, and
 * under Fog nobody reaches further than its number. Dusk falls when the rule says. A fight set up
 * with no rule is played as it always was.
 */
import { FIGHT } from "../content/rooms.ts";
import { WILDS } from "../content/wilds.ts";
import { CELLS, colOf, seatCell, touching } from "../hex.ts";
import { closedSeats } from "../wing.ts";
import { emit } from "./core.ts";
import type { Fight, FightRule, FightSetup } from "./types.ts";

/** What a closed hex holds in `Fight.taken`: neither free (-1) nor anybody's number. */
export const CLOSED = -2;

const ALL_CELLS = Array.from({ length: CELLS }, (_, cell) => cell);
/** The hexes a rule keeps closed all fight long: Stumps' on both halves, Narrow Table's columns. */
export function closedCells(rule: FightRule | null | undefined): number[] {
  if (rule?.id === "stumps") return rule.stumps.flatMap((s) => [seatCell(0, s), seatCell(1, s)]);
  if (rule?.id === "narrow") return ALL_CELLS.filter((c) => WILDS.narrow.some((col) => col === colOf(c)));
  return [];
}

/** The board as the parties sit down (`Fight.taken`): every hex free, but those the rule closes and the seats it closes on both halves. */
export function boardFor(setup: Pick<FightSetup, "rule">): number[] {
  const taken = ALL_CELLS.map(() => -1);
  for (const s of closedSeats(setup.rule)) {
    taken[seatCell(0, s)] = CLOSED;
    taken[seatCell(1, s)] = CLOSED;
  }
  for (const c of closedCells(setup.rule)) taken[c] = CLOSED;
  return taken;
}

/** When dusk falls in a fight, in seconds. */
export const duskOf = (setup: Pick<FightSetup, "rule">): number =>
  setup.rule?.id === "dusk" ? WILDS.dusk : FIGHT.dusk;

/**
 * With everyone seated and their traits on, before anybody is summoned: the hexes closed only for
 * sitting down open, a figure with no friend touching it has Elbow Room's attack (and the fight's
 * opening says so), and under Fog nobody reaches further than Fog lets them.
 */
export function ruleSeated(f: Fight, setup: Pick<FightSetup, "rule">): void {
  const rule = setup.rule;
  if (!rule) return;
  const kept = new Set(closedCells(rule));
  f.taken.forEach((v, c) => {
    if (v === CLOSED && !kept.has(c)) f.taken[c] = -1;
  });
  if (rule.id === "elbow") {
    const alone = f.units.filter((u) => !f.units.some((o) => o !== u && o.side === u.side && touching(o.cell, u.cell)));
    for (const u of alone) {
      const more = Math.round((u.attack * WILDS.elbow) / 100);
      u.attack += more;
      emit(f, { t: "boost", id: u.id, by: u.id, stat: "attack", amount: more });
    }
  }
  if (rule.id === "fog") for (const u of f.units) u.range = Math.min(u.range, WILDS.fog);
}
