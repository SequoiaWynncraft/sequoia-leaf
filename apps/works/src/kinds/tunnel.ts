/** The tunnel on the page: a hood at each mouth over its belt, the way-in mouth facing in and the far mouth out. */
import { BACK } from "@sequoia-leaf/factory";
import { STONE } from "@sequoia-leaf/kit/palette.ts";
import { makeCanvas, must } from "@sequoia-leaf/kit/util.ts";

import { arms, beltTile, withArm, woodOf } from "../art/belts.ts";
import { lookOf } from "../art/machines.ts";
import { carries } from "./carrier.ts";
import type { Hold, KindPage } from "./kind.ts";

/** What the dock says with the tunnel in hand: where to click (or tap) first, then where next; for a finger with the way out aimed, how to build it. */
function says(h: Hold): string {
  if (!h.from)
    return h.finger
      ? "Tunnel: tap where it goes in."
      : `Tunnel: click where it goes in, then where it comes up.${h.turns}`;
  if (h.finger) return h.away ? "Tap again, or Build." : "Now tap where it comes up.";
  return `Now click where it comes up.${h.turns}`;
}

export const tunnel: KindPage = {
  picture: ({ m }, grade) => {
    const hood = must(m.hood[lookOf(grade)]?.[0], "hood");
    const { c, g } = makeCanvas(18, 20);
    g.drawImage(beltTile(arms(0, 0, 1, 0), 0, 5, woodOf(grade)), 1, 3);
    g.drawImage(hood.c, 0, 0);
    return c;
  },
  draw(art, _y, at) {
    const s = art.m.hood[at.look]?.[at.span > 0 ? at.d : BACK[at.d]];
    if (s) at.stand(s, at.cx, at.foot + 1, at.z - 2, at.a);
    return at.foot - 16;
  },
  arms: (y, i) => ((y.span[i] ?? 0) > 0 ? withArm(0, BACK[(y.dir[i] ?? 0) & 3] ?? 2, 1) : withArm(0, y.dir[i] ?? 0, 2)),
  aimArms: (d) => withArm(0, BACK[d], 1),
  far: (art, grade, d) => art.m.hood[lookOf(grade)]?.[BACK[d]],
  mapMark: STONE[3],
  dock: 3,
  line: 3,
  pace: carries,
  says,
};
