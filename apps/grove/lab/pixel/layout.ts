/**
 * Where everything stands, from the art size alone. The art is as wide as the screen's aspect
 * makes it, so a phone in portrait gets a narrow glade and a desktop a wide one. Places are
 * measured from the tree and the edges, never eyeballed per screen.
 *
 * The world opens as your tree grows: a seedling's glade is drawn on a short canvas, so its pixels
 * are big and the camera sits close, in a nook between the redwoods with only a sliver of valley.
 * Each level up the canvas grows taller, until at level 6 the whole valley is in view. The HUD
 * keeps its own grid (`hudHeight`), so it stays the same size whatever the world's zoom.
 */

export interface Point {
  x: number;
  y: number;
}

/** How tall the world's art is at each SEQ level, before rounding to a whole screen scale. */
const ART_HEIGHT = [128, 140, 150, 166, 180, 216, 216, 216, 216, 216, 216, 216, 216];

export const artHeight = (level: number): number => ART_HEIGHT[Math.max(0, Math.min(12, Math.round(level) - 1))] ?? 216;

/**
 * The HUD's grid: this many of its pixels tall at every level. A phone in portrait gets a finer
 * grid, so the Minecraft font is not a quarter of the screen.
 */
export const hudHeight = (devW: number, devH: number): number => (devW < devH * 0.75 ? 288 : 216);

/** The narrowest a world can be: enough for the tree, the fire and a companion. */
export const MIN_ART_WIDTH = 78;
export const MAX_ART_WIDTH = 560;

/** A whole-pixel scale for `targetH` art pixels on a `devW` by `devH` screen, within the width limits. */
export function fitScale(devW: number, devH: number, targetH: number): { s: number; W: number; H: number } {
  let s = Math.max(1, Math.round(devH / targetH));
  while (Math.ceil(devW / s) > MAX_ART_WIDTH) s++;
  while (s > 1 && Math.ceil(devW / s) < MIN_ART_WIDTH) s--;
  return { s, W: Math.ceil(devW / s), H: Math.ceil(devH / s) };
}

export interface Layout {
  W: number;
  H: number;
  /** A narrow, portrait glade (a phone). */
  narrow: boolean;
  /** The sunset's line, behind the far ridges. */
  horizon: number;
  /** The back edge of the clearing, where the forest stops. */
  gladeBack: number;
  /** The tree's foot. */
  ground: number;
  treeX: number;
  fire: Point;
  cone: Point;
  lantern: Point;
  squirrel: Point;
  crab: Point;
  great: Point;
  /** Where the far valley's lake lies, and its half-width. */
  lake: Point & { rx: number };
  /** The "Do Not The Farm" sign: its left post's foot. */
  sign: Point | null;
  /** The HUD's hotbar covers the world below this row; nothing that matters stands under it. */
  hudTop: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * `hudBand` is how many world pixels the hotbar covers at the bottom of the screen; it differs with
 * the world's zoom because the HUD keeps its own grid.
 */
export function layout(W: number, H: number, hudBand = 26): Layout {
  const narrow = W < 160;
  const gladeBack = H - (narrow ? 72 : 62);
  // Close in, the valley is a sliver between the forest walls; it widens as the canvas grows.
  const horizon = Math.min(Math.round(H * 0.5), gladeBack - 18);
  // Close in, the seedling stands in the middle of the frame.
  const treeX = Math.round(W * (H < 170 && W >= 160 ? 0.48 : 0.46));
  const great = { x: Math.round(narrow ? W * 0.86 : W * 0.78), y: horizon + 6 };
  const hudTop = H - hudBand;
  if (narrow) {
    // A phone in portrait: the tree fills the width, so the fire and companions stand in a row in
    // front of its foot, above the hotbar, and the cone waits on the near side of the fire.
    const ground = H - 58;
    const fire = { x: Math.min(W - 16, treeX + 24), y: H - 41 };
    return {
      W,
      H,
      narrow,
      horizon,
      gladeBack,
      ground,
      treeX,
      fire,
      cone: { x: fire.x - 17, y: fire.y + 3 },
      lantern: { x: 7, y: ground + 8 },
      squirrel: { x: Math.max(9, treeX - 28), y: H - 38 },
      // No room beside the fire on the narrowest screens: the crab is away at its pond.
      crab: fire.x + 20 > W - 8 ? { x: W + 40, y: H - 36 } : { x: fire.x + 20, y: H - 36 },
      great,
      lake: { x: Math.round(W * 0.7), y: horizon + 13, rx: 12 },
      sign: null,
      hudTop,
    };
  }
  // Close in, the tree's foot comes forward a little, onto open ground in front of the undergrowth.
  const ground = H - (H < 170 ? 39 : 44);
  const close = H < 170;
  const fire = { x: treeX + (close ? Math.round(W * 0.22) : clamp(Math.round(W * 0.16), 30, 60)), y: H - 31 };
  const lantern = { x: treeX - (close ? Math.round(W * 0.27) : clamp(Math.round(W * 0.2), 36, 76)), y: ground + 10 };
  return {
    W,
    H,
    narrow,
    horizon,
    gladeBack,
    ground,
    treeX,
    fire,
    cone: { x: fire.x + 12, y: fire.y + 1 },
    lantern,
    squirrel: { x: treeX - clamp(Math.round(W * 0.11), 28, 44), y: H - 31 },
    crab: { x: fire.x + 31, y: H - 28 },
    great,
    lake: {
      x: Math.round(treeX + clamp(W * 0.2, 48, 96)),
      y: horizon + Math.round((gladeBack - horizon) * 0.42),
      rx: clamp(Math.round(W * 0.075), 14, 34),
    },
    // In the clearing on the far side of the fire, by the grove's gate, where there is room.
    sign: W >= 280 ? { x: fire.x + 48, y: H - 30 } : null,
    hudTop,
  };
}
