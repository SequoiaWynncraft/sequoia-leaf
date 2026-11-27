/**
 * Small questions asked of a live table as Leaf shows it (`SittingView`), for the page to draw: the
 * clock's words, the players down the side, whom the member faces, the carousel's turn, a place in
 * words, and what a room paid. Nothing here reads a clock: `now` is Leaf's, given.
 */
import { catalogOf, ECONOMY, type FightResult, figureIn, refusalText, type RunView } from "@sequoia-leaf/raid";
import { CHAIRS, CLOCK, SITTING_REFUSALS } from "@sequoia-leaf/raid/sitting/sitting.ts";
import type { SeatView, SittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { opening } from "../logic.ts";

/** Whole seconds from `now` to a moment, never below 0. */
export const secondsTo = (at: number, now: number): number => Math.max(0, Math.ceil((at - now) / 1000));

const STAGES: Readonly<Record<SittingView["stage"]["at"], string>> = {
  open: "Waiting to start",
  carousel: "Carousel",
  plan: "Planning",
  fight: "The fight",
  over: "Over",
};

/** The clock at the top: what this stage is, and the seconds left of it (none before the start or after the end). */
export function clockOf(view: SittingView, now: number): { label: string; seconds: number | null } {
  const { stage } = view;
  const label = STAGES[stage.at];
  if (stage.at === "open" || stage.at === "over") return { label, seconds: null };
  return { label, seconds: secondsTo(stage.at === "carousel" ? carouselEnds(stage) : stage.until, now) };
}
/** The clock as one line: "Planning · 23 s". */
export function clockText(view: SittingView, now: number): string {
  const { label, seconds } = clockOf(view, now);
  return seconds === null ? label : `${label} · ${seconds} s`;
}

/** A seat's name as the page writes it: a regular's article made a capital ("A Moth"). */
export const seatName = (seat: Pick<SeatView, "name">): string => opening(seat.name);

/** Whom the member faces in a sparring room: "Against Fernwick", or the odd one out's copy of a board. Null in the forest's rooms, or not seated. */
export function facingLine(view: SittingView): string | null {
  const mine = view.you === null ? null : view.seats[view.you];
  const faces = mine?.faces ?? null;
  const them = faces === null ? null : view.seats[faces];
  if (!them) return null;
  return them.faces === view.you ? `Against ${seatName(them)}` : `Against a copy of ${seatName(them)}'s board`;
}

/** A row of the players' list. */
export interface PlayerRow {
  seat: number;
  name: string;
  resolve: number;
  /** The health bar's fill, from 0 to 1 of the health a run starts with. */
  fill: number;
  /** Out, and in what place; null while in. */
  place: number | null;
  you: boolean;
  /** The one the member faces in the sparring room in hand. */
  facing: boolean;
}

/** The players down the side, in seat order. */
export function playerRows(view: SittingView): PlayerRow[] {
  const mine = view.you === null ? null : view.seats[view.you];
  return view.seats.map((seat, i) => ({
    seat: i,
    name: seatName(seat),
    resolve: Math.max(0, seat.resolve),
    fill: Math.min(1, Math.max(0, seat.resolve / ECONOMY.resolve)),
    place: seat.place,
    you: i === view.you,
    facing: mine?.faces === i,
  }));
}

/** A place in words: "1st", "5th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
/** A place at the table: "5th of 8". */
export const placeText = (place: number, seats = CHAIRS): string => `${ordinal(place)} of ${seats}`;

/** Where the member is in a carousel: not in it, waiting their turn (and how long), choosing (and how long is left), or done. */
export type Turn =
  | { at: "none" }
  | { at: "waiting"; seconds: number }
  | { at: "choosing"; seconds: number }
  | { at: "taken"; offer: number };

/** When the carousel ends: when its last pair has had its time. */
export function carouselEnds(stage: Extract<SittingView["stage"], { at: "carousel" }>): number {
  const pairs = Math.ceil((stage.turns.length - stage.open) / 2);
  return pairs === 0 ? stage.until : stage.until + (pairs - 1) * CLOCK.pair + CLOCK.last;
}

/** The member's turn at the carousel: pairs are let in lowest health first, a pair each 5 seconds; the first carousel lets everyone in at once. */
export function turnOf(view: SittingView, now: number): Turn {
  const { stage, you } = view;
  if (stage.at !== "carousel" || you === null) return { at: "none" };
  const offer = stage.ring.findIndex((o) => o.by === you);
  if (offer >= 0) return { at: "taken", offer };
  const turn = stage.turns.indexOf(you);
  if (turn < 0) return { at: "none" };
  if (turn < stage.open) return { at: "choosing", seconds: secondsTo(carouselEnds(stage), now) };
  const opens = stage.until + Math.floor((turn - stage.open) / 2) * CLOCK.pair;
  return { at: "waiting", seconds: secondsTo(opens, now) };
}

/** Who may take from the ring now: the seats let in that have taken nothing yet. */
export function choosingNow(view: SittingView): number[] {
  const { stage } = view;
  if (stage.at !== "carousel") return [];
  return stage.turns.slice(0, stage.open).filter((seat) => !stage.ring.some((o) => o.by === seat));
}

/** What a room paid the member, said plainly: how it went, then health, acorns and a level, as the run changed. */
export function paidLines(result: FightResult | null, before: RunView, after: RunView): string[] {
  const lines = [result === "win" ? "Room won" : result === "loss" ? "Room lost" : result === "draw" ? "A draw" : null];
  const health = after.resolve - before.resolve;
  const acorns = after.acorns - before.acorns;
  if (health !== 0) lines.push(`${health > 0 ? "+" : ""}${health} health`);
  if (acorns !== 0) lines.push(`${acorns > 0 ? "+" : ""}${acorns} acorns`);
  if (after.level > before.level) lines.push(`Level ${after.level}`);
  return lines.filter((line) => line !== null);
}

/** A refusal in words: Leaf's own sentence when it gave one, else the sitting's or the run's for the code. */
export function refusalWords(code: string, why = ""): string {
  if (why !== "") return why;
  const own = Object.entries(SITTING_REFUSALS).find(([c]) => c === code);
  return own ? own[1] : refusalText(code);
}

/** The carousel in a line, for the member: whose turn it is and how long, or what they took. */
export function turnLine(view: SittingView, now: number): string {
  const { stage } = view;
  if (stage.at !== "carousel") return "";
  const turn = turnOf(view, now);
  if (turn.at === "taken") {
    const offer = stage.ring[turn.offer];
    return offer ? `You took ${figureIn(catalogOf(view), offer.kind).name}.` : "";
  }
  if (turn.at === "choosing")
    return stage.open === stage.turns.length && view.room === 0
      ? "Everyone chooses at once."
      : "Your turn: choose one.";
  return turn.at === "waiting" ? `Your turn in ${turn.seconds} s.` : "";
}

/** The clock's second line: the carousel's turn, or in a sparring room whom the member faces. */
export function clockLine(view: SittingView, now: number): string {
  if (view.stage.at === "carousel") return turnLine(view, now);
  return view.stage.at === "plan" || view.stage.at === "fight" ? (facingLine(view) ?? "") : "";
}

/** What the page says of a table that closed before anybody started it. */
export const CLOSED_UNSTARTED = "This table closed before it started.";
/** What the page says when Leaf shows the member without a seat at a table the page held (they left it in another tab). */
export const NOT_SEATED = "You are not at that table any more.";

/** Whether Leaf's view of a sitting has the member in a seat: among those sat, before the start; with a seat of their own, after. */
export const seatedAt = (view: SittingView, member: string): boolean =>
  view.stage.at === "open" ? view.stage.sat.some((m) => m.id === member) : view.you !== null;
/**
 * Whether a sitting closed before it started, as it stands now (`view`) and stood before (`was`): it
 * was open, and it is over with nobody ever seated, at its deadline, as the clock closes it. One
 * emptied by its last member leaving ended before its deadline, and is not this.
 */
export function closedUnstarted(view: SittingView, was: SittingView): boolean {
  return (
    view.stage.at === "over" &&
    view.seats.length === 0 &&
    was.stage.at === "open" &&
    view.stage.ended >= was.stage.until
  );
}

/**
 * Which place of the ring keeps the keyboard when the ring is drawn again (somebody took a figure):
 * the one that had it while it still stands, else the next that does; none when none does.
 */
export function focusAfter(ring: readonly { readonly by: number | null }[], had: number): number | null {
  for (let k = 0; k < ring.length; k++) {
    const at = (had + k) % ring.length;
    if (ring[at]?.by === null) return at;
  }
  return null;
}
