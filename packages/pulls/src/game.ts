/**
 * Pulls as Leaf plays them: each pull draws a prize from a pool at the odds in `RATES`, with counters
 * that make a top-tier prize certain by the 80th pull and a mid-tier one by the 10th. A prize is one
 * of The Little Raid's figures, or a banner's headliner, as the raid's catalogue gives them at the
 * era Leaf's clock is in (`available`): this game has no list of its own, of prizes or of banners.
 * `grove` is always open; a banner is open between its dates, and its top tier holds its headliner.
 * Every pull also gives Seeds, which buy a mid-tier prize the player does not have.
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
  type LeafFor,
  LOGGED,
  type Logged,
  mix,
  pick,
  type Refused,
  type Stream,
} from "@sequoia-leaf/core";
import { BANNERS, GROVE } from "@sequoia-leaf/raid/content/banners.ts";
import {
  available,
  type Catalog,
  catalogAt,
  prizeOf,
  prizeRarities,
  type Rarity,
  rarityIn,
} from "@sequoia-leaf/raid/content/catalog.ts";
import { type Era, eraAt, isEra, LAST_ERA } from "@sequoia-leaf/raid/content/releases.ts";

export { type Banner, BANNERS } from "@sequoia-leaf/raid/content/banners.ts";
export type { Rarity } from "@sequoia-leaf/raid/content/catalog.ts";

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
} as const satisfies Readonly<Record<Rarity, { readonly tier: string; readonly colour: string }>>;
export type Tier = (typeof RARITIES)[Rarity]["tier"];

/** Every number of the pulls, as the page shows them. */
export const RATES = {
  /** Leaf a pull costs. */
  leaf: 1000,
  /** Who may pull for Leaf. */
  for: "everyone" satisfies LeafFor,
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

/** A banner's headliner, as a prize. */
export const headliner = (banner: string): string => `headliner:${banner}`;

/**
 * What a pool gives, by rarity, at a catalogue's era: `figure:` is one of the raid's figures, and
 * `headliner:` a banner's headliner (`prizeOf`). The camp is sent a figure once, as the town's
 * `figure-<id>`, and for a headliner the member themself (`member-<banner>`).
 */
export type Prizes = Readonly<Record<Rarity, readonly string[]>>;
export function prizesOf(cat: Catalog, pool: string): Prizes {
  const of = (rarity: Rarity): string[] => available(cat, { for: "pull", pool, rarity }).map(prizeOf);
  return {
    Leafkin: of("Leafkin"),
    Sapling: of("Sapling"),
    Sprite: of("Sprite"),
    Dryad: of("Dryad"),
    Druid: of("Druid"),
    Treant: of("Treant"),
    Yggdrasil: of("Yggdrasil"),
  };
}
/** What Seeds buy at a catalogue's era, had or not: every mid-tier prize of the grove. */
export const forSeeds = (cat: Catalog): readonly string[] => available(cat, { for: "exchange" }).map(prizeOf);

const once = (kind: "thing" | "look", ids: string): string[] => ids.split(" ").map((id) => `${kind}:${id}`);
/**
 * What was a prize before the pools gave figures, with the rarity it had: `thing:` one of the
 * town's things, `look:` one of the raid table's looks. None is in a pool or to be had for Seeds.
 * What a player won of them is still theirs: it is held, named in their history and awarded as before.
 */
export const EARLIER: Readonly<Partial<Record<Rarity, readonly string[]>>> = {
  Leafkin: once("thing", "rock stepping-stones plank-path log-fence picket pinecone painted-pebble acorn-jar"),
  Sapling: once("thing", "candle-stump stump rug-moss flower-pot potted-fern pumpkin sunflower stone-wall woodpile"),
  Sprite: once(
    "thing",
    "lantern-post paper-lantern firefly-lamp glowcap moth-lantern brazier fairy-lights barrel gnome gnome-fishing gnome-napping crab-statue wind-chime birdhouse bird-bath cook-pot music-box telescope well my-stall cushion log-seat bench rocker picnic hammock rug-woven pennant windsock bunting weathervane guild-banner toadstool berry-bush worm-pot flower-bed sapling fairy-ring doormat arch",
  ),
  Dryad: [...once("look", "baize gingham paper moss"), "thing:glass-lantern"],
  Druid: [...once("look", "plum jar gilt"), "thing:sun-banner"],
  Treant: once("thing", "crab-throne fox-statue fountain"),
};

const isRarity = (v: string): v is Rarity => Object.hasOwn(RARITIES, v);
/**
 * Every figure of any release as a prize, and what was a prize earlier, with its rarity: for reading
 * what was kept (a note, the history, what is had), never for a price, which is the era's (`rarityIn`).
 */
const RARITY_OF = new Map<string, Rarity>([
  ...prizeRarities(catalogAt(LAST_ERA)),
  ...Object.keys(RARITIES)
    .filter(isRarity)
    .flatMap((rarity) => (EARLIER[rarity] ?? []).map((prize): [string, Rarity] => [prize, rarity])),
]);
/**
 * The rarity of a prize, or of what was one earlier: a headliner's, of any banner (one since retired
 * is still Yggdrasil); undefined for anything else.
 */
export const rarityOf = (prize: string): Rarity | undefined =>
  RARITY_OF.get(prize) ?? (prize.startsWith(headliner("")) ? "Yggdrasil" : undefined);

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

/** The most copies of a prize that are each told as an award. */
export const COPIES_TOLD = 7;

/** What holding `n` copies of a prize awards: the prize, and each further copy told. */
const awardsOf = (prize: string, n: number): string[] =>
  [`pull:${prize}`].concat(Array.from({ length: Math.min(n, COPIES_TOLD) - 1 }, (_, i) => `copies:${prize}:${i + 2}`));

/** How many pulls the history keeps. */
export const HISTORY = 200;

/**
 * What the player's page is given: everything but the stream, the banners open now and until when,
 * and the era Leaf's clock is in, which the page reads what each pool gives by (`prizesOf`).
 */
export type PullsView = Omit<Pulls, "rng"> & { open: { id: string; until: number }[]; era: Era };

// ---------- commands ----------

export type PullsCommand =
  /** `n` pulls from a pool, paid with Leaf or with free pulls, from the prizes it was shown with in an era (`era`). */
  | { do: "pull"; pool: string; n: 1 | 10; with: "leaf" | "free"; era: Era }
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
/** A prize's or a pool's name: what is won and where is the rules' to say, not the reader's. */
const isName = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

/**
 * A command off the wire, or null. Fields it does not use (the command's id) are let be. A pool
 * these rules do not know is a pool that is closed (`isOpen`), as a banner retired is.
 */
export function readCommand(v: unknown): PullsCommand | null {
  if (!isRecord(v)) return null;
  if (v.do === "pull") {
    return isName(v.pool) && (v.n === 1 || v.n === 10) && (v.with === "leaf" || v.with === "free") && isEra(v.era)
      ? { do: "pull", pool: v.pool, n: v.n, with: v.with, era: v.era }
      : null;
  }
  if (v.do === "exchange") {
    return typeof v.prize === "string" && v.prize.length <= 64 ? { do: "exchange", prize: v.prize } : null;
  }
  return null;
}

// ---------- doing things ----------

/** Whether a pool is open at a moment of Leaf's clock: `grove` always, a banner between its dates. */
export function isOpen(pool: string, now: number): boolean {
  const banner = BANNERS.find(({ id }) => id === pool);
  return pool === GROVE || (banner !== undefined && banner.from <= now && now < banner.until);
}

/**
 * One pull from a pool's prizes (`prizesOf`), moving a kind of pool's counters and the stream on:
 * from a banner, whose top tier holds its headliner, or from `grove`, whose holds none.
 */
export function draw(c: Counters, prizes: Prizes, s: Stream): Drawn {
  c.top += 1;
  c.mid += 1;
  const { top } = c;
  if (chance(s) < topChance(top)) {
    c.top = 0;
    c.mid = 0;
    const headline = prizes.Yggdrasil[0];
    if (headline === undefined) return { prize: pick(s, prizes.Treant), rarity: "Treant", top };
    const fifty: Fifty = c.owed ? "owed" : chance(s) < RATES.top.headliner ? "won" : "lost";
    c.owed = fifty === "lost";
    return fifty === "lost"
      ? { prize: pick(s, prizes.Treant), rarity: "Treant", top, fifty }
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
  return { prize: pick(s, prizes[rarity]), rarity, top };
}

type Answer = Done<Pulls, PullsNote> | Refused;
const no = (refused: string): Refused => ({ refused });

/** How many of each prize the player has, left for Leaf to keep by a command that changes it. */
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
  // What the pool gives in the era Leaf's clock is in; a pull shown other prizes is not done, and nothing is paid.
  const prizes = prizesOf(catalogAt(eraAt(ctx.now)), c.pool);
  if (JSON.stringify(prizesOf(catalogAt(c.era), c.pool)) !== JSON.stringify(prizes)) return no("prizes_changed");
  if (c.with === "free" && state.free.waiting < c.n) return no("no_free");
  const s = copy(state);
  // Leaf's dice, stirred into the stream before anything is drawn.
  s.rng = mix(s.rng, ctx.seed);
  if (c.with === "free") s.free.waiting -= c.n;
  const grove = c.pool === GROVE;
  const counters = grove ? s.counters.grove : s.counters.banner;
  const spend = {
    amount: c.n * RATES.leaf,
    reason: `Pulls: ${c.n} in ${c.pool}`,
    key: `pull:${s.pulls}`,
    for: RATES.for,
  };
  const notes: PullsNote[] = [];
  const log: Logged[] = [];
  for (let i = 0; i < c.n; i++) {
    const drawn = draw(counters, prizes, s);
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

function exchange(state: Pulls, prize: string, now: number): Answer {
  // What it costs is its rarity in the era Leaf's clock is in: a release not open yet changes nothing.
  const cat = catalogAt(eraAt(now));
  const rarity = rarityIn(cat, prize);
  const offered = forSeeds(cat).includes(prize);
  if ((rarity !== "Dryad" && rarity !== "Druid") || !offered) return no("not_for_seeds");
  if (state.have[prize] !== undefined) return no("owned");
  const price = RATES.exchange[rarity];
  if (state.seeds < price) return no("not_enough_seeds");
  const s = copy(state);
  s.seeds -= price;
  s.have[prize] = 1;
  return { state: s, notes: [{ t: "exchange", prize, rarity, have: 1 }] };
}

export const applyCommand = (state: Pulls, c: PullsCommand, ctx: Ctx): Answer =>
  c.do === "pull" ? pull(state, c, ctx) : exchange(state, c.prize, ctx.now);

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
  era: eraAt(now),
});

// ---------- keeping it ----------

const GAME = "pulls";
export const PULLS_VERSION = 1;

export const encodePulls = (s: Pulls): string => JSON.stringify({ game: GAME, v: PULLS_VERSION, ...s });

/*
 * Reading what Leaf stored is done in two layers. `shapeOf` takes the shape every state of this
 * version has, and refuses anything else; it names no number of `RATES`, no banner and no prize.
 * `settle` brings a state of that shape under today's content and numbers, and refuses nothing.
 */

function countersOf(v: unknown): Counters | null {
  return isRecord(v) && whole(v.top, 0) && whole(v.mid, 0) && typeof v.owed === "boolean"
    ? { top: v.top, mid: v.mid, owed: v.owed }
    : null;
}

function pulledOf(v: unknown): Pulled | null {
  return isRecord(v) && isName(v.prize) && isName(v.pool) && whole(v.at, 0) && whole(v.top, 0)
    ? { prize: v.prize, pool: v.pool, at: v.at, top: v.top }
    : null;
}

/** A player's pulls in the shape this version keeps them, or null for anything else. */
function shapeOf(text: string): Pulls | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.game !== GAME || raw.v !== PULLS_VERSION) return null;
  const { have, counters, seeds, free, history, pulls, rng } = raw;
  if (!isRecord(have) || !isRecord(counters) || !isRecord(free) || !Array.isArray(history)) return null;
  if (!whole(seeds, 0) || !whole(pulls, 0) || !whole(rng, 0, 0xffffffff)) return null;
  const { waiting, next } = free;
  const grove = countersOf(counters.grove);
  const banner = countersOf(counters.banner);
  if (!whole(waiting, 0) || !whole(next, 0) || !grove || !banner) return null;
  const owned: Record<string, number> = {};
  for (const [prize, n] of Object.entries(have)) {
    if (!isName(prize) || !whole(n, 1)) return null;
    owned[prize] = n;
  }
  const kept: Pulled[] = [];
  for (const v of history) {
    const pulled = pulledOf(v);
    if (!pulled) return null;
    kept.push(pulled);
  }
  return { have: owned, counters: { grove, banner }, seeds, free: { waiting, next }, history: kept, pulls, rng };
}

/** Prizes that were won once and are let go: the Treasury's wares. A stored state may still name them. */
const RETIRED: ReadonlySet<string> = new Set(["ware:water", "ware:plate", "ware:jar", "ware:crown"]);

/**
 * Pulls as today's content and numbers have them. A counter past where a prize is certain now is
 * certain on the next pull; free pulls past the most wait as the most; a longer history keeps its
 * last pulls; the grove owes nothing. A prize or a pool these rules do not know (a banner retired,
 * its headliner, a figure gone from the raid) is kept as it was won. Only the Treasury's wares are
 * let go: the pull paid its Seeds.
 */
function settle(s: Pulls): Pulls {
  const certain = (c: Counters, owed: boolean): Counters => ({
    top: Math.min(c.top, RATES.top.certainAt - 1),
    mid: Math.min(c.mid, RATES.mid.certainAt - 1),
    owed,
  });
  return {
    ...s,
    have: Object.fromEntries(Object.entries(s.have).filter(([prize]) => !RETIRED.has(prize))),
    counters: { grove: certain(s.counters.grove, false), banner: certain(s.counters.banner, s.counters.banner.owed) },
    free: { waiting: Math.min(s.free.waiting, RATES.free.most), next: s.free.next },
    history: s.history.filter(({ prize }) => !RETIRED.has(prize)).slice(-HISTORY),
  };
}

/** A player's pulls from the text Leaf stored, under today's content and numbers; null for anything not of this version's shape. */
export function decodePulls(text: string): Pulls | null {
  const shaped = shapeOf(text);
  return shaped && settle(shaped);
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
        const rarity = rarityOf(prize);
        return rarity !== undefined && RARITIES[rarity].tier === "top" ? sum + n : sum;
      }, 0),
    },
  }),
  // Each prize the player has: the town sends a figure, a banner's member or an earlier thing to the camp, the raid's table owns an earlier look.
  // And each further copy of it up to the seventh (`copies:<prize>:<n>`), which the raid reads a figure's level from.
  awards: (s) => Object.entries(s.have).flatMap(([prize, n]) => awardsOf(prize, n)),
};
