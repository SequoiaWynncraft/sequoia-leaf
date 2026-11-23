/** Contact sheets of the yard's art with a name under each picture: open the page with `?sheet=machines` or `?sheet=items`. */

import { CREAM, GOLD, GREEN } from "@sequoia-leaf/kit/palette.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

export interface Entry {
  name: string;
  pics: HTMLCanvasElement[];
  /** A heading over the entries that follow, rather than a picture. */
  head?: true;
}

/** Lays the entries out in rows, `zoom` screen pixels to each of their own, and puts the sheet on the page. */
export function showSheet(entries: readonly Entry[], zoom: number, wide: number): void {
  const PAD = 14;
  const probe = makeCanvas(8, 8).g;
  const placed: { e: Entry; x: number; y: number; h: number }[] = [];
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  for (const e of entries) {
    const picW = e.pics.reduce((n, p) => n + p.width * zoom + 6, 0);
    const picH = e.pics.reduce((n, p) => Math.max(n, p.height * zoom), 0);
    const w = Math.max(picW, widthOf(probe, e.name, e.head ? 2 : 1, e.head) + 8, 56);
    const h = e.head ? 30 : picH + 22;
    if (e.head || x + w > wide - PAD) {
      x = PAD;
      y += rowH + (e.head ? 22 : 12);
      rowH = 0;
    }
    placed.push({ e, x, y, h });
    if (e.head) {
      y += h;
      rowH = 0;
    } else {
      x += w + 14;
      rowH = Math.max(rowH, h);
    }
  }
  const { c, g } = makeCanvas(wide, y + rowH + PAD);
  g.fillStyle = GREEN[1];
  g.fillRect(0, 0, c.width, c.height);
  for (const p of placed) {
    if (p.e.head) {
      write(g, p.e.name, p.x, p.y + 4, { px: 2, bold: true, colour: GOLD[2] });
      continue;
    }
    let px = p.x;
    const tall = p.h - 22;
    for (const pic of p.e.pics) {
      g.drawImage(pic, px, p.y + tall - pic.height * zoom, pic.width * zoom, pic.height * zoom);
      px += pic.width * zoom + 6;
    }
    write(g, p.e.name, p.x, p.y + tall + 6, { px: 1, colour: CREAM });
  }
  c.style.cssText = `position:absolute;left:0;top:0;width:${c.width}px;height:${c.height}px;image-rendering:pixelated;z-index:99`;
  document.body.style.overflow = "auto";
  document.documentElement.style.overflow = "auto";
  document.body.style.height = `${c.height}px`;
  document.body.replaceChildren(c);
  document.body.dataset.sheet = `${c.width}x${c.height}`;
}
