/**
 * Ace's cards between what Leaf says and what is drawn, reading nothing of the page: what a thrown
 * thing keeps as it flies (a card's suit only when Leaf named one), and where a card lands (on
 * whoever it is for, where they stand as it lands). The drawing is handed in (`CARD_DRAWN`).
 */
import { STONE } from "@sequoia-leaf/kit/palette.ts";
import type { FightEvent, Suit } from "@sequoia-leaf/raid";

import type { Pt } from "./geometry.ts";

/** What of how it was thrown a thing keeps as it flies (`Shot` in `marks.ts`): its colour, its trail, what it does as it lands, and a card's suit. */
export interface Flying {
  col: string;
  trail: boolean;
  land: (() => void) | null;
  card?: Suit;
}
export const flying = (o: Partial<Flying>): Flying => ({
  col: o.col ?? STONE[3],
  trail: o.trail ?? false,
  land: o.land ?? null,
  ...(o.card && { card: o.card }),
});

/** Where a figure stands, and how tall it is. */
export type Stands = Pt & { readonly tall: number };
/** How a card's landing is drawn on whoever it lands on: its pip coming off them, and a Full Deck's card stuck in their hex. */
export interface CardDrawn {
  readonly pip: (suit: Suit, on: Stands) => void;
  readonly stick: (suit: Suit, on: Stands) => void;
}

/**
 * What is seen where a shot lands (`mark`), and for one of Ace's cards its suit as it flies: as it
 * lands, its pip comes off whoever it is for, where they stand then (`where`), and a Full Deck's
 * card sticks in their hex.
 */
export function dealing(
  ev: Extract<FightEvent, { t: "shot" }>,
  where: () => Stands | null,
  mark: (() => void) | null,
  drawn: CardDrawn,
): Pick<Flying, "land" | "card"> {
  const suit = ev.card;
  if (!suit) return { land: mark };
  const land = (): void => {
    mark?.();
    const on = where();
    if (!on) return;
    drawn.pip(suit, on);
    if (ev.what === "ability") drawn.stick(suit, on);
  };
  return { land, card: suit };
}
