/** The Study on the page: its lamp out where power does not reach; lit, its book shut until there is a folio to read, and a page turned for each. */
import { makes, WORK } from "@sequoia-leaf/factory";
import { CREAM, GOLD, PAPER } from "@sequoia-leaf/kit/palette.ts";
import { perMinute } from "@sequoia-leaf/kit/say.ts";
import { must } from "@sequoia-leaf/kit/util.ts";

import { lookOf } from "../art/machines.ts";
import type { KindPage } from "./kind.ts";

export const study: KindPage = {
  picture: ({ m }, grade) => must(m.study[lookOf(grade)]?.[2], "study").c,
  draw(art, _y, at) {
    const p = at.work / WORK.study;
    const state = !at.powered ? 0 : !at.working ? (at.real ? 1 : 2) : p < 0.6 ? 2 : p < 0.8 ? 3 : 4;
    const s = art.m.study[at.look]?.[state];
    if (!s) return at.foot - 16;
    at.stand(s, at.cx, at.foot, at.z, at.a);
    return at.foot - 24;
  },
  lamps: (_y, _i, x, foot, _at, out) => out.push({ x: x - 4, y: foot - 13, r: 15, power: 0.6, reach: false }),
  map: [CREAM, PAPER[0]],
  spot: "study",
  dot: GOLD[1],
  dock: 8,
  pace: (k, grade) => ({ label: "Takes in", value: perMinute(makes(k, grade, null)) }),
  standing: {
    more: (_art, p, hands) => (p.research ? [{ label: "Research", on: () => hands.panel("research") }] : []),
  },
};
