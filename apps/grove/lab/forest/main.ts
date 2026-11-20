/**
 * The Forest: a canvas at the art's own resolution (about 216 rows, as the glade), scaled up by
 * whole device pixels with nearest filtering. Drag or swipe to pan the valley.
 */

import boldUrl from "../pixel/fonts/minecraft-bold.woff2";
import regularUrl from "../pixel/fonts/minecraft-regular.woff2";
import { Forest } from "./forest.ts";
import { readParams } from "./params.ts";

const params = readParams(location.search);
const ART_HEIGHT = 216;
const MAX_ART_WIDTH = 560;
const found = document.getElementById("forest");
if (!(found instanceof HTMLCanvasElement)) throw new Error("no canvas");
const canvas: HTMLCanvasElement = found;
const context = canvas.getContext("2d");
if (!context) throw new Error("no 2d context");
const ctx = context;

const forest = new Forest(params);
document.body.dataset["buildMs"] = forest.buildMs.toFixed(0);
let view = { scale: 1, offX: 0, offY: 0, dpr: 1 };
let image: ImageData | null = null;
let fontsReady = false;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const devW = Math.round(window.innerWidth * dpr);
  const devH = Math.round(window.innerHeight * dpr);
  let s = Math.max(1, Math.round(devH / ART_HEIGHT));
  let W = Math.ceil(devW / s);
  let H = Math.ceil(devH / s);
  while (W > MAX_ART_WIDTH) {
    s++;
    W = Math.ceil(devW / s);
    H = Math.ceil(devH / s);
  }
  canvas.width = W;
  canvas.height = H;
  const offX = Math.floor((devW - W * s) / 2);
  const offY = Math.floor((devH - H * s) / 2);
  canvas.style.width = `${(W * s) / dpr}px`;
  canvas.style.height = `${(H * s) / dpr}px`;
  canvas.style.left = `${offX / dpr}px`;
  canvas.style.top = `${offY / dpr}px`;
  view = { scale: s, offX, offY, dpr };
  image = ctx.createImageData(W, H);
  forest.resize(W, H);
}

const art = (e: PointerEvent): { x: number; y: number } => ({
  x: Math.floor((e.clientX * view.dpr - view.offX) / view.scale),
  y: Math.floor((e.clientY * view.dpr - view.offY) / view.scale),
});

const start = performance.now();
const clock = (): number => (params.still ? params.t : (performance.now() - start) / 1000);

/** `?perf`: mean milliseconds to draw one frame of art, as `document.body.dataset.renderMs`. */
let perfTotal = 0;
let perfFrames = 0;
let perfWorst = 0;

function frame(): void {
  if (image) {
    const started = params.perf ? performance.now() : 0;
    forest.render(clock(), new Uint32Array(image.data.buffer), fontsReady);
    ctx.putImageData(image, 0, 0);
    if (params.perf) {
      const ms = performance.now() - started;
      // The first frames warm the JIT; count from the tenth.
      if (++perfFrames > 10) {
        perfTotal += ms;
        perfWorst = Math.max(perfWorst, ms);
        document.body.dataset["renderMs"] = (perfTotal / (perfFrames - 10)).toFixed(2);
        document.body.dataset["worstMs"] = perfWorst.toFixed(2);
      }
    }
  }
  canvas.className = forest.cursor === "grab" ? "" : forest.cursor === "grabbing" ? "dragging" : "pointing";
  requestAnimationFrame(frame);
}

canvas.addEventListener("pointerdown", (e) => {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // A synthetic pointer (a test driver) cannot be captured; the drag still works without it.
  }
  const p = art(e);
  forest.pointer(p.x, p.y, "down", clock(), e.pointerType !== "mouse");
});
canvas.addEventListener("pointermove", (e) => {
  const p = art(e);
  forest.pointer(p.x, p.y, "move", clock(), e.pointerType !== "mouse");
});
canvas.addEventListener("pointerup", (e) => {
  const p = art(e);
  forest.pointer(p.x, p.y, "up", clock(), e.pointerType !== "mouse");
});
canvas.addEventListener("pointercancel", (e) => {
  const p = art(e);
  forest.pointer(p.x, p.y, "up", clock(), e.pointerType !== "mouse");
});
canvas.addEventListener("pointerleave", () => forest.pointer(-1, -1, "leave", clock(), false));
window.addEventListener("keydown", (e) => forest.key(e.key, clock()));
window.addEventListener("resize", resize);

resize();
// `?debug`: the forest and the view's scale on `window`, for a test driver to find things by.
if (params.debug)
  Object.assign(window, {
    forest,
    artToCss: (x: number, y: number) => ({
      x: (x * view.scale + view.offX) / view.dpr,
      y: (y * view.scale + view.offY) / view.dpr,
    }),
  });
const faces = [
  new FontFace("Minecraft", `url(${regularUrl})`),
  new FontFace("Minecraft", `url(${boldUrl})`, { weight: "bold" }),
];
async function loadFonts(): Promise<void> {
  const loaded = await Promise.all(faces.map((f) => f.load()));
  for (const f of loaded) document.fonts.add(f);
  fontsReady = true;
}
void loadFonts();
requestAnimationFrame(frame);
