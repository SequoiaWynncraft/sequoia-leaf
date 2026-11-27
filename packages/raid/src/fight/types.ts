/**
 * What a fight is made of: the figures on the board as they stand at this step of the clock, and
 * the plain events a step gives back for a screen to show.
 */
import type { BoonId } from "../content/boons.ts";
import type { Catalog } from "../content/catalog.ts";
import type { Shape, Stars, UnitKind } from "../content/figures.ts";
import type { ItemId } from "../content/items.ts";
import type { Era } from "../content/releases.ts";
import type { FightRules } from "../content/rules.ts";
import type { TraitId } from "../content/traits.ts";
import type { RuleId } from "../content/wilds.ts";
import type { Side } from "../hex.ts";
import type { Party } from "../party.ts";

export type DamageKind = "physical" | "magic" | "true";
/** Where damage came from. Only attacks and abilities fill mana and set off the things that answer a hit. */
export type DamageSource = "attack" | "ability" | "burn" | "thorns" | "item" | "dusk";
export type HealSource = "ability" | "regrow" | "burrow" | "item" | "leech";
export type StatusId = "burn" | "stun" | "slow" | "shield" | "taunt" | "hidden" | "haste" | "braced" | "cracked";
/** How a fight went, for the party at the table (side 0). */
export type FightResult = "win" | "loss" | "draw";
/** Why somebody changed hex without walking: a Sneak's opening leap, an ability, knocked back, dashing, or pulled. */
export type LeapWhy = "sneak" | "ability" | "knocked" | "dash" | "pull";
/** What a zone is: slime and puddles slow whoever stands in them, dust hurts them every second. */
export type ZoneKind = "slime" | "puddle" | "dust";
/** How a figure stands in a fight: as itself, or (a Graid figure that got back up) in its true form (`content/graid.ts`). */
export type Form = "plain" | "true";
/** Why a figure got back up: Second Wind, Graid, or Seqwawa's No GG Left Behind. */
export type RiseWhy = "wind" | "graid" | "seqwawa";

/** Everything a fight needs: two parties and a seed, its era, and what binds its room. The same setup always gives the same fight. */
export interface FightSetup {
  seed: number;
  /** The era it was locked in (`releases.ts`): it is played by that era's catalogue for ever. */
  era: Era;
  /** The party at the table first, then the one across from it. */
  sides: [Party, Party];
  /**
   * What binds it, as its room's rules set it apart from plain (`content/rules.ts`, `room.ts`); absent
   * under none. It is played by these numbers for ever, and never by which rules set them.
   */
  rules?: Partial<FightRules>;
  /** The Wilds' rules in force in its room, for what the page says and draws of the fight; the fight never reads them. */
  named?: RuleId[];
}

/**
 * One figure in a fight. A screen reads where it is and how it is doing from here between steps;
 * times are in steps of the fight's clock, and a status is on while its `Until` is past `tick`.
 */
export interface Unit {
  readonly id: number;
  readonly side: Side;
  readonly kind: UnitKind;
  readonly stars: Stars;
  readonly name: string;
  /** Made during the fight rather than brought to it. */
  readonly summoned: boolean;
  /** Who summoned it; -1 for nobody, or for a trait. */
  readonly owner: number;
  /** What it holds. */
  readonly items: readonly ItemId[];
  /** Where it started on its own half; -1 for the summoned. */
  readonly seat: number;
  cell: number;
  alive: boolean;

  /** What its stars, its level and its party's might multiply its health and attack by. */
  readonly grown: number;
  maxHp: number;
  hp: number;
  shield: number;
  attack: number;
  /** Attack as the fight began, which "for the rest of the fight" bonuses are a share of. */
  attack0: number;
  /** Attacks a second, before anything timed. */
  speed: number;
  range: number;
  /** How much nearer than it stands enemies take it to be when they pick a target (fewer hexes for a negative number). */
  draw: number;
  armour: number;
  ward: number;
  /** Ability power, in percent: 100 is plain. */
  power: number;
  mana: number;
  /** 0 for those who never cast. */
  manaFull: number;
  /** Chances in a hundred of landing hard, and of slipping an attack. */
  crit: number;
  slip: number;

  /** Steps until it may attack again. */
  cool: number;
  /** Walking or casting until then. */
  busyUntil: number;
  /** Who it is attacking; -1 for nobody. */
  target: number;
  /** Damage thrown at it and not landed yet, as it would land: what a figure picking a target counts (`mind.ts`). */
  incoming: number;
  /** The step its area ability began waiting for a second enemy to come into it; -1 while it is not waiting. */
  waitFrom: number;
  attacks: number;
  rooted: boolean;
  steady: boolean;
  /** Plain, or its true form once a Graid figure has got back up. */
  form: Form;
  /** Mana it gains every second, whatever it does (Rooted). */
  manaRate: number;
  /** Graid: it still has its getting back up to come, once it falls. */
  rises: boolean;
  /** The step it fell, while it is down for good; -1 while it is up, or down and getting back up. */
  fellAt: number;
  /** Which fall for good of the fight it was, counting in the order they happen (`Fight.falls`); 0 while it is up. */
  fallNo: number;
  /** How many times it has fallen this fight, for a moment or for good: what it does lasts only in the life it began in. */
  downs: number;

  stunUntil: number;
  slowUntil: number;
  slowBy: number;
  burnUntil: number;
  /** Percent of health a second, who lit it, and how much weaker healing is meanwhile. */
  burnBy: number;
  burnFrom: number;
  burnDamp: number;
  shieldUntil: number;
  tauntUntil: number;
  tauntBy: number;
  hiddenUntil: number;
  hasteUntil: number;
  hasteBy: number;
  bracedUntil: number;
  bracedBy: number;
  stub: number;

  // From traits.
  /** Ember: the burn its hits leave. */
  ember: number;
  /** Feather: percent faster for each attack made, how many attacks count, and how many have. */
  quicken: number;
  quickMost: number;
  quick: number;
  /** Slinger: percent more for each attack in a row on one target. */
  focusBy: number;
  focusMost: number;
  focusOn: number;
  focus: number;
  /** Sage and Glowthorn: more mana an attack. */
  manaMore: number;
  /** Mender: percent more healing and shielding. */
  mending: number;
  /** Sneak: attacks left that land hard, and how much harder. */
  sneakHits: number;
  sneakBy: number;
  /** Burrow: still has its digging in to come, the health it gets back, and how much less it takes for how many seconds. */
  digs: boolean;
  digHeal: number;
  digLess: number;
  digFor: number;
  /** Health regrown each second, in percent. */
  regrow: number;
  /** Grooter: the armour and ward each of its hits cracks, and the most it cracks a target to (of its `cracked`). */
  crack: number;
  crackMost: number;

  // From what it is.
  /** Damage to whoever attacks it up close. */
  thorns: number;
  /** The big crab has called the roll. */
  called: boolean;
  /** Armour and ward cracked off it so far (`crack`): the total asked for, whatever its numbers came down to. */
  cracked: number;
  /** Mana friends' abilities gave it, and at which step, while it still counts against the gift cap (`giveMana`). */
  gifts: { at: number; n: number }[];
  /** The Commodore: the grooter he called last (`GROOTER_IDS`), -1 before his first. */
  calledLast: number;

  // From items.
  pierce: number;
  twice: number;
  prickle: number;
  clip: number;
  leech: number;
  powerGrow: number;
  castShield: number;
  castShieldFor: number;
  serveEvery: number;
  serveHeal: number;
  noHard: boolean;
  stunCut: number;
  logUnder: number;
  logShield: number;
  logFor: number;

  // Tallies, for the summary.
  dealt: number;
  taken: number;
  healed: number;
  casts: number;
}

/** Hexes marked by somebody's ability for a while: enemies of `side` standing in them are slowed, or hurt every second. */
export interface Zone {
  /** Whose it is. */
  readonly id: number;
  readonly side: Side;
  readonly kind: ZoneKind;
  /** Percent slower, and magic damage a second. */
  readonly slow: number;
  readonly damage: number;
}

/** Something on its way that lands at a step. */
export interface Pending {
  at: number;
  land: () => void;
}

export interface Fight {
  readonly seed: number;
  /** The catalogue of its setup's era: every figure's, trait's, item's and boon's numbers, as they were when it was locked. */
  readonly cat: Catalog;
  /** The random stream. */
  rng: number;
  /** Steps since the fight began. */
  tick: number;
  /** Everyone who has been in the fight, fallen or not; a figure's `id` is its place here. */
  units: Unit[];
  /** For each hex, who stands on it; -1 where nobody does. */
  taken: number[];
  /** For each hex, the zone on it; the newest wins. */
  zones: (Zone | null)[];
  /** How many are still up on each side. */
  standing: [number, number];
  /** How many falls for good there have been, in the order they happened: a fallen figure's `fallNo`. */
  falls: number;
  over: boolean;
  result: FightResult | null;
  /** What happened as the two parties sat down: traits, summons, leaps. A screen plays these before the first step. */
  opening: FightEvent[];
  /** The traits each side has on, and at what step. */
  traits: [Partial<Record<TraitId, number>>, Partial<Record<TraitId, number>>];
  /** Seconds of dusk so far. */
  dusk: number;
  /** What binds this fight (`rules.ts`): the closed hexes, the furthest an attack reaches, when dusk falls, Elbow Room's attack. */
  readonly wilds: FightRules;

  /** The list the step being worked out is writing to. */
  out: FightEvent[];
  pending: Pending[];
  boons: [readonly BoonId[], readonly BoonId[]];
  might: [number, number];
  /** Whether each side still has its Second Wind. */
  wind: [boolean, boolean];
}

/** One thing that happened, in the order it happened. Figures are named by `id`; hexes are fight cells. */
export type FightEvent =
  /** Walks to the next hex, arriving in `ticks`. It already counts as standing there. */
  | { t: "move"; id: number; from: number; to: number; ticks: number }
  /** Changes hex without walking: a Sneak's leap, an ability, or being knocked back. */
  | { t: "leap"; id: number; from: number; to: number; why: LeapWhy }
  /** Attacks up close; the hit follows at once. */
  | { t: "swing"; id: number; target: number }
  /** Something flies from one hex to another and lands in `ticks`: an attack from range, or part of an ability. */
  | { t: "shot"; id: number; target: number; from: number; to: number; ticks: number; what: "attack" | "ability" }
  /**
   * Damage lands. `amount` is what the target lost, shield and health together; `soaked` is the
   * part its shield took; `before` is what the hit was before armour, ward and bracing.
   */
  | {
      t: "hit";
      id: number;
      by: number;
      amount: number;
      soaked: number;
      /** The health the target really lost: never more than it had left. */
      lost: number;
      before: number;
      kind: DamageKind;
      source: DamageSource;
      hard: boolean;
      hp: number;
      shield: number;
    }
  /** An attack slips past. */
  | { t: "slip"; id: number; by: number }
  /**
   * An ability begins: whose, its shape, the hexes it covers, who it is aimed at, and how long before
   * it lands. One that is channelled lands in `pulses`, `every` steps apart, the first at once, while
   * its owner stands still.
   */
  | {
      t: "cast";
      id: number;
      kind: UnitKind;
      name: string;
      shape: Shape;
      cells: number[];
      targets: number[];
      ticks: number;
      pulses?: number;
      every?: number;
    }
  | { t: "heal"; id: number; by: number; amount: number; source: HealSource; hp: number }
  /** A shield goes up, or is added to; `shield` is what it now holds. `ticks` of 0 lasts until it is broken. */
  | { t: "shield"; id: number; by: number; amount: number; shield: number; ticks: number }
  /** A status starts or stops. `amount` is its strength where it has one (percent slower, percent of health a second). */
  | { t: "status"; id: number; status: StatusId; on: boolean; ticks: number; amount: number; by: number }
  /** Hexes become a zone of somebody's (`on`), for `ticks`; or stop being it. */
  | { t: "zone"; id: number; side: Side; kind: ZoneKind; cells: number[]; ticks: number; on: boolean }
  /** Somebody's ability marks the hexes it will land on, in `ticks`, on whoever is there by then. */
  | { t: "telegraph"; id: number; cells: number[]; ticks: number }
  /** A lasting change for the rest of the fight. */
  | { t: "boost"; id: number; by: number; stat: "attack"; amount: number }
  /** Falls. A Graid figure that will get back up says in how many steps (`back`); it still counts as standing meanwhile. */
  | { t: "fall"; id: number; by: number; cell: number; back?: number }
  /**
   * Gets back up, on `cell`, with `hp`, in `form`: from Second Wind as it would have fallen (it never
   * did), or a moment after falling, by Graid (in its true form) or by Seqwawa.
   */
  | { t: "rise"; id: number; hp: number; why: RiseWhy; form: Form; cell: number }
  | { t: "summon"; id: number; by: number; kind: UnitKind; cell: number; side: Side }
  /** A trait switches on as the fight starts, with who it touches. */
  | { t: "trait"; side: Side; trait: TraitId; step: number; ids: number[] }
  /** An item does its trick. */
  | { t: "item"; id: number; item: ItemId }
  /** Dusk falls, or deepens: its `n`th second. */
  | { t: "dusk"; n: number }
  | { t: "end"; result: FightResult; tick: number; standing: [number, number] };

/** How one figure did. */
export interface Tally {
  id: number;
  side: Side;
  kind: UnitKind;
  stars: Stars;
  summoned: boolean;
  alive: boolean;
  hp: number;
  maxHp: number;
  dealt: number;
  taken: number;
  healed: number;
  casts: number;
}
/** How a fight went, for when nobody watched it. */
export interface FightSummary {
  result: FightResult;
  ticks: number;
  seconds: number;
  standing: [number, number];
  /** Whether dusk fell before it was over. */
  dusk: boolean;
  units: Tally[];
}
