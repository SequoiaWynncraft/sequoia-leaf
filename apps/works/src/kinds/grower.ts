/**
 * The grower on the page (tier 7): a dark round bed under a low glass dome over three tiles by three
 * (`art/grower.ts`), with a lilac point inside for each star crystal it holds, up to four, and none
 * when it holds none, so a starved grower is an empty dome from across the yard; its one small lilac
 * light lit while it grows. What it holds is read once, by the rules' `growthAt`, for its picture as
 * for its status. On the map it is dark lilac, its middle lit while it holds star crystals.
 *
 * Its card says, a minute, what it gives out, what it takes (star crystals back into it, and feed),
 * and what is net, from its runs as the rules' `rateOf` gives them; and standing, what it took in and
 * gave out in the yard's last minute, as the page counted it (`grown.ts`).
 */
import { GROW_OF, grownPerRun, growPerMinute, growthAt, kind } from "@sequoia-leaf/factory";
import type { Block, Row, Stat } from "@sequoia-leaf/kit/card.ts";
import { perMinute } from "@sequoia-leaf/kit/say.ts";

import { growerIcon, growerOf, PAD, TALL } from "../art/grower.ts";
import { LILAC } from "../art/pal.ts";
import type { StandingPrint } from "../ui/cards.ts";
import { itemRef } from "../ui/refs.ts";
import type { KindPage } from "./kind.ts";

const GROWER = kind("grower");
const GROW = GROW_OF[GROWER];
/** What it grows a run, on the whole: 3 for every 2 runs. */
const PER_RUN = grownPerRun(GROWER);

/** Its net a minute, from its runs a minute, as its card's pace. */
const net = (runs: number): Stat => ({ label: "Grows, net", value: perMinute(runs * (PER_RUN - 1)) });

/** Its rows a minute, from its runs a minute: what it gives out, what it takes (star crystals back into it, and feed), and what is net. */
function grows(runs: number): Row[] {
  if (!GROW) return [];
  return [
    { label: "Gives out", things: [{ ref: itemRef(GROW.gives), note: perMinute(runs * PER_RUN) }] },
    { label: "Takes", things: GROW.takes.map((n) => ({ ref: itemRef(n), note: perMinute(runs) })) },
    { label: "Net", things: [{ ref: itemRef(GROW.gives), note: perMinute(runs * (PER_RUN - 1)) }] },
  ];
}

/** "3 star crystals", "1 star crystal". */
const crystals = (n: number): string => `${n} star crystal${n === 1 ? "" : "s"}`;

/** What it took in and gave out in the yard's last minute, as the page counted it; nothing until it has counted a second. */
function lastMinute(p: StandingPrint): Block[] {
  const c = p.counted;
  if (!c || c.seconds < 1) return [];
  const over = c.seconds >= 60 ? "the last minute" : `the last ${c.seconds} second${c.seconds === 1 ? "" : "s"}`;
  return [{ body: `In ${over} it took in ${crystals(c.took)} and gave out ${c.gave}.` }];
}

export const grower: KindPage = {
  picture: (_p, n) => growerIcon(n),
  draw(_art, y, at) {
    // A point for each star crystal it holds, up to four, as the rules read it; one not built yet shows none.
    const points = at.real ? Math.min(4, growthAt(y, at.i).crystals) : 0;
    at.put(growerOf(at.grade, at.d, points, at.real && at.working), at.x - PAD, at.top - PAD - TALL, at.z, at.a);
    // Its trouble is marked over its dome.
    return at.top + 4;
  },
  lamps: (_y, i, x, foot, at, out) => {
    // Its one small light, on the front of its bed: a pool no wider than the light.
    if (at.working(i)) out.push({ x, y: foot - 8, r: 3, power: 0.45, reach: false });
  },
  pointer: "bare",
  pace: (k, grade) => net(growPerMinute(k, grade)),
  rows: (p) => grows(growPerMinute(GROWER, p.grade)),
  standing: { rows: (p) => grows(p.rate ?? 0), pace: (p) => net(p.rate ?? 0), blocks: lastMinute },
  holdsUp: () => GROW?.holds ?? 4,
  map: [LILAC[2], LILAC[1]],
  mapMid: { colour: LILAC[4], lit: (y, i) => growthAt(y, i).crystals > 0 },
  dot: LILAC[3],
  dock: 20,
  faces: true,
};
