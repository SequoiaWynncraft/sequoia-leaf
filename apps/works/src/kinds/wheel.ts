/** The waterwheel on the page: it hangs over whichever side the stream is on, and turns with spray where power reaches it. */
import type { Dir, Yard } from "@sequoia-leaf/factory";
import { DX, DY } from "@sequoia-leaf/factory";
import { WATER } from "@sequoia-leaf/kit/palette.ts";
import { clamp, must } from "@sequoia-leaf/kit/util.ts";

import { puff } from "../fx.ts";
import type { KindPage } from "./kind.ts";

/** Whether the stream is on one side of a tile. */
const wet = (y: Yard, i: number, side: Dir): boolean => y.land.water[i + DX[side] + DY[side] * y.land.w] === 1;
const first = <T>(list: readonly T[], i: number): T | undefined => list[clamp(Math.floor(i), 0, list.length - 1)];

export const wheel: KindPage = {
  picture: ({ m }) => must(m.wheel[0], "wheel").c,
  draw(art, y, at) {
    const { i, foot, cx, z, real, powered, t } = at;
    const lean = wet(y, i, 0) ? 5 : wet(y, i, 2) ? -5 : 0;
    const drop = wet(y, i, 1) ? 4 : wet(y, i, 3) ? -3 : 0;
    const s = first(art.m.wheel, powered && real ? Math.floor(t * 8) % 4 : 0);
    if (s) at.stand(s, cx + lean, foot + drop, z + (drop > 0 ? 3 : 0), at.a);
    if (real && powered && t > (at.mem.puffAt[i] ?? 0)) {
      at.mem.puffAt[i] = t + 0.3;
      puff(cx + lean + at.seenX, foot + drop - 1 + at.seenY, 1, "#93cfd0", 5);
    }
    return foot - 20;
  },
  map: [WATER[3], WATER[1]],
  dot: WATER[3],
  dock: 13,
};
