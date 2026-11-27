/**
 * Somebody summoned turning up on the table, never a pop: a bit of the Glorp comes off it and
 * hops to its hex; a grooter the Commodore called runs in from his own table edge (`call.ts`); a
 * Hatchling comes out of an egg Clutch rolls onto its hex, and the halves stay there
 * (`litter.ts`); anyone else turns up where the rules put them, in a puff of their colour.
 */
import { CREAM, GREEN } from "@sequoia-leaf/kit/palette.ts";
import type { Catalog, FightEvent } from "@sequoia-leaf/raid";

import { colourOf, feetAt, FV, travel } from "./board.ts";
import { arrive } from "./call.ts";
import { burst, say } from "./fx.ts";
import type { Pt } from "./geometry.ts";
import { leave } from "./litter.ts";
import { arcOf } from "./marks.ts";
import { type Actor, actorFor } from "./motion.ts";
import { snd } from "./sounds.ts";

const UP = -Math.PI / 2;
/** Steps Clutch's egg takes to roll to where it hatches. */
const ROLL = 5;

/** Somebody summoned turns up, by whoever summoned them, at the step `at`. */
export function turnsUp(cat: Catalog, ev: Extract<FightEvent, { t: "summon" }>, at: number): void {
  const u = FV.pb?.fight.units[ev.id];
  if (!u) return;
  const from = FV.actors[ev.by];
  const spot = feetAt(ev.cell);
  let a = FV.actors[ev.id];
  if (!a) {
    a = actorFor(u, from ? { x: from.x, y: from.y } : spot, at);
    FV.actors[ev.id] = a;
  }
  a.bornAt = at;
  if (arrive(a, from, spot, at)) return snd.summon();
  if (from && ev.kind === "hatchling") return hatched(a, from, spot, at);
  // A bit of somebody comes off them; anyone else just turns up.
  if (from && ev.kind === "glorplet") {
    a.x = from.x;
    a.y = from.y;
    travel(a, spot, at, 5, 8);
    a.landAt = at + 5;
  } else {
    a.x = spot.x;
    a.y = spot.y;
    a.move = null;
  }
  burst(spot.x, spot.y - 4, 10, [colourOf(cat, ev.kind), CREAM], { speed: 28, ttl: 0.4 });
  if (ev.kind === "uncounted" || ev.kind === "biguncounted")
    say(spot.x, spot.y - 16, "Nobody counted this one.", CREAM, { ttl: 1.3 });
  snd.summon();
}

/** An egg rolls out of the nest to the spot, cracks, and the Hatchling stands up out of it; the halves stay. */
function hatched(a: Actor, nest: Actor, spot: Pt, at: number): void {
  a.x = spot.x;
  a.y = spot.y;
  a.move = null;
  a.bornAt = at + ROLL;
  a.landAt = at + ROLL;
  FV.shots.push({
    from: { x: nest.x, y: nest.y - 10 },
    to: { x: spot.x, y: spot.y - 3 },
    target: -1,
    t0: at,
    dur: ROLL,
    arc: arcOf("egg", 0),
    look: "egg",
    col: CREAM,
    trail: false,
    land: () => {
      leave("halves", spot);
      burst(spot.x, spot.y - 4, 8, [CREAM, "#f8e6bd", GREEN[3]], { speed: 26, toward: UP, spread: 1.8, ttl: 0.35 });
    },
  });
  snd.summon();
}
