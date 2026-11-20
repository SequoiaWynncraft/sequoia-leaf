import type { PlayerId } from "./player.ts";
import { levelForXp, type LevelRules } from "./rules.ts";

// Sequoia Grove: each member's tree, its Bloom and care, the cones it gives and
// the spirits inside them. The numbers are data (`GroveRules`, set in rules.ts);
// these functions decide what happens, and the server makes it so.

/** The ranks a cone can hold, commonest first. */
export const GROVE_RANKS = ["leafkin", "sapling", "sprite", "dryad", "druid", "treant", "yggdrasil"] as const;
export type GroveRank = (typeof GROVE_RANKS)[number];

/** Odds are whole numbers out of this many, so the rate card adds up exactly. */
export const ODDS_SCALE = 10_000;

/** A cone's roll is a whole number from 0 to `ROLL_RANGE - 1`, drawn by the server. */
export const ROLL_RANGE = 2 ** 32;

/** The care a member can give their tree. Each spends a charge. */
export const CARE_TOOLS = ["water", "mist", "shears"] as const;
export type CareTool = (typeof CARE_TOOLS)[number];

export interface RankRule {
  readonly rank: GroveRank;
  /** As members see it, such as `Leafkin`. */
  readonly name: string;
  /** How often a cone holds this rank, out of `ODDS_SCALE`. The ranks' odds add up to `ODDS_SCALE`. */
  readonly odds: number;
  /** The spirits of this rank. Each is as likely as the others, apart from a banner's featured spirit. */
  readonly spirits: readonly string[];
}

/**
 * A banner: a season of cones with one featured spirit. A banner runs from
 * `from` until the next one starts. Pity belongs to the member, not the
 * banner, so it carries over when the banner changes.
 */
export interface Banner {
  /** Stored with every opening, so never reuse one. */
  readonly id: string;
  readonly title: string;
  /** The spirit on the banner. A cone of its rank gives it `featuredShare` of the time. */
  readonly featured: string;
  /** Out of `ODDS_SCALE`. */
  readonly featuredShare: number;
  /** When it starts, in milliseconds since the Unix epoch. */
  readonly from: number;
}

export interface GroveRules {
  /** Leaf one cone costs, alone or ten at once: no bulk discount. */
  readonly conePrice: number;
  /** How many cones one purchase or one opening can be. */
  readonly coneBatches: readonly number[];
  /** Commonest first, in the order of `GROVE_RANKS`. */
  readonly ranks: readonly RankRule[];
  readonly pity: {
    /** A cone of `rank` or better is guaranteed within this many cones. */
    readonly cones: number;
    readonly rank: GroveRank;
  };
  /** Oldest first. The one that started last, by the time, is on. */
  readonly banners: readonly Banner[];
  readonly verdant: {
    /** How often any cone's spirit wears the Verdant coat, out of `ODDS_SCALE`. */
    readonly odds: number;
    /** The copy of a spirit that is always Verdant, such as the fourth. */
    readonly copy: number;
  };
  /** A bond's hearts stop deepening here. */
  readonly bondMax: number;
  /** A full Bloom gives a cone and starts again. */
  readonly bloomMax: number;
  /** Bloom one credited raid adds. */
  readonly raidBloom: number;
  /** A care charge comes back this long after it was spent. */
  readonly chargeSeconds: number;
  /** Charges bank up to this many. Nothing wilts, and a full bank just stops filling. */
  readonly chargeMax: number;
  /** Bloom one care action adds. */
  readonly careBloom: number;
  /** How many ways a tree of one level can look. */
  readonly treeVariants: number;
  /** Cones of this rank or better are announced in the Forest; commoner ones would flood it. */
  readonly announceFrom: GroveRank;
}

/** A rank's place, 0 for the commonest. */
export function rankIndex(rank: GroveRank): number {
  return GROVE_RANKS.indexOf(rank);
}

/** The banner on at a moment, or undefined before the first one. */
export function bannerAt(at: number, rules: GroveRules): Banner | undefined {
  return rules.banners.findLast((banner) => banner.from <= at);
}

/** The rank of a spirit, or undefined for an id no cone gives. */
export function rankOfSpirit(spirit: string, rules: GroveRules): GroveRank | undefined {
  return rules.ranks.find((rank) => rank.spirits.includes(spirit))?.rank;
}

// ---------------------------------------------------------------------------------------------
// Cones.

/** What one cone held. */
export interface ConePull {
  readonly rank: GroveRank;
  readonly spirit: string;
  /** Whether it wears the Verdant coat. */
  readonly verdant: boolean;
  /** Whether pity lifted it to the guaranteed rank. */
  readonly guaranteed: boolean;
  /** Whether it is the banner's featured spirit by the featured share. */
  readonly featured: boolean;
  /** Which copy of the spirit this is for the member: 1 for a new one. */
  readonly copy: number;
  /** Cones opened since the last one of the pity rank or better, before and after this one. */
  readonly pityBefore: number;
  readonly pityAfter: number;
  /** The roll it came from. */
  readonly roll: number;
}

/**
 * Four numbers in [0, 1) from one roll, always in the same order: the rank,
 * the featured share, the spirit within its rank and the Verdant coat. Every
 * cone draws all four, so a stored roll always explains its cone. Mulberry32.
 */
function drawsFrom(roll: number): readonly [number, number, number, number] {
  let state = roll >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
  return [next(), next(), next(), next()];
}

/** The rank a draw in [0, 1) lands on, by the published odds. */
function rankAt(draw: number, rules: GroveRules): RankRule {
  const point = Math.floor(draw * ODDS_SCALE);
  let reached = 0;
  for (const rank of rules.ranks) {
    reached += rank.odds;
    if (point < reached) {
      return rank;
    }
  }
  const last = rules.ranks.at(-1);
  if (last === undefined) {
    throw new Error("The grove rules have no ranks");
  }
  return last;
}

function rankRule(rank: GroveRank, rules: GroveRules): RankRule {
  const found = rules.ranks.find((each) => each.rank === rank);
  if (found === undefined) {
    throw new Error(`The grove rules have no rank ${rank}`);
  }
  return found;
}

/**
 * Opens one cone. `pity` is how many cones the member opened since their last
 * one of the pity rank or better; `copies` is how many of the spirit they have
 * before this one. The cone that would make `pity.cones` without one is lifted
 * to the pity rank. A cone of the featured spirit's rank is the featured
 * spirit `featuredShare` of the time, and one of the rank's others, evenly,
 * the rest.
 */
export function openCone(
  pity: number,
  roll: number,
  copiesOf: (spirit: string) => number,
  banner: Banner,
  rules: GroveRules,
): ConePull {
  const [rankDraw, featuredDraw, spiritDraw, verdantDraw] = drawsFrom(roll);
  const floor = rankIndex(rules.pity.rank);
  const rolled = rankAt(rankDraw, rules);
  const guaranteed = pity + 1 >= rules.pity.cones && rankIndex(rolled.rank) < floor;
  const rank = guaranteed ? rankRule(rules.pity.rank, rules) : rolled;
  const hasFeatured = rank.spirits.includes(banner.featured);
  const featured = hasFeatured && Math.floor(featuredDraw * ODDS_SCALE) < banner.featuredShare;
  const others = hasFeatured ? rank.spirits.filter((spirit) => spirit !== banner.featured) : rank.spirits;
  const pool = featured || others.length === 0 ? [banner.featured] : others;
  const spirit = pool[Math.min(pool.length - 1, Math.floor(spiritDraw * pool.length))];
  if (spirit === undefined) {
    throw new Error(`The grove rank ${rank.rank} has no spirits`);
  }
  const copy = copiesOf(spirit) + 1;
  const verdant = Math.floor(verdantDraw * ODDS_SCALE) < rules.verdant.odds || copy === rules.verdant.copy;
  return {
    rank: rank.rank,
    spirit,
    verdant,
    guaranteed,
    featured,
    copy,
    pityBefore: pity,
    pityAfter: rankIndex(rank.rank) >= floor ? 0 : pity + 1,
    roll,
  };
}

/**
 * Opens cones in a row, one per roll, carrying pity and the copies of each
 * spirit from one to the next. `copies` holds how many of each spirit the
 * member has before the first.
 */
export function openCones(
  pity: number,
  rolls: readonly number[],
  copies: ReadonlyMap<string, number>,
  banner: Banner,
  rules: GroveRules,
): readonly ConePull[] {
  const counts = new Map(copies);
  const pulls: ConePull[] = [];
  let carried = pity;
  for (const roll of rolls) {
    const pull = openCone(carried, roll, (spirit) => counts.get(spirit) ?? 0, banner, rules);
    counts.set(pull.spirit, pull.copy);
    carried = pull.pityAfter;
    pulls.push(pull);
  }
  return pulls;
}

/** Whether the Forest hears of a cone: those of `announceFrom` or better. */
export function announcesCone(rank: GroveRank, rules: GroveRules): boolean {
  return rankIndex(rank) >= rankIndex(rules.announceFrom);
}

export interface RateCard {
  /** The banner on, or undefined when none is: then no cone can be opened. */
  readonly banner: Banner | undefined;
  /** Each rank's chance, and each of its spirits' chance, both as shares of all cones. */
  readonly ranks: readonly {
    readonly rank: GroveRank;
    readonly name: string;
    readonly chance: number;
    readonly spirits: readonly { readonly spirit: string; readonly chance: number }[];
  }[];
  readonly pity: GroveRules["pity"];
  /** The chance of the Verdant coat on any cone, and the copy that always wears it. */
  readonly verdant: { readonly chance: number; readonly copy: number };
}

/** The odds as published, worked out from the same rules a cone is opened with. */
export function rateCard(banner: Banner | undefined, rules: GroveRules): RateCard {
  return {
    banner,
    ranks: rules.ranks.map((rank) => {
      const chance = rank.odds / ODDS_SCALE;
      const featured = banner !== undefined && rank.spirits.includes(banner.featured) ? banner : undefined;
      const others = rank.spirits.filter((spirit) => spirit !== featured?.featured);
      const share = (spirit: string) => {
        if (featured === undefined) {
          return 1 / rank.spirits.length;
        }
        const featuredShare = others.length === 0 ? 1 : featured.featuredShare / ODDS_SCALE;
        return spirit === featured.featured ? featuredShare : (1 - featuredShare) / others.length;
      };
      return {
        rank: rank.rank,
        name: rank.name,
        chance,
        spirits: rank.spirits.map((spirit) => ({ spirit, chance: chance * share(spirit) })),
      };
    }),
    pity: rules.pity,
    verdant: { chance: rules.verdant.odds / ODDS_SCALE, copy: rules.verdant.copy },
  };
}

/** A bond's hearts from how many copies of a spirit a member has: duplicates deepen it, up to `bondMax`. */
export function bondOf(copies: number, rules: GroveRules): number {
  return Math.max(0, Math.min(rules.bondMax, copies));
}

// ---------------------------------------------------------------------------------------------
// Bloom.

/** How full a member's Bloom is, from all the Bloom they ever gained: Bloom never decays. */
export function bloomFrom(gained: number, rules: GroveRules): { readonly bloom: number; readonly cycles: number } {
  const total = Math.max(0, Math.floor(gained));
  return { bloom: total % rules.bloomMax, cycles: Math.floor(total / rules.bloomMax) };
}

/**
 * The Bloom cycles completed between two totals of gained Bloom, numbered from
 * 1. Each completed cycle grants one cone, keyed by its number, so a cycle
 * granted twice is granted once.
 */
export function bloomCyclesBetween(before: number, after: number, rules: GroveRules): readonly number[] {
  const from = bloomFrom(before, rules).cycles;
  const to = bloomFrom(after, rules).cycles;
  return Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index + 1);
}

// ---------------------------------------------------------------------------------------------
// Care.

/**
 * Care charges, worked out from one moment: a member has a charge for every
 * `chargeSeconds` since `anchor`, up to `chargeMax`. A member who never cared
 * has no anchor, and a full bank. Nothing needs writing until a charge is spent.
 */
export function chargesAt(
  anchor: number | null,
  at: number,
  rules: GroveRules,
): { readonly charges: number; readonly nextAt: number | null } {
  const every = rules.chargeSeconds * 1000;
  const from = effectiveAnchor(anchor, at, rules);
  const charges = Math.max(0, Math.min(rules.chargeMax, Math.floor((at - from) / every)));
  return { charges, nextAt: charges >= rules.chargeMax ? null : from + (charges + 1) * every };
}

/** The anchor after spending one charge at `at`, or null when there is none to spend. */
export function spendCharge(anchor: number | null, at: number, rules: GroveRules): number | null {
  if (chargesAt(anchor, at, rules).charges < 1) {
    return null;
  }
  return effectiveAnchor(anchor, at, rules) + rules.chargeSeconds * 1000;
}

/** A full bank stops filling, so time past it is not saved up. */
function effectiveAnchor(anchor: number | null, at: number, rules: GroveRules): number {
  const full = at - rules.chargeMax * rules.chargeSeconds * 1000;
  return anchor === null ? full : Math.max(anchor, full);
}

// ---------------------------------------------------------------------------------------------
// Trees and the Forest.

/** A member's tree: its level is their SEQ level, and its look within the level never changes. */
export function treeOf(
  playerId: PlayerId,
  xp: number,
  levels: LevelRules,
  rules: GroveRules,
): { readonly level: number; readonly variant: number } {
  return { level: levelForXp(xp, levels).level, variant: treeVariant(playerId, rules) };
}

/** Which of the level's looks a member's tree has: a stable hash of their id. */
export function treeVariant(playerId: PlayerId, rules: GroveRules): number {
  return fnv1a(playerId) % Math.max(1, rules.treeVariants);
}

/**
 * Spots in the Forest for members who have none, numbered from 0 nearest the
 * heart. Each newcomer, in the order given (the most senior first), takes the
 * free spot nearest the heart. A spot once given is never moved, so a new
 * member never shifts anyone.
 */
export function assignSpots(taken: Iterable<number>, newcomers: readonly PlayerId[]): ReadonlyMap<PlayerId, number> {
  const used = new Set(taken);
  const spots = new Map<PlayerId, number>();
  let spot = 0;
  for (const playerId of newcomers) {
    if (spots.has(playerId)) {
      continue;
    }
    while (used.has(spot)) {
      spot += 1;
    }
    used.add(spot);
    spots.set(playerId, spot);
  }
  return spots;
}

/** FNV-1a, a small stable string hash; the Grove client hashes a member's seed the same way. */
function fnv1a(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}
