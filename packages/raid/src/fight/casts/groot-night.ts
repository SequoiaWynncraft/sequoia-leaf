/**
 * Groot Night's abilities (8 December 2026), keyed by whose they are, as `abilities.ts` has every
 * other: Peep, Crab #31, Munch, Clutch, Crab #8 and the Commodore. A release's own casts are a file
 * here, joined into `CASTS`; each is its sentence carried out with the verbs of `core.ts` and
 * `moves.ts`, and the two Groot Night brings, `crack` and `giveMana`.
 */
import { GROOTER_IDS, type GrooterId, isGrooterId, type UnitKind } from "../../content/figures.ts";
import { distance, within } from "../../hex.ts";
import { type Cast, ids, say } from "../cast.ts";
import {
  alliesOf,
  crack,
  emit,
  flight,
  foesOf,
  foesWithin,
  freeNear,
  giveMana,
  heal,
  hide,
  hurt,
  later,
  leap,
  order,
  powered,
  secs,
  shieldUp,
  summon,
} from "../core.ts";
import { aim, weakest } from "../mind.ts";
import { channel, landingBy, over, send } from "../moves.ts";
import type { Fight } from "../types.ts";

/** Up to `count` different free hexes within some steps of one, nearest first, in the order `within` gives. */
function freeAround(f: Fight, cell: number, steps: number, count: number): number[] {
  return within(cell, steps)
    .filter((c) => f.taken[c] === -1)
    .toSorted((a, b) => distance(cell, a) - distance(cell, b))
    .slice(0, count);
}
/** The Commodore's next grooter in turn: counting on from the one called last (`calledLast`), the first not up; null for none. */
function nextGrooter(last: number, up: ReadonlySet<UnitKind>): GrooterId | null {
  for (let k = 1; k <= GROOTER_IDS.length; k++) {
    const kind = GROOTER_IDS[(last + k) % GROOTER_IDS.length];
    if (kind !== undefined && !up.has(kind)) return kind;
  }
  return null;
}

export const GROOT_NIGHT_CASTS: Partial<Record<UnitKind, Cast>> = {
  peep: (f, u, n) => {
    // The enemy in its reach with the most armour; ties go to the nearest.
    const t = foesWithin(f, u.side, u.cell, u.range).toSorted(
      (a, b) =>
        b.armour - a.armour ||
        distance(u.cell, a.cell) - distance(u.cell, b.cell) ||
        order(u.side, a.cell) - order(u.side, b.cell),
    )[0];
    if (!t) return false;
    const damage = powered(u, n("damage"));
    say(f, u, [t.cell], [t.id], flight(u.cell, t.cell));
    const land = (): void => {
      hurt(f, t, damage, "physical", "ability", u);
      crack(f, t, n("crack"), u);
    };
    send(f, u, u.cell, t, land, 0, [damage, "physical"]);
    return true;
  },

  crab31: (f, u, n) => {
    // The friends nearest it that have a mana bar to fill.
    const friends = alliesOf(f, u.side)
      .filter((o) => o.id !== u.id && o.manaFull > 0)
      .toSorted((a, b) => distance(u.cell, a.cell) - distance(u.cell, b.cell) || a.id - b.id)
      .slice(0, n("count"));
    say(f, u, [u.cell, ...friends.map((o) => o.cell)], ids(friends), 0);
    for (const o of friends) giveMana(f, o, n("mana"), u);
    shieldUp(f, u, powered(u, n("shield")), n("lasts"), u);
    return true;
  },

  munch: (f, u, n) => {
    const t = aim(f, u);
    if (!t) return false;
    const damage = powered(u, n("damage"));
    const bites = over(n("lasts"), n("bites"));
    say(f, u, [t.cell], [t.id], 0, bites);
    channel(f, u, bites, () => {
      // Each bite at whoever it is after as it bites.
      const at = aim(f, u);
      if (!at) return;
      hurt(f, at, damage, "physical", "ability", u);
      crack(f, at, n("crack"), u);
    });
    return true;
  },

  clutch: (f, u, n) => {
    let up = 0;
    for (const o of f.units) if (o.alive && o.kind === "hatchling" && o.owner === u.id) up++;
    const cell = up < n("most") ? freeNear(f, u.cell, 1) : -1;
    if (cell < 0) return false;
    say(f, u, [cell], [], 0);
    summon(f, "hatchling", u.stars, u.side, cell, u, {
      hp: powered(u, n("health")),
      attack: powered(u, n("attack")),
    });
    return true;
  },

  crab8: (f, u, n) => {
    const first = weakest(foesOf(f, u.side));
    if (!first) return false;
    const hides = secs(n("hides"));
    const damage = powered(u, n("damage"));
    say(f, u, [first.cell], [first.id], hides);
    hide(f, u, hides);
    later(f, hides, () => {
      // It picks as it comes up: the enemy with the least health then, and again at once for each that falls.
      for (let again = n("again"); u.alive; again--) {
        const t = weakest(foesOf(f, u.side));
        if (!t) return;
        // One hard cut each time it comes up: beside them, or where it stands if it already is.
        const to = landingBy(f, u, t);
        if (to === u.cell) emit(f, { t: "leap", id: u.id, from: to, to, why: "ability" });
        else leap(f, u, to, "ability");
        u.target = t.id;
        hurt(f, t, damage, "physical", "ability", u);
        if (t.alive || again <= 0) return;
      }
    });
    return true;
  },

  commodore: (f, u, n) => {
    // He rings at once: the free places for those missing are marked, and the grooters still up are
    // who he heals. They come, and the heals land, after the wait, while he stands ringing.
    const up = f.units.filter((o) => o.alive && o.owner === u.id && isGrooterId(o.kind));
    const hurting = up.filter((o) => o.hp < o.maxHp);
    const cells = freeAround(f, u.cell, 2, Math.max(0, n("most") - up.length));
    if (cells.length === 0 && hurting.length === 0) return false;
    const wait = secs(n("wait"));
    const [health, attack] = [powered(u, n("health")), powered(u, n("attack"))];
    say(f, u, cells, ids(hurting), wait);
    u.busyUntil = Math.max(u.busyUntil, f.tick + wait);
    const life = u.downs;
    later(f, wait, () => {
      // It lasts only in the life it began in.
      if (!u.alive || u.downs !== life) return;
      for (const o of hurting) if (o.alive) heal(f, o, o.maxHp - o.hp, "ability", u);
      const standing = new Set<UnitKind>(
        f.units.filter((o) => o.alive && o.owner === u.id && isGrooterId(o.kind)).map((o) => o.kind),
      );
      for (const marked of cells) {
        // A marked place taken meanwhile: the nearest free one within 2 of him instead.
        const cell = f.taken[marked] === -1 ? marked : (freeAround(f, u.cell, 2, 1)[0] ?? -1);
        const kind = standing.size < n("most") ? nextGrooter(u.calledLast, standing) : null;
        if (cell < 0 || kind === null) break;
        summon(f, kind, u.stars, u.side, cell, u, { hp: health, attack });
        standing.add(kind);
        u.calledLast = GROOTER_IDS.indexOf(kind);
      }
    });
    return true;
  },
};
