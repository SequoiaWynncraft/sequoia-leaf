/**
 * The small verbs a fight is written in: hurt, heal, shield, stun, slow, burn, taunt, hide, leap,
 * knock back, summon, and "this lands in a moment". Attacks, abilities, traits and items are all
 * made of these, and each one writes down what it did as an event.
 */
import { boonNumber } from "../content/boons.ts";
import {
  abilityNumber,
  isFigureId,
  specOf,
  type Stars,
  starScale,
  traitsOf,
  type UnitKind,
} from "../content/figures.ts";
import { FINISHED, isFinishedId, type ItemId } from "../content/items.ts";
import { FIGHT } from "../content/rooms.ts";
import { traitDraw, TRAITS } from "../content/traits.ts";
import { distance, line, mirror, neighboursFor, type Side, within } from "../hex.ts";
import type { DamageKind, DamageSource, Fight, FightEvent, HealSource, LeapWhy, Unit } from "./types.ts";

export const HZ = FIGHT.hz;
/** Seconds as steps of the clock. */
export const secs = (seconds: number): number => Math.round(seconds * HZ);
/** A time that never comes: for a shield that lasts until it is broken. */
export const FOREVER = Number.MAX_SAFE_INTEGER;

export const emit = (f: Fight, ev: FightEvent): void => {
  f.out.push(ev);
};
/** Has something happen in a number of steps: when a thrown thing arrives. */
export const later = (f: Fight, ticks: number, land: () => void): void => {
  f.pending.push({ at: f.tick + Math.max(1, ticks), land });
};
/** How long something thrown takes to get from one hex to another. */
export const flight = (from: number, to: number): number => Math.max(1, distance(from, to)) * FIGHT.flight;

/** An amount made bigger by its owner's ability power. */
export const powered = (u: Unit, amount: number): number => (amount * u.power) / 100;
/** Whether anything can be aimed at it: up, and not underground. */
export const targetable = (f: Fight, u: Unit): boolean => u.alive && u.hiddenUntil <= f.tick;
const other = (side: Side): Side => (side === 0 ? 1 : 0);
/** A hex's place in the order a side breaks ties in, so that both sides break them alike. */
export const order = (side: Side, cell: number): number => (side === 0 ? cell : mirror(cell));

// ---------- who is where ----------

export function unitAt(f: Fight, cell: number): Unit | undefined {
  const id = f.taken[cell];
  return id === undefined || id < 0 ? undefined : f.units[id];
}
/** Every enemy of a side that can be aimed at. */
export function foesOf(f: Fight, side: Side): Unit[] {
  const out: Unit[] = [];
  for (const o of f.units) if (o.side !== side && targetable(f, o)) out.push(o);
  return out;
}
/** Everyone on a side who is still up. */
export function alliesOf(f: Fight, side: Side): Unit[] {
  const out: Unit[] = [];
  for (const o of f.units) if (o.side === side && o.alive) out.push(o);
  return out;
}
/**
 * A figure's draw: what its callings and the items it holds add up to, kept between the fight's
 * least and most. The forest's own carry no calling, so theirs is 0.
 */
export function drawOf(kind: UnitKind, items: readonly ItemId[]): number {
  let draw = 0;
  if (isFigureId(kind)) for (const t of traitsOf(kind)) draw += traitDraw(t);
  for (const item of items) if (isFinishedId(item)) draw += FINISHED[item].n.draw ?? 0;
  return Math.min(FIGHT.drawMost, Math.max(FIGHT.drawLeast, draw));
}
/** The enemy nearest a figure, whatever its draw; ties go to the hex that comes first for its side. */
export function nearestFoe(f: Fight, u: Unit): Unit | undefined {
  let best: Unit | undefined;
  let bestAway = 99;
  let bestOrder = 0;
  for (const o of f.units) {
    if (o.side === u.side || !o.alive || o.hiddenUntil > f.tick) continue;
    const away = distance(u.cell, o.cell);
    const at = order(u.side, o.cell);
    if (away < bestAway || (away === bestAway && at < bestOrder)) {
      best = o;
      bestAway = away;
      bestOrder = at;
    }
  }
  return best;
}
/** The enemy furthest from a figure. */
export function farthestFoe(f: Fight, u: Unit): Unit | undefined {
  let best: Unit | undefined;
  let bestAway = -1;
  let bestOrder = 0;
  for (const o of f.units) {
    if (o.side === u.side || !o.alive || o.hiddenUntil > f.tick) continue;
    const away = distance(u.cell, o.cell);
    const at = order(u.side, o.cell);
    if (away > bestAway || (away === bestAway && at < bestOrder)) {
      best = o;
      bestAway = away;
      bestOrder = at;
    }
  }
  return best;
}
/** Enemies of a side, nearest a hex first. */
export function foesByDistance(f: Fight, side: Side, cell: number): Unit[] {
  return foesOf(f, side).toSorted(
    (a, b) => distance(cell, a.cell) - distance(cell, b.cell) || order(side, a.cell) - order(side, b.cell),
  );
}
/** Enemies of a side standing within some steps of a hex (the hex itself included). */
export function foesWithin(f: Fight, side: Side, cell: number, steps: number): Unit[] {
  const out: Unit[] = [];
  for (const o of f.units) {
    if (o.side !== side && o.alive && o.hiddenUntil <= f.tick && distance(cell, o.cell) <= steps) out.push(o);
  }
  return out;
}
/** Enemies of a side standing on any of some hexes, in the order of the hexes. */
export function foesOn(f: Fight, side: Side, cells: readonly number[]): Unit[] {
  const out: Unit[] = [];
  for (const cell of cells) {
    const o = unitAt(f, cell);
    if (o && o.side !== side && targetable(f, o)) out.push(o);
  }
  return out;
}
/** A side's own, most hurt first (by share of health left). With `hurtOnly`, those at full health are left out. */
export function mostHurt(f: Fight, side: Side, hurtOnly: boolean): Unit[] {
  const out: Unit[] = [];
  for (const o of f.units) {
    if (o.side === side && o.alive && (!hurtOnly || o.hp < o.maxHp)) out.push(o);
  }
  return out.toSorted((a, b) => a.hp * b.maxHp - b.hp * a.maxHp || a.id - b.id);
}
/** The free hex nearest a hex, within a few steps; the hex itself if it is free. -1 if there is none. */
export function freeNear(f: Fight, cell: number, steps = 3): number {
  if (f.taken[cell] === -1) return cell;
  for (const c of within(cell, steps)) if (f.taken[c] === -1) return c;
  return -1;
}
/** A free hex touching `cell`: the one furthest from `awayFrom`, so that arriving there is arriving behind. -1 if none. */
export function freeBeside(f: Fight, side: Side, cell: number, awayFrom: number): number {
  let best = -1;
  let bestAway = -1;
  for (const c of neighboursFor(side, cell)) {
    if (f.taken[c] !== -1) continue;
    const away = distance(c, awayFrom);
    if (away > bestAway) {
      best = c;
      bestAway = away;
    }
  }
  return best;
}

// ---------- moving without walking ----------

function place(f: Fight, u: Unit, cell: number): void {
  if (f.taken[u.cell] === u.id) f.taken[u.cell] = -1;
  u.cell = cell;
  f.taken[cell] = u.id;
}
export function leap(f: Fight, u: Unit, to: number, why: LeapWhy): void {
  const from = u.cell;
  if (to === from || to < 0 || f.taken[to] !== -1) return;
  place(f, u, to);
  u.busyUntil = Math.max(u.busyUntil, f.tick + 2);
  emit(f, { t: "leap", id: u.id, from, to, why });
}
/** Pushes a figure straight away from a hex, as far as there are free hexes, up to a number. A Rock stays; so does anything too big. */
export function knockBack(f: Fight, target: Unit, from: number, hexes: number): number {
  if (!target.alive || target.rooted || target.steady || hexes <= 0) return 0;
  const reach = distance(from, target.cell);
  const path = line(from, target.cell, reach + hexes);
  let to = -1;
  let moved = 0;
  for (let i = reach; i < path.length; i++) {
    const cell = path[i];
    if (cell === undefined || f.taken[cell] !== -1) break;
    to = cell;
    moved++;
  }
  if (to >= 0) leap(f, target, to, "knocked");
  return moved;
}

// ---------- mana ----------

export function gainMana(u: Unit, amount: number): void {
  if (u.manaFull > 0 && u.alive) u.mana = Math.min(u.manaFull, u.mana + amount);
}

// ---------- statuses ----------

export function stun(f: Fight, target: Unit, seconds: number, by: Unit | null): void {
  if (!targetable(f, target)) return;
  let ticks = secs(seconds);
  if (target.steady) ticks = Math.round(ticks / 2);
  if (target.stunCut > 0) ticks = Math.round((ticks * (100 - target.stunCut)) / 100);
  const until = f.tick + ticks;
  if (ticks <= 0 || until <= target.stunUntil) return;
  target.stunUntil = until;
  emit(f, { t: "status", id: target.id, status: "stun", on: true, ticks, amount: 0, by: by?.id ?? -1 });
}
export function slow(f: Fight, target: Unit, percent: number, seconds: number, by: Unit | null): void {
  if (!targetable(f, target) || percent <= 0) return;
  const ticks = secs(seconds);
  const running = target.slowUntil > f.tick;
  target.slowBy = running ? Math.max(target.slowBy, percent) : percent;
  target.slowUntil = Math.max(target.slowUntil, f.tick + ticks);
  emit(f, { t: "status", id: target.id, status: "slow", on: true, ticks, amount: target.slowBy, by: by?.id ?? -1 });
}
const BURN_FOR = secs(TRAITS.ember.n.lasts[0]);
const BURN_DAMP = TRAITS.ember.n.damp[0];
/** Sets something alight: a share of its health every second, and weaker healing meanwhile. Burning again keeps the hotter fire. */
export function burn(f: Fight, target: Unit, percent: number, by: Unit | null): void {
  if (!targetable(f, target) || percent <= 0) return;
  const running = target.burnUntil > f.tick;
  const hotter = !running || percent > target.burnBy;
  target.burnBy = running ? Math.max(target.burnBy, percent) : percent;
  target.burnUntil = f.tick + BURN_FOR;
  target.burnDamp = BURN_DAMP;
  if (by) target.burnFrom = by.id;
  if (hotter) {
    emit(f, {
      t: "status",
      id: target.id,
      status: "burn",
      on: true,
      ticks: BURN_FOR,
      amount: target.burnBy,
      by: by?.id ?? -1,
    });
  }
}
export function taunt(f: Fight, target: Unit, seconds: number, by: Unit): void {
  if (!targetable(f, target)) return;
  const ticks = secs(seconds);
  target.tauntUntil = f.tick + ticks;
  target.tauntBy = by.id;
  target.target = by.id;
  emit(f, { t: "status", id: target.id, status: "taunt", on: true, ticks, amount: 0, by: by.id });
}
export function haste(f: Fight, target: Unit, percent: number, seconds: number, by: Unit | null): void {
  if (!target.alive || percent <= 0) return;
  const ticks = secs(seconds);
  const running = target.hasteUntil > f.tick;
  target.hasteBy = running ? Math.max(target.hasteBy, percent) : percent;
  target.hasteUntil = Math.max(target.hasteUntil, f.tick + ticks);
  emit(f, { t: "status", id: target.id, status: "haste", on: true, ticks, amount: target.hasteBy, by: by?.id ?? -1 });
}
/**
 * Braces: takes a share less from every attack and ability for a while, and whoever attacks it up
 * close is hurt. Braced again while it lasts (a Rock digging in during It Is A Rock), it keeps the
 * stronger share and sting, until the later end.
 */
export function brace(f: Fight, target: Unit, percent: number, stub: number, seconds: number): void {
  if (!target.alive) return;
  const ticks = secs(seconds);
  const running = target.bracedUntil > f.tick;
  target.bracedBy = running ? Math.max(target.bracedBy, percent) : percent;
  target.stub = running ? Math.max(target.stub, stub) : stub;
  target.bracedUntil = Math.max(target.bracedUntil, f.tick + ticks);
  emit(f, { t: "status", id: target.id, status: "braced", on: true, ticks, amount: target.bracedBy, by: target.id });
}
/** Goes where nothing can reach it for a while. */
export function hide(f: Fight, u: Unit, ticks: number): void {
  if (!u.alive || ticks <= 0) return;
  u.hiddenUntil = f.tick + ticks;
  u.tauntUntil = 0;
  emit(f, { t: "status", id: u.id, status: "hidden", on: true, ticks, amount: 0, by: u.id });
}

// ---------- healing and shields ----------

export function heal(f: Fight, target: Unit, raw: number, source: HealSource, by: Unit | null): number {
  if (!target.alive || raw <= 0) return 0;
  let amount = raw;
  if (by && by.mending > 0 && (source === "ability" || source === "item")) amount *= 1 + by.mending / 100;
  if (target.burnUntil > f.tick) amount *= 1 - target.burnDamp / 100;
  const n = Math.min(Math.round(amount), target.maxHp - target.hp);
  if (n <= 0) return 0;
  target.hp += n;
  target.healed += n;
  emit(f, { t: "heal", id: target.id, by: by?.id ?? -1, amount: n, source, hp: target.hp });
  return n;
}
/** Puts a shield up, or adds to the one there. `seconds` of 0 lasts until it is broken. */
export function shieldUp(f: Fight, target: Unit, raw: number, seconds: number, by: Unit | null): number {
  if (!target.alive) return 0;
  let amount = raw;
  if (by && by.mending > 0) amount *= 1 + by.mending / 100;
  const n = Math.round(amount);
  if (n <= 0) return 0;
  const ticks = secs(seconds);
  const until = ticks <= 0 ? FOREVER : f.tick + ticks;
  target.shieldUntil = target.shield > 0 ? Math.max(target.shieldUntil, until) : until;
  target.shield += n;
  emit(f, { t: "shield", id: target.id, by: by?.id ?? -1, amount: n, shield: target.shield, ticks });
  return n;
}

// ---------- summoning ----------

/** What a new figure in a fight starts from; everything not given starts plain. */
export interface Start {
  side: Side;
  kind: UnitKind;
  stars: Stars;
  cell: number;
  seat: number;
  summoned: boolean;
  owner: number;
  items: readonly ItemId[];
  maxHp: number;
  attack: number;
  speed: number;
  power: number;
}
/** Puts a figure on the board. Whoever calls this has made sure the hex is free. */
export function enter(f: Fight, s: Start): Unit {
  const spec = specOf(s.kind);
  const maxHp = Math.max(1, Math.round(s.maxHp));
  const attack = Math.max(0, Math.round(s.attack));
  const u: Unit = {
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
    alive: true,
    maxHp,
    hp: maxHp,
    shield: 0,
    attack,
    attack0: attack,
    speed: s.speed,
    range: spec.range,
    draw: 0,
    armour: spec.armour,
    ward: spec.ward,
    power: s.power,
    mana: spec.mana[0],
    manaFull: spec.mana[1],
    crit: 0,
    slip: 0,
    cool: 0,
    busyUntil: 0,
    target: -1,
    incoming: 0,
    waitFrom: -1,
    attacks: 0,
    rooted: spec.rooted === true,
    steady: spec.steady === true,
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
    // Only the brambles have a number for it.
    thorns: (abilityNumber(s.kind, "thorns", s.stars) * s.power) / 100,
    called: false,
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
  const spec = specOf(kind);
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
    maxHp: numbers.hp ?? spec.hp * starScale(stars) * might,
    attack: numbers.attack ?? spec.attack * starScale(stars) * might,
    speed: spec.speed,
    power: 100 * might,
  });
  u.busyUntil = f.tick + FIGHT.cast;
  emit(f, { t: "summon", id: u.id, by: by?.id ?? -1, kind, cell, side });
  return u;
}

// ---------- hurting ----------

/**
 * Lands damage. Physical damage meets armour and magic meets ward (damage x 100 / (100 + defence));
 * true damage meets nothing. A shield takes it first. Gives back what the target lost.
 */
export function hurt(
  f: Fight,
  target: Unit,
  raw: number,
  kind: DamageKind,
  source: DamageSource,
  by: Unit | null,
  hard = false,
): number {
  if (!target.alive || target.hiddenUntil > f.tick || raw <= 0) return 0;
  const direct = source === "attack" || source === "ability";
  let amount = raw;
  if (kind === "physical") {
    let armour = target.armour;
    if (by && by.pierce > 0 && source === "attack") armour *= 1 - by.pierce / 100;
    amount = (amount * 100) / (100 + Math.max(0, armour));
  } else if (kind === "magic") {
    amount = (amount * 100) / (100 + Math.max(0, target.ward));
  }
  if (direct && target.bracedUntil > f.tick) amount *= 1 - target.bracedBy / 100;
  const n = Math.max(1, Math.round(amount));
  let soaked = 0;
  if (target.shield > 0) {
    soaked = Math.min(target.shield, n);
    target.shield -= soaked;
  }
  const had = Math.max(0, target.hp);
  target.hp -= n - soaked;
  target.taken += n;
  if (by) by.dealt += n;
  if (direct) gainMana(target, Math.min(FIGHT.manaHit, Math.ceil((n * 50) / target.maxHp)));
  emit(f, {
    t: "hit",
    id: target.id,
    by: by?.id ?? -1,
    amount: n,
    soaked,
    lost: Math.min(n - soaked, had),
    before: Math.max(n, Math.round(raw)),
    kind,
    source,
    hard,
    hp: Math.max(0, target.hp),
    shield: target.shield,
  });
  if (soaked > 0 && target.shield === 0) {
    emit(f, { t: "status", id: target.id, status: "shield", on: false, ticks: 0, amount: 0, by: -1 });
  }
  if (direct && by && by.ember > 0 && target.hp > 0) burn(f, target, by.ember, by);
  if (target.hp <= 0) fall(f, target, by);
  else answer(f, target);
  return n;
}

/** What a figure does about having been hurt and still being up. */
function answer(f: Fight, u: Unit): void {
  if (u.digs && u.hp * 2 < u.maxHp) {
    // Burrow: the first time under half health, it digs in where it stands and keeps fighting.
    u.digs = false;
    heal(f, u, (u.maxHp * u.digHeal) / 100, "burrow", null);
    brace(f, u, u.digLess, 0, u.digFor);
  }
  if (u.logUnder > 0 && u.hp * 100 < u.maxHp * u.logUnder) {
    // Hollow Log: once, it climbs inside.
    const worth = (u.maxHp * u.logShield) / 100;
    u.logUnder = 0;
    emit(f, { t: "item", id: u.id, item: "hollowlog" });
    shieldUp(f, u, worth, u.logFor, null);
  }
  if (u.kind === "bigcrab" && !u.called && u.hp * 2 < u.maxHp) {
    // The big crab calls the roll.
    u.called = true;
    const crabs = abilityNumber("bigcrab", "crabs", u.stars);
    for (let i = 0; i < crabs; i++) summon(f, "uncounted", 2, u.side, freeNear(f, u.cell), u);
  }
}

function fall(f: Fight, u: Unit, by: Unit | null): void {
  if (f.wind[u.side] && !u.summoned) {
    // Second Wind: the first to fall gets back up, with whatever was on it shaken off.
    f.wind[u.side] = false;
    u.hp = Math.max(1, Math.round((u.maxHp * boonNumber("secondwind", "health")) / 100));
    u.burnUntil = 0;
    u.stunUntil = 0;
    u.slowUntil = 0;
    u.tauntUntil = 0;
    emit(f, { t: "rise", id: u.id, hp: u.hp });
    return;
  }
  u.alive = false;
  u.hp = 0;
  u.shield = 0;
  if (f.taken[u.cell] === u.id) f.taken[u.cell] = -1;
  f.standing[u.side]--;
  emit(f, { t: "fall", id: u.id, by: by?.id ?? -1, cell: u.cell });
  if (u.kind === "toadstool") {
    // It puffs as it goes: said as an ability, so that a screen can show the spores spreading.
    const spores = powered(u, abilityNumber("toadstool", "damage", u.stars));
    const caught = foesWithin(f, u.side, u.cell, 2);
    emit(f, {
      t: "cast",
      id: u.id,
      kind: u.kind,
      name: specOf(u.kind).ability?.name ?? "",
      shape: "ring",
      cells: [u.cell, ...within(u.cell, 2)],
      targets: caught.map((o) => o.id),
      ticks: 0,
    });
    for (const o of caught) hurt(f, o, spores, "magic", "ability", u);
  }
}

export { other as otherSide };
