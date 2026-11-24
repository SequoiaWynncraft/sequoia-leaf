/**
 * What a game tells the town about itself while nobody is in it: the kit's `postcard.ts` leaves it
 * and reads it back, and each game's rules write their own.
 */
export interface Postcard {
  /** What is waiting there, in a line, for the card on the game's door. */
  readonly waiting: string;
  /** Coins earned there and not yet collected. */
  readonly till: number;
}
