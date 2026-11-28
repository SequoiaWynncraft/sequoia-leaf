/**
 * The yard's postcard for the town (`Game.postcard`), which Leaf keeps with the yard: what is
 * waiting in the yard, in a line for the card on its door, the whole Coins in its till, and from its
 * first launch the light it has put in the town's sky (`sky`). Leaf
 * runs the yard on while its owner is away, so the till is what it has earned since they last
 * collected, as of Leaf's last run of it.
 */
import type { Postcard } from "@sequoia-leaf/core";

import { NODES } from "./content/nodes.ts";
import { isFilled } from "./orders.ts";
import { GOALS, isNode, item, MILLI } from "./tables.ts";
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
  const sky = skyWon(y);
  return { waiting, till: Math.max(0, Math.floor(y.till / MILLI)), ...(sky.length > 0 ? { sky } : {}) };
}

/** What a finished node leaves in the town's sky, which the town draws for the yard's own member: the first launch's light. */
export const SKY_GIFTS: readonly string[] = ["sky-beacon"];

/** The lights in the town's sky the yard's finished nodes have left, by their gifts' ids. */
export const skyWon = (y: Yard): string[] =>
  y.done.flatMap((g) => {
    const id = isNode(g) ? NODES[g]?.gift?.id : undefined;
    return id && SKY_GIFTS.includes(id) ? [id] : [];
  });
