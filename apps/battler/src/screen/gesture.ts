/**
 * What the member's hand is doing, as one value, and what the table shows of it. The hand holds
 * nothing, or a thing tapped and waiting to be told where it goes, or a thing carried by one
 * pointer. Only that pointer moves it or lets it go: a second finger resting on the board and
 * lifted again does nothing to it. Each pointer's own press (`hand.ts`) becomes a carry once it has
 * moved far enough with something under it.
 *
 * Everything the table lights for the hand (where a figure may go and the rows it belongs in, who
 * would take an item and who wants it, the components it pairs with, the thing under the hand) is
 * worked out from the gesture and the run (`marksOf`).
 */
import {
  catalogOf,
  type FigureId,
  isComponentId,
  type ItemId,
  pieceAt,
  pieces,
  type RunView,
  type Spot,
  spotOf,
} from "@sequoia-leaf/raid";

import { handing, reachOf, reachOfOffer } from "./logic.ts";
import { type Aim, pairsOf, wanters } from "./making.ts";
import { zoneOf } from "./zone.ts";

/** A thing in the hand: one of the party's figures (by its number), an offer on the stall, an item on the rack. */
export type Held =
  | { what: "pawn"; id: number }
  | { what: "offer"; at: number; kind: FigureId }
  | { what: "item"; at: number; item: ItemId };

export type Gesture =
  | { at: "idle" }
  | { at: "picked"; held: Held }
  /**
   * Carried by one pointer: where it is, from the board's corner; the place under it; what an item
   * is over (a figure, or a component on the rack it pairs with); whether it is over the stall.
   */
  | {
      at: "dragging";
      pointer: number;
      held: Held;
      x: number;
      y: number;
      over: Spot | null;
      aim: Aim | null;
      shop: boolean;
    };

export const IDLE: Gesture = { at: "idle" };

export type HandEvent =
  /** A thing tapped: it waits to be told where it goes. */
  | { e: "pick"; held: Held }
  /** A pointer's press carried its thing off. While one thing is carried, no other is. */
  | { e: "carry"; pointer: number; held: Held; x: number; y: number }
  /** A pointer moved: the carried thing goes with its own pointer only. */
  | { e: "move"; pointer: number; x: number; y: number; over: Spot | null; aim: Aim | null; shop: boolean }
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
        : { at: "dragging", pointer: ev.pointer, held: ev.held, x: ev.x, y: ev.y, over: null, aim: null, shop: false };
    case "move":
      return g.at === "dragging" && g.pointer === ev.pointer
        ? { ...g, x: ev.x, y: ev.y, over: ev.over, aim: ev.aim, shop: ev.shop }
        : g;
    case "lift":
      return g.at === "dragging" && (ev.pointer === null || ev.pointer === g.pointer) ? IDLE : g;
    case "clear":
      return IDLE;
  }
}

/**
 * What a tap means while an item may be in the hand, on a place of the rack or on one of the
 * party's figures (`on`). The item in the hand is put down (tapped again), or aimed: at a figure, or
 * at a component it pairs with, and its tip then says what letting go would do, with the button
 * that does it. Anything else, the thing tapped is picked up.
 */
export function tapOf(g: Gesture, pairs: readonly number[], on: Aim): "down" | "aim" | "pick" {
  const item = g.at === "picked" && g.held.what === "item" ? g.held : null;
  if (!item) return "pick";
  if ("piece" in on) return "aim";
  if (on.rack === item.at) return "down";
  return pairs.includes(on.rack) ? "aim" : "pick";
}

/** What the table shows of the hand. */
export interface Marks {
  /** Free seats the figure in hand may go to, seats whose figure it would change places with, and bench hollows. */
  seats: number[];
  swaps: number[];
  slots: number[];
  /** The seats of the rows the figure in hand belongs in (`zone.ts`), lit softly whether it may go there or not. */
  zone: number[];
  /** The place under the hand. */
  target: Spot | null;
  /** The figure tapped and waiting to be told where to go, and the one carried; -1 for none. */
  picked: number;
  held: number;
  /** The place on the rack of the item in the hand; -1 for none. */
  item: number;
  /** Figures that would take the item in the hand, and the one it is aimed at; -1 for none. */
  takers: number[];
  taker: number;
  /** Places on the rack the item in the hand would forge with, and the one it is aimed at; -1 for none. */
  pairs: number[];
  pair: number;
  /** Fielded figures that want the item in the hand, or the one pointed at. */
  wanters: number[];
  /** Where the hand is, from the board's corner. */
  at: { x: number; y: number };
  /** Something carried that is not a figure of the party's yet: an offer from the stall, or an item. */
  ghost: { kind: FigureId } | { item: ItemId } | null;
  /** A component in the hand: figures holding its pair show what the two would make. */
  forging: ItemId | null;
}

/**
 * What the page says besides the gesture: what a tapped item is aimed at (the thing its pinned tip
 * is about), and the item pointed at with nothing in the hand.
 */
export interface Seen {
  aim: Aim | null;
  item: ItemId | null;
}
const UNSEEN: Seen = { aim: null, item: null };

const EMPTY: Marks = {
  seats: [],
  swaps: [],
  slots: [],
  zone: [],
  target: null,
  picked: -1,
  held: -1,
  item: -1,
  takers: [],
  taker: -1,
  pairs: [],
  pair: -1,
  wanters: [],
  at: { x: 0, y: 0 },
  ghost: null,
  forging: null,
};

/** An item in the hand: its place on the rack, and if it is a component, what figures holding its pair show. */
const itemMarks = (held: Extract<Held, { what: "item" }>): Marks => ({
  ...EMPTY,
  item: held.at,
  forging: isComponentId(held.item) ? held.item : null,
});

/** What the table shows of the thing in the hand, before the run is asked. */
function heldMarks(g: Gesture): Marks {
  if (g.at === "idle") return EMPTY;
  const held = g.held;
  if (g.at === "picked")
    return held.what === "item" ? itemMarks(held) : held.what === "pawn" ? { ...EMPTY, picked: held.id } : EMPTY;
  const at = { x: g.x, y: g.y };
  if (held.what === "pawn") return { ...EMPTY, at, held: held.id, target: g.over };
  if (held.what === "offer") return { ...EMPTY, at, ghost: { kind: held.kind }, target: g.over };
  return { ...itemMarks(held), at, ghost: { item: held.item } };
}

/** What an item in the hand is aimed at: carried, what it is over; tapped, what its tip is about. */
function aimMarks(g: Gesture, seen: Seen): Pick<Marks, "taker" | "pair"> | null {
  const aim = g.at === "dragging" ? g.aim : g.at === "picked" ? seen.aim : null;
  if (g.at === "idle" || g.held.what !== "item" || !aim) return null;
  return "piece" in aim ? { taker: aim.piece, pair: -1 } : { taker: -1, pair: aim.rack };
}

/** Where the thing in the hand may go: a figure's places, an offer's, or who would take an item and what it forges with. */
function reachMarks(held: Held, run: RunView): Partial<Marks> {
  if (held.what === "pawn") {
    const from = spotOf(run, held.id);
    const piece = from ? pieceAt(run, from) : null;
    if (!from || !piece) return {};
    const reach = reachOf(run, from);
    return {
      seats: reach.seats,
      swaps: reach.swaps,
      slots: [...reach.slots, ...reach.slotSwaps],
      zone: zoneOf(run, piece.kind),
    };
  }
  if (held.what === "offer") {
    const reach = reachOfOffer(run, held.at);
    return { seats: reach.seats, slots: reach.slots, zone: zoneOf(run, held.kind) };
  }
  const item = held.item;
  return {
    takers: pieces(run).flatMap((p) => (handing(catalogOf(run), p, item).can ? [p.id] : [])),
    pairs: pairsOf(run, held.at),
  };
}

/** The hand's marks on the table, worked out from the gesture, the run and what the page says besides. */
export function marksOf(g: Gesture, run: RunView | null, seen: Seen = UNSEEN): Marks {
  const held = g.at === "idle" ? null : g.held;
  // Who wants the item in the hand, or with nothing in it, the one pointed at.
  const wanted = held === null ? seen.item : held.what === "item" ? held.item : null;
  return {
    ...heldMarks(g),
    ...aimMarks(g, seen),
    ...(run && wanted ? { wanters: wanters(run, wanted).map((p) => p.id) } : {}),
    ...(run && held ? reachMarks(held, run) : {}),
  };
}
