/**
 * The carousel: nine figures in a ring, each holding a component, and everyone still in takes one.
 * Seats are let in a group at a time: in the first, before room 1, the members all at once and then
 * the regulars, and its figure is who a seat sets out with, in place of the run's own first pick; in
 * the later ones two at a time, lowest resolve first. A regular takes one by the dice a moment after
 * its turn opens (`CLOCK.take`, and as long again after the regular before it), so each take is seen
 * on its own. A group's turn ends as soon as everyone in it has taken, or when its time is up, and
 * then whoever in it has taken none gets one of what is left by the dice; the next is let in at that
 * moment, and the carousel ends with the last group's turn.
 */
import { pick, shuffled } from "@sequoia-leaf/core";

import { available, catalogOf } from "../content/catalog.ts";
import type { FigureId, Tier } from "../content/figures.ts";
import type { ComponentId } from "../content/items.ts";
import { COLS } from "../hex.ts";
import { fielded, merge, newPiece, type Note, pieces, type RunView, sellValue } from "../run.ts";
import {
  CLOCK,
  later,
  type Offer,
  ringItems,
  type Sitting,
  type SittingWhy,
  type Stage,
  waitingOn,
} from "./sitting.ts";

export type Carousel = Extract<Stage, { at: "carousel" }>;

/**
 * A figure joins a run, holding a component: on the bench, or in the middle of the front row when
 * nobody is on the board. Three of a kind merge as they do when bought, which is also how one joins
 * a full bench; with a full bench and no three to make, it is sold on the spot, its price paid in
 * acorns and its component put on the item bench. The first pick of a run (who sets out) is settled
 * by it.
 */
export function join(run: RunView, kind: FigureId, item: ComponentId): Note[] {
  if (run.stage.phase === "plan" && run.stage.picks[0]?.kind === "starter") run.stage.picks.shift();
  const twins = pieces(run).filter((p) => p.kind === kind && p.stars === 1).length;
  const slot = run.bench.indexOf(null);
  const piece = newPiece(run, kind);
  piece.items = [item];
  const placed = fielded(run) === 0 || slot >= 0;
  if (fielded(run) === 0) run.board[Math.floor(COLS / 2)] = piece;
  else if (slot >= 0) run.bench[slot] = piece;
  else if (twins < 2) {
    run.acorns += sellValue(catalogOf(run), piece);
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

/** Why a seat may not take an offer of the ring now, or null if it may. Leaf and the page's prediction both ask this. */
export function cannotTake(stage: Carousel, seat: number, offer: number): SittingWhy | null {
  const turn = stage.turns.indexOf(seat);
  if (turn < 0 || turn >= stage.open) return "not_your_turn";
  if (hasTaken(stage, seat)) return "picked";
  const wanted = stage.ring[offer];
  if (!wanted) return "not_in_ring";
  return wanted.by === null ? null : "taken";
}

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

const isRegular = (t: Sitting, seat: number): boolean => t.seats[seat]?.who.is === "regular";
/** The regulars let in and still in that have not taken, in the order of the turns: the first takes at the stage's next moment. */
const regularsDue = (t: Sitting): number[] => waitingOn(t).filter((seat) => isRegular(t, seat));

/** Where the group let in from turn `from` ends: in the first carousel the members, then everyone; in a later one, two. */
function groupFrom(t: Sitting, stage: Carousel, from: number): number {
  if (t.room !== 0) return Math.min(stage.turns.length, from + 2);
  const regular = stage.turns.findIndex((seat) => isRegular(t, seat));
  return from === 0 && regular > 0 ? regular : stage.turns.length;
}

/**
 * Lets the next group in at a moment: each may take from then on, its time is up after its wait
 * (and never before each regular in it has had its moment), and the stage's next moment is its
 * first regular's take, or the end of its time.
 */
function letIn(t: Sitting, stage: Carousel, at: number): void {
  const from = stage.open;
  const to = groupFrom(t, stage, from);
  const regulars = stage.turns.slice(from, to).filter((seat) => isRegular(t, seat)).length;
  const most = from === 0 && t.room === 0 ? CLOCK.together : to >= stage.turns.length ? CLOCK.last : CLOCK.pair;
  stage.open = to;
  stage.ends = later(t, at, Math.max(most, (regulars + 1) * CLOCK.take));
  waitFrom(t, stage, at);
}
/** The stage's next moment from `at`: the next regular's take, or the end of the group's time, never past it. */
function waitFrom(t: Sitting, stage: Carousel, at: number): void {
  stage.until = Math.min(stage.ends, regularsDue(t).length > 0 ? later(t, at, CLOCK.take) : stage.ends);
}

/**
 * Lays a carousel out at a moment: the ring's figures by their costs, no figure twice while a cost
 * has others, each with a component dealt from two of each; and the turns, lowest resolve first,
 * the lower seat first among equals. Then the first group is let in.
 */
export function layCarousel(t: Sitting, at: number, costs: readonly Tier[]): void {
  const items = shuffled(t, ringItems(catalogOf(t)));
  const piles = new Map<Tier, FigureId[]>();
  const ring = costs.flatMap((tier, i): Offer[] => {
    const pile = piles.get(tier) ?? [];
    if (pile.length === 0) pile.push(...shuffled(t, available(catalogOf(t), { for: "carousel", tier })));
    piles.set(tier, pile);
    const kind = pile.pop();
    const item = items[i % items.length];
    return kind && item ? [{ kind, item, by: null }] : [];
  });
  const resolve = (seat: number): number => t.seats[seat]?.run.resolve ?? 0;
  const turns = t.seats
    .flatMap((seat, i) => (seat.place === null ? [i] : []))
    .toSorted((a, b) => resolve(a) - resolve(b) || a - b);
  const stage: Carousel = { at: "carousel", until: at, ring, turns, open: 0, ends: at };
  t.stage = stage;
  letIn(t, stage, at);
}

/**
 * A carousel's next moment: the first regular due takes; then, with everyone let in taken or the
 * group's time up, whoever has taken none gets one of what is left by the dice, and the next group is
 * let in, or with none left it ends. Else it waits for the next regular, or the end of the group's
 * time. Says whether it ended.
 */
export function turnCarousel(t: Sitting, stage: Carousel): boolean {
  const at = stage.until;
  const [regular] = regularsDue(t);
  if (regular !== undefined) takeAny(t, stage, regular);
  if (waitingOn(t).length > 0 && at < stage.ends) {
    waitFrom(t, stage, at);
    return false;
  }
  // The turn is over: whoever let in has taken none gets one of what is left.
  for (const seat of waitingOn(t)) takeAny(t, stage, seat);
  if (stage.open >= stage.turns.length) return true;
  letIn(t, stage, at);
  return false;
}
