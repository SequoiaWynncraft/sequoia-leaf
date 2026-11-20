import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { ihash } from "./engine/rand.ts";
import { stage } from "./engine/render.ts";
import { buildGlade, CX, CZ, ground, SUN } from "./gen/glade.ts";

const canvas = document.querySelector("canvas")!;
const t0 = performance.now();
const { world, main, deck } = buildGlade();
const t1 = performance.now();

const flies: [number, number, number][] = [];
for (let i = 0; i < 90; i++) {
  const a = ihash(i, 1, 0, 3) * 6.283;
  const r = 6 + ihash(i, 2, 0, 3) * 30;
  const x = CX + Math.cos(a) * r;
  const z = CZ + 6 + Math.sin(a) * r;
  flies.push([x, ground(Math.round(x), Math.round(z)) + 1 + ihash(i, 3, 0, 3) * 9, z]);
}

const errors: string[] = [];
const s = stage(canvas, world, SUN, flies);
s.renderer.debug.onShaderError = (gl, _program, vs, fs) => {
  errors.push(String(gl.getShaderInfoLog(vs)), String(gl.getShaderInfoLog(fs)));
};
const t2 = performance.now();
const controls = new OrbitControls(s.camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.53;

const g = main.ground;
const VIEWS: Record<string, { eye: [number, number, number]; at: [number, number, number]; fov: number }> = {
  hero: { eye: [CX + 9, g + 17, CZ + 64], at: [CX + 2, g + 15, CZ], fov: 38 },
  tree: { eye: [CX + 20, g + 30, CZ + 150], at: [CX + 4, g + 50, CZ], fov: 42 },
  deck: { eye: [CX + 6, deck + 9, CZ + 34], at: [CX - 5, deck + 2, CZ + 5], fov: 34 },
  floor: { eye: [CX + 22, g + 5, CZ + 46], at: [CX + 4, g + 9, CZ + 6], fov: 40 },
  tall: { eye: [CX + 10, g + 30, CZ + 130], at: [CX + 2, g + 50, CZ], fov: 50 },
};
function view(name: string): void {
  const v = VIEWS[name] ?? VIEWS.hero!;
  s.camera.position.set(...v.eye);
  controls.target.set(...v.at);
  s.camera.fov = v.fov;
  s.camera.updateProjectionMatrix();
  controls.update();
}
view(new URLSearchParams(location.search).get("view") ?? "hero");

let frames = 0;
function loop(now: number): void {
  s.resize();
  controls.update();
  s.fogStart = s.camera.position.distanceTo(controls.target) * 0.85;
  s.frame(now / 1000);
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
      mesh: Math.round(t2 - t1),
      tris: s.renderer.info.render.triangles,
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "?",
    }),
  },
});
