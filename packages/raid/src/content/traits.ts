/**
 * Traits: what a figure is (its kin) and what it does (its calling). A trait switches on when a
 * party fields enough *different* figures that carry it, and switches on harder at each further
 * step. Words and numbers only; what they do in a fight is in `fight.ts`, and what the gnomes find
 * is in `run.ts`.
 *
 * In the sentences, `{name}` is filled from the trait's numbers for the step in question. Each step
 * is said twice: `text` in the guild's voice, for the almanac, and `short` for a card on the table.
 */
import { FIGHT } from "./rooms.ts";

export const KINS = ["ember", "moss", "mist", "burrow", "feather", "crab", "gnome"] as const;
export type KinId = (typeof KINS)[number];
export const CALLINGS = ["bulwark", "fang", "slinger", "sage", "mender", "sneak"] as const;
export type CallingId = (typeof CALLINGS)[number];
/** A trait of one figure's own. */
export const OWN_TRAITS = ["greg"] as const;
export type OwnTraitId = (typeof OWN_TRAITS)[number];
export type TraitId = KinId | CallingId | OwnTraitId;
export const TRAIT_IDS: readonly TraitId[] = [...KINS, ...CALLINGS, ...OWN_TRAITS];

export interface TraitSpec {
  readonly name: string;
  readonly sort: "kin" | "calling" | "own";
  /** How many different figures it takes to reach each step. */
  readonly steps: readonly number[];
  /** The trait in a line, whatever the step. */
  readonly gist: string;
  /** What each step does, one sentence a step. */
  readonly text: readonly string[];
  /** The same in a few words for a card, one fragment a step. */
  readonly short: readonly string[];
  /** The numbers behind the sentences: one entry a step for each. */
  readonly n: Readonly<Record<string, readonly number[]>>;
}

export const TRAITS = {
  ember: {
    name: "Ember",
    sort: "kin",
    steps: [2, 4],
    gist: "Leaves things on fire, a little.",
    text: [
      "Ember figures' attacks and abilities leave a burn: {burn}% of health a second for {lasts} seconds. Healing on the burning is {damp}% weaker.",
      "The whole party's hits leave a burn, and a hotter one: {burn}% of health a second for {lasts} seconds. Healing on the burning is {damp}% weaker.",
    ],
    short: ["Ember hits burn, {burn}% health/s for {lasts}s.", "Whole party's hits burn, {burn}%/s."],
    n: { burn: [2, 4], lasts: [4, 4], damp: [40, 40], whole: [0, 1] },
  },
  moss: {
    name: "Moss",
    sort: "kin",
    steps: [2, 4],
    gist: "Grows back.",
    text: [
      "The whole party regrows {regrow}% of its health every second.",
      "The whole party regrows {regrow}% of its health every second.",
    ],
    short: ["Party regrows {regrow}% health/s.", "Party regrows {regrow}% health/s."],
    n: { regrow: [1.2, 3] },
  },
  mist: {
    name: "Mist",
    sort: "kin",
    steps: [2, 4],
    gist: "Hard to see, harder to hit.",
    text: [
      "The whole party gains {ward} ward and dodges {slip}% of attacks.",
      "The whole party gains {ward} ward and dodges {slip}% of attacks.",
    ],
    short: ["Party +{ward} ward, dodges {slip}% of attacks.", "Party +{ward} ward, dodges {slip}% of attacks."],
    n: { ward: [20, 45], slip: [12, 25] },
  },
  burrow: {
    name: "Burrow",
    sort: "kin",
    steps: [2, 4],
    gist: "Has a hole. Uses it.",
    text: [
      "Burrow figures dig in: +{armour} armour. The first time one drops under half health it gets {heal}% of its health back and takes {less}% less from attacks and abilities for {lasts} seconds, still fighting.",
      "Burrow figures dig in deep: +{armour} armour. The first time one drops under half health it gets {heal}% of its health back and takes {less}% less from attacks and abilities for {lasts} seconds, still fighting.",
    ],
    short: [
      "+{armour} armour; at half health {less}% less for {lasts}s.",
      "+{armour} armour; at half health {less}% less for {lasts}s.",
    ],
    n: { armour: [15, 20], heal: [10, 10], less: [25, 35], lasts: [2, 3] },
  },
  feather: {
    name: "Feather",
    sort: "kin",
    steps: [2, 4],
    gist: "Gets quicker as it goes.",
    text: [
      "Feather figures attack {quicken}% faster after every attack, up to {stacks} times over.",
      "Feather figures attack {quicken}% faster after every attack, up to {stacks} times over.",
    ],
    short: [
      "+{quicken}% attack speed per attack, {stacks} times.",
      "+{quicken}% attack speed per attack, {stacks} times.",
    ],
    n: { quicken: [5, 8], stacks: [10, 10] },
  },
  crab: {
    name: "Crab",
    sort: "kin",
    steps: [2, 4, 5],
    gist: "Roll call. One crab is always uncounted.",
    text: [
      "Roll call: when the fight starts, an Uncounted Crab joins beside your crabs, with as many stars as your best crab.",
      "Roll call: when the fight starts, a Big Uncounted Crab joins beside your crabs, with as many stars as your best crab.",
      "Roll call: when the fight starts, a Big Uncounted Crab and an Uncounted Crab join beside your crabs, with as many stars as your best crab.",
    ],
    short: ["An Uncounted Crab joins.", "A Big Uncounted Crab joins.", "A Big and a small Uncounted Crab join."],
    n: { big: [0, 1, 1], small: [1, 0, 1] },
  },
  gnome: {
    name: "Gnome",
    sort: "kin",
    steps: [2, 4],
    gist: "Finds acorns. Does not say where.",
    text: [
      "Gnome figures have {health}% more health. After every room, won or lost, the gnomes find {win} more acorn.",
      "Gnome figures have {health}% more health. After a room you win the gnomes find {win} more acorns, and {loss} after one you lose.",
    ],
    short: [
      "+{health}% health, +{win} acorn after every room.",
      "+{health}% health, +{win} acorns a win, +{loss} a loss.",
    ],
    n: { win: [1, 3], loss: [1, 2], health: [10, 20] },
  },
  bulwark: {
    name: "Bulwark",
    sort: "calling",
    steps: [2, 4, 6],
    gist: "Stands in front.",
    text: [
      "Bulwarks gain {armour} armour.",
      "Bulwarks gain {armour} armour, and the rest of the party {party}.",
      "Bulwarks gain {armour} armour, and the rest of the party {party}.",
    ],
    short: [
      "+{armour} armour.",
      "+{armour} armour, rest of party +{party}.",
      "+{armour} armour, rest of party +{party}.",
    ],
    n: { armour: [10, 30, 60], party: [0, 10, 20] },
  },
  fang: {
    name: "Fang",
    sort: "calling",
    steps: [2, 4, 6],
    gist: "Fights up close.",
    text: [
      "Fangs gain {attack}% attack and {crit}% crit chance. A crit does {hard}% more damage.",
      "Fangs gain {attack}% attack and {crit}% crit chance. A crit does {hard}% more damage.",
      "Fangs gain {attack}% attack and {crit}% crit chance. A crit does {hard}% more damage.",
    ],
    short: [
      "+{attack}% attack, +{crit}% crit chance.",
      "+{attack}% attack, +{crit}% crit chance.",
      "+{attack}% attack, +{crit}% crit chance.",
    ],
    // How much more a crit does is the fight's own number.
    n: { attack: [12, 25, 45], crit: [10, 15, 30], hard: [FIGHT.hard, FIGHT.hard, FIGHT.hard] },
  },
  slinger: {
    name: "Slinger",
    sort: "calling",
    steps: [2, 4],
    gist: "Throws things from the back.",
    text: [
      "Slingers reach {reach} hex further, and each attack on the same target does {focus}% more than the last, up to {most} times over.",
      "Slingers reach {reach} hex further, and each attack on the same target does {focus}% more than the last, up to {most} times over.",
    ],
    short: ["+{reach} reach, +{focus}% per hit on one target.", "+{reach} reach, +{focus}% per hit on one target."],
    n: { reach: [1, 1], focus: [7, 13], most: [6, 6] },
  },
  sage: {
    name: "Sage",
    sort: "calling",
    steps: [2, 4],
    gist: "Knows a trick.",
    text: [
      "Sages' abilities are {power}% stronger, and each of their attacks gives {mana} more mana.",
      "Sages' abilities are {power}% stronger, and each of their attacks gives {mana} more mana.",
    ],
    short: ["Abilities +{power}%, +{mana} mana a hit.", "Abilities +{power}%, +{mana} mana a hit."],
    n: { power: [25, 55], mana: [3, 5] },
  },
  mender: {
    name: "Mender",
    sort: "calling",
    steps: [2, 4],
    gist: "Patches people up.",
    text: [
      "Menders' healing and shields count for {mending}% more.",
      "Menders' healing and shields count for {mending}% more.",
    ],
    short: ["Heals and shields +{mending}%.", "Heals and shields +{mending}%."],
    n: { mending: [20, 35] },
  },
  sneak: {
    name: "Sneak",
    sort: "calling",
    steps: [2, 4],
    gist: "Is behind you.",
    text: [
      "When the fight starts, Sneaks leap to the enemy's back row, and their first {hits} attacks do {extra}% more.",
      "When the fight starts, Sneaks leap to the enemy's back row, and their first {hits} attacks do {extra}% more.",
    ],
    short: ["Leap to the back, first {hits} hits +{extra}%.", "Leap to the back, first {hits} hits +{extra}%."],
    n: { hits: [2, 3], extra: [40, 70] },
  },
  greg: {
    name: "Greg",
    sort: "own",
    steps: [1],
    gist: "There is one Greg.",
    text: ["After every fight Greg is in, he has eaten something: +{grows}% health for good, up to {most} times."],
    short: ["+{grows}% health per fight, up to {most} times."],
    n: { grows: [3], most: [10] },
  },
} as const satisfies Record<TraitId, TraitSpec>;

const specOf = (id: TraitId): TraitSpec => TRAITS[id];

/** The step a trait is on for a number of different figures: 0 for not switched on. */
export function stepFor(id: TraitId, count: number): number {
  let step = 0;
  for (const need of specOf(id).steps) if (count >= need) step++;
  return step;
}
/** The top step a trait has. */
export const topStep = (id: TraitId): number => specOf(id).steps.length;
/** One of a trait's numbers at a step (1 is the first step); 0 when the trait is off. */
export const stepValue = (list: readonly number[], step: number): number => (step > 0 ? (list[step - 1] ?? 0) : 0);
/** One of a trait's named numbers at a step; 0 when the trait is off or has no such number. */
export const traitNumber = (id: TraitId, name: string, step: number): number =>
  stepValue(specOf(id).n[name] ?? [], step);
/** Fills the `{name}` gaps in a sentence. */
export const fill = (text: string, values: Readonly<Record<string, number | string>>): string =>
  text.replaceAll(/\{(\w+)\}/g, (whole: string, key: string) => {
    const v = values[key];
    return v === undefined ? whole : String(v);
  });
/** One of a trait's sentences for a step, filled with that step's numbers. */
function stepWords(id: TraitId, step: number, words: (spec: TraitSpec) => readonly string[]): string {
  const spec = specOf(id);
  const at = Math.min(Math.max(step, 1), spec.steps.length);
  const values: Record<string, number> = {};
  for (const [key, list] of Object.entries(spec.n)) values[key] = list[at - 1] ?? 0;
  return fill(words(spec)[at - 1] ?? "", values);
}
/** What a trait does at a step, in a sentence. */
export const traitText = (id: TraitId, step: number): string => stepWords(id, step, (spec) => spec.text);
/** What a trait does at a step, in a few words for a card. */
export const traitShort = (id: TraitId, step: number): string => stepWords(id, step, (spec) => spec.short);
/**
 * How much a calling draws: enemies pick their target as if a figure of it stood this many hexes
 * nearer (fewer, for a negative number). A figure's draw is the sum over what it carries and holds.
 */
export const CALLING_DRAW: Readonly<Partial<Record<CallingId, number>>> = { bulwark: 1, sneak: -1 };
export const isTraitId = (v: unknown): v is TraitId => typeof v === "string" && Object.hasOwn(TRAITS, v);
export const isKin = (v: TraitId): v is KinId => TRAITS[v].sort === "kin";
export const isCalling = (v: TraitId): v is CallingId => TRAITS[v].sort === "calling";
/** What carrying a trait adds to a figure's draw: a calling's own, else 0. */
export const traitDraw = (id: TraitId): number => (isCalling(id) ? (CALLING_DRAW[id] ?? 0) : 0);
