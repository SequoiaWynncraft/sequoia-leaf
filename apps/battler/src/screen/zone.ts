/**
 * The rows a figure in the hand belongs in, lit on the member's half of the board while it is carried
 * or tapped (`zoneOf` in the rules, the same reading as its card's `placeOf`), in the catalogue of the
 * run it is carried in. It only advises: where the figure may go is lit as before, and it may be put
 * down anywhere.
 *
 * The rows are lit as one band: the faces of their seats open for sitting, a soft gold, and one line
 * round the whole band, breathing; it is the only thing on the board that moves while a figure is
 * carried, and under a finger it is still seen round it.
 */
import { catalogOf, closedNow, type RunView, zoneOf } from "@sequoia-leaf/raid";
import { isFigureId, type UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import { COLS, SEATS } from "@sequoia-leaf/raid/hex.ts";

import { hexSign, lineRound, SIGN, SIGN_ALPHA } from "./art/board.ts";
import { HEX_H, HEX_W, seatXY } from "./geometry.ts";

/** The seats of the rows a figure belongs in on the member's half, by the run's catalogue, but any the room's rules close while planning. */
export function zoneSeats(run: RunView, kind: UnitKind): number[] {
  const rows = isFigureId(kind) ? zoneOf(catalogOf(run), kind) : [];
  const closed = closedNow(run);
  return Array.from({ length: SEATS }, (_, seat) => seat).filter(
    (seat) => rows.includes(Math.floor(seat / COLS)) && !closed.has(seat),
  );
}

/** The band's line, breathing: the one thing on the board that moves while a figure is carried. */
const lineAlpha = (t: number): number => 0.78 + 0.16 * Math.sin(t * 2.6);

/** The line round a set of seats, made once each: there are two zones and a few rules' closed seats. */
const LINES = new Map<string, HTMLCanvasElement>();
function lineFor(seats: readonly number[]): HTMLCanvasElement {
  const key = seats.join(",");
  let line = LINES.get(key);
  if (!line) {
    line = lineRound(
      seats.map((seat) => seat + SEATS),
      SIGN.zoneLine,
    );
    if (LINES.size > 16) LINES.clear();
    LINES.set(key, line);
  }
  return line;
}

/** Lights the zone's seats as one band, the board's corner at (`ox`, `oy`), at the stage's time `t`. */
export function drawZone(
  g: CanvasRenderingContext2D,
  seats: readonly number[],
  ox: number,
  oy: number,
  t: number,
): void {
  if (seats.length === 0) return;
  g.globalAlpha = SIGN_ALPHA.zoneFill;
  const face = hexSign(SIGN.zone, SIGN.zone);
  for (const seat of seats) {
    const at = seatXY(seat);
    g.drawImage(face, ox + at.x - HEX_W / 2, oy + at.y - HEX_H / 2);
  }
  g.globalAlpha = lineAlpha(t);
  g.drawImage(lineFor(seats), ox, oy);
  g.globalAlpha = 1;
}
