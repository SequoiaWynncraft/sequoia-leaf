/** The bench: combines two different items into one. */
import { kind } from "./kind.ts";
import { MAKER } from "./maker.ts";

export const bench = kind({
  name: "bench",
  info: { name: "Bench", cost: 40, draw: 4, gives: 0, what: "Combines two different items into one." },
  graded: true,
  holds: true,
  rules: MAKER,
});
