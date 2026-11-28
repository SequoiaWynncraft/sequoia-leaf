/**
 * The cards of the land itself: the stream and a redwood, where nothing can be built (a redwood on
 * the yard's own land can be felled), and a plot, with what lies in its ground and whether it is for
 * sale. A part of the yard's cards (`cards.ts`).
 */
import { type Item, type Plot, RISE_LINE } from "@sequoia-leaf/factory";
import { type Action, type Block, close, type Description, type Row } from "@sequoia-leaf/kit/card.ts";
import { amount, el, icon } from "@sequoia-leaf/kit/dom.ts";
import { coinsText, num, whole } from "@sequoia-leaf/kit/say.ts";

import { itemRef } from "./refs.ts";

/** A tile with nothing on it that has a card: the stream, or a redwood. */
export type GroundPrint =
  | {
      readonly card: "ground";
      readonly ground: "stream";
      /** Stepping stones cross it here, and it is walked over. */
      readonly ford: boolean;
    }
  | {
      readonly card: "ground";
      readonly ground: "redwood";
      /** Where the yard may fell it (on its own plot, not on a visit): the tile asked about, the price, and how many Coins short the purse is. */
      readonly fell: { readonly x: number; readonly y: number; readonly price: number; readonly short: number } | null;
      /** On its own plot, why it may not be felled yet: felling not studied. */
      readonly locked: string | null;
      /** From tier 5: the smog it clears from its plot while it stands. */
      readonly clears: string | null;
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
  /** Its clearing, for a plot past the first ring that is for sale and not the yard's: null for any other. */
  readonly clearing: ClearingPrint | null;
  /** From tier 5: the smog on a plot the yard owns, or what a plot not yet its would clear (`smog.ts`); null before. */
  readonly smog: string | null;
}

/** A plot's clearing as its card prints it (`clearing.ts`). */
export interface ClearingPrint {
  readonly state: "to clear" | "clearing" | "cleared";
  /** What it wants, in words: "600 lanterns and 900 pipes". */
  readonly words: string;
  /** Each thing it wants, how many have been delivered (while it is being cleared) and of how many. */
  readonly given: readonly (readonly [Item, number, number])[];
  /** The plot being cleared instead, by name, or null. */
  readonly other: string | null;
}

/** What a button that buys says once it has been pressed: the second press buys. */
export const AGAIN = "Press again to buy";

/** What the land's cards do: buy a plot, fell a redwood, and say why a button will not do what it says, with its sound. */
export interface LandHands {
  /** Buys a plot at the price its card shows. */
  buy(plot: Plot, price: number): boolean;
  /** Takes on a plot's clearing. */
  clear(plot: Plot): boolean;
  /** Fells a redwood at the price its card shows. */
  fell(x: number, y: number, price: number): boolean;
  refuse(why: string): void;
}

export function groundCard(p: GroundPrint, hands: Pick<LandHands, "fell" | "refuse">): Description {
  if (p.ground === "stream")
    return {
      name: p.ford ? "A ford" : "The stream",
      tag: `${p.ford ? "Stepping stones across the stream. " : ""}Nothing can be built on it. A waterwheel beside it makes power, and a tunnel can go under it.`,
    };
  const fell = p.fell;
  return {
    name: "Redwood",
    tag: "Nothing can be built on it. Belts go round it, or under it by tunnel.",
    blocks: [
      ...(p.clears === null ? [] : [{ body: p.clears }]),
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
                    if (hands.fell(fell.x, fell.y, fell.price)) close();
                  },
                }
              : { on: () => hands.refuse("Not enough Coins") }),
          },
        ]
      : [],
  };
}

/** A plot's Clear it, which takes its clearing on; drawn while another plot is being cleared, it says so and takes nothing on. */
const clearButton = (plot: Plot, other: string | null, hands: Pick<LandHands, "clear" | "refuse">): Action => ({
  label: "Clear it",
  look: other === null ? "sm wide" : "sm wide off",
  on: () => (other === null ? void hands.clear(plot) : hands.refuse(`You are clearing ${other} already`)),
});

/** What a plot's clearing says on its card: what it wants before it is taken on, or that it is being cleared. */
function clearingBlocks(c: ClearingPrint | null): Block[] {
  if (c?.state === "to clear")
    return [{ body: `Clear it: ${c.words}, delivered to the depot. Then it can be bought.` }];
  if (c?.state === "clearing") return [{ body: "Being cleared. Hand it over in Orders once everything is delivered." }];
  return [];
}

/** What has been delivered to a plot being cleared, each thing of how many: a row of its card. */
const deliveredRow = (c: ClearingPrint | null): Row[] =>
  c?.state === "clearing"
    ? [
        {
          label: "Delivered",
          things: c.given.map(([k, have, of]) => ({ ref: itemRef(k), note: `${num(have)} of ${num(of)}` })),
        },
      ]
    : [];

/** A plot's chip beside its name: the yard's, or cleared and waiting to be bought. */
function plotAside(p: PlotPrint): { aside?: HTMLElement } {
  if (p.state === "owned") return { aside: el("span", "k-chip lit", {}, icon("check"), "Yours") };
  return p.clearing?.state === "cleared" ? { aside: el("span", "k-chip lit", {}, icon("check"), "Cleared") } : {};
}

/** A plot's Buy, at its price: drawn with enough Coins it asks to be pressed again; drawn short it says why. */
function buyButton(p: PlotPrint, hands: Pick<LandHands, "buy" | "refuse">): Action {
  const enough = p.short === 0;
  return {
    label: `Buy for ${whole(p.price)}`,
    look: enough ? "sm wide" : "sm wide off",
    icon: icon("coin"),
    ...(enough
      ? {
          ask: { again: AGAIN, price: p.price },
          on: () => {
            // Bought, the card has nothing more to offer: it is put away, so it does not sit over the new land.
            if (hands.buy(p.plot, p.price)) close();
          },
        }
      : { on: () => hands.refuse("Not enough Coins") }),
  };
}

/**
 * What a plot's card says: the stream through it, why it is not for sale yet, its clearing, and its
 * price where it has no Buy (beside its name, a price of land squeezes a long name onto more lines on
 * a phone), how it rises, and how many Coins short the purse is.
 */
function plotBlocks(p: PlotPrint, buys: boolean): Block[] {
  return [
    ...(p.bank ? [{ body: "The stream runs through it. A waterwheel must be beside the stream." }] : []),
    ...(p.state === "not yet" ? [{ body: `${p.not ?? "Not for sale yet"}.` }] : []),
    ...clearingBlocks(p.clearing),
    ...(p.smog === null ? [] : [{ body: p.smog }]),
    ...(p.state !== "owned" && !buys ? [{ body: `It costs ${coinsText(p.price)}.` }] : []),
    ...(p.rises ? [{ body: RISE_LINE }] : []),
    ...(p.state === "for sale" && p.short > 0 ? [{ body: `You need ${coinsText(p.short)} more.` }] : []),
  ];
}

/**
 * A plot's card. A plot past the first ring is cleared first: its Clear it takes its clearing on, and
 * only once it is cleared is it bought. Its Buy, drawn with enough Coins, asks to be pressed again and
 * buys; drawn short, it buys nothing whatever comes in while it is pressed, and says why.
 */
export function plotCard(p: PlotPrint, hands: Pick<LandHands, "buy" | "clear" | "refuse">): Description {
  const c = p.clearing;
  const open = p.state === "for sale" && !p.visiting;
  const buys = open && (c === null || c.state === "cleared");
  const ground: Row = {
    label: "In the ground",
    things: p.ground.map(([raw, tiles]) => ({ ref: itemRef(raw), note: `${tiles} tiles` })),
  };
  const clears = open && c?.state === "to clear" ? [clearButton(p.plot, c.other, hands)] : [];
  return {
    name: p.name,
    icon: icon("star"),
    tag: p.why,
    ...plotAside(p),
    blocks: plotBlocks(p, buys),
    rows: [...deliveredRow(c), ground],
    actions: buys ? [buyButton(p, hands)] : clears,
  };
}
