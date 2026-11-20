/**
 * The ten-cone opening. Ten leaves let go of your tree one after another and flutter down; halfway
 * down each one turns its rank's colour (so you see the rare one coming), lands, and flips over
 * into a small card in a row in front of the tree. When all ten are down, a summary grid opens and
 * the cards fly up into it one after another; the rarest is lifted and lit, and the grid says
 * what came.
 *
 * Drawn in the HUD's grid, so the cards stay one size at every level; the leaves start from the
 * crown's place in that grid.
 */

import type { CastFrame } from "../../bundle/cast.ts";
import { leaf, sparkleStage } from "../../bundle/vocabulary.ts";
import { hash3, hashString, Rng } from "../../engine/rng.ts";
import { type RankName, RANKS } from "../../game/rules.ts";
import { type Canvas, drawText, hex, mix, type Rgb, textWidth, UI } from "../../ui/hud.ts";
import { crown, type Fx, leafKeys, type Point } from "../glade/stage.ts";
import { INSIGNIA } from "./card.ts";
import { rankColour, tier } from "./cone.ts";

export interface Cone10Event {
  t0: number;
  ranks: RankName[];
  /** The spirit in each cone, by cast id. */
  spirits: string[];
  /** Which of the ten is the rarest. */
  best: number;
}

const FIRST = 0.5;
const GAP = 0.24;
const FALL = 1.5;
const FLIP = 0.22;
const FLY = 0.38;
const END = 18;

/** Ten opened cones, the rarest marked. */
export function cone10Of(t0: number, pulls: readonly { rank: RankName; spirit: string }[]): Cone10Event {
  const ranks = pulls.map((p) => p.rank);
  let best = 0;
  ranks.forEach((r, i) => {
    if (tier(r) > tier(ranks[best] ?? "Leafkin")) best = i;
  });
  return { t0, ranks, spirits: pulls.map((p) => p.spirit), best };
}

/** Ten cones for a still: mostly common, with `best` among them, in an order the seed picks. */
export function makeCone10(
  t0: number,
  best: RankName,
  seed: string,
  spiritOf: (rank: RankName) => string,
): Cone10Event {
  const rng = new Rng(hashString(`${seed}:ten`));
  const common: RankName[] = [
    "Leafkin",
    "Sapling",
    "Leafkin",
    "Sprite",
    "Leafkin",
    "Sapling",
    "Leafkin",
    "Sapling",
    "Leafkin",
  ];
  const at = rng.int(4, 8);
  const ranks = [...common.slice(0, at), best, ...common.slice(at)];
  return { t0, ranks, spirits: ranks.map(spiritOf), best: at };
}

const releaseAt = (i: number): number => FIRST + i * GAP;
const landAt = (i: number): number => releaseAt(i) + FALL;
/** The grid opens once the last card has flipped; the cards then fly up a beat apart. */
const GRID = landAt(9) + FLIP + 0.25;
const flyAt = (i: number): number => GRID + 0.2 + i * 0.06;
const allIn = (): number => flyAt(9) + FLY;

export const cone10Done = (ev: Cone10Event, t: number): boolean => t - ev.t0 > END;

/** The world side: the crown rustles where each leaf lets go, a leaf and a sparkle. */
export function drawCone10World(fx: Fx, ev: Cone10Event, t: number): void {
  const tau = t - ev.t0;
  const c = crown(fx.tree);
  const box = { x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.h };
  const [light, dark] = leafKeys(fx.tree, fx.season);
  ev.ranks.forEach((_, i) => {
    const u = (tau - releaseAt(i)) / 0.4;
    if (u < 0 || u > 1) return;
    const p = startPoint(i, box);
    fx.pic.sparkle(p.x, p.y, sparkleStage(u, false), fx.ink.c("star"), fx.ink.c("star_arm"));
    for (let k = 0; k < 2; k++) {
      const a = k * 2.6 + i;
      leaf(
        fx,
        Math.round(p.x + Math.cos(a) * (2 + u * 4)),
        Math.round(p.y + Math.sin(a) + u * 5),
        k + Math.floor(u * 4),
        fx.ink.c(light),
        fx.ink.c(dark),
      );
    }
  });
}

/** Where leaf `i` lets go: spread across the crown's lower half, in a world box or a HUD box. */
function startPoint(i: number, box: { x0: number; y0: number; x1: number; y1: number }): Point {
  const u = (i + 0.5 + (hash3(i, 1, 5) - 0.5) * 0.6) / 10;
  return {
    x: Math.round(box.x0 + (box.x1 - box.x0) * (0.12 + 0.76 * u)),
    y: Math.round(box.y0 + (box.y1 - box.y0) * (0.35 + 0.35 * hash3(i, 2, 5))),
  };
}

/** A sequoia sprig as it falls: a short stem of scale leaves. Its colours are set as it turns. */
const SPRIG = ["...a...", "..aba..", ".abcba.", "..bcb..", "abcbcba", "..bcb..", ".abcba.", "...c...", "...s..."];
const SPRIG_SIDE = ["...a", "..ab", ".abc", "..bc", "abcb", "..bc", ".abc", "...c", "...s"];

interface Grid {
  x: number;
  y: number;
  w: number;
  h: number;
  cw: number;
  ch: number;
  gap: number;
  cols: number;
  /** The panel's title, and how far in from the panel's side the cards start. */
  title: string;
  inset: number;
}

const TITLE = "Ten cones, opened by fire";

/** The summary panel: as wide as its cards and its title, which shortens on a screen too narrow for it. */
function gridOf(c: Canvas): Grid {
  const narrow = c.W < 180;
  const cols = 5;
  const cw = narrow ? 17 : 26;
  const ch = narrow ? 24 : 32;
  const gap = narrow ? 2 : 4;
  const cards = cols * cw + (cols - 1) * gap;
  const title = textWidth(TITLE) + 12 <= c.W - 8 ? TITLE : "Ten cones";
  const w = Math.max(cards + 12, textWidth(title) + 12);
  const h = 2 * ch + gap + 12 + 14 + 12;
  const inset = Math.floor((w - cards) / 2);
  return {
    x: Math.floor((c.W - w) / 2),
    y: Math.max(26, Math.floor(c.H * 0.22)),
    w,
    h,
    cw,
    ch,
    gap,
    cols,
    title,
    inset,
  };
}

function slot(g: Grid, i: number): Point {
  return {
    x: g.x + g.inset + (i % g.cols) * (g.cw + g.gap),
    y: g.y + 6 + 14 + Math.floor(i / g.cols) * (g.ch + g.gap),
  };
}

/** Where card `i` lands in the row in front of the tree: one row of ten, or two of five on a phone. */
function rowSlot(c: Canvas, g: Grid, i: number): Point {
  const perRow = c.W < 200 ? 5 : 10;
  const rowW = perRow * g.cw + (perRow - 1) * g.gap;
  const x0 = Math.floor((c.W - rowW) / 2);
  const y0 = Math.round(c.H * 0.58);
  return { x: x0 + (i % perRow) * (g.cw + g.gap), y: y0 + Math.floor(i / perRow) * (g.ch + g.gap) };
}

/** The spirit to show on each rank's card, from the bundle's cast sheets. */
export interface CardArt {
  /** A spirit's portrait from the bundle's cast sheets, or null while it loads. */
  spriteFor: (spirit: string) => CastFrame | null;
}

export function drawCone10(c: Canvas, ev: Cone10Event, t: number, crownTL: Point, crownBR: Point, art: CardArt): void {
  const tau = t - ev.t0;
  if (tau > END) return;
  // Ask for every card's portrait from the start, so none pops in as its card flips.
  if (tau < GRID) for (const id of ev.spirits) art.spriteFor(id);
  const g = gridOf(c);
  const box = { x0: crownTL.x, y0: crownTL.y, x1: crownBR.x, y1: crownBR.y };
  // The summary grid's panel opens once every card is down, and the world behind it dims.
  const open = (tau - GRID) / 0.15;
  if (open > 0) {
    c.rect(0, 0, c.W, c.H, [10, 6, 16], Math.min(0.45, open * 0.15));
    const step = open < 0.34 ? 0.1 : open < 0.67 ? 0.5 : 1;
    const h = Math.max(3, Math.round(g.h * step));
    c.panel(g.x, g.y + Math.round((g.h - h) / 2), g.w, h, UI.purple, 0.95, [24, 18, 36]);
    if (h >= g.h) {
      drawText(c, g.title, g.x + Math.floor((g.w - textWidth(g.title)) / 2), g.y + 5, UI.gold, { shadow: true });
      for (let i = 0; i < 10; i++) {
        const s = slot(g, i);
        c.rect(s.x, s.y, g.cw, g.ch, [14, 12, 22], 0.8);
        c.border(s.x, s.y, g.cw, g.ch, [44, 38, 58]);
      }
    }
  }
  const done = tau > allIn();
  ev.ranks.forEach((rank, i) => {
    const colour = hex(rankColour(rank));
    const rare = tier(rank);
    const u = (tau - releaseAt(i)) / FALL;
    if (u < 0) return;
    const start = startPoint(i, box);
    const row = rowSlot(c, g, i);
    const landX = row.x + Math.floor(g.cw / 2) - 2;
    const landY = row.y + Math.floor(g.ch / 2) - 3;
    if (u < 1) {
      // Falling: a lazy swing side to side, turning its rank's colour halfway down.
      const e = u * u * (3 - 2 * u);
      const x = Math.round(start.x + (landX - start.x) * e + Math.sin(u * 7 + i) * 6 * (1 - u * 0.6));
      const y = Math.round(start.y + (landY - start.y) * u);
      const turn = Math.max(0, Math.min(1, (u - 0.45) / 0.12));
      const side = Math.floor(u * 9 + i) % 3 === 1;
      drawSprig(c, x, y, colour, turn, side);
      if (turn > 0 && turn < 1) sparkle(c, x + 2, y + 3, mix(colour, [255, 255, 255], 0.5), 2);
      // The rare ones leave a trail of their light.
      if (turn >= 1 && rare >= 3) {
        for (let k = 1; k <= rare - 1; k++)
          c.px(x + 2 - Math.round(Math.sin((u - k * 0.02) * 7 + i) * 2), y - k * 2, colour, 0.7 - k * 0.08);
      }
      return;
    }
    const v = (tau - landAt(i)) / FLIP;
    if (v < 1) {
      // The flip: a sprig, squashed to a line, opening as the card.
      const w = Math.max(1, Math.round(g.cw * Math.abs(v * 2 - 1)));
      if (v < 0.5) drawSprig(c, landX, landY, colour, 1, false, w / g.cw);
      else
        drawCard(
          c,
          row.x + Math.round((g.cw - w) / 2),
          row.y,
          w,
          g.ch,
          rank,
          ev.spirits[i] ?? "glorp",
          colour,
          false,
          t,
          art,
        );
      return;
    }
    const f = Math.max(0, Math.min(1, (tau - flyAt(i)) / FLY));
    const e = 1 - Math.pow(1 - f, 3);
    const target = slot(g, i);
    const x = Math.round(row.x + (target.x - row.x) * e);
    const y = Math.round(row.y + (target.y - row.y) * e - Math.sin(f * Math.PI) * 8);
    const best = done && i === ev.best;
    drawCard(c, x, y - (best ? 2 : 0), g.cw, g.ch, rank, ev.spirits[i] ?? "glorp", colour, best, t, art);
  });
  if (done && open >= 1) {
    // What came: the best pull's name under the grid.
    const best = ev.ranks[ev.best] ?? "Leafkin";
    const colour = hex(rankColour(best));
    const line = `Best pull: ${best}`;
    drawText(c, line, g.x + Math.floor((g.w - textWidth(line)) / 2), g.y + g.h - 12, colour, { shadow: true });
  }
}

function drawSprig(c: Canvas, x: number, y: number, colour: Rgb, turn: number, side: boolean, squash = 1): void {
  const green: Record<string, Rgb> = { a: hex("#4a532a"), b: hex("#6e7a34"), c: hex("#a99a48"), s: hex("#6e4e2c") };
  const legend: Record<string, Rgb> = {
    a: mix(green.a ?? UI.ink, mix(colour, UI.ink, 0.45), turn),
    b: mix(green.b ?? UI.ink, colour, turn),
    c: mix(green.c ?? UI.ink, mix(colour, [255, 255, 255], 0.45), turn),
    s: green.s ?? UI.ink,
  };
  const rows = side ? SPRIG_SIDE : SPRIG;
  if (squash < 1) {
    // Edge-on: a single column.
    rows.forEach((row, yy) => {
      const ch = row[3];
      const col = ch ? legend[ch] : undefined;
      if (col) c.px(x + 3, y + yy, col);
    });
    return;
  }
  c.icon(rows, legend, x, y);
}

function sparkle(c: Canvas, x: number, y: number, col: Rgb, arm: number): void {
  for (let k = -arm; k <= arm; k++) {
    c.px(x + k, y, col, 0.9);
    c.px(x, y + k, col, 0.9);
  }
}

/** A small card: the rank's colour round a dark face, the spirit in its glow, and a pip per rank step. */
function drawCard(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  rank: RankName,
  spirit: string,
  colour: Rgb,
  best: boolean,
  t: number,
  art: CardArt,
): void {
  if (w < 3) {
    c.rect(x, y, Math.max(1, w), h, colour);
    return;
  }
  const rare = tier(rank);
  if (best) {
    // Lifted and lit: a halo a pixel out, breathing, and sparkles at two corners.
    const b = 0.6 + 0.4 * Math.sin(t * 4);
    c.border(x - 2, y - 2, w + 4, h + 4, colour, 0.35 * b);
    c.border(x - 1, y - 1, w + 2, h + 2, mix(colour, [255, 255, 255], 0.4), 0.8 * b);
    sparkle(c, x - 2, y - 2, [255, 255, 255], Math.sin(t * 5) > 0 ? 2 : 1);
    sparkle(c, x + w + 1, y + h + 1, [255, 255, 255], Math.sin(t * 5 + 2) > 0 ? 2 : 1);
  }
  c.rect(x + 1, y + 1, w - 2, h - 2, mix(colour, [16, 12, 24], 0.82));
  c.border(x, y, w, h, colour);
  c.rect(x + 1, y + 1, w - 2, 1, mix(colour, [255, 255, 255], 0.3), 0.6);
  if (w < h * 0.5) return;
  // The spirit's light: a soft disc in its colour, and the insignia in the middle.
  const cx = x + Math.floor(w / 2);
  const cy = y + Math.floor(h * 0.42);
  const r = Math.min(w, h) * 0.32;
  for (let yy = -Math.ceil(r); yy <= r; yy++) {
    for (let xx = -Math.ceil(r); xx <= r; xx++) {
      const d = Math.hypot(xx, yy) / r;
      if (d > 1) continue;
      c.px(cx + xx, cy + yy, colour, d > 0.75 ? 0.14 : d > 0.45 ? 0.24 : 0.36);
    }
  }
  // The spirit itself when the card is wide enough, standing on the card's floor; otherwise its
  // rank's insignia.
  const sp = art.spriteFor(spirit);
  if (sp && w >= sp.w + 2 && h >= sp.h + 9) c.frame(sp, cx - Math.floor(sp.w / 2), y + h - 8 - sp.h);
  else c.icon(INSIGNIA, { x: mix(colour, UI.ink, 0.2), X: mix(colour, [255, 255, 255], 0.55) }, cx - 2, cy - 2);
  // Pips: one per rank step, Leafkin one to Yggdrasil seven.
  const pips = rare + 1;
  const pw = pips * 2 - 1;
  for (let k = 0; k < pips; k++)
    c.px(x + Math.floor((w - pw) / 2) + k * 2, y + h - 5, mix(colour, [255, 255, 255], 0.2));
}

export const RANK_COUNT = RANKS.length;
