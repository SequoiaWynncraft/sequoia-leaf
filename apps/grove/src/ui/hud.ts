/**
 * The HUD, in the Sequoia mod's pixel style (Sequoia-mod/.../ui/unlock/PixelArt.java): dark slate
 * panels with one-pixel borders and cut corners, a lit inner top row and a shaded bottom row;
 * outlined numerals in the Minecraft font; segmented bars like Minecraft's experience bar; 16x16
 * icons in square slots. Drawn straight onto the frame's pixels, on the same grid as the art.
 */

import { ix, R } from "../engine/palette.ts";
import { fromRows, type Sprite } from "../engine/raster.ts";
import type { Tool } from "../game/params.ts";

export type Rgb = readonly [number, number, number];

export const UI = {
  popup: [40, 40, 55] as Rgb,
  body: [20, 20, 30] as Rgb,
  purple: [160, 130, 220] as Rgb,
  purpleHover: [190, 160, 250] as Rgb,
  purpleDark: [60, 30, 120] as Rgb,
  leaf: [88, 196, 122] as Rgb,
  gold: [242, 192, 68] as Rgb,
  levelGreen: [206, 242, 156] as Rgb,
  levelEdge: [24, 44, 16] as Rgb,
  text: [255, 255, 255] as Rgb,
  textSecondary: [220, 220, 230] as Rgb,
  muted: [160, 160, 180] as Rgb,
  lore: [176, 150, 232] as Rgb,
  ink: [8, 6, 12] as Rgb,
  danger: [226, 108, 118] as Rgb,
};

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const hex = (h: string): Rgb => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

export class Canvas {
  readonly out: Uint32Array;
  readonly W: number;
  readonly H: number;

  constructor(out: Uint32Array, W: number, H: number) {
    this.out = out;
    this.W = W;
    this.H = H;
  }

  /** Clears to transparent, for a layer that lies over the world. */
  clear(): void {
    this.out.fill(0);
  }

  /** One pixel, laid over what is there; a see-through layer keeps its own transparency. */
  px(x: number, y: number, c: Rgb, a = 1): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H || a <= 0) return;
    const i = y * this.W + x;
    const v = this.out[i] ?? 0;
    const da = (v >>> 24) / 255;
    if (a >= 1 || da === 0) {
      const alpha = Math.round(Math.min(1, a) * 255);
      this.out[i] = ((alpha << 24) | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0])) >>> 0;
      return;
    }
    const oa = a + da * (1 - a);
    const k = (da * (1 - a)) / oa;
    const r = (v & 255) * k + c[0] * (a / oa);
    const g = ((v >> 8) & 255) * k + c[1] * (a / oa);
    const b = ((v >> 16) & 255) * k + c[2] * (a / oa);
    this.out[i] = ((Math.round(oa * 255) << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
  }

  rect(x: number, y: number, w: number, h: number, c: Rgb, a = 1): void {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.px(x + xx, y + yy, c, a);
  }

  /** `PixelArt.pixelBorder`: a one-pixel border with its corners cut. */
  border(x: number, y: number, w: number, h: number, c: Rgb, a = 1): void {
    this.rect(x + 1, y, w - 2, 1, c, a);
    this.rect(x + 1, y + h - 1, w - 2, 1, c, a);
    this.rect(x, y + 1, 1, h - 2, c, a);
    this.rect(x + w - 1, y + 1, 1, h - 2, c, a);
  }

  /** `PixelArt.pixelPanel`: popup fill, accent border, the accent fading in over two top rows, a shaded bottom row. */
  panel(x: number, y: number, w: number, h: number, accent: Rgb, fill = 0.94, body: Rgb = UI.popup): void {
    this.rect(x + 1, y + 1, w - 2, h - 2, body, fill);
    this.border(x, y, w, h, accent);
    this.rect(x + 1, y + 1, w - 2, 1, accent, 0.42);
    if (h >= 8) this.rect(x + 1, y + 2, w - 2, 1, accent, 0.16);
    this.rect(x + 1, y + h - 2, w - 2, 1, mix(accent, [0, 0, 0], 0.6), 0.4);
  }

  /** `PixelArt.progressBar` with notches, like Minecraft's experience bar. */
  bar(x: number, y: number, w: number, h: number, ratio: number, fill: Rgb, notches: number): void {
    const outline = mix(fill, UI.ink, 0.8);
    this.border(x, y, w, h, outline);
    const iw = w - 2;
    const ih = h - 2;
    this.rect(x + 1, y + 1, iw, ih, mix(fill, UI.ink, 0.7));
    this.rect(x + 1, y + 1, iw, 1, [0, 0, 0], 0.35);
    const filled = ratio <= 0 ? 0 : ratio >= 1 ? iw : Math.max(1, Math.min(iw - 1, Math.round(iw * ratio)));
    if (filled > 0) {
      this.rect(x + 1, y + 1, filled, ih, fill);
      this.rect(x + 1, y + 1, filled, 1, mix(fill, [255, 255, 255], 0.45));
      if (ih >= 3) this.rect(x + 1, y + h - 2, filled, 1, mix(fill, [0, 0, 0], 0.3));
    }
    for (let i = 1; i < notches; i++) {
      const nx = x + 1 + Math.round((iw * i) / notches);
      this.rect(nx, y + 1, 1, ih, UI.ink, 0.45);
    }
  }

  /** A palette sprite, its indices turned to colours by `rgb`. */
  indexed(sp: Sprite, x: number, y: number, rgb: (index: number) => Rgb): void {
    for (let yy = 0; yy < sp.h; yy++)
      for (let xx = 0; xx < sp.w; xx++) {
        const v = sp.data[yy * sp.w + xx] ?? 0;
        if (v) this.px(x + xx, y + yy, rgb(v));
      }
  }

  /** A sprite of RGB pixels (null transparent). */
  icon(rows: readonly string[], legend: Readonly<Record<string, Rgb>>, x: number, y: number, a = 1): void {
    rows.forEach((row, yy) => {
      for (let xx = 0; xx < row.length; xx++) {
        const c = legend[row[xx] ?? "."];
        if (c) this.px(x + xx, y + yy, c, a);
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Text in the Minecraft font, one font pixel to one art pixel (10px, as the mod's size 10).

interface Glyphs {
  w: number;
  h: number;
  mask: Uint8Array;
}

const BASELINE = 10;
const CAP_TOP = BASELINE - 7;
const cache = new Map<string, Glyphs>();
let scratch: HTMLCanvasElement | null = null;

function rasterise(text: string, bold: boolean): Glyphs {
  const key = (bold ? "b:" : "r:") + text;
  const hit = cache.get(key);
  if (hit) return hit;
  scratch ??= document.createElement("canvas");
  const g = scratch.getContext("2d", { willReadFrequently: true });
  if (!g) return { w: 0, h: 0, mask: new Uint8Array(0) };
  g.font = `${bold ? "bold " : ""}10px Minecraft`;
  const w = Math.ceil(g.measureText(text).width) + 2;
  const h = 13;
  scratch.width = Math.max(1, w);
  scratch.height = h;
  g.font = `${bold ? "bold " : ""}10px Minecraft`;
  g.textBaseline = "alphabetic";
  g.fillStyle = "#fff";
  g.clearRect(0, 0, w, h);
  g.fillText(text, 0, BASELINE);
  const data = g.getImageData(0, 0, Math.max(1, w), h).data;
  const mask = new Uint8Array(w * h);
  let right = 0;
  for (let i = 0; i < w * h; i++) {
    if ((data[i * 4 + 3] ?? 0) > 127) {
      mask[i] = 1;
      right = Math.max(right, i % w);
    }
  }
  const glyphs = { w: right + 1, h, mask: crop(mask, w, h, right + 1) };
  cache.set(key, glyphs);
  return glyphs;
}

function crop(mask: Uint8Array, w: number, h: number, nw: number): Uint8Array {
  const out = new Uint8Array(nw * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < nw; x++) out[y * nw + x] = mask[y * w + x] ?? 0;
  return out;
}

export interface TextStyle {
  bold?: boolean;
  /** The mod's outline: the text in a dark tint of its colour in eight directions. */
  outline?: boolean;
  /** Minecraft's drop shadow. */
  shadow?: boolean;
  /** The experience level's hard edge: the text in the level's dark green, a pixel above, below and to each side. */
  edge?: boolean;
  alpha?: number;
}

/** Ink width of `text` (no outline). */
export function textWidth(text: string, bold = false): number {
  return rasterise(text, bold).w;
}

/** Draws `text` with its cap tops on row `y`. Returns the ink width. */
export function drawText(c: Canvas, text: string, x: number, y: number, colour: Rgb, style: TextStyle = {}): number {
  const g = rasterise(text, style.bold ?? false);
  const a = style.alpha ?? 1;
  const oy = y - CAP_TOP;
  const each = (fn: (px: number, py: number) => void): void => {
    for (let yy = 0; yy < g.h; yy++) for (let xx = 0; xx < g.w; xx++) if (g.mask[yy * g.w + xx]) fn(x + xx, oy + yy);
  };
  if (style.edge) {
    each((px, py) => {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        c.px(px + dx, py + dy, UI.levelEdge, a);
    });
  } else if (style.outline) {
    const dark = mix(colour, UI.ink, 0.82);
    each((px, py) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) c.px(px + dx, py + dy, dark, a);
    });
  } else if (style.shadow) {
    const sh = mix(colour, [0, 0, 0], 0.75);
    each((px, py) => c.px(px + 1, py + 1, sh, a));
  }
  each((px, py) => c.px(px, py, colour, a));
  return g.w;
}

/** Words wrapped to `width`. */
export function wrap(text: string, width: number, bold = false): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, bold) > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Icons. The Leaf is the mod's own glyph (assets/seq/textures/leaf/leaf_glyph.png), pixel for
// pixel; the tools are drawn for the glade.

const LEAF_ROWS = [
  ".....kkkk",
  "...kkkadk",
  "..kkaabdk",
  ".kkacbdkk",
  ".kacbcdk.",
  ".kabcdkk.",
  "kkbddkk..",
  "kskkkk...",
  "kkk......",
];
const LEAF_LEGEND: Record<string, Rgb> = {
  k: hex("#1b2c16"),
  a: hex("#9cd468"),
  b: hex("#bae884"),
  c: hex("#68a640"),
  d: hex("#407828"),
  s: hex("#6e4e2c"),
};

const TOOL_LEGEND: Record<string, Rgb> = {
  k: hex("#1a1418"),
  C: hex("#e8955a"),
  c: hex("#b8693a"),
  D: hex("#7a3e22"),
  B: hex("#f2d27a"),
  b: hex("#d9a441"),
  n: hex("#8a6420"),
  S: hex("#e4e8f0"),
  s: hex("#9aa0b4"),
  t: hex("#5d6176"),
  R: hex("#c8604a"),
  r: hex("#8a3a2a"),
  W: hex("#f4fdff"),
  G: hex("#c9ecfa"),
  g: hex("#7fbde6"),
  w: hex("#3d6ea6"),
  v: hex("#2a4a7a"),
  L: hex("#9cd468"),
  l: hex("#407828"),
};

/** A copper watering can with a brass rose, spout up and to the right. */
const WATERING_CAN = [
  "................",
  "............kk..",
  "...........kBBk.",
  "..kkkkk...kBbbk.",
  ".kbBBBbk.kbbnk..",
  ".kbk..kbkkbnk...",
  ".kbk..kbkbnk....",
  "kkkkkkkkkbnk....",
  "kCCCCCCCcknk....",
  "kCcccccccck.....",
  "kCcccccccDk.....",
  "kCccccccDDk.....",
  "kccccccDDDk.....",
  "kDDDDDDDDDk.....",
  ".kkkkkkkkk......",
  "................",
];

/** The can tipped forward, pouring: the spout reaches down and left, the rose at its end. */
const WATERING_POUR = [
  "................",
  "......kkkkkk....",
  ".....kbBBBBbk...",
  ".....kbk...kbk..",
  "...kkkkkkkkkkbk.",
  "..kCCCCCCCCcckbk",
  "..kCcccccccccDkk",
  "..kCcccccccccDk.",
  "..kCccccccccDDk.",
  ".kkcccccccccDDk.",
  "kbnkcccccccDDDk.",
  "kbbnkkcccDDDDDk.",
  "knbbnkkkkkkkkk..",
  ".kbBbk..........",
  "..kBk...........",
  "................",
];

/** Bonsai shears: long blades, big round loop handles. */
const SHEARS = [
  "..............k.",
  ".............kSk",
  "............kSsk",
  "...........kSsk.",
  "..........kSsk..",
  ".........kSskk..",
  "........kSsktSk.",
  ".......kSsktsk..",
  "......kkbkssk...",
  ".....krkBkkk....",
  "....kRrk.kk.....",
  "...kRk.kRrk.....",
  "..kRk..kRk......",
  "..kRk.kRk.......",
  "..krRRrk........",
  "...kkkk.........",
];

/** A glass plant mister with a brass pump. */
const MISTER = [
  "................",
  ".....kkkk.......",
  ".kkkkbBBbk......",
  "kWkbbBbbnk......",
  ".kkkkbbnk.......",
  "......kbk.......",
  ".....kkkkk......",
  "....kGGGGgk.....",
  "...kGWgggggk....",
  "...kGggwwwgk....",
  "...kgwwwwwwk....",
  "...kgwwwwwvk....",
  "...kgwwwwvvk....",
  "....kgwwvvk.....",
  ".....kkkkk......",
  "................",
];

export const TOOL_ICONS: Record<Tool, readonly string[]> = { water: WATERING_CAN, shears: SHEARS, mist: MISTER };
export const TOOLS: readonly Tool[] = ["water", "shears", "mist"];

export function drawToolIcon(c: Canvas, tool: Tool, x: number, y: number, a = 1): void {
  c.icon(TOOL_ICONS[tool], TOOL_LEGEND, x, y, a);
}

/** The watering can mid-pour. Its rose is at (2, 14). */
export function drawPouringCan(c: Canvas, x: number, y: number, a = 1): void {
  c.icon(WATERING_POUR, TOOL_LEGEND, x, y, a);
}

// ---------------------------------------------------------------------------------------------

export interface HudModel {
  leaf: number;
  bloom: number;
  bloomMax: number;
  level: number;
  /** Progress through the level, 0 to 1. */
  xp: number;
  /** The tree's stage, shown by the level badge. */
  stage: string;
  charges: number;
  tool: Tool | null;
  /** A pulse when Bloom fills or a charge is spent, 0 to 1. */
  bloomFlash: number;
  chargeFlash: number;
  /** Colours for palette sprites drawn in the HUD (the Bloom cone). */
  rgb: (index: number) => Rgb;
}

export interface HudLayout {
  slots: { tool: Tool; x: number; y: number; w: number; h: number }[];
  /** The hotbar's panel, Bloom bar and slots together. */
  bar: { x: number; y: number; w: number; h: number };
  /** The level badge's top left, and the right edge of the top-left cluster. */
  badge: Point;
  topLeftRight: number;
  /** The Leaf balance's panel. */
  leaf: { x: number; y: number; w: number; h: number };
}

interface Point {
  x: number;
  y: number;
}

const SLOT = 20;
const BADGE = 23;
const BLOOM_ROW = 9;

export function hudLayout(W: number, H: number, leafText = "12,480"): HudLayout {
  const narrow = W < 160;
  const barW = TOOLS.length * SLOT + (TOOLS.length - 1) * 2 + 4;
  const x0 = Math.floor((W - barW) / 2);
  const slotY = H - SLOT - 4;
  const panelY = slotY - 2 - BLOOM_ROW;
  const tw = textWidth(leafText);
  const lw = tw + 2 + 2 + 9 + 6;
  const xpW = narrow ? 0 : Math.min(72, Math.round(W * 0.18));
  return {
    slots: TOOLS.map((tool, i) => ({ tool, x: x0 + 2 + i * (SLOT + 2), y: slotY, w: SLOT, h: SLOT })),
    bar: { x: x0, y: panelY, w: barW, h: H - 2 - panelY },
    badge: { x: 3, y: 3 },
    topLeftRight: 3 + BADGE + (narrow ? 0 : 4 + xpW),
    leaf: { x: W - lw - 3, y: 4, w: lw, h: 15 },
  };
}

/** The hotbar's slots, for hit testing. */
export const hotbarSlots = (W: number, H: number): HudLayout["slots"] => hudLayout(W, H).slots;

/**
 * The level badge, after the mod's level medal: an octagon of green rim round a dark disc, the
 * level lettered in its middle the way Minecraft letters yours. `glow` (0 to 1) lifts the rim.
 */
export function drawLevelBadge(c: Canvas, level: number, x: number, y: number, fonts: boolean, glow = 0): void {
  const r = (BADGE - 1) / 2;
  const cx = x + r;
  const cy = y + r;
  for (let yy = 0; yy < BADGE; yy++) {
    for (let xx = 0; xx < BADGE; xx++) {
      const dx = xx - r;
      const dy = yy - r;
      const d = Math.max(Math.abs(dx), Math.abs(dy), (Math.abs(dx) + Math.abs(dy)) / Math.SQRT2);
      if (d > r + 0.4) continue;
      const lit = -(dx + dy) / (Math.abs(dx) + Math.abs(dy) + 0.01);
      let col: Rgb;
      if (d > r - 0.6) col = UI.levelEdge;
      else if (d > r - 3.6) {
        const k = lit > 0.35 ? 0 : lit > -0.35 ? 1 : 2;
        col = [RIM_LIGHT, RIM_MID, RIM_DARK][k] ?? RIM_MID;
        if (d > r - 1.6 && lit > 0.5) col = UI.levelGreen;
        if (glow > 0) col = mix(col, [255, 255, 230], glow * 0.5);
      } else if (d > r - 4.6) col = UI.levelEdge;
      else col = lit > 0.55 && d > r - 6.2 ? [42, 36, 38] : [26, 22, 24];
      c.px(x + xx, y + yy, col);
    }
  }
  if (!fonts) return;
  const text = String(level);
  const w = textWidth(text);
  drawText(c, text, Math.round(cx - w / 2 + 0.5), Math.round(cy - 3), UI.levelGreen, { edge: true });
}

const RIM_LIGHT: Rgb = [168, 226, 112];
const RIM_MID: Rgb = [104, 184, 72];
const RIM_DARK: Rgb = [56, 124, 44];
const XP_GREEN: Rgb = [118, 206, 104];

export function drawHud(c: Canvas, m: HudModel, fonts: boolean): void {
  const { W, H } = c;
  const amount = m.leaf.toLocaleString("en-US");
  const lay = hudLayout(W, H, amount);
  const narrow = W < 160;

  // Top left: the level badge, the tree's stage and the level's segmented XP bar.
  drawLevelBadge(c, m.level, lay.badge.x, lay.badge.y, fonts);
  const bx = lay.badge.x + BADGE + 4;
  if (narrow) {
    // A phone: the XP bar runs along under the badge row, the stage's name beside the badge.
    const xpY = lay.badge.y + BADGE + 2;
    c.bar(lay.badge.x, xpY, W - 6, 5, m.xp, XP_GREEN, 10);
  } else {
    if (fonts) drawText(c, m.stage, bx, lay.badge.y + 3, UI.textSecondary, { shadow: true });
    c.bar(bx, lay.badge.y + 14, lay.topLeftRight - bx, 5, m.xp, XP_GREEN, 10);
  }

  // Top right: the Leaf balance in a small Leaf-green panel.
  if (fonts) {
    const L = lay.leaf;
    c.panel(L.x, L.y, L.w, L.h, mix(UI.leaf, UI.popup, 0.25), 0.82, UI.body);
    drawText(c, amount, L.x + 4, L.y + 4, UI.leaf, { outline: true });
    c.icon(LEAF_ROWS, LEAF_LEGEND, L.x + 4 + textWidth(amount) + 3, L.y + 3);
  }

  // Bottom: one slate panel, Bloom along its top and the hotbar's sunken slots under it.
  const P = lay.bar;
  c.panel(P.x, P.y, P.w, P.h, mix(UI.purple, UI.popup, 0.45), 0.86, UI.body);
  const flash = m.bloomFlash > 0 ? mix(UI.gold, [255, 255, 255], m.bloomFlash * 0.6) : UI.gold;
  c.indexed(BLOOM_CONE, P.x + 3, P.y + 2, m.rgb);
  c.bar(P.x + 11, P.y + 3, P.w - 14, 5, m.bloom / m.bloomMax, flash, m.bloomMax);
  for (const s of lay.slots) {
    c.rect(s.x + 1, s.y + 1, s.w - 2, s.h - 2, [14, 14, 22], 0.9);
    c.rect(s.x + 1, s.y + 1, s.w - 2, 1, [6, 6, 10], 0.9);
    c.rect(s.x + 1, s.y + 1, 1, s.h - 2, [6, 6, 10], 0.9);
    c.rect(s.x + 1, s.y + s.h - 2, s.w - 2, 1, [70, 70, 92], 0.8);
    c.rect(s.x + s.w - 2, s.y + 1, 1, s.h - 2, [70, 70, 92], 0.8);
    drawToolIcon(c, s.tool, s.x + 2, s.y + 2, m.charges > 0 ? 1 : 0.55);
    if (fonts) {
      const n = String(m.charges);
      const tw = textWidth(n);
      drawText(c, n, s.x + s.w - 1 - tw, s.y + s.h - 8, m.chargeFlash > 0 && m.charges === 0 ? UI.danger : UI.text, {
        shadow: true,
      });
    }
  }
  const sel = lay.slots.find((s) => s.tool === m.tool);
  if (sel) {
    c.border(sel.x - 2, sel.y - 2, sel.w + 4, sel.h + 4, UI.purpleHover);
    c.border(sel.x - 1, sel.y - 1, sel.w + 2, sel.h + 2, mix(UI.purpleHover, [255, 255, 255], 0.5), 0.55);
  }
}

/** A small cone for the Bloom bar: a full Bloom gives a free one. Drawn in palette indices. */
const BLOOM_CONE = fromRows(["..k..", ".khk.", "khnhk", "knhnk", "khnhk", ".knk.", "..s.."], {
  k: ix(R.CONE, 0),
  h: ix(R.CONE, 6),
  n: ix(R.CONE, 3),
  s: ix(R.WOOD, 3),
});

// ---------------------------------------------------------------------------------------------
// Popups, in the mod's milestone style: a slate panel with a coloured border, a medallion at the
// left, a small coloured label, a white title and lines under it, and a pair of sparkle crosses.

export interface PopupSpec {
  accent: Rgb;
  label: string;
  title: string;
  lines: { text: string; colour: Rgb }[];
  /** Draws the medallion into the 23 by 23 square at (x, y). */
  medal: (c: Canvas, x: number, y: number) => void;
}

export interface PopupSize {
  w: number;
  h: number;
  title: string[];
  lines: { text: string; colour: Rgb }[];
}

/** The popup's size for `spec`, its title and lines wrapped to at most `maxW`. */
export function popupSize(spec: PopupSpec, maxW: number): PopupSize {
  const textX = 6 + BADGE + 6;
  const room = maxW - textX - 16;
  const title = wrap(spec.title, room, true);
  const lines = spec.lines.flatMap((l) => wrap(l.text, room).map((text) => ({ text, colour: l.colour })));
  const widest = Math.max(
    textWidth(spec.label),
    ...title.map((l) => textWidth(l, true)),
    ...lines.map((l) => textWidth(l.text)),
  );
  const w = Math.min(maxW, textX + widest + 18);
  const h = Math.max(BADGE + 10, 16 + title.length * 11 + lines.length * 10 + 4);
  return { w, h, title, lines };
}

/**
 * Draws a popup at (x, y). `open` (0 to 1) runs Minecraft-quick in three steps, a line, half,
 * whole; `t` twinkles the sparkles.
 */
export function drawPopup(
  c: Canvas,
  spec: PopupSpec,
  x: number,
  y: number,
  maxW: number,
  open: number,
  t: number,
): PopupSize {
  const size = popupSize(spec, maxW);
  const step = open < 0.34 ? 0.1 : open < 0.67 ? 0.5 : 1;
  const h = Math.max(3, Math.round(size.h * step));
  const yy = y + Math.round((size.h - h) / 2);
  c.panel(x, yy, size.w, h, spec.accent, 0.95, [30, 30, 44]);
  if (h < size.h) return size;
  spec.medal(c, x + 6, y + Math.round((size.h - BADGE) / 2));
  const tx = x + 6 + BADGE + 6;
  drawText(c, spec.label, tx, y + 5, spec.accent, { shadow: true });
  size.title.forEach((l, i) => drawText(c, l, tx, y + 16 + i * 11, UI.text, { bold: true, shadow: true }));
  const body = y + 17 + size.title.length * 11;
  size.lines.forEach((l, i) => drawText(c, l.text, tx, body + i * 10, l.colour, { shadow: true }));
  // Two sparkle crosses at the right, twinkling in turn.
  for (const [i, sx, sy] of [
    [0, size.w - 8, 6],
    [1, size.w - 8, size.h - 8],
  ] as const) {
    const b = 0.5 + 0.5 * Math.sin(t * 3.1 + i * 2.2);
    if (b < 0.3) continue;
    const arm = b > 0.75 ? 2 : 1;
    for (let k = -arm; k <= arm; k++) {
      c.px(x + sx + k, y + sy, UI.text, 0.9);
      c.px(x + sx, y + sy + k, UI.text, 0.9);
    }
  }
  return size;
}

/** The daily greeting: a small toast that drops in from the top, stays a while and goes. */
export function drawToast(c: Canvas, text: string, y: number, maxW: number, tau: number): void {
  const life = 7;
  if (tau < 0 || tau > life) return;
  const lines = wrap(text, maxW - 16);
  const w = Math.min(maxW, Math.max(...lines.map((l) => textWidth(l))) + 16);
  const h = lines.length * 10 + 8;
  const x = Math.floor((c.W - w) / 2);
  // In and out in pixel steps, as the mod's toasts slide.
  const drop =
    tau < 0.3
      ? Math.round((1 - tau / 0.3) * (h + y))
      : tau > life - 0.3
        ? Math.round(((tau - (life - 0.3)) / 0.3) * (h + y))
        : 0;
  const top = y - drop;
  c.panel(x, top, w, h, mix(UI.purple, UI.gold, 0.25), 0.9, [30, 26, 40]);
  c.icon(SUN, SUN_LEGEND, x + 4, top + 4);
  lines.forEach((l, i) => drawText(c, l, x + 12, top + 5 + i * 10, UI.textSecondary, { shadow: true }));
}

/** The guild banner's orange sun, small: the greeting's mark. */
const SUN = ["..o..", ".oOo.", "oOyOo", ".oOo.", "..o.."];
const SUN_LEGEND: Record<string, Rgb> = { o: hex("#e07a2a"), O: hex("#e2b54c"), y: hex("#fff1c0") };

/** A little Leaf glyph for other panels. */
export function drawLeafGlyph(c: Canvas, x: number, y: number): void {
  c.icon(LEAF_ROWS, LEAF_LEGEND, x, y);
}
