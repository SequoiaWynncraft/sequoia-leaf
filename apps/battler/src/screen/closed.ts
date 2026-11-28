/**
 * The Wilds' rules drawn on the board: the hexes a room's rules close, where they are (a rule's own
 * picture, for its cards and lines, is `ruleIcon` in `art/icons.ts`). A stump on each of Stumps'
 * hexes, Narrow Table's outside columns grown over, and Long Table's front rows bare while planning
 * (once a fight is on they are open). In a fight what its setup was bound by says which hexes; while
 * planning, the room's (`roomOf`). Nothing is drawn under no rule.
 */
import { BARK, EARTH, GREEN, INK } from "@sequoia-leaf/kit/palette.ts";
import { outlined, R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";
import { closedCells, type FightRules, roomOf, type RuleId, rulesOf, type RunView } from "@sequoia-leaf/raid";
import { seatCell } from "@sequoia-leaf/raid/hex.ts";

import { BOARD, hexSign } from "./art/board.ts";
import { shownCell } from "./board.ts";
import { fightOn } from "./fightview.ts";
import { cellXY, HEX_H, HEX_W } from "./geometry.ts";
import { V } from "./stage.ts";
import { S } from "./state.ts";

/** The marks, made once: a stump on its hex, a hex grown over. */
const MARKS: { stump?: HTMLCanvasElement; shut?: HTMLCanvasElement } = {};

/** A hex closed: its face and lip the wood round the board, its grooves kept. */
export const bare = (): HTMLCanvasElement => hexSign(BOARD.wood, BOARD.wood);

/** A thing that closes a hex, on the hex's wood: `thing` drawn with an ink edge, its top left at `x`, `y`. */
function closedBy(thing: HTMLCanvasElement, x: number, y: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(HEX_W, HEX_H);
  g.drawImage(bare(), 0, 0);
  g.drawImage(outlined(thing, INK), x, y);
  return c;
}
/** A stump on its hex, 12 by 10: the cut top with its heart, the bark below it. */
function stumpMark(): HTMLCanvasElement {
  const { c, g } = makeCanvas(12, 10);
  R(g, 1, 4, 10, 5, BARK[1]);
  R(g, 1, 4, 1, 5, BARK[0]);
  R(g, 0, 8, 12, 1, BARK[1]);
  R(g, 1, 0, 10, 4, EARTH[2]);
  R(g, 2, 1, 8, 2, EARTH[1]);
  R(g, 4, 1, 4, 1, EARTH[0]);
  return closedBy(c, 3, 2);
}
/** A hex grown over: a cushion of moss 14 by 7. */
function shutMark(): HTMLCanvasElement {
  const { c, g } = makeCanvas(14, 7);
  R(g, 1, 3, 12, 4, GREEN[1]);
  R(g, 0, 5, 14, 2, GREEN[1]);
  R(g, 2, 2, 4, 1, GREEN[2]);
  R(g, 8, 1, 3, 2, GREEN[2]);
  R(g, 4, 4, 5, 1, GREEN[2]);
  R(g, 9, 1, 1, 1, GREEN[3]);
  return closedBy(c, 2, 6);
}

/** Draws a mark on a fight cell, the far half `gap` pixels further away. */
function put(g: Ctx, mark: HTMLCanvasElement, cell: number): void {
  const p = cellXY(cell, Math.round(V.gap));
  g.drawImage(mark, Math.round(V.bx + p.x - HEX_W / 2), Math.round(V.by + p.y - HEX_H / 2));
}

/** The rules shown and what they set: the fight's on the table, if one is shown; else the room's being planned. Null under none. */
export function ruleShown(run: RunView): { named: readonly RuleId[]; rules: FightRules } | null {
  const s = S.screen;
  if (fightOn()) {
    if (s.at !== "fight" && s.at !== "after") return null;
    const { setup } = s.play.fought;
    return setup.named?.length ? { named: setup.named, rules: rulesOf(setup) } : null;
  }
  const room = roomOf(run);
  return room.named.length > 0 ? room : null;
}

/** How a hex closed all fight long looks: a stump under Stumps, grown over under Narrow Table, else bare wood. */
export function closedMark(named: readonly RuleId[]): HTMLCanvasElement {
  if (named.includes("stumps")) return (MARKS.stump ??= stumpMark());
  return named.includes("narrow") ? (MARKS.shut ??= shutMark()) : bare();
}

/** The hexes the rules shown close, drawn over the board and under everyone on it: in a fight those closed all fight long, while planning those closed only for sitting down too. */
export function drawClosed(g: Ctx, run: RunView): void {
  const shown = ruleShown(run);
  if (!shown) return;
  const mark = closedMark(shown.named);
  for (const cell of closedCells(shown.rules)) put(g, mark, fightOn() ? shownCell(cell) : cell);
  if (fightOn()) return;
  for (const seat of shown.rules.closedToSit) for (const side of [0, 1] as const) put(g, bare(), seatCell(side, seat));
}
