/**
 * How a figure thinks: who it goes for, and when its ability is worth using. Three rules, each
 * decided here and nowhere else:
 *
 * 1. A heal or a shield waits for somebody who needs it (`wanted`).
 * 2. An area ability waits a moment for a crowd (`crowd`).
 * 3. Nobody wastes a blow on the fallen: damage already thrown at a figure counts (`fly`), and a
 *    figure whose health it covers is passed over while anybody else is in reach (`covered`).
 */
import { abilityNumber, type UnitKind } from "../content/figures.ts";
import { FIGHT } from "../content/rooms.ts";
import { CELLS, distance } from "../hex.ts";
import { foesOf, later, order, otherSide, risenAt, secs, targetable } from "./core.ts";
import { lastFallen } from "./enter.ts";
import { attackReach } from "./rules.ts";
import type { DamageKind, Fight, Unit } from "./types.ts";

// ---------- rule 3: what is already on its way ----------

/** What damage would take off a figure's health and shield as it stands, before bracing. */
const landsAs = (o: Unit, raw: number, kind: DamageKind): number =>
  kind === "true" ? raw : (raw * 100) / (100 + Math.max(0, kind === "physical" ? o.armour : o.ward));
/**
 * Throws damage at a figure: `land` happens in some steps, and until then the damage counts as on
 * its way to the figure. Healing thrown at somebody is thrown with no damage.
 */
export function fly(f: Fight, target: Unit, raw: number, kind: DamageKind, ticks: number, land: () => void): void {
  // As it will land: risen by then, late in a fight (`risenAt`).
  const harm = landsAs(target, risenAt(f, raw, f.tick + ticks), kind);
  target.incoming += harm;
  later(f, ticks, () => {
    target.incoming -= harm;
    land();
  });
}
/** A figure's shield as a hit meets it: its own, and what its group's one shield (Huddle) holds. */
export const shieldOf = (f: Fight, o: Unit): number => o.shield + (f.pools[o.pool]?.left ?? 0);
/** Whether what is on its way to a figure already takes all its health and shield. */
export const covered = (f: Fight, o: Unit): boolean => o.incoming > 0 && o.incoming >= o.hp + shieldOf(f, o);

// ---------- who a figure goes for ----------

/** How near an enemy seems to a figure picking a target: its distance less its draw. */
const seems = (from: number, o: Unit): number => distance(from, o.cell) - o.draw;
/** Enemies its attacks reach first, those whose health is already covered after them, and the rest last. */
const rank = (f: Fight, u: Unit, o: Unit): number =>
  distance(u.cell, o.cell) > attackReach(f, u) ? 2 : covered(f, o) ? 1 : 0;
/**
 * The order a figure picks a new target in: enemies in its reach before the rest, so that it never
 * walks off while there is somebody it can hit, and of those, one whose health is already covered
 * last; then the one that seems nearest (distance less draw); ties go to the one really nearer, then
 * to the hex that comes first for its side.
 */
const pickOrder =
  (f: Fight, u: Unit) =>
  (a: Unit, b: Unit): number =>
    rank(f, u, a) - rank(f, u, b) ||
    seems(u.cell, a) - seems(u.cell, b) ||
    distance(u.cell, a.cell) - distance(u.cell, b.cell) ||
    order(u.side, a.cell) - order(u.side, b.cell);
/** Enemies in the order a figure picks a new target (`pickOrder`). */
export const foesByDraw = (f: Fight, u: Unit): Unit[] => foesOf(f, u.side).toSorted(pickOrder(f, u));
/** The enemy a figure picks when it picks a new target: the first in `pickOrder`. */
export function drawnFoe(f: Fight, u: Unit): Unit | undefined {
  const first = pickOrder(f, u);
  let best: Unit | undefined;
  for (const o of f.units) {
    if (o.side !== u.side && targetable(f, o) && (!best || first(o, best) < 0)) best = o;
  }
  return best;
}
/** Whoever a figure is on already, while its attacks reach them and their health is not already covered. */
export function onTarget(f: Fight, u: Unit): Unit | undefined {
  const t = f.units[u.target];
  const keeps = t && t.side !== u.side && targetable(f, t) && distance(u.cell, t.cell) <= attackReach(f, u);
  return keeps && !covered(f, t) ? t : undefined;
}
/**
 * Who a figure's ability is aimed at when the sentence says "its target": whoever it is attacking,
 * if still worth it (`onTarget`), else whoever it would pick to attack, if that one is in its own
 * reach (an ability reaches as far as its figure does, under Fog too).
 */
export function aim(f: Fight, u: Unit): Unit | undefined {
  const picked = onTarget(f, u) ?? drawnFoe(f, u);
  return picked && distance(u.cell, picked.cell) <= u.range ? picked : undefined;
}
/** Of some enemies, the one with the least health, passing over any whose health is covered while there are others. */
export function weakest(f: Fight, foes: readonly Unit[]): Unit | undefined {
  const open = foes.filter((o) => !covered(f, o));
  return (open.length > 0 ? open : foes).toSorted((a, b) => a.hp - b.hp || a.id - b.id)[0];
}

// ---------- rule 1: a heal or a shield waits for somebody who needs it ----------

/** Whose ability heals or shields friends, and how many hexes from it they may be. */
const MENDS: Partial<Record<UnitKind, number>> = {
  mossmote: CELLS,
  kettle: CELLS,
  crab23: CELLS,
  apothecary: 2,
  seqwawa: CELLS,
  // Penguin Month: Dibs shields itself and a friend touching it; Yule bubbles anyone.
  dibs: 1,
  yule: CELLS,
};
/**
 * Whether a figure's ability is worth using now: always, unless it mends and every friend it reaches
 * is above `mendUnder`; and for Seqwawa, also when a friend has just fallen that it could stand back
 * up (`lastFallen`).
 */
export function wanted(f: Fight, u: Unit): boolean {
  const reach = MENDS[u.kind];
  if (reach === undefined) return true;
  const hurt = f.units.some(
    (o) => o.side === u.side && o.alive && distance(u.cell, o.cell) <= reach && o.hp * 100 <= o.maxHp * FIGHT.mendUnder,
  );
  return (
    hurt ||
    (u.kind === "seqwawa" && lastFallen(f, u.side, secs(abilityNumber(f.cat, u.kind, "window", u.stars))) !== undefined)
  );
}

// ---------- rule 2: an area ability waits a moment for a crowd ----------

/**
 * Whether an area ability that would catch `caught` enemies goes now. One caught while three or more
 * enemies are up waits for a second, up to `crowdWait` steps from when it began waiting, and then
 * goes anyway.
 */
export function crowd(f: Fight, u: Unit, caught: number): boolean {
  const waits = caught === 1 && f.standing[otherSide(u.side)] >= 3;
  if (waits && u.waitFrom < 0) u.waitFrom = f.tick;
  if (waits && f.tick - u.waitFrom < FIGHT.crowdWait) return false;
  u.waitFrom = -1;
  return true;
}
