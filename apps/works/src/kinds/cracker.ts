/**
 * The cracker on the page (tier 6): an iron drum over a brick firebox, two tiles by two
 * (`art/cracker.ts`), its fire lit while it makes, and a small grey puff from its stack for each thing
 * it makes, the sign of the smog it adds. Its card is a machine's: it can be told one of its two
 * recipes, and says what it makes a minute.
 */
import { isItem, kind, makes, RECIPE } from "@sequoia-leaf/factory";
import { lessMotion } from "@sequoia-leaf/kit/dom.ts";

import { crackerOf, PAD, stackTop, TALL } from "../art/cracker.ts";
import { IRON } from "../art/pal.ts";
import { puff } from "../fx.ts";
import type { KindPage } from "./kind.ts";
import { MACHINE } from "./machine.ts";

const CRACKER = kind("cracker");
/** Its iron, on the map and in a blueprint's picture. */
const IRONS = [IRON[4], IRON[2]] as const;

export const cracker: KindPage = {
  ...MACHINE,
  picture: (_p, n) => crackerOf(n, 0, 0),
  draw(_art, _y, at) {
    const lit = at.working ? (lessMotion() ? 1 : 1 + (Math.floor(at.t * 6) % 2)) : 0;
    at.put(crackerOf(at.grade, at.d, lit), at.x - PAD, at.top - PAD - TALL, at.z, at.a);
    // Each thing it makes lets go a puff of the smog it adds.
    if (at.real && at.working && isItem(at.making) && !lessMotion() && at.t > (at.mem.puffAt[at.i] ?? 0)) {
      const rate = makes(CRACKER, at.grade, RECIPE[at.making] ?? null);
      at.mem.puffAt[at.i] = at.t + 60 / Math.max(1, rate) / Math.max(0.1, at.pace);
      const [u, v] = stackTop(at.d);
      puff(at.x + u + at.seenX, at.top + v + at.seenY, 1, IRON[3], 6);
    }
    return at.top - TALL;
  },
  lamps: (_y, i, x, foot, at, out) => {
    if (at.working(i)) out.push({ x, y: foot - 5, r: 18, power: 0.6, reach: false });
  },
  map: IRONS,
  dot: IRONS[0],
  dock: 18,
};
