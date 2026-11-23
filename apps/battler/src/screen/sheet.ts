import { drawBase, drawFigure, drawStars, framesOf } from "@sequoia-leaf/figures/sprites.ts";
/**
 * A contact sheet of every figure with its name, for looking at the art large while drawing it:
 * open the page with `?sheet`. Each is shown standing on its base, then using its ability, then
 * tipped over.
 */
import { BARK, CREAM, GOLD, INK } from "@sequoia-leaf/kit/palette.ts";
import { write } from "@sequoia-leaf/kit/text.ts";
import { makeCanvas, must } from "@sequoia-leaf/kit/util.ts";
import {
  FIGURE_IDS,
  FIGURES,
  specOf,
  SUMMON_IDS,
  TROUBLE_IDS,
  type UnitKind,
} from "@sequoia-leaf/raid/content/figures.ts";

export function showSheet(): void {
  const zoom = 3;
  const kinds: UnitKind[] = [...FIGURE_IDS, ...SUMMON_IDS, ...TROUBLE_IDS];
  const wide = 424;
  const cells: { kind: UnitKind; x: number; y: number; w: number }[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const kind of kinds) {
    const f = framesOf(kind);
    const w = Math.max(60, f.w * 2 + f.fallen.width + 14);
    const h = Math.max(46, f.h + 22);
    if (x + w > wide) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    cells.push({ kind, x, y, w });
    x += w;
    rowH = Math.max(rowH, h);
  }
  const small = makeCanvas(wide, y + rowH);
  const g = small.g;
  g.fillStyle = GOLD[0];
  g.fillRect(0, 0, small.c.width, small.c.height);
  for (const cell of cells) {
    const f = framesOf(cell.kind);
    const foot = cell.y + Math.max(46, f.h + 22) - 16;
    g.fillStyle = BARK[4];
    g.fillRect(cell.x + 1, cell.y + 1, cell.w - 2, Math.max(46, f.h + 22) - 2);
    const a = cell.x + 4 + f.ax;
    drawBase(g, cell.kind, a, foot);
    drawFigure(g, cell.kind, a, foot);
    drawStars(g, cell.kind in FIGURES ? 2 : 1, a, foot - f.tall - 2);
    const b = a + f.w + 2;
    drawBase(g, cell.kind, b, foot);
    drawFigure(g, cell.kind, b, foot, { pose: "cast", left: true });
    drawFigure(g, cell.kind, b + f.w / 2 + f.fallen.width / 2 + 2, foot, { pose: "fallen" });
  }
  const big = makeCanvas(small.c.width * zoom, small.c.height * zoom);
  big.g.drawImage(small.c, 0, 0, big.c.width, big.c.height);
  for (const cell of cells) {
    const f = framesOf(cell.kind);
    const h = Math.max(46, f.h + 22);
    write(big.g, specOf(cell.kind).name, (cell.x + 3) * zoom, (cell.y + h - 9) * zoom + 2, {
      px: 1,
      colour: CREAM,
      shadow: INK,
    });
  }
  big.c.id = "sheet";
  big.c.style.cssText = `position:absolute;left:0;top:0;width:${big.c.width}px;height:${big.c.height}px;image-rendering:pixelated;z-index:99`;
  must(document.body, "body").append(big.c);
  document.body.style.overflow = "auto";
  document.documentElement.style.overflow = "auto";
}
