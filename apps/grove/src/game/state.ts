/**
 * The prototype's state: one small typed model, kept in localStorage between visits. In the real
 * game every number here comes from the Leaf service and every spend is a ledger entry; this is a
 * stand-in so the client can be played end to end. `?reset` starts it afresh.
 *
 * The actions are pure functions of the model (they return a new one), so the tests can run them
 * without a browser.
 */

import {
  BLOOM_MAX,
  CATALOGUE,
  CHARGE_MAX,
  CONE_PRICE,
  GREAT_WATER_PRICE,
  openCones,
  type Pull,
  VERDANT_AT,
  VERDANT_CHANCE,
} from "./rules.ts";

export interface Bond {
  /** How many of this spirit you have opened. */
  count: number;
  verdant: boolean;
}

export interface GroveState {
  version: 1;
  leaf: number;
  bloom: number;
  charges: number;
  /** Cones banked from full Blooms, opened free. */
  freeCones: number;
  /** Cones since the last Treant or better; carries over between banners. */
  pity: number;
  spirits: Record<string, Bond>;
  /** The spirit that follows you: by your nametag, at the Campfire, through the forest. */
  companion: string | null;
  owned: string[];
  /** Pruned foliage pads, per tree (`seed:level`). */
  pruned: Record<string, number[]>;
  /** Friends' trees you have watered today, by name. */
  watered: string[];
  /** Leaf you have poured into the Great Sequoia this week. */
  poured: number;
  leafle: { day: string; guesses: string[] };
}

export const STORAGE_KEY = "sequoia-grove:v1";

/** A member a few months in: some spirits found, a little pity built, Leaf to spend. */
export function freshState(): GroveState {
  return {
    version: 1,
    leaf: 12480,
    bloom: 4,
    charges: CHARGE_MAX,
    freeCones: 0,
    pity: 17,
    spirits: {
      glorp: { count: 2, verdant: false },
      glarp: { count: 1, verdant: false },
      glurp: { count: 1, verdant: false },
      mossmote: { count: 1, verdant: false },
      crab: { count: 3, verdant: false },
      chickaree: { count: 1, verdant: false },
      "fog-owl": { count: 1, verdant: false },
    },
    companion: "fog-owl",
    owned: [],
    pruned: {},
    watered: [],
    poured: 0,
    leafle: { day: "", guesses: [] },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

/** Reads a saved model, keeping whatever is valid and filling the rest from a fresh one. */
export function parseState(text: string | null): GroveState {
  const fresh = freshState();
  if (!text) return fresh;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fresh;
  }
  if (!isRecord(raw) || raw["version"] !== 1) return fresh;
  const spirits: Record<string, Bond> = {};
  const savedSpirits = raw["spirits"];
  if (isRecord(savedSpirits))
    for (const [id, b] of Object.entries(savedSpirits))
      if (isRecord(b))
        spirits[id] = { count: Math.max(0, Math.round(num(b["count"], 0))), verdant: b["verdant"] === true };
  const pruned: Record<string, number[]> = {};
  const savedPruned = raw["pruned"];
  if (isRecord(savedPruned))
    for (const [k, v] of Object.entries(savedPruned))
      if (Array.isArray(v)) pruned[k] = v.filter((n): n is number => typeof n === "number");
  const leafle = raw["leafle"];
  const companion = raw["companion"];
  return {
    version: 1,
    leaf: Math.max(0, Math.round(num(raw["leaf"], fresh.leaf))),
    bloom: Math.max(0, Math.min(BLOOM_MAX - 1, Math.round(num(raw["bloom"], fresh.bloom)))),
    charges: Math.max(0, Math.min(CHARGE_MAX, Math.round(num(raw["charges"], fresh.charges)))),
    freeCones: Math.max(0, Math.round(num(raw["freeCones"], 0))),
    pity: Math.max(0, Math.round(num(raw["pity"], fresh.pity))),
    spirits,
    companion: typeof companion === "string" ? companion : null,
    owned: strings(raw["owned"]),
    pruned,
    watered: strings(raw["watered"]),
    poured: Math.max(0, Math.round(num(raw["poured"], 0))),
    leafle: isRecord(leafle)
      ? { day: typeof leafle["day"] === "string" ? leafle["day"] : "", guesses: strings(leafle["guesses"]) }
      : fresh.leafle,
  };
}

// ---------------------------------------------------------------------------------------------
// Actions.

export interface Opened {
  state: GroveState;
  pulls: (Pull & { verdant: boolean; fresh: boolean; count: number })[];
}

/**
 * Opens `n` cones, free ones first, then for Leaf at the cone price. Returns null if there is not
 * enough of either. Each spirit's bond deepens; the fourth copy turns it Verdant.
 */
export function warmCones(s: GroveState, n: number, random: () => number): Opened | null {
  const free = Math.min(s.freeCones, n);
  const cost = (n - free) * CONE_PRICE;
  if (cost > s.leaf) return null;
  const pulls = openCones(n, s.pity, random);
  const spirits = { ...s.spirits };
  const out = pulls.map((p) => {
    const before = spirits[p.spirit] ?? { count: 0, verdant: false };
    const count = before.count + 1;
    const verdant = random() < VERDANT_CHANCE || count === VERDANT_AT;
    spirits[p.spirit] = { count, verdant: before.verdant || verdant };
    return { ...p, verdant, fresh: before.count === 0, count };
  });
  const last = pulls[pulls.length - 1];
  return {
    state: { ...s, leaf: s.leaf - cost, freeCones: s.freeCones - free, pity: last ? last.pity : s.pity, spirits },
    pulls: out,
  };
}

/** One care action (water, prune or mist): spends a charge and fills a segment of Bloom. */
export function care(s: GroveState): { state: GroveState; bloomed: boolean } | null {
  if (s.charges <= 0) return null;
  const bloom = s.bloom + 1;
  const bloomed = bloom >= BLOOM_MAX;
  return {
    state: {
      ...s,
      charges: s.charges - 1,
      bloom: bloomed ? 0 : bloom,
      freeCones: s.freeCones + (bloomed ? 1 : 0),
    },
    bloomed,
  };
}

/** A guild raid finished: it waters your tree and fills a segment of Bloom, as care does, but free. */
export function groot(s: GroveState, raids: number): GroveState {
  const total = s.bloom + raids;
  return { ...s, bloom: total % BLOOM_MAX, freeCones: s.freeCones + Math.floor(total / BLOOM_MAX) };
}

/** Buys a catalogue item, once. Null if it is owned, unknown or too dear. */
export function buy(s: GroveState, id: string): GroveState | null {
  const item = CATALOGUE.find((i) => i.id === id);
  if (!item || s.owned.includes(id) || s.leaf < item.price) return null;
  return { ...s, leaf: s.leaf - item.price, owned: [...s.owned, id] };
}

/** Pours Leaf into the Great Sequoia: one lantern of yours hangs in its branches. */
export function pour(s: GroveState): GroveState | null {
  if (s.leaf < GREAT_WATER_PRICE) return null;
  return { ...s, leaf: s.leaf - GREAT_WATER_PRICE, poured: s.poured + GREAT_WATER_PRICE };
}

/** Waters a friend's tree in the forest with one of your care charges, once a day. */
export function waterFriend(s: GroveState, name: string): GroveState | null {
  if (s.watered.includes(name) || s.charges <= 0) return null;
  return { ...s, charges: s.charges - 1, watered: [...s.watered, name] };
}

/** Spirits found, and how many of the book's. */
export const found = (s: GroveState, ids: readonly string[]): number =>
  ids.filter((id) => (s.spirits[id]?.count ?? 0) > 0).length;
