/**
 * The grove's own economy: what a player has, how it grows while they are away, and what they can
 * do with it. Pure functions over a small record, so the rules can be tested and later moved to the
 * server unchanged.
 *
 * Sap is the game's main currency: the tree makes it all the time, online or off, and it buys the
 * tree's growth and the leaflings that tend it. Leaf, earned by raiding, is not here yet; when it
 * comes it buys speed and variety, never anything Sap cannot reach.
 */
export interface Save {
  readonly v: 1;
  readonly sap: number;
  /** The tree's age, 0 (a seedling) to `MAX_LEVEL` (a giant). */
  readonly level: number;
  readonly leaflings: number;
  /** When the game last counted this grove's Sap, in milliseconds. */
  readonly seen: number;
  /** All the Sap this grove has ever made. */
  readonly total: number;
}

export const MAX_LEVEL = 12;
/** A grove left alone keeps making Sap for this long, then waits: nobody has to log in daily. */
export const AWAY_CAP_MS = 24 * 3600 * 1000;

export const fresh = (now: number): Save => ({ v: 1, sap: 0, level: 0, leaflings: 0, seen: now, total: 0 });

/** Sap a second: the tree's own, and half as much again for every leafling tending it. */
export const rate = (s: Save): number => 0.5 * 1.38 ** s.level * (1 + 0.5 * s.leaflings);
/** What the next ring of growth costs; `null` once the tree is full grown. */
export const growCost = (s: Save): number | null => (s.level >= MAX_LEVEL ? null : Math.round(25 * 2.6 ** s.level));
/** A grove has room for two leaflings, and one more for every two levels of its tree. */
export const leaflingRoom = (s: Save): number => 2 + Math.floor(s.level / 2);
export const leaflingCost = (s: Save): number | null =>
  s.leaflings >= leaflingRoom(s) ? null : Math.round(40 * 2.4 ** s.leaflings);
/** A tap on the tree shakes a few seconds' worth of Sap loose. */
export const tapGain = (s: Save): number => Math.max(1, Math.round(rate(s) * 3));

export interface Away {
  readonly save: Save;
  readonly gained: number;
  /** How long the grove was left, and whether it stopped at the cap. */
  readonly awayMs: number;
  readonly capped: boolean;
}
/** Counts the Sap made since the grove was last seen. */
export function advance(s: Save, now: number): Away {
  const awayMs = Math.max(0, now - s.seen);
  const counted = Math.min(awayMs, AWAY_CAP_MS);
  const gained = (rate(s) * counted) / 1000;
  return {
    save: { ...s, sap: s.sap + gained, total: s.total + gained, seen: now },
    gained,
    awayMs,
    capped: awayMs > AWAY_CAP_MS,
  };
}

const spend = (s: Save, cost: number | null, change: Partial<Save>): Save | null =>
  cost === null || s.sap < cost ? null : { ...s, sap: s.sap - cost, ...change };
/** Each returns the grove after the deed, or `null` if it cannot be done. */
export const grow = (s: Save): Save | null => spend(s, growCost(s), { level: s.level + 1 });
export const welcome = (s: Save): Save | null => spend(s, leaflingCost(s), { leaflings: s.leaflings + 1 });
export const tap = (s: Save): Save => ({ ...s, sap: s.sap + tapGain(s), total: s.total + tapGain(s) });

const KEY = "grove.save.v1";
type Store = Pick<Storage, "getItem" | "setItem">;
const whole = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
/** Reads a saved grove; anything missing or malformed gives a fresh one. */
export function load(store: Store, now: number): Save {
  try {
    const raw: unknown = JSON.parse(store.getItem(KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return fresh(now);
    const { v, sap, level, leaflings, seen, total } = raw as Record<string, unknown>;
    if (v !== 1 || !whole(sap) || !whole(level) || !whole(leaflings) || !whole(seen) || !whole(total))
      return fresh(now);
    return {
      v: 1,
      sap,
      level: Math.min(MAX_LEVEL, Math.floor(level)),
      leaflings: Math.floor(leaflings),
      seen: Math.min(seen, now),
      total,
    };
  } catch {
    return fresh(now);
  }
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
