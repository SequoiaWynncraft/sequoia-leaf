/**
 * The Wilds' rules drawn: the hexes a room's rules close, on the board where they are, and a small
 * picture of the board under each rule for its card on the pick. On the board, a stump on each of
 * Stumps' hexes, Narrow Table's outside columns grown over, and Long Table's front rows bare while
 * planning (once a fight is on they are open). In a fight what its setup was bound by says which
 * hexes; while planning, the room's (`roomOf`). Nothing is drawn under no rule.
 */
import { BARK, CORAL, CREAM, EARTH, GOLD, GREEN, INK, PAPER, SKY, STONE } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";
import {
  closedCells,
  type FightRules,
  ROOM_RULES,
  roomOf,
  ruled,
  type RuleId,
  rulesOf,
  type RunView,
  shut,
} from "@sequoia-leaf/raid";
import { COLS, HOME_ROWS, ROWS, seatCell } from "@sequoia-leaf/raid/hex.ts";

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

// ---------- the rule's picture ----------

/** The small board: a hex is this many pixels across and its rows this far apart; the halves sit a pixel further apart. */
const CELL = 5;
const LINE = 4;
const SPLIT = 2;
const at = (col: number, row: number): { x: number; y: number } => ({
  x: 1 + col * CELL + (row % 2 === 1 ? 2 : 0),
  y: 1 + row * LINE + (row >= HOME_ROWS ? SPLIT : 0),
});
/** Some seats, the same on both halves, as each picture puts figures and stumps on them. */
const SOME: Readonly<Record<RuleId, { closed: readonly number[]; ours: readonly number[] }>> = {
  stumps: { closed: [2, 11, 19], ours: [3, 4, 9, 15] },
  narrow: { closed: [], ours: [2, 3, 4, 10, 16] },
  long: { closed: [], ours: [8, 10, 12, 16] },
  fog: { closed: [], ours: [3, 23] },
  dusk: { closed: [], ours: [2, 3, 4, 10] },
  elbow: { closed: [], ours: [2, 3, 10, 20] },
};

/** A small picture of the board under a rule: its closed hexes, figures on both halves, and what it does to them. */
export function rulePic(rule: RuleId): HTMLCanvasElement {
  const { c, g } = makeCanvas(COLS * CELL + 4, ROWS * LINE + SPLIT + 2);
  const closed = shut(ruled(ROOM_RULES[rule].sets(SOME.stumps.closed)));
  const ours = SOME[rule].ours;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const { x, y } = at(col, row);
      const near = row >= HOME_ROWS;
      const seat = near ? (row - HOME_ROWS) * COLS + col : (HOME_ROWS - 1 - row) * COLS + (COLS - 1 - col);
      const ground = closed.has(seat)
        ? rule === "stumps"
          ? BARK[2]
          : rule === "narrow"
            ? GREEN[0]
            : EARTH[0]
        : PAPER[0];
      R(g, x, y, CELL - 1, LINE - 1, ground);
      if (!ours.includes(seat) || closed.has(seat)) continue;
      R(g, x + 1, y, 2, 2, near ? CREAM : CORAL);
    }
  }
  if (rule === "fog") {
    // Beyond 2 hexes of the figure at the back, nothing is seen.
    g.globalAlpha = 0.7;
    R(g, 0, 0, c.width, 1 + (HOME_ROWS + 1) * LINE, STONE[2]);
    g.globalAlpha = 1;
  } else if (rule === "dusk") {
    g.globalAlpha = 0.45;
    R(g, 0, 0, c.width, c.height, SKY[1]);
    g.globalAlpha = 1;
  } else if (rule === "elbow") {
    // The one with nobody beside it, near the back, is ringed.
    const { x, y } = at(6, HOME_ROWS + 2);
    R(g, x - 1, y - 1, 5, 1, GOLD[2]);
    R(g, x - 1, y + 2, 5, 1, GOLD[2]);
  }
  return c;
}
