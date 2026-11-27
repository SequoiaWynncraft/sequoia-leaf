/** The pylon on the page: its lamps burn full, low and guttering, or out, by the yard's power; taller once pylons reach further. */
import { GOLD, WATER } from "@sequoia-leaf/kit/palette.ts";
import { must } from "@sequoia-leaf/kit/util.ts";

import type { KindPage } from "./kind.ts";

export const pylon: KindPage = {
  picture: ({ m }) => must(m.pylon[0]?.[2], "pylon").c,
  draw(art, y, at) {
    const tall = y.open.reach > 100;
    // Short of power the lamps burn low, and gutter.
    const dim = at.pace < 1 && Math.sin(at.t * 9 + at.i) > 0.86 - at.pace;
    const level = !at.powered ? 0 : at.pace < 1 ? (dim ? 0 : 1) : 2;
    const s = art.m.pylon[tall ? 1 : 0]?.[at.real ? level : 2];
    if (s) at.stand(s, at.cx, at.foot, at.z, at.a);
    return at.foot - (tall ? 34 : 26);
  },
  lamps: (_y, _i, x, foot, at, out) => {
    out.push({ x, y: foot - 8, r: at.reach, power: at.bright, reach: true });
    out.push({ x: x + 5, y: foot - (at.tall ? 24 : 16), r: 14, power: 0.5 * at.pace, reach: false });
  },
  mapLamp: GOLD[2],
  dot: WATER[3],
  dock: 12,
};
