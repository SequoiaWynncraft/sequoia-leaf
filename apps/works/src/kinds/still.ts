/**
 * The still on the page (tier 6): a copper pot on a brick hearth over three tiles by three, its column
 * behind and a tap on each tile of its front (`art/still.ts`). While it distils the fire is lit, the
 * taps drip and each thing it gives lets go a small grey puff from the column's top, the sign of the
 * smog it makes. Stopped because a thing cannot leave, that thing's tap is plugged and the fire dims.
 * Its card shows its mix of 6, the next picked out, and what each way out sends a minute.
 */
import { isItem, kind, MIX_OF, mixPerMinute, outsAs } from "@sequoia-leaf/factory";
import { lessMotion } from "@sequoia-leaf/kit/dom.ts";

import { IRON } from "../art/pal.ts";
import { columnTop, PAD, stillIcon, stillOf, TALL } from "../art/still.ts";
import { puff } from "../fx.ts";
import type { KindPage } from "./kind.ts";
import { mixPace, mixRows } from "./mix.ts";

const STILL = kind("still");
const DISTILS = mixPace("Distils");
/** Its copper, on the map and in a blueprint's picture. */
const COPPER = ["#b86a4a", "#7a3f2e"] as const;

export const still: KindPage = {
  picture: (_p, n) => stillIcon(n),
  draw(_art, _y, at) {
    // Stopped with a thing finished, the tap it leaves by is plugged.
    const plug =
      at.real && !at.working && isItem(at.out) ? outsAs(STILL, at.d).findIndex((o) => o.only === at.out) : -1;
    // Its fire: lit while it distils, flickering; dimmed while a thing cannot leave; out at rest.
    const fire = at.working ? 2 + (lessMotion() ? 0 : Math.floor(at.t * 6) % 2) : plug >= 0 ? 1 : 0;
    const drop = at.working && !lessMotion() ? Math.floor(at.t * 5) % 4 : 0;
    at.put(stillOf(at.grade, at.d, plug, fire, drop), at.x - PAD, at.top - PAD - TALL, at.z, at.a);
    // Each thing it gives lets go a puff of the smog it makes, from the top of its column.
    if (at.real && at.working && !lessMotion() && at.t > (at.mem.puffAt[at.i] ?? 0)) {
      at.mem.puffAt[at.i] = at.t + 60 / Math.max(1, mixPerMinute(STILL, at.grade)) / Math.max(0.1, at.pace);
      const [u, v] = columnTop(at.d);
      puff(at.x + u + at.seenX, at.top + v + at.seenY, 1, IRON[3], 6);
    }
    // Its trouble is marked over its pot, inside its own box: its column reaches into the tiles behind it.
    return at.top + 16;
  },
  lamps: (_y, i, x, foot, at, out) => {
    if (at.working(i)) out.push({ x, y: foot - 6, r: 22, power: 0.7, reach: false });
  },
  pointer: "bare",
  pace: DISTILS.kind,
  rows: (p) => mixRows(STILL, null, mixPerMinute(STILL, p.grade)),
  standing: { rows: (p) => mixRows(STILL, p.mix, p.rate ?? 0), pace: DISTILS.now },
  holdsUp: () => MIX_OF[STILL]?.holds ?? 8,
  map: COPPER,
  dot: COPPER[0],
  dock: 17,
  faces: true,
};
