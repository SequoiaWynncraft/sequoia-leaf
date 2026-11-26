import { framesOf, portrait } from "@sequoia-leaf/figures/sprites.ts";
/** Figures' small pictures, for a row of the tally and for who wants an item. */
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";
import type { UnitKind } from "@sequoia-leaf/raid";

/**
 * A figure's small picture for a row, at most 18 by 12 of its pixels: small figures whole, taller
 * ones from the top (their heads), and the bosses at half size, so every row is the same height.
 */
const heads = new Map<HTMLCanvasElement, HTMLCanvasElement>();
export function headOf(kind: UnitKind): HTMLCanvasElement {
  // Kept by the picture it was cut from: a banner's member is cut again once they are drawn as themselves.
  const whole = framesOf(kind).idle[0];
  const kept = heads.get(whole) ?? cutHead(kind);
  heads.set(whole, kept);
  // A copy for each row: one picture cannot be in two rows at once.
  const { c, g } = makeCanvas(kept.width, kept.height);
  g.drawImage(kept, 0, 0);
  return c;
}
function cutHead(kind: UnitKind): HTMLCanvasElement {
  const src = portrait(kind);
  const g0 = src.getContext("2d");
  const data = g0?.getImageData(0, 0, src.width, src.height).data;
  let x0 = src.width;
  let y0 = src.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if ((data?.[(y * src.width + x) * 4 + 3] ?? 0) === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) {
    x0 = 0;
    y0 = 0;
    x1 = src.width - 1;
    y1 = src.height - 1;
  }
  // A tall figure's picture starts at its head, leaving out what it wears over it.
  y0 += Math.min(framesOf(kind).head, Math.max(0, y1 - y0 + 1 - 12));
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const half = h > 28 || w > 26;
  const k = half ? 2 : 1;
  const out = Math.min(18, Math.ceil(w / k));
  const tall = Math.min(12, Math.ceil(h / k));
  const { c, g } = makeCanvas(out, tall);
  g.imageSmoothingEnabled = false;
  // Centred across, from the top down.
  const sx = x0 + Math.max(0, Math.floor((w - out * k) / 2));
  g.drawImage(src, sx, y0, out * k, tall * k, 0, 0, out, tall);
  return c;
}
