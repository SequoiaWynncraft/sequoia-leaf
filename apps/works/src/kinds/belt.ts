import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

/** The belt on the page: a bare length of belt, drawn flat with the floor; the dock's first slot. */
import { arms, beltTile, marksOf, woodOf } from "../art/belts.ts";
import { bare } from "../art/meeting.ts";
import { beltArms, carries, straight } from "./carrier.ts";
import type { KindPage } from "./kind.ts";

export const belt: KindPage = {
  // A belt is known by what rides on it: a plank, unless it is pictured carrying something of its own.
  // At the first grade its button has lighter slats than the yard's.
  picture: ({ item }, grade, carrying) => {
    const { c, g } = makeCanvas(16, 16);
    g.drawImage(grade >= 2 ? beltTile(arms(2, 0, 1, 0), 0, 5, woodOf(grade), 0, marksOf(grade)) : bare(), 0, 0);
    const on = item(carrying);
    g.drawImage(on, 8 - (on.width >> 1), 7 - (on.height >> 1));
    return c;
  },
  arms: (y, i) => beltArms(y, i, false),
  aimArms: straight,
  dock: 0,
  line: 0,
  pace: carries,
  faces: true,
  says: (h) =>
    h.finger
      ? h.from
        ? "Now tap where it ends."
        : "Tap where the line starts."
      : `Belt: drag to place a line.${h.turns}`,
};
