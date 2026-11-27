/** The sorter on the page: a board over its belt that shows what it sends to its side, and an arrowhead on that side; flat with the floor. */
import { BACK, type Dir, LEFT, NONE, type Piece, RIGHT, SORTER, sortWay, type Yard } from "@sequoia-leaf/factory";
import { GOLD } from "@sequoia-leaf/kit/palette.ts";

import { arms, withArm } from "../art/belts.ts";
import { meeting } from "../art/meeting.ts";
import { dirAt } from "../tiles.ts";
import { sorterActions, sorterRows } from "../ui/sorter.ts";
import { carries, straight } from "./carrier.ts";
import type { KindPage } from "./kind.ts";

/** Whether the piece on a tile is a sorter that sends the thing it is set to to its right. */
export const sendsRight = (y: Yard, i: number): boolean => y.kind[i] === SORTER && sortWay(y, i) === 2;
/** Whether a piece, as kept or in hand, is a sorter that sends the thing it is set to to its right. */
export const keepsRight = (p: Piece): boolean => p.kind === SORTER && p.first === 2;
/** The side of its tile a sorter sends the thing it is set to out by: its left, or its right. */
export const sortSide = (y: Yard, i: number): Dir => (sendsRight(y, i) ? RIGHT : LEFT)[dirAt(y, i)];

export const sorter: KindPage = {
  picture: ({ m, sorter: tops }, grade, carrying) => meeting(m, arms(2, 0, 1, 2), tops(0, carrying), grade),
  top: (art, y, i, d, right) =>
    y === null ? art.sorter(d, NONE, right) : art.sorter(d, y.set[i] ?? NONE, sendsRight(y, i)),
  // It takes in from behind and sends ahead, and the one thing it is set to, to its side.
  arms: (y, i) => {
    const d = (y.dir[i] ?? 0) & 3;
    return withArm(withArm(withArm(0, BACK[d] ?? 2, 1), d, 2), sortSide(y, i), 2);
  },
  aimArms: (d, right) => withArm(straight(d), (right ? RIGHT : LEFT)[d], 2),
  sends: (y, i, n) => (n === y.set[i] ? sortSide(y, i) : dirAt(y, i)),
  rides: (y, i, _a, n) => (n === y.set[i] ? sortSide(y, i) : dirAt(y, i)),
  mapMark: GOLD[2],
  sorts: true,
  dock: 9,
  pace: carries,
  faces: true,
  flips: true,
  standing: {
    rows: sorterRows,
    actions: (art, p, hands) => sorterActions(art, p, (item) => hands.act({ do: "sort", x: p.x, y: p.y, item })),
    // Its rules' line is of every belt; what it does is its own to say.
    said: (p) => (p.set !== null ? "Everything else goes ahead." : "With nothing set it is a belt."),
  },
};
