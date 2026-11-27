import { abilityNumber, specOf, type Stars, starScale, type UnitKind } from "../content/figures.ts";
/**
 * Coming into a fight: a figure sitting down (`enter`), one summoned in the middle of it (`summon`),
 * and one getting back up (`getUp`): from Second Wind, from Graid (`graidFalls`, in its true form) or
 * from Seqwawa's No GG Left Behind. Each writes down what it did as an event.
 */
import { formNumber, hasTrueForm } from "../content/graid.ts";
import { type ItemId, itemStats } from "../content/items.ts";
import { FIGHT } from "../content/rooms.ts";
import { traitNumber } from "../content/traits.ts";
import { CELLS, distance, type Side, within } from "../hex.ts";
import { emit, later, secs } from "./clock.ts";
import type { Fight, Form, RiseWhy, Unit } from "./types.ts";

/** The free hex nearest a hex, within a few steps; the hex itself if it is free. -1 if there is none. */
export function freeNear(f: Fight, cell: number, steps = 3): number {
  if (f.taken[cell] === -1) return cell;
  for (const c of within(cell, steps)) if (f.taken[c] === -1) return c;
  return -1;
}

// ---------- sitting down ----------

/** What a new figure in a fight starts from; everything not given starts plain (`PLAIN`). */
export interface Start {
  side: Side;
  kind: UnitKind;
  stars: Stars;
  cell: number;
  seat: number;
  summoned: boolean;
  owner: number;
  items: readonly ItemId[];
  /** What its stars, level and party's might multiply its health and attack by. */
  grown: number;
  maxHp: number;
  attack: number;
  speed: number;
  power: number;
}
/** How every figure starts a fight, whoever it is: up, nothing on it, nothing from traits or items, nothing done yet. */
const PLAIN = {
  alive: true,
  shield: 0,
  draw: 0,
  crit: 0,
  slip: 0,
  cool: 0,
  busyUntil: 0,
  target: -1,
  incoming: 0,
  waitFrom: -1,
  attacks: 0,
  form: "plain",
  manaRate: 0,
  rises: false,
  fellAt: -1,
  fallNo: 0,
  downs: 0,
  stunUntil: 0,
  slowUntil: 0,
  slowBy: 0,
  burnUntil: 0,
  burnBy: 0,
  burnFrom: -1,
  burnDamp: 0,
  shieldUntil: 0,
  tauntUntil: 0,
  tauntBy: -1,
  hiddenUntil: 0,
  hasteUntil: 0,
  hasteBy: 0,
  bracedUntil: 0,
  bracedBy: 0,
  stub: 0,
  ember: 0,
  quicken: 0,
  quickMost: 0,
  quick: 0,
  focusBy: 0,
  focusMost: 0,
  focusOn: -1,
  focus: 0,
  manaMore: 0,
  mending: 0,
  sneakHits: 0,
  sneakBy: 0,
  digs: false,
  digHeal: 0,
  digLess: 0,
  digFor: 0,
  regrow: 0,
  crack: 0,
  crackMost: 0,
  called: false,
  cracked: 0,
  calledLast: -1,
  pierce: 0,
  twice: 0,
  prickle: 0,
  clip: 0,
  leech: 0,
  powerGrow: 0,
  castShield: 0,
  castShieldFor: 0,
  serveEvery: 0,
  serveHeal: 0,
  noHard: false,
  stunCut: 0,
  logUnder: 0,
  logShield: 0,
  logFor: 0,
  dealt: 0,
  taken: 0,
  healed: 0,
  casts: 0,
} as const satisfies Partial<Unit>;

/** Puts a figure on the board. Whoever calls this has made sure the hex is free. */
export function enter(f: Fight, s: Start): Unit {
  const spec = specOf(f.cat, s.kind);
  const maxHp = Math.max(1, Math.round(s.maxHp));
  const attack = Math.max(0, Math.round(s.attack));
  const u: Unit = {
    ...PLAIN,
    gifts: [],
    id: f.units.length,
    side: s.side,
    kind: s.kind,
    stars: s.stars,
    name: spec.name,
    summoned: s.summoned,
    owner: s.owner,
    items: s.items,
    seat: s.seat,
    cell: s.cell,
    grown: s.grown,
    maxHp,
    hp: maxHp,
    attack,
    attack0: attack,
    speed: s.speed,
    range: spec.range,
    armour: spec.armour,
    ward: spec.ward,
    power: s.power,
    mana: spec.mana[0],
    manaFull: spec.mana[1],
    rooted: spec.rooted === true,
    steady: spec.steady === true,
    // Only the brambles have a number for it.
    thorns: (abilityNumber(f.cat, s.kind, "thorns", s.stars) * s.power) / 100,
  };
  f.units.push(u);
  f.taken[s.cell] = u.id;
  f.standing[s.side]++;
  return u;
}
/**
 * Brings a new figure into the fight on a free hex, with its kind's own numbers for its stars
 * unless others are given. It finds its feet for a moment before it does anything.
 */
export function summon(
  f: Fight,
  kind: UnitKind,
  stars: Stars,
  side: Side,
  cell: number,
  by: Unit | null,
  numbers: { hp?: number; attack?: number } = {},
): Unit | undefined {
  if (cell < 0 || f.taken[cell] !== -1) return undefined;
  const spec = specOf(f.cat, kind);
  const might = f.might[side] / 100;
  const u = enter(f, {
    side,
    kind,
    stars,
    cell,
    seat: -1,
    summoned: true,
    owner: by?.id ?? -1,
    items: [],
    grown: starScale(stars) * might,
    maxHp: numbers.hp ?? spec.hp * starScale(stars) * might,
    attack: numbers.attack ?? spec.attack * starScale(stars) * might,
    speed: spec.speed,
    power: 100 * might,
  });
  u.busyUntil = f.tick + FIGHT.cast;
  // What a Grooter figure summons cracks as it does.
  if (by) {
    u.crack = by.crack;
    u.crackMost = by.crackMost;
  }
  emit(f, { t: "summon", id: u.id, by: by?.id ?? -1, kind, cell, side });
  return u;
}

// ---------- getting back up ----------

/**
 * Where a figure that is down gets back up: its own hex if it is free, else the nearest free open hex
 * anywhere on the board, of two as near the one `freeNear` would take (so it gets up where it fell or
 * right beside it, never sent home); -1 when the board has none.
 */
export function standOn(f: Fight, u: Unit): number {
  if (f.taken[u.cell] === -1) return u.cell;
  for (let d = 1; d < CELLS; d++) {
    let found = false;
    for (let cell = 0; cell < CELLS; cell++) {
      if (distance(u.cell, cell) !== d) continue;
      found = true;
      if (f.taken[cell] === -1) return cell;
    }
    if (!found) break;
  }
  return -1;
}

/**
 * The last of a side to fall for good, if it fell within `window` steps and has somewhere to stand
 * (`standOn`): the one Seqwawa's No GG Left Behind stands back up. Never one that was summoned.
 */
export function lastFallen(f: Fight, side: Side, window: number): Unit | undefined {
  const last = f.units
    .filter((o) => o.side === side && !o.summoned && o.fellAt >= 0)
    .toSorted((a, b) => b.fallNo - a.fallNo)[0];
  return last && f.tick - last.fellAt <= window && standOn(f, last) >= 0 ? last : undefined;
}

/**
 * Gets a figure back up with some health, in a form, shaken free of what was on it (burning, stunned,
 * slowed, taunted). One still up (Second Wind, as it would fall) stays where it is; one that is down
 * comes back on its hex, or the nearest free open hex anywhere on the board (`standOn`), and finds
 * its feet for a moment. False, and nothing done, when there is nowhere free for it to stand.
 */
export function getUp(f: Fight, u: Unit, hp: number, why: RiseWhy, form: Form = u.form): boolean {
  const cell = u.alive ? u.cell : standOn(f, u);
  if (cell < 0) return false;
  if (!u.alive) {
    // One that was down for good counts as standing again; one down for a moment never stopped.
    if (u.fellAt >= 0) f.standing[u.side]++;
    u.alive = true;
    u.cell = cell;
    f.taken[cell] = u.id;
    u.busyUntil = f.tick + FIGHT.cast;
    u.target = -1;
  }
  u.fellAt = -1;
  u.fallNo = 0;
  u.hp = Math.max(1, Math.min(u.maxHp, Math.round(hp)));
  u.burnUntil = 0;
  u.stunUntil = 0;
  u.slowUntil = 0;
  u.tauntUntil = 0;
  u.form = form;
  emit(f, { t: "rise", id: u.id, hp: u.hp, why, form, cell });
  return true;
}

/** Stands a figure in its true form: more attack and ability power, and the Rock its own attack. */
function standTrue(f: Fight, u: Unit): void {
  if (u.kind === "rock") {
    // Real Rock attacks: its form's numbers, grown and held as a figure's own are.
    let attack = 0;
    let speed = 0;
    for (const item of u.items) {
      attack += itemStats(f.cat, item).attack;
      speed += itemStats(f.cat, item).speed;
    }
    u.attack = formNumber("rock", "attack") * u.grown * (1 + attack / 100);
    u.speed = formNumber("rock", "speed") * (1 + speed / 100);
  }
  const more = 1 + traitNumber(f.cat, "graid", "more", 1) / 100;
  u.attack = Math.round(u.attack * more);
  u.power *= more;
}
/** Graid's getting back up, a moment after falling: in its true form if it has one, with its share of health, and at the top step its share of a mana bar. */
function graidUp(f: Fight, u: Unit, step: number): void {
  const form: Form = hasTrueForm(u.kind) ? "true" : u.form;
  if (!getUp(f, u, (u.maxHp * traitNumber(f.cat, "graid", "health", step)) / 100, "graid", form)) {
    // Nowhere to stand: it is down for good after all.
    f.standing[u.side]--;
    u.fellAt = f.tick;
    u.fallNo = ++f.falls;
    return;
  }
  if (form === "true") standTrue(f, u);
  // At the top step, its mana bar at least this full.
  u.mana = Math.max(u.mana, Math.round((u.manaFull * traitNumber(f.cat, "graid", "mana", step)) / 100));
}
/**
 * Graid, as a figure falls: one with its getting back up still to come (`rises`) gets back up a
 * moment later (`graidUp`), and meanwhile still counts as standing. At the first step, only the first
 * Graid figure of its side to fall does. Gives the steps until it gets back up, or 0 if it does not.
 */
export function graidFalls(f: Fight, u: Unit): number {
  const step = f.traits[u.side].graid ?? 0;
  if (!u.rises || step <= 0) return 0;
  u.rises = false;
  if (traitNumber(f.cat, "graid", "every", step) <= 0) for (const o of f.units) if (o.side === u.side) o.rises = false;
  const wait = secs(traitNumber(f.cat, "graid", "wait", step));
  later(f, wait, () => graidUp(f, u, step));
  return wait;
}
