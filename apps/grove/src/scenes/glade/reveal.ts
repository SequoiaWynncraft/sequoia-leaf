/**
 * A cone opening in the glade, drawn in the welcome's vocabulary over the loop. The cone rests on
 * the moss beside the tree; tapped, it kindles: the welcome campfire's flames lick up round it, it
 * warms through the glow tones and shakes, cracks show its rarity's light, and it bursts in the
 * welcome's sparkle, rings of sparkles and firefly sparks, while the spirit (from the cast's
 * sheets, when the bundle has them) leaps out onto the path. A Dryad or rarer brings the welcome's
 * aurora into the sky, leaning toward the rank's colour; Yggdrasil stops the world first.
 *
 * The timings (`coneLook`, each rank's beat) and the card are shared with the Campfire
 * (`../reveal/cone.ts`); only the world side is here. `drawReveal` draws behind the near layer,
 * `drawRevealScreen` over the whole picture afterwards (the dimming and the flash).
 */

import type { Pixels } from "../../bundle/art.ts";
import { blue, green, mixColour, packHex, red, WELCOME } from "../../bundle/palette.ts";
import type { Picture } from "../../bundle/picture.ts";
import { castFrame, leaf, mote, NEIGHBOURS, pool, propFrame } from "../../bundle/vocabulary.ts";
import { bayer } from "../../engine/dither.ts";
import { hash3 } from "../../engine/rng.ts";
import { beatOf, type ConeEvent, type ConeLook, rankColour, tier } from "../reveal/cone.ts";
import { type Fx, isTree, type Places, type Point } from "./stage.ts";

const ease = (u: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, u)), 3);
/** Yggdrasil's world stops here, once the cone has kindled (as in `coneLook`). */
const FREEZE_FROM = 0.9;

// ---------------------------------------------------------------------------------------------
// The cone: the bundle's prop (grove/props.py), shut, warming, cracking with light and open. A
// bundle without props gets the same four stages drawn here in the welcome's way: outlined, lit
// from the upper right.

type ConeKey = "o" | "c" | "a" | "l" | "g" | "w";
type ConeStage = 0 | 1 | 2 | 3;

const ROWS: Record<ConeStage, readonly string[]> = {
  0: ["..ooo..", ".oalao.", "ocalalo", "oalacao", "ocalalo", "oalacao", ".ocaao.", "..oco..", "...o..."],
  1: ["..ooo..", ".oalao.", "ocalalo", "oalacao", "ocalalo", "oalacao", ".ocaao.", "..oco..", "...o..."],
  2: ["..ooo..", ".oagao.", "ocagalo", "oalgcao", "ocagalo", "oalgcao", ".ocgao.", "..oco..", "...o..."],
  3: [".o...o.", "oaogoao", "olwwwlo", "oawwwgo", "ogwwwao", "oalwlao", ".oagao.", "..oco..", "...o..."],
};

function drawCone(fx: Fx, stage: ConeStage, x: number, y: number, outline: number | null): void {
  const f = propFrame(fx, "cone", "open", 0);
  if (f) {
    const frame = { ...f, index: stage };
    if (outline !== null) for (const [dx, dy] of NEIGHBOURS) fx.pic.sprite(frame, x + dx, y + dy, false, outline);
    fx.pic.sprite(frame, x, y);
    return;
  }
  const { ink } = fx;
  const warm = stage > 0;
  const colours: Record<ConeKey, number> = {
    o: ink.c("panda_outline"),
    c: ink.c(warm ? "glow_1" : "acorn_cap"),
    a: ink.c(warm ? "glow_2" : "acorn"),
    l: ink.c(warm ? "glow_3" : "acorn_light"),
    g: ink.c("lantern_glass_bright"),
    w: ink.c("lantern_core"),
  };
  const rows = ROWS[stage];
  const ox = x - 3;
  const oy = y - rows.length + 1;
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch !== "o" && ch !== "c" && ch !== "a" && ch !== "l" && ch !== "g" && ch !== "w") continue;
      if (outline !== null)
        for (const [dx, dy] of NEIGHBOURS)
          if (fx.pic.get(ox + c + dx, oy + r + dy) !== colours.o) fx.pic.set(ox + c + dx, oy + r + dy, outline);
      fx.pic.set(ox + c, oy + r, colours[ch]);
    }
  });
}

/** The next cone, resting on the moss by the tree. */
export function drawRestingCone(fx: Fx): void {
  drawCone(fx, 0, fx.places.cone.x, fx.places.cone.y, null);
}

/** A tap on the resting cone. */
export const coneHit = (at: Places, x: number, y: number): boolean =>
  x >= at.cone.x - 6 && x <= at.cone.x + 6 && y >= at.cone.y - 12 && y <= at.cone.y + 3;

// ---------------------------------------------------------------------------------------------
// The opening.

/** The flames of the welcome's campfire (grove/campfire.py `FLAME`), base to tip. */
const FLAME = [
  WELCOME.lantern_core,
  WELCOME.lantern_glass_bright,
  WELCOME.lantern_glass,
  WELCOME.panda_tail_red,
  WELCOME.panda_tail_red_shadow,
].map(packHex);

function kindle(fx: Fx, x: number, y: number, t: number, size: number): void {
  for (let k = -1; k <= 1; k++) {
    const fx0 = x + k * 3;
    const h = Math.round(
      size * (k === 0 ? 1 : 0.6) * (0.7 + 0.3 * Math.sin(t * 17 + k * 2.1)) + hash3(k, Math.floor(t * 12), 3),
    );
    for (let i = 0; i < h; i++) {
      const sway = Math.round(Math.sin(t * 9 + i * 0.8 + k) * (i / 4));
      const c = FLAME[Math.min(FLAME.length - 1, Math.floor((i / Math.max(1, h)) * FLAME.length))] ?? 0;
      fx.pic.set(fx0 + sway, y - i, c);
      if (i < h * 0.4 && k === 0) fx.pic.set(fx0 + sway + 1, y - i, FLAME[1] ?? c);
    }
  }
}

/** Where the cone is, and how it moves, `tau` after the tap: a hop into the hearth, then the heat. */
function conePose(at: Places, tau: number, opensAt: number, freeze: boolean): Point {
  const fire = { x: at.hearth.x - 1, y: at.hearth.y - 1 };
  let x = fire.x;
  let y = fire.y;
  if (tau < 0.4) {
    const u = tau / 0.4;
    x = Math.round(at.cone.x + (fire.x - at.cone.x) * u);
    y = Math.round(at.cone.y + (fire.y - at.cone.y) * u - Math.sin(u * Math.PI) * at.arc);
  } else if (tau < opensAt) {
    if (freeze && tau > FREEZE_FROM) {
      const beat = (tau - FREEZE_FROM) % 0.55;
      if (tau < opensAt - 0.7 && (beat < 0.06 || (beat > 0.14 && beat < 0.2))) y -= 1;
    } else {
      x += Math.round(Math.sin(tau * 46) * Math.min(1.4, 0.3 + (tau - 0.5) * (2 / opensAt)));
      if (tau > opensAt * 0.45 && (tau / opensAt) % 0.25 < 0.03) y -= 1;
    }
  }
  return { x, y };
}

export function drawReveal(
  fx: Fx,
  ev: ConeEvent,
  look: ConeLook,
  t: number,
  aurora: Pixels | null,
  frame: number,
): void {
  const b = beatOf(ev.rank);
  const tau = t - ev.t0;
  const since = tau - b.burst;
  const { pic, ink } = fx;
  const rare = ink.any(rankColour(ev.rank), true);
  const rareLight = mixColour(rare, ink.c("star"), 0.45);
  const star = ink.c("star");

  if (look.aurora > 0 && aurora)
    drawAurora(fx, aurora, frame, { strength: look.aurora, span: [0, 46, 84, 140][b.aurora] ?? 140, gold: b.freeze });

  const pose = conePose(fx.places, tau, b.burst, b.freeze);
  const cx = pose.x;
  const cy = pose.y - 5;
  const closing = ev.closedAt === null ? 0 : (t - ev.closedAt) / 0.6;
  if (closing < 1) {
    // Kindling: the campfire's flames take the cone, its warmth spilling onto the moss.
    if (tau > 0.4 && since < 0.35) {
      kindle(fx, cx, pose.y, t, 3 + Math.min(4, (tau - 0.4) * 3));
      pool(fx, cx, pose.y - 3, 10 + (tau - 0.4) * 4, ink.c("lantern_light"), 0.35 + look.flare * 0.5);
    }
    if (since < 0.6) {
      const stage: ConeStage = tau < 0.4 ? 0 : tau < b.burst - 0.6 ? 1 : since < 0 ? 2 : 3;
      // Heat: a glowing edge round the cone that pulses faster as it nears opening.
      const pulse = b.freeze
        ? (tau - FREEZE_FROM) % 0.55 < 0.24 || tau > b.burst - 0.7
        : Math.sin(tau * (8 + tau * (12 / b.burst))) > -0.2;
      const hot = tau > 0.6 && since < 0 && pulse ? (tau > b.burst - 0.6 ? rare : ink.c("glow_3")) : null;
      drawCone(fx, stage, pose.x, pose.y, hot);
    }
    // Embers lifting off it.
    if (look.embers > 0)
      for (let i = 0; i < 8; i++) {
        const u = (((tau * 0.7 + hash3(i, 1, 41)) % 1) + 1) % 1;
        const x = cx + Math.round((hash3(i, 2, 41) - 0.5) * 8 + Math.sin(u * 6 + i) * 2);
        pic.set(x, pose.y - 4 - Math.round(u * 18), ink.c(u < 0.5 ? "glow_4" : "glow_3"));
      }
  }

  // Its rarity's light, showing through as it cracks, then thrown wide.
  if (tau > b.burst - 0.7) {
    const k = since < 0 ? (tau - (b.burst - 0.7)) / 0.7 : Math.max(0.3, 1 - since * 0.5);
    pool(fx, cx, cy, (b.dim > 0 ? 10 : 5) + (b.dim > 0 ? 20 : 8) * k, rare, 0.5 * k * (1 - Math.max(0, closing)));
  }
  // Yggdrasil: light gathers in from all round before the burst.
  if (b.freeze && since > -1 && since < 0) {
    const u = since + 1;
    for (let i = 0; i < 40; i++) {
      const a = hash3(i, 1, 21) * Math.PI * 2;
      const r = (1 - ((u + hash3(i, 2, 21)) % 1)) * 70 + 4;
      pic.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.7, r < 20 ? rareLight : rare);
    }
  }

  if (!b.beam && b.rings === 0) {
    // Leafkin: no fuss. A puff, three leaves and a wink of a sparkle, pop!
    puff(fx, cx, cy, since);
  } else {
    if (b.beam && since > -0.3 && since < 0.45) beam(fx, cx, cy, since, rare, rareLight);
    if (since >= 0) burst(fx, ev, cx, cy, since, rare, rareLight, star);
  }
  drawSpirit(fx, ev, t, cx, cy, rare, rareLight);
}

function puff(fx: Fx, cx: number, cy: number, since: number): void {
  if (since < 0 || since > 0.9) return;
  const { pic, ink } = fx;
  const r = 3 + since * 14;
  const n = Math.round(r * 5);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    if (hash3(k, Math.floor(since * 10), 7) < since * 1.1) continue;
    pic.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6, ink.c(since < 0.3 ? "puff" : "puff_shadow"));
  }
  for (let i = 0; i < 3; i++) {
    const x = cx + (i - 1) * 6 * ease(since * 2) + Math.sin(since * 9 + i) * 1.5;
    const y = cy - 12 * Math.sin(Math.min(1, since * 1.6) * Math.PI) + since * 8;
    leaf(fx, Math.round(x), Math.round(y), Math.floor(since * 8 + i), ink.c("leaf_light"), ink.c("leaf"));
  }
  if (since < 0.25) pic.sparkle(cx, cy, since < 0.08 ? 1 : 2, ink.c("star"), ink.c("star_arm"));
}

/** A column of the rarity's light rising as the scales part, thinning through the dither. */
function beam(fx: Fx, cx: number, cy: number, since: number, rare: number, rareLight: number): void {
  const u = (since + 0.3) / 0.75;
  const h = 120 * ease(u * 2);
  const fade = since > 0 ? 1 - since / 0.45 : 1;
  const wide = 1 + Math.round(ease(u * 3) * 2);
  for (let y = 0; y < h; y++) {
    const v = (1 - (y / h) * 0.8) * fade;
    for (let dx = -wide - 1; dx <= wide + 1; dx++) {
      const ad = Math.abs(dx);
      const edge = ad > wide;
      if (bayer(cx + dx, cy - y) > v * (edge ? 0.4 : 1.1)) continue;
      fx.pic.set(cx + dx, cy - y - 3, ad === 0 ? fx.ink.c("magic_core") : edge ? rare : rareLight);
    }
  }
}

function burst(
  fx: Fx,
  ev: ConeEvent,
  cx: number,
  cy: number,
  since: number,
  rare: number,
  rareLight: number,
  star: number,
): void {
  const b = beatOf(ev.rank);
  const rk = tier(ev.rank);
  const { pic, ink } = fx;
  // The heart of the burst: the welcome's big sparkle, closing as it fades.
  if (since < 0.6) pic.sparkle(cx, cy, since < 0.4 ? 2 : 1, star, rareLight);
  // Rays of the rarity's light reaching out and thinning, turning slowly.
  const life = Math.max(0, 1 - since / 1.5);
  const rays = 8 + rk * 2;
  const reach = 20 + (40 + rk * 5) * ease(since / 0.45);
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + since * 0.3 + 0.2;
    const len = reach * (i % 2 === 0 ? 1 : 0.58);
    for (let r = 6; r < len; r++) {
      const v = (1 - r / len) * life;
      if (v <= 0.04 || bayer(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)) > v * 1.6) continue;
      pic.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.82, v > 0.5 ? rareLight : rare);
    }
  }
  // Rings of sparkles, more for the rarer spirits.
  for (const delay of [0, 0.14, 0.3].slice(0, b.rings)) {
    const u = (since - delay) / 0.6;
    if (u < 0 || u > 1) continue;
    const rr = 6 + u * (44 + rk * 4);
    const n = Math.round(10 + rr * 0.5);
    for (let k = 0; k < n; k++) {
      if (hash3(k, Math.floor(u * 6), 3) < u * 0.6) continue;
      const a = (k / n) * Math.PI * 2 + delay;
      pic.sparkle(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.55, u < 0.5 ? 1 : 0, star, rare);
    }
  }
  // Firefly sparks thrown out and falling, and seeds fluttering down.
  for (let i = 0; i < 16 + rk * 5; i++) {
    const a = -Math.PI * (0.05 + 0.9 * hash3(i, 1, 9));
    const v = 40 + hash3(i, 2, 9) * 60;
    const age = since / (0.9 + hash3(i, 3, 9) * 0.8);
    if (age > 1) continue;
    const x = Math.round(cx + Math.cos(a) * v * since);
    const y = Math.round(cy + Math.sin(a) * v * since + 70 * since * since);
    if (i % 3 === 0) pic.set(x, y, age < 0.5 ? rareLight : rare);
    else mote(fx, x, y, 1 - age);
  }
  for (let i = 0; i < 6; i++) {
    const u = since / 3.2;
    if (u > 1) continue;
    const x = cx + (hash3(i, 4, 9) - 0.5) * 50 * ease(since * 2) + Math.sin(since * 4 + i) * 3;
    const y = cy - 22 * ease(since * 3) + since * 14 * (0.8 + hash3(i, 5, 9) * 0.6);
    leaf(fx, Math.round(x), Math.round(y), Math.floor(since * 6 + i), ink.c("acorn_light"), ink.c("acorn"));
  }
}

/** The spirit leaping out onto the path: from the cast's sheets, or nothing while there are none. */
function drawSpirit(fx: Fx, ev: ConeEvent, t: number, cx: number, cy: number, rare: number, rareLight: number): void {
  const b = beatOf(ev.rank);
  const tau = t - ev.t0;
  const quick = b.rings === 0;
  const start = b.burst + (quick ? 0.05 : 0.15);
  if (tau < start) return;
  const land = fx.places.landing;
  const flight = quick ? 0.4 : 0.75;
  const u = (tau - start) / flight;
  let x = land.x;
  let y = land.y;
  if (u < 1) {
    x = cx + (land.x - cx) * u;
    y = cy + (land.y - cy) * u - Math.sin(u * Math.PI) * (quick ? 14 : 24);
  } else {
    const hop = ((tau - start - flight) % 1.3) / 1.3;
    if (hop >= 0.12 && hop < 0.32) y -= Math.round(Math.sin(((hop - 0.12) / 0.2) * Math.PI) * 3);
  }
  if (ev.closedAt !== null) {
    // Off to the tree with a hop, fading to a sparkle.
    const c = (t - ev.closedAt) / 0.6;
    if (c >= 1) return;
    x += c * -30;
    y -= Math.sin(c * Math.PI) * 10;
    if (c > 0.6) {
      fx.pic.sparkle(x, y - 6, 1, fx.ink.c("star"), rare);
      return;
    }
  }
  const f = castFrame(fx, [ev.spirit], u < 1 ? ["hop", "jump", "idle"] : ["happy", "idle"], (tau - start) * 1000);
  const glowing = u < (quick ? 0.25 : 0.55);
  // While it flies it is still all light, its shape in its rarity's colour.
  if (f) fx.pic.sprite(f, x, y, true, glowing ? rareLight : undefined);
  else if (u < 1) fx.pic.sparkle(x, y - 4, 1, fx.ink.c("star"), rare);
  // Its sparkles round it, twinkling in turn.
  if (!glowing)
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + tau * 0.6;
      const glint = 0.5 + 0.5 * Math.sin(tau * 3 + i * 2);
      if (glint < 0.45) continue;
      fx.pic.sparkle(
        Math.round(x + Math.cos(a) * 11),
        Math.round(y - 7 + Math.sin(a) * 7),
        glint > 0.8 ? 1 : 0,
        fx.ink.c("star"),
        rare,
      );
    }
}

// ---------------------------------------------------------------------------------------------
// The sky and the frame-wide part.

/** How much of the sky the aurora takes: a band round the middle, wider for the rarer ranks. */
export interface AuroraLook {
  /** 0 to 1: how far it has come in; it thins in through the dither. */
  strength: number;
  /** Columns either side of the middle it reaches. */
  span: number;
  /** Yggdrasil's: the same curtains in gold. */
  gold: boolean;
}

/** The gold an aurora takes for Yggdrasil, by brightness. */
const GOLD = ["#4a2f1c", "#a0673e", "#e0a83e", "#ffd97a", "#fff6d2"].map(packHex);

function golden(v: number): number {
  const l = (red(v) * 0.3 + green(v) * 0.59 + blue(v) * 0.11) / 255;
  const k = Math.max(0, Math.min(GOLD.length - 1.001, (l - 0.2) * 6.5));
  const i = Math.floor(k);
  return mixColour(GOLD[i] ?? 0, GOLD[i + 1] ?? 0, k - i);
}

/**
 * The welcome's aurora (the bundle's effects atlas, already kept to the open sky and off the
 * forest's own motion) for loop frame `frame`, kept off the tree, in its own colours.
 */
export function drawAurora(fx: Fx, atlas: Pixels, frame: number, look: AuroraLook): void {
  const { pic, tree } = fx;
  if (look.strength <= 0) return;
  const frames = Math.max(1, Math.floor(atlas.h / pic.H));
  const top = (frame % frames) * pic.H * atlas.w;
  const mid = pic.W / 2;
  for (let y = 0; y < pic.H; y++)
    for (let x = 0; x < pic.W; x++) {
      const v = atlas.data[top + y * atlas.w + x] ?? 0;
      if (v >>> 24 < 128) continue;
      // Its edges, and its coming in, thin through the dither rather than fade.
      const edge = Math.min(1, Math.max(0, (look.span - Math.abs(x - mid)) / 14));
      if (bayer(x, y) >= edge * look.strength * 1.02 || isTree(tree, x, y)) continue;
      const c = (v | 0xff000000) >>> 0;
      pic.set(x, y, look.gold ? golden(c) : c);
    }
}

/** The world dimmed round the cone's spotlight, and the burst's flash, over the whole picture. */
export function drawRevealScreen(pic: Picture, at: Places, look: ConeLook, rank: ConeEvent["rank"]): void {
  if (look.dim <= 0 && look.flash <= 0) return;
  const rc = packHex(rankColour(rank));
  const fx0 = at.hearth.x;
  const fy0 = at.hearth.y - 10;
  const dark = 0xff0a0610;
  for (let y = 0; y < pic.H; y++)
    for (let x = 0; x < pic.W; x++) {
      const i = y * pic.W + x;
      let v = pic.px[i] ?? 0;
      if (look.dim > 0) {
        const d = Math.hypot((x - fx0) / 62, (y - fy0) / 46);
        const k = Math.min(1, Math.max(0, (d - 0.55) * 2.2));
        const level = Math.floor(k * 3 + bayer(x, y) * 0.99) / 3;
        if (level > 0) v = mixColour(v, dark, 0.55 * look.dim * level);
      }
      if (look.flash > 0) {
        const f = look.flash * Math.max(0.25, 1 - Math.hypot(x - fx0, (y - fy0) * 1.3) / 160);
        v = mixColour(v, mixColour(rc, 0xffffffff, 0.35), f);
      }
      pic.px[i] = v;
    }
}
