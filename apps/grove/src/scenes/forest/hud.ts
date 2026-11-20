/**
 * The forest's HUD, in the Sequoia mod's language (`../../ui/hud.ts` holds the mod's `PixelArt`
 * rules: cut-corner slate panels, a lit inner top row, the Minecraft font): the header, the event
 * feed chip, "Find my tree", tooltips with a player head, a raid lantern's label, the GG card and
 * the debug strip.
 */

import { Canvas, drawText, mix, textWidth, UI, wrap } from "../../ui/hud.ts";

type Rgb = readonly [number, number, number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const inside = (r: Rect | null, x: number, y: number): boolean =>
  !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

const GOLD: Rgb = [242, 192, 68];
const TOOLTIP_BODY: Rgb = [22, 14, 32];

// ---------------------------------------------------------------------------------------------
// Icons, one character per pixel.

const ICON_LEGEND: Record<string, Rgb> = {
  k: [26, 20, 24],
  g: [226, 181, 76],
  G: [248, 214, 120],
  o: [224, 122, 42],
  s: [119, 131, 111],
  S: [154, 171, 146],
  t: [78, 170, 162],
  T: [73, 110, 102],
  w: [228, 232, 240],
  W: [150, 156, 176],
  r: [200, 96, 74],
  R: [238, 122, 68],
  b: [127, 189, 230],
  B: [61, 110, 166],
  y: [255, 214, 114],
  Y: [255, 246, 210],
  m: [90, 66, 50],
  p: [190, 160, 250],
  P: [120, 90, 190],
};

/** The guild's mark: a gold-crowned sequoia on a sage trunk over teal, after the SEQ logo. */
const SEQ_ICON = [
  "....G....",
  "...gGg...",
  "..gGgGg..",
  "...gGg...",
  "..gGgGg..",
  ".gGgGgGg.",
  "..ggSgg..",
  "....S....",
  ".ttTSTtt.",
];

/** The Minecraft font's space, which a measured string drops from its ends. */
const SPACE = 4;

const RAID_ICON = ["....kw", "...kwW", "k.kwWk", ".kwWk.", ".rkk..", "rRk.k.", "Rr...."];
const WAR_ICON = ["Pggg..", "PgoGg.", "Pggggg", "Pgg...", "P.....", "P.....", "P....."];
const LEVEL_ICON = ["..k..", ".kyk.", "kyYyk", "kyYyk", "kyYyk", ".kmk.", "..k.."];
const CRAB_ICON = ["R.....R", "rR...Rr", ".rRRRr.", "rRkRkRr", ".rRRRr.", "r.r.r.r"];
const FIND_ICON = ["..gGg..", ".gGgGg.", "gGgggGg", ".ggogg.", "...s...", "..kpk..", "..kpk..", "...k..."];
const DROP_ICON = ["..b..", ".bBb.", "bBwBb", "bBBBb", ".bBb."];
const PIN_ICON = [".ppp.", "pPPPp", "pPwPp", ".pPp.", "..p.."];

const LEGEND_P: Record<string, Rgb> = { ...ICON_LEGEND, P: [96, 60, 150], p: [190, 160, 250] };

export type FeedIcon = "raid" | "war" | "level" | "crab";
const FEED_ICONS: Record<FeedIcon, readonly string[]> = {
  raid: RAID_ICON,
  war: WAR_ICON.map((r) => r.replaceAll("P", "m")),
  level: LEVEL_ICON,
  crab: CRAB_ICON,
};

// ---------------------------------------------------------------------------------------------
// Bigger text: the Minecraft font with each font pixel two art pixels square, as the mod draws
// its big numerals. Drawn white into a scratch canvas, then copied up.

let scratch: { c: Canvas; buf: Uint32Array } | null = null;

export function drawBigText(c: Canvas, text: string, x: number, y: number, colour: Rgb, outline = true): number {
  const w = textWidth(text, true) + 2;
  const h = 12;
  if (!scratch || scratch.c.W < w) {
    const buf = new Uint32Array(Math.max(w, 160) * h);
    scratch = { c: new Canvas(buf, Math.max(w, 160), h), buf };
  }
  const { c: sc, buf } = scratch;
  buf.fill(0);
  drawText(sc, text, 0, 3, [255, 255, 255], { bold: true });
  const on = (sx: number, sy: number): boolean =>
    sx >= 0 && sy >= 0 && sx < sc.W && sy < h && (buf[sy * sc.W + sx] ?? 0) !== 0;
  const dark = mix(colour, UI.ink, 0.82);
  const lit = mix(colour, [255, 255, 255], 0.35);
  for (let sy = 0; sy < h; sy++)
    for (let sx = 0; sx < sc.W; sx++) {
      if (!on(sx, sy)) continue;
      const px = x + sx * 2;
      const py = y + (sy - 3) * 2;
      if (outline) c.rect(px - 1, py - 1, 4, 4, dark);
    }
  for (let sy = 0; sy < h; sy++)
    for (let sx = 0; sx < sc.W; sx++) {
      if (!on(sx, sy)) continue;
      const px = x + sx * 2;
      const py = y + (sy - 3) * 2;
      c.rect(px, py, 2, 2, colour);
      // The top row of each stroke catches the light.
      if (!on(sx, sy - 1)) c.rect(px, py, 2, 1, lit);
    }
  return w * 2;
}

// ---------------------------------------------------------------------------------------------

export interface TipLine {
  text: string;
  colour: Rgb;
}

export interface Tooltip {
  /** Screen point the tooltip belongs to. */
  ax: number;
  ay: number;
  head: Rgb[] | null;
  title: string;
  titleColour: Rgb;
  lines: TipLine[];
  /** A clickable last line, as "Water (1 care)". */
  action: { text: string; colour: Rgb; hot: boolean } | null;
}

export interface Card {
  title: string;
  sub: string;
  lore: string;
  a: number;
}

export interface Label {
  x: number;
  y: number;
  title: string;
  names: readonly string[];
  a: number;
}

export interface HudModel {
  trees: number;
  /** `short` and `detail` are the two lines a phone shows instead. */
  feed: { icon: FeedIcon; text: string; short: string; detail: string; ago: string; flash: number };
  findHot: boolean;
  findOn: boolean;
  tooltip: Tooltip | null;
  debug: { labels: readonly string[]; hot: number } | null;
  card: Card | null;
  label: Label | null;
  /** Where "your" tree is on screen, for the marker over it. */
  me: { x: number; y: number } | null;
  t: number;
}

export interface HudHits {
  find: Rect | null;
  action: Rect | null;
  debug: Rect[];
  /** The HUD's own panels: taps here are not taps on the forest. */
  panels: Rect[];
}

export function drawHud(c: Canvas, m: HudModel, fonts: boolean): HudHits {
  const hits: HudHits = { find: null, action: null, debug: [], panels: [] };
  const { W, H } = c;
  const narrow = W < 200;
  if (!fonts) return hits;

  // --- The header: the guild's mark, its name in Sequoia purple, and how many trees stand.
  const name = "Sequoia";
  const count = `${m.trees} trees`;
  const nw = textWidth(name);
  const cw = textWidth(count);
  const dot = SPACE + textWidth("·") + SPACE;
  const oneLine = 4 + 9 + 4 + nw + dot + cw + 5 <= W - 6;
  const hw = oneLine ? 4 + 9 + 4 + nw + dot + cw + 5 : 4 + 9 + 4 + Math.max(nw, cw) + 5;
  const hh = oneLine ? 15 : 25;
  const header = { x: 3, y: 3, w: hw, h: hh };
  c.panel(header.x, header.y, header.w, header.h, mix(UI.purple, UI.popup, 0.35), 0.92, UI.body);
  c.icon(SEQ_ICON, ICON_LEGEND, header.x + 4, header.y + 3);
  const tx = header.x + 4 + 9 + 4;
  drawText(c, name, tx, header.y + 4, UI.purple, { shadow: true });
  if (oneLine) {
    drawText(c, "·", tx + nw + SPACE, header.y + 4, UI.muted, { shadow: true });
    drawText(c, count, tx + nw + dot, header.y + 4, UI.text, { shadow: true });
  } else drawText(c, count, tx, header.y + 14, UI.text, { shadow: true });
  hits.panels.push(header);

  // --- The feed chip: the latest guild moment.
  const agoW = SPACE + textWidth("·") + SPACE + textWidth(m.feed.ago);
  const fw = 4 + 7 + 4 + textWidth(m.feed.text) + agoW + 5;
  const twoLine = narrow || fw > W - header.w - 12;
  const phoneLine2 = `${m.feed.detail} · ${m.feed.ago}`;
  const chipW = twoLine ? Math.min(W - 6, 4 + Math.max(textWidth(m.feed.short), textWidth(phoneLine2)) + 5) : fw;
  const chipH = twoLine && narrow ? 25 : 15;
  const chip = narrow
    ? { x: 3, y: header.y + header.h + 3, w: Math.min(W - 6, chipW), h: chipH }
    : { x: W - fw - 3, y: 3, w: fw, h: 15 };
  const accent = m.feed.flash > 0 ? mix(GOLD, [255, 255, 255], m.feed.flash * 0.5) : mix(GOLD, UI.popup, 0.4);
  c.panel(chip.x, chip.y, chip.w, chip.h, accent, 0.92, UI.body);
  if (narrow) {
    // A phone has no room for the icon: two lines of text, the moment and how long ago.
    drawText(c, fit(m.feed.short, chip.w - 8), chip.x + 4, chip.y + 4, UI.text, { shadow: true });
    drawText(c, fit(phoneLine2, chip.w - 8), chip.x + 4, chip.y + 14, UI.muted, { shadow: true });
  } else {
    c.icon(FEED_ICONS[m.feed.icon], LEGEND_P, chip.x + 4, chip.y + 4);
    const ax = chip.x + 15 + textWidth(m.feed.text);
    drawText(c, m.feed.text, chip.x + 15, chip.y + 4, UI.text, { shadow: true });
    drawText(c, "·", ax + SPACE, chip.y + 4, UI.muted, { shadow: true });
    drawText(c, m.feed.ago, ax + SPACE * 2 + textWidth("·"), chip.y + 4, UI.muted, { shadow: true });
  }
  hits.panels.push(chip);

  // --- Find my tree.
  const label = "Find my tree";
  const bw = 4 + 7 + 4 + textWidth(label) + 5;
  const bh = 16;
  // Bottom centre on a phone, where a thumb is; the corner on a wide screen, out of the view.
  const find = { x: narrow ? Math.floor((W - bw) / 2) : W - bw - 4, y: H - bh - 4, w: bw, h: bh };
  const acc = m.findHot ? UI.purpleHover : m.findOn ? mix(UI.purpleHover, [255, 255, 255], 0.2) : UI.purple;
  c.panel(find.x, find.y, find.w, find.h, acc, 0.94, m.findHot ? mix(UI.popup, UI.purpleDark, 0.5) : UI.popup);
  c.icon(FIND_ICON, ICON_LEGEND, find.x + 4, find.y + 4);
  drawText(c, label, find.x + 15, find.y + 5, m.findHot ? UI.text : UI.textSecondary, { shadow: true });
  hits.find = find;
  hits.panels.push(find);

  // --- The marker over your tree.
  if (m.me) {
    const bob = Math.round(Math.sin(m.t * 3) * 1.5);
    c.icon(PIN_ICON, LEGEND_P, m.me.x - 2, m.me.y - 8 + bob);
  }

  // --- The debug strip.
  if (m.debug) {
    let x = 3;
    const y = H - 17;
    m.debug.labels.forEach((text, i) => {
      const w = textWidth(text) + 8;
      if (x + w > find.x - 3 && !narrow) return;
      const r = { x, y: narrow ? find.y - 18 : y, w, h: 14 };
      c.panel(r.x, r.y, r.w, r.h, i === m.debug?.hot ? UI.purpleHover : mix(UI.purple, UI.popup, 0.5), 0.9, UI.body);
      drawText(c, text, r.x + 4, r.y + 4, UI.textSecondary, { shadow: true });
      hits.debug.push(r);
      hits.panels.push(r);
      x += w + 2;
    });
  }

  if (m.label) drawLabel(c, m.label);
  if (m.card) drawCard(c, m.card);
  if (m.tooltip) {
    // Below the header and the feed chip, never over them.
    const top = Math.max(header.y + header.h, chip.y + chip.h) + 3;
    const r = drawTooltip(c, m.tooltip, top);
    hits.action = r.action;
    hits.panels.push(r.panel);
  }
  return hits;
}

/** Trims text with an ellipsis to fit a width. */
function fit(text: string, width: number): string {
  if (textWidth(text) <= width) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}…`) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/**
 * A tooltip by its point, on the screen and below `top`: on a screen too narrow for its lines they
 * wrap, and its title and action shorten, so nothing runs past its frame.
 */
function drawTooltip(c: Canvas, tip: Tooltip, top: number): { panel: Rect; action: Rect | null } {
  const pad = 4;
  const headW = tip.head ? 10 : 0;
  const room = c.W - 4 - pad * 2 - 1;
  const title = fit(tip.title, room - headW);
  const lines = tip.lines.flatMap((l) => wrap(l.text, room).map((text) => ({ text, colour: l.colour })));
  const actText = tip.action ? fit(tip.action.text, room - 7) : "";
  const titleW = headW + textWidth(title);
  const lineW = Math.max(0, ...lines.map((l) => textWidth(l.text)));
  const actW = tip.action ? 7 + textWidth(actText) : 0;
  const w = Math.min(c.W - 4, Math.max(titleW, lineW, actW) + pad * 2 + 1);
  const h = pad + 10 + lines.length * 10 + (tip.action ? 12 : 0) + pad - 1;
  let x = Math.round(tip.ax + 8);
  let y = Math.round(tip.ay - h - 6);
  if (x + w > c.W - 2) x = Math.round(tip.ax - w - 8);
  x = Math.max(2, Math.min(c.W - w - 2, x));
  // Above its point if there is room under the panels, otherwise below it.
  if (y < top) y = Math.round(tip.ay + 8);
  y = Math.max(top, Math.min(c.H - h - 22, y));
  // Minecraft's tooltip: a near-black violet body inside a purple frame.
  c.panel(x, y, w, h, UI.purple, 0.95, TOOLTIP_BODY);
  c.border(x + 1, y + 1, w - 2, h - 2, UI.purpleDark, 0.9);
  let ty = y + pad + 1;
  let tx = x + pad;
  if (tip.head) {
    c.rect(tx - 1, ty - 1, 10, 10, [10, 8, 14]);
    tip.head.forEach((px, i) => c.px(tx + (i % 8), ty + Math.floor(i / 8), px));
    tx += 11;
  }
  drawText(c, title, tx, ty + 1, tip.titleColour, { shadow: true });
  ty += 11;
  for (const l of lines) {
    drawText(c, l.text, x + pad, ty, l.colour, { shadow: true });
    ty += 10;
  }
  let action: Rect | null = null;
  if (tip.action) {
    ty += 1;
    c.rect(x + pad, ty - 2, w - pad * 2, 1, UI.purpleDark, 0.9);
    const col = tip.action.hot ? mix(tip.action.colour, [255, 255, 255], 0.35) : tip.action.colour;
    c.icon(DROP_ICON, ICON_LEGEND, x + pad, ty + 1);
    drawText(c, actText, x + pad + 7, ty + 1, col, { shadow: true });
    action = { x: x + 1, y: ty - 2, w: w - 2, h: 12 };
  }
  return { panel: { x, y, w, h }, action };
}

function drawCard(c: Canvas, card: Card): void {
  const big = 2 * (textWidth(card.title, true) + 2);
  const w = Math.max(big, textWidth(card.sub), textWidth(card.lore)) + 16;
  const h = 50;
  const x = Math.floor((c.W - w) / 2);
  const y = Math.round(28 - (1 - card.a) * 8);
  const a = card.a;
  if (a <= 0) return;
  c.panel(x, y, w, h, GOLD, 0.95 * a, UI.body);
  c.border(x + 1, y + 1, w - 2, h - 2, mix(GOLD, UI.popup, 0.6), a);
  if (a < 0.6) return;
  drawBigText(c, card.title, Math.floor(x + (w - big) / 2) + 1, y + 6, GOLD);
  drawText(c, card.sub, Math.floor(x + (w - textWidth(card.sub)) / 2), y + 28, UI.text, { shadow: true });
  drawText(c, card.lore, Math.floor(x + (w - textWidth(card.lore)) / 2), y + 39, UI.lore, { shadow: true });
}

function drawLabel(c: Canvas, l: Label): void {
  if (l.a <= 0.05) return;
  const narrow = c.W < 200;
  const cols = narrow ? 1 : 2;
  const colW = Math.max(...l.names.map((n) => textWidth(n))) + 8;
  const w = Math.max(textWidth(l.title), colW * cols - 8) + 10;
  const rows = Math.ceil(l.names.length / cols);
  const h = 6 + 10 + rows * 10 + 3;
  const x = Math.max(2, Math.min(c.W - w - 2, Math.round(l.x - w / 2)));
  // Above its lantern, or below it when the lantern hangs too near the top.
  const above = l.y - h - 8 >= 22;
  const y = above ? Math.round(l.y - h - 8) : Math.round(l.y + 16);
  c.panel(x, y, w, h, GOLD, 0.94 * l.a, TOOLTIP_BODY);
  // A tick of string from the label to its lantern.
  const sx = Math.round(Math.max(x + 3, Math.min(x + w - 4, l.x)));
  if (above) for (let k = y + h; k < l.y - 2; k++) c.px(sx, k, GOLD, 0.6 * l.a);
  else for (let k = Math.round(l.y + 8); k < y; k++) c.px(sx, k, GOLD, 0.6 * l.a);
  if (l.a < 0.5) return;
  drawText(c, l.title, x + 5, y + 5, GOLD, { shadow: true });
  l.names.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    drawText(c, n, x + 5 + col * colW, y + 16 + row * 10, UI.text, { shadow: true });
  });
}
