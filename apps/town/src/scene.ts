/**
 * Drawing a frame. The town is drawn small, one art pixel to a pixel, with dusk laid over it and the
 * lights cut out of the dusk; then it is blown up to the screen, and the words (names, speech, the
 * prompt by a door) are written over it at the screen's own sharpness.
 */

import { CREAM, GOLD, INK, SKY, WATER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { FOOT_X, FOOT_Y, SIT, WALK } from "@sequoia-leaf/kit/skin.ts";
import { clamp, type Ctx, lerp, makeCanvas, type Pt, type Rect } from "@sequoia-leaf/kit/util.ts";

import { HOP, onScreen } from "./actors.ts";
import { bits, floaters, rings } from "./fx.ts";
import { type Actor, G } from "./game.ts";
import { GROUND, NEAR, SKYLINE } from "./ground.ts";
import type { Sprites } from "./sprites.ts";
import { allLights, type Crab, crabPic, crabs, drawGlows, drawStrings, drawWater, type Prop, props } from "./town.ts";
import { type Place, pondD } from "./world.ts";

export interface Stage {
  sprites: Sprites;
  ground: HTMLCanvasElement;
  near: HTMLCanvasElement;
  sky: HTMLCanvasElement;
}

/** What main asks to be shown besides the town itself. */
export const show: { prompt: Place | null; promptT: number; dest: Pt | null; touch: boolean; hover: Rect | null } = {
  prompt: null,
  promptT: 0,
  dest: null,
  touch: false,
  hover: null,
};

const buf = makeCanvas(320, 190);
const dusk = makeCanvas(320, 190);

function radial(stops: readonly (readonly [number, string])[]): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [at, col] of stops) gr.addColorStop(at, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
}
/** A light's reach, as a hole to cut out of the dusk; and its warmth, to add after. */
const HOLE = radial([
  [0, "rgba(0,0,0,1)"],
  [0.35, "rgba(0,0,0,0.85)"],
  [0.7, "rgba(0,0,0,0.32)"],
  [1, "rgba(0,0,0,0)"],
]);
const WARM = radial([
  [0, "rgba(255,196,120,1)"],
  [0.4, "rgba(255,160,90,0.5)"],
  [1, "rgba(255,140,80,0)"],
]);
const SPARK = radial([
  [0, "rgba(255,236,170,1)"],
  [0.5, "rgba(255,200,110,0.35)"],
  [1, "rgba(255,180,90,0)"],
]);

export function sizeBuffers(w: number, h: number): void {
  for (const b of [buf, dusk]) {
    b.c.width = w;
    b.c.height = h;
    b.g.imageSmoothingEnabled = false;
  }
}

interface Item {
  z: number;
  prop: Prop | null;
  actor: Actor | null;
  crab: Crab | null;
}
const order: Item[] = [];

function drawProp(g: Ctx, p: Prop, cx: number, cy: number): void {
  const since = G.t - p.bumpAt;
  let dx = 0;
  let dy = 0;
  if (since < 0.4) {
    const k = 1 - since / 0.4;
    if (p.hops) dy = -Math.round(Math.abs(Math.sin(since * 16)) * 4 * k);
    else dx = Math.round(Math.sin(since * 50) * 1.7 * k);
  }
  const sx = Math.round(p.x) - cx + dx;
  const sy = Math.round(p.y) - cy + dy;
  if (p.sprite) g.drawImage(p.sprite.c, sx - p.sprite.ax, sy - p.sprite.ay);
  p.extra?.(g, sx, sy);
}

/** Where someone is drawn this moment: on their feet, or part-way into a seat. */
function standing(a: Actor): Pt {
  if (!a.seat) return { x: a.x, y: a.y };
  const k = clamp((G.t - a.sat) / 0.22, 0, 1);
  return { x: lerp(a.seat.from.x, a.seat.x, k), y: lerp(a.seat.from.y, a.seat.y, k) - Math.sin(k * Math.PI) * 5 };
}

function hopOf(a: Actor): number {
  return a.hop > 0 ? Math.abs(Math.sin((1 - a.hop / HOP) * Math.PI)) * 5 : 0;
}

function drawActor(g: Ctx, a: Actor, cx: number, cy: number, s: Sprites): void {
  const at = standing(a);
  const pose = a.seat ? SIT : a.moving ? (WALK[Math.floor(a.walked / 5) % 4] ?? 0) : 0;
  const frame = a.body.frames[a.dir]?.[pose];
  if (!frame) return;
  const x = Math.round(at.x) - cx;
  const y = Math.round(at.y - hopOf(a)) - cy;
  g.globalAlpha = a.alpha;
  g.drawImage(frame, x - FOOT_X, y - FOOT_Y);
  const sunk = pose === SIT ? (a.dir === 0 ? 2 : 5) : 0;
  if (a.crown) g.drawImage(s.crown, x - 4, y - 21 + sunk);
  if (a.mug > 0 && a.dir !== 3) g.drawImage(s.mug, x + (a.dir === 1 ? -6 : 3), y - 9 + sunk);
  g.globalAlpha = 1;
}

function pixelRing(g: Ctx, x: number, y: number, rx: number, ry: number, col: string): void {
  const n = Math.max(8, Math.round(rx * 3));
  g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    g.fillRect(Math.round(x + Math.cos(a) * rx), Math.round(y + Math.sin(a) * ry), 1, 1);
  }
}

/** The whole town as it is this moment, small. */
export function drawTown(stage: Stage): HTMLCanvasElement {
  const g = buf.g;
  const w = buf.c.width;
  const h = buf.c.height;
  const cx = Math.round(G.cam.x);
  const cy = Math.round(G.cam.y);
  const s = stage.sprites;
  const people = [...G.mates];
  if (G.player) people.push(G.player);
  if (G.cinfy) people.push(G.cinfy);

  // The sunset behind the far trees, with the sun itself straight down the path out of the gate.
  g.fillStyle = "#141f1c";
  g.fillRect(0, 0, w, h);
  const skyY = SKYLINE.worldY - SKYLINE.horizon - cy;
  if (skyY < h) {
    if (skyY > 0) {
      g.fillStyle = SKY[0];
      g.fillRect(0, 0, w, skyY);
    }
    g.drawImage(stage.sky, SKYLINE.worldX - cx, skyY);
  }
  g.drawImage(stage.ground, GROUND.x - cx, GROUND.y - cy);
  drawWater(g, cx, cy);

  for (const r of rings) {
    const k = r.life / r.ttl;
    g.globalAlpha = 1 - k;
    pixelRing(g, r.x - cx, r.y - cy, 2 + r.r * k, (2 + r.r * k) * (r.flat ? 0.45 : 0.55), r.col);
  }
  g.globalAlpha = 1;
  if (show.dest) {
    const pulse = 3 + Math.sin(G.t * 9) * 1;
    pixelRing(g, show.dest.x - cx, show.dest.y - cy, pulse, pulse * 0.55, GOLD[2]);
    R(g, Math.round(show.dest.x) - cx, Math.round(show.dest.y) - cy, 1, 1, CREAM);
  }

  // Everything that stands up, far to near.
  order.length = 0;
  for (const p of props) {
    const hit = p.hit;
    if (hit && (hit.x - cx > w + 8 || hit.x + hit.w - cx < -8 || hit.y - cy > h + 8 || hit.y + hit.h - cy < -30))
      continue;
    order.push({ z: p.z, prop: p, actor: null, crab: null });
  }
  for (const a of people) {
    if (a.away || a.alpha <= 0.02) continue;
    order.push({ z: a.seat ? a.seat.y + 9 : a.y, prop: null, actor: a, crab: null });
    if (!a.seat) {
      g.fillStyle = "rgba(20,10,28,0.34)";
      const lift = hopOf(a) > 2 ? 1 : 0;
      g.fillRect(Math.round(a.x) - 4 + lift - cx, Math.round(a.y) - 1 - cy, 8 - lift * 2, 2);
      g.fillRect(Math.round(a.x) - 3 + lift - cx, Math.round(a.y) - 2 - cy, 6 - lift * 2, 4);
    }
  }
  for (const c of crabs) order.push({ z: c.z, prop: null, actor: null, crab: c });
  order.sort((a, b) => a.z - b.z);
  for (const it of order) {
    if (it.prop) drawProp(g, it.prop, cx, cy);
    else if (it.actor) drawActor(g, it.actor, cx, cy, s);
    else if (it.crab) {
      const c = it.crab;
      const pic = crabPic(c);
      if (!pic) continue;
      const up = c.hop > 0 ? Math.abs(Math.sin((1 - c.hop / 0.3) * Math.PI)) * 4 : 0;
      // A crab in the water shows only its top half.
      const wet = !c.lost && !c.perched && pondD(c.x, c.y) < -3;
      g.globalAlpha = c.bolt > 0 ? clamp(1 - c.bolt / 1.2, 0, 1) : 1;
      if (wet && up === 0)
        g.drawImage(pic, 0, 0, pic.width, 5, Math.round(c.x) - 5 - cx, Math.round(c.y) - 7 - cy, pic.width, 5);
      else g.drawImage(pic, Math.round(c.x) - 5 - cx, Math.round(c.y - up) - 7 - cy);
      g.globalAlpha = 1;
    }
  }

  for (const b of bits) {
    if (b.glow) continue;
    g.globalAlpha = clamp((b.ttl - b.life) / (b.ttl * 0.4), 0, 1);
    R(g, Math.round(b.x) - cx, Math.round(b.y) - cy, b.size, b.size, b.col);
  }
  g.globalAlpha = 1;
  drawStrings(g, cx, cy);
  g.drawImage(stage.near, NEAR.x - cx, NEAR.y - cy);

  // Dusk: lightest where the sunset comes in over the far hedge, deepest at the near edge; and
  // every lamp and fire cuts a soft hole in it.
  const d = dusk.g;
  d.globalCompositeOperation = "source-over";
  d.globalAlpha = 1;
  d.clearRect(0, 0, w, h);
  const fall = d.createLinearGradient(0, 40 - cy, 0, 190 - cy);
  fall.addColorStop(0, "rgba(32,14,50,0.06)");
  fall.addColorStop(1, "rgba(32,14,50,0.46)");
  d.fillStyle = fall;
  d.fillRect(0, 0, w, h);
  d.globalCompositeOperation = "destination-out";
  const lamps = allLights();
  if (G.player && G.owned.has("jar"))
    lamps.push({ x: G.player.x, y: G.player.y - 10, r: 24, power: 0.6, boost: 0, phase: 1 });
  for (const l of lamps) {
    const r = l.r * (1 + l.boost * 0.3);
    if (l.x - cx + r < 0 || l.x - cx - r > w || l.y - cy + r < 0 || l.y - cy - r > h) continue;
    d.globalAlpha = clamp(l.power * (0.93 + 0.07 * Math.sin(G.t * 6 + l.phase)) + l.boost * 0.3, 0, 1);
    d.drawImage(HOLE, l.x - cx - r, l.y - cy - r, r * 2, r * 2);
  }
  d.globalAlpha = 1;
  g.drawImage(dusk.c, 0, 0);
  g.globalCompositeOperation = "lighter";
  for (const l of lamps) {
    const r = l.r * (1 + l.boost * 0.3) * 0.9;
    if (l.x - cx + r < 0 || l.x - cx - r > w || l.y - cy + r < 0 || l.y - cy - r > h) continue;
    g.globalAlpha = clamp(0.13 * l.power + l.boost * 0.14, 0, 0.5);
    g.drawImage(WARM, l.x - cx - r, l.y - cy - r, r * 2, r * 2);
  }
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;

  // Things that shine of themselves.
  drawGlows(g, cx, cy, SPARK);
  for (const b of bits) {
    if (!b.glow) continue;
    const a = clamp((b.ttl - b.life) / (b.ttl * 0.5), 0, 1);
    g.globalAlpha = a * 0.3;
    g.drawImage(SPARK, Math.round(b.x) - cx - 3, Math.round(b.y) - cy - 3, 7, 7);
    g.globalAlpha = a;
    R(g, Math.round(b.x) - cx, Math.round(b.y) - cy, b.size, b.size, b.col);
  }
  const p = G.player;
  if (p && !p.away) {
    const at = standing(p);
    if (G.owned.has("jar")) {
      for (let i = 0; i < 4; i++) {
        const fx = Math.round(at.x + Math.cos(G.t * 1.3 + i * 1.6) * (9 + i)) - cx;
        const fy = Math.round(at.y - 12 + Math.sin(G.t * 1.9 + i * 2.1) * 6) - cy;
        g.globalAlpha = 0.35;
        g.drawImage(SPARK, fx - 4, fy - 4, 9, 9);
        g.globalAlpha = 0.7 + 0.3 * Math.sin(G.t * 5 + i);
        R(g, fx, fy, 1, 1, GOLD[2]);
      }
    }
    if (G.owned.has("water")) {
      const fx = Math.round(at.x - 9 + Math.sin(G.t * 0.9) * 3) - cx;
      const fy = Math.round(at.y - 22 + Math.sin(G.t * 1.6) * 3) - cy;
      g.globalAlpha = 0.3;
      g.drawImage(SPARK, fx - 5, fy - 5, 11, 11);
      g.globalAlpha = 0.8;
      R(g, fx, fy, 2, 2, WATER[3]);
    }
  }
  g.globalAlpha = 1;

  // Gold corners round whatever the mouse is resting on: it knows it is being looked at.
  if (show.hover) {
    const r = show.hover;
    const breathe = Math.sin(G.t * 6) > 0 ? 1 : 0;
    const x0 = Math.round(r.x) - cx - 2 + breathe;
    const y0 = Math.round(r.y) - cy - 2 + breathe;
    const x1 = Math.round(r.x + r.w) - cx + 1 - breathe;
    const y1 = Math.round(r.y + r.h) - cy + 1 - breathe;
    for (const [x, y, dx, dy] of [
      [x0, y0, 1, 1],
      [x1, y0, -1, 1],
      [x0, y1, 1, -1],
      [x1, y1, -1, -1],
    ] as const) {
      R(g, dx > 0 ? x : x - 2, y, 3, 1, GOLD[2]);
      R(g, x, dy > 0 ? y : y - 2, 1, 3, GOLD[2]);
    }
  }
  return buf.c;
}

// ---------- words, at the screen's own sharpness ----------

const FONT = 'ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';

function outlinedText(ctx: Ctx, text: string, x: number, y: number, fill: string, u: number): void {
  ctx.lineWidth = 3.2 * u;
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function bubble(ctx: Ctx, text: string, x: number, y: number, u: number): void {
  const pad = 6 * u;
  const tw = ctx.measureText(text).width;
  const bw = Math.round(tw + pad * 2);
  const bh = Math.round(17 * u);
  const left = Math.round(clamp(x - bw / 2, 4 * u, ctx.canvas.width - bw - 4 * u));
  const top = Math.round(y - bh);
  const e = Math.max(1, Math.round(1.5 * u));
  ctx.fillStyle = INK;
  ctx.fillRect(left - e, top + e, bw + e * 2, bh - e * 2);
  ctx.fillRect(left + e, top - e, bw - e * 2, bh + e * 2);
  ctx.fillRect(Math.round(x) - 3 * e, top + bh, 6 * e, 2 * e);
  ctx.fillRect(Math.round(x) - e, top + bh + 2 * e, 2 * e, 2 * e);
  ctx.fillStyle = CREAM;
  ctx.fillRect(left, top + e, bw, bh - e * 2);
  ctx.fillRect(left + e, top, bw - e * 2, bh);
  ctx.fillRect(Math.round(x) - 2 * e, top + bh - e, 4 * e, 2 * e);
  ctx.fillRect(Math.round(x) - e, top + bh + e, 2 * e, e);
  ctx.fillStyle = INK;
  ctx.fillText(text, left + bw / 2, top + bh - 5 * u);
}

export function drawWords(ctx: Ctx): void {
  const z = G.view.z;
  const u = G.view.dpr;
  const cx = Math.round(G.cam.x);
  const cy = Math.round(G.cam.y);
  const people = [...G.mates];
  if (G.player) people.push(G.player);
  if (G.cinfy) people.push(G.cinfy);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  for (const a of people) {
    if (a.away || a.alpha < 0.5) continue;
    const at = a.seat ? { x: a.seat.x, y: a.seat.y } : a;
    if (!onScreen(at.x, at.y, 30)) continue;
    const sunk = a.seat ? (a.dir === 0 ? 2 : 5) : 0;
    const x = (at.x - cx) * z;
    const y = (at.y - cy - 21 + sunk - (a.crown ? 3 : 0)) * z - 3 * u;
    ctx.font = `600 ${Math.round(10.5 * u)}px ${FONT}`;
    ctx.globalAlpha = a.alpha;
    const plain = a === G.cinfy ? GOLD[1] : CREAM;
    outlinedText(ctx, a.you ? "You" : a.who.name, x, y, a.you ? GOLD[2] : plain, u);
    if (a.you && G.owned.has("plate")) {
      const tw = ctx.measureText("You").width / 2 + 5 * u;
      ctx.fillStyle = GOLD[1];
      ctx.fillRect(x - tw - 3 * u, y - 5 * u, 3 * u, 3 * u);
      ctx.fillRect(x + tw, y - 5 * u, 3 * u, 3 * u);
    }
    if (a.say) {
      ctx.font = `600 ${Math.round(11 * u)}px ${FONT}`;
      ctx.globalAlpha = clamp(a.sayFor / 0.25, 0, 1);
      bubble(ctx, a.say, x, y - 17 * u, u);
    }
  }
  ctx.globalAlpha = 1;

  ctx.font = `700 ${Math.round(12 * u)}px ${FONT}`;
  for (const f of floaters) {
    ctx.globalAlpha = clamp((f.ttl - f.life) / 0.4, 0, 1);
    outlinedText(ctx, f.text, clamp((f.x - cx) * z, 60 * u, ctx.canvas.width - 60 * u), (f.y - cy) * z, f.col, u);
  }
  ctx.globalAlpha = 1;

  // The soft prompt by a place the player is standing at.
  if (show.prompt && show.promptT > 0.02) {
    const pl = show.prompt;
    const key = show.touch ? "Tap" : "E";
    ctx.font = `700 ${Math.round(12 * u)}px ${FONT}`;
    const kw = ctx.measureText(key).width + 8 * u;
    const tw = ctx.measureText(pl.name).width;
    const bw = Math.round(kw + tw + 22 * u);
    const bh = Math.round(24 * u);
    const x = Math.round(clamp((pl.prompt.x - cx) * z, bw / 2 + 6 * u, ctx.canvas.width - bw / 2 - 6 * u));
    const y = Math.round(
      Math.max(70 * u, (pl.prompt.y - cy) * z) + Math.sin(G.t * 3) * 2 * u - (1 - show.promptT) * 6 * u,
    );
    const e = Math.max(1, Math.round(2 * u));
    ctx.globalAlpha = show.promptT;
    ctx.fillStyle = INK;
    ctx.fillRect(x - bw / 2 - e, y - bh, bw + e * 2, bh);
    ctx.fillRect(x - bw / 2, y - bh - e, bw, bh + e * 2);
    ctx.fillStyle = GOLD[1];
    ctx.fillRect(x - bw / 2, y - bh, bw, bh);
    ctx.fillStyle = SKY[0];
    ctx.fillRect(x - bw / 2 + e, y - bh + e, bw - e * 2, bh - e * 2);
    ctx.fillStyle = CREAM;
    ctx.fillRect(x - bw / 2 + 6 * u, y - bh + 5 * u, kw, bh - 10 * u);
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    ctx.fillText(key, x - bw / 2 + 10 * u, y - 8 * u);
    ctx.fillStyle = GOLD[2];
    ctx.fillText(pl.name, x - bw / 2 + kw + 13 * u, y - 8 * u);
    ctx.textAlign = "center";
    ctx.globalAlpha = 1;
  }
}
