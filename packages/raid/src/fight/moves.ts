/**
 * The verbs that move figures about or take time, beside the small ones in `core.ts`: throwing
 * something, dash, pull, zone, channel and telegraph. Each writes down what it did as an event.
 */
import { FIGHT } from "../content/rooms.ts";
import { distance, line, neighboursFor, walkLength, within } from "../hex.ts";
import { emit, flight, foesWithin, hurt, HZ, later, leap, order, secs, unitAt } from "./core.ts";
import { fly } from "./mind.ts";
import type { DamageKind, Fight, Unit, Zone, ZoneKind } from "./types.ts";

// ---------- throwing ----------

/**
 * Throws something of a figure's at somebody: it flies, `wait` steps more than it takes to get
 * there, and `land` happens when it arrives. `harm` is the damage it carries, counted as on its way
 * to them meanwhile (`fly`). At oneself, it happens at once.
 */
export function send(
  f: Fight,
  u: Unit,
  from: number,
  target: Unit,
  land: () => void,
  wait = 0,
  harm: readonly [number, DamageKind] = [0, "true"],
): void {
  if (target.id === u.id && wait === 0) {
    land();
    return;
  }
  const ticks = flight(from, target.cell) + wait;
  emit(f, { t: "shot", id: u.id, target: target.id, from, to: target.cell, ticks, what: "ability" });
  fly(f, target, harm[0], harm[1], ticks, land);
}

// ---------- moving ----------

/** Runs to a free hex along a free way, `FIGHT.dash` steps a hex, and can be hit on the way. False if there is no way. */
export function dash(f: Fight, u: Unit, to: number): boolean {
  const hexes = to < 0 || u.rooted || f.taken[to] !== -1 ? -1 : walkLength(f.taken, u.cell, to);
  if (hexes <= 0) return false;
  leap(f, u, to, "dash");
  u.busyUntil = Math.max(u.busyUntil, f.tick + hexes * FIGHT.dash);
  return true;
}
/** Where a figure dashing at an enemy stops: where it is if they touch, else the free hex beside them it reaches soonest; -1 if none. */
export function dashTo(f: Fight, u: Unit, t: Unit): number {
  if (distance(u.cell, t.cell) <= 1) return u.cell;
  let best = -1;
  let fewest = Number.MAX_SAFE_INTEGER;
  for (const c of neighboursFor(u.side, t.cell)) {
    const steps = f.taken[c] === -1 ? walkLength(f.taken, u.cell, c) : -1;
    if (steps > 0 && steps < fewest) {
      best = c;
      fewest = steps;
    }
  }
  return best;
}
/** Pulls an enemy one hex toward a figure, the straight way if that hex is free, else another hex nearer it. A Rock stays; so does anything too big. */
export function pull(f: Fight, by: Unit, o: Unit): boolean {
  if (!o.alive || o.rooted || o.steady) return false;
  const near = distance(o.cell, by.cell);
  const to = [...line(o.cell, by.cell, 1), ...neighboursFor(by.side, o.cell)].find(
    (c) => f.taken[c] === -1 && distance(c, by.cell) < near,
  );
  if (to === undefined) return false;
  leap(f, o, to, "pull");
  return true;
}
/** The free hex within some steps of a figure, or its own, with the most enemies touching it; its own wins a tie, then the nearest. */
export function busiestHex(f: Fight, u: Unit, steps: number): number {
  let best = u.cell;
  let most = foesWithin(f, u.side, u.cell, 1).length;
  const near = within(u.cell, steps).toSorted(
    (a, b) => distance(u.cell, a) - distance(u.cell, b) || order(u.side, a) - order(u.side, b),
  );
  for (const c of near) {
    const touching = f.taken[c] === -1 ? foesWithin(f, u.side, c, 1).length : -1;
    if (touching > most) {
      best = c;
      most = touching;
    }
  }
  return best;
}

// ---------- zones ----------

/**
 * Makes some hexes a zone of a figure's for some seconds: enemies standing in them are `slow`
 * percent slower, or take `damage` magic damage every second. A hex holds one zone, the newest.
 */
export function zone(
  f: Fight,
  u: Unit,
  cells: readonly number[],
  kind: ZoneKind,
  seconds: number,
  effect: { slow?: number; damage?: number },
): void {
  const z: Zone = { id: u.id, side: u.side, kind, slow: effect.slow ?? 0, damage: effect.damage ?? 0 };
  const ticks = secs(seconds);
  for (const c of cells) f.zones[c] = z;
  emit(f, { t: "zone", id: u.id, side: u.side, kind, cells: [...cells], ticks, on: true });
  /** Its hexes that no newer zone has taken. */
  const held = (): number[] => cells.filter((c) => f.zones[c] === z);
  for (let s = 1; z.damage > 0 && s <= seconds; s++) {
    later(f, s * HZ, () => {
      for (const c of held()) {
        const o = unitAt(f, c);
        if (o && o.side !== z.side) hurt(f, o, z.damage, "magic", "ability", u);
      }
    });
  }
  later(f, ticks, () => {
    const left = held();
    for (const c of left) f.zones[c] = null;
    if (left.length > 0) emit(f, { t: "zone", id: u.id, side: u.side, kind, cells: left, ticks: 0, on: false });
  });
}
/** How much slower a figure is now, in percent: slowed, or standing in an enemy's zone that slows, whichever is more. */
export function slowNow(f: Fight, u: Unit): number {
  const z = f.zones[u.cell];
  return Math.max(u.slowUntil > f.tick ? u.slowBy : 0, z && z.side !== u.side ? z.slow : 0);
}

// ---------- taking time ----------

/** How a channelled ability lands: in `pulses`, `every` steps apart, the first at once. */
export interface Channel {
  readonly pulses: number;
  readonly every: number;
}
/** Pulses spread over some seconds, the first at once and the last at the end. */
export const over = (seconds: number, pulses: number): Channel => ({
  pulses,
  every: Math.round(secs(seconds) / Math.max(1, pulses - 1)),
});
/**
 * Lands an ability in pulses while its owner stands still. A stun, a fall or being moved ends it, and
 * the pulses left are lost: it lasts only in the life it began in, so one stood back up on the same
 * hex before its next pulse does not carry on with it.
 */
export function channel(f: Fight, u: Unit, c: Channel, pulse: () => void): void {
  const start = f.tick;
  const cell = u.cell;
  const life = u.downs;
  u.busyUntil = Math.max(u.busyUntil, start + c.every * (c.pulses - 1));
  let on = true;
  const next = (): void => {
    on = on && u.alive && u.downs === life && u.stunUntil <= start && u.cell === cell;
    if (on) pulse();
  };
  next();
  for (let i = 1; i < c.pulses; i++) later(f, c.every * i, next);
}
/** Marks the hexes an ability will land on, and lands it there in some steps on whoever is there by then. Its owner stands still till then. */
export function telegraph(f: Fight, u: Unit, cells: number[], ticks: number, land: () => void): void {
  emit(f, { t: "telegraph", id: u.id, cells, ticks });
  u.busyUntil = Math.max(u.busyUntil, f.tick + ticks);
  later(f, ticks, land);
}
