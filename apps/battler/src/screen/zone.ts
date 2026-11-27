/**
 * The rows a figure in the hand belongs in, lit softly on the member's half of the board while it is
 * carried or tapped: the front two for a figure whose card says it stands in the front or second
 * row, the back two for one whose card says the back row, and none for a Sneak, which leaps from
 * wherever it starts. It is the same reading as the card's (`placeOf`: the row its reach is for), in
 * the catalogue of the run it is carried in, and it only advises: where the figure may go is lit as
 * before, and it may be put down anywhere.
 *
 * Which seats and how they look are both here, so the board's look can change it in one place.
 */
import { SKY } from "@sequoia-leaf/kit/palette.ts";
import { type Catalog, catalogOf, closedNow, type RunView } from "@sequoia-leaf/raid";
import { isFigureId, type UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import { COLS, HOME_ROWS, SEATS, standRow } from "@sequoia-leaf/raid/hex.ts";

import { hexMark } from "./art/table.ts";
import { HEX_H, HEX_W, seatXY } from "./geometry.ts";

/**
 * The rows of a party's own half (0 its front line) a figure belongs in, as a catalogue has the
 * figure: the front half or the back half, or none (a Sneak, or a figure the catalogue does not have).
 */
export function zoneRows(cat: Catalog, kind: UnitKind): readonly number[] {
  const f = isFigureId(kind) ? cat.figures[kind] : undefined;
  if (!f || f.calling === "sneak") return [];
  return standRow(f.range) < HOME_ROWS / 2 ? [0, 1] : [2, 3];
}

/** The seats of those rows on the member's half, by the run's catalogue, but any the room's rules close while planning. */
export function zoneOf(run: RunView, kind: UnitKind): number[] {
  const rows = zoneRows(catalogOf(run), kind);
  const closed = closedNow(run);
  return Array.from({ length: SEATS }, (_, seat) => seat).filter(
    (seat) => rows.includes(Math.floor(seat / COLS)) && !closed.has(seat),
  );
}

/**
 * The zone's tint, dusk over the pale wood: apart from the gold of a free seat, the blue of a swap
 * and the moss of a closed hex. Steady, and drawn over the pulse of those marks so it holds while
 * they breathe, but under the hex the hand is over, which stays the brightest thing on the board.
 */
const TINT = SKY[3];
const ALPHA = 0.25;
/** The tinted face, made once. */
const MARK: { face?: HTMLCanvasElement } = {};

/** Lights the zone's seats, measured from the board's corner at (`ox`, `oy`): a flat face inside each hex's groove. */
export function drawZone(g: CanvasRenderingContext2D, seats: readonly number[], ox: number, oy: number): void {
  if (seats.length === 0) return;
  const face = (MARK.face ??= hexMark(TINT, TINT));
  g.globalAlpha = ALPHA;
  for (const seat of seats) {
    const at = seatXY(seat);
    g.drawImage(face, ox + at.x - HEX_W / 2, oy + at.y - HEX_H / 2);
  }
  g.globalAlpha = 1;
}
