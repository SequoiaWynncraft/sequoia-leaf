/**
 * The Wilds' rules drawn on the board: the hexes a room's rules close, where they are (a rule's own
 * picture, for its cards and lines, is `ruleIcon` in `art/icons.ts`). A stump on each of Stumps'
 * hexes, Narrow Table's outside columns grown over, and Long Table's front rows bare while planning
 * (once a fight is on they are open). In a fight what its setup was bound by says which hexes; while
 * planning, the room's (`roomOf`). Nothing is drawn under no rule.
 */
import { BARK, EARTH, GREEN, INK } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";
import { closedCells, type FightRules, roomOf, type RuleId, rulesOf, type RunView } from "@sequoia-leaf/raid";
import { seatCell } from "@sequoia-leaf/raid/hex.ts";

import { hexMark } from "./art/table.ts";
import { shownCell } from "./board.ts";
import { fightOn } from "./fightview.ts";
import { cellXY, HEX_H, HEX_W } from "./geometry.ts";
import { V } from "./stage.ts";
import { S } from "./state.ts";

/** The marks, made once: a stump, a hex grown over, a bare hex. */
const MARKS: { stump?: HTMLCanvasElement; shut?: HTMLCanvasElement; bare?: HTMLCanvasElement } = {};

/** A stump on its hex: the cut top with its rings, the bark below it, on moss. */
function stumpMark(): HTMLCanvasElement {
  const { c, g } = makeCanvas(HEX_W, HEX_H);
  g.drawImage(hexMark(GREEN[0], INK), 0, 0);
  R(g, 5, 10, 10, 4, BARK[1]);
  R(g, 5, 10, 1, 4, BARK[0]);
  R(g, 14, 10, 1, 4, BARK[0]);
  R(g, 6, 14, 8, 1, BARK[0]);
  R(g, 6, 6, 8, 1, EARTH[2]);
  R(g, 5, 7, 10, 3, EARTH[2]);
  R(g, 6, 10, 8, 1, EARTH[1]);
  R(g, 7, 7, 6, 1, EARTH[1]);
  R(g, 8, 8, 4, 1, EARTH[1]);
  R(g, 9, 8, 2, 1, EARTH[0]);
  return c;
}
/** A hex grown over: moss, a few blades in it. */
function shutMark(): HTMLCanvasElement {
  const { c, g } = makeCanvas(HEX_W, HEX_H);
  g.drawImage(hexMark(GREEN[0], INK), 0, 0);
  for (const [x, y] of [
    [6, 8],
    [11, 6],
    [13, 11],
    [8, 13],
  ] as const) {
    R(g, x, y, 1, 2, GREEN[2]);
    R(g, x + 1, y - 1, 1, 2, GREEN[1]);
  }
  return c;
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

/** How a hex closed all fight long looks: a stump under Stumps, grown over under Narrow Table, else bare. */
function closedMark(named: readonly RuleId[]): HTMLCanvasElement {
  MARKS.stump ??= stumpMark();
  MARKS.shut ??= shutMark();
  return named.includes("stumps") ? MARKS.stump : named.includes("narrow") ? MARKS.shut : bareMark();
}
const bareMark = (): HTMLCanvasElement => (MARKS.bare ??= hexMark("#1a0f1e66", "#1a0f1e99"));

/** The hexes the rules shown close, drawn over the board and under everyone on it: in a fight those closed all fight long, while planning those closed only for sitting down too. */
export function drawClosed(g: Ctx, run: RunView): void {
  const shown = ruleShown(run);
  if (!shown) return;
  const mark = closedMark(shown.named);
  for (const cell of closedCells(shown.rules)) put(g, mark, fightOn() ? shownCell(cell) : cell);
  if (fightOn()) return;
  const bare = bareMark();
  for (const seat of shown.rules.closedToSit) for (const side of [0, 1] as const) put(g, bare, seatCell(side, seat));
}
