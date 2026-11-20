import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import "./art/critters.ts";
import { tailor, VILLAGERS } from "./art/skins.ts";
import { banner, bulbs, draw, flames, loadSkin, skinned, type Wearer } from "./engine/actors.ts";
import { ihash } from "./engine/rand.ts";
import { stage } from "./engine/render.ts";
import { play } from "./game/play.ts";
import type { Save } from "./game/state.ts";
import { buildBoard } from "./gen/board.ts";
import { buildCamp } from "./gen/camp.ts";
import { buildGlade, CX, CZ, ground, SUN } from "./gen/glade.ts";
import { beyond, buildHome, C as HC } from "./gen/home.ts";

const canvas = document.querySelector("canvas")!;
const query = new URLSearchParams(location.search);
// The game is the home grove; the other scenes are for looking at the world.
const which = query.get("scene") ?? "home";
type V3 = [number, number, number];
type View = { eye: V3; at: V3; fov: number };
const t0 = performance.now();

// Everyone's tiles must exist before the texture is built: the grove's own people, drawn here, and
// a member's own skin if one is there to load.
const cast: Record<string, Wearer | undefined> = {};
if (which === "camp") {
  for (const [name, v] of Object.entries(VILLAGERS)) cast[name] = skinned(name, tailor(v.outfit), false, v.extras);
  const skin = await loadSkin("./skins/notes.png");
  if (skin) cast.guest = skinned("guest", skin, true);
}
const camp = which === "camp" ? buildCamp(SUN, cast) : null;
const board = which === "board" ? buildBoard() : null;
let level = 0;
try {
  level = Math.min(
    12,
    Math.max(0, Math.floor(Number(JSON.parse(localStorage.getItem("grove.save.v2") ?? "{}").level) || 0)),
  );
} catch {
  // A fresh grove.
}
const home = which === "home" ? buildHome(level) : null;
const glade = camp || board || home ? null : buildGlade();
const world = camp?.world ?? board?.world ?? home?.world ?? glade!.world;

const VIEWS: Record<string, View> = {};
if (camp) {
  const [fx, fy, fz] = camp.fire;
  VIEWS.hero = { eye: camp.eye, at: camp.look, fov: 38 };
  VIEWS.close = { eye: [fx + 1.5, fy + 2.6, fz + 8.5], at: [fx - 0.3, fy + 1.3, fz - 2], fov: 36 };
  // Clear of the trunk that stands to the right of the fire.
  VIEWS.side = { eye: [fx + 6.5, fy + 3.6, fz + 11.5], at: [fx - 2, fy + 1.6, fz - 2], fov: 42 };
  VIEWS.tall = { eye: [fx + 2, fy + 6.5, fz + 22], at: [fx, fy + 6, fz - 2], fov: 50 };
} else if (board) {
  Object.assign(VIEWS, board.views);
} else if (glade) {
  const g = glade.main.ground;
  const deck = glade.deck;
  VIEWS.hero = { eye: [CX + 9, g + 17, CZ + 64], at: [CX + 2, g + 15, CZ], fov: 38 };
  VIEWS.tree = { eye: [CX + 20, g + 30, CZ + 150], at: [CX + 4, g + 50, CZ], fov: 42 };
  VIEWS.deck = { eye: [CX + 6, deck + 9, CZ + 34], at: [CX - 5, deck + 2, CZ + 5], fov: 34 };
  VIEWS.floor = { eye: [CX + 22, g + 5, CZ + 46], at: [CX + 4, g + 9, CZ + 6], fov: 40 };
  VIEWS.tall = { eye: [CX + 10, g + 30, CZ + 130], at: [CX + 2, g + 50, CZ], fov: 50 };
}

const flies: V3[] = camp
  ? camp.flies
  : board
    ? []
    : home
      ? Array.from({ length: 24 }, (_, i) => [
          HC + (ihash(i, 1, 0, 3) - 0.5) * 44,
          home.ground + 1 + ihash(i, 3, 0, 3) * 7,
          HC + (ihash(i, 2, 0, 3) - 0.5) * 44,
        ])
      : Array.from({ length: 90 }, (_, i) => {
          const a = ihash(i, 1, 0, 3) * 6.283;
          const r = 6 + ihash(i, 2, 0, 3) * 30;
          const x = CX + Math.cos(a) * r;
          const z = CZ + 6 + Math.sin(a) * r;
          return [x, ground(Math.round(x), Math.round(z)) + 1 + ihash(i, 3, 0, 3) * 9, z];
        });

const errors: string[] = [];
const night = Number(query.get("night") ?? (camp ? 0.7 : home ? 0.4 : 0));
const lit =
  camp ??
  board ??
  (home
    ? {
        fire: home.fire,
        glows: [
          { at: [home.fire[0], home.fire[1] + 0.9, home.fire[2]] as V3, size: 9, flicker: true },
          { at: [HC + 10.5, home.ground + 1.5, HC + 5.5] as V3, size: 3.2, flicker: false },
        ],
      }
    : null);
// Everyone at the camp's fire throws a shadow from it: an upright rod as tall and as wide as the figure.
const casters = (camp?.actors ?? []).map((a) => {
  const k = (a.scale ?? 1) / 16;
  const top = Math.max(...a.parts.map((p) => p.box[4]));
  const wide = Math.max(...a.parts.map((p) => Math.max(Math.abs(p.box[0]), Math.abs(p.box[3]))));
  return { at: a.pos, height: Math.max(0.3, top * k), radius: Math.min(0.42, Math.max(0.2, wide * k * 0.75)) };
});
const s = stage(canvas, {
  world,
  sun: SUN,
  flies,
  night,
  casters,
  ...(home ? { beyond: beyond() } : {}),
  ...(lit ? { glows: lit.glows, fire: lit.fire } : {}),
});
s.renderer.debug.onShaderError = (gl, _program, vs, fs) => {
  errors.push(String(gl.getShaderInfoLog(vs)), String(gl.getShaderInfoLog(fs)));
};
const t1 = performance.now();
const controls = new OrbitControls(s.camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.53;
if (home) {
  // The grove is turned and looked into, never left: no sliding away, no going under the ground or off into the sky.
  controls.enablePan = false;
  controls.minDistance = 7;
  controls.maxDistance = 36;
  controls.minPolarAngle = 0.7;
  controls.maxPolarAngle = 1.5;
  controls.rotateSpeed = 0.6;
}

function view(name: string): void {
  const v = VIEWS[name];
  if (!v) return;
  s.camera.position.set(...v.eye);
  controls.target.set(...v.at);
  s.camera.fov = v.fov;
  s.camera.updateProjectionMatrix();
  controls.update();
}
view(query.get("view") ?? "hero");
s.resize();
const game = home ? play({ canvas, stage: s, controls, world, home, night }) : null;

let frames = 0;
const snaps: ((png: string) => void)[] = [];
/** The frame just drawn as a PNG, read pixel by pixel: asking the WebGL canvas itself can return half a frame. */
function picture(): string {
  const gl = s.renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const flat = document.createElement("canvas");
  flat.width = w;
  flat.height = h;
  const image = new ImageData(w, h);
  for (let y = 0; y < h; y++) image.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
  flat.getContext("2d")!.putImageData(image, 0, 0);
  return flat.toDataURL("image/png");
}

let before = performance.now();
let slow = 0.016;
let counted = 0;
function loop(now: number): void {
  const time = now / 1000;
  // A frame that took too long (a tab coming back) is not played out as one great leap.
  const dt = Math.min(0.1, (now - before) / 1000);
  before = now;
  // A device that cannot keep up gets a softer picture, not a slower game: if frames run long for a
  // while, the picture is drawn with fewer pixels, down to a floor.
  if (dt < 0.25) {
    slow = slow * 0.97 + dt * 0.03;
    if (++counted > 90 && slow > 0.024 && s.sharpness > 0.6) {
      s.sharpness = Math.max(0.6, s.sharpness * 0.8);
      counted = 0;
      slow = 0.016;
    }
  }
  s.resize();
  s.dyn.reset();
  if (!game || game.free) controls.update();
  if (camp) {
    for (const a of camp.actors) {
      a.update?.(time);
      draw(s.dyn, world, a);
    }
    flames(s.dyn, camp.fire, time);
    camp.banners.forEach((b, i) => banner(s.dyn, world, b.at, b.yaw, time, i * 2.1));
    for (const line of camp.strings) bulbs(s.dyn, world, line.a, line.b, line.points);
  }
  if (board) flames(s.dyn, board.fire, time);
  game?.frame(now, dt, time);
  s.fogStart = Math.max(26, s.camera.position.distanceTo(controls.target) * 0.85);
  s.frame(time);
  if (snaps.length) {
    const png = picture();
    for (const done of snaps.splice(0)) done(png);
  }
  if (++frames === 3) document.title = "ready";
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

const gl = s.renderer.getContext();
const dbg = gl.getExtension("WEBGL_debug_renderer_info");
Object.assign(window, {
  grove: {
    view,
    /** Puts the camera anywhere, for review shots. */
    look(eye: V3, at: V3, fov = 40): void {
      s.camera.position.set(...eye);
      controls.target.set(...at);
      s.camera.fov = fov;
      s.camera.updateProjectionMatrix();
      controls.update();
    },
    /** Puts the grove in a given state, and taps the world, for review. */
    set: (next: Save): void => game?.set(next),
    tap: (x: number, y: number): void => game?.tap(x, y),
    burn: (): void => game?.burn(),
    snap: () => new Promise<string>((done) => snaps.push(done)),
    errors,
    s,
    THREE,
    stats: () => ({
      frames,
      build: Math.round(t1 - t0),
      quads: s.dyn.quads,
      tris: s.renderer.info.render.triangles,
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "?",
    }),
  },
});
