/** The boiler on the page: cold, or burning with smoke and a glow while it has deadfall. */
import { burned, DEADFALL, FUEL, holderOf } from "@sequoia-leaf/factory";
import { WATER } from "@sequoia-leaf/kit/palette.ts";
import { perMinute } from "@sequoia-leaf/kit/say.ts";
import { clamp, hash, must } from "@sequoia-leaf/kit/util.ts";

import { CLAY } from "../art/pal.ts";
import { smoke } from "../fx.ts";
import { itemRef } from "../ui/refs.ts";
import type { KindPage } from "./kind.ts";

const first = <T>(list: readonly T[], i: number): T | undefined => list[clamp(Math.floor(i), 0, list.length - 1)];

export const boiler: KindPage = {
  picture: ({ m }) => must(m.boiler[1], "boiler").c,
  draw(art, y, at) {
    const { i, foot, cx, z, t } = at;
    const burning = at.real && at.powered && at.r >= 0 && (y.holders.fuel[at.r] ?? 0) > 0;
    const s = first(art.m.boiler, burning ? 1 + (Math.floor(t * 7) % 2) : at.ghost > 0 ? 1 : 0);
    if (s) at.stand(s, cx, foot, z, at.a);
    if (burning && t > (at.mem.puffAt[i] ?? 0)) {
      at.mem.puffAt[i] = t + 0.3 + hash(i, Math.floor(t * 3), 5) * 0.3;
      smoke(cx + 5 + at.seenX, foot - 24 + at.seenY, "#cdb6d8");
    }
    return foot - 23;
  },
  lamps: (y, i, x, foot, _at, out) => {
    const r = holderOf(y, i);
    if (r >= 0 && (y.holders.fuel[r] ?? 0) > 0) out.push({ x: x - 2, y: foot - 4, r: 24, power: 0.85, reach: false });
  },
  map: [CLAY[1], CLAY[0]],
  dot: WATER[3],
  dock: 14,
  pace: () => ({ label: "Burns", value: perMinute(burned()) }),
  rows: () => [{ label: "Burns", things: [{ ref: itemRef(DEADFALL) }] }],
  holdsUp: () => FUEL,
};
