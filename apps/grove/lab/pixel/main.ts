/**
 * The pixel glade: two canvases at their art's own resolution, scaled up by whole device pixels
 * with nearest filtering. The world's art is short and close round a seedling and opens up as the
 * tree grows (`artHeight`); the HUD above it keeps one grid (`hudHeight`), so it stays the same
 * size at every level.
 */

import boldUrl from "./fonts/minecraft-bold.woff2";
import regularUrl from "./fonts/minecraft-regular.woff2";
import { artHeight, fitScale, hudHeight } from "./layout.ts";
import { readParams } from "./params.ts";
import { type Grid, Scene, State } from "./scene.ts";

const params = readParams(location.search);

function canvasById(id: string): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const found = document.getElementById(id);
  if (!(found instanceof HTMLCanvasElement)) throw new Error(`no canvas #${id}`);
  const ctx = found.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  return { canvas: found, ctx };
}

const world = canvasById("glade");
const hud = canvasById("hud");

const state = new State(params);
let scene: Scene | null = null;
let worldGrid: Grid | null = null;
let hudGrid: Grid | null = null;
let worldImage: ImageData | null = null;
let hudImage: ImageData | null = null;
let targetH = 0;
let fontsReady = false;

/** Sizes one canvas to `targetH` art pixels tall, centring any overhang of less than a pixel. */
function fit(c: HTMLCanvasElement, dpr: number, devW: number, devH: number, h: number): Grid {
  const { s, W, H } = fitScale(devW, devH, h);
  c.width = W;
  c.height = H;
  const offX = Math.floor((devW - W * s) / 2);
  const offY = Math.floor((devH - H * s) / 2);
  c.style.width = `${(W * s) / dpr}px`;
  c.style.height = `${(H * s) / dpr}px`;
  c.style.left = `${offX / dpr}px`;
  c.style.top = `${offY / dpr}px`;
  return { W, H, scale: s, offX, offY, dpr };
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const devW = Math.round(window.innerWidth * dpr);
  const devH = Math.round(window.innerHeight * dpr);
  targetH = params.sheet ? 72 : artHeight(state.shownLevel(clock()));
  worldGrid = fit(world.canvas, dpr, devW, devH, targetH);
  hudGrid = fit(hud.canvas, dpr, devW, devH, hudHeight(devW, devH));
  worldImage = world.ctx.createImageData(worldGrid.W, worldGrid.H);
  hudImage = hud.ctx.createImageData(hudGrid.W, hudGrid.H);
  scene = new Scene(worldGrid, hudGrid, params, state, clock());
}

const point = (g: Grid, e: PointerEvent): { x: number; y: number } => ({
  x: Math.floor((e.clientX * g.dpr - g.offX) / g.scale),
  y: Math.floor((e.clientY * g.dpr - g.offY) / g.scale),
});

const start = performance.now();
const clock = (): number => (params.still ? params.t : (performance.now() - start) / 1000);

/** `?perf`: the mean time one frame of art takes to draw, read as `document.body.dataset.renderMs`. */
const perf = new URLSearchParams(location.search).has("perf");
let perfTotal = 0;
let perfFrames = 0;

function frame(): void {
  const t = clock();
  // A level-up opens the world mid-ceremony: the canvas grows on the flash.
  if (!params.sheet && artHeight(state.shownLevel(t)) !== targetH) resize();
  if (scene && worldImage && hudImage) {
    const started = perf ? performance.now() : 0;
    const out = new Uint32Array(worldImage.data.buffer);
    const over = new Uint32Array(hudImage.data.buffer);
    scene.render(t, out, over, fontsReady);
    world.ctx.putImageData(worldImage, 0, 0);
    hud.ctx.putImageData(hudImage, 0, 0);
    if (perf) {
      perfTotal += performance.now() - started;
      perfFrames++;
      document.body.dataset["renderMs"] = (perfTotal / perfFrames).toFixed(2);
    }
  }
  requestAnimationFrame(frame);
}

// The HUD canvas lies over the world and takes the pointer; each event is given in both grids.
hud.canvas.addEventListener("pointerdown", (e) => {
  if (worldGrid && hudGrid) scene?.pointer(point(worldGrid, e), point(hudGrid, e), "down", clock());
});
hud.canvas.addEventListener("pointermove", (e) => {
  if (worldGrid && hudGrid)
    scene?.pointer(point(worldGrid, e), point(hudGrid, e), e.pointerType === "mouse" ? "hover" : "drag", clock());
});
hud.canvas.addEventListener("pointerleave", () => scene?.pointer(null, null, "leave", clock()));
window.addEventListener("keydown", (e) => scene?.key(e.key, clock()));
window.addEventListener("resize", resize);

resize();
// The Minecraft font, as the website ships it (see fonts/FONT_NOTICE.txt).
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
