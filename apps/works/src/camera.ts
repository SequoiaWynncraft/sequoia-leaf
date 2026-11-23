/**
 * Where the member is looking. The picture is always a whole number of screen pixels to each of
 * the yard's, so zooming goes in steps; the camera may travel as far as the forest that rings the
 * clearing, and a little further where the interface covers the edge of the screen.
 */

import { clamp, type Pt } from "@sequoia-leaf/kit/util.ts";

import type { Ground } from "./art/ground.ts";
import { corner, sizeBuffers } from "./scene.ts";
import { S, seenFrom } from "./state.ts";
import { farSteps, markSize, natural, tilePx, zoomFor } from "./zoom.ts";

/** How much of the screen the interface covers at each edge, in CSS pixels. */
export const inset = { top: 0, bottom: 0, left: 0, right: 0 };
/**
 * How far past the forest's edge lamplight can fall, in the yard's pixels. Zoomed out past the
 * forest there is nothing further out than this but dusk, which the page's own background is, so
 * the picture is never made wider.
 */
const SPILL = 96;

let ground: Ground | null = null;
/** Steps of zoom the member has asked for, over or under the size that suits the screen. */
let steps = 0;
let canvas: HTMLCanvasElement | null = null;
/** Where the camera is easing to, if it has been sent somewhere. */
let goal: Pt | null = null;

export function setCamera(c: HTMLCanvasElement, g: Ground): void {
  canvas = c;
  ground = g;
}

function bound(): void {
  if (!ground) return;
  const k = S.view.dpr / S.view.z;
  const x0 = ground.x - inset.left * k;
  const x1 = ground.x + ground.w + inset.right * k - S.view.w;
  const y0 = ground.y - inset.top * k;
  const y1 = ground.y + ground.h + inset.bottom * k - S.view.h;
  S.cam.x = x1 < x0 ? (x0 + x1) / 2 : clamp(S.cam.x, x0, x1);
  S.cam.y = y1 < y0 ? (y0 + y1) / 2 : clamp(S.cam.y, y0, y1);
  if (!canvas) return;
  // A step of the plan is drawn a screen pixel to each of the picture's, so the picture is that much smaller than the view.
  const z = Math.min(1, S.view.z);
  // The picture lies over the part of the view that can have anything in it: its corner on a whole pixel of the screen.
  corner.x = clamp(ground.x - SPILL - seenFrom(S.cam.x), 0, Math.floor(S.view.w * z - canvas.width) / z);
  corner.y = clamp(ground.y - SPILL - seenFrom(S.cam.y), 0, Math.floor(S.view.h * z - canvas.height) / z);
  // Enlarged by the page, each of its pixels to a whole number of the screen's, on a screen of any pixel ratio.
  canvas.style.transform = `translate(${corner.x / k}px, ${corner.y / k}px) scale(${1 / (k * z)})`;
}

/** How many tiles across and down the plots the yard owns reach, end to end. */
function owned(): { w: number; h: number } {
  const y = S.world;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = 0;
  let y1 = 0;
  for (const plot of y.land.plots) {
    if (!y.plots.includes(plot.plot)) continue;
    x0 = Math.min(x0, plot.x);
    y0 = Math.min(y0, plot.y);
    x1 = Math.max(x1, plot.x + plot.w);
    y1 = Math.max(y1, plot.y + plot.h);
  }
  return { w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Fits the picture to the window, keeping the middle of the view where it was. */
export function resize(): void {
  if (!canvas || !ground) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.max(1, Math.round(window.innerWidth * dpr));
  const ch = Math.max(1, Math.round(window.innerHeight * dpr));
  const mx = S.cam.x + S.view.w / 2;
  const my = S.cam.y + S.view.h / 2;
  const base = natural(cw, ch);
  // The plan's steps are there only for a yard the window does not show whole, clear of the interface.
  const yard = owned();
  const clear = ch - (inset.top + inset.bottom) * dpr;
  const step = zoomFor(base, steps, farSteps(yard.w, yard.h, cw, clear));
  steps = step - base;
  const z = tilePx(step) / 16;
  S.view = { w: Math.ceil(cw / z), h: Math.ceil(ch / z), z, dpr };
  const small = Math.min(1, z);
  sizeBuffers(
    Math.ceil(Math.min(S.view.w, ground.w + SPILL * 2) * small),
    Math.ceil(Math.min(S.view.h, ground.h + SPILL * 2) * small),
    markSize(base, z),
  );
  S.cam.x = mx - S.view.w / 2;
  S.cam.y = my - S.view.h / 2;
  bound();
}

/** Moves the view by so many CSS pixels. */
export function pan(dx: number, dy: number): void {
  const k = S.view.dpr / S.view.z;
  S.cam.x -= dx * k;
  S.cam.y -= dy * k;
  goal = null;
  bound();
}

/** Zooms a step in or out, keeping the point of the page under the pointer where it is. */
export function zoom(by: number, pageX: number, pageY: number): boolean {
  const before = S.view.z;
  const k0 = S.view.dpr / before;
  const wx = S.cam.x + pageX * k0;
  const wy = S.cam.y + pageY * k0;
  steps += by;
  resize();
  const k1 = S.view.dpr / S.view.z;
  S.cam.x = wx - pageX * k1;
  S.cam.y = wy - pageY * k1;
  goal = null;
  bound();
  return S.view.z !== before;
}

/** Puts a point of the yard in the middle of what the interface leaves clear; eased unless `snap`. */
export function look(x: number, y: number, snap = false): void {
  const k = S.view.dpr / S.view.z;
  const to = {
    x: x - S.view.w / 2 - ((inset.left - inset.right) * k) / 2,
    y: y - S.view.h / 2 - ((inset.top - inset.bottom) * k) / 2,
  };
  if (snap) {
    S.cam.x = to.x;
    S.cam.y = to.y;
    goal = null;
    bound();
  } else goal = to;
}

/** Whether a point of the yard is on screen and clear of the interface, with `pad` of its pixels to spare. */
export function inView(x: number, y: number, pad = 24): boolean {
  const k = S.view.dpr / S.view.z;
  return (
    x > S.cam.x + inset.left * k + pad &&
    x < S.cam.x + S.view.w - inset.right * k - pad &&
    y > S.cam.y + inset.top * k + pad * 2 &&
    y < S.cam.y + S.view.h - inset.bottom * k - pad
  );
}

/** Each frame: ease towards wherever the camera was sent. */
export function ease(dt: number): void {
  if (!goal) return;
  const k = Math.min(1, dt * 7);
  S.cam.x += (goal.x - S.cam.x) * k;
  S.cam.y += (goal.y - S.cam.y) * k;
  if (Math.abs(goal.x - S.cam.x) + Math.abs(goal.y - S.cam.y) < 0.6) goal = null;
  bound();
}

/** How the zoom stands, for keeping between visits. */
export const zoomSteps = (): number => steps;
export function setZoom(n: number): void {
  steps = Math.round(n);
}
