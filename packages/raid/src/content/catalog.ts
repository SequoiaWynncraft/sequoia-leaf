/**
 * What exists, when. A catalogue is the raid's figures, traits, items and boons as they stand at an
 * era (how many releases are open, `releases.ts`): the base and every release's patch open by then,
 * folded in order (`patch.ts`, `releases/`). Each figure carries the release it came with, who may
 * have it, and what the pulls give it as. There is no table of them to read but a catalogue's, so
 * what exists, and what its numbers are, cannot be asked without when.
 *
 * `available` is the one door to which figures a draw may draw: a stall, a starter pick, a regular,
 * a carousel, a pull, the exchange or the almanac. A run, a table, a sitting, a fight's setup and the
 * views Leaf sends each carry their era, and `catalogOf` reads the catalogue from it: never from a
 * clock.
 */
import { type Banner, BANNERS, GROVE, type Look } from "./banners.ts";
import { BOON_IDS, type BoonId, type BoonSpec } from "./boons.ts";
import { FIGURE_IDS, type FigureId, type FigureSpec, type Tier } from "./figures.ts";
import {
  COMPONENT_IDS,
  type ComponentId,
  type ComponentSpec,
  EMBLEM_IDS,
  type EmblemId,
  FINISHED_IDS,
  type FinishedId,
  type FinishedSpec,
} from "./items.ts";
import { MEMBER_IDS } from "./members.ts";
import { type Arrival, fields, fold, type Patch } from "./patch.ts";
import { type Era, eraOf, LAST_ERA, pullsEra, type ReleaseId, RELEASES } from "./releases.ts";
import { BASE } from "./releases/base.ts";
import { GROOT } from "./releases/groot.ts";
import { type KinId, TRAIT_IDS, type TraitId, type TraitSpec } from "./traits.ts";

export type { FigureId } from "./figures.ts";
export type { Era } from "./releases.ts";

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

/** Every release's patch, in the order the releases open. A release with nothing in it yet has none. */
const PATCHES: readonly Patch[] = [BASE, GROOT];

/** Every figure any release may bring, in the order a release's arrivals are drawn in. */
const ALL_FIGURES: readonly FigureId[] = [...FIGURE_IDS, ...MEMBER_IDS];
/**
 * The order draws were made in when eras came in. Every figure after these comes in the order its
 * release brings it, after all of them, so the order only grows at its end and a draw never
 * changes because a list was reordered.
 */
const DRAWN: readonly FigureId[] = [
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
  "banner-1",
] as const satisfies readonly FigureId[];

export interface Catalog {
  readonly era: Era;
  /** Every figure open at this era. */
  readonly figures: Readonly<Partial<Record<FigureId, Figure>>>;
  /** The order draws are made in: only ever added to at its end (`DRAWN`). */
  readonly order: readonly FigureId[];
  readonly traits: Readonly<Partial<Record<TraitId, TraitSpec>>>;
  readonly components: Readonly<Partial<Record<ComponentId, ComponentSpec>>>;
  readonly finished: Readonly<Partial<Record<FinishedId, FinishedSpec>>>;
  /** The kin each emblem makes its holder. */
  readonly emblems: Readonly<Partial<Record<EmblemId, KinId>>>;
  readonly boons: Readonly<Partial<Record<BoonId, BoonSpec>>>;
  /**
   * What is open, as lists in their kinds' own order: what is walked to draw, count or show traits,
   * items and boons. The global id lists name what any release has, and are never walked for that.
   */
  readonly ids: Open;
  /** The banners whose release is open. */
  readonly banners: readonly Banner[];
  /** The catalogue of an era up to this one: what a banner's pool was when it opened. */
  readonly earlier: (era: Era) => Catalog;
}
/** The ids of what a catalogue has open, kind by kind. */
export interface Open {
  readonly traits: readonly TraitId[];
  readonly components: readonly ComponentId[];
  readonly finished: readonly FinishedId[];
  readonly emblems: readonly EmblemId[];
  readonly boons: readonly BoonId[];
}
/** What of a catalogue a patch folds into, kind by kind. */
type Kinds = Pick<Catalog, "traits" | "components" | "finished" | "emblems" | "boons">;
const present = <K extends string>(ids: readonly K[], table: Readonly<Partial<Record<K, unknown>>>): K[] =>
  ids.filter((id) => table[id] !== undefined);

/**
 * Who may have a figure a release brings, and how it is drawn: everyone, by the set; or whoever
 * pulled it, as its banner says, if a banner that release opens has it as its headliner.
 */
function whoseOf(id: FigureId, since: ReleaseId): { readonly access: Access; readonly look: Look } {
  const banner = BANNERS.find((b) => b.headliner === id);
  if (!banner) return { access: "shared", look: "set" };
  if (banner.opens !== since) throw new Error(`${banner.id}'s headliner comes with ${since}, not with its banner`);
  return { access: { headliner: banner.id }, look: banner.look };
}

/**
 * The catalogue of every era, from the base and the patches given (each release's, in the order
 * the releases open): one era's catalogue is the one before it with that release's patch folded in.
 */
export function catalogsOf(patches: readonly Patch[]): readonly Catalog[] {
  const out: Catalog[] = [];
  let arrived: Partial<Record<FigureId, Arrival>> = {};
  const since: Partial<Record<FigureId, ReleaseId>> = {};
  const came: FigureId[] = [];
  const banners: Banner[] = [];
  let was: Kinds = {
    traits: {},
    components: {},
    finished: {},
    emblems: {},
    boons: {},
  };
  for (const { id: release } of RELEASES) {
    const found = patches.filter((p) => p.release === release);
    if (found.length > 1) throw new Error(`${release} has ${found.length} patches`);
    const patch = found[0];
    const before = arrived;
    arrived = fold(ALL_FIGURES, before, patch?.figures, fields);
    for (const id of ALL_FIGURES.filter((f) => arrived[f] && !before[f])) {
      since[id] = release;
      came.push(id);
    }
    was = {
      traits: fold(TRAIT_IDS, was.traits, patch?.traits, fields),
      components: fold(COMPONENT_IDS, was.components, patch?.components, fields),
      finished: fold(FINISHED_IDS, was.finished, patch?.finished, fields),
      emblems: fold(EMBLEM_IDS, was.emblems, patch?.emblems, (_, kin) => kin),
      boons: fold(BOON_IDS, was.boons, patch?.boons, fields),
    };
    const figures: Partial<Record<FigureId, Figure>> = {};
    for (const id of came) {
      const [f, from] = [arrived[id], since[id]];
      if (f && from) figures[id] = { ...f, since: from, ...whoseOf(id, from) };
    }
    const order = [...DRAWN.filter((id) => figures[id]), ...came.filter((id) => !DRAWN.includes(id))];
    banners.push(...BANNERS.filter((b) => b.opens === release));
    const era = eraOf(release);
    const ids: Open = {
      traits: present(TRAIT_IDS, was.traits),
      components: present(COMPONENT_IDS, was.components),
      finished: present(FINISHED_IDS, was.finished),
      emblems: present(EMBLEM_IDS, was.emblems),
      boons: present(BOON_IDS, was.boons),
    };
    const earlier = (at: Era): Catalog => {
      const cat = out[at - 1];
      if (!cat || at > era) throw new RangeError(`Era ${era} has no catalogue of era ${at}`);
      return cat;
    };
    out.push({ era, figures, order, ...was, ids, banners: [...banners], earlier });
  }
  return out;
}
/** One catalogue an era, made once. */
const CATALOGS: readonly Catalog[] = catalogsOf(PATCHES);

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
 * A pool's prizes of a rarity: a banner's headliner, or everyone's figures of that rarity, as the
 * catalogue of the pool's era has them, rarities and all: a banner's era is its release's, the
 * grove's the catalogue's. Either way a release whose figures join with the next is left out until
 * it does (`pullsEra`). So a banner pays out what it opened with, at the odds it opened with.
 */
function prizes(cat: Catalog, pool: string, rarity: Rarity): FigureId[] {
  const banner = cat.banners.find((b) => b.id === pool);
  if (!banner && pool !== GROVE) return [];
  if (rarity === "Yggdrasil") return banner ? [banner.headliner] : [];
  const pooled = cat.earlier(pullsEra(banner ? eraOf(banner.opens) : cat.era));
  return pooled.order.filter((id) => pooled.figures[id]?.access === "shared" && pooled.figures[id]?.prize === rarity);
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
/** Every figure of a catalogue as a prize, with its rarity there. */
export const prizeRarities = (cat: Catalog): readonly (readonly [string, Rarity])[] =>
  cat.order.flatMap((id) => {
    const f = cat.figures[id];
    return f ? [[prizeOf(id), f.prize] as const] : [];
  });
/** A figure prize's rarity in a catalogue; undefined for one it does not have, or a prize that is no figure. */
export function rarityIn(cat: Catalog, prize: string): Rarity | undefined {
  const id = figureOf(prize);
  return id === null ? undefined : cat.figures[id]?.prize;
}
