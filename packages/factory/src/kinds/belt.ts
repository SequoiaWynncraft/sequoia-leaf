/** The belt: carries one thing a tile at a time the way it points, taking things in from behind and from both sides. */
import { kind } from "./kind.ts";
import {
  aheadOf,
  allButAhead,
  anything,
  carrierCondition,
  carrierWords,
  carryOn,
  empty,
  lay,
  readyAhead,
} from "./line.ts";

export const belt = kind({
  name: "belt",
  info: {
    name: "Belt",
    cost: 1,
    draw: 0,
    gives: 0,
    what: "Moves items one tile at a time, the way it points. Belts can feed each other from the side.",
  },
  graded: true,
  starters: 12,
  carries: true,
  tint: "line",
  perTile: true,
  rules: {
    sides: allButAhead,
    next: aheadOf,
    wants: anything,
    room: empty,
    give: lay,
    hands: carryOn,
    ready: readyAhead,
    condition: carrierCondition,
    words: carrierWords,
  },
});
