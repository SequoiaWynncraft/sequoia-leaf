/** A blueprint's layout as the line over the dock shows it (`dock.ts`): a small picture, a dot to a tile. */
import { boxOf, DX, DY, type Land, type Piece, SPANS } from "@sequoia-leaf/factory";
import { shown } from "@sequoia-leaf/kit/dom.ts";
import { GOLD, INK } from "@sequoia-leaf/kit/palette.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { pageOf } from "../kinds/index.ts";

/**
 * A blueprint's layout as a small picture on dark, a dot to a tile in its kind's colour (`KindPage.dot`):
 * belts pale, gatherers green, machines gold, power blue. A plan of the whole yard (`land`) is the whole land, the depot on it.
 */
export function thumb(pieces: readonly Piece[], land: Land | null = null): HTMLCanvasElement {
  const box = land ? { x: 0, y: 0, w: land.w, h: land.h } : boxOf(pieces);
  const { c, g } = makeCanvas(box.w + 2, box.h + 2);
  g.fillStyle = INK;
  g.fillRect(0, 0, c.width, c.height);
  if (land) {
    g.fillStyle = GOLD[2];
    g.fillRect(land.depot[0], land.depot[1], 3, 3);
  }
  for (const p of pieces) {
    g.fillStyle = pageOf(p.kind)?.dot ?? "#cbb894";
    // Drawn from the box's corner, wherever the pieces were kept from.
    const [x, y] = [p.x - box.x + 1, p.y - box.y + 1];
    g.fillRect(x, y, 1, 1);
    if (SPANS[p.kind] === 1) g.fillRect(x + DX[p.dir] * (p.span + 1), y + DY[p.dir] * (p.span + 1), 1, 1);
  }
  return shown(c, box.w > 14 || box.h > 10 ? 0.5 : box.w > 6 || box.h > 4 ? 1 : 2);
}
