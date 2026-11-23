/**
 * What the member's hand is doing, as one value, and what the table shows of it. The hand holds
 * nothing, or a thing tapped and waiting to be told where it goes, or a thing carried by one
 * pointer. Only that pointer moves it or lets it go: a second finger resting on the board and
 * lifted again does nothing to it. Each pointer's own press (`hand.ts`) becomes a carry once it has
 * moved far enough with something under it.
 *
 * Everything the table lights for the hand (where a figure may go, who would take an item, the
 * thing under the hand) is worked out from the gesture and the run (`marksOf`).
 */
import { type FigureId, isComponentId, type ItemId, pieces, type RunView, type Spot, spotOf } from "@sequoia-leaf/raid";

import { handing, reachOf, reachOfOffer } from "./logic.ts";

/** A thing in the hand: one of the party's figures (by its number), an offer on the stall, an item on the rack. */
export type Held =
  | { what: "pawn"; id: number }
  | { what: "offer"; at: number; kind: FigureId }
  | { what: "item"; at: number; item: ItemId };

export type Gesture =
  | { at: "idle" }
  | { at: "picked"; held: Held }
  /**
   * Carried by one pointer: where it is, from the board's corner; the place under it; the figure an
   * item is over, if it could take it (-1 for none); whether it is over the stall.
   */
  | {
      at: "dragging";
      pointer: number;
      held: Held;
      x: number;
      y: number;
      over: Spot | null;
      taker: number;
      shop: boolean;
    };

export const IDLE: Gesture = { at: "idle" };

export type HandEvent =
  /** A thing tapped: it waits to be told where it goes. */
  | { e: "pick"; held: Held }
  /** A pointer's press carried its thing off. While one thing is carried, no other is. */
  | { e: "carry"; pointer: number; held: Held; x: number; y: number }
  /** A pointer moved: the carried thing goes with its own pointer only. */
  | { e: "move"; pointer: number; x: number; y: number; over: Spot | null; taker: number; shop: boolean }
  /** A pointer let go, or was called off (none named: every one). */
  | { e: "lift"; pointer: number | null }
  /** Whatever is in the hand is put down. */
  | { e: "clear" };

/** Moves the hand on. What one pointer does leaves another pointer's carry as it is. */
export function handStep(g: Gesture, ev: HandEvent): Gesture {
  switch (ev.e) {
    case "pick":
      return { at: "picked", held: ev.held };
    case "carry":
      return g.at === "dragging"
        ? g
        : { at: "dragging", pointer: ev.pointer, held: ev.held, x: ev.x, y: ev.y, over: null, taker: -1, shop: false };
    case "move":
      return g.at === "dragging" && g.pointer === ev.pointer
        ? { ...g, x: ev.x, y: ev.y, over: ev.over, taker: ev.taker, shop: ev.shop }
        : g;
    case "lift":
      return g.at === "dragging" && (ev.pointer === null || ev.pointer === g.pointer) ? IDLE : g;
    case "clear":
      return IDLE;
  }
}

/** What the table shows of the hand. */
export interface Marks {
  /** Free seats the figure in hand may go to, seats whose figure it would change places with, and bench hollows. */
  seats: number[];
  swaps: number[];
  slots: number[];
  /** The place under the hand. */
  target: Spot | null;
  /** The figure tapped and waiting to be told where to go, and the one carried; -1 for none. */
  picked: number;
  held: number;
  /** Figures that would take the item in the hand, and the one it is over. */
  takers: number[];
  taker: number;
  /** Where the hand is, from the board's corner. */
  at: { x: number; y: number };
  /** Something carried that is not a figure of the party's yet: an offer from the stall, or an item. */
  ghost: { kind: FigureId } | { item: ItemId } | null;
  /** A component in the hand: figures holding its pair show what the two would make. */
  forging: ItemId | null;
}

/** The hand's marks on the table, worked out from the gesture and the run. */
export function marksOf(g: Gesture, run: RunView | null): Marks {
  const held = g.at === "idle" ? null : g.held;
  const carried = g.at === "dragging" ? g : null;
  const marks: Marks = {
    seats: [],
    swaps: [],
    slots: [],
    target: carried && carried.held.what !== "item" ? carried.over : null,
    picked: g.at === "picked" && g.held.what === "pawn" ? g.held.id : -1,
    held: carried?.held.what === "pawn" ? carried.held.id : -1,
    takers: [],
    taker: carried?.held.what === "item" ? carried.taker : -1,
    at: carried ? { x: carried.x, y: carried.y } : { x: 0, y: 0 },
    ghost:
      carried?.held.what === "offer"
        ? { kind: carried.held.kind }
        : carried?.held.what === "item"
          ? { item: carried.held.item }
          : null,
    forging: held?.what === "item" && isComponentId(held.item) ? held.item : null,
  };
  if (!run || !held) return marks;
  if (held.what === "pawn") {
    const from = spotOf(run, held.id);
    if (!from) return marks;
    const reach = reachOf(run, from);
    return { ...marks, seats: reach.seats, swaps: reach.swaps, slots: [...reach.slots, ...reach.slotSwaps] };
  }
  if (held.what === "offer") {
    const reach = reachOfOffer(run, held.at);
    return { ...marks, seats: reach.seats, slots: reach.slots };
  }
  const item = held.item;
  return { ...marks, takers: pieces(run).flatMap((p) => (handing(p, item).can ? [p.id] : [])) };
}
