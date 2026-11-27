/** The workshop on the page: its door shut while it rests, open and busy while it works, with a lamp lit inside. */
import { GOLD, SKY } from "@sequoia-leaf/kit/palette.ts";
import { must } from "@sequoia-leaf/kit/util.ts";

import { lookOf } from "../art/machines.ts";
import type { KindPage } from "./kind.ts";
import { MACHINE } from "./machine.ts";

export const workshop: KindPage = {
  ...MACHINE,
  picture: ({ m }, grade) => must(m.workshop[lookOf(grade)]?.[1]?.[0], "workshop").c,
  draw(art, _y, at) {
    const { foot, working } = at;
    const s = art.m.workshop[at.look]?.[working || !at.real ? 1 : 0]?.[working ? Math.floor(at.t * 6) % 2 : 0];
    if (!s) return foot - 16;
    at.stand(s, at.cx, foot, at.z, at.a);
    return foot - 25;
  },
  lamps: (_y, i, x, foot, at, out) => {
    if (at.working(i)) out.push({ x: x - 3, y: foot - 10, r: 18, power: 0.7, reach: false });
  },
  map: [SKY[3], SKY[1]],
  dot: GOLD[1],
  dock: 7,
};
