/**
 * The spirit's tooltip card, Minecraft's way: a dark panel with a purple border, the name in its
 * rarity's colour, the rank with its insignia, lore lines below, the job it does in the glade,
 * and its bond hearts. Spirits are numbered and a little feral.
 */

import type { CastFrame } from "../../bundle/cast.ts";
import type { Point } from "../../engine/view.ts";
import type { RankName } from "../../game/rules.ts";
import { type Canvas, drawLeafGlyph, drawText, mix, type Rgb, textWidth, UI, wrap } from "../../ui/hud.ts";

export const INSIGNIA = ["..x..", ".xXx.", "xXXXx", ".xXx.", "..x.."];
const HEART = [".k.k.", "kRkRk", "kRRRk", ".kRk.", "..k.."];
const HEART_EMPTY = [".k.k.", "k.k.k", "k...k", ".k.k.", "..k.."];

export interface CardInfo {
  rank: RankName;
  verdant: boolean;
  colour: Rgb;
  name: string;
  /** A line from the spirit book. */
  lore: string;
  /** The spirit's number in the guild's book. */
  number: number;
  /** Hearts of bond, 1 to 5: duplicates deepen it. */
  bond: number;
  /** The card's last line, at its right: "Tap to keep" for your own cone. */
  footer?: string;
}

const PORTRAIT = 34;

/**
 * Draws the card near `fire` (in the HUD's grid). `open` runs 0 to 1, `closing` 0 to 1. The
 * portrait is the spirit's idle frame from the bundle's cast sheets, one HUD pixel to its pixel
 * (none while its strip loads).
 */
export function drawConeCardAt(
  c: Canvas,
  fire: Point,
  info: CardInfo,
  open: number,
  closing: number,
  portrait: CastFrame | null,
): void {
  const cardW = Math.min(c.W - 8, 168);
  const pad = 5;
  const textX = pad + PORTRAIT + 5;
  const lore = wrap(`"${info.lore}"`, cardW - pad * 2);
  const cardH = pad + PORTRAIT + 4 + lore.length * 10 + 4 + 10 + pad;
  // Above the fire on a wide screen, the spirit landing at its left; at the top on a phone.
  const narrow = c.W < 200;
  const x = Math.round(Math.max(4, Math.min(c.W - cardW - 4, narrow ? (c.W - cardW) / 2 : fire.x - 25 - cardW / 2)));
  const y = narrow ? 36 : Math.round(Math.max(26, fire.y - 50 - cardH));
  const step = open < 0.34 ? 0.08 : open < 0.67 ? 0.5 : 1;
  const h = Math.max(4, Math.round(cardH * (closing > 0 ? 1 - closing : step)));
  const yy = y + Math.round((cardH - h) / 2);
  c.panel(x, yy, cardW, h, UI.purple, 0.95, [24, 18, 36]);
  if (h < cardH) return;

  // The portrait in its slot, lit from behind in the rarity's colour.
  const px = x + pad;
  const py = y + pad;
  c.rect(px, py, PORTRAIT, PORTRAIT, mix(info.colour, [14, 12, 22], 0.86));
  c.border(px, py, PORTRAIT, PORTRAIT, mix(info.colour, UI.ink, 0.3));
  if (portrait)
    c.frame(portrait, px + Math.floor((PORTRAIT - portrait.w) / 2), py + Math.floor((PORTRAIT - portrait.h) / 2));

  const nameW = drawText(c, info.name, x + textX, py + 2, info.colour, { bold: true, shadow: true });
  if (info.verdant) drawLeafGlyph(c, x + textX + nameW + 3, py + 1);
  c.icon(
    INSIGNIA,
    { x: mix(info.colour, UI.ink, 0.25), X: mix(info.colour, [255, 255, 255], 0.35) },
    x + textX,
    py + 14,
  );
  const rw = drawText(c, info.rank, x + textX + 8, py + 14, info.colour, { shadow: true });
  const kind = info.verdant ? "Verdant" : "spirit";
  if (textX + 8 + rw + 4 + textWidth(kind) <= cardW - pad)
    drawText(c, kind, x + textX + 8 + rw + 4, py + 14, info.verdant ? UI.gold : UI.muted, { shadow: true });
  drawText(c, `No. ${String(info.number).padStart(2, "0")}`, x + textX, py + 25, UI.muted, { shadow: true });

  let ly = py + PORTRAIT + 4;
  for (const line of lore) {
    drawText(c, line, x + pad, ly, UI.lore, { shadow: true });
    ly += 10;
  }
  ly += 4;
  for (let i = 0; i < 5; i++) {
    c.icon(i < info.bond ? HEART : HEART_EMPTY, { k: [60, 24, 40], R: [238, 120, 150] }, x + pad + i * 7, ly);
  }
  // "Bond" and the footer share the last line; on a narrow card the word goes first, then the footer.
  const keep = info.footer ?? "Tap to keep";
  const room = cardW - pad * 2 - 37;
  const showBond = textWidth("Bond") + 6 + textWidth(keep) <= room;
  if (showBond) drawText(c, "Bond", x + pad + 37, ly, UI.muted, { shadow: true });
  if (textWidth(keep) <= room)
    drawText(c, keep, x + cardW - pad - textWidth(keep), ly, mix(UI.muted, UI.ink, 0.25), { shadow: true });
}
