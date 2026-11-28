/**
 * The charger on the page (tier 8): a dark round cradle over two tiles by two with a cell standing in
 * it and a ring of three pips on its lid (`art/charger.ts`). The pips show the bars of the charged cell
 * it holds ready, so they drop with it on each beat; while it charges they fill; and for half a second
 * after each beat they are all out, on every charger at once, so the beat can be seen across the yard.
 * Its one small teal light is lit while it charges. On the map it is dark lilac.
 *
 * Its card says what it charges a minute, as the rules' `rateOf` gives it standing, and how long until
 * every charged cell loses a bar.
 */
import { CHARGED, isItem, kind, makes, outsAs, secondsTo } from "@sequoia-leaf/factory";
import type { Block, Row, Stat } from "@sequoia-leaf/kit/card.ts";
import { perMinute } from "@sequoia-leaf/kit/say.ts";

import { chargerIcon, chargerOf, PAD, TALL } from "../art/charger.ts";
import { LILAC } from "../art/pal.ts";
import type { StandingPrint } from "../ui/cards.ts";
import { itemRef } from "../ui/refs.ts";
import type { Drawn, KindPage } from "./kind.ts";

const CHARGER = kind("charger");
/** Ticks after a beat its pips are all out for. */
const DARK = 5;

/** Its way out, facing `d`: the tile of its box it leaves from, from its own tile, and the way things leave. */
function outOf(d: number): readonly [number, number, number] {
  const o = outsAs(CHARGER, d)[0];
  return o ? [o.dx, o.dy, o.way] : [1, 0, d];
}

/** How many of its pips are lit: none just after a beat; the bars of the cell it holds ready; filling while it charges; else none. */
export function pipsOf(tick: number, at: Pick<Drawn, "out" | "working" | "work">): number {
  if (tick % CHARGED.beat < DARK) return 0;
  const bars = isItem(at.out) ? CHARGED.bars.indexOf(at.out) + 1 : -1;
  if (bars >= 0) return bars;
  return at.working ? Math.min(3, Math.floor((at.work / CHARGED.work) * 4)) : 0;
}

/** What it charges a minute, from what. */
const charges = (n: number): Stat => ({ label: "Charges", value: perMinute(n) });
const takes = (): Row[] => [
  { label: "Charges", things: CHARGED.takes.map((n) => ({ ref: itemRef(n) })) },
  { label: "Gives", things: [{ ref: itemRef(CHARGED.gives) }] },
];

/** How long until every charged cell loses a bar, as its card says it. */
const nextBeat = (p: StandingPrint): Block[] =>
  p.launch ? [{ body: `Every charged cell loses a bar in ${secondsTo(p.launch.toBeat)}.` }] : [];

export const charger: KindPage = {
  picture: (_p, n) => chargerIcon(n),
  draw(_art, y, at) {
    const lit = at.real ? pipsOf(y.tick, at) : 3;
    at.put(chargerOf(at.grade, outOf(at.d), lit, at.real && at.working), at.x - PAD, at.top - PAD - TALL, at.z, at.a);
    return at.top - 2;
  },
  lamps: (_y, i, x, foot, at, out) => {
    // Its one small light on the front of its base: a pool no wider than the light.
    if (at.working(i)) out.push({ x: x + 10, y: foot - 9, r: 2, power: 0.4, reach: false });
  },
  pointer: "bare",
  pace: (k, grade) => charges(makes(k, grade, null)),
  rows: takes,
  standing: { pace: (p) => charges(p.rate ?? 0), blocks: nextBeat },
  holdsUp: () => CHARGED.holds,
  map: [LILAC[2], LILAC[1]],
  dot: LILAC[3],
  dock: 21,
  faces: true,
};
