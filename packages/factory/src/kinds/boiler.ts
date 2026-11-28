/** The boiler: makes a lot of power where power reaches it, but only while it has deadfall to burn, a piece every 20 ticks. */
import { FUEL, TICKS } from "../content/machines.ts";
import { BURNER } from "./burner.ts";
import { kind } from "./kind.ts";

export const boiler = kind({
  name: "boiler",
  info: {
    name: "Boiler",
    cost: 90,
    draw: 0,
    gives: 30,
    what: "Makes a lot of power, but only while it has deadfall to burn.",
  },
  holds: true,
  burns: { fuels: [{ fuel: "deadfall", ticks: TICKS.burn }], holds: FUEL },
  rules: BURNER,
});
