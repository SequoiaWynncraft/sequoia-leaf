/**
 * Where a bundle's fixed picture (256x144) sits on the screen: always at a whole number of device
 * pixels per art pixel, never smoothed.
 *
 * - Landscape: the largest scale that fits, centred, keeping the tree clear of the HUD's hotbar
 *   (every row above `clearRow`, where the tree meets the ground, stays above it). The page round
 *   the picture takes the scene's backdrop colour.
 * - Phone portrait: the picture fills the height between the dock and the hotbar, standing on the
 *   hotbar with the HUD's top row in the room above it, and the screen shows a vertical crop of it
 *   centred on the tree (`focusX`).
 */

/** The HUD's rows, in HUD pixels: its top row (badge and Leaf) and its hotbar with Bloom. */
export const HUD_TOP = 28;
export const HUD_BAR = 36;

export interface FitInput {
  devW: number;
  devH: number;
  picW: number;
  picH: number;
  phone: boolean;
  /** Device pixels per HUD pixel. */
  hudScale: number;
  /** Whether the HUD is shown (`?bare` hides it). */
  hud: boolean;
  /** The picture column to centre a crop on. */
  focusX: number;
  /** Rows above this must stay clear of the hotbar. */
  clearRow: number;
}

export interface Fit {
  scale: number;
  /** The art shown: `W` columns from `cropX`, all `H` rows. */
  W: number;
  H: number;
  cropX: number;
  /** Where the shown art's top left corner is, in device pixels. */
  offX: number;
  offY: number;
}

export function fitPicture(o: FitInput): Fit {
  const barTop = o.hud ? o.devH - HUD_BAR * o.hudScale : o.devH;
  if (o.phone) {
    const scale = Math.max(1, Math.floor(barTop / o.picH));
    const W = Math.min(o.picW, Math.ceil(o.devW / scale));
    const cropX = Math.max(0, Math.min(o.picW - W, Math.round(o.focusX - W / 2)));
    return {
      scale,
      W,
      H: o.picH,
      cropX,
      offX: Math.floor((o.devW - W * scale) / 2),
      offY: Math.max(0, barTop - o.picH * scale),
    };
  }
  let scale = Math.max(1, Math.floor(Math.min(o.devW / o.picW, o.devH / o.picH)));
  for (; scale > 1; scale--) {
    const centred = Math.floor((o.devH - o.picH * scale) / 2);
    // Centred if the tree clears the hotbar; raised just enough if not; smaller if it cannot be.
    if (centred + o.clearRow * scale <= barTop || barTop - o.clearRow * scale >= 0) break;
  }
  const centred = Math.floor((o.devH - o.picH * scale) / 2);
  const offY = Math.max(0, Math.min(centred, barTop - o.clearRow * scale));
  return { scale, W: o.picW, H: o.picH, cropX: 0, offX: Math.floor((o.devW - o.picW * scale) / 2), offY };
}
