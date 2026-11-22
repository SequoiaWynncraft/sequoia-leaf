/**
 * Who is on the stump: the twenty-eight carved figures a member can buy at the stall, the forest's
 * trouble and its three bosses, and the few that only ever turn up by being summoned. Words and
 * numbers only; what an ability does on the board is in `fight/abilities.ts`, keyed by the same
 * name as its owner here.
 *
 * Every number is for one star. Two stars multiply health and attack by `STAR[1]`, three by
 * `STAR[2]`; an ability's own numbers are written out for each star. In an ability's sentence,
 * `{name}` is filled from its numbers.
 *
 * Every ability is said twice: `text` is the sentence in the guild's voice that the almanac shows,
 * and `short` is what a card on the table shows: effects and numbers only, in at most two short
 * fragments.
 */
import type { CallingId, KinId, TraitId } from "./traits.ts";

/** What health and attack are multiplied by at one, two and three stars. */
export const STAR = [1, 1.8, 3.24] as const;
export type Stars = 1 | 2 | 3;
/** What health and attack are multiplied by at a number of stars. */
export const starScale = (stars: Stars): number => (stars === 1 ? STAR[0] : stars === 2 ? STAR[1] : STAR[2]);

/** How an ability lies on the board, so a screen knows what to draw. */
export type Shape = "bolt" | "line" | "cone" | "ring" | "leap" | "ally" | "self" | "summon" | "chain" | "always";

export interface AbilitySpec {
  readonly name: string;
  readonly shape: Shape;
  readonly text: string;
  /** The same in a few words for a card: `Shield {shield} for {lasts}s.` */
  readonly short: string;
  /** The numbers in the sentence, for one, two and three stars. */
  readonly n: Readonly<Record<string, readonly [number, number, number]>>;
}

export interface UnitSpec {
  readonly name: string;
  readonly hp: number;
  readonly attack: number;
  /** Attacks a second. */
  readonly speed: number;
  /** Reach, in hexes. */
  readonly range: number;
  readonly armour: number;
  readonly ward: number;
  /** Mana it starts a fight with, and how much fills the bar. A bar of 0 never fills: the ability is always on. */
  readonly mana: readonly [start: number, full: number];
  readonly ability: AbilitySpec | null;
  readonly quip: string;
  /** Stays on the hex it was put on, and cannot be pushed off it. */
  readonly rooted?: boolean;
  /** Too big to push about: stuns last half as long and nothing knocks it back. */
  readonly steady?: boolean;
}

export const TIERS = [1, 2, 3, 4, 5] as const;
export type Tier = (typeof TIERS)[number];

export interface FigureSpec extends UnitSpec {
  /** What it costs at the stall. */
  readonly tier: Tier;
  readonly kin: KinId;
  readonly calling: CallingId;
  /** A third trait, for a few of the dearest. */
  readonly extra: readonly TraitId[];
}

export const FIGURE_IDS = [
  "emberkit",
  "mossmote",
  "moth",
  "worm",
  "finch",
  "crab7",
  "barrowgnome",
  "kettle",
  "slug",
  "glorp",
  "chickaree",
  "jay",
  "crab12",
  "lanterngnome",
  "leafling",
  "cindernewt",
  "drizzlefrog",
  "rock",
  "bushgnome",
  "crab23",
  "badger",
  "fogowl",
  "heron",
  "crab40",
  "apothecary",
  "greg",
  "whitefox",
  "hearthcat",
] as const;
export type FigureId = (typeof FIGURE_IDS)[number];

export const FIGURES: Record<FigureId, FigureSpec> = {
  // ---------- one acorn ----------
  emberkit: {
    name: "Emberkit",
    tier: 1,
    kin: "ember",
    calling: "fang",
    extra: [],
    hp: 270,
    attack: 30,
    speed: 0.75,
    range: 1,
    armour: 20,
    ward: 15,
    mana: [0, 50],
    ability: {
      name: "Do Not Move The Fire",
      shape: "line",
      text: "A spark jumps from its fire: {damage} magic damage to its target and to whoever is standing behind it.",
      n: { damage: [75, 130, 235] },
      short: "{damage} magic to target and the one behind.",
    },
    quip: "Asleep in the fire. Do not move the fire.",
  },
  mossmote: {
    name: "Mossmote",
    tier: 1,
    kin: "moss",
    calling: "mender",
    extra: [],
    hp: 250,
    attack: 20,
    speed: 0.65,
    range: 3,
    armour: 10,
    ward: 20,
    mana: [20, 60],
    ability: {
      name: "Cushion",
      shape: "ally",
      text: "Tucks a cushion round whoever in the party is most hurt: a shield of {shield} for {lasts} seconds.",
      n: { shield: [110, 190, 340], lasts: [4, 4, 4] },
      short: "Shield {shield} on most hurt ally for {lasts}s.",
    },
    quip: "Soft. Very soft.",
  },
  moth: {
    name: "Moth",
    tier: 1,
    kin: "mist",
    calling: "sage",
    extra: [],
    hp: 230,
    attack: 22,
    speed: 0.7,
    range: 3,
    armour: 10,
    ward: 20,
    mana: [10, 60],
    ability: {
      name: "Wing Dust",
      shape: "ring",
      text: "Shakes its wings over its target: {damage} magic damage to it and to every enemy touching it.",
      n: { damage: [80, 140, 250] },
      short: "{damage} magic to target and adjacent enemies.",
    },
    quip: "Drawn to whatever just went out.",
  },
  worm: {
    name: "Worm",
    tier: 1,
    kin: "burrow",
    calling: "sneak",
    extra: [],
    hp: 260,
    attack: 28,
    speed: 0.8,
    range: 1,
    armour: 15,
    ward: 15,
    mana: [0, 50],
    ability: {
      name: "Under And Up",
      shape: "leap",
      text: "Goes under and comes up beside the enemy furthest away, biting it for {damage} physical damage.",
      n: { damage: [90, 160, 285] },
      short: "Burrows to furthest enemy. {damage} physical.",
    },
    quip: "Has been underground. Will be again.",
  },
  finch: {
    name: "Twig Finch",
    tier: 1,
    kin: "feather",
    calling: "slinger",
    extra: [],
    hp: 230,
    attack: 26,
    speed: 0.8,
    range: 3,
    armour: 10,
    ward: 10,
    mana: [0, 50],
    ability: {
      name: "Seed Volley",
      shape: "bolt",
      text: "Spits {seeds} seeds at its target, {damage} physical damage each.",
      n: { seeds: [3, 3, 3], damage: [34, 60, 108] },
      short: "{seeds} seeds at target, {damage} physical each.",
    },
    quip: "Small. Loud. Has a twig and is not afraid to use it.",
  },
  crab7: {
    name: "Crab #7",
    tier: 1,
    kin: "crab",
    calling: "fang",
    extra: [],
    hp: 300,
    attack: 26,
    speed: 0.65,
    range: 1,
    armour: 30,
    ward: 15,
    mana: [20, 70],
    ability: {
      name: "Pinch",
      shape: "bolt",
      text: "Pinches its target and does not let go: {damage} physical damage, and it is stunned for {stun} seconds.",
      n: { damage: [85, 150, 265], stun: [1.5, 1.5, 2] },
      short: "{damage} physical to target. Stuns {stun}s.",
    },
    quip: "Present at roll call. Barely.",
  },
  barrowgnome: {
    name: "Barrow Gnome",
    tier: 1,
    kin: "gnome",
    calling: "bulwark",
    extra: [],
    hp: 320,
    attack: 20,
    speed: 0.6,
    range: 1,
    armour: 30,
    ward: 20,
    mana: [20, 70],
    ability: {
      name: "Upend The Barrow",
      shape: "ring",
      text: "Tips the barrow over and gets behind it: a shield of {shield} for {lasts} seconds, and {damage} physical damage to every enemy touching it.",
      n: { shield: [120, 210, 375], lasts: [4, 4, 4], damage: [40, 70, 125] },
      short: "Shield {shield} for {lasts}s. {damage} physical to adjacent enemies.",
    },
    quip: "Nobody has seen what is in the barrow.",
  },

  // ---------- two acorns ----------
  kettle: {
    name: "Kettle",
    tier: 2,
    kin: "ember",
    calling: "mender",
    extra: [],
    hp: 330,
    attack: 24,
    speed: 0.65,
    range: 3,
    armour: 20,
    ward: 20,
    mana: [20, 70],
    ability: {
      name: "Tea",
      shape: "ally",
      text: "Pours a cup for whoever in the party is most hurt: {heal} health back.",
      n: { heal: [150, 260, 465] },
      short: "Heals most hurt ally for {heal}.",
    },
    quip: "Somebody left it on. It came along.",
  },
  slug: {
    name: "Slug",
    tier: 2,
    kin: "moss",
    calling: "bulwark",
    extra: [],
    hp: 430,
    attack: 24,
    speed: 0.55,
    range: 1,
    armour: 35,
    ward: 25,
    mana: [30, 80],
    ability: {
      name: "Slime",
      shape: "ring",
      text: "Slimes every enemy touching it: {damage} magic damage, and they are {slow}% slower for {lasts} seconds.",
      n: { damage: [60, 105, 190], slow: [30, 40, 50], lasts: [3, 3, 3] },
      short: "{damage} magic to adjacent enemies. Slows {slow}% for {lasts}s.",
    },
    quip: "In no hurry at all.",
  },
  glorp: {
    name: "Glorp",
    tier: 2,
    kin: "mist",
    calling: "bulwark",
    extra: [],
    hp: 400,
    attack: 28,
    speed: 0.6,
    range: 1,
    armour: 25,
    ward: 25,
    mana: [30, 80],
    ability: {
      name: "A Bit Comes Off",
      shape: "summon",
      text: "A bit comes off: a Glorplet with {health} health and {attack} attack joins the fight beside it.",
      n: { health: [200, 360, 650], attack: [24, 43, 78] },
      short: "A Glorplet joins: {health} health, {attack} attack.",
    },
    quip: "Blue. Wobbly. Plural, shortly.",
  },
  chickaree: {
    name: "Chickaree",
    tier: 2,
    kin: "burrow",
    calling: "slinger",
    extra: [],
    hp: 290,
    attack: 34,
    speed: 0.75,
    range: 3,
    armour: 15,
    ward: 15,
    mana: [0, 60],
    ability: {
      name: "Cone From Above",
      shape: "bolt",
      text: "Lobs a cone at the enemy furthest away: {damage} physical damage, and it is stunned for {stun} second.",
      n: { damage: [120, 210, 375], stun: [1, 1, 1] },
      short: "{damage} physical to furthest enemy. Stuns {stun}s.",
    },
    quip: "Buries cones. Forgets where. Finds more.",
  },
  jay: {
    name: "Dusk Jay",
    tier: 2,
    kin: "feather",
    calling: "fang",
    extra: [],
    hp: 340,
    attack: 36,
    speed: 0.8,
    range: 1,
    armour: 20,
    ward: 15,
    mana: [0, 50],
    ability: {
      name: "Flurry",
      shape: "self",
      text: "Loses its temper: attacks {haste}% faster for {lasts} seconds.",
      n: { haste: [60, 90, 130], lasts: [4, 4, 4] },
      short: "Attacks {haste}% faster for {lasts}s.",
    },
    quip: "Has a complaint. Has several.",
  },
  crab12: {
    name: "Crab #12",
    tier: 2,
    kin: "crab",
    calling: "slinger",
    extra: [],
    hp: 300,
    attack: 32,
    speed: 0.7,
    range: 3,
    armour: 20,
    ward: 15,
    mana: [0, 60],
    ability: {
      name: "Skipping Stone",
      shape: "chain",
      text: "Skims a pebble at its target for {damage} physical damage; it skips on to {skips} more enemies close by.",
      n: { damage: [95, 165, 300], skips: [2, 2, 3] },
      short: "{damage} physical to target. Skips to {skips} more enemies.",
    },
    quip: "Throws pebbles. Says it was #11.",
  },
  lanterngnome: {
    name: "Lantern Gnome",
    tier: 2,
    kin: "gnome",
    calling: "sage",
    extra: [],
    hp: 280,
    attack: 24,
    speed: 0.65,
    range: 3,
    armour: 15,
    ward: 25,
    mana: [20, 70],
    ability: {
      name: "Who Goes There",
      shape: "bolt",
      text: "Holds the lantern up at the {count} nearest enemies: {damage} magic damage each.",
      n: { count: [3, 3, 3], damage: [90, 160, 285] },
      short: "{damage} magic to each of {count} nearest enemies.",
    },
    quip: "Keeps the lantern lit. Will not say for whom.",
  },

  // ---------- three acorns ----------
  leafling: {
    name: "Leafling",
    tier: 3,
    kin: "moss",
    calling: "sage",
    extra: [],
    hp: 420,
    attack: 30,
    speed: 0.7,
    range: 3,
    armour: 20,
    ward: 25,
    mana: [20, 70],
    ability: {
      name: "Proper Instruction",
      shape: "ally",
      text: "Tells the {count} friends nearest it how to do things properly: +{attack}% attack for the rest of the fight.",
      n: { count: [2, 2, 3], attack: [22, 36, 60] },
      short: "+{attack}% attack to {count} nearest allies. Lasts the fight.",
    },
    quip: "A sprout with opinions.",
  },
  cindernewt: {
    name: "Cinder Newt",
    tier: 3,
    kin: "ember",
    calling: "sage",
    extra: [],
    hp: 440,
    attack: 34,
    speed: 0.7,
    range: 2,
    armour: 20,
    ward: 25,
    mana: [20, 80],
    ability: {
      name: "Warm Breath",
      shape: "cone",
      text: "Breathes out over its target: {damage} magic damage to every enemy in a cone two hexes deep.",
      n: { damage: [150, 260, 470] },
      short: "{damage} magic in a cone, 2 hexes deep.",
    },
    quip: "Lives in the embers. Complains about the cold.",
  },
  drizzlefrog: {
    name: "Drizzle Frog",
    tier: 3,
    kin: "mist",
    calling: "slinger",
    extra: [],
    hp: 400,
    attack: 44,
    speed: 0.75,
    range: 3,
    armour: 15,
    ward: 20,
    mana: [0, 70],
    ability: {
      name: "One Big Drop",
      shape: "bolt",
      text: "Spits one big drop at its target: {damage} magic damage, and it is {slow}% slower for {lasts} seconds.",
      n: { damage: [190, 330, 600], slow: [30, 30, 30], lasts: [3, 3, 3] },
      short: "{damage} magic to target. Slows {slow}% for {lasts}s.",
    },
    quip: "Spits. Apologises. Spits again.",
  },
  rock: {
    name: "Rock",
    tier: 3,
    kin: "burrow",
    calling: "bulwark",
    extra: [],
    hp: 820,
    attack: 0,
    speed: 0,
    range: 1,
    armour: 55,
    ward: 45,
    mana: [30, 60],
    rooted: true,
    ability: {
      name: "It Is A Rock",
      shape: "self",
      text: "Does nothing, pointedly. For {lasts} seconds it takes {less}% less from every hit, and enemies that hit it up close take {stub} damage.",
      n: { lasts: [4, 4, 4], less: [40, 50, 60], stub: [45, 80, 145] },
      short: "Takes {less}% less damage for {lasts}s. Enemies hitting it up close take {stub}.",
    },
    quip: "It is a rock. It came anyway.",
  },
  bushgnome: {
    name: "Gnome In A Bush",
    tier: 3,
    kin: "gnome",
    calling: "sneak",
    extra: [],
    hp: 400,
    attack: 42,
    speed: 0.8,
    range: 1,
    armour: 20,
    ward: 20,
    mana: [0, 50],
    ability: {
      name: "It Was A Bush",
      shape: "bolt",
      text: "Jumps out at its target: {damage} physical damage, and 50% more if the target was attacking somebody else.",
      n: { damage: [160, 280, 500] },
      short: "{damage} physical to target. +50% if it is attacking another.",
    },
    quip: "It is a bush. Pay it no mind.",
  },
  crab23: {
    name: "Crab #23",
    tier: 3,
    kin: "crab",
    calling: "mender",
    extra: [],
    hp: 430,
    attack: 28,
    speed: 0.65,
    range: 2,
    armour: 25,
    ward: 25,
    mana: [30, 80],
    ability: {
      name: "Plasters",
      shape: "ally",
      text: "Hands out plasters to the {count} most hurt in the party: {heal} health back each.",
      n: { count: [2, 2, 3], heal: [140, 240, 430] },
      short: "{count} most hurt allies: heal {heal} each.",
    },
    quip: "A plaster in each claw. Applies them sideways.",
  },

  // ---------- four acorns ----------
  badger: {
    name: "Badger",
    tier: 4,
    kin: "burrow",
    calling: "fang",
    extra: [],
    hp: 720,
    attack: 58,
    speed: 0.75,
    range: 1,
    armour: 35,
    ward: 25,
    mana: [0, 70],
    ability: {
      name: "Clear The Sett",
      shape: "ring",
      text: "Turns right round with its claws out: {damage} physical damage to every enemy touching it, and it heals for {leech}% of what lands.",
      n: { damage: [170, 300, 540], leech: [30, 30, 30] },
      short: "{damage} physical to adjacent enemies. Heals {leech}% of what lands.",
    },
    quip: "Was asleep. Is not now. Blames you.",
  },
  fogowl: {
    name: "Fog Owl",
    tier: 4,
    kin: "feather",
    calling: "sneak",
    extra: [],
    hp: 560,
    attack: 62,
    speed: 0.8,
    range: 1,
    armour: 25,
    ward: 25,
    mana: [20, 70],
    ability: {
      name: "Out Of The Fog",
      shape: "leap",
      text: "Swoops onto the enemy furthest away: {damage} physical damage, and it is stunned for {stun} seconds.",
      n: { damage: [240, 420, 760], stun: [1.5, 1.5, 2] },
      short: "Leaps to furthest enemy: {damage} physical. Stuns {stun}s.",
    },
    quip: "You will not hear it. It heard you.",
  },
  heron: {
    name: "Reed Heron",
    tier: 4,
    kin: "feather",
    calling: "slinger",
    extra: [],
    hp: 540,
    attack: 64,
    speed: 0.7,
    range: 4,
    armour: 20,
    ward: 20,
    mana: [0, 70],
    ability: {
      name: "One Long Stab",
      shape: "line",
      text: "Stabs straight through its target: {damage} physical damage to every enemy on a line {length} hexes long.",
      n: { damage: [220, 385, 700], length: [5, 5, 5] },
      short: "{damage} physical along a {length}-hex line.",
    },
    quip: "Stands on one leg. The other is for emergencies.",
  },
  crab40: {
    name: "Crab #40",
    tier: 4,
    kin: "crab",
    calling: "bulwark",
    extra: [],
    hp: 850,
    attack: 40,
    speed: 0.55,
    range: 1,
    armour: 55,
    ward: 35,
    mana: [40, 90],
    ability: {
      name: "Hold The Line",
      shape: "ring",
      text: "Gets in everybody's way: a shield of {shield} for {lasts} seconds, and every enemy within two hexes has to attack it for {taunt} seconds.",
      n: { shield: [300, 520, 940], lasts: [4, 4, 4], taunt: [3, 3, 4] },
      short: "Shield {shield} for {lasts}s. Taunts enemies in 2 hexes for {taunt}s.",
    },
    quip: "Wide. Has never once been counted wrong.",
  },
  apothecary: {
    name: "Apothecary Gnome",
    tier: 4,
    kin: "gnome",
    calling: "mender",
    extra: [],
    hp: 540,
    attack: 34,
    speed: 0.65,
    range: 3,
    armour: 20,
    ward: 30,
    mana: [30, 90],
    ability: {
      name: "Tonic For Everyone",
      shape: "ring",
      text: "A spoonful each for itself and every friend within two hexes: {heal} health back, and {haste}% faster attacks for {lasts} seconds.",
      n: { heal: [180, 310, 560], haste: [25, 25, 25], lasts: [4, 4, 4] },
      short: "Heals self and allies in 2 hexes for {heal}. +{haste}% attack speed for {lasts}s.",
    },
    quip: "It is good for you. Do not ask what is in it.",
  },

  // ---------- five acorns ----------
  greg: {
    name: "Greg",
    tier: 5,
    kin: "moss",
    calling: "bulwark",
    extra: ["greg"],
    hp: 880,
    attack: 54,
    speed: 0.6,
    range: 1,
    armour: 50,
    ward: 40,
    mana: [40, 100],
    ability: {
      name: "Greg Sits Down",
      shape: "ring",
      text: "Greg sits down. Every enemy within two hexes takes {damage} magic damage and is stunned for {stun} seconds.",
      n: { damage: [200, 350, 800], stun: [1.25, 1.75, 2.5] },
      short: "{damage} magic to enemies in 2 hexes. Stuns {stun}s.",
    },
    quip: "Eats offerings. All of them.",
  },
  whitefox: {
    name: "Orphion",
    tier: 5,
    kin: "mist",
    calling: "fang",
    extra: ["sage"],
    hp: 760,
    attack: 72,
    speed: 0.85,
    range: 1,
    armour: 35,
    ward: 35,
    mana: [0, 80],
    ability: {
      name: "Antlers Ring",
      shape: "ring",
      text: "Its gold antlers ring: {damage} magic damage to every enemy within two hexes, and the whole party attacks {haste}% faster for {lasts} seconds.",
      n: { damage: [160, 280, 640], haste: [20, 35, 60], lasts: [4, 4, 4] },
      short: "{damage} magic to enemies in 2 hexes. Party attacks {haste}% faster for {lasts}s.",
    },
    quip: "Nobody knows whose it is.",
  },
  hearthcat: {
    name: "Hearth Cat",
    tier: 5,
    kin: "ember",
    calling: "sneak",
    extra: ["fang"],
    hp: 700,
    attack: 76,
    speed: 0.9,
    range: 1,
    armour: 30,
    ward: 30,
    mana: [0, 60],
    ability: {
      name: "Off The Table",
      shape: "bolt",
      text: "Looks at its target, then bats it off its hex: {damage} physical damage, knocked back {push} hexes, stunned for {stun} seconds.",
      n: { damage: [280, 490, 1100], push: [2, 2, 3], stun: [1.5, 1.5, 2.5] },
      short: "{damage} physical to target. Knocks back {push} hexes, stuns {stun}s.",
    },
    quip: "Sits on the board. Things fall off.",
  },
};

// ---------- the ones that are only ever summoned ----------

export const SUMMON_IDS = ["glorplet", "uncounted", "biguncounted", "sprout"] as const;
export type SummonId = (typeof SUMMON_IDS)[number];
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
    name: "Bramble Runner",
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
};

// ---------- the forest's trouble, and its bosses ----------

export const TROUBLE_IDS = [
  "gnat",
  "bramble",
  "wasp",
  "puddle",
  "toadstool",
  "gust",
  "magpie",
  "mud",
  "crab",
  "oldbramble",
  "hoardmagpie",
  "bigcrab",
] as const;
export type TroubleId = (typeof TROUBLE_IDS)[number];
export const BOSS_IDS = ["oldbramble", "hoardmagpie", "bigcrab"] as const satisfies readonly TroubleId[];
export type BossId = (typeof BOSS_IDS)[number];

export const TROUBLE: Record<TroubleId, UnitSpec> = {
  gnat: {
    name: "Gnat",
    hp: 110,
    attack: 14,
    speed: 1,
    range: 1,
    armour: 0,
    ward: 0,
    mana: [0, 0],
    ability: null,
    quip: "There are always more.",
  },
  bramble: {
    name: "Bramble",
    hp: 300,
    attack: 20,
    speed: 0.6,
    range: 1,
    armour: 30,
    ward: 10,
    mana: [0, 0],
    ability: {
      name: "Thorny",
      shape: "always",
      text: "Whoever attacks it up close takes {thorns} damage.",
      n: { thorns: [10, 18, 32] },
      short: "Enemies hitting it up close take {thorns}.",
    },
    quip: "It was here first.",
  },
  wasp: {
    name: "Wasp",
    hp: 150,
    attack: 30,
    speed: 1,
    range: 1,
    armour: 5,
    ward: 5,
    mana: [0, 50],
    ability: {
      name: "Sting",
      shape: "bolt",
      text: "Stings its target: {damage} damage that no armour stops.",
      n: { damage: [50, 90, 160] },
      short: "{damage} true to target.",
    },
    quip: "All sting, no patience.",
  },
  puddle: {
    name: "Puddle",
    hp: 480,
    attack: 18,
    speed: 0.6,
    range: 1,
    armour: 20,
    ward: 40,
    mana: [20, 70],
    ability: {
      name: "Splash",
      shape: "ring",
      text: "Splashes every enemy touching it: {damage} magic damage, and they are {slow}% slower for {lasts} seconds.",
      n: { damage: [40, 70, 125], slow: [30, 35, 40], lasts: [3, 3, 3] },
      short: "{damage} magic to adjacent enemies. Slows {slow}% for {lasts}s.",
    },
    quip: "Deeper than it looks.",
  },
  toadstool: {
    name: "Toadstool",
    hp: 260,
    attack: 24,
    speed: 0.6,
    range: 3,
    armour: 10,
    ward: 20,
    mana: [0, 0],
    ability: {
      name: "Spores",
      shape: "always",
      text: "When it falls it puffs spores: {damage} magic damage to every enemy within two hexes.",
      n: { damage: [70, 120, 215] },
      short: "On falling, {damage} magic within 2 hexes.",
    },
    quip: "Do not sit on it.",
  },
  gust: {
    name: "Gust",
    hp: 240,
    attack: 22,
    speed: 0.8,
    range: 3,
    armour: 10,
    ward: 20,
    mana: [20, 70],
    ability: {
      name: "Whoosh",
      shape: "bolt",
      text: "Blows its target back {push} hexes: {damage} magic damage, and it is {slow}% slower for {lasts} seconds. Unless it is a Rock.",
      n: { push: [2, 2, 3], damage: [50, 90, 160], slow: [30, 30, 30], lasts: [2, 2, 2] },
      short: "Knocks target back {push} hexes, {damage} magic. Slows {slow}% for {lasts}s.",
    },
    quip: "Rearranges things.",
  },
  magpie: {
    name: "Magpie",
    hp: 300,
    attack: 34,
    speed: 0.85,
    range: 1,
    armour: 15,
    ward: 15,
    mana: [0, 60],
    ability: {
      name: "Peck",
      shape: "bolt",
      text: "Flies to your back row when the fight starts. Pecks its target for {damage} physical damage, and 50% more if the target holds an item.",
      n: { damage: [90, 160, 285] },
      short: "Starts in your back row. {damage} physical, +50% vs item holders.",
    },
    quip: "Likes shiny things. You are shiny.",
  },
  mud: {
    name: "Mud",
    hp: 700,
    attack: 30,
    speed: 0.5,
    range: 1,
    armour: 40,
    ward: 20,
    mana: [30, 90],
    ability: {
      name: "Squelch",
      shape: "ring",
      text: "Squelches: {damage} magic damage to every enemy touching it, and they are stuck for {stun} second.",
      n: { damage: [60, 105, 190], stun: [1, 1, 1.5] },
      short: "{damage} magic to adjacent enemies. Stuns {stun}s.",
    },
    quip: "A great deal of mud.",
  },
  crab: {
    name: "Counted Crab",
    hp: 380,
    attack: 30,
    speed: 0.65,
    range: 1,
    armour: 35,
    ward: 20,
    mana: [0, 0],
    ability: {
      name: "Shell",
      shape: "always",
      text: "Starts the fight inside its shell: a shield of {shell} that lasts until it is broken.",
      n: { shell: [120, 215, 390] },
      short: "Shield {shell} until broken.",
    },
    quip: "Present at roll call.",
  },
  oldbramble: {
    name: "Old Bramble",
    hp: 1500,
    attack: 52,
    speed: 0.6,
    range: 1,
    armour: 40,
    ward: 20,
    mana: [40, 90],
    steady: true,
    ability: {
      name: "Runners",
      shape: "summon",
      text: "Whoever attacks it up close takes {thorns} damage. Puts out a runner: a Bramble Runner sprouts beside the nearest enemy, at most {most} at a time.",
      n: { thorns: [12, 21, 38], most: [3, 3, 4] },
      short: "Enemies hitting it up close take {thorns}. Sprouts runners by enemies, {most} at most.",
    },
    quip: "It was here first. It will be here last.",
  },
  hoardmagpie: {
    name: "The Magpie With The Hoard",
    hp: 1950,
    attack: 72,
    speed: 0.9,
    range: 1,
    armour: 30,
    ward: 30,
    mana: [20, 80],
    steady: true,
    ability: {
      name: "Mine Now",
      shape: "leap",
      text: "Swoops on whoever is holding the most shiny things: {damage} physical damage, and they are stunned for {stun} seconds.",
      n: { damage: [230, 400, 720], stun: [1.5, 1.5, 2] },
      short: "Leaps to whoever holds most items. {damage} physical, stuns {stun}s.",
    },
    quip: "Everything in the hoard was yours once.",
  },
  bigcrab: {
    name: "The Crab Nobody Counted",
    hp: 5400,
    attack: 130,
    speed: 0.7,
    range: 1,
    armour: 60,
    ward: 40,
    mana: [40, 90],
    steady: true,
    ability: {
      name: "Crabbier",
      shape: "cone",
      text: "Starts inside a shell worth {shell}. Gets crabbier: +{attack}% attack for the rest of the fight, and a pinch of {damage} physical damage across a cone two hexes deep. At half health it calls the roll: {crabs} more crabs nobody counted turn up.",
      n: { shell: [800, 1440, 2600], attack: [15, 15, 15], damage: [320, 560, 1000], crabs: [2, 2, 3] },
      short: "+{attack}% attack, {damage} physical in a cone. Shield {shell}; {crabs} more crabs at half health.",
    },
    quip: "Every roll call, one crab is unaccounted for. Here it is.",
  },
};

// ---------- everyone ----------

export type UnitKind = FigureId | SummonId | TroubleId;
const has = <K extends string>(table: Readonly<Record<K, unknown>>, v: unknown): v is K =>
  typeof v === "string" && Object.hasOwn(table, v);
export const isFigureId = (v: unknown): v is FigureId => has(FIGURES, v);
export const isSummonId = (v: unknown): v is SummonId => has(SUMMONS, v);
export const isTroubleId = (v: unknown): v is TroubleId => has(TROUBLE, v);
export const isUnitKind = (v: unknown): v is UnitKind => isFigureId(v) || isSummonId(v) || isTroubleId(v);
export const isBossId = (v: unknown): v is BossId => BOSS_IDS.some((b) => b === v);
export const isStars = (v: unknown): v is Stars => v === 1 || v === 2 || v === 3;

/** The numbers and words for anyone who can stand on the board. */
export function specOf(kind: UnitKind): UnitSpec {
  if (isFigureId(kind)) return FIGURES[kind];
  if (isSummonId(kind)) return SUMMONS[kind];
  return TROUBLE[kind];
}
/** A figure's traits: its kin, its calling, and a third if it has one. */
export const traitsOf = (kind: FigureId): readonly TraitId[] => {
  const f = FIGURES[kind];
  return [f.kin, f.calling, ...f.extra];
};
/** One of an ability's numbers at a number of stars; 0 if it has no such number. */
export function abilityNumber(kind: UnitKind, name: string, stars: Stars): number {
  return specOf(kind).ability?.n[name]?.[stars - 1] ?? 0;
}
/** Fills an ability's `{name}` gaps with its numbers at a number of stars. */
function filled(ability: AbilitySpec, text: string, stars: Stars): string {
  return text.replaceAll(/\{(\w+)\}/g, (whole: string, key: string) => {
    const v = ability.n[key]?.[stars - 1];
    return v === undefined ? whole : String(v);
  });
}
/** What an ability does at a number of stars, in a sentence. */
export function abilityText(kind: UnitKind, stars: Stars): string {
  const ability = specOf(kind).ability;
  return ability ? filled(ability, ability.text, stars) : "";
}
/** What an ability does at a number of stars, in a few words for a card. */
export function abilityShort(kind: UnitKind, stars: Stars): string {
  const ability = specOf(kind).ability;
  return ability ? filled(ability, ability.short, stars) : "";
}
/** The figures of a tier, in the order of the table. */
export const figuresOfTier = (tier: Tier): FigureId[] => FIGURE_IDS.filter((id) => FIGURES[id].tier === tier);
