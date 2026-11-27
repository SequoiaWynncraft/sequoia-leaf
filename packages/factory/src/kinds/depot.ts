/**
 * The depot: nine tiles of land in the yard's middle, never built, turned, moved or taken up. It takes
 * every item that reaches it, from any side; each counts towards an order that asks for it and pays 1%
 * of its worth. It makes power, as much as what is open says (`open.depot`).
 */
import { kind } from "./kind.ts";
import { everySide } from "./line.ts";
import { as } from "./say.ts";
import { always, anything, sell } from "./sink.ts";

export const depot = kind({
  name: "depot",
  info: {
    name: "Depot",
    cost: 0,
    draw: 0,
    gives: 20,
    what: "Takes every item that reaches it. Each item counts towards an order that asks for it, and also pays 1% of its worth.",
  },
  fixed: true,
  fast: true,
  rules: {
    sides: everySide,
    wants: anything,
    room: always,
    give: sell,
    condition: () => as("giving"),
    words: (_k, y) => ({ line: `Sells every item that reaches it. Makes ${y.open.depot} power.` }),
  },
});
