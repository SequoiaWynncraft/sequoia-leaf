/**
 * The small verbs a fight is written in: hurt, heal, shield, stun, slow, burn, crack, taunt, hide,
 * leap, knock back, summon, give mana, and "this lands in a moment". Attacks, abilities, traits and items are all
 * made of these, and each one writes down what it did as an event. Where a verb is a moment for
 * hooks (an enemy's ability landing, a figure hurt or falling), it asks them (`hooks.ts`) and names
 * nothing it asks.
 */
import type { Catalog } from "../content/catalog.ts";
import type { UnitKind } from "../content/figures.ts";
import { carriedTraits, type ItemId, itemNumber } from "../content/items.ts";
import { FIGHT } from "../content/rooms.ts";
import { traitDraw } from "../content/traits.ts";
import { distance, line, mirror, neighboursFor, type Side } from "../hex.ts";
import { emit, FOREVER, later, secs } from "./clock.ts";
import { whenFalls, whenFell, whenHurt, whenStruck } from "./hooks.ts";
import type { DamageKind, DamageSource, Fight, HealSource, LeapWhy, Unit } from "./types.ts";

export { emit, flight, FOREVER, HZ, later, secs } from "./clock.ts";
export { enter, freeNear, getUp, lastFallen, type Start, summon } from "./enter.ts";

/** An amount made bigger by its owner's ability power. */
export const powered = (u: Unit, amount: number): number => (amount * u.power) / 100;
/**
 * Whether a figure is there for anyone else at all: up, and not hidden (underground, up the tree,
 * playing dead, in a shell or a bubble). The one rule for hiding: nothing else, foe or friend, aims
 * at, hits, heals, shields, gives mana to, moves, pushes, pulls, cracks or slows one that is not;
 * and it does not act.
 */
export const targetable = (f: Fight, u: Unit): boolean => u.alive && u.hiddenUntil <= f.tick;
/**
 * Whether what `by` does reaches a figure: the hiding rule (`targetable`), but what a figure does to
 * itself, or has of itself (given by nobody: an item's shield, a burrow's healing), reaches it hidden.
 */
export const reaches = (f: Fight, u: Unit, by: Unit | null): boolean =>
  by === null || by.id === u.id ? u.alive : targetable(f, u);
/** Whether what an enemy's ability lands on a figure is blocked (`struck`). A friend's never is. */
export const blocks = (f: Fight, target: Unit, by: Unit | null): boolean =>
  by !== null && by.side !== target.side && whenStruck(f, target, by);
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
/** Everyone on a side a friend can reach: up, and not hidden. */
export function alliesOf(f: Fight, side: Side): Unit[] {
  const out: Unit[] = [];
  for (const o of f.units) if (o.side === side && targetable(f, o)) out.push(o);
  return out;
}
/**
 * A figure's draw: what the callings it carries (its own, and any an item grants) and the items it
 * holds add up to, kept between the fight's least and most. The forest's own carry no calling, so
 * theirs is 0.
 */
export function drawOf(cat: Catalog, kind: UnitKind, items: readonly ItemId[]): number {
  let draw = 0;
  for (const t of carriedTraits(cat, kind, items)) draw += traitDraw(t);
  for (const item of items) draw += itemNumber(cat, item, "draw");
  return Math.min(FIGHT.drawMost, Math.max(FIGHT.drawLeast, draw));
}
/** The enemy nearest a figure, whatever its draw; ties go to the hex that comes first for its side. */
export function nearestFoe(f: Fight, u: Unit): Unit | undefined {
  let best: Unit | undefined;
  let bestAway = 99;
  let bestOrder = 0;
  for (const o of f.units) {
    if (o.side === u.side || !targetable(f, o)) continue;
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
    if (o.side === u.side || !targetable(f, o)) continue;
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
    if (o.side !== side && targetable(f, o) && distance(cell, o.cell) <= steps) out.push(o);
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
/** A side's own a friend can reach, most hurt first (by share of health left). With `hurtOnly`, those at full health are left out. */
export function mostHurt(f: Fight, side: Side, hurtOnly: boolean): Unit[] {
  const out: Unit[] = [];
  for (const o of f.units) {
    if (o.side === side && targetable(f, o) && (!hurtOnly || o.hp < o.maxHp)) out.push(o);
  }
  return out.toSorted((a, b) => a.hp * b.maxHp - b.hp * a.maxHp || a.id - b.id);
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
/** Pushes a figure straight away from whoever pushes it, as far as there are free hexes, up to a number. A Rock stays; so does anything too big. */
export function knockBack(f: Fight, target: Unit, by: Unit, hexes: number): number {
  if (!reaches(f, target, by) || target.rooted || target.steady || hexes <= 0) return 0;
  const from = by.cell;
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
  if (to < 0 || blocks(f, target, by)) return 0;
  leap(f, target, to, "knocked");
  return moved;
}

// ---------- mana ----------

export function gainMana(u: Unit, amount: number): void {
  if (u.manaFull > 0 && u.alive) u.mana = Math.min(u.manaFull, u.mana + amount);
}
/**
 * Mana from a friend's ability: never to its giver, never to one with no mana bar, and at most
 * `FIGHT.giftMost` received by one figure in any `FIGHT.giftOver` seconds, whoever gives it. Gives
 * back what it received.
 */
export function giveMana(f: Fight, to: Unit, n: number, by: Unit): number {
  if (to.id === by.id || to.manaFull <= 0 || !reaches(f, to, by) || n <= 0) return 0;
  to.gifts = to.gifts.filter((g) => f.tick - g.at < secs(FIGHT.giftOver));
  const given = to.gifts.reduce((sum, g) => sum + g.n, 0);
  const amount = Math.min(n, FIGHT.giftMost - given);
  if (amount <= 0) return 0;
  // What it received, which a full bar may make less than what it was given: that is what counts.
  const had = to.mana;
  gainMana(to, amount);
  const got = to.mana - had;
  if (got > 0) to.gifts.push({ at: f.tick, n: got });
  return got;
}

// ---------- cracking ----------

/**
 * Cracks a figure: `n` less armour and `n` less ward for the rest of the fight, never below 0. Its
 * `cracked` is the total asked for, which Grooter's own cracking stops at (`crackMost`), and which
 * it says as a status.
 */
export function crack(f: Fight, target: Unit, n: number, by: Unit | null): void {
  // Only on one a hit can land on: never the fallen, nor one nothing can reach (hidden).
  if (!targetable(f, target) || n <= 0) return;
  target.armour = Math.max(0, target.armour - n);
  target.ward = Math.max(0, target.ward - n);
  target.cracked += n;
  emit(f, {
    t: "status",
    id: target.id,
    status: "cracked",
    on: true,
    ticks: 0,
    amount: target.cracked,
    by: by?.id ?? -1,
  });
}

// ---------- statuses ----------

export function stun(f: Fight, target: Unit, seconds: number, by: Unit | null): void {
  if (!targetable(f, target)) return;
  let ticks = secs(seconds);
  if (target.steady) ticks = Math.round(ticks / 2);
  if (target.stunCut > 0) ticks = Math.round((ticks * (100 - target.stunCut)) / 100);
  const until = f.tick + ticks;
  if (ticks <= 0 || until <= target.stunUntil || blocks(f, target, by)) return;
  target.stunUntil = until;
  emit(f, { t: "status", id: target.id, status: "stun", on: true, ticks, amount: 0, by: by?.id ?? -1 });
}
export function slow(f: Fight, target: Unit, percent: number, seconds: number, by: Unit | null): void {
  if (!targetable(f, target) || percent <= 0 || blocks(f, target, by)) return;
  const ticks = secs(seconds);
  const running = target.slowUntil > f.tick;
  target.slowBy = running ? Math.max(target.slowBy, percent) : percent;
  target.slowUntil = Math.max(target.slowUntil, f.tick + ticks);
  emit(f, { t: "status", id: target.id, status: "slow", on: true, ticks, amount: target.slowBy, by: by?.id ?? -1 });
}
/**
 * Sets something alight: a share of its health every second, and weaker healing meanwhile, for as
 * long as a burn lasts (`Fight.burning`). Burning again keeps the hotter fire.
 */
export function burn(f: Fight, target: Unit, percent: number, by: Unit | null): void {
  if (!reaches(f, target, by) || percent <= 0) return;
  const burnFor = f.burning.lasts;
  const running = target.burnUntil > f.tick;
  const hotter = !running || percent > target.burnBy;
  target.burnBy = running ? Math.max(target.burnBy, percent) : percent;
  target.burnUntil = f.tick + burnFor;
  target.burnDamp = f.burning.damp;
  if (by) target.burnFrom = by.id;
  if (hotter) {
    emit(f, {
      t: "status",
      id: target.id,
      status: "burn",
      on: true,
      ticks: burnFor,
      amount: target.burnBy,
      by: by?.id ?? -1,
    });
  }
}
export function taunt(f: Fight, target: Unit, seconds: number, by: Unit): void {
  if (!targetable(f, target) || blocks(f, target, by)) return;
  const ticks = secs(seconds);
  target.tauntUntil = f.tick + ticks;
  target.tauntBy = by.id;
  target.target = by.id;
  emit(f, { t: "status", id: target.id, status: "taunt", on: true, ticks, amount: 0, by: by.id });
}
export function haste(f: Fight, target: Unit, percent: number, seconds: number, by: Unit | null): void {
  if (!targetable(f, target) || percent <= 0) return;
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
/** Goes where nothing can reach it for a while: of itself, or put there by a friend (`by`, Yule's bubble). */
export function hide(f: Fight, u: Unit, ticks: number, by: Unit = u): void {
  if (!u.alive || ticks <= 0) return;
  u.hiddenUntil = f.tick + ticks;
  u.tauntUntil = 0;
  emit(f, { t: "status", id: u.id, status: "hidden", on: true, ticks, amount: 0, by: by.id });
}

// ---------- healing and shields ----------

export function heal(f: Fight, target: Unit, raw: number, source: HealSource, by: Unit | null): number {
  if (!reaches(f, target, by) || raw <= 0) return 0;
  const mended = by !== null && by.mending > 0 && (source === "ability" || source === "item");
  let amount = raw;
  if (mended) amount *= 1 + by.mending / 100;
  if (target.burnUntil > f.tick) amount *= 1 - target.burnDamp / 100;
  const n = Math.min(Math.round(amount), target.maxHp - target.hp);
  if (mended) overflow(f, target, amount - Math.max(0, n), by);
  if (n <= 0) return 0;
  target.hp += n;
  target.healed += n;
  emit(f, { t: "heal", id: target.id, by: by?.id ?? -1, amount: n, source, hp: target.hp });
  return n;
}
/**
 * Healing past a friend's full health becomes a shield for a while (Mender at its top step), up to a
 * share of that friend's health (the healer's `overheal`), shields already on it counted.
 */
function overflow(f: Fight, target: Unit, extra: number, by: Unit): void {
  const room = Math.floor((target.maxHp * by.overheal) / 100 - target.shield);
  // The healer's shield: theirs to count, already as strong as Mender makes it.
  if (Math.min(extra, room) >= 1) shieldOn(f, target, Math.round(Math.min(extra, room)), by.overhealFor, by);
}
/** Puts a shield up, or adds to the one there. `seconds` of 0 lasts until it is broken. */
export function shieldUp(f: Fight, target: Unit, raw: number, seconds: number, by: Unit | null): number {
  if (!reaches(f, target, by)) return 0;
  let amount = raw;
  if (by && by.mending > 0) amount *= 1 + by.mending / 100;
  return shieldOn(f, target, Math.round(amount), seconds, by);
}
/** Puts a shield of `n` up as it is, given by `by` (nobody for one a figure has of itself), on its own clock, and says so. */
function shieldOn(f: Fight, target: Unit, n: number, seconds: number, by: Unit | null): number {
  if (n <= 0) return 0;
  const ticks = secs(seconds);
  target.shields.push({ left: n, until: ticks <= 0 ? FOREVER : f.tick + ticks });
  target.shield += n;
  emit(f, { t: "shield", id: target.id, by: by?.id ?? -1, amount: n, shield: target.shield, ticks });
  return n;
}

/** Takes up to `n` off a figure's shields, the one that runs out soonest first; gives back what they took. */
function soak(u: Unit, n: number): number {
  let left = n;
  for (const g of u.shields.toSorted((a, b) => a.until - b.until)) {
    const took = Math.min(g.left, left);
    g.left -= took;
    left -= took;
  }
  u.shields = u.shields.filter((g) => g.left > 0);
  u.shield -= n - left;
  return n - left;
}
/** The shields whose clocks run out at this step go, each on its own. Gives back whether that left it with none. */
export function shieldsRunOut(f: Fight, u: Unit): boolean {
  const going = u.shields.filter((g) => g.until <= f.tick);
  if (going.length === 0) return false;
  u.shields = u.shields.filter((g) => g.until > f.tick);
  for (const g of going) u.shield -= g.left;
  return u.shield <= 0;
}

/**
 * Gives a group one shield to share (`Pool`), worth `left`, which comes back once `wait` seconds
 * after it breaks, worth `back` percent of the health of those of it still up (0: never).
 */
export function poolUp(f: Fight, group: readonly Unit[], left: number, back: number, wait: number): void {
  if (group.length === 0 || left <= 0) return;
  const at = f.pools.length;
  const ids = group.map((u) => u.id);
  f.pools.push({ left: Math.round(left), ids, back, wait: secs(wait) });
  for (const u of group) u.pool = at;
  emit(f, { t: "pool", group: at, ids: [...ids], left: Math.round(left), on: true });
}
/** What a figure's group's shield takes of a hit of `n`: all of it while it holds that much. Gives back what it took. */
function drain(f: Fight, u: Unit, n: number): number {
  const pool = f.pools[u.pool];
  if (!pool || pool.left <= 0 || n <= 0) return 0;
  const took = Math.min(pool.left, n);
  pool.left -= took;
  const group = u.pool;
  emit(f, { t: "pool", group, ids: [...pool.ids], left: pool.left, on: pool.left > 0 });
  if (pool.left === 0 && pool.back > 0) {
    const back = pool.back;
    pool.back = 0;
    later(f, pool.wait, () => {
      const up = pool.ids.flatMap((id) => {
        const o = f.units[id];
        return o?.alive ? [o] : [];
      });
      pool.left = Math.round((up.reduce((sum, o) => sum + o.maxHp, 0) * back) / 100);
      if (pool.left > 0) emit(f, { t: "pool", group, ids: [...pool.ids], left: pool.left, on: true });
    });
  }
  return took;
}

// ---------- hurting ----------

/** The armour a hit of a kind meets: an attack by one that pierces meets less of it. */
const armourAgainst = (target: Unit, by: Unit | null, source: DamageSource): number =>
  by && by.pierce > 0 && source === "attack" ? target.armour * (1 - by.pierce / 100) : target.armour;

/**
 * Lands damage. Physical damage meets armour and magic meets ward (damage x 100 / (100 + defence));
 * true damage meets nothing. A shield takes it first. Gives back what the target lost. An enemy's
 * ability may be blocked (`struck`), and then nothing of it lands.
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
  if (!targetable(f, target) || raw <= 0) return 0;
  if (source === "ability" && blocks(f, target, by)) return 0;
  const direct = source === "attack" || source === "ability";
  let amount = raw;
  if (kind === "physical") {
    amount = (amount * 100) / (100 + Math.max(0, armourAgainst(target, by, source)));
  } else if (kind === "magic") {
    amount = (amount * 100) / (100 + Math.max(0, target.ward));
  }
  if (direct && target.bracedUntil > f.tick) amount *= 1 - target.bracedBy / 100;
  const n = Math.max(1, Math.round(amount));
  let soaked = 0;
  const shielded = target.shield > 0;
  if (shielded) soaked = soak(target, n);
  soaked += drain(f, target, n - soaked);
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
  if (shielded && target.shield === 0) {
    emit(f, { t: "status", id: target.id, status: "shield", on: false, ticks: 0, amount: 0, by: -1 });
  }
  if (direct && by && target.hp > 0) leaves(f, target, by);
  if (target.hp <= 0) fall(f, target, by);
  else whenHurt(f, target);
  return n;
}

/** What an attack or ability leaves on whoever it hit, still up: Ember's burn, and Grooter's crack up to its most. */
function leaves(f: Fight, target: Unit, by: Unit): void {
  if (by.ember > 0) burn(f, target, by.ember, by);
  if (by.crack > 0 && target.cracked < by.crackMost)
    crack(f, target, Math.min(by.crack, by.crackMost - target.cracked), by);
}

/** Falls, unless what touches it gets it back up (`falls`); a figure getting back up in a moment still counts as standing. */
function fall(f: Fight, u: Unit, by: Unit | null): void {
  const rise = whenFalls(f, u);
  if (rise?.up === "now") return;
  const back = rise?.back ?? 0;
  u.alive = false;
  u.downs++;
  u.hp = 0;
  u.shield = 0;
  u.shields = [];
  if (f.taken[u.cell] === u.id) f.taken[u.cell] = -1;
  if (back === 0) {
    f.standing[u.side]--;
    u.fellAt = f.tick;
    u.fallNo = ++f.falls;
  }
  emit(f, { t: "fall", id: u.id, by: by?.id ?? -1, cell: u.cell, ...(back > 0 && { back }) });
  whenFell(f, u);
}

export { other as otherSide };
