/**
 * What each ability does on the board, keyed by whose it is. The names, sentences and numbers are
 * in `content/figures.ts`; each function here is that sentence carried out with the verbs from
 * `core.ts` and `moves.ts`. One gives back false when there is nothing to use it on yet, or it is
 * not worth using yet (`mind.ts`), and the figure keeps its mana and carries on until it is.
 *
 * An ability works out how strong it is once, as it is used. Whatever it sends on its way lands
 * with that strength: what happens to its owner after (a Fairy Ring growing, a fall) does not
 * change it.
 */
import { abilityNumber, type UnitKind } from "../content/figures.ts";
import { formNumber } from "../content/graid.ts";
import { cone, distance, line, neighbours } from "../hex.ts";
import { around, ids, say, spread } from "./cast.ts";
import {
  alliesOf,
  brace,
  emit,
  farthestFoe,
  flight,
  foesByDistance,
  foesOf,
  foesOn,
  foesWithin,
  freeBeside,
  freeNear,
  getUp,
  haste,
  heal,
  hide,
  hurt,
  knockBack,
  lastFallen,
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
import { aim, crowd, drawnFoe, wanted, weakest } from "./mind.ts";
import { busiestHex, channel, dash, dashTo, over, pull, send, telegraph, zone } from "./moves.ts";
import type { Fight, Unit } from "./types.ts";

/** An ability: the fight, whose it is, and its numbers at that figure's stars by name. */
export type Cast = (f: Fight, u: Unit, n: (name: string) => number) => boolean;

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
  if (foes.length === 0 || !crowd(f, u, foes.length)) return -1;
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
    if (!crowd(f, u, hit.length)) return false;
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
    // Real Moth, its true form: the dust covers the hexes two away as well.
    const reach = u.form === "true" ? formNumber("moth", "reach") : 1;
    if (!t || !crowd(f, u, foesOn(f, u.side, spread(t.cell, reach)).length)) return false;
    const damage = powered(u, n("damage"));
    const dust = powered(u, n("dust"));
    say(f, u, spread(t.cell, reach), [t.id], flight(u.cell, t.cell));
    const land = (): void => {
      for (const o of foesWithin(f, u.side, t.cell, reach)) hurt(f, o, damage, "magic", "ability", u);
      zone(f, u, spread(t.cell, reach), "dust", n("lasts"), { damage: dust });
    };
    send(f, u, u.cell, t, land, 0, [damage, "magic"]);
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
    const bite = powered(u, n("damage"));
    hurt(f, t, bite, "physical", "ability", u);
    // Real Worm, its true form: every other enemy touching where it comes up is bitten too.
    if (u.form === "true")
      for (const o of foesWithin(f, u.side, u.cell, 1)) if (o !== t) hurt(f, o, bite, "physical", "ability", u);
    return true;
  },
  finch: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    const damage = powered(u, n("damage"));
    say(f, u, [t.cell], [t.id], flight(u.cell, t.cell));
    // A seed whose target has fallen flies on, from where it fell, at the enemy nearest there.
    const seed = (from: number, at: Unit, wait: number): void => {
      const land = (): void => {
        const next = targetable(f, at) ? at : foesByDistance(f, u.side, at.cell)[0];
        if (next === at) hurt(f, at, damage, "physical", "ability", u);
        else if (next) seed(at.cell, next, 0);
      };
      send(f, u, from, at, land, wait, [damage, "physical"]);
    };
    for (let i = 0; i < n("seeds"); i++) seed(u.cell, t, i * 2);
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
    if (!crowd(f, u, foes.length)) return false;
    say(f, u, around(u.cell), ids(foes), 0);
    shieldUp(f, u, powered(u, n("shield")), n("lasts"), u);
    for (const o of foes) hurt(f, o, powered(u, n("damage")), "physical", "ability", u);
    return true;
  },

  // ---------- two acorns ----------
  kettle: (f, u, n) => {
    const first = mostHurt(f, u.side, false)[0];
    if (!first) return false;
    const amount = powered(u, n("heal"));
    const sips = over(n("pours"), n("sips"));
    say(f, u, [first.cell], [first.id], 0, sips);
    channel(f, u, sips, () => {
      // Each sip goes to whoever is most hurt as it is poured.
      const t = mostHurt(f, u.side, false)[0];
      if (t) send(f, u, u.cell, t, () => heal(f, t, amount, "ability", u));
    });
    return true;
  },
  slug: (f, u, n) => {
    if (splash(f, u, 1, powered(u, n("damage")), "magic", () => {}) < 0) return false;
    zone(f, u, neighbours(u.cell), "slime", n("lasts"), { slow: n("slow") });
    return true;
  },
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
    const land = (): void => {
      hurt(f, t, damage, "physical", "ability", u);
      stun(f, t, n("stun"), u);
    };
    send(f, u, u.cell, t, land, 0, [damage, "physical"]);
    return true;
  },
  jay: (f, u, n) => {
    const t = weakest(foesWithin(f, u.side, u.cell, n("reach")));
    say(f, u, [u.cell], [t?.id ?? u.id], 0);
    if (t) {
      dash(f, u, dashTo(f, u, t));
      u.target = t.id;
    }
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
      const land = (): void => {
        hurt(f, t, damage, "physical", "ability", u);
        if (left <= 0) return;
        const next = foesByDistance(f, u.side, t.cell).find((o) => !struck.has(o.id) && distance(t.cell, o.cell) <= 2);
        if (next) skip(t.cell, next, left - 1);
      };
      send(f, u, from, t, land, 0, [damage, "physical"]);
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
    for (const o of lit) send(f, u, u.cell, o, () => hurt(f, o, damage, "magic", "ability", u), 0, [damage, "magic"]);
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
    const breath = (to: number): number[] => cone(u.cell, to, Math.max(2, distance(u.cell, to)));
    const hit = foesOn(f, u.side, breath(t.cell));
    if (!crowd(f, u, hit.length)) return false;
    const damage = powered(u, n("damage"));
    const breaths = over(n("lasts"), n("breaths"));
    say(f, u, breath(t.cell), ids(hit), 0, breaths);
    let toward = t.cell;
    channel(f, u, breaths, () => {
      // Turned toward its target each time; with nobody in reach, the way it last breathed.
      toward = aim(f, u)?.cell ?? toward;
      for (const o of foesOn(f, u.side, breath(toward))) hurt(f, o, damage, "magic", "ability", u);
    });
    return true;
  },
  drizzlefrog: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    const damage = powered(u, n("damage"));
    say(f, u, [t.cell], [t.id], flight(u.cell, t.cell));
    const land = (): void => {
      hurt(f, t, damage, "magic", "ability", u);
      zone(f, u, around(t.cell), "puddle", n("lasts"), { slow: n("slow") });
    };
    send(f, u, u.cell, t, land, 0, [damage, "magic"]);
    return true;
  },
  rock: (f, u, n) => {
    say(f, u, [u.cell], [u.id], 0);
    brace(f, u, n("less"), powered(u, n("stub")), n("lasts"));
    return true;
  },
  bushgnome: (f, u, n) => {
    const first = aim(f, u) ?? drawnFoe(f, u);
    if (!first) return false;
    const damage = powered(u, n("damage"));
    const hides = secs(n("hides"));
    say(f, u, [first.cell], [first.id], hides);
    hide(f, u, hides);
    later(f, hides, () => {
      // It jumps out at its target, or with that one gone, at whoever it would pick now.
      const t = targetable(f, first) ? first : drawnFoe(f, u);
      if (!t) return;
      leap(f, u, landingBy(f, u, t), "ability");
      u.target = t.id;
      hurt(f, t, damage * (t.target === u.id ? 1 : 1.5), "physical", "ability", u);
    });
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
    const far = farthestFoe(f, u);
    if (!far) return false;
    // Of the enemies no more than 1 hex nearer than the furthest, the one with the least health.
    const away = distance(u.cell, far.cell) - 1;
    const t = weakest(foesOf(f, u.side).filter((o) => distance(u.cell, o.cell) >= away)) ?? far;
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
    if (!crowd(f, u, hit.length)) return false;
    const damage = powered(u, n("damage"));
    const mark = secs(n("mark"));
    say(f, u, cells, ids(hit), mark);
    telegraph(f, u, cells, mark, () => {
      for (const o of foesOn(f, u.side, cells)) hurt(f, o, damage, "physical", "ability", u);
    });
    return true;
  },
  crab40: (f, u, n) => {
    const foes = foesWithin(f, u.side, u.cell, 2);
    say(f, u, spread(u.cell, 2), ids(foes), 0);
    for (const o of foes) pull(f, u, o);
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
  greg: (f, u, n) => {
    const to = busiestHex(f, u, n("jump"));
    const near = foesWithin(f, u.side, to, 2);
    if (near.length === 0 || !crowd(f, u, near.length)) return false;
    say(f, u, spread(to, 2), ids(near), 0);
    leap(f, u, to, "ability");
    // Real Greg, his true form: first every enemy within 3 hexes is pulled 1 hex nearer him.
    const pulls = u.form === "true" ? formNumber("greg", "pull") : 0;
    for (const o of foesByDistance(f, u.side, to)) if (distance(to, o.cell) <= pulls) pull(f, u, o);
    const caught = pulls > 0 ? foesWithin(f, u.side, to, 2) : near;
    for (const o of caught) {
      hurt(f, o, powered(u, n("damage")), "magic", "ability", u);
      stun(f, o, n("stun"), u);
    }
    return true;
  },
  whitefox: (f, u, n) => {
    if (splash(f, u, 2, powered(u, n("damage")), "magic", () => {}) < 0) return false;
    for (const o of alliesOf(f, u.side)) haste(f, o, powered(u, n("haste")), n("lasts"), u);
    // Real Orphion, its true form: the party gets a share of its health back.
    if (u.form === "true")
      for (const o of alliesOf(f, u.side)) heal(f, o, (o.maxHp * formNumber("whitefox", "heal")) / 100, "ability", u);
    return true;
  },
  seqwawa: (f, u, n) => {
    const friends = alliesOf(f, u.side);
    // The last of its party to fall, if still down, fallen within the window and with somewhere to stand.
    const back = lastFallen(f, u.side, secs(n("window")));
    const aimed = back ? [...friends, back] : friends;
    const cells = aimed.map((o) => o.cell);
    say(f, u, cells, ids(aimed), 0);
    for (const o of friends) heal(f, o, powered(u, n("heal")), "ability", u);
    if (back) getUp(f, back, powered(u, n("back")) * (1 + u.mending / 100), "seqwawa");
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
    // Whoever the fight has touched least, anywhere on the board: the least damage taken, of those
    // level the least dealt, then the nearest. The summoned are picked only when nobody else is up.
    const t = foesByDistance(f, u.side, u.cell).toSorted(
      (a, b) => Number(a.summoned) - Number(b.summoned) || a.taken - b.taken || a.dealt - b.dealt,
    )[0];
    if (!t) return false;
    const damage = powered(u, n("damage"));
    say(f, u, around(t.cell), [t.id], secs(1));
    stun(f, t, n("stun"), u);
    // It lands where they are by then, if the stun has worn off and they have moved.
    later(f, secs(1), () => {
      hurt(f, t, damage, "magic", "ability", u);
      for (const o of foesWithin(f, u.side, t.cell, 1)) if (o.id !== t.id) hurt(f, o, damage, "magic", "ability", u);
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
    const land = (): void => {
      hurt(f, t, damage, "magic", "ability", u);
      knockBack(f, t, u.cell, n("push"));
      slow(f, t, n("slow"), n("lasts"), u);
    };
    send(f, u, u.cell, t, land, 0, [damage, "magic"]);
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
    if (!crowd(f, u, hit.length)) return false;
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
  if (!ability || !wanted(f, u)) return false;
  return ability(f, u, (name) => abilityNumber(u.kind, name, u.stars));
}
