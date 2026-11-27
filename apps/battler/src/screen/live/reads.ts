/**
 * Small questions asked of a live table as Leaf shows it (`SittingView`), for the page to draw: the
 * clock's words, the players down the side, whom the member faces, the carousel's turn, a place in
 * words, and what a room paid. Nothing here reads a clock: `now` is Leaf's, given.
 */
import { catalogOf, ECONOMY, type FightResult, figureIn, refusalText, type RunView } from "@sequoia-leaf/raid";
import { CHAIRS, SITTING_REFUSALS, waitingOn } from "@sequoia-leaf/raid/sitting/sitting.ts";
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

/**
 * The clock at the top: what this stage is, and the seconds left of it at the most (it ends sooner
 * once everyone is done); in a carousel the seconds left of the member's own turn, while it is theirs.
 * None before the start or after the end.
 */
export function clockOf(view: SittingView, now: number): { label: string; seconds: number | null } {
  const { stage } = view;
  const label = STAGES[stage.at];
  if (stage.at === "open" || stage.at === "over") return { label, seconds: null };
  if (stage.at !== "carousel") return { label, seconds: secondsTo(stage.until, now) };
  const turn = turnOf(view, now);
  return { label, seconds: turn.at === "choosing" ? turn.seconds : null };
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

/** Where the member is in a carousel: not in it, waiting their turn (and how many choose before them), choosing (and how long is left), or done. */
export type Turn =
  | { at: "none" }
  | { at: "waiting"; before: number }
  | { at: "choosing"; seconds: number }
  | { at: "taken"; offer: number };

/**
 * The member's turn at the carousel: seats are let in lowest health first, two at a time (in the
 * first, the members at once); a turn ends as soon as everyone in it has taken, so how long the wait
 * is cannot be known, only how many take first.
 */
export function turnOf(view: SittingView, now: number): Turn {
  const { stage, you } = view;
  if (stage.at !== "carousel" || you === null) return { at: "none" };
  const offer = stage.ring.findIndex((o) => o.by === you);
  if (offer >= 0) return { at: "taken", offer };
  const turn = stage.turns.indexOf(you);
  if (turn < 0) return { at: "none" };
  if (turn < stage.open) return { at: "choosing", seconds: secondsTo(stage.ends, now) };
  const taken = (seat: number): boolean => stage.ring.some((o) => o.by === seat);
  const before = stage.turns.slice(0, turn).filter((seat) => !taken(seat) && view.seats[seat]?.place === null);
  return { at: "waiting", before: before.length };
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

/** "1 player", "2 players". */
const players = (n: number): string => `${n} ${n === 1 ? "player" : "players"}`;

/** The carousel in a line, for the member: their turn, how many choose before them, or what they took. */
export function turnLine(view: SittingView, now: number): string {
  const { stage } = view;
  if (stage.at !== "carousel") return "";
  const turn = turnOf(view, now);
  if (turn.at === "taken") {
    const offer = stage.ring[turn.offer];
    return offer ? `You took ${figureIn(catalogOf(view), offer.kind).name}.` : "";
  }
  if (turn.at === "choosing") return "Your turn: choose one.";
  return turn.at === "waiting" ? `Your turn after ${players(turn.before)}.` : "";
}

/**
 * Whom planning or the fights still wait for, once the member has done their part (ready, or their
 * fight watched): "Waiting for Sootpaw." or "Waiting for 2 players."; empty while the member still
 * has something to do, or nobody else has.
 */
export function waitingLine(view: SittingView): string {
  const { you, stage } = view;
  if (you === null || view.seats[you]?.place !== null || (stage.at !== "plan" && stage.at !== "fight")) return "";
  const left = waitingOn(view);
  if (left.includes(you)) return "";
  const [one] = left;
  const them = one === undefined ? undefined : view.seats[one];
  if (!them) return "";
  return left.length === 1 ? `Waiting for ${seatName(them)}.` : `Waiting for ${players(left.length)}.`;
}

/** The clock's second line: the carousel's turn; while planning or fighting whom it waits for, else whom the member faces in a sparring room. */
export function clockLine(view: SittingView, now: number): string {
  if (view.stage.at === "carousel") return turnLine(view, now);
  if (view.stage.at !== "plan" && view.stage.at !== "fight") return "";
  return waitingLine(view) || (facingLine(view) ?? "");
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
 * What the ring does as the sitting changes, from the ring it showed (of the carousel before room
 * `room`, or none) to the one Leaf shows now (before room `now`): a new carousel is laid out afresh
 * ("lay"); in the same one, only the places taken since move (they fly off, and their buttons go).
 * Nothing else is ever built again, so a figure pressed as somebody else takes another keeps its
 * button, and the tap.
 */
export function ringMoves(
  room: number | null,
  was: readonly { readonly by: number | null }[],
  now: number,
  ring: readonly { readonly by: number | null }[],
): "lay" | number[] {
  if (room !== now || was.length !== ring.length) return "lay";
  return ring.flatMap((offer, i) => (offer.by !== null && was[i]?.by === null ? [i] : []));
}

/**
 * A ring figure's button, from the board's corner: round the figure where it is drawn (its feet at
 * `feet`, lifted `lift` as it drops in or bobs, `tall` over them) and its held mark under them.
 */
export function figureBox(feet: { x: number; y: number }, tall: number, lift: number) {
  return { x: feet.x - 11, y: feet.y - lift - tall - 4, w: 22, h: tall + 14 };
}

/** The shortest way round from one angle to another, in radians. */
const around = (from: number, to: number): number => {
  const d = (((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI);
  return d - Math.PI;
};

/**
 * The ring's places one frame on (`at`: each place's angle; `spots`: where each place still standing
 * belongs), each eased the short way round towards its spot by `dt` seconds at `rate` a second. While
 * the pointer is on a figure (`held`) nothing moves at all, not even to close a gap another's take
 * left, so the figure under it stays put; the gaps close once it is let go.
 */
export function closeUp(
  at: readonly number[],
  spots: ReadonlyMap<number, number>,
  dt: number,
  held: boolean,
  rate: number,
): number[] {
  if (held) return [...at];
  const k = Math.min(1, dt * rate);
  return at.map((a, i) => {
    const spot = spots.get(i);
    return spot === undefined ? a : a + around(a, spot) * k;
  });
}

/**
 * How the ring's buttons stack, one number each (higher in front): as the table draws its figures,
 * the nearer feet in front, and of two level the one further right.
 */
export function stacking(feet: readonly { x: number; y: number }[]): number[] {
  const order = feet
    .map((_, i) => i)
    .toSorted((a, b) => (feet[a]?.y ?? 0) - (feet[b]?.y ?? 0) || (feet[a]?.x ?? 0) - (feet[b]?.x ?? 0));
  const stack = feet.map(() => 0);
  order.forEach((i, k) => (stack[i] = k + 1));
  return stack;
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
