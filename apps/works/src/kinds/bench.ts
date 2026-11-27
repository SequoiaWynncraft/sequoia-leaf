/** The bench on the page: a hammer that comes down twice a recipe, with a spark as it strikes. */
import { NONE, RECIPE } from "@sequoia-leaf/factory";
import { BARK, CREAM, GOLD, PAPER } from "@sequoia-leaf/kit/palette.ts";
import { clamp, must } from "@sequoia-leaf/kit/util.ts";

import { lookOf } from "../art/machines.ts";
import { burst } from "../fx.ts";
import type { KindPage } from "./kind.ts";
import { MACHINE } from "./machine.ts";

const first = <T>(list: readonly T[], i: number): T | undefined => list[clamp(Math.floor(i), 0, list.length - 1)];

export const bench: KindPage = {
  ...MACHINE,
  picture: ({ m }, grade) => must(m.bench[lookOf(grade)]?.[0], "bench").c,
  draw(art, _y, at) {
    const { i, foot, cx, z, a, working } = at;
    const p = at.making !== NONE ? at.work / (RECIPE[at.making]?.work ?? 40) : 0;
    const beat = (p * 2) % 1;
    const step = !working ? 0 : beat < 0.55 ? 0 : beat < 0.75 ? 1 : 2;
    const s = first(art.m.bench[at.look] ?? [], step);
    if (!s) return foot - 16;
    at.stand(s, cx, foot, z, a);
    if (at.real) {
      if (step === 2 && at.mem.struck[i] !== 1) burst(cx - 2 + at.seenX, foot - 9 + at.seenY, 3, [GOLD[2], CREAM], 22);
      at.mem.struck[i] = step === 2 ? 1 : 0;
    }
    return foot - 16;
  },
  map: [PAPER[0], BARK[3]],
  dot: GOLD[1],
  dock: 6,
};
