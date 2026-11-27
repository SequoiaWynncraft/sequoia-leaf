/**
 * Traits switching on as the two parties sit down: what each does to the figures it touches, set on
 * them as numbers the fight reads from then on. One entry a trait (`ON`), so a new trait is a new
 * entry. Some do their part later: roll call once everyone is seated (`rollCall` in `engine.ts`),
 * Greg's meals as he sits down (`seat`), Graid's getting back up as one falls (`enter.ts`).
 */
import { carries } from "../content/items.ts";
import { TRAIT_IDS, type TraitId, traitNumber } from "../content/traits.ts";
import type { Side } from "../hex.ts";
import { type Party, traitSteps } from "../party.ts";
import { emit } from "./clock.ts";
import type { Fight, Unit } from "./types.ts";

/** What a trait switching on is given: its side's figures, those of them that carry it, and its numbers at its step. */
interface Switching {
  readonly mine: readonly Unit[];
  readonly members: readonly Unit[];
  readonly v: (name: string) => number;
}
/** What a trait does as it switches on. It gives back whom it touched, for the screen. */
type On = (s: Switching) => readonly Unit[];

const ON: Readonly<Record<TraitId, On>> = {
  ember: ({ mine, members, v }) => {
    const touched = v("whole") > 0 ? mine : members;
    for (const u of touched) u.ember = v("burn");
    return touched;
  },
  moss: ({ mine, v }) => {
    for (const u of mine) u.regrow += v("regrow");
    return mine;
  },
  mist: ({ mine, v }) => {
    for (const u of mine) {
      u.ward += v("ward");
      u.slip += v("slip");
    }
    return mine;
  },
  burrow: ({ members, v }) => {
    for (const u of members) {
      u.armour += v("armour");
      u.digs = true;
      u.digHeal = v("heal");
      u.digLess = v("less");
      u.digFor = v("lasts");
    }
    return members;
  },
  feather: ({ members, v }) => {
    for (const u of members) {
      u.quicken = v("quicken");
      u.quickMost = v("stacks");
    }
    return members;
  },
  crab: ({ members }) => members,
  gnome: ({ members, v }) => {
    for (const u of members) {
      u.maxHp = Math.round(u.maxHp * (1 + v("health") / 100));
      u.hp = u.maxHp;
    }
    return members;
  },
  graid: ({ members }) => {
    for (const u of members) u.rises = true;
    return members;
  },
  bulwark: ({ mine, members, v }) => {
    for (const u of mine) u.armour += members.includes(u) ? v("armour") : v("party");
    return v("party") > 0 ? mine : members;
  },
  fang: ({ members, v }) => {
    for (const u of members) {
      u.attack = Math.round(u.attack * (1 + v("attack") / 100));
      u.crit += v("crit");
    }
    return members;
  },
  slinger: ({ members, v }) => {
    for (const u of members) {
      u.range += v("reach");
      u.focusBy = v("focus");
      u.focusMost = v("most");
    }
    return members;
  },
  sage: ({ members, v }) => {
    for (const u of members) {
      u.power += v("power");
      u.manaMore += v("mana");
    }
    return members;
  },
  mender: ({ members, v }) => {
    for (const u of members) u.mending += v("mending");
    return members;
  },
  sneak: ({ members, v }) => {
    for (const u of members) {
      u.sneakHits = v("hits");
      u.sneakBy = v("extra");
    }
    return members;
  },
  greg: ({ members }) => members,
  rooted: ({ members, v }) => {
    for (const u of members) u.manaRate += v("mana");
    return members;
  },
};

/** Switches a side's traits on, in the order of `TRAIT_IDS`, and says so. */
export function switchOn(f: Fight, side: Side, party: Party): void {
  const steps = traitSteps(f.cat, party);
  f.traits[side] = steps;
  const mine = f.units.filter((u) => u.side === side);
  for (const trait of TRAIT_IDS) {
    const step = steps[trait] ?? 0;
    if (step <= 0) continue;
    // Whoever carries it: as one of its own traits, or by an emblem it holds.
    const members = mine.filter((u) => carries(f.cat, u.kind, u.items, trait));
    const touched = ON[trait]({ mine, members, v: (name) => traitNumber(f.cat, trait, name, step) });
    emit(f, { t: "trait", side, trait, step, ids: touched.map((u) => u.id) });
  }
}
