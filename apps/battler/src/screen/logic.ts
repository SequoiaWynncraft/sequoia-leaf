/**
 * Small questions the screen keeps asking of a run, answered without touching the page: where a
 * held figure may go, what an item would become on a figure, how the savings stack up, what the
 * next nudge for a new member is. They are here, apart from the drawing, so that they can be
 * checked by tests.
 */
import {
  boonNumber,
  COMPONENT_IDS,
  type ComponentId,
  ECONOMY,
  fieldCap,
  fielded,
  type FinishedId,
  forge,
  holdItem,
  interestCap,
  interestNow,
  isComponentId,
  type ItemId,
  type Piece,
  pieces,
  priceOf,
  type Run,
  type Spot,
  type TraitId,
  traitsNow,
} from "../game/index.ts";

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
