/** The cart stop on the page: its cart takes what it is handed, rolls under, and comes back empty. */
import { GOLD } from "@sequoia-leaf/kit/palette.ts";
import { must } from "@sequoia-leaf/kit/util.ts";

import type { KindPage } from "./kind.ts";

export const stop: KindPage = {
  picture: ({ m }) => must(m.stop[0], "stop").c,
  draw(art, _y, at) {
    const took = at.real ? (at.mem.puffAt[at.i] ?? 0) : 0;
    const since = took > 0 ? at.t - took : 9;
    const cart = since < 0 || since >= 0.5 ? 0 : since < 0.1 ? 1 : since < 0.22 ? 2 : since < 0.36 ? 3 : 4;
    const s = art.m.stop[cart];
    if (s) at.stand(s, at.cx, at.foot, at.z, at.a);
    return at.foot - 20;
  },
  map: [GOLD[1], GOLD[0]],
  spot: "stop",
  cart: true,
  dock: 10,
  // Its rules' line is of every sink; what it does is its own to say.
  standing: { said: () => "Items handed in here reach the depot at once." },
};
