/**
 * The stage: the canvas the table is drawn on, how big one art pixel is, where the board sits in
 * the window, and the clock. The table is drawn small, one art pixel to a pixel, and blown up to
 * the screen by a whole number; words are written over the enlarged picture in the kit's font.
 *
 * A second canvas lies over the whole interface for the few things that fly across it: a figure in
 * the member's hand, acorns on their way to the purse.
 *
 * The clock only moves in `tick`, so everything timed can be stepped by hand from outside.
 */
import { unit } from "@sequoia-leaf/kit/dom.ts";
import { type Ctx, makeCanvas, must } from "@sequoia-leaf/kit/util.ts";
import type { ClothId, LanternId } from "@sequoia-leaf/raid";

import { paintHalf, paintTable, type Place } from "./art/table.ts";
import { BENCH_H, BENCH_Y, BOARD_W, GAP, type Pt } from "./geometry.ts";

export const V = {
  /** Screen pixels to one art pixel, and screen pixels to one CSS pixel. */
  z: 2,
  dpr: 1,
  /** The picture's size, in art pixels. */
  w: 320,
  h: 200,
  /** The board's top-left corner in the picture. */
  bx: 0,
  by: 0,
  /** How far away the far half of the board sits just now. */
  gap: GAP,
  /** Seconds since the page opened, by the stage's own clock. */
  t: 0,
  /** Canvas pixels to one pixel of the font, for words over the picture. */
  wordPx: 2,
};

/** Something standing on the table: where its feet are (for which is in front), how to draw it, and what goes over its head. */
export interface Standing {
  x: number;
  y: number;
  draw: () => void;
  top: () => void;
}

/** How many art pixels of height the table needs above the stall: the board, the bench, and the far rim. */
const NEEDS = 188;

export interface Hooks {
  /** A moment of time passing. */
  step(dt: number): void;
  /** The table's moving parts, drawn over the painted table, in art pixels. */
  draw(g: Ctx): void;
  /** Words over the enlarged picture. */
  words(ctx: Ctx, px: number): void;
  /** Things that fly over the interface, in art pixels. Says whether anything was drawn. */
  over(g: Ctx): boolean;
  /** The window changed size. */
  resized(): void;
}

let hooks: Hooks | null = null;
let view: HTMLCanvasElement | null = null;
let ctx: Ctx | null = null;
let overCanvas: HTMLCanvasElement | null = null;
let overCtx: Ctx | null = null;
const buf = makeCanvas(320, 200, true);
const overBuf = makeCanvas(320, 200, true);
let table: HTMLCanvasElement | null = null;
let tableKey = "";
let look: { cloth: ClothId; lantern: LanternId } = { cloth: "bare", lantern: "iron" };
let halves: { far: HTMLCanvasElement; near: HTMLCanvasElement } | null = null;
let overWasDrawn = false;
let stopped = false;
let lastFrame = 0;

/** The two halves of the board as pictures. */
export function boardHalves(): { far: HTMLCanvasElement; near: HTMLCanvasElement } {
  halves ??= { far: paintHalf(true), near: paintHalf(false) };
  return halves;
}

/** A point on the page (CSS pixels) as a point in the picture (art pixels). */
export const toArt = (pageX: number, pageY: number): Pt => ({
  x: (pageX * V.dpr) / V.z,
  y: (pageY * V.dpr) / V.z,
});
/** A point on the page as a point measured from the board's corner. */
export const toBoard = (pageX: number, pageY: number): Pt => {
  const a = toArt(pageX, pageY);
  return { x: a.x - V.bx, y: a.y - V.by };
};
/** A point measured from the board's corner as a point on the page. */
export const boardToPage = (x: number, y: number): Pt => ({
  x: ((x + V.bx) * V.z) / V.dpr,
  y: ((y + V.by) * V.z) / V.dpr,
});
/** The middle of an element, measured from the board's corner; null if it is not on the page. */
export function boardSpot(el: Element | null): Pt | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return toBoard(r.left + r.width / 2, r.top + r.height / 2);
}
/** How many CSS pixels one art pixel is. */
export const artPx = (): number => V.z / V.dpr;

export const place = (): Place => ({ w: V.w, h: V.h, bx: V.bx, by: V.by });

/**
 * Works out the size of an art pixel and where the board goes, from the room the interface
 * leaves between the bar along the top and the stall along the bottom.
 */
export function layout(): void {
  if (!view || !overCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.max(1, Math.round(window.innerWidth * dpr));
  const ch = Math.max(1, Math.round(window.innerHeight * dpr));
  for (const c of [view, overCanvas]) {
    if (c.width !== cw) c.width = cw;
    if (c.height !== ch) c.height = ch;
  }
  const bottom = document.getElementById("bottom")?.getBoundingClientRect().top ?? window.innerHeight;
  // The board, its bench and a little of the far side have to fit above the stall.
  const z = Math.max(1, Math.floor(Math.min(cw / (BOARD_W + 40), (Math.max(40, bottom) * dpr) / NEEDS)));
  V.z = z;
  V.dpr = dpr;
  V.w = Math.ceil(cw / z);
  V.h = Math.ceil(ch / z);
  V.bx = Math.round((V.w - BOARD_W) / 2);
  V.by = Math.floor((bottom * dpr) / z) - 4 - BENCH_H - BENCH_Y;
  V.wordPx = Math.max(1, Math.round(unit() * dpr * (dpr >= 2 ? 0.75 : 1)));
  for (const b of [buf, overBuf]) {
    b.c.width = V.w;
    b.c.height = V.h;
    b.g.imageSmoothingEnabled = false;
  }
  // Where the middle of the board is on the page, for whatever is laid over it; a card's sheet stops above the stall.
  document.body.style.setProperty("--table-mid", `${Math.round(((V.by + 58) * z) / dpr)}px`);
  document.body.style.setProperty("--sheet-floor", `${Math.round(window.innerHeight - bottom)}px`);
  repaint();
  hooks?.resized();
  if (stopped) render();
}

/** Changes how the table is dressed. */
export function dress(cloth: ClothId, lantern: LanternId): void {
  look = { cloth, lantern };
  repaint();
}

function repaint(): void {
  const key = `${V.w}x${V.h}@${V.bx},${V.by}:${look.cloth}:${look.lantern}`;
  if (key === tableKey && table) return;
  tableKey = key;
  table = paintTable(place(), look.cloth, look.lantern);
}

/** Moves the clock on. */
export function tick(dt: number): void {
  V.t += dt;
  hooks?.step(dt);
}

export function render(): void {
  if (!ctx || !view || !hooks) return;
  const g = buf.g;
  if (table) g.drawImage(table, 0, 0);
  hooks.draw(g);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buf.c, 0, 0, buf.c.width * V.z, buf.c.height * V.z);
  hooks.words(ctx, V.wordPx);
  if (!overCtx || !overCanvas) return;
  overBuf.g.clearRect(0, 0, overBuf.c.width, overBuf.c.height);
  const drawn = hooks.over(overBuf.g);
  if (drawn || overWasDrawn) {
    overCtx.clearRect(0, 0, overCanvas.width, overCanvas.height);
    if (drawn) {
      overCtx.imageSmoothingEnabled = false;
      overCtx.drawImage(overBuf.c, 0, 0, overBuf.c.width * V.z, overBuf.c.height * V.z);
    }
  }
  overWasDrawn = drawn;
}

function frame(now: number): void {
  const dt = stopped ? 0 : Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (dt > 0) tick(dt);
  render();
  requestAnimationFrame(frame);
}

/** Stops the clock (the table is still drawn), so that only `skip` moves it. */
export function hold(on: boolean): void {
  stopped = on;
}
/** Runs the clock on by hand, in small steps, and draws. */
export function skip(seconds: number): void {
  for (let left = seconds; left > 1e-6; left -= 1 / 30) tick(Math.min(1 / 30, left));
  render();
}
/** Milliseconds to work out and draw one frame, averaged over a hundred. */
export function bench(): number {
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) {
    tick(1 / 60);
    render();
  }
  return (performance.now() - t0) / 100;
}

/** Takes the two canvases and starts drawing. */
export function open(h: Hooks): void {
  hooks = h;
  view = must(document.querySelector<HTMLCanvasElement>("#view"), "the table's canvas");
  ctx = must(view.getContext("2d"), "2d context");
  overCanvas = must(document.querySelector<HTMLCanvasElement>("#over"), "the canvas over the interface");
  overCtx = must(overCanvas.getContext("2d"), "2d context");
  let waiting = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(waiting);
    waiting = window.setTimeout(layout, 60);
  });
  // The stall grows and shrinks with what is on it; the table keeps clear of it.
  const bottom = document.getElementById("bottom");
  let bottomTop = -1;
  if (bottom) {
    new ResizeObserver(() => {
      const top = Math.round(bottom.getBoundingClientRect().top);
      if (top === bottomTop) return;
      bottomTop = top;
      layout();
    }).observe(bottom);
  }
  layout();
  lastFrame = performance.now();
  requestAnimationFrame(frame);
}
