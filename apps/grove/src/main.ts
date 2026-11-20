import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { tailor, VILLAGERS } from "./art/skins.ts";
import { banner, bulbs, draw, flames, loadSkin, skinned, type Wearer } from "./engine/actors.ts";
import { ihash } from "./engine/rand.ts";
import { stage } from "./engine/render.ts";
import { buildBoard } from "./gen/board.ts";
import { buildCamp } from "./gen/camp.ts";
import { buildGlade, CX, CZ, ground, SUN } from "./gen/glade.ts";

const canvas = document.querySelector("canvas")!;
const query = new URLSearchParams(location.search);
const which = query.get("scene") ?? "camp";
type View = { eye: [number, number, number]; at: [number, number, number]; fov: number };
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
const glade = camp || board ? null : buildGlade();
const world = camp?.world ?? board?.world ?? glade!.world;

const VIEWS: Record<string, View> = {};
if (camp) {
  const [fx, fy, fz] = camp.fire;
  VIEWS.hero = { eye: camp.eye, at: camp.look, fov: 38 };
  VIEWS.close = { eye: [fx + 1.5, fy + 2.6, fz + 8.5], at: [fx - 0.3, fy + 1.3, fz - 2], fov: 36 };
  VIEWS.side = { eye: [fx + 11, fy + 4, fz + 9], at: [fx - 2, fy + 1.6, fz - 2], fov: 38 };
  VIEWS.tall = { eye: [fx + 2, fy + 6.5, fz + 22], at: [fx, fy + 6, fz - 2], fov: 50 };
} else if (board) {
  Object.assign(VIEWS, board.views);
} else {
  const g = glade!.main.ground;
  const deck = glade!.deck;
  VIEWS.hero = { eye: [CX + 9, g + 17, CZ + 64], at: [CX + 2, g + 15, CZ], fov: 38 };
  VIEWS.tree = { eye: [CX + 20, g + 30, CZ + 150], at: [CX + 4, g + 50, CZ], fov: 42 };
  VIEWS.deck = { eye: [CX + 6, deck + 9, CZ + 34], at: [CX - 5, deck + 2, CZ + 5], fov: 34 };
  VIEWS.floor = { eye: [CX + 22, g + 5, CZ + 46], at: [CX + 4, g + 9, CZ + 6], fov: 40 };
  VIEWS.tall = { eye: [CX + 10, g + 30, CZ + 130], at: [CX + 2, g + 50, CZ], fov: 50 };
}

const flies: [number, number, number][] = camp
  ? camp.flies
  : board
    ? []
    : Array.from({ length: 90 }, (_, i) => {
        const a = ihash(i, 1, 0, 3) * 6.283;
        const r = 6 + ihash(i, 2, 0, 3) * 30;
        const x = CX + Math.cos(a) * r;
        const z = CZ + 6 + Math.sin(a) * r;
        return [x, ground(Math.round(x), Math.round(z)) + 1 + ihash(i, 3, 0, 3) * 9, z];
      });

const errors: string[] = [];
const night = Number(query.get("night") ?? (camp ? 0.6 : 0));
const lit = camp ?? board;
const s = stage(canvas, { world, sun: SUN, flies, night, ...(lit ? { glows: lit.glows, fire: lit.fire } : {}) });
s.renderer.debug.onShaderError = (gl, _program, vs, fs) => {
  errors.push(String(gl.getShaderInfoLog(vs)), String(gl.getShaderInfoLog(fs)));
};
const t1 = performance.now();
const controls = new OrbitControls(s.camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.53;

function view(name: string): void {
  const v = VIEWS[name] ?? VIEWS.hero!;
  s.camera.position.set(...v.eye);
  controls.target.set(...v.at);
  s.camera.fov = v.fov;
  s.camera.updateProjectionMatrix();
  controls.update();
}
view(query.get("view") ?? "hero");

let frames = 0;
function loop(now: number): void {
  const time = now / 1000;
  s.resize();
  controls.update();
  s.fogStart = Math.max(26, s.camera.position.distanceTo(controls.target) * 0.85);
  s.dyn.reset();
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
  s.frame(time);
  if (++frames === 3) document.title = "ready";
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

const gl = s.renderer.getContext();
const dbg = gl.getExtension("WEBGL_debug_renderer_info");
Object.assign(window, {
  grove: {
    view,
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
