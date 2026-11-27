/**
 * The ones that are only ever summoned: a figure's own (Glorp's bit, Snag's runners, Clutch's
 * Hatchlings, the Commodore's grooters) and the crabs nobody counted, whom roll call brings. Words
 * and numbers only; a summoner's ability says the health and attack it gives them where it does.
 */
import type { UnitSpec } from "./figures.ts";

export const SUMMON_IDS = [
  "glorplet",
  "uncounted",
  "biguncounted",
  "sprout",
  "hatchling",
  "grooter1",
  "grooter2",
  "grooter3",
  "grooter4",
] as const;
export type SummonId = (typeof SUMMON_IDS)[number];
/**
 * The Commodore's grooters (Groot Night): one figure, four places in turn. Who each is comes from
 * Leaf (the banner's `called`), and the page wears `grooterN` as the Nth of them.
 */
export const GROOTER_IDS = ["grooter1", "grooter2", "grooter3", "grooter4"] as const satisfies readonly SummonId[];
export type GrooterId = (typeof GROOTER_IDS)[number];
const GROOTER: UnitSpec = {
  name: "Grooter",
  hp: 460,
  attack: 75,
  speed: 0.8,
  range: 1,
  armour: 20,
  ward: 20,
  mana: [0, 0],
  ability: null,
  quip: "Was in chat. Came.",
};
export const SUMMONS: Record<SummonId, UnitSpec> = {
  glorplet: {
    name: "Glorplet",
    hp: 160,
    attack: 20,
    speed: 0.7,
    range: 1,
    armour: 10,
    ward: 10,
    mana: [0, 0],
    ability: null,
    quip: "A bit of Glorp, out on its own.",
  },
  uncounted: {
    name: "Crab #??",
    hp: 300,
    attack: 28,
    speed: 0.7,
    range: 1,
    armour: 30,
    ward: 20,
    mana: [0, 0],
    ability: null,
    quip: "Was not on the list. Is here anyway.",
  },
  biguncounted: {
    name: "Big Crab #??",
    hp: 600,
    attack: 44,
    speed: 0.65,
    range: 1,
    armour: 45,
    ward: 30,
    mana: [0, 0],
    ability: null,
    quip: "Was not on the list. The list was not long enough.",
  },
  sprout: {
    name: "Runner",
    hp: 150,
    attack: 18,
    speed: 0.6,
    range: 1,
    armour: 20,
    ward: 10,
    mana: [0, 0],
    ability: {
      name: "Thorny",
      shape: "always",
      text: "Whoever attacks it up close takes {thorns} damage.",
      n: { thorns: [8, 14, 25] },
      short: "Enemies hitting it up close take {thorns}.",
    },
    quip: "Where there was one bramble, there are now two.",
  },
  // Clutch's: health and attack from its ability.
  hatchling: {
    name: "Hatchling",
    hp: 180,
    attack: 28,
    speed: 0.9,
    range: 1,
    armour: 10,
    ward: 10,
    mana: [0, 0],
    ability: null,
    quip: "Out of the egg. Into the fight.",
  },
  // The Commodore's: health and attack from his ability.
  grooter1: GROOTER,
  grooter2: GROOTER,
  grooter3: GROOTER,
  grooter4: GROOTER,
};

export const isSummonId = (v: unknown): v is SummonId => typeof v === "string" && Object.hasOwn(SUMMONS, v);
export const isGrooterId = (v: unknown): v is GrooterId => GROOTER_IDS.some((id) => id === v);
