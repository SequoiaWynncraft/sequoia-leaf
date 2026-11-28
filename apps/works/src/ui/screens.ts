/**
 * The page's one measure of a screen: whether a card at its own width (220 units, 440 pixels) fits
 * beside the yard. Below 660 pixels wide it would take more than two thirds of the width, so the page
 * takes the phone's layout: a card is a sheet across the bottom and a panel a sheet over the tools.
 * At 660 and over (a tablet, a folding phone opened, a desktop) a card stands at its own width beside
 * what it is about. A screen at most 500 pixels tall is a phone on its side, whatever its width.
 *
 * `index.html` says the same in its `@media` rules, which cannot read this file; `screens.test.ts`
 * holds them to these.
 */

/** A screen too narrow for a card beside the yard: an upright phone, a folding phone closed. */
export const PHONE = "(max-width: 659px)";
/** A phone on its side. */
export const SIDEWAYS = "(max-height: 500px)";
/** Either: where a finger's card is a sheet and the yard's sheet fills the screen. */
export const SMALL = `${PHONE}, ${SIDEWAYS}`;
