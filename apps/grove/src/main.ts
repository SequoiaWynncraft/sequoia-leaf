/**
 * Sequoia Grove's client: one page for the website and the Discord Activity.
 *
 * The router reads the hash. Scenes (`#glade`, `#forest`, `#campfire`) are pixel worlds drawn on
 * two canvases, the world at its own whole-pixel scale and the HUD on one unit; moving between them
 * dissolves through a dithered dark. The glade plays the art bundle (`bundle/`, from `grove-art/`
 * or `?art=`); the page round a world that does not fill the screen takes the scene's backdrop. Menus (`#cones`, `#rates`, `#spirits`, `#shop`, `#rings`, `#great`,
 * `#leafle`) are HTML panels in the mod's style over the dimmed, still-living scene. The dock is the
 * one navigation, at the bottom where a thumb is.
 */

import { Art, artBase } from "./bundle/art.ts";
import boldUrl from "./engine/fonts/minecraft-bold.woff2";
import regularUrl from "./engine/fonts/minecraft-regular.woff2";
import { bayer } from "./engine/raster.ts";
import { fitCanvas, fixedGrid, type Grid, hudScale, toArt } from "./engine/view.ts";
import { readParams } from "./game/params.ts";
import { Store } from "./game/store.ts";
import { Campfire } from "./scenes/campfire/campfire.ts";
import { Forest } from "./scenes/forest/forest.ts";
import { GladeScene } from "./scenes/glade/glade.ts";
import type { App, Opening, Scene, SceneId } from "./scenes/scene.ts";
import { Dock } from "./ui/dock.ts";
import { MENU_HOME, type MenuId, Menus } from "./ui/menus/menus.ts";

const SCENES: readonly SceneId[] = ["glade", "forest", "campfire"];
const MENUS: readonly MenuId[] = ["cones", "rates", "spirits", "shop", "rings", "great", "leafle"];

interface Route {
  scene: SceneId | null;
  menu: MenuId | null;
}

function readRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, "").toLowerCase();
  const scene = SCENES.find((s) => s === h) ?? null;
  const menu = MENUS.find((m) => m === h) ?? null;
  return { scene, menu };
}

function element<T extends HTMLElement>(id: string, kind: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof kind)) throw new Error(`no #${id}`);
  return found;
}

const params = readParams(location.search);
const store = new Store(params.reset);
if (params.reset)
  history.replaceState(
    null,
    "",
    location.pathname + location.search.replace(/[?&]reset\b/, "").replace(/^&/, "?") + location.hash,
  );

const worldCanvas = element("world", HTMLCanvasElement);
const hudCanvas = element("hud", HTMLCanvasElement);
const fadeCanvas = element("fade", HTMLCanvasElement);
const toast = element("toast", HTMLOutputElement);
const ctx = (c: HTMLCanvasElement): CanvasRenderingContext2D => {
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d context");
  return g;
};
const worldCtx = ctx(worldCanvas);
const hudCtx = ctx(hudCanvas);
const fadeCtx = ctx(fadeCanvas);

const start = performance.now();
const clock = (): number => (params.still ? params.t : (performance.now() - start) / 1000);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
const app: App = {
  params,
  store,
  art: new Art(artBase(location.search, location.href)),
  go: (to) => {
    location.hash = to;
  },
  say: (text) => {
    toast.textContent = text;
    toast.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("on"), 3200);
  },
};

const built = new Map<SceneId, Scene>();
function sceneOf(id: SceneId): Scene {
  const hit = built.get(id);
  if (hit) return hit;
  const made: Scene = id === "forest" ? new Forest(app) : id === "campfire" ? new Campfire(app) : new GladeScene(app);
  built.set(id, made);
  return made;
}

/** Cones opened from the banner wait here until the glade is on screen to play them. */
let pending: Opening[] | null = null;

const first = readRoute(location.hash);
let sceneId: SceneId = first.scene ?? (first.menu ? MENU_HOME[first.menu] : "glade");
let scene = sceneOf(sceneId);

// ---------------------------------------------------------------------------------------------
// Sizing.

let worldG: Grid = fixedGrid(1, 1, 1, 1);
let hudG: Grid = fixedGrid(1, 1, 1, 1);
let worldImage = worldCtx.createImageData(1, 1);
let hudImage = hudCtx.createImageData(1, 1);
let layoutKey = "";
let backdrop = "";

function layoutKind(): "pip" | "phone" | "wide" {
  if (params.camp === "pip" || (innerHeight <= 240 && innerWidth <= 480)) return "pip";
  return innerWidth < innerHeight * 0.75 ? "phone" : "wide";
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const kind = layoutKind();
  document.body.dataset["layout"] = kind;
  const devW = Math.round(innerWidth * dpr);
  const fullH = Math.round(innerHeight * dpr);
  const hs = hudScale(devW, fullH, dpr);
  const unit = hs / dpr;
  document.documentElement.style.setProperty("--u", `${unit}px`);
  // Menus hold more than the HUD does, so they draw one unit finer (never under two).
  document.documentElement.style.setProperty("--mu", `${Math.max(2, unit - 1)}px`);
  // On a phone the dock is a strip under the world; elsewhere it floats over the world's corner.
  const dockH = kind === "phone" && !params.bare ? Math.round(dock.height(unit) * dpr) : 0;
  const devH = fullH - dockH;
  hudG = fixedGrid(devW, devH, hs, dpr);
  layoutKey = scene.layoutKey?.() ?? "";
  worldG = scene.grid({ devW, devH, dpr, phone: kind === "phone", hud: hudG }, clock());
  fitCanvas(worldCanvas, worldG);
  fitCanvas(hudCanvas, hudG);
  fitCanvas(fadeCanvas, hudG);
  worldImage = worldCtx.createImageData(worldG.W, worldG.H);
  hudImage = hudCtx.createImageData(hudG.W, hudG.H);
  scene.resize(worldG, hudG, clock());
}

// ---------------------------------------------------------------------------------------------
// Moving between scenes: the world dissolves to dark through an ordered dither and back.

const FADE = 0.24;
let fade: { to: SceneId; t0: number; swapped: boolean } | null = null;

function goScene(id: SceneId, instant: boolean): void {
  if (id === sceneId && !fade) return;
  if (instant || params.still) {
    swapScene(id);
    return;
  }
  fade = { to: id, t0: clock(), swapped: false };
}

function swapScene(id: SceneId): void {
  sceneId = id;
  scene = sceneOf(id);
  resize();
  document.body.dataset["scene"] = id;
  dock.render(currentRoute());
  playPending();
}

/** Plays opened cones once the glade is the scene on screen. */
function playPending(): void {
  if (sceneId !== "glade" || !pending || !(scene instanceof GladeScene)) return;
  scene.play(pending, clock());
  pending = null;
}

function drawFade(t: number): void {
  const W = fadeCanvas.width;
  const H = fadeCanvas.height;
  let k = 0;
  if (fade) {
    const u = (t - fade.t0) / FADE;
    if (u >= 1 && !fade.swapped) {
      fade.swapped = true;
      swapScene(fade.to);
    }
    k = u < 1 ? u : Math.max(0, 2 - u);
    if (u >= 2) fade = null;
  }
  fadeCanvas.hidden = k <= 0;
  if (k <= 0) return;
  const img = fadeCtx.createImageData(W, H);
  const out = new Uint32Array(img.data.buffer);
  const ink = 0xff140d10;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (bayer(x, y) < k * 1.02) out[y * W + x] = ink;
  fadeCtx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------------------------
// Routes, menus and the dock.

const currentRoute = (): Route => {
  const r = readRoute(location.hash);
  return { scene: r.scene ?? (r.menu ? null : sceneId), menu: r.menu };
};

const menus = new Menus(element("menu", HTMLElement), app, {
  warm: (openings) => {
    pending = openings;
    location.hash = "glade";
  },
  close: () => {
    location.hash = sceneId;
  },
});
const dock = new Dock(element("dock", HTMLElement));

function route(): void {
  const r = currentRoute();
  document.body.dataset["menu"] = r.menu ?? "";
  menus.show(r.menu);
  dock.render(r);
  if (r.scene) goScene(r.scene, false);
  playPending();
  // Menus open over whatever scene is live; one that belongs to a scene opens there on a cold start.
  hudCanvas.hidden = r.menu !== null;
}

store.subscribe(() => menus.refresh());
window.addEventListener("hashchange", route);
window.addEventListener("resize", resize);

// ---------------------------------------------------------------------------------------------
// Input: the HUD canvas lies over the world and takes the pointer; each event is given in both grids.

const deliver = (e: PointerEvent, kind: "down" | "move" | "up" | "leave"): void => {
  if (fade) return;
  scene.pointer(
    toArt(worldG, e.clientX, e.clientY),
    toArt(hudG, e.clientX, e.clientY),
    kind,
    clock(),
    e.pointerType !== "mouse",
  );
};
hudCanvas.addEventListener("pointerdown", (e) => {
  try {
    hudCanvas.setPointerCapture(e.pointerId);
  } catch {
    // A synthetic pointer (a test driver) cannot be captured; drags still work without it.
  }
  deliver(e, "down");
});
hudCanvas.addEventListener("pointermove", (e) => deliver(e, "move"));
hudCanvas.addEventListener("pointerup", (e) => deliver(e, "up"));
hudCanvas.addEventListener("pointercancel", (e) => deliver(e, "up"));
hudCanvas.addEventListener("pointerleave", (e) => deliver(e, "leave"));
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (menus.key(e)) return;
  if (e.key === "Escape" && currentRoute().menu) {
    location.hash = sceneId;
    return;
  }
  scene.key(e.key, clock());
});

// ---------------------------------------------------------------------------------------------
// The frame.

let fontsReady = false;
const perf = { total: 0, frames: 0, worst: 0 };

function frame(): void {
  const t = clock();
  // A scene's layout can change under it (the glade's bundle arriving).
  if ((scene.layoutKey?.() ?? "") !== layoutKey) resize();
  const colour = scene.pageColour?.() ?? "";
  if (colour !== backdrop) {
    backdrop = colour;
    document.body.style.backgroundColor = colour;
  }
  const started = params.perf ? performance.now() : 0;
  scene.render(t, new Uint32Array(worldImage.data.buffer), new Uint32Array(hudImage.data.buffer), fontsReady);
  if (params.perf) {
    const ms = performance.now() - started;
    // The first frames warm the JIT; count from the tenth.
    if (++perf.frames > 10) {
      perf.total += ms;
      perf.worst = Math.max(perf.worst, ms);
      document.body.dataset["renderMs"] = (perf.total / (perf.frames - 10)).toFixed(2);
      document.body.dataset["worstMs"] = perf.worst.toFixed(2);
    }
  }
  worldCtx.putImageData(worldImage, 0, 0);
  hudCtx.putImageData(hudImage, 0, 0);
  drawFade(t);
  hudCanvas.style.cursor = scene.cursor;
  document.body.classList.toggle("busy", scene.busy(t));
  requestAnimationFrame(frame);
}

document.body.dataset["scene"] = sceneId;
document.body.classList.toggle("bare", params.bare);
document.body.classList.toggle("still", params.still);
resize();
route();
// `?debug`: the app on `window`, for a test driver to find things by.
if (params.debug)
  Object.assign(window, {
    grove: {
      app,
      scene: () => scene,
      /** A glade landmark (`crown`, `cone`, `slot`) in CSS pixels, for a driver to tap. */
      glade: (name: "crown" | "cone" | "slot") => {
        const p = scene instanceof GladeScene ? scene.probe(name) : null;
        const g = name === "slot" ? hudG : worldG;
        return p ? { x: (p.x * g.scale + g.offX) / g.dpr, y: (p.y * g.scale + g.offY) / g.dpr } : null;
      },
      /** A HUD art pixel, or a world one, in CSS pixels, for a driver to tap. */
      hudToCss: (x: number, y: number) => ({
        x: (x * hudG.scale + hudG.offX) / hudG.dpr,
        y: (y * hudG.scale + hudG.offY) / hudG.dpr,
      }),
      worldToCss: (x: number, y: number) => ({
        x: (x * worldG.scale + worldG.offX) / worldG.dpr,
        y: (y * worldG.scale + worldG.offY) / worldG.dpr,
      }),
    },
  });

// The Minecraft font, as the website ships it (see engine/fonts/FONT_NOTICE.txt).
async function loadFonts(): Promise<void> {
  const faces = [
    new FontFace("Minecraft", `url(${regularUrl})`),
    new FontFace("Minecraft", `url(${boldUrl})`, { weight: "bold" }),
  ];
  const loaded = await Promise.all(faces.map((f) => f.load()));
  for (const f of loaded) document.fonts.add(f);
  fontsReady = true;
  menus.refresh();
}
void loadFonts();
requestAnimationFrame(frame);
