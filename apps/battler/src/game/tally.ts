/**
 * What every figure did in a fight, read from nothing but the fight's own events: the damage it
 * dealt, by kind; the health it lost and what was kept off it (turned away by armour, ward and
 * bracing, or soaked by a shield); the health and shields it gave, to others or itself; how many it
 * felled; and whether it is still standing. What a summoned figure did counts for whoever summoned
 * it, so a Glorplet's bites are Glorp's.
 *
 * It reads the events a fight has given so far as readily as a whole fight's, so a screen can keep
 * a count while the fight plays and show the same count when it is over.
 */
import type { FightEvent } from "./fight/types.ts";

/** What one figure did, with whatever it summoned counted in. */
export interface Did {
  id: number;
  /** Damage dealt, by kind. */
  physical: number;
  magic: number;
  true: number;
  /** Health lost to hits. */
  taken: number;
  /** What armour, ward and bracing turned away, and what shields soaked. */
  kept: number;
  /** Health given back, to others or itself. */
  healed: number;
  /** Shields put up, on others or itself. */
  shielded: number;
  /** Enemies it brought down. */
  felled: number;
  /** Still up (it has not fallen, or not yet). */
  stood: boolean;
}

/** The three things a tally is shown by: damage dealt, damage tanked, and healing and shields given. */
export type Measure = "damage" | "tanked" | "healing";
export const MEASURES: readonly Measure[] = ["damage", "tanked", "healing"];

/** The parts of a measure, in the order a bar shows them, and its whole. */
export function partsOf(d: Did, measure: Measure): number[] {
  switch (measure) {
    case "damage":
      return [d.physical, d.magic, d.true];
    case "tanked":
      return [d.taken, d.kept];
    case "healing":
      return [d.healed, d.shielded];
  }
}
export const measureOf = (d: Did, measure: Measure): number => partsOf(d, measure).reduce((a, b) => a + b, 0);

const blank = (id: number): Did => ({
  id,
  physical: 0,
  magic: 0,
  true: 0,
  taken: 0,
  kept: 0,
  healed: 0,
  shielded: 0,
  felled: 0,
  stood: true,
});

/** Every figure an event names: whoever it is about, and whoever did it. */
function named(ev: FightEvent): number[] {
  switch (ev.t) {
    case "swing":
      return [ev.id, ev.target];
    case "shot":
      return [ev.id, ev.target];
    case "hit":
    case "slip":
    case "heal":
    case "shield":
    case "status":
    case "boost":
    case "fall":
    case "summon":
      return [ev.id, ev.by];
    case "cast":
      return [ev.id, ...ev.targets];
    case "trait":
      return ev.ids;
    case "move":
    case "leap":
    case "rise":
    case "item":
      return [ev.id];
    case "dusk":
    case "end":
      return [];
  }
}

/**
 * What everyone did, one entry a figure, by id. `everyone` names figures to include even if they
 * have not done anything yet (a screen passes everyone on the board); a summoned figure with a
 * summoner never has an entry of its own.
 */
export function tally(events: readonly FightEvent[], everyone: readonly number[] = []): Did[] {
  // Who summoned whom, first, so that a summoned figure's doings go to its summoner from the start.
  const summoner = new Map<number, number>();
  for (const ev of events) if (ev.t === "summon" && ev.by >= 0) summoner.set(ev.id, ev.by);
  const ownerOf = (id: number): number => {
    let at = id;
    for (let guard = 0; guard < 16; guard++) {
      const up = summoner.get(at);
      if (up === undefined) return at;
      at = up;
    }
    return at;
  };
  const rows = new Map<number, Did>();
  const row = (id: number): Did => {
    const owner = ownerOf(id);
    let d = rows.get(owner);
    if (!d) {
      d = blank(owner);
      rows.set(owner, d);
    }
    return d;
  };
  for (const id of everyone) if (id >= 0) row(id);

  for (const ev of events) {
    for (const id of named(ev)) if (id >= 0) row(id);
    if (ev.t === "hit") {
      if (ev.by >= 0) row(ev.by)[ev.kind] += ev.amount;
      const target = row(ev.id);
      target.taken += ev.lost;
      target.kept += Math.max(0, ev.before - ev.amount) + ev.soaked;
    } else if (ev.t === "heal") {
      // Healing that nobody gave (regrowing, coming up from a burrow, a bite that heals) is its own.
      row(ev.by >= 0 ? ev.by : ev.id).healed += ev.amount;
    } else if (ev.t === "shield") {
      row(ev.by >= 0 ? ev.by : ev.id).shielded += ev.amount;
    } else if (ev.t === "fall") {
      if (ev.by >= 0) row(ev.by).felled++;
      // A summoned figure falling is not its summoner falling.
      if (ownerOf(ev.id) === ev.id) row(ev.id).stood = false;
    }
  }
  return [...rows.values()].toSorted((a, b) => a.id - b.id);
}
