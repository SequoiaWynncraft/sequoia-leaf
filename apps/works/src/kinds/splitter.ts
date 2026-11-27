/**
 * The splitter on the page: flat with the floor, an arrowhead on each way out that leads somewhere, a
 * bar on each shut way, a vane pointing the way its next thing goes while it is empty, and a flag on
 * the way it puts first.
 */
import { BACK, type Dir, LEFT, RIGHT, toward, type Yard } from "@sequoia-leaf/factory";
import { GOLD } from "@sequoia-leaf/kit/palette.ts";

import { armAt, type Arms, arms, withArm } from "../art/belts.ts";
import { FLAG_AT } from "../art/machines.ts";
import { meeting } from "../art/meeting.ts";
import { dirAt } from "../tiles.ts";
import { carries, feeds } from "./carrier.ts";
import type { KindPage } from "./kind.ts";

/** The side of its tile its way put first leaves by, or null for none. */
function firstSide(y: Yard, i: number): Dir | null {
  const d = dirAt(y, i);
  const way = y.first[i] ?? 0;
  return way === 1 ? d : way === 2 ? LEFT[d] : way === 3 ? RIGHT[d] : null;
}

/** The way it sends its next thing: the first, from the one whose turn it is, that leads somewhere. */
function sendWay(y: Yard, i: number, a: Arms): Dir {
  const d = dirAt(y, i);
  // The way put first, when it leads somewhere: where things go while it takes them.
  const out = firstSide(y, i);
  if (out !== null && armAt(a, out) === 2) return out;
  for (let k = 0; k < 3; k++) {
    // Its next way out is under its next way in (the rules' `kinds/splitter.ts`).
    const turn = (((y.turn[i] ?? 0) & 3) + k) % 3;
    const side = turn === 0 ? d : turn === 1 ? LEFT[d] : RIGHT[d];
    if (armAt(a, side) === 2) return side;
  }
  return d;
}

/**
 * Its arms: its ways out ahead, left and right, and behind coming in. A shut way wears its bar, and a
 * way in is drawn as behind is, coming in. Of the rest, only the ways out that something takes things
 * from; one nothing takes from shows every way that is open.
 */
function splitterArms(y: Yard, i: number): Arms {
  const d = (y.dir[i] ?? 0) & 3;
  const ways = [d, LEFT[d] ?? 3, RIGHT[d] ?? 1];
  let a = withArm(0, BACK[d] ?? 2, 1);
  const shut = y.shut[i] ?? 0;
  const ins = y.ins[i] ?? 0;
  ways.forEach((side, n) => {
    if ((shut >> n) & 1) a = withArm(a, side, 3);
    else if ((ins >> n) & 1) a = withArm(a, side, 1);
  });
  const open = ways.filter((side) => armAt(a, side) === 0);
  const led = open.filter((side) => feeds(y, i, toward(y.land, i, side)));
  for (const side of led.length > 0 ? led : open) a = withArm(a, side, 2);
  return a;
}

export const splitter: KindPage = {
  picture: ({ m }, grade) => meeting(m, arms(2, 2, 1, 2), m.splitter[0], grade),
  // It lies flat with the floor; the way it puts first wears a flag, standing in that way's arrowhead.
  draw(art, y, at) {
    const side = firstSide(y, at.i);
    if (side === null) return null;
    const [fx, fy] = FLAG_AT[side];
    const s = art.m.pennant[side];
    if (s) at.stand(s, at.x + fx, at.top + fy, at.top + fy + (at.z - at.foot), at.a);
    return null;
  },
  top: (art, _y, _i, d) => art.m.splitter[d],
  // An arrowhead on each way out that leads somewhere.
  laid: (art, _y, _i, d, a, lay) =>
    [d, LEFT[d], RIGHT[d]].forEach((side, n) => {
      if (armAt(a, side) === 2) lay(art.m.heads[n]?.[d]);
    }),
  vane: (art, y, i, a) => art.m.vane[sendWay(y, i, a)],
  arms: splitterArms,
  aimArms: (d) => withArm(arms(2, 2, 2, 2), BACK[d], 1),
  rides: (y, i, a) => sendWay(y, i, a),
  mapMark: GOLD[2],
  dock: 1,
  line: 1,
  pace: carries,
  faces: true,
};
