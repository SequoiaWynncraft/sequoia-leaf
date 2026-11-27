/**
 * What the Grove says and counts, with no page in it: what a prize is called and is for, what a
 * reveal says of it, the line for the pulls towards a top prize, the chances and the rules as
 * `RATES` has them, when each beat of a ceremony falls and where its clock waits, and why a pull
 * cannot be made. `grovescene.ts` and `groveui.ts` show them.
 */

import { exact, whole } from "@sequoia-leaf/core";
import type { Spend } from "@sequoia-leaf/kit/dom.ts";
import {
  type Counters,
  forSeeds,
  isOpen,
  type Prizes,
  prizesOf,
  type Pulled,
  type PullsNote,
  type PullsView,
  RARITIES,
  type Rarity,
  rarityOf,
  RATES,
  type Tier,
  topChance,
} from "@sequoia-leaf/pulls";
import type { BannerPerson } from "@sequoia-leaf/pulls/wire.ts";
import { type Banner, BANNERS, GROVE } from "@sequoia-leaf/raid/content/banners.ts";
import { type Catalog, catalogAt, catalogOf, rarityIn } from "@sequoia-leaf/raid/content/catalog.ts";
import { type FigureId, figureIn, isFigureId } from "@sequoia-leaf/raid/content/figures.ts";
import { LOOK_KINDS, LOOKS } from "@sequoia-leaf/raid/content/looks.ts";
import { eraAt, LAST_ERA } from "@sequoia-leaf/raid/content/releases.ts";
import { thingOf } from "@sequoia-leaf/town/things.ts";

/** The pool that is always open (the raid's catalogue names it), and what the page calls it. */
export { GROVE };
export const EVERGREEN = "Evergreen";

export const RARITY_NAMES = Object.keys(RARITIES).filter((r): r is Rarity => Object.hasOwn(RARITIES, r));
export const tierOf = (rarity: Rarity): Tier => RARITIES[rarity].tier;

const seeds = (n: number): string => `${whole(n)} ${n === 1 ? "Seed" : "Seeds"}`;

/**
 * A banner that can be shown: open by Leaf's view, with its headliner's name: a figure of the set's
 * own by its name at once, one drawn from a member's skin once Leaf has said who (`person`), by the
 * member's name or (`shows: "title"`) the rules' name for the figure. `title` is what its pool is
 * called: the banner's own name where it has one, else its headliner's.
 */
export interface Showing {
  readonly id: string;
  readonly until: number;
  readonly name: string;
  readonly title: string;
  readonly person: { readonly id: string; readonly name: string } | null;
  readonly headliner: FigureId;
}

/** The banner to show among the rows (`BANNERS`), if one is open by Leaf's view and its headliner is known: the first such. */
export function showing(
  view: Pick<PullsView, "open" | "era">,
  people: readonly BannerPerson[],
  rows: readonly Banner[],
): Showing | null {
  for (const { id, until } of view.open) {
    const row = rows.find((b) => b.id === id);
    const person = row?.look === "skin" ? (people.find((b) => b.id === id)?.headliner ?? null) : null;
    const ruled = row && figureIn(catalogOf(view), row.headliner).name;
    const name = row?.look === "set" ? ruled : person && (row?.shows === "title" ? ruled : person.name);
    if (row && name) return { id, until, name, title: row.name ?? name, person, headliner: row.headliner };
  }
  return null;
}

/**
 * A banner's headliner's name: the set's own figure's, as the catalogue with every release open has
 * it (a pool or a prize of any banner, open or past), or the member's as Leaf says it; null for one
 * not known.
 */
function headlinerName(banner: string, people: readonly BannerPerson[]): string | null {
  const row = BANNERS.find((b) => b.id === banner);
  if (row?.look === "set" || row?.shows === "title") return figureIn(catalogAt(LAST_ERA), row.headliner).name;
  return people.find((b) => b.id === banner)?.headliner?.name ?? null;
}
/** The figure of the set's own that a banner's headliner is, for its picture; null for one drawn from a member's skin. */
export const setHeadliner = (banner: string): FigureId | null =>
  BANNERS.find((b) => b.id === banner && b.look === "set")?.headliner ?? null;

/** A pool's name: the always-open one's own, its banner's own, or its banner's headliner's. */
export const poolName = (pool: string, banners: readonly BannerPerson[]): string =>
  pool === GROVE ? EVERGREEN : (BANNERS.find((b) => b.id === pool)?.name ?? headlinerName(pool, banners) ?? "A banner");

// ---------- a prize ----------

/**
 * What a prize is called: a figure by its name in the raid's catalogue of Leaf's era, a headliner by
 * their name, which only Leaf knows, and a thing or a look of earlier pulls by its own.
 */
export function prizeName(cat: Catalog, prize: string, banners: readonly BannerPerson[]): string {
  const [kind = "", id = ""] = prize.split(":");
  if (kind === "figure") return isFigureId(id) ? figureIn(cat, id).name : id;
  if (kind === "thing") return thingOf(id)?.name ?? id;
  if (kind === "look") return LOOK_KINDS.flatMap((k) => LOOKS[k]).find((l) => l.id === id)?.name ?? id;
  return headlinerName(id, banners) ?? "The headliner";
}

/** What a reveal says of the prize a pull drew, or Seeds bought. */
export interface Reveal {
  readonly name: string;
  readonly rarity: Rarity;
  /** "New", or how many the player has now. */
  readonly have: string;
  readonly owned: boolean;
  /** The Seeds the pull gave; none for a prize had for Seeds. */
  readonly seeds: string | null;
}

export function revealOf(cat: Catalog, note: PullsNote, banners: readonly BannerPerson[]): Reveal {
  return {
    name: prizeName(cat, note.prize, banners),
    rarity: note.rarity,
    have: note.have > 1 ? `You have ${whole(note.have)}` : "New",
    owned: note.have > 1,
    seeds: note.t === "pull" ? `+${seeds(RATES.seeds[tierOf(note.rarity)])}` : null,
  };
}

/** The Seeds a list of pulls gave, as the end picture says it. */
export const seedsOf = (notes: readonly PullsNote[]): string =>
  `+${seeds(notes.reduce((sum, n) => sum + (n.t === "pull" ? RATES.seeds[tierOf(n.rarity)] : 0), 0))}`;

// ---------- pity ----------

/** Pulls made towards the next top prize in a kind of pool, of the pull on which it is certain: "34 of 80". */
export const pityLine = (c: Pick<Counters, "top">): string => `${c.top} of ${RATES.top.certainAt}`;

/** After a lost 50/50 in a banner: who the next top prize there is. Null when nothing is owed. */
export const owedLine = (c: Pick<Counters, "owed">, name: string): string | null =>
  c.owed ? `The next top prize here is ${name}` : null;

// ---------- the chances ----------

/** A share in percent, with as many decimals as it needs, up to three: 0.8, 5.952. */
const pc = (share: number): string => exact(share * 100);
export const percent = (share: number): string => `${pc(share)}%`;

/**
 * The chance of each rarity on one pull with nothing owed and no guarantee near: straight from
 * `RATES`, in a banner or in the always-open pool.
 */
export function chances(banner: boolean): Record<Rarity, number> {
  const { top, mid, filler } = RATES;
  const midShare = (1 - top.chance) * mid.chance;
  const fillerShare = 1 - top.chance - midShare;
  const mids = mid.Dryad + mid.Druid;
  const fillers = filler.Leafkin + filler.Sapling + filler.Sprite;
  return {
    Leafkin: (fillerShare * filler.Leafkin) / fillers,
    Sapling: (fillerShare * filler.Sapling) / fillers,
    Sprite: (fillerShare * filler.Sprite) / fillers,
    Dryad: (midShare * mid.Dryad) / mids,
    Druid: (midShare * mid.Druid) / mids,
    Treant: banner ? top.chance * (1 - top.headliner) : top.chance,
    Yggdrasil: banner ? top.chance * top.headliner : 0,
  };
}

/** Names said as a choice: "A, B or C". */
const either = (names: readonly string[]): string =>
  names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : (names[0] ?? "");
const named = (tier: Tier): string => either(RARITY_NAMES.filter((r) => tierOf(r) === tier));

/**
 * The rules in numbers, each from `RATES`: for a banner whose headliner is `headliner` (and the
 * rarities it has featured figures of), or the always-open pool.
 */
export function rules(headliner: string | null, featured: readonly Rarity[] = []): string[] {
  const { top, mid, seeds: s, free } = RATES;
  const ramp = top.rampAfter + 1;
  return [
    `Top prize (${headliner === null ? "Treant" : named("top")}): ${percent(top.chance)} a pull. From pull ${ramp} since the last top prize, ${pc(topChance(ramp + 1) - topChance(ramp))} percentage points more each pull: ${percent(topChance(ramp))} on pull ${ramp}. Pull ${top.certainAt} is always a top prize.`,
    ...(headliner === null
      ? []
      : [
          `Here a top prize is ${headliner} or a Treant, ${percent(top.headliner)} each. After a Treant, the next top prize here is ${headliner}.`,
        ]),
    ...(featured.length === 0
      ? []
      : [
          `Featured: a ${either(featured)} drawn here is one of the featured figures ${percent(RATES.featured)} of the time.`,
        ]),
    `${named("mid")}: ${percent(mid.chance)} of the pulls that are not a top prize, so ${percent((1 - top.chance) * mid.chance)} a pull while a top prize is ${percent(top.chance)}. At least 1 pull in every ${mid.certainAt} is ${RARITY_NAMES.find((r) => tierOf(r) === "mid")} or better.`,
    `Seeds: ${s.filler} for ${named("filler")}, ${s.mid} for ${named("mid")}, ${s.top} for a top prize.`,
    `Free pull: 1 every ${free.every / 3_600_000} hours. Up to ${free.most} wait.`,
  ];
}

// ---------- a ceremony's clock ----------

/** How long each reveal holds, by its tier; a top prize's begins with half a second of black. */
const REVEAL: Record<Tier, number> = { filler: 1.3, mid: 1.9, top: 3.4 };
const FRAME = 1 / 60;

/** When each beat of a ceremony falls, in seconds on its clock. */
export interface Timeline {
  /** When the reveals begin: after the tell, or at once for a prize had for Seeds. */
  readonly tell: number;
  readonly starts: readonly number[];
  readonly end: number;
  /**
   * Where the clock stops until the player goes on: the last frame of the reveal of each mid-tier
   * or top prize among several. One prize alone stays on show whatever it is, so it has none.
   */
  readonly waits: readonly number[];
}

/** The timeline of a ceremony for prizes of these tiers, in the order Leaf drew them. */
export function timeline(tiers: readonly Tier[], tell: number): Timeline {
  const starts: number[] = [];
  const waits: number[] = [];
  let at = tell;
  for (const tier of tiers) {
    starts.push(at);
    at += REVEAL[tier];
    if (tier !== "filler" && tiers.length > 1) waits.push(at - FRAME);
  }
  return { tell, starts, end: at, waits };
}

/** The clock `dt` after `t`: it runs as far as a wait, and stands there. */
export const ticked = (line: Timeline, t: number, dt: number): number =>
  line.waits.find((w) => t <= w && w < t + dt) ?? t + dt;

/** Where going on puts the clock: at the next reveal (the first, from the tell), and after the last at the end. */
export const onward = (line: Timeline, t: number): number => line.starts.find((start) => start > t) ?? line.end;

// ---------- the buttons ----------

/**
 * What the Grove is doing: on its way in, at the banner, waiting for Leaf to answer a command, in a
 * ceremony, at a ceremony's end, or on its way out (or not there at all).
 */
export type GroveState = "arriving" | "banner" | "sent" | "ceremony" | "end" | "leaving";

/** The Grove's state from what it knows: the night of the walk in still lifting, and the ceremony on show (when it ends, and the clock). */
export function groveState(at: {
  readonly leaving: boolean;
  readonly sent: boolean;
  readonly dark: number;
  readonly end: number | null;
  readonly t: number;
}): GroveState {
  if (at.leaving) return "leaving";
  if (at.sent) return "sent";
  if (at.dark > 0) return "arriving";
  if (at.end === null) return "banner";
  return at.t < at.end ? "ceremony" : "end";
}

/** The one rule: a pull or an exchange is sent only at the banner or at a ceremony's end, one at a time. */
export const takesCommand = (state: GroveState): boolean => state === "banner" || state === "end";

/** A paid pull asks to be pressed again for its own pool and count, at its price, and no other. */
export const pullSpend = (pool: string, n: number): Spend => ({ on: `pull:${pool}:${n}`, price: n * RATES.leaf });

/** The banner open now, for the Grove's card in town: whose it is and until when. */
export const bannerLine = (b: Showing | null, zone?: string): string | null =>
  b && `${b.title === b.name ? `${b.name}'s banner` : b.title} is open until ${dayAndTime(b.until, zone)}.`;

/** A banner's featured figures as its catalogue has them, in its order, with the rarity each is drawn at; none for a pool with none. */
export function featuredOf(view: Pick<PullsView, "era">, pool: string): { id: FigureId; rarity: Rarity }[] {
  const cat = catalogOf(view);
  const banner = cat.banners.find((b) => b.id === pool);
  return (banner?.featured ?? []).flatMap((id) => {
    const f = cat.figures[id];
    return f ? [{ id, rarity: f.prize }] : [];
  });
}

/**
 * Whether to ask Leaf for the pulls again, by the page's clock: a free pull has fallen due, a banner
 * is due to open or to end, or a release to open. What is open and what each pool gives is only
 * ever what Leaf then says.
 */
export const askAgain = (v: PullsView, now: number): boolean =>
  (v.free.waiting < RATES.free.most && now >= v.free.next) ||
  eraAt(now) !== v.era ||
  BANNERS.some(({ id }) => isOpen(id, now) !== v.open.some((b) => b.id === id));
/** Whether the Grove asks Leaf for the pulls now: a minute after it last asked at the soonest, when it has none or one is due (`askAgain`). */
export const asksNow = (v: PullsView | null, now: number, asked: number): boolean =>
  now - asked >= 60_000 && (v === null || askAgain(v, now));

/** A time as the page writes it, in the player's own zone (or `zone`): "8 December, 01:00". */
export function dayAndTime(at: number, zone?: string): string {
  const date = new Date(at);
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: zone });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone });
  return `${day}, ${time}`;
}

/** When the next free pull falls due, while fewer than the most are waiting. */
export const nextFree = (free: PullsView["free"], zone?: string): string | null =>
  free.waiting >= RATES.free.most ? null : `Next free pull: ${dayAndTime(free.next, zone)}`;

/** What Leaf refuses a pull or an exchange with, in the page's words. */
const REFUSED: Readonly<Record<string, string>> = {
  not_enough_leaf: "Not enough Leaf.",
  closed: "This banner has ended.",
  no_free: "No free pull is waiting.",
  not_enough_seeds: "Not enough Seeds.",
  owned: "You have this already.",
  prizes_changed: "The prizes changed. Look again.",
};
export const refusedLine = (code: string): string => REFUSED[code] ?? "That could not be done just now.";

/** Why `n` pulls cannot be paid for with Leaf, or null when they can: the kit's line for closed Leaf, or too little of it. */
export function cannotPull(n: number, leaf: number, open: boolean, shut: string): string | null {
  if (!open) return shut;
  return leaf < n * RATES.leaf ? refusedLine("not_enough_leaf") : null;
}

// ---------- Seeds, and what was won ----------

/** A mid-tier prize as the exchange offers it. */
export interface Offer {
  readonly prize: string;
  readonly rarity: "Dryad" | "Druid";
  readonly price: number;
  readonly owned: boolean;
  readonly enough: boolean;
}

/** What a pool gives, by rarity, in the era Leaf's view is of (`prizesOf`): never by the page's own clock. */
export const poolPrizes = (view: Pick<PullsView, "era">, pool: string): Prizes => prizesOf(catalogOf(view), pool);
/** What the Grove's words show of Leaf's view, as text, to draw them again when any of it changes: its era among it. */
export const viewKey = (v: PullsView): string =>
  JSON.stringify([v.era, v.counters, v.seeds, v.free, v.pulls, Object.keys(v.have).length]);

/** The prize book's count: how many of the prizes it lists the player has. */
export function bookCount(
  view: Pick<PullsView, "have">,
  book: readonly (readonly [Rarity, readonly string[]])[],
): string {
  const all = book.flatMap(([, list]) => list);
  return `Yours: ${all.filter((prize) => view.have[prize] !== undefined).length} of ${all.length}`;
}

/**
 * Who stands in the Grove's clearing, one a stand: on a banner whose headliner the set draws, that
 * headliner; else the always-open pool's first three Treants in the era of Leaf's view. One past
 * them (Seqwawa, from 8 December) is in the prize book, not the clearing.
 */
export const clearing = (view: Pick<PullsView, "era">, banner: Showing | null): readonly string[] =>
  banner && banner.person === null ? poolPrizes(view, banner.id).Yggdrasil : poolPrizes(view, GROVE).Treant.slice(0, 3);

/**
 * What the prize book lists for a pool, the rarest last: each rarity the pool can come up with
 * (`chances`), and what Leaf draws of it in the era of Leaf's view. What its count is of.
 */
export function prizeBook(view: Pick<PullsView, "era">, pool: string): [Rarity, readonly string[]][] {
  const shown = chances(pool !== GROVE);
  const given = poolPrizes(view, pool);
  return RARITY_NAMES.flatMap((rarity): [Rarity, readonly string[]][] =>
    shown[rarity] === 0 ? [] : [[rarity, given[rarity]]],
  );
}

/** Every prize that can be had for Seeds in the view's era, cheapest first, with whether the player has it or the Seeds for it. */
export function offers(view: Pick<PullsView, "have" | "seeds" | "era">): Offer[] {
  const cat = catalogOf(view);
  return forSeeds(cat).flatMap((prize): Offer[] => {
    const rarity = rarityIn(cat, prize);
    if (rarity !== "Dryad" && rarity !== "Druid") return [];
    const price = RATES.exchange[rarity];
    return [{ prize, rarity, price, owned: view.have[prize] !== undefined, enough: view.seeds >= price }];
  });
}

/** A pull as the history lists it, newest first: for a top prize, the pull it came on, of the pull on which one is certain. */
export interface Past {
  readonly prize: string;
  readonly rarity: Rarity;
  readonly pool: string;
  readonly when: string;
  readonly top: string | null;
}

export function past(history: readonly Pulled[], banners: readonly BannerPerson[], zone?: string): Past[] {
  return history.toReversed().flatMap((p) => {
    const rarity = rarityOf(p.prize);
    if (rarity === undefined) return [];
    return [
      {
        prize: p.prize,
        rarity,
        pool: poolName(p.pool, banners),
        when: dayAndTime(p.at, zone),
        top: tierOf(rarity) === "top" ? pityLine(p) : null,
      },
    ];
  });
}
