/**
 * The window onto the map: where it looks, how it eases from place to place, and everything drawn
 * each frame over the painted ground: lights, smoke, banners, lanterns, crabs and the people.
 */
import * as fx from "./fx.ts";
import {
  cinfy,
  type Crab,
  crabs,
  DROP_AT,
  drops,
  flags,
  lanterns,
  type Member,
  members,
  owned,
  raids,
  state,
  stray,
  works,
  you,
} from "./game.ts";
import type { Lands } from "./lands.ts";
import { P } from "./palette.ts";
import { BOAT, CRAB, type Ctx, ICONS, LANTERN, makeCanvas } from "./pix.ts";
import { clamp, easeInOut, easeOutBack, lerp, noise, smoothstep } from "./rand.ts";
import { FH, FRAME, FW } from "./skins.ts";
import type { Terrain } from "./terrain.ts";
import {
  CAMP,
  FIRE,
  GATES,
  H,
  type Hue,
  LANDS,
  LIGHTHOUSE,
  MILL,
  NODES,
  type NodeId,
  type Place,
  PLACES,
  type Pt,
  ROPE,
  ropeSlot,
  STONES,
  W,
  WORKS,
} from "./world.ts";

export const UI_FONT = '"Nunito", ui-rounded, "Segoe UI", "Trebuchet MS", system-ui, sans-serif';
export const MAP_FONT = '"Iowan Old Style", "Palatino Linotype", Palatino, "URW Palladio L", "Book Antiqua", Georgia, serif';

// ---------- the camera ----------

export const cam = { x: 478, y: 450, z: 1.5 };
/** The window's size, and how much of each edge the interface covers; the map centres in what is left. */
export const view = {
  w: 1,
  h: 1,
  dpr: 1,
  l: 0,
  t: 0,
  r: 0,
  b: 0,
  wantL: 0,
  wantT: 0,
  wantR: 0,
  wantB: 0,
  /** How much of the right and bottom is under a solid strip of interface: the map's edge may slide in under it. */
  coverR: 0,
  coverB: 0,
};
type Flight = { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t: number; dur: number };
let flight: Flight | null = null;
let following: Member | null = null;
let followZoom = 3;
const drift = { x: 0, y: 0 };
let zoomGoal: { z: number; sx: number; sy: number } | null = null;
export const MAX_ZOOM = 6;

const midX = (): number => (view.l + view.w - view.r) / 2;
const midY = (): number => (view.t + view.h - view.b) / 2;
export const minZoom = (): number => Math.max((view.w - view.coverR) / W, (view.h - view.coverB) / H) * 1.001;
export const toScreen = (x: number, y: number): Pt => ({ x: (x - cam.x) * cam.z + midX(), y: (y - cam.y) * cam.z + midY() });
export const toMap = (sx: number, sy: number): Pt => ({ x: (sx - midX()) / cam.z + cam.x, y: (sy - midY()) / cam.z + cam.y });

function hold(): void {
  cam.z = clamp(cam.z, minZoom(), MAX_ZOOM);
  const loX = midX() / cam.z;
  const hiX = W - (view.w - view.coverR - midX()) / cam.z;
  const loY = midY() / cam.z;
  const hiY = H - (view.h - view.coverB - midY()) / cam.z;
  cam.x = loX > hiX ? W / 2 : clamp(cam.x, loX, hiX);
  cam.y = loY > hiY ? H / 2 : clamp(cam.y, loY, hiY);
}

/** Eases the map to a spot. A long way goes up and over: out a little, across, and back in. */
export function flyTo(x: number, y: number, z = cam.z, dur?: number): void {
  const d = Math.hypot(x - cam.x, y - cam.y);
  following = null;
  zoomGoal = null;
  drift.x = drift.y = 0;
  flight = { x0: cam.x, y0: cam.y, z0: cam.z, x1: x, y1: y, z1: clamp(z, minZoom(), MAX_ZOOM), t: 0, dur: dur ?? clamp(0.5 + d / 700, 0.55, 1.35) };
}
export function follow(m: Member | null, zoom = 3): void {
  following = m;
  followZoom = zoom;
  flight = null;
  zoomGoal = null;
}
export const isFollowing = (): boolean => following !== null;
/** The player takes hold of the map: it stops going anywhere by itself. */
export function grab(): void {
  flight = null;
  following = null;
  zoomGoal = null;
  drift.x = drift.y = 0;
}
export function dragBy(dx: number, dy: number): void {
  cam.x -= dx / cam.z;
  cam.y -= dy / cam.z;
  hold();
}
export function fling(vx: number, vy: number): void {
  drift.x = vx;
  drift.y = vy;
}
/** Zooms by a factor about a point on screen, which stays under the finger. */
export function zoomBy(factor: number, sx: number, sy: number, smooth = true): void {
  flight = null;
  const from = zoomGoal?.z ?? cam.z;
  const z = clamp(from * factor, minZoom(), MAX_ZOOM);
  if (smooth) zoomGoal = { z, sx, sy };
  else zoomAbout(z, sx, sy);
}
function zoomAbout(z: number, sx: number, sy: number): void {
  const before = toMap(sx, sy);
  cam.z = z;
  const after = toMap(sx, sy);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
  hold();
}

export function updateCamera(dt: number): void {
  const k = 1 - Math.exp(-dt * 9);
  view.l += (view.wantL - view.l) * k;
  view.t += (view.wantT - view.t) * k;
  view.r += (view.wantR - view.r) * k;
  view.b += (view.wantB - view.b) * k;
  if (flight) {
    flight.t += dt;
    const t = Math.min(1, flight.t / flight.dur);
    const e = easeInOut(t);
    const far = Math.hypot(flight.x1 - flight.x0, flight.y1 - flight.y0);
    const up = 1 - Math.min(0.38, far / 1500) * Math.sin(t * Math.PI);
    cam.x = lerp(flight.x0, flight.x1, e);
    cam.y = lerp(flight.y0, flight.y1, e);
    cam.z = Math.max(minZoom(), Math.exp(lerp(Math.log(flight.z0), Math.log(flight.z1), e)) * up);
    if (t >= 1) flight = null;
  } else if (following) {
    const f = 1 - Math.exp(-dt * 5);
    cam.x += (following.x - cam.x) * f;
    cam.y += (following.y - 6 - cam.y) * f;
    cam.z *= Math.exp((Math.log(followZoom) - Math.log(cam.z)) * (1 - Math.exp(-dt * 2.2)));
  } else {
    if (zoomGoal) {
      const z = cam.z * Math.exp((Math.log(zoomGoal.z) - Math.log(cam.z)) * (1 - Math.exp(-dt * 14)));
      zoomAbout(z, zoomGoal.sx, zoomGoal.sy);
      if (Math.abs(zoomGoal.z - cam.z) < 0.004) zoomGoal = null;
    }
    if (drift.x || drift.y) {
      cam.x -= (drift.x * dt) / cam.z;
      cam.y -= (drift.y * dt) / cam.z;
      const slow = Math.exp(-dt * 5);
      drift.x *= slow;
      drift.y *= slow;
      if (Math.hypot(drift.x, drift.y) < 6) drift.x = drift.y = 0;
    }
  }
  hold();
}

// ---------- light, and pictures made once ----------

const GLOW_RGB: Record<Hue, string> = {
  amber: "255,186,96",
  coral: "246,124,92",
  violet: "206,96,196",
  teal: "92,214,204",
  cream: "255,240,204",
};
const GLOW = Object.fromEntries(
  (Object.keys(GLOW_RGB) as Hue[]).map((hue) => {
    const [c, g] = makeCanvas(64, 64);
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${GLOW_RGB[hue]},0.85)`);
    grad.addColorStop(0.3, `rgba(${GLOW_RGB[hue]},0.4)`);
    grad.addColorStop(1, `rgba(${GLOW_RGB[hue]},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return [hue, c];
  }),
) as Record<Hue, HTMLCanvasElement>;

const PORTAL_COLS: Record<Hue, readonly string[]> = {
  violet: [P.plum1, P.plum3, P.rose, "#f3c4e4"],
  teal: ["#1f4a5a", "#2f8f96", P.teal, "#d6fbf2"],
  coral: [P.red0, P.red2, P.coral, P.gold2],
  amber: [P.bark1, P.gold0, P.gold1, P.cream],
  cream: [P.s0, P.s2, P.s3, P.cream],
};
/** The light inside a gate, turning: a few frames per colour, drawn once. */
const PORTAL = Object.fromEntries(
  (["violet", "teal", "coral"] as const).map((hue) => {
    const frames: HTMLCanvasElement[] = [];
    for (let f = 0; f < 8; f++) {
      const [c, g] = makeCanvas(12, 21);
      const cols = PORTAL_COLS[hue];
      for (let y = 0; y < 21; y++)
        for (let x = 0; x < 12; x++) {
          if (y < 2 && (x < 1 || x > 10)) continue;
          const dx = x - 5.5;
          const dy = (y - 11) * 0.8;
          const d = Math.hypot(dx, dy);
          const a = Math.atan2(dy, dx);
          const v = Math.sin(d * 1.1 - (f / 8) * 6.283 + a * 2) * 0.5 + 0.5;
          const core = Math.max(0, 1 - d / 5);
          const tone = v * 0.7 + core * 0.9;
          g.fillStyle = cols[tone > 1.05 ? 3 : tone > 0.62 ? 2 : tone > 0.3 ? 1 : 0] as string;
          g.fillRect(x, y, 1, 1);
        }
      frames.push(c);
    }
    return [hue, frames];
  }),
) as Record<"violet" | "teal" | "coral", HTMLCanvasElement[]>;

/** Things in the scene that were touched and are still reacting. */
export const poke = { mill: 0, rope: 0, light: 0, stones: 0, boat: 0, fire: 0 };
let terrain: Terrain;
let lands: Lands;
const fireflies: Pt[] = [];
export function setScene(t: Terrain, l: Lands): void {
  terrain = t;
  lands = l;
  // Fireflies keep to the woods and the long grass, thickest near the grove.
  for (let n = 0; fireflies.length < 150 && n < 4000; n++) {
    const far = n % 3 === 0;
    const x = Math.floor(far ? Math.random() * W : 500 + (Math.random() - 0.5) * 420);
    const y = Math.floor(far ? Math.random() * H : 350 + (Math.random() - 0.5) * 340);
    if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
    const here = t.kind[y * W + x];
    if (here === 3 || here === 4) fireflies.push({ x, y });
  }
}

let smokeClock = 0;
/** Smoke, embers and the slow unwinding of whatever was poked. Called once a frame. */
export function ambient(dt: number): void {
  smokeClock += dt;
  if (smokeClock > 0.3) {
    smokeClock = 0;
    fx.smoke(WORKS.chimneyX, WORKS.chimneyY - 3);
    if (Math.random() < 0.3) fx.smoke(441 + Math.random(), 300, "#a898b8");
    if (Math.random() < 0.3) fx.smoke(577, 304, "#a898b8");
    if (Math.random() < 0.5) fx.sparks(FIRE.x + (Math.random() - 0.5) * 3, FIRE.y - 5, [P.amber, P.gold2], 1, 9);
    if (Math.random() < 0.25) fx.sparks(CAMP.fireX, CAMP.fireY - 4, [P.amber], 1, 7);
  }
  poke.mill = Math.max(0, poke.mill - dt * 0.4);
  poke.rope = Math.max(0, poke.rope - dt * 0.6);
  poke.light = Math.max(0, poke.light - dt * 0.3);
  poke.stones = Math.max(0, poke.stones - dt * 0.5);
  poke.boat = Math.max(0, poke.boat - dt * 0.8);
  poke.fire = Math.max(0, poke.fire - dt * 1.2);
  millAngle += dt * (0.55 + poke.mill * 5);
}
let millAngle = 0;

// ---------- where people stand when they are at a place ----------

/** A member's own spot at a node, in map pixels from it: used when the map is close. */
function spot(node: NodeId, i: number, n: number): Pt {
  switch (node) {
    case "fire": {
      // Round the back and sides of the fire, never in front of it.
      const a = -Math.PI / 2 + ((i + 0.5) / n - 0.5) * 4.5;
      return { x: Math.cos(a) * 16, y: Math.sin(a) * 9 - 7 };
    }
    case "gateA":
    case "gateB":
    case "gateC":
      return { x: (i - (n - 1) / 2) * 9, y: 2 + (i % 2) * 4 };
    case "treasury":
      return { x: 2 + i * 8, y: (i % 2) * 3 };
    case "board":
    case "market":
      return { x: (i - (n - 1) / 2) * 9, y: (i % 2) * 4 };
    case "camp":
      return { x: 4 + i * 9, y: (i % 2) * 5 };
    default: {
      const a = i * 2.4 + 0.6;
      const r = i === 0 && n === 1 ? 0 : 9 + (i % 3) * 4;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6 };
    }
  }
}
/** A member's place in the row of faces over a node, in screen pixels: used from high up. */
function rowSpot(i: number, n: number, step: number): Pt {
  const per = n > 5 ? Math.ceil(n / 2) : n;
  const row = Math.floor(i / per);
  const inRow = row === 0 ? Math.min(per, n) : n - per;
  return { x: (i % per) * step - ((inRow - 1) * step) / 2, y: -row * (step + 4) };
}

// ---------- taps ----------

export type Hit =
  | { kind: "member"; m: Member }
  | { kind: "stray" }
  | { kind: "crab"; c: Crab }
  | { kind: "place"; p: Place }
  | { kind: "rope" }
  | { kind: "mill" }
  | { kind: "light" }
  | { kind: "stones" }
  | { kind: "boat" }
  | { kind: "flag"; land: number }
  | { kind: "ground"; x: number; y: number; land: number; what: number };

const labelBox: { p: Place; x0: number; y0: number; x1: number; y1: number }[] = [];
/** Where the boat is just now. */
export const boat = { x: 964, y: 452 };
const tierAlpha = (p: Place): number =>
  p.tier === "both" ? 1 : p.tier === "far" ? 1 - smoothstep(2.3, 2.75, cam.z) : smoothstep(2.3, 2.75, cam.z);

export function pickAt(sx: number, sy: number): Hit {
  let best: Member | null = null;
  let bd = Number.POSITIVE_INFINITY;
  for (const m of [...members, cinfy]) {
    const d = Math.hypot(sx - m.sx, sy - m.sy);
    if (d < m.sr && d < bd) {
      bd = d;
      best = m;
    }
  }
  if (best && !best.npc) return { kind: "member", m: best };
  const at = toMap(sx, sy);
  const reach = (r: number): number => Math.max(r, 18 / cam.z);
  if (Math.hypot(at.x - stray.x, at.y - stray.y + 2) < reach(5)) return { kind: "stray" };
  if (cam.z >= 2)
    for (const c of crabs) if (Math.hypot(at.x - c.x, at.y - c.y + 1) < reach(4) * 0.8) return { kind: "crab", c };
  for (const b of labelBox) if (sx >= b.x0 && sx <= b.x1 && sy >= b.y0 && sy <= b.y1) return { kind: "place", p: b.p };
  if (best?.npc) return { kind: "place", p: PLACES.find((p) => p.id === "treasury") as Place };
  if (cam.z >= 2.2 && at.x > ROPE.ax - 2 && at.x < ROPE.bx + 2) {
    const t = (at.x - ROPE.ax) / (ROPE.bx - ROPE.ax);
    if (Math.abs(at.y - (ROPE.ay + Math.sin(t * Math.PI) * ROPE.sag + 2)) < 5) return { kind: "rope" };
  }
  let near: Place | null = null;
  let nd = Number.POSITIVE_INFINITY;
  for (const p of PLACES) {
    if (tierAlpha(p) < 0.5) continue;
    const d = Math.hypot(at.x - p.hx, at.y - p.hy);
    if (d < reach(p.hr) && d / p.hr < nd) {
      nd = d / p.hr;
      near = p;
    }
  }
  if (near) return { kind: "place", p: near };
  for (let i = 0; i < LANDS.length; i++) {
    const l = LANDS[i] as (typeof LANDS)[number];
    if ((flags[i] as (typeof flags)[number]).h > 0.2 && Math.abs(at.x - l.bx - 3) < reach(6) && Math.abs(at.y - l.by + 8) < reach(9)) return { kind: "flag", land: i };
  }
  if (Math.hypot(at.x - MILL.x, at.y - MILL.y + 14) < reach(15)) return { kind: "mill" };
  if (Math.hypot(at.x - LIGHTHOUSE.x, at.y - LIGHTHOUSE.y + 16) < reach(13)) return { kind: "light" };
  if (Math.hypot(at.x - STONES.x, at.y - STONES.y + 3) < reach(16)) return { kind: "stones" };
  if (Math.hypot(at.x - boat.x, at.y - boat.y + 4) < reach(8)) return { kind: "boat" };
  const x = clamp(Math.round(at.x), 0, W - 1);
  const y = clamp(Math.round(at.y), 0, H - 1);
  return { kind: "ground", x: at.x, y: at.y, land: terrain.landId[y * W + x] as number, what: terrain.kind[y * W + x] as number };
}

/** What is under the pointer that would answer a tap, for the cursor. */
export function hot(sx: number, sy: number): boolean {
  const h = pickAt(sx, sy);
  return h.kind !== "ground";
}

// ---------- drawing ----------

const widths = new Map<string, number>();
function textWidth(g: Ctx, font: string, text: string): number {
  const key = font + text;
  let w = widths.get(key);
  if (w === undefined) {
    g.font = font;
    w = g.measureText(text).width;
    widths.set(key, w);
  }
  return w;
}

function plate(g: Ctx, x: number, y: number, text: string, alpha: number, gold: boolean, face: HTMLCanvasElement | null): { x0: number; y0: number; x1: number; y1: number } {
  const font = `italic 600 13px ${MAP_FONT}`;
  const tw = textWidth(g, font, text);
  const extra = face ? 20 : 0;
  const w = Math.round(tw + 16 + extra);
  const h = 20;
  const x0 = Math.round(x - w / 2);
  const y0 = Math.round(y - h);
  g.globalAlpha = alpha;
  g.fillStyle = P.ink;
  g.fillRect(x0 - 2, y0 - 2, w + 4, h + 4);
  g.fillStyle = gold ? P.gold1 : P.plum2;
  g.fillRect(x0 - 1, y0 - 1, w + 2, h + 2);
  g.fillStyle = P.plum0;
  g.fillRect(x0 + 1, y0 + 1, w - 2, h - 2);
  g.fillStyle = P.ink;
  g.fillRect(Math.round(x) - 3, y0 + h + 2, 6, 2);
  g.fillRect(Math.round(x) - 1, y0 + h + 4, 2, 2);
  g.fillStyle = gold ? P.gold1 : P.plum2;
  g.fillRect(Math.round(x) - 2, y0 + h + 1, 4, 2);
  if (face) g.drawImage(face, x0 + 5, y0 + 2, 16, 16);
  g.font = font;
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillStyle = gold ? P.gold2 : P.cream;
  g.fillText(text, x0 + 8 + extra, y0 + h / 2 + 1);
  g.globalAlpha = 1;
  return { x0: x0 - 2, y0: y0 - 2, x1: x0 + w + 2, y1: y0 + h + 8 };
}

function bubble(g: Ctx, x: number, y: number, text: string, alpha: number): void {
  const font = `600 12px ${UI_FONT}`;
  const tw = textWidth(g, font, text);
  const w = Math.round(tw + 14);
  const h = 19;
  const x0 = Math.round(clamp(x - w / 2, 4, view.w - w - 4));
  const y0 = Math.round(y - h);
  g.globalAlpha = alpha;
  g.fillStyle = P.ink;
  g.fillRect(x0 - 1, y0 - 1, w + 2, h + 2);
  g.fillStyle = P.cream;
  g.fillRect(x0, y0, w, h);
  g.fillRect(Math.round(x) - 2, y0 + h, 4, 3);
  g.fillStyle = P.ink;
  g.fillRect(Math.round(x) - 3, y0 + h + 1, 1, 2);
  g.fillRect(Math.round(x) + 2, y0 + h + 1, 1, 2);
  g.fillRect(Math.round(x) - 2, y0 + h + 3, 4, 1);
  g.font = font;
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillStyle = P.plum0;
  g.fillText(text, x0 + 7, y0 + h / 2 + 1);
  g.globalAlpha = 1;
}

let hoverId: number | null = null;
export function setHover(m: Member | null): void {
  hoverId = m ? m.id : null;
}

export function render(g: Ctx): void {
  const T = state.T;
  const z = cam.z;
  const dpr = view.dpr;
  const snap = (v: number): number => Math.round(v * dpr) / dpr;
  const ox = snap(midX() - cam.x * z);
  const oy = snap(midY() - cam.y * z);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.imageSmoothingEnabled = false;

  // The painted ground, and who holds it: only the part in view.
  const sx0 = clamp(Math.floor(-ox / z), 0, W);
  const sy0 = clamp(Math.floor(-oy / z), 0, H);
  const sx1 = clamp(Math.ceil((view.w - ox) / z), 0, W);
  const sy1 = clamp(Math.ceil((view.h - oy) / z), 0, H);
  g.fillStyle = P.ink;
  g.fillRect(0, 0, view.w, view.h);
  g.drawImage(terrain.ground, sx0, sy0, sx1 - sx0, sy1 - sy0, ox + sx0 * z, oy + sy0 * z, (sx1 - sx0) * z, (sy1 - sy0) * z);
  g.drawImage(lands.canvas, sx0, sy0, sx1 - sx0, sy1 - sy0, ox + sx0 * z, oy + sy0 * z, (sx1 - sx0) * z, (sy1 - sy0) * z);

  // ----- in map pixels -----
  g.setTransform(dpr * z, 0, 0, dpr * z, ox * dpr, oy * dpr);
  const seen = (x: number, y: number, pad = 40): boolean => x > sx0 - pad && x < sx1 + pad && y > sy0 - pad && y < sy1 + pad;
  const R = (x: number, y: number, w: number, h: number, col: string): void => {
    g.fillStyle = col;
    g.fillRect(Math.round(x), Math.round(y), w, h);
  };

  // Water catching the last light.
  terrain.glints.forEach((p, i) => {
    if (!seen(p.x, p.y, 2)) return;
    const ph = (T * 0.7 + i * 0.618) % 5;
    if (ph > 0.7) return;
    R(p.x, p.y, 1, 1, ph > 0.2 && ph < 0.5 ? P.cream : P.w4);
    if (ph > 0.25 && ph < 0.45) {
      R(p.x - 1, p.y, 1, 1, P.w4);
      R(p.x + 1, p.y, 1, 1, P.w4);
    }
  });

  // Fireflies in the woods.
  fireflies.forEach((f, i) => {
    if (!seen(f.x, f.y, 10)) return;
    const blink = Math.sin(T * 1.1 + i * 2.4);
    if (blink < 0.2) return;
    const x = f.x + Math.sin(T * 0.5 + i) * 5;
    const y = f.y + Math.cos(T * 0.37 + i * 1.7) * 4;
    g.globalAlpha = Math.min(1, (blink - 0.2) * 2);
    R(x, y, 1, 1, P.gold2);
    g.globalAlpha = 1;
  });

  // A boat out past the island.
  boat.x = 968 + Math.sin(T * 0.11) * 16;
  boat.y = 452 + Math.sin(T * 0.07) * 62;
  if (seen(boat.x, boat.y)) {
    const bob = Math.round(Math.sin(T * 1.7) * 0.6 - Math.sin(poke.boat * 20) * poke.boat * 2);
    g.drawImage(BOAT, Math.round(boat.x) - 5, Math.round(boat.y) - 8 + bob);
    R(boat.x - 6, boat.y, 12, 1, P.w4);
    if (Math.sin(T * 2) > 0) R(boat.x - 8, boat.y + 1, 3, 1, P.w3);
  }

  // The windmill's sails.
  if (seen(MILL.x, MILL.y)) {
    const hx = MILL.x;
    const hy = MILL.y - 23;
    for (let b = 0; b < 4; b++) {
      const a = millAngle + (b * Math.PI) / 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (let r = 2; r <= 14; r++) {
        R(hx + ca * r, hy + sa * r, 1, 1, P.bark0);
        if (r >= 5) {
          R(hx + ca * r - sa * 1.6, hy + sa * r + ca * 1.6, 1, 1, P.cream);
          if (r % 2 === 0) R(hx + ca * r - sa * 3, hy + sa * r + ca * 3, 1, 1, "#d9c79d");
        }
      }
    }
    R(hx - 1, hy - 1, 2, 2, P.gold1);
  }

  // Fires.
  const flame = (x: number, y: number, size: number, seed: number): void => {
    const shape = [1, 2.2, 3, 2.2, 1];
    for (let dx = -2; dx <= 2; dx++) {
      const h = Math.max(1, Math.round(size * (shape[dx + 2] as number) * (0.65 + 0.6 * noise(T * 7 + dx * 1.7, seed, 3))));
      R(x + dx, y - h, 1, h, P.coral);
      if (Math.abs(dx) <= 1) R(x + dx, y - Math.round(h * 0.62), 1, Math.round(h * 0.62), P.amber);
      if (dx === 0) R(x, y - Math.round(h * 0.36), 1, Math.max(1, Math.round(h * 0.36)), P.gold2);
    }
  };
  if (seen(FIRE.x, FIRE.y)) flame(FIRE.x, FIRE.y + 1, 2.3 + poke.fire * 1.5, 1);
  if (seen(CAMP.fireX, CAMP.fireY)) flame(CAMP.fireX, CAMP.fireY, 1.5, 2);

  // The light in the gates, the braziers beside them, and the ring that fills while a party is inside.
  for (const id of ["gateA", "gateB", "gateC"] as const) {
    const gate = GATES[id];
    if (!seen(gate.x, gate.y)) continue;
    const frames = PORTAL[gate.hue as "violet" | "teal" | "coral"];
    const raid = raids.find((r) => r.gate === id && r.phase === "wait");
    g.drawImage(frames[Math.floor(T * (raid ? 12 : 6)) % 8] as HTMLCanvasElement, gate.x - 6, gate.y - 23);
    for (const bx of [gate.x - 18, gate.x + 16]) {
      const f = noise(T * 8, bx, 4) > 0.5 ? 1 : 0;
      R(bx, gate.y - 10 - f, 1, 3 + f, P.coral);
      R(bx, gate.y - 9, 1, 2, P.gold2);
    }
    if (raid) {
      const dots = 20;
      const lit = Math.floor(raid.ring * dots);
      for (let k = 0; k < dots; k++) {
        const a = -Math.PI / 2 + (k / dots) * 6.283;
        const px = gate.x + Math.cos(a) * 19;
        const py = gate.y - 12 + Math.sin(a) * 17;
        if (k < lit) {
          R(px - 1, py - 1, 2, 2, P.gold2);
        } else if (k === lit) R(px - 1, py - 1, 2, 2, Math.sin(T * 12) > 0 ? P.cream : P.gold0);
        else R(px - 1, py - 1, 2, 2, "rgba(26,15,30,0.6)");
      }
    }
  }

  // Banners: the guild's gold, the rival's red, climbing or coming down their poles.
  flags.forEach((f, i) => {
    const l = LANDS[i] as (typeof LANDS)[number];
    if (!seen(l.bx, l.by)) return;
    if (f.h <= 0) return;
    R(l.bx, l.by - 15, 1, 15, P.bark0);
    R(l.bx - 1, l.by - 1, 3, 1, P.bark0);
    R(l.bx - 1, l.by - 16, 3, 1, P.gold2);
    const top = l.by - 15 + Math.round((1 - f.h) * 9);
    const guild = f.col === 0;
    for (let cx = 0; cx < 7; cx++) {
      const wave = Math.round(Math.sin(T * 5 - cx * 0.9 + i) * (cx / 6) * 1.2);
      const len = cx === 3 ? 5 : cx === 2 || cx === 4 ? 6 : 7;
      R(l.bx + 1 + cx, top + wave, 1, len, guild ? (cx > 4 ? P.gold0 : P.gold1) : cx > 4 ? P.red1 : P.red3);
      if (cx === 2 || cx === 3) R(l.bx + 1 + cx, top + wave + 2, 1, 2, guild ? P.g1 : P.ink);
    }
  });

  // The member's own flag, with their face on it, and whatever they have bought for the camp.
  if (seen(CAMP.x, CAMP.y)) {
    const fy = CAMP.flagY - 17 + Math.round(Math.sin(T * 2.2) * 0.6);
    R(CAMP.flagX + 1, fy - 1, 10, 10, P.ink);
    R(CAMP.flagX + 1, fy, 9, 8, P.plum2);
    g.drawImage(you.skin.face, CAMP.flagX + 1, fy);
    if (owned.lantern) {
      const at = DROP_AT.lantern;
      R(at.x, at.y - 9, 1, 9, P.bark0);
      R(at.x - 1, at.y - 1, 3, 1, P.bark0);
      R(at.x, at.y - 10, 3, 1, P.bark0);
      g.drawImage(LANTERN, at.x + 1, at.y - 9);
    }
    if (owned.sapling) {
      const at = DROP_AT.sapling;
      const age = owned.saplingAge;
      const tall = age < 15 ? 3 : age < 45 ? 5 : 7;
      R(at.x, at.y - tall, 1, tall, P.bark2);
      R(at.x - 1, at.y - tall - 1, 3, 2, P.g3);
      R(at.x, at.y - tall - 2, 1, 1, P.g4);
      if (tall >= 5) R(at.x - 2, at.y - tall + 1, 5, 1, P.g2);
      if (tall >= 7) {
        R(at.x - 2, at.y - tall - 1, 5, 3, P.g2);
        R(at.x - 1, at.y - tall - 3, 3, 2, P.g3);
      }
    }
  }
  for (const d of drops) {
    const at = DROP_AT[d.id];
    if (d.t >= 0.55) continue;
    const k = 1 - d.t / 0.55;
    const icon = d.id === "lantern" ? ICONS.lantern : d.id === "sapling" ? ICONS.leaf : ICONS.crab;
    g.drawImage(icon, Math.round(at.x - icon.width / 2), Math.round(at.y - icon.height - 90 * k * k));
    R(at.x - 3 * (1 - k), at.y, Math.round(6 * (1 - k)), 1, "rgba(26,15,30,0.4)");
  }

  // The rope of lanterns across the plaza.
  if (seen(NODES.town.x, ROPE.ay, 80)) {
    const sway = Math.sin(T * 9) * poke.rope * 1.5;
    for (let k = 0; k < 48; k++) {
      const t = k / 48;
      R(lerp(ROPE.ax, ROPE.bx, t), ROPE.ay + Math.sin(t * Math.PI) * (ROPE.sag + sway), 2, 1, P.bark0);
    }
    lanterns.forEach((l, i) => {
      const s = ropeSlot(i);
      const swing = Math.round(Math.sin(T * 8 + i) * (l.swing + poke.rope) * 1.6);
      g.drawImage(LANTERN, Math.round(s.x) - 1 + swing, Math.round(s.y));
    });
  }

  // Crabs, sidling about the pond; and the one that is never there.
  for (const c of crabs) {
    if (!seen(c.x, c.y, 8)) continue;
    const moving = Math.hypot(c.tx - c.x, c.ty - c.y) > 0.6;
    const up = c.hop > 0 && c.hop < 0.5 ? Math.round(Math.sin((c.hop / 0.5) * Math.PI) * 4) : 0;
    g.drawImage(CRAB[moving ? Math.floor(T * 7 + c.n) % 2 : 0] as HTMLCanvasElement, Math.round(c.x) - 3, Math.round(c.y) - 3 - up);
  }
  if (seen(stray.x, stray.y, 8)) {
    const peek = (T + 2) % 5 < 0.4 ? 2 : 0;
    const up = stray.hop > 0 ? Math.round(Math.sin((stray.hop / 0.5) * Math.PI) * 5) : 0;
    g.drawImage(CRAB[Math.floor(T * 2) % 2] as HTMLCanvasElement, Math.round(stray.x) - 3, Math.round(stray.y) - 3 - peek - up);
  }

  // Birds going home across the province, and their shadows.
  for (let b = 0; b < 5; b++) {
    const bx = ((T * 13 + b * 9) % (W + 260)) - 130 + (b % 2) * 5;
    const by = 190 + Math.sin(T * 0.13) * 90 + (b - 2) * (b % 2 ? 7 : -6) + Math.abs(b - 2) * 5;
    if (!seen(bx, by, 10)) continue;
    const up = Math.sin(T * 9 + b * 1.3) > 0;
    R(bx + 5, by + 16, 3, 1, "rgba(26,15,30,0.25)");
    R(bx, by, 1, 1, P.plum0);
    R(bx - 1, by + (up ? -1 : 1), 1, 1, P.plum0);
    R(bx + 1, by + (up ? -1 : 1), 1, 1, P.plum0);
    R(bx - 2, by + (up ? -1 : 0), 1, 1, P.plum1);
    R(bx + 2, by + (up ? -1 : 0), 1, 1, P.plum1);
  }

  // Light: every window, fire and gate, added on top so the dusk glows.
  g.globalCompositeOperation = "lighter";
  const glow = (x: number, y: number, r: number, hue: Hue, a: number): void => {
    g.globalAlpha = a;
    g.drawImage(GLOW[hue], x - r, y - r, r * 2, r * 2);
  };
  fireflies.forEach((f, i) => {
    if (!seen(f.x, f.y, 10)) return;
    const blink = Math.sin(T * 1.1 + i * 2.4);
    if (blink < 0.2) return;
    glow(f.x + Math.sin(T * 0.5 + i) * 5 + 0.5, f.y + Math.cos(T * 0.37 + i * 1.7) * 4 + 0.5, 3.5, "amber", Math.min(1, (blink - 0.2) * 1.4));
  });
  for (const l of terrain.lights) {
    if (!seen(l.x, l.y, l.r)) continue;
    glow(l.x, l.y, l.r, l.hue, l.a * (0.82 + 0.18 * Math.sin(T * 3.1 + l.flick) + 0.06 * Math.sin(T * 11 + l.flick * 3)));
  }
  lanterns.forEach((l, i) => {
    const s = ropeSlot(i);
    glow(s.x, s.y + 2, 7 + (T - l.t < 1.5 ? (1.5 - (T - l.t)) * 8 : 0), l.hue === "violet" ? "amber" : l.hue, 0.5);
    glow(s.x, s.y + 2, 4, "amber", 0.45);
  });
  for (const r of raids) {
    if (r.phase !== "wait") continue;
    const gate = GATES[r.gate];
    glow(gate.x, gate.y - 12, 26 + r.ring * 16, gate.hue, 0.35 + r.ring * 0.4);
  }
  if (owned.lantern) glow(DROP_AT.lantern.x + 2, DROP_AT.lantern.y - 7, 16, "amber", 0.6);
  if (poke.fire > 0) glow(FIRE.x, FIRE.y - 2, 50, "amber", poke.fire * 0.5);
  for (const m of members) if (m.carry) glow(m.x + 4, m.y - 12, 12, "amber", 0.6);
  // The lighthouse turns its beam.
  if (seen(LIGHTHOUSE.x, LIGHTHOUSE.y, 120)) {
    const a = T * (0.45 + poke.light * 3);
    g.globalAlpha = 0.055 + poke.light * 0.1;
    g.fillStyle = "#ffe9b0";
    for (const side of [0, Math.PI]) {
      g.beginPath();
      g.moveTo(LIGHTHOUSE.x, LIGHTHOUSE.y - 27);
      g.lineTo(LIGHTHOUSE.x + Math.cos(a + side - 0.13) * 110, LIGHTHOUSE.y - 27 + Math.sin(a + side - 0.13) * 60);
      g.lineTo(LIGHTHOUSE.x + Math.cos(a + side + 0.13) * 110, LIGHTHOUSE.y - 27 + Math.sin(a + side + 0.13) * 60);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";

  // ----- in screen pixels -----
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const near = smoothstep(2.5, 3.1, z);

  // The names of the lands, lettered across them as on any map.
  const landAlpha = 1 - smoothstep(2.3, 2.9, z);
  if (landAlpha > 0.02) {
    g.font = `600 ${z < 1.4 ? 10 : 11}px ${MAP_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    if ("letterSpacing" in g) g.letterSpacing = "3px";
    LANDS.forEach((l, i) => {
      const p = toScreen(l.x, l.y + 26);
      if (p.x < -80 || p.x > view.w + 80 || p.y < -20 || p.y > view.h + 20) return;
      const o = lands.owner[i];
      g.globalAlpha = landAlpha * (o === 0 ? 0.62 : 0.5);
      g.fillStyle = "rgba(26,15,30,0.8)";
      g.fillText(l.name.toUpperCase(), p.x + 1, p.y + 1);
      g.fillStyle = o === 0 ? P.gold2 : o === 2 ? "#ffb3a6" : "#d9d3e6";
      g.fillText(l.name.toUpperCase(), p.x, p.y);
    });
    // The sea has its name down the coast, as on any chart.
    const sea = toScreen(1006, 250);
    g.save();
    g.translate(sea.x, sea.y);
    g.rotate(Math.PI / 2);
    g.font = `italic 600 12px ${MAP_FONT}`;
    if ("letterSpacing" in g) g.letterSpacing = "6px";
    g.globalAlpha = landAlpha * 0.5;
    g.fillStyle = P.w4;
    g.fillText("The Dusk Sea", 0, 0);
    g.restore();
    if ("letterSpacing" in g) g.letterSpacing = "0px";
    g.globalAlpha = 1;
  }

  // Effects that sit on the ground go under the people.
  for (const r of fx.rings) {
    const p = toScreen(r.x, r.y);
    const t = r.t / r.life;
    g.globalAlpha = (1 - t) * 0.9;
    g.strokeStyle = r.col;
    g.lineWidth = Math.max(1.5, z * 0.9);
    g.beginPath();
    g.ellipse(p.x, p.y, r.r * z * (0.15 + 0.85 * (1 - (1 - t) ** 2)), r.r * z * (0.15 + 0.85 * (1 - (1 - t) ** 2)) * (r.water ? 0.5 : 0.62), 0, 0, 6.283);
    g.stroke();
  }
  g.globalAlpha = 1;

  // Place names.
  labelBox.length = 0;
  for (const p of PLACES) {
    const a = tierAlpha(p);
    if (a < 0.03) continue;
    const at = toScreen(p.lx, p.ly);
    // From high up the member's own pin stands at their camp: its name moves up out of the way.
    if (p.id === "camp") at.y -= (1 - smoothstep(2.5, 3.1, z)) * 26;
    if (at.x < -90 || at.x > view.w + 90 || at.y < -10 || at.y > view.h + 40) continue;
    const box = plate(g, at.x, at.y, p.name, a, p.id === "camp", p.id === "camp" ? you.skin.face : null);
    if (a > 0.5) labelBox.push({ p, ...box });
  }
  // People: a face on a pin from high up, a small walking figure when close.
  const groups = new Map<NodeId, Member[]>();
  for (const m of members) {
    if (!m.at) continue;
    const list = groups.get(m.at);
    if (list) list.push(m);
    else groups.set(m.at, [m]);
  }
  type Drawn = { m: Member; x: number; y: number };
  const drawn: Drawn[] = [];
  const step = 26;
  for (const m of members) {
    const base = toScreen(m.x, m.y);
    let dx = 0;
    let dy = 0;
    if (m.at) {
      const list = groups.get(m.at) as Member[];
      const i = list.indexOf(m);
      const s = spot(m.at, i, list.length);
      const row = rowSpot(i, list.length, step);
      dx = lerp(row.x, s.x * z, near) * m.settle;
      dy = lerp(row.y, s.y * z, near) * m.settle;
    }
    drawn.push({ m, x: base.x + dx, y: base.y + dy });
  }
  if (near > 0.15) {
    const p = toScreen(cinfy.x, cinfy.y);
    drawn.push({ m: cinfy, x: p.x, y: p.y });
  } else {
    cinfy.sx = -99;
    cinfy.sy = -99;
  }
  drawn.sort((a, b) => (a.m.you ? 1e6 : 0) + a.y - ((b.m.you ? 1e6 : 0) + b.y));

  for (const { m, x, y } of drawn) {
    if (x < -60 || x > view.w + 60 || y < -40 || y > view.h + 90) {
      m.sx = -99;
      m.sy = -99;
      continue;
    }
    // A face on a pin is one size whatever the zoom; a figure is sized to the town it stands in.
    const close = Math.max(2.5, z * 0.74) * (m.you ? 1.14 : 1);
    const s = Math.round((m.npc ? close : lerp(m.you ? 4 : 3, close, near)) * 2) / 2;
    const walking = m.route !== null && m.delay <= 0;
    const bob = walking ? Math.abs(Math.sin(m.walk * Math.PI)) * s * 0.8 : Math.sin(T * 2 + m.id) * 0.5 + 0.5;
    const hopping = m.hop > 0 && m.hop < 0.45;
    const lift = bob + (hopping ? Math.sin((m.hop / 0.45) * Math.PI) * s * 3.2 : 0);
    const pinA = m.npc ? 0 : 1 - near;
    const hover = hoverId === m.id ? 2 : 0;
    const headTop = Math.round(y - lift - hover - lerp(8 + 8 * s, 16 * s, near));
    const headLeft = Math.round(x - 4 * s);
    const sitting = m.sit && m.at === "fire" && !m.route;
    // A shadow on the ground.
    g.fillStyle = "rgba(26,15,30,0.34)";
    g.fillRect(Math.round(x - 3 * s), Math.round(y - s * 0.4), Math.round(6 * s), Math.round(s * 1.2));
    if (near > 0.01 || m.npc) {
      const f = sitting ? FRAME.sit : hopping ? FRAME.cheer : walking ? (Math.floor(m.walk) % 2 === 0 ? FRAME.stepA : FRAME.stepB) : FRAME.stand;
      g.globalAlpha = m.npc ? smoothstep(0.15, 0.6, near) : near;
      g.drawImage(m.skin.frames, f * FW, 0, FW, FH, headLeft - 2 * s, headTop - s, FW * s, FH * s);
      g.globalAlpha = 1;
    }
    if (pinA > 0.01) {
      g.globalAlpha = pinA;
      const b = m.you ? 3 : 2;
      const size = 8 * s;
      g.fillStyle = P.ink;
      g.fillRect(headLeft - b - 1, headTop - b - 1, size + b * 2 + 2, size + b * 2 + 2);
      g.fillRect(Math.round(x) - 4, headTop + size + b, 8, 3);
      g.fillRect(Math.round(x) - 2, headTop + size + b + 3, 4, 2);
      g.fillStyle = m.you ? P.gold1 : hoverId === m.id ? P.gold2 : P.cream;
      g.fillRect(headLeft - b, headTop - b, size + b * 2, size + b * 2);
      g.fillRect(Math.round(x) - 3, headTop + size + b, 6, 2);
      g.fillRect(Math.round(x) - 1, headTop + size + b + 2, 2, 2);
      g.drawImage(m.skin.face, headLeft, headTop, size, size);
      g.globalAlpha = 1;
    }
    if (m.carry) {
      g.drawImage(LANTERN, headLeft + 8 * s + s, headTop + 3 * s + Math.round(Math.sin(T * 6) * s * 0.5), 3 * s, 4 * s);
    }
    if (m.you) {
      // A gold arrow bobs over the member's own head, so they are never lost in a crowd.
      const ay = headTop - 9 - Math.abs(Math.sin(T * 3.2)) * 4;
      g.fillStyle = P.ink;
      g.fillRect(Math.round(x) - 6, ay - 6, 12, 5);
      g.fillRect(Math.round(x) - 4, ay - 1, 8, 2);
      g.fillRect(Math.round(x) - 2, ay + 1, 4, 2);
      g.fillStyle = P.gold2;
      g.fillRect(Math.round(x) - 5, ay - 5, 10, 3);
      g.fillRect(Math.round(x) - 3, ay - 2, 6, 2);
      g.fillRect(Math.round(x) - 1, ay, 2, 2);
    }
    m.sx = x;
    m.sy = headTop + 4 * s;
    m.sr = Math.max(17, 5.5 * s);
    m.top = headTop - (m.you ? 20 : 6);
  }
  // What people say, and the small pictures they show, over everything else on the map.
  for (const { m, x } of drawn) {
    if (m.sx < 0) continue;
    if (m.emoteT > 0 && m.emote) {
      const icon = ICONS[m.emote];
      const k = Math.min(1, easeOutBack(Math.min(1, (m.emoteFor - m.emoteT) * 5)));
      const sc = 2 * Math.max(0.2, k);
      g.globalAlpha = Math.min(1, m.emoteT * 3);
      g.fillStyle = P.ink;
      g.fillRect(Math.round(x - (icon.width * sc) / 2) - 3, Math.round(m.top - icon.height * sc) - 3, Math.round(icon.width * sc) + 6, Math.round(icon.height * sc) + 6);
      g.fillStyle = P.cream;
      g.fillRect(Math.round(x - (icon.width * sc) / 2) - 2, Math.round(m.top - icon.height * sc) - 2, Math.round(icon.width * sc) + 4, Math.round(icon.height * sc) + 4);
      g.drawImage(icon, Math.round(x - (icon.width * sc) / 2), Math.round(m.top - icon.height * sc), icon.width * sc, icon.height * sc);
      g.globalAlpha = 1;
    } else if (m.sayT > 0 && m.say) {
      bubble(g, x, m.top - 4, m.say, Math.min(1, m.sayT * 3));
    }
  }

  // Coins waiting at the Works, as a small bobbing count.
  if (works.ready >= 10) {
    const p = toScreen(WORKS.x + 34, WORKS.y - 20);
    if (p.x > -40 && p.x < view.w + 40) {
      const by = p.y + Math.sin(T * 3) * 2;
      const text = String(Math.floor(works.ready));
      const font = `700 12px ${UI_FONT}`;
      const tw = textWidth(g, font, text);
      g.fillStyle = P.ink;
      g.fillRect(Math.round(p.x - 14 - tw / 2), Math.round(by - 11), Math.round(tw + 28), 20);
      g.fillStyle = P.plum1;
      g.fillRect(Math.round(p.x - 13 - tw / 2), Math.round(by - 10), Math.round(tw + 26), 18);
      g.drawImage(ICONS.coin, Math.round(p.x - 10 - tw / 2), Math.round(by - 8), 15, 15);
      g.font = font;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillStyle = P.gold2;
      g.fillText(text, Math.round(p.x + 8 - tw / 2), Math.round(by));
    }
  }

  // Numbers on the crabs, once the map is close enough to read them.
  if (z >= 3.2) {
    g.font = `700 10px ${UI_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    for (const c of crabs) {
      const p = toScreen(c.x, c.y - 5);
      g.fillStyle = P.ink;
      g.fillText(String(c.n), p.x + 1, p.y + 1);
      g.fillStyle = P.cream;
      g.fillText(String(c.n), p.x, p.y);
    }
  }

  // Sparks, leaves, dust.
  const unit = Math.max(2, Math.round(z));
  for (const p of fx.parts) {
    const at = toScreen(p.x, p.y);
    const t = p.t / p.life;
    if (p.kind === "dust") {
      const sz = unit * p.size * (1 + t * 1.6);
      g.globalAlpha = (1 - t) * 0.5;
      g.fillStyle = p.col;
      g.fillRect(Math.round(at.x - sz / 2), Math.round(at.y - sz / 2), Math.round(sz), Math.round(sz));
    } else if (p.kind === "spark") {
      g.globalAlpha = Math.min(1, (1 - t) * 2);
      g.fillStyle = p.col;
      const on = Math.floor(p.t * 12 + p.x) % 3 !== 0;
      g.fillRect(Math.round(at.x - unit / 2), Math.round(at.y - unit / 2), unit, unit);
      if (on && t < 0.6) {
        g.fillRect(Math.round(at.x - unit * 1.5), Math.round(at.y - unit / 2), unit * 3, unit);
        g.fillRect(Math.round(at.x - unit / 2), Math.round(at.y - unit * 1.5), unit, unit * 3);
      }
    } else {
      g.globalAlpha = Math.min(1, (1 - t) * 3);
      g.fillStyle = p.col;
      const flip = Math.floor(p.t * 9 + p.x) % 2 === 0;
      g.fillRect(Math.round(at.x), Math.round(at.y), flip ? unit * 2 : unit, flip ? unit : unit * 2);
    }
  }
  g.globalAlpha = 1;
  for (const f of fx.flights) {
    const at = fx.flightAt(f);
    if (!at) continue;
    const p = toScreen(at.x, at.y);
    const sc = Math.max(3, z) * at.s;
    g.globalAlpha = at.a;
    g.drawImage(f.icon, Math.round(p.x - (f.icon.width * sc) / 2), Math.round(p.y - (f.icon.height * sc) / 2), f.icon.width * sc, f.icon.height * sc);
  }
  g.globalAlpha = 1;
  // Words that rise and fade.
  g.font = `800 14px ${UI_FONT}`;
  g.textBaseline = "middle";
  g.textAlign = "left";
  for (const f of fx.floats) {
    const p = toScreen(f.x, f.y);
    const t = f.t / f.life;
    const pop = Math.min(1, easeOutBack(Math.min(1, f.t * 5)));
    const yy = p.y - 30 * (1 - (1 - t) ** 2);
    const tw = textWidth(g, g.font, f.text);
    const iw = f.icon ? f.icon.width * 2 + 4 : 0;
    const x0 = p.x - (tw + iw) / 2;
    g.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
    if (f.icon) g.drawImage(f.icon, Math.round(x0), Math.round(yy - f.icon.height * pop), f.icon.width * 2 * pop, f.icon.height * 2 * pop);
    g.lineWidth = 4;
    g.lineJoin = "round";
    g.strokeStyle = P.ink;
    g.strokeText(f.text, x0 + iw, yy);
    g.fillStyle = f.col;
    g.fillText(f.text, x0 + iw, yy);
  }
  g.globalAlpha = 1;
}

/** Leaf and coins flying to the purse, and confetti: drawn above the interface, on its own canvas. */
export function renderTop(g: Ctx): boolean {
  if (fx.topFlights.length === 0 && fx.confetti.length === 0) return false;
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  g.imageSmoothingEnabled = false;
  for (const p of fx.confetti) {
    const t = p.t / p.life;
    g.globalAlpha = Math.min(1, (1 - t) * 2.5);
    g.fillStyle = p.col;
    const flip = Math.floor(p.t * 8 + p.x) % 2 === 0;
    g.fillRect(Math.round(p.x), Math.round(p.y), flip ? p.size : p.size * 0.5, flip ? p.size * 0.5 : p.size);
  }
  for (const f of fx.topFlights) {
    const at = fx.flightAt(f);
    if (!at) continue;
    g.globalAlpha = at.a;
    g.drawImage(f.icon, Math.round(at.x - (f.icon.width * at.s) / 2), Math.round(at.y - (f.icon.height * at.s) / 2), f.icon.width * at.s, f.icon.height * at.s);
  }
  g.globalAlpha = 1;
  return true;
}
