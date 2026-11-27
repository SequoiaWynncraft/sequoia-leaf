/**
 * The cards of the land itself: the stream and a redwood, where nothing can be built (a redwood on
 * the yard's own land can be felled), and a plot, with what lies in its ground and whether it is for
 * sale. A part of the yard's cards (`cards.ts`).
 */
import { type Item, type Plot, RISE_LINE } from "@sequoia-leaf/factory";
import { type Block, close, type Description } from "@sequoia-leaf/kit/card.ts";
import { amount, el, icon } from "@sequoia-leaf/kit/dom.ts";
import { coinsText, whole } from "@sequoia-leaf/kit/say.ts";

import { itemRef } from "./refs.ts";

/** A tile with nothing on it that has a card: the stream, or a redwood. */
export type GroundPrint =
  | { readonly card: "ground"; readonly ground: "stream" }
  | {
      readonly card: "ground";
      readonly ground: "redwood";
      /** Where the yard may fell it (on its own plot, not on a visit): the tile asked about, the price, and how many Coins short the purse is. */
      readonly fell: { readonly x: number; readonly y: number; readonly price: number; readonly short: number } | null;
      /** On its own plot, why it may not be felled yet: felling not studied. */
      readonly locked: string | null;
    };

export interface PlotPrint {
  readonly card: "plot";
  readonly plot: Plot;
  readonly name: string;
  readonly why: string;
  /** What it costs the yard now. */
  readonly price: number;
  /** It is for sale and rises in price: each plot of its kind bought makes it dearer. */
  readonly rises: boolean;
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

/** What a button that buys says once it has been pressed: the second press buys. */
export const AGAIN = "Press again to buy";

/** What the land's cards do: buy a plot, fell a redwood, and say why a button will not do what it says, with its sound. */
export interface LandHands {
  buy(plot: Plot): boolean;
  fell(x: number, y: number): boolean;
  refuse(why: string): void;
}

export function groundCard(p: GroundPrint, hands: Pick<LandHands, "fell" | "refuse">): Description {
  if (p.ground === "stream")
    return {
      name: "The stream",
      tag: "Nothing can be built on it. A waterwheel beside it makes power, and a tunnel can go under it.",
    };
  const fell = p.fell;
  return {
    name: "Redwood",
    tag: "Nothing can be built on it. Belts go round it, or under it by tunnel.",
    blocks: [
      ...(p.locked === null ? [] : [{ body: `${p.locked}.` }]),
      ...(fell && fell.short > 0 ? [{ body: `You need ${coinsText(fell.short)} more.` }] : []),
    ],
    actions: fell
      ? [
          {
            label: "Fell",
            look: fell.short === 0 ? "sm wide" : "sm wide off",
            after: amount("coin", fell.price),
            ...(fell.short === 0
              ? {
                  ask: { again: "Press again to fell", price: fell.price },
                  on: () => {
                    // Felled, there is nothing for the card to be about: it is put away.
                    if (hands.fell(fell.x, fell.y)) close();
                  },
                }
              : { on: () => hands.refuse("Not enough Coins") }),
          },
        ]
      : [],
  };
}

/**
 * A plot's card. Its Buy, drawn with enough Coins, asks to be pressed again and buys; drawn short,
 * it buys nothing whatever comes in while it is pressed, and says why.
 */
export function plotCard(p: PlotPrint, hands: Pick<LandHands, "buy" | "refuse">): Description {
  const enough = p.short === 0;
  const buys = p.state === "for sale" && !p.visiting;
  // Its price is on its Buy, or said where there is none: beside its name, a price of land squeezes a
  // long name onto more lines on a phone.
  const blocks: Block[] = [
    ...(p.bank ? [{ body: "The stream runs through it. A waterwheel must be beside the stream." }] : []),
    ...(p.state === "not yet" ? [{ body: `${p.not ?? "Not for sale yet"}.` }] : []),
    ...(p.state !== "owned" && !buys ? [{ body: `It costs ${coinsText(p.price)}.` }] : []),
    ...(p.rises ? [{ body: RISE_LINE }] : []),
    ...(p.state === "for sale" && !enough ? [{ body: `You need ${coinsText(p.short)} more.` }] : []),
  ];
  return {
    name: p.name,
    icon: icon("star"),
    tag: p.why,
    ...(p.state === "owned" ? { aside: el("span", "k-chip lit", {}, icon("check"), "Yours") } : {}),
    blocks,
    rows: [
      {
        label: "In the ground",
        things: p.ground.map(([raw, tiles]) => ({ ref: itemRef(raw), note: `${tiles} tiles` })),
      },
    ],
    actions: buys
      ? [
          {
            label: `Buy for ${whole(p.price)}`,
            look: enough ? "sm wide" : "sm wide off",
            icon: icon("coin"),
            ...(enough
              ? {
                  ask: { again: AGAIN, price: p.price },
                  on: () => {
                    // Bought, the card has nothing more to offer: it is put away, so it does not sit over the new land.
                    if (hands.buy(p.plot)) close();
                  },
                }
              : { on: () => hands.refuse("Not enough Coins") }),
          },
        ]
      : [],
  };
}
