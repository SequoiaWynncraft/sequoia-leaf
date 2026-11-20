import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { tailor, VILLAGERS } from "./art/skins.ts";
import { banner, bulbs, draw, flames, leafling, loadSkin, skinned, type Wearer } from "./engine/actors.ts";
import { ihash } from "./engine/rand.ts";
import { stage } from "./engine/render.ts";
import { hud } from "./game/hud.ts";
import * as game from "./game/state.ts";
import { buildBoard } from "./gen/board.ts";
import { buildCamp } from "./gen/camp.ts";
import { buildGlade, CX, CZ, ground, SUN } from "./gen/glade.ts";
import { beyond, buildHome, C as HC, plant, treeHeight } from "./gen/home.ts";

const canvas = document.querySelector("canvas")!;
const query = new URLSearchParams(location.search);
// The game is the home grove; the other scenes are for looking at the world.
const which = query.get("scene") ?? "home";
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
// The grove as it was left, with the Sap it made since.
const back = game.advance(game.load(localStorage, Date.now()), Date.now());
let save = back.save;
const home = which === "home" ? buildHome(save.level) : null;
const glade = camp || board || home ? null : buildGlade();
const world = camp?.world ?? board?.world ?? home?.world ?? glade!.world;
/**
 * Where the grove is looked at from: across the fire to the foot of the tree, from a little above,
 * a step further back as the tree grows. The tree's height is for the growing ceremony to show.
 */
const homeView = (level: number): View => {
  const g = home!.ground;
  const d = 15 + level * 0.9;
  const at: [number, number, number] = [HC + 3.2, g + 2.4 + level * 0.25, HC + 2.6];
  return { eye: [at[0] + d * 0.42, at[1] + d * 0.3, at[2] + d * 0.86], at, fov: 46 };
};

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
} else if (home) {
  VIEWS.hero = homeView(save.level);
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
const night = Number(query.get("night") ?? (camp ? 0.7 : home ? 0.35 : 0));
const lit =
  camp ??
  board ??
  (home
    ? {
        fire: home.fire,
        glows: [
          { at: [home.fire[0], home.fire[1] + 0.9, home.fire[2]] as [number, number, number], size: 9, flicker: true },
          { at: [HC + 10.5, home.ground + 1.5, HC + 5.5] as [number, number, number], size: 3.2, flicker: false },
        ],
      }
    : null);
// Everyone at the fire throws a shadow from it: an upright rod as tall and as wide as the figure.
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
  controls.minDistance = 8;
  controls.maxDistance = 34;
  controls.minPolarAngle = 0.75;
  controls.maxPolarAngle = 1.5;
  controls.rotateSpeed = 0.6;
}

function view(name: string): void {
  const v = VIEWS[name] ?? VIEWS.hero!;
  s.camera.position.set(...v.eye);
  controls.target.set(...v.at);
  s.camera.fov = v.fov;
  s.camera.updateProjectionMatrix();
  controls.update();
}
view(query.get("view") ?? "hero");

// ---------- the game: Sap ticking up, and what it buys ----------

/** A ceremony in progress takes the camera; `null` when the player has it. */
let rite: ((now: number) => void) | null = null;
let arrived = -1e9;
const ease = (t: number): number => t * t * (3 - 2 * t);
const face = home
  ? hud(document.querySelector<HTMLElement>("#hud")!, {
      grow() {
        const next = game.grow(save);
        if (!next || rite) return;
        const before = game.rate(save);
        save = next;
        keep();
        // The ceremony: the grove goes gold, the tree grows behind the light, and the camera
        // climbs the new trunk to its crown and comes back down to the fire.
        const from = VIEWS.hero!;
        const to = homeView(save.level);
        const top = home!.ground + treeHeight(save.level) * 0.72;
        const start = performance.now();
        let grown = false;
        face!.veil(
          `Ring ${save.level + 1}`,
          game.stage(save.level),
          `+${game.short(Math.max(1, game.rate(save) - before))} sap a second`,
        );
        rite = (now) => {
          const t = (now - start) / 1000;
          if (!grown && t > 0.45) {
            grown = true;
            plant(world, save.level);
            s.remesh();
            VIEWS.hero = to;
          }
          // Up for a second and a half, a held breath at the crown, and down again.
          const up =
            t < 0.45 ? 0 : t < 2.1 ? ease((t - 0.45) / 1.65) : t < 2.7 ? 1 : 1 - ease(Math.min(1, (t - 2.7) / 1.5));
          const base = grown ? to : from;
          const lift = (top - base.at[1]) * up;
          s.camera.position.set(base.eye[0] + up * 6, base.eye[1] + lift * 0.55, base.eye[2] + up * 12);
          s.camera.lookAt(base.at[0], base.at[1] + lift, base.at[2]);
          if (t > 4.2) {
            rite = null;
            view("hero");
          }
        };
      },
      welcome() {
        const next = game.welcome(save);
        if (!next || rite) return;
        save = next;
        arrived = performance.now();
        face!.toast("A leafling has come to stay");
        keep();
      },
    })
  : null;
const keep = (): void => {
  game.store(localStorage, save);
  face?.show(save);
};
let shown = 0;
/** Counts the Sap made since the last frame, and shows and saves it now and then. */
function tick(now: number): void {
  save = game.advance(save, Date.now()).save;
  if (now - shown < 250) return;
  shown = now;
  face?.show(save);
  if (Math.floor(now / 5000) !== Math.floor((now - 250) / 5000)) game.store(localStorage, save);
}
if (face) {
  face.show(save);
  if (back.awayMs > 60_000 && back.gained >= 1) {
    const mins = Math.round(Math.min(back.awayMs, game.AWAY_CAP_MS) / 60_000);
    face.card("Welcome back", [
      `Your tree made ${game.short(back.gained)} sap`,
      `in ${mins < 90 ? `${mins} minutes` : `${Math.round(mins / 60)} hours`}${back.capped ? " (it rests after a day)" : ""}`,
    ]);
  }
  // A tap on the world, not a drag, shakes some Sap loose.
  let down: [number, number] | null = null;
  canvas.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  canvas.addEventListener("pointerup", (e) => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) {
      if (rite) return;
      face.pop(e.clientX, e.clientY, `+${game.short(game.tapGain(save))}`);
      save = game.tap(save);
      face.show(save);
    }
    down = null;
  });
  addEventListener("pagehide", () => game.store(localStorage, save));
}

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
function loop(now: number): void {
  const time = now / 1000;
  s.resize();
  if (rite) rite(now);
  else controls.update();
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
  if (home) {
    flames(s.dyn, home.fire, time);
    for (let i = 0; i < Math.min(save.leaflings, home.spots.length); i++) {
      const at = home.spots[i]!;
      const a = leafling(at, Math.atan2(home.fire[0] - at[0], home.fire[2] - at[2]), i * 1.7);
      a.update?.(time);
      // The newest one pops up out of the ground, overshoots and settles.
      const age = i === save.leaflings - 1 ? (now - arrived) / 600 : 1;
      if (age < 1) a.scale = (a.scale ?? 1) * (age < 0.7 ? (age / 0.7) * 1.25 : 1.25 - ((age - 0.7) / 0.3) * 0.25);
      draw(s.dyn, world, a);
    }
    tick(now);
  }
  s.frame(time);
  // A picture of the frame just drawn, for the review scripts.
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
    look(eye: [number, number, number], at: [number, number, number], fov = 40): void {
      s.camera.position.set(...eye);
      controls.target.set(...at);
      s.camera.fov = fov;
      s.camera.updateProjectionMatrix();
      controls.update();
    },
    /** Puts the grove in a given state, for review. */
    set(next: game.Save): void {
      if (!home) return;
      save = { ...next, seen: Date.now() };
      plant(world, save.level);
      s.remesh();
      VIEWS.hero = homeView(save.level);
      view("hero");
      keep();
    },
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
