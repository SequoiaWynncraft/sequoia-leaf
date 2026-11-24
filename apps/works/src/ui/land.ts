/**
 * The cards of the land itself: the stream and a redwood, where nothing can be built, and a plot,
 * with what lies in its ground and whether it is for sale. A part of the yard's cards (`cards.ts`).
 */
import type { Item, Plot } from "@sequoia-leaf/factory";
import { type Block, close, type Description } from "@sequoia-leaf/kit/card.ts";
import { amount, el, icon } from "@sequoia-leaf/kit/dom.ts";

import { itemRef } from "./refs.ts";

/** A tile with nothing on it that has a card: the stream, or a redwood. */
export interface GroundPrint {
  readonly card: "ground";
  readonly ground: "stream" | "redwood";
}

export interface PlotPrint {
  readonly card: "plot";
  readonly plot: Plot;
  readonly name: string;
  readonly why: string;
  readonly price: number;
  readonly state: "owned" | "for sale" | "not yet";
  readonly not: string | null;
  /** The stream runs through it. */
  readonly bank: boolean;
  /** What lies in its ground: each thing, and how many tiles. */
  readonly ground: readonly (readonly [Item, number])[];
  /** How many Coins more than there are it costs, or 0. */
  readonly short: number;
  readonly visiting: boolean;
}

export const groundCard = (p: GroundPrint): Description =>
  p.ground === "stream"
    ? {
        name: "The stream",
        tag: "Nothing can be built on it. A waterwheel beside it makes power, and a tunnel can go under it.",
      }
    : { name: "A redwood", tag: "Nothing can be built on it. Belts go round it, or under it by tunnel." };

/** What a button that buys says once it has been pressed: the second press buys. */
const AGAIN = "Press again to buy";

export function plotCard(p: PlotPrint, buy: (plot: Plot) => boolean): Description {
  const enough = p.short === 0;
  const blocks: Block[] = [
    ...(p.bank ? [{ body: "The stream runs through it. A waterwheel must be beside the stream." }] : []),
    ...(p.state === "not yet" ? [{ body: `${p.not ?? "Not for sale yet"}.` }] : []),
    ...(p.state === "for sale" && !enough ? [{ body: `You need ${p.short.toLocaleString("en-US")} more Coins.` }] : []),
  ];
  return {
    name: p.name,
    icon: icon("star"),
    tag: p.why,
    aside:
      p.state === "owned"
        ? el("span", "k-chip lit", {}, icon("check"), "Yours")
        : amount("coin", p.price.toLocaleString("en-US")),
    blocks,
    rows: [
      {
        label: "In the ground",
        things: p.ground.map(([raw, tiles]) => ({ ref: itemRef(raw), note: `${tiles} tiles` })),
      },
    ],
    actions:
      p.state === "for sale" && !p.visiting
        ? [
            {
              label: `Buy for ${p.price.toLocaleString("en-US")}`,
              look: enough ? "sm wide" : "sm wide off",
              icon: icon("coin"),
              ...(enough ? { ask: AGAIN } : {}),
              on: () => {
                // Bought, the card has nothing more to offer: it is put away, so it does not sit over the new land.
                if (buy(p.plot)) close();
              },
            },
          ]
        : [],
  };
}
