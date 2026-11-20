/**
 * The grove's own economy: what a player has, how it grows while they are away, and what they can
 * do with it. Pure functions over a small record, so the rules can be tested and later moved to the
 * server unchanged. Chance is handed in as numbers from 0 to 1, never drawn here.
 *
 * Sap is the game's main currency: the tree makes it all the time, online or off, and it buys the
 * tree's growth. Care (watering) fills the tree's Bloom, and a full Bloom drops a cone. A cone opened
 * in the fire holds a spirit, and the spirits living in a grove raise what its tree makes. Leaf,
 * earned by raiding, is not here yet; when it comes it buys speed and variety, never anything Sap
 * cannot reach.
 */
import { HEARTS, type Kind, KINDS, PITY, RANK_BONUS, RATES, TREANT } from "./spirits.ts";

export interface Save {
  readonly v: 2;
  readonly sap: number;
  /** The tree's age, 0 (a seedling) to `MAX_LEVEL` (a giant). */
  readonly level: number;
  /** When the game last counted this grove, in milliseconds. */
  readonly seen: number;
  /** All the Sap this grove has ever made. */
  readonly total: number;
  /** Waterings in hand, up to `WATER_MAX`; they come back with time and never spoil. */
  readonly water: number;
  /** How near the tree is to dropping a cone, 0 to 1. */
  readonly bloom: number;
  /** Cones lying in the grove, unopened. */
  readonly cones: number;
  /** How many of each spirit have come out of cones, by kind. */
  readonly spirits: Readonly<Record<string, number>>;
  /** Cones opened since the last Treant or better, and in all, and cones bought with Sap. */
  readonly pity: number;
  readonly opened: number;
  readonly bought: number;
  /** A stoked fire warms the grove until this time, and the tree makes half as much again. */
  readonly stoked: number;
}

export const MAX_LEVEL = 12;
/** A grove left alone keeps making Sap for this long, then waits: nobody has to log in daily. */
export const AWAY_CAP_MS = 24 * 3600 * 1000;
export const WATER_MAX = 5;
export const WATER_EVERY_MS = 25_000;
/** Waterings to fill the Bloom. */
export const BLOOM_WATERS = 3;
export const STOKE_MS = 20_000;
export const CONES_MAX = 6;

/** A new grove has one cone waiting, so the first thing a player does is open one. */
export const fresh = (now: number): Save => ({
  v: 2,
  sap: 0,
  level: 0,
  seen: now,
  total: 0,
  water: 3,
  bloom: 0,
  cones: 1,
  spirits: {},
  pity: 0,
  opened: 0,
  bought: 0,
  stoked: 0,
});

/** What the grove's spirits add to the tree's making: each kind its rank's share, and a quarter more for each heart. */
export const bonus = (s: Save): number =>
  KINDS.reduce((sum, k) => {
    const n = s.spirits[k.id] ?? 0;
    return n ? sum + RANK_BONUS[k.rank]! * (1 + 0.25 * Math.min(HEARTS, n - 1)) : sum;
  }, 0);
/** Sap a second, the fire not counted. */
export const rate = (s: Save): number => 0.5 * 1.38 ** s.level * (1 + bonus(s));
/** What the next ring of growth costs; `null` once the tree is full grown. */
export const growCost = (s: Save): number | null => (s.level >= MAX_LEVEL ? null : Math.round(25 * 2.6 ** s.level));
/** A cone can be foraged for Sap, dearer each time; `null` when the grove has no room for another. */
export const coneCost = (s: Save): number | null => (s.cones >= CONES_MAX ? null : Math.round(120 * 1.22 ** s.bought));
/** A tap on the tree shakes a few seconds' worth of Sap loose. */
export const tapGain = (s: Save): number => Math.max(1, Math.round(rate(s) * 3));
export const hearts = (s: Save, id: string): number => Math.min(HEARTS, Math.max(0, (s.spirits[id] ?? 0) - 1));

export interface Away {
  readonly save: Save;
  readonly gained: number;
  /** How long the grove was left, and whether it stopped at the cap. */
  readonly awayMs: number;
  readonly capped: boolean;
}
/** Counts what the grove made since it was last seen: Sap, and waterings come back. */
export function advance(s: Save, now: number): Away {
  const awayMs = Math.max(0, now - s.seen);
  const counted = Math.min(awayMs, AWAY_CAP_MS);
  const warm = Math.max(0, Math.min(now, s.stoked) - s.seen);
  const gained = (rate(s) * (counted + 0.5 * Math.min(counted, warm))) / 1000;
  return {
    save: {
      ...s,
      sap: s.sap + gained,
      total: s.total + gained,
      seen: Math.max(s.seen, now),
      water: Math.min(WATER_MAX, s.water + awayMs / WATER_EVERY_MS),
    },
    gained,
    awayMs,
    capped: awayMs > AWAY_CAP_MS,
  };
}

const spend = (s: Save, cost: number | null, change: Partial<Save>): Save | null =>
  cost === null || s.sap < cost ? null : { ...s, sap: s.sap - cost, ...change };
const earn = (s: Save, n: number): Save => ({ ...s, sap: s.sap + n, total: s.total + n });
/** Each returns the grove after the deed, or `null` if it cannot be done. */
export const grow = (s: Save): Save | null => spend(s, growCost(s), { level: s.level + 1 });
export const forage = (s: Save): Save | null => spend(s, coneCost(s), { cones: s.cones + 1, bought: s.bought + 1 });
export const tap = (s: Save): Save => earn(s, tapGain(s));
/** Something small found on the grove's floor: a flower, a mushroom. */
export const findGain = (s: Save): number => Math.max(1, Math.round(rate(s) * 2));
export const find = (s: Save): Save => earn(s, findGain(s));
export const stoke = (s: Save, now: number): Save => ({ ...s, stoked: now + STOKE_MS });
export const waterGain = (s: Save): number => Math.max(2, Math.round(rate(s) * 8));
/** Waters the tree: it drinks, the Bloom fills, and a full Bloom drops a cone if there is room for one. */
export function water(s: Save): { save: Save; cone: boolean } | null {
  if (s.water < 1) return null;
  const bloom = s.bloom + 1 / BLOOM_WATERS;
  const cone = bloom > 0.999 && s.cones < CONES_MAX;
  return {
    save: {
      ...earn(s, waterGain(s)),
      water: s.water - 1,
      bloom: cone ? 0 : Math.min(1, bloom),
      cones: s.cones + (cone ? 1 : 0),
    },
    cone,
  };
}

export interface Opened {
  readonly save: Save;
  readonly kind: Kind;
  /** The first of its kind in this grove; otherwise its bond deepens (or, at full hearts, it leaves Sap). */
  readonly isNew: boolean;
  readonly hearts: number;
  /** Sap left by a spirit whose bond was already full. */
  readonly gift: number;
}
/** The rank a roll gives. With the pity reached, only a Treant or better can come. */
export function rankOf(roll: number, pity: number): number {
  const from = pity >= PITY - 1 ? TREANT : 0;
  const total = RATES.slice(from).reduce((a, b) => a + b, 0);
  let at = Math.min(0.999999, Math.max(0, roll)) * total;
  for (let r = from; r < RATES.length; r++) {
    at -= RATES[r]!;
    if (at < 0) return r;
  }
  return RATES.length - 1;
}
/** Opens a cone. `roll` chooses the rank and `pick` the spirit of that rank, each from 0 to 1. */
export function open(s: Save, roll: number, pick: number): Opened | null {
  if (s.cones < 1) return null;
  const rank = rankOf(roll, s.pity);
  const of = KINDS.filter((k) => k.rank === rank);
  const kind = of[Math.min(of.length - 1, Math.floor(Math.max(0, pick) * of.length))]!;
  const had = s.spirits[kind.id] ?? 0;
  const full = had > HEARTS;
  const gift = full ? Math.round(rate(s) * 60 * (1 + rank)) : 0;
  const save: Save = {
    ...earn(s, gift),
    cones: s.cones - 1,
    opened: s.opened + 1,
    pity: rank >= TREANT ? 0 : s.pity + 1,
    spirits: full ? s.spirits : { ...s.spirits, [kind.id]: had + 1 },
  };
  return { save, kind, isNew: had === 0, hearts: hearts(save, kind.id), gift };
}

const KEY = "grove.save.v2";
const OLD = "grove.save.v1";
type Store = Pick<Storage, "getItem" | "setItem">;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
/** Reads a saved grove; anything missing or malformed gives a fresh one. A grove from the first version keeps its Sap and its tree. */
export function load(store: Store, now: number): Save {
  try {
    const raw: unknown = JSON.parse(store.getItem(KEY) ?? "null");
    if (typeof raw === "object" && raw !== null) {
      const r = raw as Record<string, unknown>;
      const spirits: Record<string, number> = {};
      if (typeof r.spirits === "object" && r.spirits !== null)
        for (const k of KINDS) {
          const n = (r.spirits as Record<string, unknown>)[k.id];
          if (num(n) && n >= 1) spirits[k.id] = Math.floor(n);
        }
      const all = [r.sap, r.level, r.seen, r.total, r.water, r.bloom, r.cones, r.pity, r.opened, r.bought, r.stoked];
      if (r.v === 2 && all.every(num)) {
        const [sap, level, seen, total, wat, bloom, cones, pity, opened, bought, stoked] = all as number[];
        return {
          v: 2,
          sap: sap!,
          level: Math.min(MAX_LEVEL, Math.floor(level!)),
          seen: Math.min(seen!, now),
          total: total!,
          water: Math.min(WATER_MAX, wat!),
          bloom: Math.min(1, bloom!),
          cones: Math.min(CONES_MAX, Math.floor(cones!)),
          spirits,
          pity: Math.floor(pity!),
          opened: Math.floor(opened!),
          bought: Math.floor(bought!),
          stoked: Math.min(stoked!, now + STOKE_MS),
        };
      }
    }
    const old: unknown = JSON.parse(store.getItem(OLD) ?? "null");
    if (typeof old === "object" && old !== null) {
      const o = old as Record<string, unknown>;
      if (num(o.sap) && num(o.level) && num(o.total))
        return { ...fresh(now), sap: o.sap, level: Math.min(MAX_LEVEL, Math.floor(o.level)), total: o.total };
    }
  } catch {
    // Not a grove this game wrote.
  }
  return fresh(now);
}
export function store(to: Store, s: Save): void {
  try {
    to.setItem(KEY, JSON.stringify(s));
  } catch {
    // A browser that will not keep it (private window, full disk) still lets the grove be played.
  }
}

const STAGES = [
  "Seedling",
  "Sprout",
  "Sapling",
  "Young tree",
  "Pole",
  "Tall tree",
  "Old growth",
  "Elder",
  "Monarch",
  "Giant",
  "Titan",
  "Ancient",
  "Great Sequoia",
];
/** What a tree of this level is called. */
export const stage = (level: number): string => STAGES[Math.min(level, STAGES.length - 1)]!;

/** 1234 as "1,234", 12345 as "12.3k", and so on up. */
export function short(n: number): string {
  if (n < 10000) return Math.floor(n).toLocaleString("en-US");
  const units = ["k", "M", "B", "T"];
  let u = -1;
  let v = n;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return `${v < 100 ? v.toFixed(1) : Math.floor(v)}${units[u]}`;
}
