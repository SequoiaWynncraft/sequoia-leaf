/**
 * The breaker, two tiles by two (tier 5): it takes salvage in on the six tile-sides of its back and
 * sides and breaks it into copper, ingots, glass, slag and gears, 8, 5, 3, 3 and 1 of every 20, in the
 * order of its mix (`content/mixes.ts`), one at a time out of the left tile of its front. It holds one
 * finished thing and breaks nothing more until that has left, so whatever stops one stops all five.
 * Each it breaks adds 1 to the smog on its plot.
 */
import { kind } from "./kind.ts";
import { MIXER } from "./mix.ts";
import { backAndSides, front } from "./ports.ts";

export const breaker = kind({
  name: "breaker",
  info: {
    name: "Breaker",
    cost: 2000,
    draw: 20,
    gives: 0,
    smog: 1,
    what: "Breaks salvage into copper, ingots, glass, slag and gears: 8, 5, 3, 3 and 1 of every 20. They leave one at a time, mixed. It stops while the next one cannot leave.",
  },
  graded: true,
  holds: true,
  size: [2, 2],
  ports: { in: backAndSides(2, 2), out: [{ at: front(2, 0), sends: "out" }] },
  rules: MIXER,
});
