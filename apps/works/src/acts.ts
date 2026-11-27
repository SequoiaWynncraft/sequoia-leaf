/**
 * The command each press sends, made in one place. A preview is judged on the very command its press
 * would send (by the rules, and by reach: `figure/reach.ts`), and the press sends that command, so
 * what is shown and what is done can never differ.
 */
import { type Act, at, boxOf, type Dir, type Kind, type Leg, type Piece, TUNNEL } from "@sequoia-leaf/factory";

import type { Tile } from "./hand.ts";
import { flips } from "./kinds/index.ts";
import { gradeInHand, type Group, S } from "./state.ts";

/**
 * The grade a kind in hand would stand at on a tile: the grade chosen for it, and over a piece of
 * its kind never lower than that piece's, which is then only turned.
 */
export function gradeOn(tool: Kind, i: number): number {
  const hand = gradeInHand(tool);
  return i >= 0 && S.world.kind[i] === tool ? Math.max(hand, S.world.grade[i] ?? 1) : hand;
}

/** The grade of the piece on a tile that the kind in hand would raise there, or nothing if it would raise none. */
export function raisedOn(tool: Kind, i: number): number | undefined {
  const stands = i >= 0 && S.world.kind[i] === tool ? (S.world.grade[i] ?? 0) : 0;
  return stands > 0 && gradeInHand(tool) > stands ? stands : undefined;
}

/** For a kind in hand that is flipped (a sorter), the side it sends to. */
export const sideInHand = (tool: Kind): { right?: boolean } => (flips(tool) ? { right: S.right } : {});

/** Building the kind in hand on a tile, facing the way the hand faces, at the grade it would stand at there. */
export const buildAct = (kind: Kind, x: number, y: number): Act => ({
  do: "build",
  kind,
  x,
  y,
  dir: S.dir,
  grade: gradeOn(kind, at(S.world, x, y)),
  ...sideInHand(kind),
});

/** Laying a run of belt, and turning the belt it starts from to meet it, all of it or none. */
export function layAct(legs: readonly Leg[], turns: readonly { x: number; y: number; dir: Dir }[]): Act {
  const [bend] = turns;
  return bend ? { do: "lay", legs, turn: bend } : { do: "lay", legs };
}

/** Setting down the pieces in hand where they stand in `pieces` (as `placed` stands them): a move, a copy or a blueprint. */
export function groupAct(g: Pick<Group, "as" | "tiles" | "turns">, pieces: readonly Piece[]): Act {
  const box = boxOf(pieces);
  return typeof g.as === "number"
    ? { do: "placeBlueprint", slot: g.as, turns: g.turns, x: box.x, y: box.y }
    : { do: g.as, tiles: g.tiles, turns: g.turns, x: box.x, y: box.y };
}

/**
 * A tunnel going in at `from`, the way the hand faces, coming up on `out`: built as one click builds
 * it where it comes up at the nearest tile it can (`here`, a second click on the way in), else laid
 * that many tiles apart.
 */
export function tunnelAct(from: Tile, here: boolean, out: Tile, grade: number): Act {
  const span = Math.abs(out.x - from.x) + Math.abs(out.y - from.y) - 1;
  return here
    ? { do: "build", kind: TUNNEL, x: from.x, y: from.y, dir: S.dir, grade }
    : { do: "lay", legs: [{ tunnel: true, x: from.x, y: from.y, dir: S.dir, span, grade }] };
}
