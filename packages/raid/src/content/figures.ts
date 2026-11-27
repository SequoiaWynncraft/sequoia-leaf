/**
 * Who is on the stump: the carved figures a member can buy at the stall, the forest's trouble and
 * its three bosses (`trouble.ts`), and the few that only ever turn up by being summoned (`summons.ts`). Words and numbers only;
 * what an ability does on the board is in `fight/abilities.ts`, keyed by the same name as its owner
 * here.
 *
 * The figures here are the twenty-eight the raid opened with and the first banner's member, as the
 * base release brought them (`releases/base.ts`); later releases bring more and change these in
 * their patches (`releases/`), and `FIGURE_IDS` names every one any release brings everyone. A
 * figure is read from a catalogue (`catalog.ts`), as its era has it.
 *
 * Every number is for one star. Two stars multiply health and attack by `STAR[1]`, three by
 * `STAR[2]`; an ability's own numbers are written out for each star. In an ability's sentence,
 * `{name}` is filled from its numbers.
 *
 * Every ability is said twice: `text` is the sentence in the guild's voice that the almanac shows,
 * and `short` is what a card on the table shows: effects and numbers only, in at most two short
 * fragments.
 */
import type { Catalog, Figure } from "./catalog.ts";
import { MEMBER_IDS, type MemberId, MEMBERS } from "./members.ts";
import { opened } from "./patch.ts";
import { isSummonId, type SummonId, SUMMONS } from "./summons.ts";
import type { CallingId, KinId, TraitId } from "./traits.ts";
import { isTroubleId, TROUBLE, type TroubleId } from "./trouble.ts";

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

export { GROOTER_IDS, type GrooterId, isGrooterId, isSummonId, SUMMON_IDS, type SummonId, SUMMONS } from "./summons.ts";
export { BOSS_IDS, type BossId, isBossId, isTroubleId, TROUBLE, TROUBLE_IDS, type TroubleId } from "./trouble.ts";

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

/** Groot Night's and Penguin Month's, each in the order its release brought them. */
const NIGHT_IDS = ["peep", "crab31", "munch", "clutch", "crab8"] as const;
const PENGUIN_IDS = ["dibs", "jet", "larp", "flurry", "pomp", "yule"] as const;
const TREE_IDS = ["vi", "flop", "bhlue", "ace", "unc", "leetanns"] as const;
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
  "seqwawa",
  ...NIGHT_IDS,
  ...PENGUIN_IDS,
  ...TREE_IDS,
] as const;
/** A figure a member can field: one of everyone's, or a banner's member (`members.ts`). */
export type FigureId = (typeof FIGURE_IDS)[number] | MemberId;

/** The figures the base release brought, as it brought them: read only by its patch (`releases/base.ts`). */
export const BASE_FIGURES: Readonly<Partial<Record<FigureId, FigureSpec>>> = {
  ...MEMBERS,
  // ---------- one acorn ----------
  emberkit: {
    name: "Flint",
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
    name: "Velvet",
    tier: 1,
    kin: "moss",
    calling: "mender",
    extra: [],
    hp: 250,
    attack: 20,
    speed: 0.65,
    range: 4,
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
    hp: 210,
    attack: 22,
    speed: 0.7,
    range: 4,
    armour: 10,
    ward: 20,
    mana: [10, 60],
    ability: {
      name: "Wing Dust",
      shape: "bolt",
      text: "Shakes its wings over its target: {damage} magic damage to it and to every enemy touching it, and dust on those hexes for {lasts} seconds that does {dust} magic damage a second to enemies there.",
      n: { damage: [80, 140, 250], dust: [20, 35, 63], lasts: [2, 2, 2] },
      short: "{damage} magic to target and adjacent enemies. Dust {lasts}s: {dust} magic/s to enemies on it.",
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
    name: "Twig",
    tier: 1,
    kin: "feather",
    calling: "slinger",
    extra: [],
    hp: 210,
    attack: 26,
    speed: 0.8,
    range: 4,
    armour: 10,
    ward: 10,
    mana: [0, 50],
    ability: {
      name: "Seed Volley",
      shape: "bolt",
      text: "Spits {seeds} seeds at its target, {damage} physical damage each. A seed whose target has fallen flies on at the nearest enemy.",
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
    name: "Hodge",
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
    name: "Brew",
    tier: 2,
    kin: "ember",
    calling: "mender",
    extra: [],
    hp: 330,
    attack: 24,
    speed: 0.65,
    range: 4,
    armour: 20,
    ward: 20,
    mana: [20, 70],
    ability: {
      name: "Tea",
      shape: "ally",
      text: "Pours for {pours} second: {sips} sips, each to whoever in the party is most hurt then, {heal} health back each.",
      n: { heal: [50, 87, 155], sips: [3, 3, 3], pours: [1, 1, 1] },
      short: "{sips} sips over {pours}s to most hurt ally, {heal} each.",
    },
    quip: "Somebody left it on. It came along.",
  },
  slug: {
    name: "Mosey",
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
      text: "Slimes every enemy touching it: {damage} magic damage, and slime on the hexes touching it for {lasts} seconds, where enemies are {slow}% slower.",
      n: { damage: [60, 105, 190], slow: [30, 40, 50], lasts: [3, 3, 3] },
      short: "{damage} magic to adjacent enemies. Slime {lasts}s: {slow}% slower on it.",
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
    name: "Chuck",
    tier: 2,
    kin: "burrow",
    calling: "slinger",
    extra: [],
    hp: 270,
    attack: 34,
    speed: 0.75,
    range: 4,
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
    name: "Huff",
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
      name: "That Does It",
      shape: "self",
      text: "Loses its temper: dashes to the enemy with the least health within {reach} hexes, then attacks {haste}% faster for {lasts} seconds.",
      n: { haste: [60, 90, 130], lasts: [4, 4, 4], reach: [3, 3, 3] },
      short: "Dashes to weakest enemy in {reach} hexes. Attacks {haste}% faster for {lasts}s.",
    },
    quip: "Has a complaint. Has several.",
  },
  crab12: {
    name: "Crab #12",
    tier: 2,
    kin: "crab",
    calling: "slinger",
    extra: [],
    hp: 280,
    attack: 32,
    speed: 0.7,
    range: 4,
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
    name: "Wick",
    tier: 2,
    kin: "gnome",
    calling: "sage",
    extra: [],
    hp: 260,
    attack: 24,
    speed: 0.65,
    range: 4,
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
    name: "Bud",
    tier: 3,
    kin: "moss",
    calling: "sage",
    extra: [],
    hp: 390,
    attack: 30,
    speed: 0.7,
    range: 4,
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
    name: "Toast",
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
      text: "Breathes out over its target {breaths} times in {lasts} second, turning to it each time: {damage} magic damage each time to every enemy in a cone two hexes deep.",
      n: { damage: [50, 87, 157], breaths: [3, 3, 3], lasts: [1, 1, 1] },
      short: "{damage} magic in a 2-hex cone, {breaths} times in {lasts}s.",
    },
    quip: "Lives in the embers. Complains about the cold.",
  },
  drizzlefrog: {
    name: "Drizzle",
    tier: 3,
    kin: "mist",
    calling: "slinger",
    extra: [],
    hp: 370,
    attack: 44,
    speed: 0.75,
    range: 4,
    armour: 15,
    ward: 20,
    mana: [0, 70],
    ability: {
      name: "One Big Drop",
      shape: "bolt",
      text: "Spits one big drop at its target: {damage} magic damage, and a puddle on its hex and the hexes touching it for {lasts} seconds, where enemies are {slow}% slower.",
      n: { damage: [190, 330, 600], slow: [30, 30, 30], lasts: [3, 3, 3] },
      short: "{damage} magic to target. Puddle {lasts}s: {slow}% slower in it.",
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
    name: "Shrub",
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
      text: "Hides in its bush for {hides} second, where nothing can reach it, then jumps out beside its target: {damage} physical damage, and 50% more if the target was attacking somebody else.",
      n: { damage: [160, 280, 500], hides: [1, 1, 1] },
      short: "Hides {hides}s, then {damage} physical to target. +50% if it is attacking another.",
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
    name: "Grudge",
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
    name: "Eaves",
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
      text: "Swoops onto the enemy with the least health of those furthest away, up to 1 hex nearer than the furthest: {damage} physical damage, and it is stunned for {stun} seconds.",
      n: { damage: [240, 420, 760], stun: [1.5, 1.5, 2] },
      short: "Leaps to weakest far enemy: {damage} physical. Stuns {stun}s.",
    },
    quip: "You will not hear it. It heard you.",
  },
  heron: {
    name: "Reed",
    tier: 4,
    kin: "feather",
    calling: "slinger",
    extra: [],
    hp: 500,
    attack: 64,
    speed: 0.7,
    range: 5,
    armour: 20,
    ward: 20,
    mana: [0, 70],
    ability: {
      name: "One Long Stab",
      shape: "line",
      text: "Marks a line {length} hexes long through its target, then {mark} seconds later stabs along it: {damage} physical damage to every enemy on it by then.",
      n: { damage: [220, 385, 700], length: [5, 5, 5], mark: [0.5, 0.5, 0.5] },
      short: "Marks a {length}-hex line, stabs {mark}s later. {damage} physical to enemies on it.",
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
      name: "In The Way",
      shape: "ring",
      text: "Gets in everybody's way: pulls every enemy within two hexes 1 hex nearer, then a shield of {shield} for {lasts} seconds, and they have to attack it for {taunt} seconds.",
      n: { shield: [300, 520, 940], lasts: [4, 4, 4], taunt: [3, 3, 4] },
      short: "Pulls enemies in 2 hexes 1 hex in, taunts {taunt}s. Shield {shield} for {lasts}s.",
    },
    quip: "Wide. Has never once been counted wrong.",
  },
  apothecary: {
    name: "Dose",
    tier: 4,
    kin: "gnome",
    calling: "mender",
    extra: [],
    hp: 540,
    attack: 34,
    speed: 0.65,
    range: 2,
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
      text: "Greg jumps onto the free hex within {jump} hexes that has the most enemies touching it, and sits down. Every enemy within two hexes takes {damage} magic damage and is stunned for {stun} seconds.",
      n: { damage: [200, 350, 800], stun: [1.25, 1.75, 2.5], jump: [3, 3, 3] },
      short: "Jumps into the crowd. {damage} magic to enemies in 2 hexes, stuns {stun}s.",
    },
    quip: "Eats offerings. All of them.",
  },
  whitefox: {
    name: "Orphion",
    tier: 5,
    kin: "mist",
    calling: "fang",
    extra: ["sage"],
    hp: 700,
    attack: 62,
    speed: 0.85,
    range: 1,
    armour: 35,
    ward: 35,
    mana: [0, 90],
    ability: {
      name: "Antlers Ring",
      shape: "ring",
      text: "Its gold antlers ring: {damage} magic damage to every enemy within two hexes, and the whole party attacks {haste}% faster for {lasts} seconds.",
      n: { damage: [160, 280, 640], haste: [12, 20, 35], lasts: [4, 4, 4] },
      short: "{damage} magic to enemies in 2 hexes. Party attacks {haste}% faster for {lasts}s.",
    },
    quip: "Nobody knows whose it is.",
  },
  hearthcat: {
    name: "Vesta",
    tier: 5,
    kin: "ember",
    calling: "sneak",
    extra: ["fang"],
    hp: 700,
    attack: 66,
    speed: 0.9,
    range: 1,
    armour: 30,
    ward: 30,
    mana: [0, 70],
    ability: {
      name: "Off The Table",
      shape: "bolt",
      text: "Looks at its target, then bats it off its hex: {damage} physical damage, knocked back {push} hexes, stunned for {stun} seconds.",
      n: { damage: [240, 420, 950], push: [2, 2, 3], stun: [1.5, 1.5, 2.5] },
      short: "{damage} physical to target. Knocks back {push} hexes, stuns {stun}s.",
    },
    quip: "Sits on the board. Things fall off.",
  },
};

// ---------- everyone ----------

export type UnitKind = FigureId | SummonId | TroubleId;
const EVERY_FIGURE: ReadonlySet<string> = new Set([...FIGURE_IDS, ...MEMBER_IDS]);
/** Whether stored data names a figure: one any release has, open or not (`everyFigure`). */
export const isFigureId = (v: unknown): v is FigureId => typeof v === "string" && EVERY_FIGURE.has(v);
export const isUnitKind = (v: unknown): v is UnitKind => isFigureId(v) || isSummonId(v) || isTroubleId(v);
export const isStars = (v: unknown): v is Stars => v === 1 || v === 2 || v === 3;

/** A figure as a catalogue has it. */
export const figureIn = (cat: Catalog, id: FigureId): Figure => opened(cat.figures, id, cat.era);
/** The numbers and words for anyone who can stand on the board: a figure as the catalogue has it. */
export const specOf = (cat: Catalog, kind: UnitKind): UnitSpec =>
  isFigureId(kind) ? figureIn(cat, kind) : isSummonId(kind) ? SUMMONS[kind] : TROUBLE[kind];

/** A figure's traits: its kin, its calling, and a third if it has one. */
export const traitsOf = (cat: Catalog, kind: FigureId): readonly TraitId[] => {
  const f = figureIn(cat, kind);
  return [f.kin, f.calling, ...f.extra];
};
/** One of an ability's numbers at a number of stars; 0 if it has no such number. */
export function abilityNumber(cat: Catalog, kind: UnitKind, name: string, stars: Stars): number {
  return specOf(cat, kind).ability?.n[name]?.[stars - 1] ?? 0;
}
/** An ability's sentence (`text`) or card words (`short`) at a number of stars, its `{name}` gaps filled with its numbers. */
function filled(cat: Catalog, kind: UnitKind, words: "text" | "short", stars: Stars): string {
  const ability = specOf(cat, kind).ability;
  return (ability?.[words] ?? "").replaceAll(/\{(\w+)\}/g, (whole: string, key: string) => {
    const v = ability?.n[key]?.[stars - 1];
    return v === undefined ? whole : String(v);
  });
}
/** What an ability does at a number of stars, in a sentence. */
export const abilityText = (cat: Catalog, kind: UnitKind, stars: Stars): string => filled(cat, kind, "text", stars);
/** What an ability does at a number of stars, in a few words for a card. */
export const abilityShort = (cat: Catalog, kind: UnitKind, stars: Stars): string => filled(cat, kind, "short", stars);
