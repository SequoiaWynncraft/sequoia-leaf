/**
 * The carousel: nine figures in a ring, each holding a component, and everyone still in takes one.
 * The first, before room 1, is open to everyone at once, and its figure is who a seat sets out
 * with, in place of the run's own first pick; the regulars wait for the members, and take theirs
 * when it ends. The later ones let seats in two at a time, lowest resolve first, and a regular takes
 * one by the dice as its turn opens. Whoever has taken none when it ends gets one of what is left,
 * by the dice.
 */
import { pick, shuffled } from "@sequoia-leaf/core";

import { type FigureId, figuresOfTier, type Tier } from "../content/figures.ts";
import type { ComponentId } from "../content/items.ts";
import { COLS } from "../hex.ts";
import { fielded, merge, newPiece, type Note, pieces, type Run, sellValue } from "../run.ts";
import { CLOCK, later, type Offer, RING_ITEMS, type Sitting, type Stage } from "./sitting.ts";

type Carousel = Extract<Stage, { at: "carousel" }>;

/**
 * A figure joins a run, holding a component: on the bench, or in the middle of the front row when
 * nobody is on the board. Three of a kind merge as they do when bought, which is also how one joins
 * a full bench; with a full bench and no three to make, it is sold on the spot, its price paid in
 * acorns and its component put on the item bench. The first pick of a run (who sets out) is settled
 * by it.
 */
export function join(run: Run, kind: FigureId, item: ComponentId): Note[] {
  if (run.stage.phase === "plan" && run.stage.picks[0]?.kind === "starter") run.stage.picks.shift();
  const twins = pieces(run).filter((p) => p.kind === kind && p.stars === 1).length;
  const slot = run.bench.indexOf(null);
  const piece = newPiece(run, kind);
  piece.items = [item];
  const placed = fielded(run) === 0 || slot >= 0;
  if (fielded(run) === 0) run.board[Math.floor(COLS / 2)] = piece;
  else if (slot >= 0) run.bench[slot] = piece;
  else if (twins < 2) {
    run.acorns += sellValue(piece);
    run.items.push(item);
    return [];
  }
  const notes: Note[] = [];
  merge(run, placed ? null : piece, notes);
  return notes;
}

/** What is left in a ring, as places in it. */
const left = (ring: readonly Offer[]): number[] => ring.flatMap((offer, i) => (offer.by === null ? [i] : []));
/** Whether a seat has taken its figure. */
export const hasTaken = (stage: Carousel, seat: number): boolean => stage.ring.some((offer) => offer.by === seat);

/** A seat takes an offer of the ring: it is theirs, and joins their run. */
export function take(t: Sitting, stage: Carousel, seat: number, at: number): Note[] {
  const offer = stage.ring[at];
  const run = t.seats[seat]?.run;
  if (!offer || !run) return [];
  offer.by = seat;
  return join(run, offer.kind, offer.item);
}

/** A seat takes one of what is left, by the dice. */
function takeAny(t: Sitting, stage: Carousel, seat: number): void {
  const free = left(stage.ring);
  if (free.length > 0) take(t, stage, seat, pick(t, free));
}

/**
 * Lets the next `count` seats in: each may take from then on, and a regular among them takes at
 * once, but when everyone is let in together (`together`: then the regulars take when it ends). The
 * stage then waits for the next pair, or `last` for the end when everyone has been let in.
 */
export function letIn(t: Sitting, stage: Carousel, count: number, last: number, together = false): void {
  const from = stage.open;
  stage.open = Math.min(stage.turns.length, from + count);
  for (const seat of stage.turns.slice(from, stage.open)) {
    if (!together && t.seats[seat]?.who.is === "regular") takeAny(t, stage, seat);
  }
  stage.until = later(t, stage.until, stage.open < stage.turns.length ? CLOCK.pair : last);
}

/**
 * Lays a carousel out at a moment: the ring's figures by their costs, no figure twice while a cost
 * has others, each with a component dealt from two of each; and the turns, lowest resolve first,
 * the lower seat first among equals. `together` opens it to everyone at once; else to the first pair.
 */
export function layCarousel(t: Sitting, at: number, costs: readonly Tier[], together: boolean): void {
  const items = shuffled(t, RING_ITEMS);
  const piles = new Map<Tier, FigureId[]>();
  const ring = costs.flatMap((tier, i): Offer[] => {
    const pile = piles.get(tier) ?? [];
    if (pile.length === 0) pile.push(...shuffled(t, figuresOfTier(tier)));
    piles.set(tier, pile);
    const kind = pile.pop();
    const item = items[i % items.length];
    return kind && item ? [{ kind, item, by: null }] : [];
  });
  const resolve = (seat: number): number => t.seats[seat]?.run.resolve ?? 0;
  const turns = t.seats
    .flatMap((seat, i) => (seat.place === null ? [i] : []))
    .toSorted((a, b) => resolve(a) - resolve(b) || a - b);
  const stage: Carousel = { at: "carousel", until: at, ring, turns, open: 0 };
  t.stage = stage;
  letIn(t, stage, together ? turns.length : 2, together ? CLOCK.together : CLOCK.last, together);
}

/** A carousel's deadline: the next pair is let in, or, with everyone in, it ends. Says whether it ended. */
export function turnCarousel(t: Sitting, stage: Carousel): boolean {
  if (stage.open < stage.turns.length) {
    letIn(t, stage, 2, CLOCK.last);
    return false;
  }
  for (const seat of stage.turns) {
    if (t.seats[seat]?.place === null && !hasTaken(stage, seat)) takeAny(t, stage, seat);
  }
  return true;
}
