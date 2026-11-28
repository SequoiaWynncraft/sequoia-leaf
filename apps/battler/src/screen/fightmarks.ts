/**
 * What abilities leave on the table in a fight, and how figures move for them, beside
 * `fightview.ts`: a zone tints the hexes it holds for as long as it lasts, under the figures, with
 * one line round the whole of it and small marks of its own on each hex, so that zones are told apart
 * without their colour (slime's blobs, a puddle's ripples, dust's specks, ice's glints, snow's
 * drifts); snow is outlined first, then settles under flakes that keep falling; a row Pomp plays to
 * is lit end to end while its fanfare lasts; a telegraph rims the hexes it will land on and fills
 * until it does; a pulled figure is jerked across as a knocked-back one is; a figure channelling
 * holds its cast pose until its last pulse, or until it is stunned.
 *
 * `showMark` is shown every event of the fight first and takes the ones that are its own;
 * `drawFightMarks` draws under the figures, every frame.
 */
import type { Move } from "@sequoia-leaf/figures/move.ts";
import { CORAL, CREAM, GOLD, GREEN, PAPER, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import type { Fight, FightEvent, Unit, ZoneKind } from "@sequoia-leaf/raid";
import { cellAt, CELLS, COLS } from "@sequoia-leaf/raid/hex.ts";

import { dusk, hexSign, lineRound } from "./art/board.ts";
import { shownCell } from "./board.ts";
import { burst } from "./fx.ts";
import { cellXY, HEX_H, HEX_W, type Pt } from "./geometry.ts";
import { FOOT } from "./pawns.ts";
import { V } from "./stage.ts";

/** A figure as the fight on the table shows it: as much of it as is moved and posed here. */
interface Body {
  readonly unit: Unit;
  x: number;
  y: number;
  left: boolean;
  castUntil: number;
  move: (Move & { under: boolean }) | null;
}
/** The fight on the table as `board.ts` keeps it, read as it goes on. */
interface View {
  readonly fight: Fight | null;
  readonly actors: readonly (Body | undefined)[];
  readonly clock: number;
}
/** The events shown here and nowhere else. */
type Marked =
  Extract<FightEvent, { t: "zone" | "telegraph" | "end" }> | (Extract<FightEvent, { t: "leap" }> & { why: "pull" });

/** Hexes marked by a telegraph, by the fight's clock. */
interface Telegraph {
  readonly fight: Fight;
  readonly cells: readonly number[];
  readonly t0: number;
  readonly dur: number;
}
/** A row of the board lit by a fanfare: its hexes' middles, by the fight's clock. */
interface Lit {
  readonly fight: Fight;
  readonly at: readonly Pt[];
  readonly t0: number;
}
const M: {
  view: View | null;
  telegraphs: Telegraph[];
  holds: Map<number, number>;
  /** The step each hex last became a zone, for snow outlined before it settles. */
  since: Map<number, number>;
  lit: Lit[];
} = {
  view: null,
  telegraphs: [],
  holds: new Map(),
  since: new Map(),
  lit: [],
};

/** A zone's tint (and how strong), the line round it, and its marks on each hex, measured from the hex's middle. */
interface ZoneLook {
  readonly tint: string;
  readonly alpha: number;
  readonly line: string;
  readonly marks: (g: Ctx, x: number, y: number) => void;
}
/** A row of single pixels: `n` of them from `x`, `y`, each `dx`, `dy` on from the last. */
function dots(g: Ctx, x: number, y: number, n: number, dx: number, dy: number, col: string): void {
  for (let i = 0; i < n; i++) R(g, x + i * dx, y + i * dy, 1, 1, col);
}
const ZONE: Readonly<Record<ZoneKind, ZoneLook>> = {
  slime: {
    tint: GREEN[3],
    alpha: 0.36,
    line: GREEN[4],
    marks: (g, x, y) => {
      R(g, x - 5, y - 2, 2, 1, GREEN[4]);
      R(g, x + 2, y + 2, 3, 1, GREEN[4]);
      R(g, x + 4, y - 4, 1, 1, GREEN[4]);
    },
  },
  puddle: {
    tint: WATER[2],
    alpha: 0.36,
    line: WATER[3],
    marks: (g, x, y) => {
      R(g, x - 5, y - 1, 4, 1, WATER[3]);
      R(g, x + 1, y + 3, 3, 1, WATER[3]);
    },
  },
  dust: {
    tint: PAPER[1],
    alpha: 0.22,
    line: dusk(PAPER[1], 0.2),
    marks: (g, x, y) => {
      for (const [dx, dy] of DUST) R(g, x + dx, y + dy, 1, 1, PAPER[1]);
    },
  },
  ice: {
    tint: WATER[3],
    alpha: 0.3,
    line: WATER[3],
    marks: (g, x, y) => {
      dots(g, x - 5, y + 1, 4, 1, -1, CREAM);
      dots(g, x + 1, y + 4, 3, 1, -1, CREAM);
    },
  },
  snow: {
    tint: CREAM,
    alpha: 0.14,
    line: dusk(CREAM, 0.3),
    marks: (g, x, y) => {
      // A drift along the hex's lower edges, and three flakes lying.
      for (let i = 0; i < 4; i++) {
        R(g, x - 8 + i * 2, y + 4 + i, 2, 1, PAPER[2]);
        R(g, x + 6 - i * 2, y + 4 + i, 2, 1, PAPER[2]);
      }
      for (const [dx, dy] of [
        [-3, -3],
        [3, -1],
        [-1, 2],
      ] as const)
        R(g, x + dx, y + dy, 1, 1, CREAM);
    },
  },
};
/** Where dust's five specks lie on a hex. */
const DUST = [
  [-5, -2],
  [0, -5],
  [4, 0],
  [-2, 3],
  [5, 4],
] as const;
/** Steps snow is only outlined before it begins to settle, and steps it takes to settle. */
const OUTLINED = 6;
const SETTLES = 16;
/** Steps a fanfare's row stays lit (its 4 seconds), and the most flakes falling over all the snow at once. */
const LIT = 80;
const FLAKES = 12;

function drawHex(g: Ctx, pic: HTMLCanvasElement, cell: number, alpha: number): void {
  const at = cellXY(shownCell(cell));
  g.globalAlpha = alpha;
  g.drawImage(pic, V.bx + at.x - HEX_W / 2, V.by + at.y - HEX_H / 2);
}

/** The line round each zone, a picture the board's size, by its kind and hexes: a zone changes only when it spreads or dries. */
const LINES = new Map<string, HTMLCanvasElement>();
function lineFor(kind: ZoneKind, shown: readonly number[]): HTMLCanvasElement {
  const key = `${kind} ${shown.join(",")}`;
  let line = LINES.get(key);
  if (!line) {
    line = lineRound(shown, ZONE[kind].line);
    if (LINES.size > 32) LINES.clear();
    LINES.set(key, line);
  }
  return line;
}

/** Flakes falling onto the snow, each a pixel, drifting as they fall, by the clock alone: never more than `FLAKES` at once. */
function flakes(g: Ctx, cells: readonly number[], c: number): void {
  g.globalAlpha = 1;
  const n = Math.min(FLAKES, cells.length * 2);
  for (let i = 0; i < n; i++) {
    const cell = cells[(i * 7) % cells.length] ?? 0;
    const at = cellXY(shownCell(cell));
    const k = (((c * 0.05 + i / n + cell * 0.37) % 1) + 1) % 1;
    const x = Math.round(V.bx + at.x + ((cell * 5 + i * 7) % 13) - 6 + Math.sin(c * 0.15 + i) * 1.5);
    const y = Math.round(V.by + at.y - 20 + k * 22);
    R(g, x, y, 1, 1, CREAM);
  }
}

/** Lights the row of the board a spot (someone's feet, in board pixels) stands in, end to end, while a fanfare lasts. */
export function lightRow(from: Pt): void {
  const view = M.view;
  const f = view?.fight;
  if (!view || !f) return;
  let near = 0;
  let best = Infinity;
  for (let cell = 0; cell < CELLS; cell++) {
    const p = cellXY(cell);
    const d = Math.hypot(p.x - from.x, p.y + FOOT - from.y);
    if (d < best) [near, best] = [cell, d];
  }
  const row = Math.floor(near / COLS);
  const at = Array.from({ length: COLS }, (_, col) => cellXY(cellAt(col, row)));
  M.lit.push({ fight: f, at, t0: view.clock });
}

/** Jerked a hex toward whoever pulled it, as a figure knocked back is pushed. */
function pulled(view: View, id: number, to: number): void {
  const a = view.actors[id];
  if (!a) return;
  const p = cellXY(shownCell(to));
  const at = { x: p.x, y: p.y + FOOT };
  if (Math.abs(at.x - a.x) > 1) a.left = at.x < a.x;
  a.move = { from: { x: a.x, y: a.y }, to: at, t0: view.clock, dur: 4, arc: 4, smooth: false, under: false };
  burst(a.x, a.y - 4, 6, [CREAM, STONE[3]], { speed: 30, ttl: 0.3 });
}

/** A figure that begins channelling holds its cast pose until its last pulse has landed. */
function hold(view: View, ev: Extract<FightEvent, { t: "cast" }>): void {
  if (ev.pulses !== undefined && ev.every !== undefined)
    M.holds.set(ev.id, view.clock + (ev.pulses - 1) * ev.every + 6);
}
/** Stunned, it stops channelling. */
function unhold(view: View, ev: Extract<FightEvent, { t: "status" }>): void {
  if (ev.status !== "stun" || !ev.on) return;
  M.holds.delete(ev.id);
  const a = view.actors[ev.id];
  if (a) a.castUntil = Math.min(a.castUntil, view.clock);
}
const OWN: ReadonlySet<FightEvent["t"]> = new Set(["zone", "telegraph", "end"]);

/** Shows an event of the fight if it is one of these, and says whether it was. */
export function showMark(ev: FightEvent, view: View): ev is Marked {
  M.view = view;
  const f = view.fight;
  if (!f) return false;
  if (ev.t === "cast") hold(view, ev);
  else if (ev.t === "status") unhold(view, ev);
  else if (ev.t === "telegraph") M.telegraphs.push({ fight: f, cells: ev.cells, t0: view.clock, dur: ev.ticks });
  else if (ev.t === "zone" && ev.on) for (const cell of ev.cells) M.since.set(cell, view.clock);
  else if (ev.t === "end") {
    M.telegraphs = [];
    M.lit = [];
    M.since.clear();
    M.holds.clear();
  } else if (ev.t === "leap" && ev.why === "pull") pulled(view, ev.id, ev.to);
  return OWN.has(ev.t) || (ev.t === "leap" && ev.why === "pull");
}

/** Zones and telegraphs on the board, under the figures; and figures channelling kept in their cast pose. */
export function drawFightMarks(g: Ctx): void {
  const view = M.view;
  const f = view?.fight;
  if (!view || !f || f.over) return;
  const c = view.clock;
  for (const [id, until] of M.holds) {
    const a = view.actors[id];
    if (a) a.castUntil = Math.max(a.castUntil, until);
  }
  M.holds.clear();
  M.lit = M.lit.filter((l) => l.fight === f && c < l.t0 + LIT);
  for (const l of M.lit) {
    const k = clamp(Math.min((c - l.t0) / 3, (l.t0 + LIT - c) / 10), 0, 1);
    for (const p of l.at) {
      g.globalAlpha = 0.3 * k;
      g.drawImage(hexSign(GOLD[1], GOLD[1]), V.bx + p.x - HEX_W / 2, V.by + p.y - HEX_H / 2);
      g.globalAlpha = k;
      g.drawImage(hexSign(null, GOLD[2]), V.bx + p.x - HEX_W / 2, V.by + p.y - HEX_H / 2);
    }
  }
  drawZones(g, f, c);
  M.telegraphs = M.telegraphs.filter((m) => m.fight === f && c < m.t0 + m.dur);
  for (const m of M.telegraphs) {
    const k = clamp((c - m.t0) / m.dur, 0, 1);
    for (const cell of m.cells) {
      drawHex(g, hexSign(CORAL, CORAL), cell, 0.15 + k * 0.35);
      drawHex(g, hexSign(null, CORAL), cell, 1);
    }
  }
  g.globalAlpha = 1;
}

/**
 * The zones on the board, kind by kind: the tint over each of their hexes, the line round the whole
 * of each kind, its marks on every hex. Snow is only its line at first; each hex's tint and marks
 * settle in after.
 */
function drawZones(g: Ctx, f: Fight, c: number): void {
  const by = new Map<ZoneKind, number[]>();
  f.zones.forEach((z, cell) => {
    if (z) by.set(z.kind, [...(by.get(z.kind) ?? []), cell]);
  });
  for (const [kind, cells] of by) {
    const settled = (cell: number): number =>
      kind === "snow" ? clamp((c - (M.since.get(cell) ?? c) - OUTLINED) / SETTLES, 0, 1) : 1;
    drawZone(g, kind, cells.map(shownCell), (i) => settled(cells[i] ?? 0), V.bx, V.by);
    if (kind === "snow") flakes(g, cells, c);
  }
}

/** A zone of a kind on hexes as the board shows them, the board's corner at (`ox`, `oy`): how settled each is, by its place in `shown`. */
export function drawZone(
  g: Ctx,
  kind: ZoneKind,
  shown: readonly number[],
  settled: (i: number) => number,
  ox: number,
  oy: number,
): void {
  const look = ZONE[kind];
  const tint = hexSign(look.tint, look.tint);
  shown.forEach((cell, i) => {
    const at = cellXY(cell);
    g.globalAlpha = look.alpha * settled(i);
    g.drawImage(tint, ox + at.x - HEX_W / 2, oy + at.y - HEX_H / 2);
    g.globalAlpha = settled(i);
    look.marks(g, ox + at.x, oy + at.y);
  });
  g.globalAlpha = 1;
  g.drawImage(
    lineFor(
      kind,
      shown.toSorted((a, b) => a - b),
    ),
    ox,
    oy,
  );
}
