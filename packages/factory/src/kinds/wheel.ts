/** The waterwheel: makes steady power, standing beside the stream where power reaches it. */
import { kind, type KindInfo } from "./kind.ts";
import { as, UNLINKED } from "./say.ts";

const INFO: KindInfo = {
  name: "Waterwheel",
  cost: 60,
  draw: 0,
  gives: 10,
  what: "Makes steady power. It must stand beside the stream.",
};

export const wheel = kind({
  name: "wheel",
  info: INFO,
  rules: {
    steady: (k, y, i) => (k.besideWater(y.land, i) ? INFO.gives * k.HALF : 0),
    refusal: (k, y, i) => (k.besideWater(y.land, i) ? null : "A waterwheel must be beside the stream"),
    condition: (_k, _y, _i, lit) => (lit ? as("giving") : as("unpowered", true)),
    words: (_k, _y, _i, state) => ({ line: state === "giving" ? `Running. Makes ${INFO.gives} power.` : UNLINKED }),
  },
});
