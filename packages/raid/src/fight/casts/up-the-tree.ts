/**
 * Up The Tree's abilities (5 January 2027), keyed by whose they are, as `abilities.ts` has every
 * other: Vi, Flop, Bhlue, Ace, Unc and Leetanns. Also what they bring besides: Ace's attacks dealt
 * as aces (`dealCard`), the hook a Firewall arms on whoever it walls (`WALL`, at the `struck`
 * moment), the pickaxe's halving of armour (`sunder`), and Canopy's start up the tree (`upTheTree`,
 * at the `seated` moment).
 */
import { specOf, type UnitKind } from "../../content/figures.ts";
import { distance, neighbours, rowOf } from "../../hex.ts";
import { type Cast, ids, say } from "../cast.ts";
import {
  alliesOf,
  blocks,
  emit,
  flight,
  foesByDistance,
  foesWithin,
  gainMana,
  giveMana,
  heal,
  hide,
  hurt,
  knockBack,
  later,
  leap,
  order,
  powered,
  secs,
  shieldUp,
  targetable,
  taunt,
} from "../core.ts";
import { armMore, type Hooks, ownOf, type Switching } from "../hooks.ts";
import { aim, fly } from "../mind.ts";
import { channel, over } from "../moves.ts";
import { attackReach } from "../rules.ts";
import { type DamageKind, type Fight, GEAR, type Gear, type Suit, SUITS, type Unit } from "../types.ts";

// ---------- cards ----------

/** What a club takes off whoever it lands on: mana. */
const CLUB_DRAIN = 15;
/** How much harder a spade lands, in percent. */
const SPADE_MORE = 40;

/** Breaks a tie the same way for both sides: the hex nearer its own side's front. */
const tied = (u: Unit) => (a: Unit, b: Unit) => order(u.side, a.cell) - order(u.side, b.cell);
/**
 * Who a card of a suit goes to, among those in its thrower's reach: spades the enemy with the least
 * health, hearts the most hurt friend, diamonds the enemy with the most armour, clubs the enemy with
 * the most mana. Nobody, with none to pick.
 */
export function cardFor(f: Fight, u: Unit, suit: Suit): Unit | undefined {
  const reach = attackReach(f, u);
  if (suit === "hearts")
    return alliesOf(f, u.side)
      .filter((o) => o.id !== u.id && o.hp < o.maxHp && distance(u.cell, o.cell) <= reach)
      .toSorted((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || tied(u)(a, b))[0];
  const foes = foesWithin(f, u.side, u.cell, reach);
  const by: (o: Unit) => number =
    suit === "spades" ? (o) => o.hp : suit === "diamonds" ? (o) => -o.armour : (o) => -o.mana;
  return foes.toSorted((a, b) => by(a) - by(b) || tied(u)(a, b))[0];
}

/** Lands a card on a figure as an attack or an ability does, of a kind: what it dealt, 0 for a hit that did not land (slipped, blocked, hidden). */
type Lands = (o: Unit, raw: number, kind: DamageKind) => number;

/**
 * What a card does where it lands: hearts heal what it would have done; the rest hurt, a spade
 * harder, a diamond through armour; a club takes mana too, if it landed. One that does not land
 * does nothing.
 */
function landCard(f: Fight, u: Unit, t: Unit, suit: Suit, amount: number, land: Lands): void {
  if (suit === "hearts") {
    heal(f, t, amount, "card", u);
    return;
  }
  const kind = suit === "diamonds" ? "true" : "physical";
  const dealt = land(t, suit === "spades" ? amount * (1 + SPADE_MORE / 100) : amount, kind);
  if (dealt <= 0 || suit !== "clubs" || !t.alive || t.manaFull <= 0) return;
  const taken = Math.min(CLUB_DRAIN, Math.floor(t.mana));
  if (taken <= 0) return;
  t.mana -= taken;
  emit(f, { t: "drain", id: t.id, by: u.id, amount: taken });
}

/** Throws a card of a suit at `t`, `after` steps later than it would fly: a shot that says its suit, landing as the suit says. */
function throwCard(
  f: Fight,
  u: Unit,
  t: Unit,
  card: { suit: Suit; amount: number; after: number },
  what: "attack" | "ability",
  land: Lands,
): void {
  const { suit, amount } = card;
  const ticks = flight(u.cell, t.cell) + card.after;
  emit(f, { t: "shot", id: u.id, target: t.id, from: u.cell, to: t.cell, ticks, what, card: suit });
  if (suit === "hearts") later(f, ticks, () => landCard(f, u, t, suit, amount, land));
  else fly(f, t, amount, suit === "diamonds" ? "true" : "physical", ticks, () => landCard(f, u, t, suit, amount, land));
}

/**
 * Ace's attack, dealt as an ace: the suit is its attack's count in fours, and the card goes to the
 * one its suit picks in its reach, once for each hit the attack has (an item's extra hits too, two
 * steps apart). `land` lands it as an attack does (slips, hard hits, focus, riders), of a kind. False
 * with nobody to pick: then it is a plain attack on its usual target.
 */
export function dealCard(f: Fight, u: Unit, amount: number, hits: number, land: Lands): boolean {
  const suit = SUITS[(u.attacks - 1) % SUITS.length] ?? "spades";
  const to = cardFor(f, u, suit);
  if (!to) return false;
  for (let n = 0; n < hits; n++) throwCard(f, u, to, { suit, amount, after: n * 2 }, "attack", land);
  return true;
}

// ---------- Firewall ----------

/** Whether the Bhlue who gave a figure its wall is still standing: up, and not fallen since. */
const giverStands = (f: Fight, u: Unit): boolean => {
  const giver = f.units[u.walledBy];
  return giver !== undefined && giver.alive && giver.downs === u.wallLife;
};

/**
 * A figure's wall ends at this step if its time is up or the Bhlue who gave it has fallen: gives back
 * whether it did (then the engine says so).
 */
export function wallEnds(f: Fight, u: Unit): boolean {
  if (u.walledUntil <= 0) return false;
  if (u.walledUntil > f.tick && giverStands(f, u)) return false;
  u.walledUntil = 0;
  return true;
}

/**
 * What a Firewall arms on those it walls (`struck`): the first enemy ability to land on one of them
 * while its wall is up and its Bhlue stands is blocked, and so is anything else that enemy lands on
 * it in the same step. Then the wall is gone. Attacks are never asked.
 */
const WALL: Hooks = {
  struck: (f, u, by) => {
    if (u.wallAt === f.tick && u.wallBy === by.id) return true;
    if (u.walledUntil <= f.tick || !giverStands(f, u)) return false;
    u.walledUntil = 0;
    u.wallBy = by.id;
    u.wallAt = f.tick;
    emit(f, { t: "block", id: u.id, by: by.id });
    emit(f, { t: "status", id: u.id, status: "firewall", on: false, ticks: 0, amount: 0, by: by.id });
    return true;
  },
};

// ---------- the pickaxe ----------

/** Halves the armour of a figure the pickaxe landed on for some steps, given back after (`restore` in the engine, up or down); one already halved only stays so longer. */
function sunder(f: Fight, t: Unit, ticks: number, by: Unit): void {
  if (t.sunderedUntil <= f.tick) {
    // One that ran out at this step and is not given back yet is given back first.
    t.armour += t.sundered;
    t.sundered = Math.floor(t.armour / 2);
    t.armour -= t.sundered;
  }
  t.sunderedUntil = f.tick + ticks;
  emit(f, { t: "status", id: t.id, status: "sundered", on: true, ticks, amount: t.sundered, by: by.id });
}

/** The enemy furthest away that the rod can pull onto a free hex beside `u`, and that hex; none for nobody. */
function hooked(f: Fight, u: Unit): { o: Unit; to: number } | null {
  const free = neighbours(u.cell).filter((c) => f.taken[c] === -1);
  for (const o of foesByDistance(f, u.side, u.cell).toReversed()) {
    if (o.rooted || o.steady || distance(u.cell, o.cell) <= 1) continue;
    const to = free.toSorted((a, b) => distance(a, o.cell) - distance(b, o.cell) || a - b)[0];
    if (to !== undefined) return { o, to };
  }
  return null;
}

/** What a tool does as it comes down on `on` (the one it hooks, for the rod), at the numbers of its owner's stars (`n`). */
function swing(f: Fight, u: Unit, tool: Gear, on: { o: Unit; to: number }, n: (name: string) => number): void {
  const t = on.o;
  if (tool === "axe") {
    if (hurt(f, t, powered(u, n("chop")), "physical", "ability", u) > 0) knockBack(f, t, u, n("push"));
  } else if (tool === "pickaxe") {
    if (hurt(f, t, powered(u, n("mine")), "physical", "ability", u) > 0) sunder(f, t, secs(n("lasts")), u);
  } else if (tool === "rod") {
    if (!blocks(f, t, u)) leap(f, t, on.to, "pull");
  } else {
    let reaped = 0;
    for (const o of foesWithin(f, u.side, u.cell, 1))
      reaped += hurt(f, o, powered(u, n("reap")), "physical", "ability", u);
    if (reaped > 0) heal(f, u, (reaped * n("leech")) / 100, "leech", u);
  }
}

// ---------- Canopy ----------

/**
 * Canopy (`seated`): its figures start up the tree, where nothing reaches them, and come down after
 * some seconds with a shield (until it breaks) and mana, or at the top step a full mana bar.
 */
export function upTheTree(f: Fight, { members, v }: Switching): void {
  const up = secs(v("up"));
  for (const u of members) {
    hide(f, u, up);
    later(f, up, () => {
      if (!u.alive) return;
      shieldUp(f, u, (u.maxHp * v("shield")) / 100, 0, null);
      gainMana(u, v("full") > 0 ? u.manaFull : v("mana"));
    });
  }
}

/** What Ace does by being what it is: its attacks are aces. */
export const UP_THE_TREE_KINDS: Readonly<Partial<Record<UnitKind, Hooks>>> = {
  ace: {
    on: (_f, { members }) => {
      for (const u of members) u.deals = "aces";
      return members;
    },
  },
};

export const UP_THE_TREE_CASTS: Partial<Record<UnitKind, Cast>> = {
  // The friend who cast last gets mana back: never itself, never another Vi; with nobody to give to, it waits.
  vi: (f, u, n) => {
    const t = alliesOf(f, u.side)
      .filter((o) => o.id !== u.id && o.kind !== u.kind && o.castAt >= 0 && o.manaFull > 0)
      .toSorted((a, b) => b.castAt - a.castAt || tied(u)(a, b))[0];
    if (!t) return false;
    say(f, u, [t.cell], [t.id], 0);
    giveMana(f, t, n("mana"), u);
    return true;
  },

  // Falls over where nothing reaches it, then gets up with health back, and everyone near has to hit it.
  flop: (f, u, n) => {
    const down = secs(n("down"));
    say(f, u, [u.cell], [u.id], 0);
    hide(f, u, down);
    const life = u.downs;
    later(f, down, () => {
      if (!u.alive || u.downs !== life) return;
      heal(f, u, (u.maxHp * n("heal")) / 100, "ability", u);
      for (const o of foesWithin(f, u.side, u.cell, 2)) taunt(f, o, n("taunt"), u);
    });
    return true;
  },

  // A shield on everyone in its row, and on each the first enemy ability blocked (`WALL`).
  bhlue: (f, u, n) => {
    const row = alliesOf(f, u.side).filter((o) => rowOf(o.cell) === rowOf(u.cell));
    const lasts = secs(n("lasts"));
    say(
      f,
      u,
      row.map((o) => o.cell),
      ids(row),
      0,
    );
    for (const o of row) {
      shieldUp(f, o, powered(u, n("shield")), n("lasts"), u);
      o.walledUntil = f.tick + lasts;
      o.walledBy = u.id;
      o.wallLife = u.downs;
      o.wallBy = -1;
      o.wallAt = -1;
      emit(f, { t: "status", id: o.id, status: "firewall", on: true, ticks: lasts, amount: 0, by: u.id });
    }
    armMore(f, u.side, { from: "ability", hooks: WALL, s: ownOf(f, u), touches: ids(row) });
    return true;
  },

  // All four at once, each to whoever its suit picks; one with nobody to pick goes to its target.
  ace: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    const damage = powered(u, n("damage"));
    const cards = SUITS.map((suit) => ({ suit, to: cardFor(f, u, suit) ?? (suit === "hearts" ? undefined : t) }));
    say(
      f,
      u,
      [],
      cards.flatMap((c) => (c.to ? [c.to.id] : [])),
      0,
    );
    const land: Lands = (o, raw, kind) => hurt(f, o, raw, kind, "ability", u);
    for (const c of cards) if (c.to) throwCard(f, u, c.to, { suit: c.suit, amount: damage, after: 0 }, "ability", land);
    return true;
  },

  // Drums on its target; if it falls, the rest go to the enemy nearest where it fell.
  unc: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    const damage = powered(u, n("damage"));
    const pecks = over(n("lasts"), n("pecks"));
    say(f, u, [t.cell], [t.id], 0, pecks);
    let on = t;
    channel(f, u, pecks, () => {
      if (!targetable(f, on)) {
        // From where it fell (or hid), wherever it had got to since the last peck.
        const next = foesByDistance(f, u.side, on.cell)[0];
        if (!next) return;
        on = next;
      }
      hurt(f, on, damage, "physical", "ability", u);
    });
    return true;
  },

  // The next tool in turn. The rod hooks whoever it can, an enemy in its target's reach or not; with
  // nobody to hook, its turn passes to the scythe. The rest need a target to swing at.
  leetanns: (f, u, n) => {
    let tool = GEAR[u.turn % GEAR.length] ?? "axe";
    const rod = tool === "rod" ? hooked(f, u) : null;
    if (tool === "rod" && !rod) tool = "scythe";
    const t = aim(f, u);
    const on = rod ?? (t ? { o: t, to: t.cell } : null);
    if (!on) return false;
    u.turn = (GEAR.indexOf(tool) + 1) % GEAR.length;
    const hit = tool === "scythe" ? foesWithin(f, u.side, u.cell, 1) : [on.o];
    const cells = tool === "scythe" ? [...neighbours(u.cell)] : [on.o.cell];
    emit(f, {
      t: "cast",
      id: u.id,
      kind: u.kind,
      name: specOf(f.cat, u.kind).ability?.name ?? "",
      shape: "bolt",
      cells,
      targets: ids(hit),
      ticks: 0,
      tool,
    });
    swing(f, u, tool, on, n);
    return true;
  },
};
