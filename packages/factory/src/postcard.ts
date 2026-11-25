/**
 * The yard's postcard for the town (`Game.postcard`), which Leaf keeps with the yard: what is
 * waiting in the yard, in a line for the card on its door, and the whole Coins in its till. Leaf
 * runs the yard on while its owner is away, so the till is what it has earned since they last
 * collected, as of Leaf's last run of it.
 */
import type { Postcard } from "@sequoia-leaf/core";

import { isFilled } from "./orders.ts";
import { GOALS, item, MILLI } from "./tables.ts";
import type { Yard } from "./yard.ts";

/** The two things that take the whole yard, by the names the town knows them by. */
export const CAPSTONES = ["crab", "beacon"] as const;

/** The capstones the depot has ever taken in, for models in the member's camp (`Game.awards`). */
export const capstonesMade = (y: Yard) => CAPSTONES.filter((k) => (y.depot[item(k)] ?? 0) > 0);

export function postcard(y: Yard): Postcard {
  const filled = y.board.filter((o) => isFilled(o.want, o.filled)).length;
  const hand = y.hand === -1 ? undefined : GOALS[y.hand];
  const waiting =
    filled > 0
      ? `${filled === 1 ? "An order is" : `${filled} orders are`} filled and waiting at the gate.`
      : hand
        ? `The yard is working on ${hand.title.charAt(0).toLowerCase()}${hand.title.slice(1)}.`
        : y.board.length > 0
          ? `${y.board.length} order${y.board.length === 1 ? " is" : "s are"} on the board.`
          : "The yard is quiet. Somebody should start it up.";
  return { waiting, till: Math.max(0, Math.floor(y.till / MILLI)) };
}
