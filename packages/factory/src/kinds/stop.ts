/** The cart stop: takes items in from any side, and each has reached the depot at once. A yard may stand as many as it has unlocked. */
import { kind } from "./kind.ts";
import { everySide } from "./line.ts";
import { as } from "./say.ts";
import { always, anything, sell } from "./sink.ts";

export const stop = kind({
  name: "stop",
  info: {
    name: "Cart stop",
    cost: 150,
    draw: 0,
    gives: 0,
    what: "Takes items in from any side. Each counts as having reached the depot.",
  },
  most: "stops",
  owns: ["stops"],
  rules: {
    sides: everySide,
    wants: anything,
    room: always,
    give: sell,
    condition: () => as("giving"),
    words: () => ({ line: "Sends every item that reaches it to the depot." }),
  },
});
