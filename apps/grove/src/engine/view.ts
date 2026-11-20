/**
 * How art sits on the screen. Every canvas is drawn at its art's own resolution and scaled up by a
 * whole number of device pixels with nearest filtering, so pixels stay square and sharp. A scene's
 * world picks its scale from how many rows it wants (the forest, the Campfire) or from the bundle's
 * fixed picture (the glade, `bundle/fit.ts`); the HUD and the menus keep one unit, as Minecraft's
 * GUI scale does, so they stay one size everywhere.
 */

export interface Point {
  x: number;
  y: number;
}

/** One canvas's pixel grid: its art size, its scale in device pixels and where it lies. */
export interface Grid {
  W: number;
  H: number;
  scale: number;
  offX: number;
  offY: number;
  dpr: number;
}

/** The narrowest a world can be, and the widest: enough for a tree, a fire and a companion. */
export const MIN_ART_WIDTH = 78;
export const MAX_ART_WIDTH = 560;

/** A grid `rows` art pixels tall (to the nearest whole scale) on a `devW` by `devH` device area. */
export function worldGrid(devW: number, devH: number, rows: number, dpr: number): Grid {
  let s = Math.max(1, Math.round(devH / rows));
  while (Math.ceil(devW / s) > MAX_ART_WIDTH) s++;
  while (s > 1 && Math.ceil(devW / s) < MIN_ART_WIDTH) s--;
  return place(devW, devH, s, dpr);
}

/** A grid at a fixed scale, for the HUD. */
export function fixedGrid(devW: number, devH: number, scale: number, dpr: number): Grid {
  return place(devW, devH, Math.max(1, scale), dpr);
}

function place(devW: number, devH: number, s: number, dpr: number): Grid {
  const W = Math.ceil(devW / s);
  const H = Math.ceil(devH / s);
  return { W, H, scale: s, offX: Math.floor((devW - W * s) / 2), offY: Math.floor((devH - H * s) / 2), dpr };
}

/**
 * The HUD's unit in device pixels per art pixel: about 288 art rows tall, so 3 on a laptop and a
 * phone, 4 on a 1080p screen, never so coarse that a phone's HUD is under 120 art pixels wide.
 */
export function hudScale(devW: number, devH: number, dpr: number): number {
  let s = Math.max(1, Math.round(devH / 288));
  while (s > 1 && devW / s < 120) s--;
  // Whole CSS pixels where possible, so the HTML menus can share the unit exactly.
  if (dpr > 1 && s >= dpr) s = Math.round(s / dpr) * dpr;
  return s;
}

/** A point on the screen (CSS pixels) in a grid's art pixels. */
export const toArt = (g: Grid, clientX: number, clientY: number): Point => ({
  x: Math.floor((clientX * g.dpr - g.offX) / g.scale),
  y: Math.floor((clientY * g.dpr - g.offY) / g.scale),
});

/** An art pixel of `from` in the art pixels of `to`. */
export const between = (from: Grid, to: Grid, p: Point): Point => ({
  x: Math.round((p.x * from.scale + from.offX - to.offX) / to.scale),
  y: Math.round((p.y * from.scale + from.offY - to.offY) / to.scale),
});

/** Sizes a canvas element to a grid. */
export function fitCanvas(c: HTMLCanvasElement, g: Grid, top = 0): void {
  c.width = g.W;
  c.height = g.H;
  c.style.width = `${(g.W * g.scale) / g.dpr}px`;
  c.style.height = `${(g.H * g.scale) / g.dpr}px`;
  c.style.left = `${g.offX / g.dpr}px`;
  c.style.top = `${top + g.offY / g.dpr}px`;
}
