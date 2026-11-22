/**
 * Pulls as Leaf plays them: each pull draws a prize from a pool at the odds in `RATES`, with counters
 * that make a top-tier prize certain by the 80th pull and a mid-tier one by the 10th. `grove` is
 * always open; a banner is open between its dates, and its top tier holds its headliner. Every pull
 * also gives Seeds, which buy a mid-tier prize the player does not have.
 *
 * Every draw comes from the state's stream, stirred with Leaf's dice (`Ctx.seed`) before a pull, so
 * nothing a player has seen says what comes next. The page is never shown the stream.
 */
import {
  chance,
  type Ctx,
  DAY_MS,
  type Done,
  type Game,
  LOGGED,
  type Logged,
  mix,
  pick,
  type Refused,
  type Stream,
} from "@sequoia-leaf/core";
import type { LookId } from "@sequoia-leaf/raid/content/looks.ts";
import { PRESENTS, STALLS } from "@sequoia-leaf/town/catalogue.ts";

// ---------- what is won ----------

/** The rarities, commonest first, named after the guild's ranks and drawn in their colours, by tier. */
export const RARITIES = {
  Leafkin: { tier: "filler", colour: "#7d6a58" },
  Sapling: { tier: "filler", colour: "#86a85a" },
  Sprite: { tier: "filler", colour: "#5f83a8" },
  Dryad: { tier: "mid", colour: "#9cc6d8" },
  Druid: { tier: "mid", colour: "#a3bc4e" },
  Treant: { tier: "top", colour: "#dd7350" },
  Yggdrasil: { tier: "top", colour: "#e8a33d" },
} as const;
export type Rarity = keyof typeof RARITIES;
export type Tier = (typeof RARITIES)[Rarity]["tier"];

/** Every number of the pulls, as the page shows them. */
export const RATES = {
  /** Leaf a pull costs. */
  leaf: 1000,
  /**
   * A top-tier prize: `chance` up to `rampAfter` pulls since the last one, then more on each pull
   * until it is certain on the `certainAt`th. In a banner, it is the headliner with chance
   * `headliner`, or for certain after a top-tier prize that was not.
   */
  top: { chance: 0.008, rampAfter: 65, certainAt: 80, headliner: 0.5 },
  /** If not top, a mid-tier prize: `chance`, or certain on the `certainAt`th pull since the last mid-tier or better. Dryad and Druid by weight. */
  mid: { chance: 0.06, certainAt: 10, Dryad: 7, Druid: 3 },
  /** Otherwise filler, by weight. */
  filler: { Leafkin: 45, Sapling: 30, Sprite: 18.2 },
  /** Seeds a pull gives, by the tier of its prize. */
  seeds: { filler: 1, mid: 5, top: 20 },
  /** Seeds a mid-tier prize the player does not have costs. */
  exchange: { Dryad: 60, Druid: 150 },
  /** A free pull falls due `every` milliseconds of Leaf's clock, and at most `most` wait. A new player has `first`. */
  free: { every: DAY_MS, most: 7, first: 1 },
} as const;

/** The chance of a top-tier prize on a pull that makes `top` pulls since the last one. */
export function topChance(top: number): number {
  const { chance: base, rampAfter, certainAt } = RATES.top;
  if (top >= certainAt) return 1;
  return top <= rampAfter ? base : base + ((1 - base) * (top - rampAfter)) / (certainAt - rampAfter);
}

/** A banner, open by Leaf's clock from `from` until `until`. */
export interface Banner {
  readonly id: string;
  readonly from: number;
  readonly until: number;
}

export const BANNERS: readonly Banner[] = [
  { id: "banner-1", from: Date.UTC(2026, 10, 24), until: Date.UTC(2026, 11, 8) },
];

/** A banner's headliner, as a prize. */
export const headliner = (banner: string): string => `headliner:${banner}`;

const sold = STALLS.flatMap((stall) => stall.stock);
/** The market's things priced from `least` to `most` Coins. */
const market = (least: number, most: number): string[] =>
  sold.filter(({ price }) => price >= least && price <= most).map(({ thing }) => `thing:${thing}`);
const looks = (...ids: LookId[]): string[] => ids.map((id) => `look:${id}`);

/**
 * Every prize, by rarity. `thing:` is one of the town's things, which the camp is sent once;
 * `look:` one of the raid table's looks, owned there as if bought; and `headliner:` a banner's
 * headliner, whose statue (the town's `statue-<banner>`) the camp is sent.
 */
export const PRIZES: Readonly<Record<Rarity, readonly string[]>> = {
  Leafkin: [...market(0, 60), ...PRESENTS.map((id) => `thing:${id}`)],
  Sapling: market(61, 200),
  Sprite: market(201, Infinity),
  Dryad: [...looks("baize", "gingham", "paper", "moss"), "thing:glass-lantern"],
  Druid: [...looks("plum", "jar", "gilt"), "thing:sun-banner"],
  Treant: ["thing:crab-throne", "thing:fox-statue", "thing:fountain"],
  Yggdrasil: BANNERS.map(({ id }) => headliner(id)),
};

const isRarity = (v: string): v is Rarity => Object.hasOwn(RARITIES, v);
const RARITY_OF = new Map(
  Object.keys(RARITIES)
    .filter(isRarity)
    .flatMap((rarity) => PRIZES[rarity].map((prize): [string, Rarity] => [prize, rarity])),
);
/** A prize's rarity, or undefined for what is not a prize. */
export const rarityOf = (prize: string): Rarity | undefined => RARITY_OF.get(prize);

// ---------- the state ----------

/**
 * A kind of pool's counters: pulls since the last top-tier prize (`top`) and since the last mid-tier
 * or better (`mid`), and whether the next top-tier prize from a banner must be its headliner.
 */
export interface Counters {
  top: number;
  mid: number;
  owed: boolean;
}

/** A pull as the history keeps it: the prize, the pool, Leaf's clock, and what `top` stood at. */
export interface Pulled {
  readonly prize: string;
  readonly pool: string;
  readonly at: number;
  readonly top: number;
}

/** Everything Leaf keeps of one player's pulls. */
export interface Pulls {
  /** Copies of each prize ever won. */
  have: Record<string, number>;
  /** `grove`'s, and one kept for every banner, so they carry from one banner to the next. */
  counters: { grove: Counters; banner: Counters };
  seeds: number;
  /** Free pulls waiting, and Leaf's clock when the next falls due. */
  free: { waiting: number; next: number };
  /** The last `HISTORY` pulls, oldest first. */
  history: Pulled[];
  /** Pulls ever. */
  pulls: number;
  rng: number;
}

/** How many pulls the history keeps. */
export const HISTORY = 200;

/** What the player's page is given: everything but the stream, and the banners open now, until when. */
export type PullsView = Omit<Pulls, "rng"> & { open: { id: string; until: number }[] };

// ---------- commands ----------

export type PullsCommand =
  /** `n` pulls from a pool, paid with Leaf or with free pulls. */
  | { do: "pull"; pool: string; n: 1 | 10; with: "leaf" | "free" }
  /** A mid-tier prize the player does not have, for Seeds. */
  | { do: "exchange"; prize: string };

/** A banner's top-tier prize: the headliner won or lost on the draw, or owed after a loss. */
export type Fifty = "won" | "lost" | "owed";

/** What one pull drew, and what `top` stood at. */
export interface Drawn {
  prize: string;
  rarity: Rarity;
  top: number;
  fifty?: Fifty;
}

/**
 * A prize won by a pull or for Seeds, and how many of it the player has now. For a top-tier prize
 * from a pull, what `top` stood at, and in a banner the 50/50.
 */
export interface PullsNote {
  t: "pull" | "exchange";
  prize: string;
  rarity: Rarity;
  have: number;
  top?: number;
  fifty?: Fifty;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, least: number, most = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= least && v <= most;
const isPool = (v: unknown): v is string => v === "grove" || BANNERS.some(({ id }) => id === v);

/** A command off the wire, or null. Fields it does not use (the command's id) are let be. */
export function readCommand(v: unknown): PullsCommand | null {
  if (!isRecord(v)) return null;
  if (v.do === "pull") {
    return isPool(v.pool) && (v.n === 1 || v.n === 10) && (v.with === "leaf" || v.with === "free")
      ? { do: "pull", pool: v.pool, n: v.n, with: v.with }
      : null;
  }
  if (v.do === "exchange") {
    return typeof v.prize === "string" && v.prize.length <= 64 ? { do: "exchange", prize: v.prize } : null;
  }
  return null;
}

// ---------- doing things ----------

/** Whether a pool is open at a moment of Leaf's clock: `grove` always, a banner between its dates. */
function isOpen(pool: string, now: number): boolean {
  const banner = BANNERS.find(({ id }) => id === pool);
  return pool === "grove" || (banner !== undefined && banner.from <= now && now < banner.until);
}

/**
 * One pull, moving a kind of pool's counters and the stream on: from a banner whose headliner is
 * `headline`, or from `grove` when it is null.
 */
export function draw(c: Counters, headline: string | null, s: Stream): Drawn {
  c.top += 1;
  c.mid += 1;
  const { top } = c;
  if (chance(s) < topChance(top)) {
    c.top = 0;
    c.mid = 0;
    if (headline === null) return { prize: pick(s, PRIZES.Treant), rarity: "Treant", top };
    const fifty: Fifty = c.owed ? "owed" : chance(s) < RATES.top.headliner ? "won" : "lost";
    c.owed = fifty === "lost";
    return fifty === "lost"
      ? { prize: pick(s, PRIZES.Treant), rarity: "Treant", top, fifty }
      : { prize: headline, rarity: "Yggdrasil", top, fifty };
  }
  const { mid, filler } = RATES;
  let rarity: Rarity;
  if (c.mid >= mid.certainAt || chance(s) < mid.chance) {
    c.mid = 0;
    rarity = chance(s) * (mid.Dryad + mid.Druid) < mid.Dryad ? "Dryad" : "Druid";
  } else {
    const roll = chance(s) * (filler.Leafkin + filler.Sapling + filler.Sprite);
    rarity = roll < filler.Leafkin ? "Leafkin" : roll < filler.Leafkin + filler.Sapling ? "Sapling" : "Sprite";
  }
  return { prize: pick(s, PRIZES[rarity]), rarity, top };
}

type Answer = Done<Pulls, PullsNote> | Refused;
const no = (refused: string): Refused => ({ refused });

/** A copy to change, sharing nothing that changes. */
const copy = (s: Pulls): Pulls => ({
  ...s,
  have: { ...s.have },
  counters: { grove: { ...s.counters.grove }, banner: { ...s.counters.banner } },
  free: { ...s.free },
  history: [...s.history],
});

function pull(state: Pulls, c: Extract<PullsCommand, { do: "pull" }>, ctx: Ctx): Answer {
  if (!isOpen(c.pool, ctx.now)) return no("closed");
  if (c.with === "free" && state.free.waiting < c.n) return no("no_free");
  const s = copy(state);
  // Leaf's dice, stirred into the stream before anything is drawn.
  s.rng = mix(s.rng, ctx.seed);
  if (c.with === "free") s.free.waiting -= c.n;
  const grove = c.pool === "grove";
  const counters = grove ? s.counters.grove : s.counters.banner;
  const spend = { amount: c.n * RATES.leaf, reason: `Pulls: ${c.n} in ${c.pool}`, key: `pull:${s.pulls}` };
  const notes: PullsNote[] = [];
  const log: Logged[] = [];
  for (let i = 0; i < c.n; i++) {
    const drawn = draw(counters, grove ? null : headliner(c.pool), s);
    const { prize, rarity, top } = drawn;
    const tier = RARITIES[rarity].tier;
    const have = (s.have[prize] ?? 0) + 1;
    s.have[prize] = have;
    s.seeds += RATES.seeds[tier];
    s.pulls += 1;
    s.history.push({ prize, pool: c.pool, at: ctx.now, top });
    if (tier === "top") {
      notes.push({ t: "pull", ...drawn, have });
      log.push({ kind: LOGGED.pullsTop, data: { prize, pool: c.pool, top } });
    } else {
      notes.push({ t: "pull", prize, rarity, have });
    }
  }
  s.history = s.history.slice(-HISTORY);
  return { state: s, notes, log, leaf: c.with === "leaf" ? [spend] : [] };
}

function exchange(state: Pulls, prize: string): Answer {
  const rarity = RARITY_OF.get(prize);
  if (rarity !== "Dryad" && rarity !== "Druid") return no("not_for_seeds");
  if (state.have[prize] !== undefined) return no("owned");
  const price = RATES.exchange[rarity];
  if (state.seeds < price) return no("not_enough_seeds");
  const s = copy(state);
  s.seeds -= price;
  s.have[prize] = 1;
  return { state: s, notes: [{ t: "exchange", prize, rarity, have: 1 }] };
}

export const applyCommand = (state: Pulls, c: PullsCommand, ctx: Ctx): Answer =>
  ctx.player.guest ? no("members_only") : c.do === "pull" ? pull(state, c, ctx) : exchange(state, c.prize);

/** The free pulls fallen due by Leaf's clock. Nothing else passes with time. */
export function advance(s: Pulls, ctx: Pick<Ctx, "now">): Pulls {
  const { every, most } = RATES.free;
  if (ctx.now < s.free.next) return s;
  const due = Math.floor((ctx.now - s.free.next) / every) + 1;
  return { ...s, free: { waiting: Math.min(most, s.free.waiting + due), next: s.free.next + due * every } };
}

export const pullsView = (s: Pulls, now: number): PullsView => ({
  have: s.have,
  counters: s.counters,
  seeds: s.seeds,
  free: s.free,
  history: s.history,
  pulls: s.pulls,
  open: BANNERS.filter(({ id }) => isOpen(id, now)).map(({ id, until }) => ({ id, until })),
});

// ---------- keeping it ----------

const GAME = "pulls";
export const PULLS_VERSION = 1;

export const encodePulls = (s: Pulls): string => JSON.stringify({ game: GAME, v: PULLS_VERSION, ...s });

function countersOf(v: unknown): Counters | null {
  return isRecord(v) &&
    whole(v.top, 0, RATES.top.certainAt - 1) &&
    whole(v.mid, 0, RATES.mid.certainAt - 1) &&
    typeof v.owed === "boolean"
    ? { top: v.top, mid: v.mid, owed: v.owed }
    : null;
}

function pulledOf(v: unknown): Pulled | null {
  return isRecord(v) &&
    typeof v.prize === "string" &&
    isPool(v.pool) &&
    whole(v.at, 0) &&
    whole(v.top, 1, RATES.top.certainAt)
    ? { prize: v.prize, pool: v.pool, at: v.at, top: v.top }
    : null;
}

/** Prizes that were won once and are no more: the Treasury's wares. A stored state may still name them. */
const RETIRED: ReadonlySet<string> = new Set(["ware:water", "ware:plate", "ware:jar", "ware:crown"]);

/**
 * A player's pulls from the text Leaf stored, or null for anything this version could not have made.
 * What was a prize and no longer is (the Treasury's wares) is let go: the pull paid its Seeds.
 */
export function decodePulls(text: string): Pulls | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.game !== GAME || raw.v !== PULLS_VERSION) return null;
  const { have, counters, seeds, free, history, pulls, rng } = raw;
  if (!isRecord(have) || !isRecord(counters) || !isRecord(free) || !Array.isArray(history)) return null;
  if (!whole(seeds, 0) || !whole(pulls, 0) || !whole(rng, 0, 0xffffffff) || history.length > HISTORY) return null;
  const { waiting, next } = free;
  const grove = countersOf(counters.grove);
  const banner = countersOf(counters.banner);
  if (!whole(waiting, 0, RATES.free.most) || !whole(next, 0) || !grove || !banner || grove.owed) return null;
  const owned: Record<string, number> = {};
  for (const [prize, n] of Object.entries(have)) {
    if (!whole(n, 1)) return null;
    if (RETIRED.has(prize)) continue;
    if (!RARITY_OF.has(prize)) return null;
    owned[prize] = n;
  }
  const kept: Pulled[] = [];
  for (const v of history) {
    const pulled = pulledOf(v);
    if (!pulled) return null;
    if (RETIRED.has(pulled.prize)) continue;
    if (!RARITY_OF.has(pulled.prize)) return null;
    kept.push(pulled);
  }
  return { have: owned, counters: { grove, banner }, seeds, free: { waiting, next }, history: kept, pulls, rng };
}

/** A new player's pulls: nothing won, the counters at 0, and one free pull waiting. */
export const newPulls = (ctx: Pick<Ctx, "seed" | "now">): Pulls => ({
  have: {},
  counters: { grove: { top: 0, mid: 0, owed: false }, banner: { top: 0, mid: 0, owed: false } },
  seeds: 0,
  free: { waiting: RATES.free.first, next: ctx.now + RATES.free.every },
  history: [],
  pulls: 0,
  rng: mix(ctx.seed >>> 0, 0x9a11),
});

/** The pulls, for Leaf's play service. */
export const PULLS: Game<Pulls, PullsCommand, PullsView, PullsNote> = {
  id: "pulls",
  create: newPulls,
  advance,
  apply: applyCommand,
  view: (s, ctx) => pullsView(s, ctx.now),
  decode: decodePulls,
  encode: encodePulls,
  command: readCommand,
  // How many different prizes; pulls ever, and top-tier prizes won counting copies.
  standing: (s) => ({
    score: Object.keys(s.have).length,
    also: {
      pulls: s.pulls,
      top: Object.entries(s.have).reduce((sum, [prize, n]) => {
        const rarity = RARITY_OF.get(prize);
        return rarity !== undefined && RARITIES[rarity].tier === "top" ? sum + n : sum;
      }, 0),
    },
  }),
  // Each prize the player has: the town sends a thing or a statue to the camp, the raid's table owns a look.
  awards: (s) => Object.keys(s.have).map((prize) => `pull:${prize}`),
};
