/**
 * The assembler on the page: a crafting hall drawn once over its nine tiles (`art/assembler.ts`), its
 * doors open on a hammer at work and its glass lit cream while it makes, shut and dark at rest. Its
 * card is a machine's: it can be told one thing to make, and says what it makes a minute.
 */
import { BARK, CREAM, PAPER } from "@sequoia-leaf/kit/palette.ts";

import { hallOf } from "../art/assembler.ts";
import { CLAY } from "../art/pal.ts";
import { burst } from "../fx.ts";
import type { KindPage } from "./kind.ts";
import { MACHINE } from "./machine.ts";

/** The hammer's beat, in steps a second: it comes down on every fourth. */
const BEAT = 6;

export const assembler: KindPage = {
  ...MACHINE,
  picture: (_p, grade) => hallOf(1, Math.max(1, grade), false, 0).c,
  draw(_art, _y, at) {
    const { i, cx, foot, z, a, working } = at;
    const step = working ? Math.floor(at.t * BEAT) % 4 : 0;
    at.stand(hallOf(at.d, Math.max(1, at.grade), working, step), cx, foot, z, a);
    if (at.real) {
      // A spark off the bench inside the doors as the hammer strikes.
      if (working && step === 2 && at.mem.struck[i] !== 1) burst(cx + at.seenX, foot - 12 + at.seenY, 2, [CREAM], 14);
      at.mem.struck[i] = step === 2 ? 1 : 0;
    }
    return foot - 56;
  },
  lamps: (_y, i, x, foot, at, out) => {
    if (at.working(i)) out.push({ x, y: foot - 12, r: 26, power: 0.6, reach: false });
  },
  map: [CLAY[0], BARK[1]],
  dot: PAPER[1],
  dock: 15,
};
