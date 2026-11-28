/**
 * The depot: a piece of three tiles by three in the yard's middle, set down with the yard, never built,
 * turned, moved or taken up. It takes every item that reaches it, on every side; each counts towards an
 * order that asks for it and pays 1% of its worth. It makes power, as much as what is open says
 * (`open.depot`).
 */
import { kind } from "./kind.ts";
import { around } from "./ports.ts";
import { as } from "./say.ts";
import { always, sell, sold } from "./sink.ts";

export const depot = kind({
  name: "depot",
  info: {
    name: "Depot",
    cost: 0,
    draw: 0,
    gives: 20,
    what: "Takes every item that reaches it but slag. Each item counts towards an order that asks for it, and also pays 1% of its worth.",
  },
  fixed: true,
  fast: true,
  size: [3, 3],
  ports: { in: around(3, 3), out: [] },
  sinks: true,
  rules: {
    wants: sold,
    room: always,
    give: sell,
    condition: () => as("giving"),
    words: (_k, y) => ({ line: `Sells every item that reaches it. Makes ${y.open.depot} power.` }),
  },
});
