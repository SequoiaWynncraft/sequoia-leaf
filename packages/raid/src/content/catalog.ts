/**
 * What exists, when. A catalogue is the raid's figures as they stand at an era (how many releases
 * are open, `releases.ts`): each with the release it came with, who may have it, and what the pulls
 * give it as. `available` is the one door to them: what a stall, a starter pick, a regular, a
 * carousel, a pull, the exchange or the almanac may draw from. There is no list of figures to read
 * but its answers, so what exists cannot be asked without when.
 *
 * A run, a table, a sitting, a fight's setup and the views Leaf sends each carry their era, and
 * `catalogOf` reads the catalogue from it: never from a clock.
 */
import { type Banner, BANNERS, GROVE, type Look } from "./banners.ts";
import { type FigureId, FIGURES, type FigureSpec, type Tier } from "./figures.ts";
import { type Era, eraOf, LAST_ERA, pullsEra, type ReleaseId, RELEASES } from "./releases.ts";

export type { FigureId } from "./figures.ts";

/** What a pull gives a prize as, commonest first, named after the guild's ranks. */
export const RARITY_IDS = ["Leafkin", "Sapling", "Sprite", "Dryad", "Druid", "Treant", "Yggdrasil"] as const;
export type Rarity = (typeof RARITY_IDS)[number];

/** Who may have a figure: everyone, or, for a banner's headliner, whoever pulled it. */
export type Access = "shared" | { readonly headliner: Banner["id"] };

/**
 * A figure as a catalogue has it: its words and numbers, the release it came with, who may have it,
 * its rarity as a prize, and how it is drawn (everyone's by the set; a headliner as its banner says).
 */
export interface Figure extends FigureSpec {
  readonly since: ReleaseId;
  readonly access: Access;
  readonly prize: Rarity;
  readonly look: Look;
}

/**
 * The figures each release brings to everyone, by their rarity as prizes. A release's banners'
 * headliners come with it (`BANNERS`).
 */
const SHARED: { readonly [R in ReleaseId]: readonly (readonly [Rarity, readonly FigureId[]])[] } = {
  base: [
    ["Leafkin", ["emberkit", "mossmote", "moth", "worm", "finch", "crab7", "barrowgnome"]],
    ["Sapling", ["kettle", "slug", "glorp", "chickaree", "jay", "crab12", "lanterngnome"]],
    ["Sprite", ["leafling", "cindernewt", "drizzlefrog", "rock", "bushgnome", "crab23"]],
    ["Dryad", ["badger", "fogowl", "heron"]],
    ["Druid", ["crab40", "apothecary"]],
    ["Treant", ["greg", "whitefox", "hearthcat"]],
  ],
  // The expansion's first: Seqwawa (`seqwawa.ts`), on everyone's stall at once, and in the pulls with the next release.
  groot: [["Treant", ["seqwawa"]]],
  "groot-night": [],
  "penguin-month": [],
  "up-the-tree": [],
};

/**
 * The order draws were made in when eras came in. Every figure after these comes in the order its
 * release brings it, after all of them, so the order only grows at its end and a draw never
 * changes because a list was reordered.
 */
const DRAWN: readonly FigureId[] = [...SHARED.base.flatMap(([, ids]) => ids), "seqwawa", "banner-1"];

export interface Catalog {
  readonly era: Era;
  /** Every figure open at this era. */
  readonly figures: Readonly<Partial<Record<FigureId, Figure>>>;
  /** The order draws are made in: only ever added to at its end (`DRAWN`). */
  readonly order: readonly FigureId[];
  /** The banners whose release is open. */
  readonly banners: readonly Banner[];
}

function build(era: Era): Catalog {
  const figures: Partial<Record<FigureId, Figure>> = {};
  const came: FigureId[] = [];
  const banners: Banner[] = [];
  for (const { id: since } of RELEASES.slice(0, era)) {
    const arrive = (id: FigureId, access: Access, prize: Rarity, look: Look): void => {
      figures[id] = { ...FIGURES[id], since, access, prize, look };
      came.push(id);
    };
    for (const [prize, ids] of SHARED[since]) for (const id of ids) arrive(id, "shared", prize, "set");
    for (const banner of BANNERS.filter((b) => b.opens === since)) {
      banners.push(banner);
      arrive(banner.headliner, { headliner: banner.id }, "Yggdrasil", banner.look);
    }
  }
  const order = [...DRAWN.filter((id) => figures[id]), ...came.filter((id) => !DRAWN.includes(id))];
  return { era, figures, order, banners };
}
/** One catalogue an era, made once. */
const CATALOGS: readonly Catalog[] = RELEASES.map(({ id }) => build(eraOf(id)));

/** The catalogue of an era. */
export function catalogAt(era: Era): Catalog {
  const cat = CATALOGS[era - 1];
  if (!cat) throw new RangeError(`There is no era ${era}`);
  return cat;
}
/** The catalogue of whatever carries an era: a run, a table, a sitting, a fight's setup, a view. */
export const catalogOf = (held: { readonly era: Era }): Catalog => catalogAt(held.era);

/** Every figure any release has: what stored data may name, never what anything offers. */
export const everyFigure = (): readonly FigureId[] => catalogAt(LAST_ERA).order;
/** Every figure any release brings everyone, no headliner: what the camp can hold a carving of. */
/** Every figure any release has that the set draws: everyone's, and each headliner of the set's own. */
export const everySetDrawn = (): readonly FigureId[] =>
  catalogAt(LAST_ERA).order.filter((id) => catalogAt(LAST_ERA).figures[id]?.look === "set");
export const everyShared = (): readonly FigureId[] =>
  catalogAt(LAST_ERA).order.filter((id) => catalogAt(LAST_ERA).figures[id]?.access === "shared");

/** The figures a member has pulled, each with its level. */
export type Roster = Readonly<Partial<Record<FigureId, number>>>;
/** Who a run's stall sells: everyone's figures, or (`own`) those the member had pulled when it started. */
export type Figures = { readonly pool: "fair" } | { readonly pool: "own"; readonly roster: Roster };

/** What a draw is for, and what decides what it may draw. */
export type Purpose =
  | { readonly for: "stall"; readonly figures: Figures; readonly tier: Tier }
  /** A run's first pick, of whom to set out with. */
  | { readonly for: "starter" }
  /** Who sits as a regular: their parties, the bot's, a live table's empty seats. */
  | { readonly for: "regular" }
  | { readonly for: "carousel"; readonly tier: Tier }
  /** A pool's prizes of a rarity: the grove, or a banner whose release is open. */
  | { readonly for: "pull"; readonly pool: string; readonly rarity: Rarity }
  /** What Seeds buy, had or not. */
  | { readonly for: "exchange" }
  /** The almanac's figures: everyone's, and each headliner of the roster. */
  | { readonly for: "almanac"; readonly roster: Roster };

/** Who a stall sells at a cost: everyone's; with the member's own, every one-acorn figure, and above that only the roster's. */
function stall(cat: Catalog, figures: Figures, tier: Tier): FigureId[] {
  return cat.order.filter((id) => {
    const f = cat.figures[id];
    if (f?.tier !== tier) return false;
    if (figures.pool === "fair") return f.access === "shared";
    const owned = figures.roster[id] !== undefined;
    return owned || (tier === 1 && f.access === "shared");
  });
}

/**
 * A pool's prizes of a rarity: a banner's headliner, or everyone's figures of that rarity that came
 * by the pool's era. A banner's era is its release's; the grove's is the catalogue's. Either way a
 * release whose figures join with the next is left out until it does (`pullsEra`).
 */
function prizes(cat: Catalog, pool: string, rarity: Rarity): FigureId[] {
  const banner = cat.banners.find((b) => b.id === pool);
  if (!banner && pool !== GROVE) return [];
  if (rarity === "Yggdrasil") return banner ? [banner.headliner] : [];
  const by = pullsEra(banner ? eraOf(banner.opens) : cat.era);
  return cat.order.filter((id) => {
    const f = cat.figures[id];
    return f?.access === "shared" && f.prize === rarity && eraOf(f.since) <= by;
  });
}

/** The figures open at a catalogue's era that a draw may draw from, in the catalogue's order. */
export function available(cat: Catalog, p: Purpose): readonly FigureId[] {
  const shared = (id: FigureId): boolean => cat.figures[id]?.access === "shared";
  const costs = (tier: Tier) => (id: FigureId) => shared(id) && cat.figures[id]?.tier === tier;
  switch (p.for) {
    case "stall":
      return stall(cat, p.figures, p.tier);
    case "starter":
      return cat.order.filter(costs(1));
    case "regular":
      return cat.order.filter(shared);
    case "carousel":
      return cat.order.filter(costs(p.tier));
    case "pull":
      return prizes(cat, p.pool, p.rarity);
    case "exchange":
      return [...prizes(cat, GROVE, "Dryad"), ...prizes(cat, GROVE, "Druid")];
    case "almanac":
      return cat.order.filter((id) => shared(id) || p.roster[id] !== undefined);
  }
}

// ---------- figures as prizes ----------

const EVER = catalogAt(LAST_ERA);
/** A figure as a prize: `figure:<id>` for everyone's, `headliner:<banner>` for a banner's headliner. */
export function prizeOf(id: FigureId): string {
  const access = EVER.figures[id]?.access ?? "shared";
  return access === "shared" ? `figure:${id}` : `headliner:${access.headliner}`;
}
/** The figure a prize is, of any release; null for a prize that is no figure. */
export function figureOf(prize: string): FigureId | null {
  return EVER.order.find((id) => prizeOf(id) === prize) ?? null;
}
/** Every figure that is or was a prize, with its rarity. */
export const prizeRarities = (): readonly (readonly [string, Rarity])[] =>
  EVER.order.flatMap((id) => {
    const f = EVER.figures[id];
    return f ? [[prizeOf(id), f.prize] as const] : [];
  });
