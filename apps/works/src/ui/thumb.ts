/** A blueprint's layout as the line over the dock shows it (`dock.ts`): a small picture, a dot to a tile. */
import {
  BENCH,
  BOILER,
  boxOf,
  CRATE,
  DX,
  DY,
  GATHERER,
  MILL,
  type Piece,
  PYLON,
  STUDY,
  TUNNEL,
  WHEEL,
  WORKSHOP,
} from "@sequoia-leaf/factory";
import { shown } from "@sequoia-leaf/kit/dom.ts";
import { GOLD, GREEN, INK, WATER } from "@sequoia-leaf/kit/palette.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

const DOT = new Map<number, string>([
  [GATHERER, GREEN[4]],
  [MILL, GOLD[1]],
  [BENCH, GOLD[1]],
  [WORKSHOP, GOLD[1]],
  [CRATE, "#a35d3b"],
  [STUDY, GOLD[1]],
  [PYLON, WATER[3]],
  [WHEEL, WATER[3]],
  [BOILER, WATER[3]],
]);

/** A blueprint's layout as a small picture on dark, a dot to a tile: belts pale, gatherers green, machines gold, power blue. */
export function thumb(pieces: readonly Piece[]): HTMLCanvasElement {
  const box = boxOf(pieces);
  const { c, g } = makeCanvas(box.w + 2, box.h + 2);
  g.fillStyle = INK;
  g.fillRect(0, 0, c.width, c.height);
  for (const p of pieces) {
    g.fillStyle = DOT.get(p.kind) ?? "#cbb894";
    // Drawn from the box's corner, wherever the pieces were kept from.
    const [x, y] = [p.x - box.x + 1, p.y - box.y + 1];
    g.fillRect(x, y, 1, 1);
    if (p.kind === TUNNEL) g.fillRect(x + DX[p.dir] * (p.span + 1), y + DY[p.dir] * (p.span + 1), 1, 1);
  }
  return shown(c, box.w > 14 || box.h > 10 ? 0.5 : box.w > 6 || box.h > 4 ? 1 : 2);
}
