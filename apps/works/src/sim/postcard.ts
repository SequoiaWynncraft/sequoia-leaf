/**
 * The postcard the Works leaves for the town (the kit's `postcard.ts`): what is waiting in the yard,
 * in a line for the card on its door; the capstones it has ever made, for models in the member's
 * camp; and the Coins in its till.
 */

import type { Postcard } from "@sequoia-leaf/kit/postcard.ts";

import { isFilled, storyOrder } from "./orders.ts";
import type { World } from "./world.ts";

/** The two things that take the whole yard, by the names the town knows them by. */
const CAPSTONES = ["crab", "beacon"] as const;

export function postcard(w: World): Postcard {
  const filled = w.board.filter((o) => isFilled(o.want, o.filled)).length;
  const story = storyOrder(w);
  const waiting =
    filled > 0
      ? `${filled === 1 ? "An order is" : `${filled} orders are`} filled and waiting at the gate.`
      : story
        ? `The yard is working on ${story.title.charAt(0).toLowerCase()}${story.title.slice(1)}.`
        : w.board.length > 0
          ? `${w.board.length} order${w.board.length === 1 ? " is" : "s are"} on the board.`
          : "The yard is quiet. Somebody should start it up.";
  return {
    waiting,
    trophies: CAPSTONES.filter((k) => (w.depot[k] ?? 0) > 0),
    till: Math.max(0, Math.floor(w.till)),
  };
}
