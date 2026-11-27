/**
 * What the kinds that carry share on the page (a belt, a joiner, a tunnel mouth, a splitter, a
 * sorter): which belts are drawn as joined, a belt's arms as it stands and in hand, and what a card
 * says each carries a minute.
 */
import {
  BACK,
  carried,
  type Dir,
  LEFT,
  nextOf,
  NONE,
  outsOf,
  pieceOf,
  portTo,
  RIGHT,
  RULES,
  takes,
  toward,
  wayOut,
  waysOf,
  type Yard,
} from "@sequoia-leaf/factory";
import type { Stat } from "@sequoia-leaf/kit/card.ts";
import { perMinute } from "@sequoia-leaf/kit/say.ts";

import { type Arms, withArm } from "../art/belts.ts";

/** Whether the piece on `from` hands things to the tile `to`, as the belts are drawn: what hands nothing on hands to nothing. */
export function feeds(y: Yard, from: number, to: number): boolean {
  if (from < 0 || to < 0) return false;
  const k = y.kind[from] ?? NONE;
  if ((RULES[k]?.hands ?? null) === null) return false;
  // A piece of more than one tile feeds the tile ahead of each of its ways out, from the tile that way
  // leaves by, as its kind's ports say; but one that hands back into it, as two belts facing each other.
  const own = pieceOf(y, from);
  const outs = y.part[from] === 0 ? [] : outsOf(y, own);
  if (outs.length > 0)
    return (
      outs.some((o, p) => own + o.dx + o.dy * y.land.w === from && portTo(y, own, p) === to) && nextOf(y, to) !== from
    );
  // A splitter or sorter feeds whatever on one of its ways out takes things from it.
  const ways = waysOf(k);
  if (ways > 0) {
    for (let w = 0; w < ways; w++) if (wayOut(y, from, w) === to) return takes(y, to, from);
    return false;
  }
  // Two belts facing each other pass nothing, and are not drawn as joined.
  return nextOf(y, from) === to && nextOf(y, to) !== from;
}

/**
 * A belt's arms, or a joiner's: out ahead, and in from each side something feeds it from. One nothing
 * feeds is drawn as a straight piece; with `all`, a joiner, it shows all three of its ways in.
 */
export function beltArms(y: Yard, i: number, all: boolean): Arms {
  const d = y.dir[i] ?? 0;
  const back = BACK[d & 3] ?? 2;
  const left = LEFT[d & 3] ?? 3;
  const right = RIGHT[d & 3] ?? 1;
  let a = withArm(0, d, 2);
  let fed = false;
  for (const side of [back, left, right])
    if (feeds(y, toward(y.land, i, side), i)) {
      a = withArm(a, side, 1);
      fed = true;
    }
  if (!fed) {
    a = withArm(a, back, 1);
    if (all) a = withArm(withArm(a, left, 1), right, 1);
  }
  return a;
}

/** A straight belt's arms in hand, pointing a way. */
export const straight = (d: Dir): Arms => withArm(withArm(0, d, 2), BACK[d], 1);

/** What a piece that carries carries a minute at a grade, kept full. */
export const carries = (_k: number, grade: number): Stat => ({ label: "Carries", value: perMinute(carried(grade)) });
