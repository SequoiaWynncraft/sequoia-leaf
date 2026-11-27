/**
 * What every trait, item, boon and figure does in a fight, as hooks (`hooks.ts`): the fight's own
 * tables (`HOOKS`). The moments asked of a whole side as it sits down are asked in `seating.ts`.
 * What a hook sets on a figure (the burn its hits leave, mana by the second, a shield on casting) is
 * a number the verbs in `core.ts` and the clock in `engine.ts` read, and they name none of these.
 */
import type { BoonId } from "../content/boons.ts";
import type { Catalog } from "../content/catalog.ts";
import { figureIn, isFigureId, specOf, type Stars, type UnitKind } from "../content/figures.ts";
import { formNumber, hasTrueForm } from "../content/graid.ts";
import { type ItemId, itemStats } from "../content/items.ts";
import { type TraitId, traitNumber } from "../content/traits.ts";
import { COLS, groupsTouching, HOME_ROWS, within } from "../hex.ts";
import { UP_THE_TREE_KINDS, upTheTree } from "./casts/up-the-tree.ts";
import {
  brace,
  emit,
  foesWithin,
  freeNear,
  gainMana,
  getUp,
  heal,
  hurt,
  later,
  mostHurt,
  poolUp,
  powered,
  secs,
  shieldUp,
  summon,
} from "./core.ts";
import type { Hooks, Rise, Switching, Tables } from "./hooks.ts";
import type { Fight, Form, Unit } from "./types.ts";

type On = NonNullable<Hooks["on"]>;
/** An `on` that sets numbers on each figure that carries it, or holds it. */
const each =
  (set: (u: Unit, v: Switching["v"]) => void): On =>
  (_f, { members, v }) => {
    for (const u of members) set(u, v);
    return members;
  };
/** An `on` that sets numbers on its whole side. */
const whole =
  (set: (u: Unit, v: Switching["v"]) => void): On =>
  (_f, { mine, v }) => {
    for (const u of mine) set(u, v);
    return mine;
  };

// ---------- traits ----------

/**
 * Roll call: the crabs nobody counted turn up beside the first of a side's crabs (whoever carries
 * Crab, a Crab emblem's holder too), as starry as the best of them: as many big and small as the
 * step says.
 */
function rollCall(f: Fight, { side, mine, members, v }: Switching): void {
  const anchor = members[0] ?? mine[0];
  if (!anchor) return;
  const stars = members.reduce<Stars>((most, u) => (u.stars > most ? u.stars : most), 1);
  for (let n = v("big"); n > 0; n--) summon(f, "biguncounted", stars, side, freeNear(f, anchor.cell, 4), null);
  for (let n = v("small"); n > 0; n--) summon(f, "uncounted", stars, side, freeNear(f, anchor.cell, 4), null);
}

/** Stands a figure in its true form: more attack and ability power, and a form's own attack where it has one (the Rock's). */
function standTrue(f: Fight, u: Unit): void {
  const own = formNumber(u.kind, "attack");
  if (own > 0) {
    // Its form's numbers, grown and held as a figure's own are.
    let attack = 0;
    let speed = 0;
    for (const item of u.items) {
      attack += itemStats(f.cat, item).attack;
      speed += itemStats(f.cat, item).speed;
    }
    u.attack = own * u.grown * (1 + attack / 100);
    u.speed = formNumber(u.kind, "speed") * (1 + speed / 100);
  }
  const more = 1 + traitNumber(f.cat, "graid", "more", 1) / 100;
  u.attack = Math.round(u.attack * more);
  u.power *= more;
}
/** Graid's getting back up, a moment after falling: in its true form if it has one, with its share of health, and at the top step its share of a mana bar. */
function graidUp(f: Fight, u: Unit, { v }: Switching): void {
  const form: Form = hasTrueForm(u.kind) ? "true" : u.form;
  if (!getUp(f, u, (u.maxHp * v("health")) / 100, "graid", form)) {
    // Nowhere to stand: it is down for good after all.
    f.standing[u.side]--;
    u.fellAt = f.tick;
    u.fallNo = ++f.falls;
    return;
  }
  if (form === "true") standTrue(f, u);
  // At the top step, its mana bar at least this full.
  u.mana = Math.max(u.mana, Math.round((u.manaFull * v("mana")) / 100));
}
/**
 * Graid, as a figure falls: one with its getting back up still to come (`rises`) gets back up a
 * moment later (`graidUp`), and meanwhile still counts as standing. At the first step, only the first
 * Graid figure of its side to fall does.
 */
function graidFalls(f: Fight, u: Unit, s: Switching): Rise | null {
  if (!u.rises) return null;
  u.rises = false;
  if (s.v("every") <= 0) for (const o of f.units) if (o.side === u.side) o.rises = false;
  const back = secs(s.v("wait"));
  later(f, back, () => graidUp(f, u, s));
  return back > 0 ? { up: "later", back } : null;
}

const TRAITS: Readonly<Record<TraitId, Hooks>> = {
  ember: {
    on: (_f, { mine, members, v }) => {
      const touched = v("whole") > 0 ? mine : members;
      for (const u of touched) u.ember = v("burn");
      return touched;
    },
  },
  moss: {
    on: whole((u, v) => {
      u.regrow += v("regrow");
    }),
  },
  mist: {
    on: whole((u, v) => {
      u.ward += v("ward");
      u.slip += v("slip");
    }),
  },
  burrow: {
    on: each((u, v) => {
      u.armour += v("armour");
      u.digs = true;
      u.digHeal = v("heal");
      u.digLess = v("less");
      u.digFor = v("lasts");
    }),
    // The first time under half health, it digs in where it stands and keeps fighting.
    hurt: (f, u) => {
      if (!u.digs || u.hp * 2 >= u.maxHp) return;
      u.digs = false;
      heal(f, u, (u.maxHp * u.digHeal) / 100, "burrow", null);
      brace(f, u, u.digLess, 0, u.digFor);
    },
  },
  feather: {
    on: each((u, v) => {
      u.quicken = v("quicken");
      u.quickMost = v("stacks");
    }),
  },
  crab: { seated: rollCall },
  // Each group of its carriers that start the fight touching shares one shield, before the Sneaks leap.
  huddle: {
    seated: (f, { members, v }) => {
      const up = members.filter((u) => u.alive);
      for (const places of groupsTouching(up.map((u) => u.cell))) {
        const group = places.flatMap((i) => (up[i] ? [up[i]] : []));
        if (group.length < 2) continue;
        poolUp(f, group, (group.reduce((sum, u) => sum + u.maxHp, 0) * v("share")) / 100, v("back"), v("wait"));
      }
    },
  },
  // Up the tree as the fight opens, then down with a shield and mana (`upTheTree`).
  canopy: { seated: upTheTree },
  gnome: {
    on: each((u, v) => {
      u.maxHp = Math.round(u.maxHp * (1 + v("health") / 100));
      u.hp = u.maxHp;
    }),
  },
  graid: {
    on: each((u) => {
      u.rises = true;
    }),
    falls: graidFalls,
  },
  // Its hits crack (`leaves` in `core.ts`), and so do what its members summon (`summon`).
  grooter: {
    on: each((u, v) => {
      u.crack = v("crack");
      u.crackMost = v("most");
    }),
  },
  bulwark: {
    on: (_f, { mine, members, v }) => {
      for (const u of mine) u.armour += members.includes(u) ? v("armour") : v("party");
      return v("party") > 0 ? mine : members;
    },
  },
  fang: {
    on: each((u, v) => {
      u.attack = Math.round(u.attack * (1 + v("attack") / 100));
      u.crit += v("crit");
    }),
  },
  slinger: {
    on: each((u, v) => {
      u.range += v("reach");
      u.focusBy = v("focus");
      u.focusMost = v("most");
    }),
  },
  sage: {
    on: each((u, v) => {
      u.power += v("power");
      u.manaMore += v("mana");
    }),
  },
  // At the top step, healing past a friend's full health becomes a shield (`overflow` in `core.ts`).
  mender: {
    on: each((u, v) => {
      u.mending += v("mending");
      u.overheal = v("over");
      u.overhealFor = v("lasts");
    }),
  },
  // They start by getting round the back (`roundTheBack`).
  sneak: {
    on: each((u, v) => {
      u.sneakHits = v("hits");
      u.sneakBy = v("extra");
      u.leaps = true;
    }),
  },
  // Mana by the second: a Chorus figure its own rate, everyone else the party's.
  chorus: {
    on: (_f, { mine, members, v }) => {
      for (const u of mine) u.manaRate += members.includes(u) ? v("own") : v("party");
      return mine;
    },
  },
  // What Greg has eaten: percent of his health, for good.
  greg: { sits: (_f, p, { v }) => ({ health: Math.min(p.fed, v("most")) }) },
  rooted: {
    on: each((u, v) => {
      u.manaRate += v("mana");
    }),
  },
  // Takes no chair (`chairsUsed`); nothing in the fight.
  // A component every few fights it fights: on the run, after a room (`ROOM_HOOKS`).
  crafter: {},
  stowaway: {},
};

// ---------- items ----------

const ITEMS: Readonly<Partial<Record<ItemId, Hooks>>> = {
  blackthorn: {
    on: each((u, v) => {
      u.pierce = v("pierce");
    }),
  },
  wasptail: {
    on: each((u, v) => {
      u.twice = v("every");
    }),
    attacks: (f, u) => {
      if (u.twice <= 0 || u.attacks % u.twice !== 0) return 0;
      emit(f, { t: "item", id: u.id, item: "wasptail" });
      return 1;
    },
  },
  glowthorn: {
    on: each((u, v) => {
      u.manaMore += v("mana");
    }),
  },
  hedgehog: {
    on: each((u, v) => {
      u.prickle += v("prickle");
    }),
  },
  conker: {
    on: each((u, v) => {
      u.clip += v("clip");
    }),
  },
  hummingbird: {
    on: each((u, v) => {
      u.range += v("reach");
    }),
  },
  mothlantern: {
    on: each((u, v) => {
      if (u.manaFull > 0) u.mana = Math.max(u.mana, Math.round((u.manaFull * v("head")) / 100));
    }),
  },
  quilt: {
    on: each((u, v) => {
      u.slip += v("slip");
    }),
  },
  honeycake: {
    on: each((u, v) => {
      u.leech += v("leech");
    }),
  },
  fairyring: {
    on: each((u, v) => {
      u.powerGrow += v("grow");
    }),
    casts: (f, u) => {
      if (u.powerGrow <= 0) return;
      u.power += u.powerGrow;
      emit(f, { t: "item", id: u.id, item: "fairyring" });
    },
  },
  lichen: {
    on: each((u, v) => {
      u.castShield += v("shield");
      u.castShieldFor = v("lasts");
    }),
    casts: (f, u) => {
      if (u.castShield <= 0 || !u.alive) return;
      emit(f, { t: "item", id: u.id, item: "lichen" });
      shieldUp(f, u, (u.maxHp * u.castShield) / 100, u.castShieldFor, null);
    },
  },
  // The Stewpot goes round: the most hurt friend is served.
  stewpot: {
    on: each((u, v) => {
      u.serveEvery = secs(v("every"));
      u.serveHeal = v("heal");
    }),
    second: (f, u) => {
      if (u.serveEvery <= 0 || f.tick % u.serveEvery !== 0) return;
      const hungry = mostHurt(f, u.side, true)[0];
      if (!hungry) return;
      emit(f, { t: "item", id: u.id, item: "stewpot" });
      heal(f, hungry, (hungry.maxHp * u.serveHeal) / 100, "item", u);
    },
  },
  stump: {
    on: each((u, v) => {
      u.noHard = true;
      u.stunCut = v("steady");
    }),
  },
  // Once, under a share of its health, it climbs inside.
  hollowlog: {
    on: each((u, v) => {
      u.logUnder = v("under");
      u.logShield = v("shield");
      u.logFor = v("lasts");
    }),
    hurt: (f, u) => {
      if (u.logUnder <= 0 || u.hp * 100 >= u.maxHp * u.logUnder) return;
      const worth = (u.maxHp * u.logShield) / 100;
      u.logUnder = 0;
      emit(f, { t: "item", id: u.id, item: "hollowlog" });
      shieldUp(f, u, worth, u.logFor, null);
    },
  },
  hoard: {
    on: each((u, v) => {
      u.regrow += v("regrow");
    }),
  },
};

// ---------- boons ----------

const BOONS: Readonly<Partial<Record<BoonId, Hooks>>> = {
  secondwind: {
    on: (f, { side, mine }) => {
      f.wind[side] = true;
      return mine;
    },
    // The first to fall gets back up, with whatever was on it shaken off.
    falls: (f, u, { v }) => {
      if (!f.wind[u.side]) return null;
      f.wind[u.side] = false;
      getUp(f, u, (u.maxHp * v("health")) / 100, "wind");
      return { up: "now" };
    },
  },
  headstart: { on: whole((u, v) => gainMana(u, v("mana"))) },
  smallfry: {
    sits: (f, p, { v }) =>
      isFigureId(p.kind) && figureIn(f.cat, p.kind).tier <= 2 ? { health: v("boost"), attack: v("boost") } : null,
  },
  formation: {
    on: whole((u, v) => {
      const row = Math.floor(u.seat / COLS);
      if (row === 0) u.armour += v("armour");
      if (row === HOME_ROWS - 1) u.speed *= 1 + v("speed") / 100;
    }),
  },
};

// ---------- what a figure is ----------

/** It starts inside its shell. */
const shell: Hooks["seated"] = (f, { members, v }) => {
  for (const u of members) shieldUp(f, u, powered(u, v("shell")), 0, null);
};

const KINDS: Readonly<Partial<Record<UnitKind, Hooks>>> = {
  ...UP_THE_TREE_KINDS,
  crab: { seated: shell },
  bigcrab: {
    seated: shell,
    // At half health it calls the roll.
    hurt: (f, u, { v }) => {
      if (u.called || u.hp * 2 >= u.maxHp) return;
      u.called = true;
      const crabs = v("crabs");
      for (let i = 0; i < crabs; i++) summon(f, "uncounted", 2, u.side, freeNear(f, u.cell), u);
    },
  },
  // Magpies always start by getting round the back.
  magpie: {
    on: each((u) => {
      u.leaps = true;
    }),
  },
  // It puffs as it goes: said as an ability, so that a screen can show the spores spreading.
  toadstool: {
    fell: (f, u, { v }) => {
      const spores = powered(u, v("damage"));
      const caught = foesWithin(f, u.side, u.cell, 2);
      emit(f, {
        t: "cast",
        id: u.id,
        kind: u.kind,
        name: specOf(f.cat, u.kind).ability?.name ?? "",
        shape: "ring",
        cells: [u.cell, ...within(u.cell, 2)],
        targets: caught.map((o) => o.id),
        ticks: 0,
      });
      for (const o of caught) hurt(f, o, spores, "magic", "ability", u);
    },
  },
};

/** The fight's own hooks. */
export const HOOKS: Tables = { traits: TRAITS, items: ITEMS, boons: BOONS, kinds: KINDS };

/** What every burn in a fight is, by Ember's first step: how long it lasts, and how much weaker healing is meanwhile. */
export const burnOf = (cat: Catalog): Fight["burning"] => ({
  lasts: secs(traitNumber(cat, "ember", "lasts", 1)),
  damp: traitNumber(cat, "ember", "damp", 1),
});
