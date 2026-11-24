/**
 * Small questions the screen keeps asking of a run, answered without touching the page: where a
 * held figure may go, what an item would become on a figure, how the savings stack up, what the
 * next nudge for a new member is, what the postcard for the town says. They are here, apart from
 * the drawing, so that they can be checked by tests.
 */
import { mix, type Postcard } from "@sequoia-leaf/core";
import {
  type Almanac,
  boonNumber,
  buy,
  COMPONENT_IDS,
  type ComponentId,
  countTraits,
  ECONOMY,
  fieldCap,
  fielded,
  type FightResult,
  FIGURE_IDS,
  type FigureId,
  FIGURES,
  FINISHED,
  type FinishedId,
  forge,
  holdItem,
  HZ,
  interestCap,
  interestNow,
  isComponentId,
  type ItemId,
  legal,
  openFight,
  type Party,
  partyOf,
  picksOf,
  type Piece,
  pieces,
  type RunView,
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
} from "@sequoia-leaf/raid";
import { regularNamed, REGULARS } from "@sequoia-leaf/raid/content/rooms.ts";

/** Where a figure picked up from `from` may be put down: free seats, free hollows, and places it would swap into. */
export interface Reach {
  seats: number[];
  swaps: number[];
  slots: number[];
  /** Hollows with somebody in them, to change places with. */
  slotSwaps: number[];
}

/** Where a figure picked up from `from` may be put down: every place the rules would move it to. */
export function reachOf(run: RunView, from: Spot): Reach {
  const out: Reach = { seats: [], swaps: [], slots: [], slotSwaps: [] };
  const may = (to: Spot): boolean => legal(run, { do: "move", from, to });
  run.board.forEach((piece, at) => {
    if (may({ on: "board", at })) (piece ? out.swaps : out.seats).push(at);
  });
  run.bench.forEach((piece, at) => {
    if (may({ on: "bench", at })) (piece ? out.slotSwaps : out.slots).push(at);
  });
  return out;
}

/**
 * Where an offer carried off the stall may be put down: bought (to the bench's first free hollow),
 * then anywhere the rules would move it from there; nowhere for one that cannot be bought, or that
 * goes straight into three of a kind.
 */
export function reachOfOffer(run: RunView, offer: number): Reach {
  const after = structuredClone(run);
  const done = buy(after, offer);
  const bought = done.ok ? done.notes.find((n) => n.t === "bought") : undefined;
  const from = bought?.t === "bought" ? bought.to : null;
  if (!from) return { seats: [], swaps: [], slots: [], slotSwaps: [] };
  const reach = reachOf(after, from);
  // Where it lands on the bench is one of the places, though it is already there.
  return { seats: reach.seats, swaps: [], slots: [from.at, ...reach.slots].toSorted((a, b) => a - b), slotSwaps: [] };
}

/** Whether an offer on the stall can be bought now: paid for, with somewhere to go (or completing three of a kind). */
export const canBuy = (run: RunView, offer: number): boolean => legal(run, { do: "buy", offer });

/**
 * What handing an item to a figure would do: nothing (no room, or an emblem of a kin it is already),
 * hold it, or forge it with a component already held.
 */
export type Handing =
  { can: false } | { can: true; forged: null } | { can: true; forged: FinishedId; with: ComponentId };

export function handing(piece: Pick<Piece, "kind" | "items">, item: ItemId): Handing {
  const got = holdItem(piece, item);
  if ("refused" in got) return { can: false };
  if (got.forged && got.with) return { can: true, forged: got.forged, with: got.with };
  return { can: true, forged: null };
}

/** What a component makes with each of the five components. */
export function recipesOf(item: ComponentId): { with: ComponentId; makes: FinishedId }[] {
  return COMPONENT_IDS.map((other) => ({ with: other, makes: forge(item, other) }));
}

/** The loose components the party has: on the item bench, and held unforged by a figure. */
export function looseComponents(run: RunView): ComponentId[] {
  const out: ComponentId[] = [];
  for (const item of run.items) if (isComponentId(item)) out.push(item);
  for (const p of pieces(run)) for (const item of p.items) if (isComponentId(item)) out.push(item);
  return out;
}

/** What a component would make with each *other* loose component the party has, without repeats. */
export function combosWithHeld(
  run: RunView,
  item: ComponentId,
  itemAt = -1,
): { with: ComponentId; makes: FinishedId }[] {
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
export function savings(run: RunView): Savings {
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

/** How a run's streak pays, in one sentence, from the table the run pays from. */
export function streakRule(): string {
  const table = ECONOMY.streakAcorns;
  const groups: { pay: number; from: number; to: number }[] = [];
  for (let n = 1; n < table.length; n++) {
    const pay = table[n] ?? 0;
    const last = groups.at(-1);
    if (pay <= 0) continue;
    if (last && last.pay === pay && last.to === n - 1) last.to = n;
    else groups.push({ pay, from: n, to: n });
  }
  const parts = groups.map((g, i) => {
    const at =
      i === groups.length - 1 && g.to === table.length - 1
        ? `${g.from} or more`
        : g.to === g.from
          ? `${g.from}`
          : g.to === g.from + 1
            ? `${g.from} or ${g.to}`
            : `${g.from} to ${g.to}`;
    return `${g.pay} at ${at}`;
  });
  const least = groups[0]?.from ?? 2;
  return `Win or lose ${least} or more rooms in a row for extra acorns each room: ${parts.join(", ")}.`;
}
/** A streak as the takings name it: "Win streak 3", "Loss streak 2". */
export const streakName = (streak: number): string => `${streak > 0 ? "Win" : "Loss"} streak ${Math.abs(streak)}`;
/** The run's streak in a sentence, or null when it is under 2. */
export function streakNow(run: RunView): string | null {
  const n = Math.abs(run.streak);
  if (n < 2) return null;
  return `You have ${run.streak > 0 ? "won" : "lost"} ${n} rooms in a row.`;
}

/** Traits whose step is higher now than it was: the ones that have just switched on, or on harder. */
export function steppedUp(before: ReadonlyMap<TraitId, number>, run: RunView): { trait: TraitId; step: number }[] {
  const out: { trait: TraitId; step: number }[] = [];
  for (const state of traitsNow(run)) {
    if (state.step > (before.get(state.trait) ?? 0)) out.push({ trait: state.trait, step: state.step });
  }
  return out;
}
/** The step every trait is on. */
export function stepsOf(run: RunView): Map<TraitId, number> {
  const steps = new Map<TraitId, number>();
  for (const state of traitsNow(run)) steps.set(state.trait, state.step);
  return steps;
}

/**
 * Keeps one run's trait steps from one look to the next, to tell which have gone up. A run is told
 * from another by its number at the table (`S.runs`), which lasts across the copies of it the page
 * is given with every answer from Leaf, and not by which object it is.
 */
export class TraitWatch {
  private steps: Map<TraitId, number> | null = null;
  private of: number | null = null;
  /** The traits whose step has gone up since the last look at the same run; none at the first look at a run. */
  look(run: RunView, which: number): { trait: TraitId; step: number }[] {
    const up = this.steps !== null && this.of === which ? steppedUp(this.steps, run) : [];
    this.steps = stepsOf(run);
    this.of = which;
    return up;
  }
  /** Forgets the run, so that the next look tells nothing. */
  forget(): void {
    this.steps = null;
    this.of = null;
  }
}

// ---------- teaching by doing ----------

/** The first-time nudges, in the order a new member meets them. */
export const NUDGES = ["buy", "setout", "watch", "field", "three", "item", "trait", "save", "rustle"] as const;
export type NudgeId = (typeof NUDGES)[number];

/** What the table is doing, as far as a nudge cares. */
export type Doing = "plan" | "fight" | "other";

/**
 * The one nudge to show now, if any: the earliest not yet given whose moment has come. Each is a
 * single thing to do, in the place where it matters; none of them is shown twice.
 */
export function nudgeFor(run: RunView, doing: Doing, taught: readonly string[]): NudgeId | null {
  const fresh = (id: NudgeId): boolean => !taught.includes(id);
  if (doing === "fight") return fresh("watch") ? "watch" : null;
  if (doing !== "plan" || picksOf(run).length > 0) return null;
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

const EMPTY: Party = { who: "", title: "", figures: [], boons: [], might: 100 };

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
export function pieceNumbers(run: RunView, spot: Spot): Numbers | null {
  if (spot.on === "board") return startNumbers(partyOf(run), spot.at);
  const piece = run.bench[spot.at];
  if (!piece) return null;
  // Alone, in the middle row: nobody to share a trait with, and no row of Tidy Formation's.
  const alone: Party = {
    ...partyOf(run),
    figures: [{ kind: piece.kind, stars: piece.stars, seat: 7, items: piece.items.slice(), fed: piece.fed }],
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
export function traitCount(party: Pick<Party, "figures">, trait: TraitId): TraitCount {
  const counts = countTraits(party.figures);
  const count = counts[trait] ?? 0;
  const steps = TRAITS[trait].steps;
  return { count, next: steps.find((need) => need > count) ?? steps.at(-1) ?? 1, step: stepFor(trait, count) };
}
/** The same for the member's party as it is fielded now. */
export const ownTraitCount = (run: RunView, trait: TraitId): TraitCount => traitCount(partyOf(run), trait);

/** Where the member has a figure just now: fielded, on the bench, on the stall, or nowhere. */
export function whereIs(run: RunView, kind: FigureId): "board" | "bench" | "stall" | null {
  if (run.board.some((p) => p?.kind === kind)) return "board";
  if (run.bench.some((p) => p?.kind === kind)) return "bench";
  if (run.stall.includes(kind)) return "stall";
  return null;
}

/** Whether the rack has a finished item, or both the components that make it. */
export function rackHas(run: RunView, item: FinishedId): "item" | "parts" | null {
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
 * it got to, or the board set out. The table keeps no till.
 */
export function postcard(run: RunView | null, almanac: Almanac): Postcard {
  const trail = run ? TRAILS[run.trail] : undefined;
  const waiting =
    run && run.stage.phase !== "over"
      ? `A raid is under way: room ${run.room + 1}, on ${trail?.name ?? "the trail"}.`
      : almanac.runs === 0
        ? "The board is set out. One crab is uncounted."
        : "The board is set out for another raid.";
  return { waiting, till: 0 };
}

/** A name at the start of a sentence or a line: "a Moth" is "A Moth" there. */
export const opening = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/** The title of a fight's sheet: how it went and how long it took, "Room won · 14 s". */
export function fightTitle(result: FightResult, ticks: number): string {
  const how = result === "win" ? "Room won" : result === "loss" ? "Room lost" : "A draw";
  return `${how} · ${Math.max(1, Math.round(ticks / HZ))} s`;
}

/**
 * The two regulars who watch from the side logs, never the one across the table: picked by the
 * run's number at the table, so they stay the same all raid and change from one raid to the next.
 */
export function watchersOf(runNumber: number, across: string): [FigureId, FigureId] {
  const skip = regularNamed(across)?.kind;
  const others = REGULARS.map((r) => r.kind).filter((k) => k !== skip);
  const roll = mix(runNumber, 0x5ea7);
  const a = others[roll % others.length] ?? "moth";
  const rest = others.filter((k) => k !== a);
  return [a, rest[(roll >>> 8) % rest.length] ?? "crab7"];
}

/** Which walk-in the far party is on: one for each room met, and again each time a room is fought again. */
export const arrivalOf = (run: Pick<RunView, "room" | "record">): string => `${run.room}:${run.record.length}`;
