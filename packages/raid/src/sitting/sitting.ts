import { type Catalog, catalogOf } from "../content/catalog.ts";
import { type FigureId, figureIn, type Tier } from "../content/figures.ts";
/**
 * A sitting: The Little Raid played by up to eight at once, on Leaf's clock. (The design calls it a
 * live table; `Table` is Leaf's solo table in `game.ts`, so here it is a sitting.) This file is what
 * a sitting is, as plain data, and the small things read from it. `clock.ts` brings one to a moment,
 * `commands.ts` is what people do at one, `view.ts` what a page is shown, `keep.ts` storing it.
 *
 * Every seat is a `Run`, and goes through the run's own rooms by the run's own rules. The sitting
 * adds what is shared: the clock, who fights whom, the carousel, who is out and in what place.
 */
import { type ComponentId } from "../content/items.ts";
import type { Era } from "../content/releases.ts";
import { FIGHT, REGULARS, type RoomKind, ROOMS } from "../content/rooms.ts";
import type { TraitId } from "../content/traits.ts";
import type { FightSetup, FightSummary } from "../fight/types.ts";
import type { Side } from "../hex.ts";
import type { Party } from "../party.ts";
import { partyOf, REFUSALS, type Run, type Why } from "../run.ts";

/** Seats at a sitting. Empty ones are taken by regulars when it starts, so a started sitting has all of them. */
export const CHAIRS = 8;
/** The trail every seat's run is on: the first, where the forest is plain. */
export const TRAIL = 0;

/** The clock, in milliseconds. With no member still in, every wait is 0: the regulars play straight to the end. */
export const CLOCK = {
  /** An open sitting nobody started closes after this. */
  open: 30 * 60_000,
  /** The first carousel, open to everyone at once. */
  together: 12_000,
  /** A later carousel lets a pair in this long after the pair before, and ends this long after the last pair. */
  pair: 5_000,
  last: 8_000,
  /** Planning: the first `early` rooms, and the rooms after. */
  early: 5,
  plan: 30_000,
  planLater: 35_000,
  /** After the longest of a room's fights, before the takings. */
  after: 4_000,
} as const;
/** One step of a fight's clock. */
export const STEP_MS = 1000 / FIGHT.hz;

/**
 * What stands in the ring of each carousel, as costs: before room 1, after the first boss, after the
 * second. Each figure holds one component.
 */
export const CAROUSELS: readonly (readonly Tier[])[] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2, 3, 3, 3, 3],
  [3, 3, 3, 4, 4, 4, 4, 5, 5],
];
/** The components the ring's figures hold are dealt from: two of each. */
export const ringItems = (cat: Catalog): readonly ComponentId[] => [...cat.ids.components, ...cat.ids.components];

/** A member, as Leaf knows them: their Leaf id, and their name as Leaf shows it. */
export interface Member {
  id: string;
  name: string;
}
/** Whose a seat is: a member's, or a regular's, who is one of the raid's figures and plans as the bot does when fond of `habit`. */
export type Who = ({ is: "member" } & Member) | { is: "regular"; figure: FigureId; habit: TraitId };

export interface Seat {
  who: Who;
  run: Run;
  /** Its board as it was at the last lock, signed: what anyone may scout. Nobody on it before the first lock. */
  shown: Party;
  /** Its place once it is out or the sitting is over, 1 the winner; null while it is in. */
  place: number | null;
}

/** A figure in a carousel's ring, the component it holds, and the seat that took it. */
export interface Offer {
  kind: FigureId;
  item: ComponentId;
  by: number | null;
}

/**
 * Where a sitting stands, and the moment that ends (Leaf's clock, in milliseconds):
 *
 * - `open`: waiting to start, with who has sat down, in the order they did;
 * - `carousel`: the ring, the seats in the order of their turns, and how many of them may take now;
 * - `plan`: everyone plans the room;
 * - `fight`: the boards are locked and the fights decided, and are being watched;
 * - `over`: and when it ended. A sitting over with no seats was never started.
 */
export type Stage =
  | { at: "open"; until: number; sat: Member[] }
  | { at: "carousel"; until: number; ring: Offer[]; turns: number[]; open: number }
  | { at: "plan"; until: number }
  | { at: "fight"; until: number }
  | { at: "over"; ended: number };

/** Coins a member's seat has earned and Leaf has not paid yet, under a key Leaf pays once (`seat:<n>`, beside the sitting's id). */
export interface Owed {
  key: string;
  member: string;
  coins: number;
}

export interface Sitting {
  /** The sitting's own stream: everything it draws comes from it. */
  rng: number;
  /** The era of its last deadline, at that deadline's own moment (or of its opening, or its start): what it and every seat's run draw from. */
  era: Era;
  /** The Leaf id of whoever opened it, who may start it. */
  by: string;
  /** The room being planned or fought, counting from 0, or during a carousel the room after it. Past the fifteenth they are sparring rooms. */
  room: number;
  stage: Stage;
  /** None while it is open; `CHAIRS` of them from the start. A seat's number is its place here. */
  seats: Seat[];
  /** The pairs of the sparring room in hand, or of the last one: two seats, the lower (home) first. */
  pairs: [number, number][];
  /** The odd one out of that room, and the seat whose board it fights a copy of. */
  odd: [number, number] | null;
  owed: Owed[];
}

// ---------- reading one ----------

/** The seats still in. */
export const seatsIn = (t: Pick<Sitting, "seats">): Seat[] => t.seats.filter((seat) => seat.place === null);
/** Whether a member is still in. If none is, nothing waits. */
export const watched = (t: Pick<Sitting, "seats">): boolean => seatsIn(t).some((seat) => seat.who.is === "member");
/** The moment a wait of `ms` from `at` ends: at once, when no member is still in. */
export const later = (t: Pick<Sitting, "seats">, at: number, ms: number): number => (watched(t) ? at + ms : at);
/** What kind of room one is: the raid's fifteen, and sparring rooms after them. */
export const kindOf = (room: number): RoomKind => ROOMS[room]?.kind ?? "spar";
/** How long a room is planned for. */
export const planMs = (room: number): number => (room < CLOCK.early ? CLOCK.plan : CLOCK.planLater);

/** The name a seat goes by: the member's, or the figure's as a regular. */
export const nameOf = (cat: Catalog, who: Who): string =>
  who.is === "member"
    ? who.name
    : (REGULARS.find((r) => r.kind === who.figure)?.name ?? figureIn(cat, who.figure).name);

/** A seat's board as it would go into a fight now, signed with its name, and with the member's id. */
export function signed({ who, run }: Pick<Seat, "who" | "run">): Party {
  return { ...partyOf(run), who: nameOf(catalogOf(run), who), ...(who.is === "member" && { by: who.id }) };
}

/** Which side of a fight's setup is a seat's own: 1 for the away seat of a pair, whose board is across; else 0. */
export function sideOf(setup: FightSetup, who: Who): Side {
  const across = setup.sides[1];
  const theirs =
    who.is === "member"
      ? across.by === who.id
      : across.by === undefined && across.who === nameOf(catalogOf(setup), who);
  return theirs ? 1 : 0;
}

/**
 * How a fight came out for one of its sides. A fight is decided for side 0; for side 1 a win is a
 * loss and who is left standing changes places. What each figure did stays as it was. Done twice
 * it is the fight as decided again, which `playsAsKept` takes.
 */
export function sided(outcome: FightSummary, side: Side): FightSummary {
  if (side === 0) return outcome;
  const result = outcome.result === "win" ? "loss" : outcome.result === "loss" ? "win" : "draw";
  return { ...outcome, result, standing: [outcome.standing[1], outcome.standing[0]] };
}

/** The seat a seat faces in the sparring room in hand: the other of its pair, or for the odd one out the seat it fights a copy of. */
export function facing(t: Pick<Sitting, "pairs" | "odd">, seat: number): number | null {
  for (const [home, away] of t.pairs) {
    if (home === seat) return away;
    if (away === seat) return home;
  }
  return t.odd?.[0] === seat ? t.odd[1] : null;
}

// ---------- refusals ----------

/** Why a sitting turned a command down, besides the run's own reasons (`REFUSALS`). */
export const SITTING_REFUSALS = {
  not_open: "That table has started.",
  not_started: "The table has not started yet.",
  table_over: "That table is over.",
  seated: "You are at that table already.",
  not_seated: "You are not at that table.",
  not_opener: "Whoever opened the table starts it.",
  out: "You are out.",
  carousel: "The carousel is not over yet.",
  no_carousel: "There is no carousel now.",
  not_your_turn: "It is not your turn yet.",
  picked: "You have taken a figure already.",
  taken: "Somebody took that one.",
  not_in_ring: "That is not in the ring.",
} as const;
export type SittingWhy = keyof typeof SITTING_REFUSALS;

/** A command turned down: a code, and the sentence a player is shown for it. */
export interface Refusal {
  ok: false;
  code: SittingWhy | Why;
  why: string;
}
const isWhy = (code: string): code is Why => Object.hasOwn(REFUSALS, code);
/** A sitting's refusal, or one in the run's words. */
export const refuse = (code: SittingWhy | Why): Refusal => ({
  ok: false,
  code,
  why: isWhy(code) ? REFUSALS[code] : SITTING_REFUSALS[code],
});

/** Why a seat's planning commands are not taken in a stage, or null in planning. Leaf and the page's prediction both ask this. */
export function notPlanning(at: Stage["at"]): SittingWhy | Why | null {
  if (at === "plan") return null;
  return at === "open" ? "not_started" : at === "carousel" ? "carousel" : at === "fight" ? "fighting" : "table_over";
}
