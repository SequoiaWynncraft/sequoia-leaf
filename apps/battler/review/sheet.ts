/**
 * A contact sheet of every figure with its name, for looking at the art large while drawing it:
 * open the page with `?sheet`. Each is shown standing on its base, then using its ability, then
 * tipped over, and one that swings a tool at each beat of its swing. `?sheet=peep,greg` shows only those, side by side, and `&zoom=6` at that size; the
 * people among them (the Commodore, his grooters) wear the review's skins (`crew.ts`).
 */
import { SWING_PICTURES, type SwingPicture } from "@sequoia-leaf/figures/figures.ts";
import { CALLED, drawFigure, drawStanding, drawStars, framesOf, wear } from "@sequoia-leaf/figures/sprites.ts";
import { BARK, CREAM, GOLD, INK } from "@sequoia-leaf/kit/palette.ts";
import { bake } from "@sequoia-leaf/kit/skin.ts";
import { write } from "@sequoia-leaf/kit/text.ts";
import { makeCanvas, must } from "@sequoia-leaf/kit/util.ts";
import { catalogAt, everyFigure } from "@sequoia-leaf/raid/content/catalog.ts";
import { isFigureId, specOf, SUMMON_IDS, TROUBLE_IDS, type UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import { LAST_ERA } from "@sequoia-leaf/raid/content/releases.ts";

import { COMMODORE, crewSheet, GROOTERS } from "./crew.ts";

/** Every release open: the sheet draws everyone any release has. */
const NOW = catalogAt(LAST_ERA);

/** The beats of a swing a figure has pictures of its own for: drawn back, at the top, brought down. */
const swingsOf = (kind: UnitKind): SwingPicture[] => SWING_PICTURES.filter((b) => framesOf(kind).beats[b]);

export function showSheet(only: readonly string[] = [], zoom = 3): void {
  const every: UnitKind[] = [...everyFigure(), ...SUMMON_IDS, ...TROUBLE_IDS];
  const kinds =
    only.length > 0
      ? every.filter((k) => only.includes(k)).toSorted((a, b) => only.indexOf(a) - only.indexOf(b))
      : every;
  wear("commodore", "Commodore", bake(crewSheet(COMMODORE)));
  GROOTERS.forEach(([name, inks], i) => {
    const id = CALLED[i];
    if (id) wear(id, name, bake(crewSheet(inks)));
  });
  const wide = only.length > 0 ? Math.max(200, Math.floor(innerWidth / zoom)) : 424;
  const cells: { kind: UnitKind; x: number; y: number; w: number }[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const kind of kinds) {
    const f = framesOf(kind);
    const w = Math.max(60, f.w * 2 + f.fallen.width + 14) + swingsOf(kind).length * (f.w + 2);
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
  const small = makeCanvas(only.length > 0 && y === 0 ? x : wide, y + rowH);
  const g = small.g;
  g.fillStyle = GOLD[0];
  g.fillRect(0, 0, small.c.width, small.c.height);
  for (const cell of cells) {
    const f = framesOf(cell.kind);
    const foot = cell.y + Math.max(46, f.h + 22) - 16;
    g.fillStyle = BARK[4];
    g.fillRect(cell.x + 1, cell.y + 1, cell.w - 2, Math.max(46, f.h + 22) - 2);
    const a = cell.x + 4 + f.ax;
    drawStanding(g, NOW, cell.kind, a, foot, "plain");
    drawStars(g, isFigureId(cell.kind) ? 2 : 1, a, foot - f.tall - 2);
    const b = a + f.w + 2;
    drawStanding(g, NOW, cell.kind, b, foot, "plain", { pose: "cast", left: true });
    const fell = b + f.w / 2 + f.fallen.width / 2 + 2;
    drawFigure(g, cell.kind, fell, foot, { pose: "fallen" });
    // A figure that swings a tool, at each beat of its swing that has a picture of its own.
    swingsOf(cell.kind).forEach((swing, i) => {
      drawStanding(g, NOW, cell.kind, fell + f.fallen.width / 2 + 4 + f.ax + i * (f.w + 2), foot, "plain", { swing });
    });
  }
  const big = makeCanvas(small.c.width * zoom, small.c.height * zoom);
  big.g.drawImage(small.c, 0, 0, big.c.width, big.c.height);
  for (const cell of cells) {
    const f = framesOf(cell.kind);
    const h = Math.max(46, f.h + 22);
    write(big.g, specOf(NOW, cell.kind).name, (cell.x + 3) * zoom, (cell.y + h - 9) * zoom + 2, {
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
