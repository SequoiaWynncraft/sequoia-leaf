/**
 * The cast's contact sheet. Every sprite animating at 1x, 3x and 6x over the glade's four lights, the
 * portraits on the mod's slate card, every frame laid out still, and the cast in a line on the glade.
 *
 * Parameters: `view=sheet|frames|portraits|lineup|silhouette`, `only=id,id`, `light=dusk,day,night,winter`,
 * `still` and `t=` to freeze the clock. `light=firelit` adds night by the campfire.
 */

import boldUrl from "../pixel/fonts/minecraft-bold.woff2";
import regularUrl from "../pixel/fonts/minecraft-regular.woff2";
import { buildLut, ix, type Lut, R, type Season, type Time } from "../pixel/palette.ts";
import { Light, type Sprite, Surface } from "../pixel/raster.ts";
import { hash3 } from "../pixel/rng.ts";
import { CAST, type CastMember } from "./cast.ts";
import { type Frame, frameAt } from "./kit.ts";
import { buildCastLut, composeCast } from "./palette-cast.ts";

type LightName = "dusk" | "day" | "night" | "winter" | "firelit";
const LIGHTS: readonly LightName[] = ["dusk", "day", "night", "winter", "firelit"];
const DEFAULT_LIGHTS: readonly LightName[] = ["dusk", "day", "night", "winter"];
/** `firelit` is night by the campfire: every pixel one warm step up, as the glade's fire lights a spirit. */
const lightOf = (l: LightName): { time: Time; season: Season } =>
  l === "winter"
    ? { time: "dusk", season: "winter" }
    : l === "firelit"
      ? { time: "night", season: "normal" }
      : { time: l, season: "normal" };

const q = new URLSearchParams(location.search);
const view = q.get("view") ?? "sheet";
const only = q.get("only")?.split(",").filter(Boolean) ?? null;
const lights: LightName[] = (q.get("light")?.split(",") ?? [...DEFAULT_LIGHTS]).filter((l): l is LightName =>
  LIGHTS.some((k) => k === l),
);
const still = q.has("still");
const stillT = Number(q.get("t") ?? 0) || 0;
const cast = CAST.filter((m) => !only || only.includes(m.id));

const luts = new Map<LightName, { glade: Lut; cast: Lut }>();
for (const l of LIGHTS) {
  const { time, season } = lightOf(l);
  luts.set(l, { glade: buildLut(time, season, "#fdd36f"), cast: buildCastLut(time, season) });
}

// ---------------------------------------------------------------------------------------------
// A cell: a little piece of glade at art resolution with one frame standing on its ground.

/** Draws a backdrop of the glade into `s`: sky, a far ridge, the ground, a few tufts. */
function backdrop(s: Surface, light: LightName, ground: number): void {
  const winter = light === "winter";
  for (let y = 0; y < s.h; y++) {
    const u = y / Math.max(1, ground);
    const sky = u < 0.34 ? ix(R.SKY1, 1 + Math.floor(u * 9)) : ix(R.SKY2, Math.min(7, Math.floor((u - 0.34) * 9)));
    s.rect(0, y, s.w, 1, y < ground ? sky : 0);
  }
  for (let x = 0; x < s.w; x++) {
    const ridge = ground - 3 - Math.round(2 * Math.sin(x * 0.21) + 1.5 * Math.sin(x * 0.07 + 1));
    for (let y = Math.max(0, ridge); y < ground; y++) s.set(x, y, ix(R.FAR, 3));
    for (let y = ground; y < s.h; y++) {
      const top = y === ground;
      if (winter) s.set(x, y, ix(R.SNOW, top ? 6 : y === ground + 1 ? 5 : 3));
      else s.set(x, y, top ? ix(R.MOSS, 5) : ix(R.MOSS, y === ground + 1 ? 3 : 2));
    }
    if (!winter && hash3(x, 7) < 0.18) s.set(x, ground - 1, ix(R.FERN, 4 + Math.floor(hash3(x, 9) * 2)));
  }
}

/** One frame composed over its backdrop, as RGBA pixels at art resolution. */
function cell(
  f: Frame | null,
  w: number,
  h: number,
  ground: number,
  light: LightName,
  opts: { solid?: boolean } = {},
): ImageData {
  const bg = new Surface(w, h);
  const fg = new Surface(w, h);
  const lit = new Light(w, h);
  backdrop(bg, light, ground);
  if (light === "firelit") lit.data.fill(2);
  if (f) {
    const x = Math.floor(w / 2) - f.ax;
    const y = ground - f.ay;
    fg.blit(f.sprite, x, y, opts.solid ? { solid: ix(R.INK, 0) } : {});
  }
  const img = new ImageData(w, h);
  const l = luts.get(light);
  if (l) composeCast(bg, fg, lit, l.glade, l.cast, new Uint32Array(img.data.buffer));
  return img;
}

/** The largest box any frame of an animation needs, around its ground point. */
function extent(frames: readonly Frame[]): { left: number; right: number; up: number; down: number } {
  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  for (const f of frames) {
    left = Math.max(left, f.ax);
    right = Math.max(right, f.sprite.w - f.ax);
    up = Math.max(up, f.ay + 1);
    down = Math.max(down, f.sprite.h - f.ay - 1);
  }
  return { left, right, up, down };
}

// ---------------------------------------------------------------------------------------------
// Drawing onto the page canvas.

const canvas = document.getElementById("sheet");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no canvas");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("no 2d context");
const scratch = document.createElement("canvas");
const sctx = scratch.getContext("2d");
if (!sctx) throw new Error("no scratch context");

function put(img: ImageData, x: number, y: number, scale: number): void {
  if (!ctx || !sctx) return;
  scratch.width = img.width;
  scratch.height = img.height;
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, x, y, img.width * scale, img.height * scale);
}

/** A sprite alone on the mod's slate card (popup background rgba(40,40,55)). */
function card(sp: Sprite, x: number, y: number, scale: number, light: LightName): void {
  const pad = 3;
  const w = sp.w + pad * 2;
  const h = sp.h + pad * 2;
  const img = new ImageData(w, h);
  const out = new Uint32Array(img.data.buffer);
  out.fill(0xff372828);
  // Cut-corner border, one art pixel, Sequoia purple, as PixelArt.pixelPanel draws it.
  for (let i = 1; i < w - 1; i++) {
    out[i] = 0xffdc82a0;
    out[(h - 1) * w + i] = 0xff781e3c;
  }
  for (let j = 1; j < h - 1; j++) {
    out[j * w] = 0xffdc82a0;
    out[j * w + w - 1] = 0xff781e3c;
  }
  const lut = luts.get(light)?.cast.levels[0];
  if (lut) {
    for (let j = 0; j < sp.h; j++) {
      for (let i = 0; i < sp.w; i++) {
        const v = sp.data[j * sp.w + i] ?? 0;
        if (v) out[(j + pad) * w + i + pad] = lut[v] ?? 0;
      }
    }
  }
  put(img, x, y, scale);
}

function label(text: string, x: number, y: number, size = 16, colour = "#f2e6d4"): void {
  if (!ctx) return;
  ctx.font = `${size}px Minecraft, monospace`;
  ctx.fillStyle = colour;
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
}

// ---------------------------------------------------------------------------------------------
// Layouts. Each returns its size and draws at time `ms`.

interface Row {
  title: string;
  member: CastMember;
  frames: readonly Frame[];
  happy: readonly Frame[] | null;
  portrait: boolean;
}

function rows(): Row[] {
  const out: Row[] = [];
  for (const m of cast) {
    out.push({ title: m.name, member: m, frames: m.idle, happy: m.happy, portrait: true });
    for (const [pose, frames] of Object.entries(m.poses)) {
      out.push({ title: `${m.name}: ${pose}`, member: m, frames, happy: null, portrait: false });
    }
  }
  return out;
}

const SCALES = [1, 3, 6] as const;
const GAP = 10;

function drawSheet(ms: number, measure: boolean): { w: number; h: number } {
  const all = rows();
  const labelW = 190;
  const portraitW = (32 + 6) * 3 + GAP * 2;
  const panelW = Math.max(...all.map((r) => cellBox(r).cw)) * (1 + 3 + 6 + 3) + GAP * 6;
  const x0 = labelW + portraitW;
  let y = 44;
  if (!measure) {
    label("Sequoia Grove · the cast", 12, 10, 24);
    lights.forEach((l, i) => label(l, x0 + i * panelW, 26, 16, "#e8a33d"));
  }
  for (const r of all) {
    const { cw, ch, ground } = cellBox(r);
    const rowH = Math.max(ch * 6, r.portrait ? (32 + 6) * 3 : 0) + GAP * 2;
    if (!measure) {
      label(r.title, 12, y + 4, 16, r.portrait ? "#f2e6d4" : "#a092b4");
      if (r.portrait) {
        card(r.member.portrait, labelW, y, 3, "dusk");
        card(r.member.portrait, 12, y + 32, 1, "dusk");
      }
      lights.forEach((l, i) => {
        let x = x0 + i * panelW;
        const f = frameAt(r.frames, ms);
        for (const s of SCALES) {
          put(cell(f, cw, ch, ground, l), x, y, s);
          x += cw * s + GAP;
        }
        const hf = r.happy ? happyFrame(r.happy, ms) : null;
        if (hf) put(cell(hf, cw, ch, ground, l), x, y, 3);
      });
    }
    y += rowH;
  }
  return { w: x0 + lights.length * panelW + 12, h: y + 12 };
}

function cellBox(r: Row): { cw: number; ch: number; ground: number } {
  const e = extent([...r.frames, ...(r.happy ?? [])]);
  return { cw: e.left + e.right + 4, ch: e.up + e.down + 4, ground: e.up + 2 };
}

/** The happy burst plays once, then the spirit rests a moment before it plays again. */
function happyLoop(frames: readonly Frame[]): number {
  return frames.reduce((s, f) => s + f.ms, 0) + 900;
}
function happyFrame(frames: readonly Frame[], ms: number): Frame | null {
  const u = ms % happyLoop(frames);
  let t = 0;
  for (const f of frames) {
    if (u < t + f.ms) return f;
    t += f.ms;
  }
  return frames[frames.length - 1] ?? null;
}

/** Every frame of every animation, still, at 4x on dusk. */
function drawFrames(_ms: number, measure: boolean): { w: number; h: number } {
  const scale = Number(q.get("scale") ?? 4) || 4;
  let y = 12;
  let width = 0;
  for (const r of rows()) {
    const anims: [string, readonly Frame[]][] = [["", r.frames]];
    if (r.happy) anims.push(["happy", r.happy]);
    for (const [name, frames] of anims) {
      const e = extent(frames);
      const cw = e.left + e.right + 4;
      const ch = e.up + e.down + 4;
      if (!measure) label(`${r.title}${name ? ` · ${name}` : ""}`, 12, y, 16);
      let x = 200;
      for (const f of frames) {
        if (!measure) put(cell(f, cw, ch, e.up + 2, lights[0] ?? "dusk"), x, y, scale);
        x += cw * scale + GAP;
      }
      width = Math.max(width, x);
      y += ch * scale + GAP;
    }
  }
  return { w: width + 12, h: y };
}

/** The portraits on slate cards at 1x, 2x and 3x. */
function drawPortraits(_ms: number, measure: boolean): { w: number; h: number } {
  const perRow = 4;
  const cellW = 38 * 6 + 3 * GAP + 20;
  const cellH = 38 * 3 + 40;
  const members = cast;
  members.forEach((m, i) => {
    const x = 12 + (i % perRow) * cellW;
    const y = 12 + Math.floor(i / perRow) * cellH;
    if (measure) return;
    label(m.name, x, y, 16);
    card(m.portrait, x, y + 22, 1, "dusk");
    card(m.portrait, x + 38 + GAP, y + 22, 2, "dusk");
    card(m.portrait, x + 38 * 3 + GAP * 2, y + 22, 3, "dusk");
  });
  return { w: 12 + perRow * cellW, h: 12 + Math.ceil(members.length / perRow) * cellH };
}

/** The cast standing in a line on the glade at true size, shown at 3x, once per light. */
function drawLineup(ms: number, measure: boolean, solid: boolean): { w: number; h: number } {
  const scale = Number(q.get("scale") ?? 3) || 3;
  const members = cast;
  const boxes = members.map((m) => extent(m.idle));
  const w = boxes.reduce((s, b) => s + b.left + b.right + 3, 6);
  const up = Math.max(...boxes.map((b) => b.up)) + 6;
  const h = up + 8;
  let y = 12;
  for (const l of lights) {
    if (!measure) {
      label(l, 12, y, 16, "#e8a33d");
      const bg = new Surface(w, h);
      const fg = new Surface(w, h);
      const lit = new Light(w, h);
      backdrop(bg, l, up);
      if (l === "firelit") lit.data.fill(2);
      let x = 4;
      members.forEach((m, i) => {
        const b = boxes[i];
        if (!b) return;
        const f = frameAt(m.idle, ms + i * 337);
        fg.blit(f.sprite, x + b.left - f.ax, up - f.ay, solid ? { solid: ix(R.INK, 0) } : {});
        x += b.left + b.right + 3;
      });
      const img = new ImageData(w, h);
      const lut = luts.get(l);
      if (lut) composeCast(bg, fg, lit, lut.glade, lut.cast, new Uint32Array(img.data.buffer));
      put(img, 12, y + 22, scale);
    }
    y += h * scale + 40;
  }
  return { w: w * scale + 24, h: y };
}

const layouts: Record<string, (ms: number, measure: boolean) => { w: number; h: number }> = {
  sheet: drawSheet,
  frames: drawFrames,
  portraits: drawPortraits,
  lineup: (ms, m) => drawLineup(ms, m, false),
  silhouette: (ms, m) => drawLineup(ms, m, true),
};
const layout = layouts[view] ?? drawSheet;

const size = layout(0, true);
canvas.width = size.w;
canvas.height = size.h;
canvas.style.width = `${size.w}px`;
canvas.style.height = `${size.h}px`;

const start = performance.now();
function tick(): void {
  if (!ctx) return;
  ctx.fillStyle = "#150f0d";
  ctx.fillRect(
    0,
    0,
    canvas instanceof HTMLCanvasElement ? canvas.width : 0,
    canvas instanceof HTMLCanvasElement ? canvas.height : 0,
  );
  layout(still ? stillT * 1000 : performance.now() - start, false);
  if (!still) requestAnimationFrame(tick);
}

const faces = [
  new FontFace("Minecraft", `url(${regularUrl})`),
  new FontFace("Minecraft", `url(${boldUrl})`, { weight: "bold" }),
];
async function loadFontsThenRun(): Promise<void> {
  try {
    for (const f of await Promise.all(faces.map((face) => face.load()))) document.fonts.add(f);
  } finally {
    requestAnimationFrame(tick);
  }
}
void loadFontsThenRun();
