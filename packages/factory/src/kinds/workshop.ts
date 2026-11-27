/** The workshop: combines three different items into one. */
import { kind } from "./kind.ts";
import { MAKER } from "./maker.ts";

export const workshop = kind({
  name: "workshop",
  info: { name: "Workshop", cost: 120, draw: 8, gives: 0, what: "Combines three different items into one." },
  graded: true,
  holds: true,
  rules: MAKER,
});
