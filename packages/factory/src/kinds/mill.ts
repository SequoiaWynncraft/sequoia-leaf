/** The mill: turns one item into another. What it makes depends on what it is fed. */
import { kind } from "./kind.ts";
import { MAKER } from "./maker.ts";

export const mill = kind({
  name: "mill",
  info: {
    name: "Mill",
    cost: 20,
    draw: 3,
    gives: 0,
    what: "Turns one item into another. What it makes depends on what you feed it.",
  },
  graded: true,
  starters: 1,
  holds: true,
  rules: MAKER,
});
