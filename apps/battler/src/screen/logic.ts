/**
 * Small questions the screen keeps asking of a run, answered without touching the page: where a
 * held figure may go, what an item would become on a figure, how the savings stack up, what the
 * next nudge for a new member is, what the postcard for the town says. They are here, apart from
 * the drawing, so that they can be checked by tests.
 */
import type { Postcard } from "@sequoia-leaf/kit/postcard.ts";

import {
  type Almanac,
  boonNumber,
  COMPONENT_IDS,
  type ComponentId,
  countTraits,
  ECONOMY,
  fieldCap,
  fielded,
  FIGURE_IDS,
  type FigureId,
  FIGURES,
  FINISHED,
  type FinishedId,
  forge,
  holdItem,
  interestCap,
  interestNow,
  isComponentId,
  type ItemId,
  openFight,
  type Party,
  partyOf,
  type Piece,
  pieces,
  priceOf,
  type Run,
  specOf,
  type Spot,
  type Stars,
  starScale,
  stepFor,
  TRAILS,
  type TraitId,
  TRAITS,
  traitsNow,
  traitsOf,
  type UnitKind,
} from "../game/index.ts";
import { charmsOf } from "../game/party.ts";

/** Where a figure picked up from `from` may be put down: free seats, free hollows, and places it would swap into. */
export interface Reach {
  seats: number[];
  swaps: number[];
  slots: number[];
  /** Hollows with somebody in them, to change places with. */
  slotSwaps: number[];
}

export function reachOf(run: Run, from: Spot): Reach {
  const out: Reach = { seats: [], swaps: [], slots: [], slotSwaps: [] };
  // A figure coming off the bench onto a free seat makes one more on the board.
  const room = from.on === "board" || fielded(run) < fieldCap(run);
  run.board.forEach((piece, at) => {
    if (from.on === "board" && from.at === at) return;
    if (piece) out.swaps.push(at);
    else if (room) out.seats.push(at);
  });
  run.bench.forEach((piece, at) => {
    if (from.on === "bench" && from.at === at) return;
    if (piece) out.slotSwaps.push(at);
    else out.slots.push(at);
  });
  return out;
}

/** Where a figure straight off the stall may be put: free hollows, and free seats while there is room on the board. */
export function reachOfOffer(run: Run): Reach {
  const room = fielded(run) < fieldCap(run);
  const seats: number[] = [];
  const slots: number[] = [];
  if (run.bench.includes(null)) {
    run.board.forEach((piece, at) => {
      if (!piece && room) seats.push(at);
    });
    run.bench.forEach((piece, at) => {
      if (!piece) slots.push(at);
    });
  }
  return { seats, swaps: [], slots, slotSwaps: [] };
}

/** Whether an offer on the stall can be paid for and has somewhere to go (or completes three of a kind). */
export function canBuy(run: Run, offer: number): boolean {
  const kind = run.stall[offer];
  if (!kind || run.acorns < priceOf(run, offer)) return false;
  if (run.bench.includes(null)) return true;
  return pieces(run).filter((p) => p.kind === kind && p.stars === 1).length >= 2;
}

/** What handing an item to a figure would do: nothing (no room), hold it, or forge it with a component already held. */
export type Handing =
  { can: false } | { can: true; forged: null } | { can: true; forged: FinishedId; with: ComponentId };

export function handing(piece: Pick<Piece, "items">, item: ItemId): Handing {
  const got = holdItem(piece.items, item);
  if (!got) return { can: false };
  if (got.forged && got.with) return { can: true, forged: got.forged, with: got.with };
  return { can: true, forged: null };
}

/** What a component makes with each of the five components. */
export function recipesOf(item: ComponentId): { with: ComponentId; makes: FinishedId }[] {
  return COMPONENT_IDS.map((other) => ({ with: other, makes: forge(item, other) }));
}

/** The loose components the party has: on the item bench, and held unforged by a figure. */
export function looseComponents(run: Run): ComponentId[] {
  const out: ComponentId[] = [];
  for (const item of run.items) if (isComponentId(item)) out.push(item);
  for (const p of pieces(run)) for (const item of p.items) if (isComponentId(item)) out.push(item);
  return out;
}

/** What a component would make with each *other* loose component the party has, without repeats. */
export function combosWithHeld(run: Run, item: ComponentId, itemAt = -1): { with: ComponentId; makes: FinishedId }[] {
  const others: ComponentId[] = [];
  run.items.forEach((held, at) => {
    if (at !== itemAt && isComponentId(held) && !others.includes(held)) others.push(held);
  });
  for (const p of pieces(run)) {
    for (const held of p.items) if (isComponentId(held) && !others.includes(held)) others.push(held);
  }
  return others.map((other) => ({ with: other, makes: forge(item, other) }));
}

/** The purse as it is counted: whole piles of savings that are earning, loose acorns, and what the piles will pay. */
export interface Savings {
  /** How many acorns make a pile that earns one. */
  per: number;
  /** Piles that could earn at most, and piles held now. */
  most: number;
  piles: number;
  loose: number;
  /** What the next room will pay for them. */
  pays: number;
  /** Acorns still to save for one more pile; 0 when every pile is full. */
  toNext: number;
}
export function savings(run: Run): Savings {
  const most = interestCap(run);
  const pays = interestNow(run);
  const per = run.boons.includes("deeppockets") ? boonNumber("deeppockets", "per") : ECONOMY.interestPer;
  const piles = Math.min(most, Math.floor(run.acorns / per));
  return {
    per,
    most,
    piles,
    loose: run.acorns - piles * per,
    pays,
    toNext: piles >= most ? 0 : per - (run.acorns % per),
  };
}

/** Traits whose step is higher now than it was: the ones that have just switched on, or on harder. */
export function steppedUp(before: ReadonlyMap<TraitId, number>, run: Run): { trait: TraitId; step: number }[] {
  const out: { trait: TraitId; step: number }[] = [];
  for (const state of traitsNow(run)) {
    if (state.step > (before.get(state.trait) ?? 0)) out.push({ trait: state.trait, step: state.step });
  }
  return out;
}
/** The step every trait is on. */
export function stepsOf(run: Run): Map<TraitId, number> {
  const steps = new Map<TraitId, number>();
  for (const state of traitsNow(run)) steps.set(state.trait, state.step);
  return steps;
}

// ---------- teaching by doing ----------

/** The first-time nudges, in the order a new member meets them. */
export const NUDGES = ["pick", "buy", "setout", "watch", "field", "three", "item", "trait", "save", "rustle"] as const;
export type NudgeId = (typeof NUDGES)[number];

/** What the table is doing, as far as a nudge cares. */
export type Doing = "pick" | "plan" | "fight" | "other";

/**
 * The one nudge to show now, if any: the earliest not yet given whose moment has come. Each is a
 * single thing to do, in the place where it matters; none of them is shown twice.
 */
export function nudgeFor(run: Run, doing: Doing, taught: readonly string[]): NudgeId | null {
  const fresh = (id: NudgeId): boolean => !taught.includes(id);
  const choice = run.choices[0];
  if (doing === "pick") return choice?.kind === "starter" && fresh("pick") ? "pick" : null;
  if (doing === "fight") return fresh("watch") ? "watch" : null;
  if (doing !== "plan" || choice) return null;
  const owned = pieces(run);
  const benched = run.bench.some((p) => p !== null);
  const affordable = run.stall.some((_, i) => canBuy(run, i));
  if (fresh("buy") && owned.length === 1 && affordable) return "buy";
  if (fresh("field") && benched && fielded(run) < fieldCap(run)) return "field";
  if (fresh("item") && run.items.length > 0) return "item";
  if (fresh("setout") && run.room === 0 && fielded(run) > 0) return "setout";
  if (fresh("three") && run.room >= 1 && hasPair(owned)) return "three";
  if (fresh("trait") && traitsNow(run).some((t) => t.step > 0)) return "trait";
  if (fresh("save") && run.acorns >= ECONOMY.interestPer) return "save";
  if (fresh("rustle") && run.room >= 2 && run.rustles > 0 && !affordable) return "rustle";
  return null;
}
function hasPair(owned: readonly Piece[]): boolean {
  const seen = new Set<string>();
  for (const p of owned) {
    const key = `${p.kind}:${p.stars}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

// ---------- what a card says about a figure ----------

/** The numbers a card shows for a figure. */
export interface Numbers {
  health: number;
  attack: number;
  /** Attacks a second. */
  speed: number;
  reach: number;
  armour: number;
  ward: number;
}
export const NUMBER_KEYS = ["health", "attack", "speed", "reach", "armour", "ward"] as const;

/** A figure's own numbers at a number of stars, before anything it holds or belongs to. */
export function plainNumbers(kind: UnitKind, stars: Stars): Numbers {
  const spec = specOf(kind);
  const star = starScale(stars);
  return {
    health: Math.round(spec.hp * star),
    attack: Math.round(spec.attack * star),
    speed: spec.speed,
    reach: spec.range,
    armour: spec.armour,
    ward: spec.ward,
  };
}

const EMPTY: Party = { who: "", title: "", figures: [], charms: [], boons: [], might: 100 };

/**
 * A figure's numbers as the next fight would start them: its items, its party's boons and, on the
 * board, the traits its party switches on. Asked of the fight itself, so the card can never say
 * other than what happens.
 */
export function startNumbers(party: Party, seat: number, against: Party = EMPTY): Numbers | null {
  const fight = openFight({ seed: 1, sides: [party, against] });
  const u = fight.units.find((x) => x.side === 0 && !x.summoned && x.seat === seat);
  if (!u) return null;
  return {
    health: Math.round(u.maxHp),
    attack: Math.round(u.attack),
    speed: u.speed,
    reach: u.range,
    armour: u.armour,
    ward: u.ward,
  };
}

/** The numbers of one of the member's own figures: on the board with the party's traits, on the bench with only what it holds. */
export function pieceNumbers(run: Run, spot: Spot): Numbers | null {
  if (spot.on === "board") return startNumbers(partyOf(run), spot.at);
  const piece = run.bench[spot.at];
  if (!piece) return null;
  // Alone, in the middle row: nobody to share a trait with, and no row of Tidy Formation's.
  const alone: Party = {
    ...partyOf(run),
    figures: [{ kind: piece.kind, stars: piece.stars, seat: 7, items: piece.items.slice(), fed: piece.fed }],
    charms: [],
  };
  return startNumbers(alone, 7);
}

/** How a trait stands for a party: how many it fields, and how many the next step needs. */
export interface TraitCount {
  count: number;
  /** The next step's need; the top step's when it is all the way on. */
  next: number;
  step: number;
}
export function traitCount(party: Pick<Party, "figures" | "charms">, trait: TraitId): TraitCount {
  const counts = countTraits(
    party.figures.map((p) => p.kind),
    party.charms,
  );
  const count = counts[trait] ?? 0;
  const steps = TRAITS[trait].steps;
  return { count, next: steps.find((need) => need > count) ?? steps.at(-1) ?? 1, step: stepFor(trait, count) };
}
/** The same for the member's party as it is fielded now. */
export const ownTraitCount = (run: Run, trait: TraitId): TraitCount =>
  traitCount({ figures: partyOf(run).figures, charms: charmsOf(run.boons) }, trait);

/** Where the member has a figure just now: fielded, on the bench, on the stall, or nowhere. */
export function whereIs(run: Run, kind: FigureId): "board" | "bench" | "stall" | null {
  if (run.board.some((p) => p?.kind === kind)) return "board";
  if (run.bench.some((p) => p?.kind === kind)) return "bench";
  if (run.stall.includes(kind)) return "stall";
  return null;
}

/** Whether the rack has a finished item, or both the components that make it. */
export function rackHas(run: Run, item: FinishedId): "item" | "parts" | null {
  if (run.items.includes(item)) return "item";
  const [a, b] = FINISHED[item].made;
  const loose = run.items.filter(isComponentId);
  const at = loose.indexOf(a);
  if (at < 0) return null;
  return loose.some((c, i) => i !== at && c === b) ? "parts" : null;
}

/** Every figure of a trait, cheapest first, in the order of the roster within a tier. */
export const membersOf = (trait: TraitId): FigureId[] =>
  FIGURE_IDS.filter((id) => traitsOf(id).includes(trait)).toSorted((a, b) => FIGURES[a].tier - FIGURES[b].tier);

/**
 * The postcard the table leaves for the town (the kit's `postcard.ts`): a raid under way and where
 * it got to, or the board set out; and every boss ever beaten, for carved figures in the member's
 * camp. The table keeps no till.
 */
export function postcard(run: Run | null, almanac: Almanac): Postcard {
  const trail = run ? TRAILS[run.trail] : undefined;
  const waiting =
    run && run.phase !== "over"
      ? `A raid is under way: room ${run.room + 1}, on ${trail?.name ?? "the trail"}.`
      : almanac.runs === 0
        ? "The board is set out. One crab is uncounted."
        : "The board is set out for another raid.";
  return { waiting, trophies: [...new Set(almanac.bosses.flat())], till: 0 };
}
