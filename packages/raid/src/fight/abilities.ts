/**
 * What each ability does on the board, keyed by whose it is. The names, sentences and numbers are
 * in `content/figures.ts`; each function here is that sentence carried out with the verbs from
 * `core.ts`. One gives back false when there is nothing to use it on yet, and the figure keeps its
 * mana and carries on until there is.
 *
 * An ability works out how strong it is once, as it is used. Whatever it sends on its way lands
 * with that strength: what happens to its owner after (a Fairy Ring growing, a fall) does not
 * change it.
 */
import { abilityNumber, specOf, type UnitKind } from "../content/figures.ts";
import { cone, distance, line, neighbours, within } from "../hex.ts";
import {
  alliesOf,
  brace,
  drawnFoe,
  emit,
  farthestFoe,
  flight,
  foesByDistance,
  foesOf,
  foesOn,
  foesWithin,
  freeBeside,
  freeNear,
  haste,
  heal,
  hurt,
  knockBack,
  later,
  leap,
  mostHurt,
  nearestFoe,
  powered,
  secs,
  shieldUp,
  slow,
  stun,
  summon,
  targetable,
  taunt,
} from "./core.ts";
import type { Fight, Unit } from "./types.ts";

/** An ability: the fight, whose it is, and its numbers at that figure's stars by name. */
export type Cast = (f: Fight, u: Unit, n: (name: string) => number) => boolean;

const ids = (units: readonly Unit[]): number[] => units.map((o) => o.id);

/**
 * Who a figure's ability is aimed at when the sentence says "its target": whoever it is attacking,
 * if in reach, else whoever it would pick to attack (draw counted), if that one is in reach.
 */
export function aim(f: Fight, u: Unit): Unit | undefined {
  const current = u.target >= 0 ? f.units[u.target] : undefined;
  if (current && current.side !== u.side && targetable(f, current) && distance(u.cell, current.cell) <= u.range) {
    return current;
  }
  const picked = drawnFoe(f, u);
  return picked && distance(u.cell, picked.cell) <= u.range ? picked : undefined;
}
/** Announces an ability: the hexes it covers, who it is aimed at, and how long before it lands. */
function say(f: Fight, u: Unit, cells: number[], targets: number[], ticks: number): void {
  const ability = specOf(u.kind).ability;
  emit(f, {
    t: "cast",
    id: u.id,
    kind: u.kind,
    name: ability?.name ?? "",
    shape: ability?.shape ?? "bolt",
    cells,
    targets,
    ticks,
  });
}
/** Throws something at somebody: it flies, and `land` happens when it arrives. At oneself, it happens at once. */
function send(f: Fight, u: Unit, from: number, target: Unit, land: () => void, wait = 0): void {
  if (target.id === u.id && wait === 0) {
    land();
    return;
  }
  const ticks = flight(from, target.cell) + wait;
  emit(f, { t: "shot", id: u.id, target: target.id, from, to: target.cell, ticks, what: "ability" });
  later(f, ticks, land);
}
/** Touching hexes, with the middle one first. */
const around = (cell: number): number[] => [cell, ...neighbours(cell)];
/** Every hex within some steps of one, the middle one first: what an ability that spreads out covers. */
const spread = (cell: number, steps: number): number[] => (steps === 1 ? around(cell) : [cell, ...within(cell, steps)]);

/** Everything touching it: damage, and something on top for each one hurt. */
function splash(
  f: Fight,
  u: Unit,
  steps: number,
  damage: number,
  kind: "physical" | "magic",
  each: (o: Unit) => void,
): number {
  const foes = foesWithin(f, u.side, u.cell, steps);
  if (foes.length === 0) return -1;
  say(f, u, spread(u.cell, steps), ids(foes), 0);
  let total = 0;
  for (const o of foes) {
    total += hurt(f, o, damage, kind, "ability", u);
    each(o);
  }
  return total;
}
/** Somewhere to land beside an enemy: where it already stands if they touch, else a free hex on the far side, else the nearest free hex. */
function landingBy(f: Fight, u: Unit, target: Unit): number {
  if (distance(u.cell, target.cell) <= 1) return u.cell;
  const beside = freeBeside(f, u.side, target.cell, u.cell);
  if (beside >= 0) return beside;
  const near = freeNear(f, target.cell, 2);
  return near >= 0 ? near : u.cell;
}

export const CASTS: Partial<Record<UnitKind, Cast>> = {
  // ---------- one acorn ----------
  emberkit: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    const reach = distance(u.cell, t.cell);
    const cells = line(u.cell, t.cell, reach + 1).slice(reach - 1);
    const hit = foesOn(f, u.side, cells);
    say(f, u, cells, ids(hit), 0);
    for (const o of hit) hurt(f, o, powered(u, n("damage")), "magic", "ability", u);
    return true;
  },
  mossmote: (f, u, n) => {
    const t = mostHurt(f, u.side, false)[0];
    if (!t) return false;
    const shield = powered(u, n("shield"));
    say(f, u, [t.cell], [t.id], t.id === u.id ? 0 : flight(u.cell, t.cell));
    send(f, u, u.cell, t, () => shieldUp(f, t, shield, n("lasts"), u));
    return true;
  },
  moth: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    const damage = powered(u, n("damage"));
    say(f, u, around(t.cell), [t.id], flight(u.cell, t.cell));
    send(f, u, u.cell, t, () => {
      for (const o of foesWithin(f, u.side, t.cell, 1)) hurt(f, o, damage, "magic", "ability", u);
    });
    return true;
  },
  worm: (f, u, n) => {
    const far = farthestFoe(f, u);
    if (!far) return false;
    const to = landingBy(f, u, far);
    // With nowhere to come up beside it, it bites whoever is in reach instead.
    const t = distance(to, far.cell) <= 1 ? far : aim(f, u);
    if (!t) return false;
    say(f, u, [t === far ? to : u.cell], [t.id], 0);
    if (t === far) leap(f, u, to, "ability");
    u.target = t.id;
    hurt(f, t, powered(u, n("damage")), "physical", "ability", u);
    return true;
  },
  finch: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    const damage = powered(u, n("damage"));
    say(f, u, [t.cell], [t.id], flight(u.cell, t.cell));
    for (let i = 0; i < n("seeds"); i++) {
      send(f, u, u.cell, t, () => hurt(f, t, damage, "physical", "ability", u), i * 2);
    }
    return true;
  },
  crab7: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    say(f, u, [t.cell], [t.id], 0);
    hurt(f, t, powered(u, n("damage")), "physical", "ability", u);
    stun(f, t, n("stun"), u);
    return true;
  },
  barrowgnome: (f, u, n) => {
    const foes = foesWithin(f, u.side, u.cell, 1);
    say(f, u, around(u.cell), ids(foes), 0);
    shieldUp(f, u, powered(u, n("shield")), n("lasts"), u);
    for (const o of foes) hurt(f, o, powered(u, n("damage")), "physical", "ability", u);
    return true;
  },

  // ---------- two acorns ----------
  kettle: (f, u, n) => {
    const t = mostHurt(f, u.side, true)[0];
    if (!t) return false;
    const amount = powered(u, n("heal"));
    say(f, u, [t.cell], [t.id], t.id === u.id ? 0 : flight(u.cell, t.cell));
    send(f, u, u.cell, t, () => heal(f, t, amount, "ability", u));
    return true;
  },
  slug: (f, u, n) =>
    splash(f, u, 1, powered(u, n("damage")), "magic", (o) => slow(f, o, n("slow"), n("lasts"), u)) >= 0,
  glorp: (f, u, n) => {
    const cell = freeNear(f, u.cell, 2);
    if (cell < 0) return false;
    say(f, u, [cell], [], 0);
    summon(f, "glorplet", u.stars, u.side, cell, u, {
      hp: powered(u, n("health")),
      attack: powered(u, n("attack")),
    });
    return true;
  },
  chickaree: (f, u, n) => {
    const t = farthestFoe(f, u);
    if (!t) return false;
    const damage = powered(u, n("damage"));
    say(f, u, [t.cell], [t.id], flight(u.cell, t.cell));
    send(f, u, u.cell, t, () => {
      hurt(f, t, damage, "physical", "ability", u);
      stun(f, t, n("stun"), u);
    });
    return true;
  },
  jay: (f, u, n) => {
    say(f, u, [u.cell], [u.id], 0);
    haste(f, u, powered(u, n("haste")), n("lasts"), u);
    return true;
  },
  crab12: (f, u, n) => {
    const first = aim(f, u);
    if (!first) return false;
    const damage = powered(u, n("damage"));
    const struck = new Set<number>();
    say(f, u, [first.cell], [first.id], flight(u.cell, first.cell));
    const skip = (from: number, t: Unit, left: number): void => {
      struck.add(t.id);
      send(f, u, from, t, () => {
        hurt(f, t, damage, "physical", "ability", u);
        if (left <= 0) return;
        const next = foesByDistance(f, u.side, t.cell).find((o) => !struck.has(o.id) && distance(t.cell, o.cell) <= 2);
        if (next) skip(t.cell, next, left - 1);
      });
    };
    skip(u.cell, first, n("skips"));
    return true;
  },
  lanterngnome: (f, u, n) => {
    const lit = foesByDistance(f, u.side, u.cell).slice(0, n("count"));
    if (lit.length === 0) return false;
    const damage = powered(u, n("damage"));
    say(
      f,
      u,
      lit.map((o) => o.cell),
      ids(lit),
      flight(u.cell, lit[0]?.cell ?? u.cell),
    );
    for (const o of lit) send(f, u, u.cell, o, () => hurt(f, o, damage, "magic", "ability", u));
    return true;
  },

  // ---------- three acorns ----------
  leafling: (f, u, n) => {
    // A Rock is glad of the advice, and still does nothing.
    const pupils = alliesOf(f, u.side)
      .filter((o) => o.id !== u.id && o.attack0 > 0)
      .toSorted((a, b) => distance(u.cell, a.cell) - distance(u.cell, b.cell) || a.id - b.id)
      .slice(0, n("count"));
    const taught = pupils.length > 0 ? pupils : [u];
    say(
      f,
      u,
      taught.map((o) => o.cell),
      ids(taught),
      0,
    );
    for (const o of taught) {
      const amount = Math.round((o.attack0 * powered(u, n("attack"))) / 100);
      o.attack += amount;
      emit(f, { t: "boost", id: o.id, by: u.id, stat: "attack", amount });
    }
    return true;
  },
  cindernewt: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    const cells = cone(u.cell, t.cell, Math.max(2, distance(u.cell, t.cell)));
    const hit = foesOn(f, u.side, cells);
    say(f, u, cells, ids(hit), 0);
    for (const o of hit) hurt(f, o, powered(u, n("damage")), "magic", "ability", u);
    return true;
  },
  drizzlefrog: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    const damage = powered(u, n("damage"));
    say(f, u, [t.cell], [t.id], flight(u.cell, t.cell));
    send(f, u, u.cell, t, () => {
      hurt(f, t, damage, "magic", "ability", u);
      slow(f, t, n("slow"), n("lasts"), u);
    });
    return true;
  },
  rock: (f, u, n) => {
    say(f, u, [u.cell], [u.id], 0);
    brace(f, u, n("less"), powered(u, n("stub")), n("lasts"));
    return true;
  },
  bushgnome: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    const busy = t.target !== u.id;
    say(f, u, [t.cell], [t.id], 0);
    hurt(f, t, powered(u, n("damage")) * (busy ? 1.5 : 1), "physical", "ability", u);
    return true;
  },
  crab23: (f, u, n) => {
    const hurting = mostHurt(f, u.side, true).slice(0, n("count"));
    if (hurting.length === 0) return false;
    const amount = powered(u, n("heal"));
    say(
      f,
      u,
      hurting.map((o) => o.cell),
      ids(hurting),
      flight(u.cell, hurting[0]?.cell ?? u.cell),
    );
    for (const o of hurting) send(f, u, u.cell, o, () => heal(f, o, amount, "ability", u));
    return true;
  },

  // ---------- four acorns ----------
  badger: (f, u, n) => {
    const landed = splash(f, u, 1, powered(u, n("damage")), "physical", () => {});
    if (landed < 0) return false;
    heal(f, u, (landed * n("leech")) / 100, "ability", u);
    return true;
  },
  fogowl: (f, u, n) => {
    const t = farthestFoe(f, u);
    if (!t) return false;
    const to = landingBy(f, u, t);
    say(f, u, [to], [t.id], 0);
    leap(f, u, to, "ability");
    u.target = t.id;
    hurt(f, t, powered(u, n("damage")), "physical", "ability", u);
    stun(f, t, n("stun"), u);
    return true;
  },
  heron: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    const cells = line(u.cell, t.cell, n("length"));
    const hit = foesOn(f, u.side, cells);
    say(f, u, cells, ids(hit), 0);
    for (const o of hit) hurt(f, o, powered(u, n("damage")), "physical", "ability", u);
    return true;
  },
  crab40: (f, u, n) => {
    const foes = foesWithin(f, u.side, u.cell, 2);
    say(f, u, spread(u.cell, 2), ids(foes), 0);
    shieldUp(f, u, powered(u, n("shield")), n("lasts"), u);
    for (const o of foes) taunt(f, o, n("taunt"), u);
    return true;
  },
  apothecary: (f, u, n) => {
    const dosed = alliesOf(f, u.side).filter((o) => distance(u.cell, o.cell) <= 2);
    say(f, u, spread(u.cell, 2), ids(dosed), 0);
    for (const o of dosed) {
      heal(f, o, powered(u, n("heal")), "ability", u);
      haste(f, o, n("haste"), n("lasts"), u);
    }
    return true;
  },

  // ---------- five acorns ----------
  greg: (f, u, n) => splash(f, u, 2, powered(u, n("damage")), "magic", (o) => stun(f, o, n("stun"), u)) >= 0,
  whitefox: (f, u, n) => {
    if (splash(f, u, 2, powered(u, n("damage")), "magic", () => {}) < 0) return false;
    for (const o of alliesOf(f, u.side)) haste(f, o, powered(u, n("haste")), n("lasts"), u);
    return true;
  },
  hearthcat: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    say(f, u, [t.cell], [t.id], 0);
    hurt(f, t, powered(u, n("damage")), "physical", "ability", u);
    knockBack(f, t, u.cell, n("push"));
    stun(f, t, n("stun"), u);
    return true;
  },

  // ---------- a banner's member ----------
  "banner-1": (f, u, n) => {
    // The enemy who has dealt the least so far, anywhere on the board; of those level, the nearest.
    const t = foesByDistance(f, u.side, u.cell).reduce<Unit | undefined>(
      (least, o) => (least === undefined || o.dealt < least.dealt ? o : least),
      undefined,
    );
    if (!t) return false;
    const damage = powered(u, n("damage"));
    const touching = powered(u, n("splash"));
    say(f, u, around(t.cell), [t.id], secs(1));
    stun(f, t, n("stun"), u);
    // It lands where they are by then, if the stun has worn off and they have moved.
    later(f, secs(1), () => {
      hurt(f, t, damage, "magic", "ability", u);
      for (const o of foesWithin(f, u.side, t.cell, 1)) if (o.id !== t.id) hurt(f, o, touching, "magic", "ability", u);
    });
    return true;
  },

  // ---------- the forest's trouble ----------
  wasp: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    say(f, u, [t.cell], [t.id], 0);
    hurt(f, t, powered(u, n("damage")), "true", "ability", u);
    return true;
  },
  puddle: (f, u, n) =>
    splash(f, u, 1, powered(u, n("damage")), "magic", (o) => slow(f, o, n("slow"), n("lasts"), u)) >= 0,
  gust: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    const damage = powered(u, n("damage"));
    say(f, u, [t.cell], [t.id], flight(u.cell, t.cell));
    send(f, u, u.cell, t, () => {
      hurt(f, t, damage, "magic", "ability", u);
      knockBack(f, t, u.cell, n("push"));
      slow(f, t, n("slow"), n("lasts"), u);
    });
    return true;
  },
  magpie: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    say(f, u, [t.cell], [t.id], 0);
    hurt(f, t, powered(u, n("damage")) * (t.items.length > 0 ? 1.5 : 1), "physical", "ability", u);
    return true;
  },
  mud: (f, u, n) => splash(f, u, 1, powered(u, n("damage")), "magic", (o) => stun(f, o, n("stun"), u)) >= 0,
  oldbramble: (f, u, n) => {
    let runners = 0;
    for (const o of f.units) if (o.alive && o.kind === "sprout" && o.owner === u.id) runners++;
    if (runners >= n("most")) return false;
    const near = nearestFoe(f, u);
    const beside = near ? freeBeside(f, u.side, near.cell, near.cell) : -1;
    const cell = beside >= 0 ? beside : freeNear(f, u.cell, 3);
    if (cell < 0) return false;
    say(f, u, [cell], [], 0);
    summon(f, "sprout", u.stars, u.side, cell, u);
    return true;
  },
  hoardmagpie: (f, u, n) => {
    const t = foesOf(f, u.side).toSorted(
      (a, b) =>
        b.items.length - a.items.length ||
        b.stars - a.stars ||
        distance(u.cell, b.cell) - distance(u.cell, a.cell) ||
        a.id - b.id,
    )[0];
    if (!t) return false;
    const to = landingBy(f, u, t);
    say(f, u, [to], [t.id], 0);
    leap(f, u, to, "ability");
    u.target = t.id;
    hurt(f, t, powered(u, n("damage")), "physical", "ability", u);
    stun(f, t, n("stun"), u);
    return true;
  },
  bigcrab: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    const cells = cone(u.cell, t.cell, 2);
    const hit = foesOn(f, u.side, cells);
    say(f, u, cells, ids(hit), 0);
    const amount = Math.round((u.attack0 * n("attack")) / 100);
    u.attack += amount;
    emit(f, { t: "boost", id: u.id, by: u.id, stat: "attack", amount });
    for (const o of hit) hurt(f, o, powered(u, n("damage")), "physical", "ability", u);
    return true;
  },
};

/** Uses a figure's ability, if it has one and there is something to use it on. */
export function cast(f: Fight, u: Unit): boolean {
  const ability = CASTS[u.kind];
  if (!ability) return false;
  return ability(f, u, (name) => abilityNumber(u.kind, name, u.stars));
}
