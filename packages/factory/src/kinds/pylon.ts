/** The pylon: spreads power to the tiles around it, once it is within reach of the depot or of another pylon that is. */
import { REACH } from "../content/machines.ts";
import { kind } from "./kind.ts";
import { as } from "./say.ts";

export const pylon = kind({
  name: "pylon",
  info: {
    name: "Pylon",
    cost: 6,
    draw: 0,
    gives: 0,
    what: "Spreads power to the tiles around it. Needs the depot or another pylon within reach.",
  },
  reaches: true,
  rules: {
    condition: (_k, _y, _i, lit) => (lit ? as("giving") : as("unpowered", true)),
    words: (_k, y, _i, state) => ({
      line:
        state === "giving"
          ? `Powers the tiles up to ${Math.floor((REACH.pylon * y.open.reach) / 10_000)} tiles from it.`
          : "Not connected. It must be within reach of the depot or of a connected pylon.",
    }),
  },
});
