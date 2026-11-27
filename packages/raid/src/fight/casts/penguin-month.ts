/**
 * Penguin Month's abilities (22 December 2026), keyed by whose they are, as `abilities.ts` has
 * every other: Dibs, Jet, Larp, Flurry, Pomp and Yule. Each is its sentence carried out with the
 * verbs of `core.ts` and `moves.ts`; Fanfare gives mana through `giveMana`, and Yule's bubble is
 * hiding a friend (`hide`, with Yule as who put them there).
 */
import type { UnitKind } from "../../content/figures.ts";
import { distance, line, neighbours, rowOf, touching } from "../../hex.ts";
import { type Cast, ids, say, spread } from "../cast.ts";
import {
  alliesOf,
  foesOn,
  foesWithin,
  gainMana,
  giveMana,
  haste,
  heal,
  hide,
  hurt,
  later,
  leap,
  mostHurt,
  order,
  powered,
  secs,
  shieldUp,
} from "../core.ts";
import { aim } from "../mind.ts";
import { send, zone } from "../moves.ts";
import type { Fight, Unit } from "../types.ts";

/** Enemies in a figure's reach, nearest first, ties by where they stand. */
const inReach = (f: Fight, u: Unit): Unit[] =>
  foesWithin(f, u.side, u.cell, u.range).toSorted(
    (a, b) => distance(u.cell, a.cell) - distance(u.cell, b.cell) || order(u.side, a.cell) - order(u.side, b.cell),
  );

export const PENGUIN_MONTH_CASTS: Partial<Record<UnitKind, Cast>> = {
  dibs: (f, u, n) => {
    // Itself, and the most hurt friend touching it if it has one.
    const friend = mostHurt(f, u.side, false).find((o) => o.id !== u.id && touching(o.cell, u.cell));
    const to = friend ? [u, friend] : [u];
    say(
      f,
      u,
      to.map((o) => o.cell),
      ids(to),
      0,
    );
    for (const o of to) shieldUp(f, o, powered(u, n("shield")), n("lasts"), u);
    return true;
  },

  jet: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    // Up to 4 hexes from where it is, through its target; it stops on the furthest free one.
    const cells = line(u.cell, t.cell, 4);
    const hit = foesOn(f, u.side, cells);
    say(f, u, cells, ids(hit), 0);
    const to = cells.findLast((c) => f.taken[c] === -1);
    if (to !== undefined) leap(f, u, to, "ability");
    const damage = powered(u, n("damage"));
    for (const o of hit) hurt(f, o, damage, "physical", "ability", u);
    zone(f, u, cells, "ice", n("lasts"), { slow: n("slow") });
    return true;
  },

  larp: (f, u, n) => {
    const foes = inReach(f, u);
    if (foes.length === 0) return false;
    // Each at a different enemy where it can; spare ones go round again from the nearest.
    const at = Array.from({ length: n("balls") }, (_, i) => foes[i % foes.length]).filter((o) => o !== undefined);
    say(
      f,
      u,
      at.map((o) => o.cell),
      ids(at),
      0,
    );
    const damage = powered(u, n("damage"));
    at.forEach((o, i) => {
      send(f, u, u.cell, o, () => void hurt(f, o, damage, "physical", "ability", u), i * 2, [damage, "physical"]);
    });
    return true;
  },

  flurry: (f, u, n) => {
    // The enemy in its reach with the most enemies touching it; ties go to the nearest.
    const crowd = (o: Unit): number => foesOn(f, u.side, neighbours(o.cell)).length;
    const t = inReach(f, u).reduce<Unit | undefined>(
      (best, o) => (!best || crowd(o) > crowd(best) ? o : best),
      undefined,
    );
    if (!t) return false;
    const cells = spread(t.cell, 1);
    say(f, u, cells, ids(foesOn(f, u.side, cells)), 0);
    zone(f, u, cells, "snow", n("lasts"), { slow: n("slow"), damage: powered(u, n("damage")) });
    return true;
  },

  pomp: (f, u, n) => {
    // Every friend in the row of hexes it stands in now; itself is not one.
    const row = alliesOf(f, u.side).filter((o) => o.id !== u.id && rowOf(o.cell) === rowOf(u.cell));
    say(f, u, [u.cell, ...row.map((o) => o.cell)], ids(row), 0);
    for (const o of row) {
      giveMana(f, o, n("mana"), u);
      haste(f, o, n("haste"), n("lasts"), u);
    }
    return true;
  },

  yule: (f, u, n) => {
    // One more friend each later use, up to its most; never one already hidden.
    const count = Math.min(n("most"), 1 + u.casts);
    const ins = mostHurt(f, u.side, true)
      .filter((o) => o.hiddenUntil <= f.tick)
      .slice(0, count);
    if (ins.length === 0) return false;
    const ticks = secs(n("lasts"));
    say(
      f,
      u,
      ins.map((o) => o.cell),
      ids(ins),
      ticks,
    );
    for (const o of ins) hide(f, o, ticks, u);
    later(f, ticks, () => {
      for (const o of ins) {
        heal(f, o, powered(u, n("heal")), "ability", u);
        // A Yule in a bubble gets the health and not the mana, so that two never bubble each other for ever.
        if (o.kind !== "yule") gainMana(o, o.manaFull);
      }
    });
    return true;
  },
};
