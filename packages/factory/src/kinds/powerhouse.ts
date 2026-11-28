/**
 * The powerhouse, two tiles by two (tier 6): a burner, as a boiler is, with three fuels. It takes
 * pitch, creosote and spirit on all eight tile-sides, up to 8 of each, and burns the heaviest it holds
 * first: a piece of pitch for 10 ticks, creosote for 15, spirit for 20, giving 300 power while one
 * burns. Each piece it takes adds smog to its plot: 4 for pitch, 2 for creosote, 1 for spirit.
 */
import { BURNER } from "./burner.ts";
import { kind } from "./kind.ts";
import { around } from "./ports.ts";

export const powerhouse = kind({
  name: "powerhouse",
  info: {
    name: "Powerhouse",
    cost: 5000,
    draw: 0,
    gives: 300,
    what: "Makes 300 power while it burns pitch, creosote or spirit. It burns the heaviest it holds first. Pitch makes the most smog.",
  },
  holds: true,
  size: [2, 2],
  ports: { in: around(2, 2), out: [] },
  burns: {
    fuels: [
      { fuel: "pitch", ticks: 10, smog: 4 },
      { fuel: "creosote", ticks: 15, smog: 2 },
      { fuel: "spirit", ticks: 20, smog: 1 },
    ],
    holds: 8,
  },
  rules: BURNER,
});
