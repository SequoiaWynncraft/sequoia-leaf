/**
 * Everything that is built in the yard, drawn once and kept: each machine as a small hand-built
 * thing in wood, stone and brass, in every pose its work puts it in. A machine stands on one tile,
 * sixteen pixels square, and may rise above it; its picture goes with its foot on the tile's foot.
 */

import { BARK, CREAM, GOLD, GREEN, INK, PAPER, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, ell, flipped, outlined, paint, R, rgb, shingles } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, hash, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { STUDS_AT } from "./belts.ts";
import { starClad } from "./grade4.ts";
import { type Hat, HATS } from "./hats.ts";
import { bm, CLAY, DARK, IRON, PAL, spr, type Sprite } from "./pal.ts";

type Canvas = HTMLCanvasElement;

/** A picture for a tile: sixteen wide, `h` tall, standing on the tile's foot. */
function tile(h: number, draw: (g: Ctx) => void, w = 16): Sprite {
  const { c, g } = makeCanvas(w, h);
  draw(g);
  return spr(c, w / 2, h);
}

// ---------- surfaces, as the town draws them ----------

function planks(g: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  for (let bx = x; bx < x + w; bx += 4) {
    const v = hash(bx, 7, seed);
    const bw = Math.min(3, x + w - bx);
    R(g, bx, y, bw, h, v > 0.55 ? BARK[3] : BARK[2]);
    if (bx + 3 < x + w) R(g, bx + 3, y, 1, h, BARK[1]);
  }
}

function stones(g: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  R(g, x, y, w, h, STONE[0]);
  for (let r = 0; r * 4 < h; r++) {
    let bx = x - Math.floor(hash(r, 1, seed) * 5);
    while (bx < x + w) {
      const bw = 5 + Math.floor(hash(bx, r, seed) * 4);
      const v = hash(bx, r, seed + 1);
      const x0 = Math.max(x, bx);
      const x1 = Math.min(x + w, bx + bw - 1);
      const bh = Math.min(3, y + h - (y + r * 4));
      if (x1 > x0 && bh > 0) {
        R(g, x0, y + r * 4, x1 - x0, bh, v > 0.7 ? STONE[2] : STONE[1]);
        if (v > 0.45) R(g, x0, y + r * 4, x1 - x0, 1, v > 0.7 ? STONE[3] : STONE[2]);
      }
      bx += bw;
    }
  }
}

export const PURPLE = [SKY[0], SKY[1], SKY[2], SKY[3]] as const;

/** A doorway with a rounded head. */
export function arch(g: Ctx, x: number, y: number, w: number, h: number, col: string): void {
  R(g, x + 3, y, w - 6, 1, col);
  R(g, x + 2, y + 1, w - 4, 1, col);
  R(g, x + 1, y + 2, w - 2, 1, col);
  R(g, x, y + 3, w, h - 3, col);
}

/** A toothed wheel; `turn` is how far round it has gone, as a share of one tooth. */
export function gear(
  g: Ctx,
  cx: number,
  cy: number,
  r: number,
  teeth: number,
  turn: number,
  body: string,
  shade: string,
): void {
  for (let dy = -r - 2; dy <= r + 2; dy++)
    for (let dx = -r - 2; dx <= r + 2; dx++) {
      const d = Math.hypot(dx + 0.5, dy + 0.5);
      const tooth = Math.cos(Math.atan2(dy + 0.5, dx + 0.5) * teeth + turn * Math.PI * 2) > 0.25;
      if (d < r * 0.36 || !(d <= r - 0.4 || (d <= r + 1.5 && tooth))) continue;
      R(g, cx + dx, cy + dy, 1, 1, dx + dy > 1 ? shade : body);
    }
}

function lantern(g: Ctx, x: number, y: number, glass: string, core: string): void {
  R(g, x + 2, y, 1, 1, BARK[0]);
  R(g, x, y + 1, 5, 1, BARK[0]);
  R(g, x, y + 2, 5, 5, BARK[0]);
  R(g, x + 1, y + 2, 3, 5, glass);
  R(g, x + 1, y + 3, 3, 3, core);
  R(g, x, y + 7, 5, 1, BARK[0]);
}

/** A flame in a dark mouth: the three steps of its flicker, or embers when it is out. */
function fire(g: Ctx, x: number, y: number, w: number, h: number, step: number): void {
  R(g, x, y, w, h, DARK);
  if (step === 0) {
    R(g, x + 1, y + h - 1, w - 2, 1, CLAY[0]);
    return;
  }
  R(g, x, y + 1, w, h - 1, SKY[5]);
  R(g, x + 1, y + (step === 2 ? 1 : 2), w - 2, h - (step === 2 ? 1 : 2), GOLD[1]);
  const lick = step === 1 ? 1 : step === 2 ? w - 3 : Math.floor(w / 2) - 1;
  R(g, x + lick, y, 2, 2, SKY[5]);
  R(g, x + Math.floor(w / 2) - 1, y + h - 3, 2, 3, CREAM);
  R(g, x + 1, y + h - 1, w - 2, 1, GOLD[2]);
}

// ---------- the gatherer: a gnome ----------

/**
 * A gnome, in one of five poses: standing, leaning, bent to the ground, lifting what he has found
 * over his head, and sat down asleep (which is what a gatherer does when no power reaches it and
 * the dusk is too deep to see by). Standing or with his arms up, `step` 1 or 2 is one foot of a
 * waddle: that boot lifted, and the rest of him leant a pixel over the other.
 */
function gnomePic(hat: Hat, pose: number, step = 0): Canvas {
  const { c, g } = makeCanvas(12, 15);
  const [hx, hy] = pose === 1 ? [1, 1] : pose === 2 ? [2, 4] : pose === 4 ? [0, 3] : [0, 0];
  const lean = step === 1 ? -1 : step === 2 ? 1 : 0;
  const tunic = WATER[1];
  const dark = WATER[0];
  // Boots and body.
  if (pose === 4) {
    R(g, 2, 13, 3, 2, BARK[1]);
    R(g, 7, 13, 3, 2, BARK[1]);
    R(g, 3, 9, 6, 5, tunic);
    R(g, 3, 13, 6, 1, dark);
  } else {
    R(g, 3, step === 1 ? 12 : 13, 2, 2, BARK[1]);
    R(g, 7, step === 2 ? 12 : 13, 2, 2, BARK[1]);
    R(g, 3 + lean, 8 + (pose === 2 ? 2 : 0), 6, 5 - (pose === 2 ? 2 : 0), tunic);
    R(g, 3 + lean, 12, 6, 1, dark);
    R(g, 3 + lean, 11, 6, 1, BARK[0]);
    R(g, 5 + lean, 11, 2, 1, GOLD[1]);
  }
  // Arms.
  if (pose === 3) {
    R(g, 2 + lean, 3, 1, 5, tunic);
    R(g, 9 + lean, 3, 1, 5, tunic);
    R(g, 2 + lean, 2, 1, 1, "#e9d8b8");
    R(g, 9 + lean, 2, 1, 1, "#e9d8b8");
  } else if (pose === 2) {
    R(g, 9, 9, 1, 4, tunic);
    R(g, 10, 12, 1, 2, "#e9d8b8");
  } else if (pose === 4) {
    R(g, 2, 10, 1, 3, tunic);
    R(g, 9, 10, 1, 3, tunic);
  } else {
    R(g, 2 + lean, 8 + hy, 1, 3, tunic);
    R(g, 9 + lean, 8 + hy, 1, 3, tunic);
    R(g, 9 + hx + lean, 11 + hy, 1, 1, "#e9d8b8");
  }
  // Head: a nose, a beard, and the hat down over the eyes.
  const x = 3 + hx + lean;
  const y = 4 + hy;
  R(g, x + 1, y, 4, 2, "#e9d8b8");
  R(g, x + 2, y + 1, 2, 1, CLAY[3]);
  R(g, x + 1, y + 2, 4, 2, CREAM);
  R(g, x + 2, y + 4, 2, 1, CREAM);
  R(g, x + 1, y + 3, 1, 1, "#cbb894");
  // The hat: a tall cone with a brim, its tip flopped over when he sleeps.
  R(g, x, y - 1, 6, 1, hat[1]);
  R(g, x + 1, y - 2, 4, 1, hat[0]);
  R(g, x + 1, y - 3, 3, 1, hat[0]);
  if (pose === 4) {
    R(g, x + 2, y - 4, 3, 1, hat[0]);
    R(g, x + 4, y - 3, 2, 1, hat[1]);
  } else {
    R(g, x + 2, y - 4, 2, 1, hat[0]);
    R(g, x + 2 + (pose === 2 ? 1 : 0), y - 5 + (pose === 2 ? 1 : 0), 1, 1, hat[2]);
  }
  R(g, x + 1, y - 2, 1, 1, CREAM);
  return c;
}
const gnome = (hat: Hat, pose: number, step = 0): Sprite => spr(gnomePic(hat, pose, step), 6, 15);

/** The rake a second-grade gatherer keeps by him, stood in the ground: a steel head on a pale handle. */
const RAKE = [
  "ttttttt",
  "S.S.S.S",
  "S.S.S.S",
  "...n...",
  "...n...",
  "...n...",
  "...n...",
  "...n...",
  "...n...",
  "...n...",
  "...n...",
  "...n...",
  "...b...",
];
const BASKET = [".N..N.", "NnNnNn", "nNnNnN", ".nNnN."];
/** What a third-grade gatherer puts what he finds in, where the first two have a basket. */
const BARROW = ["...nnnnnn.", "b..NNNNNN.", ".bbnnnnnn.", "...bbbbb..", "...sS..b..", "...Ss..b.."];

// ---------- the brass a higher grade wears ----------

/** Brass as the yard has it: in shade, lit, and where the light catches it. */
const BRASS = [GOLD[0], GOLD[1], GOLD[2]] as const;

/**
 * A piece of the third grade is iron where the first two are wood: each step of the wood's ramp
 * becomes the same step of `IRON`, in place, over the whole picture drawn so far; with `stone`, its
 * stone too (a kiln's foot and chimney, a tunnel's hood). Its brass stays brass.
 */
export function ironClad(g: Ctx, grade: number, stone = false): void {
  if (grade < 3) return;
  const from = [...BARK, ...(stone ? STONE : [])].map(rgb);
  const to = [...IRON, ...(stone ? IRON.slice(1) : [])].map(rgb);
  const { width: w, height: h } = g.canvas;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const k = from.findIndex(([r, gg, b]) => d[i] === r && d[i + 1] === gg && d[i + 2] === b);
    const [r, gg, b] = to[k] ?? [];
    if (r === undefined || gg === undefined || b === undefined) continue;
    d[i] = r;
    d[i + 1] = gg;
    d[i + 2] = b;
  }
  g.putImageData(img, 0, 0);
}

/**
 * What a machine of the second grade and up wears: a brass band, two pixels deep, across it from `x`
 * for `w` at row `y`, and a small plate at (`px`, `py`). Grade 1 wears nothing.
 */
export function fitted(g: Ctx, grade: number, x: number, y: number, w: number, px: number, py: number): void {
  if (grade < 2) return;
  R(g, x, y, w, 2, BRASS[0]);
  R(g, x, y, w, 1, BRASS[1]);
  R(g, x + 1, y, 2, 1, BRASS[2]);
  // A rivet at each end.
  R(g, x, y + 1, 1, 1, BARK[0]);
  R(g, x + w - 1, y + 1, 1, 1, BARK[0]);
  R(g, px, py, 3, 2, BRASS[1]);
  R(g, px, py, 1, 1, BRASS[2]);
  R(g, px, py + 1, 3, 1, BRASS[0]);
}

// ---------- the mill's three faces ----------

function saw(step: number, grade = 1): Sprite {
  return tile(15, (g) => {
    // The blade stands half out of the table: a steel disc, its teeth one way and then the other as it turns.
    for (let k = 0; k < 9; k++) {
      const a = Math.PI + ((k + (step === 2 ? 0.5 : 0)) / 9) * Math.PI;
      R(g, Math.round(8 + Math.cos(a) * 6.4 - 0.5), Math.round(8 + Math.sin(a) * 6.4 - 0.5), 1, 1, STONE[3]);
    }
    for (let dy = -6; dy < 0; dy++)
      for (let dx = -6; dx < 6; dx++) {
        const d = Math.hypot(dx + 0.5, dy + 0.5);
        if (d > 5.5) continue;
        R(g, 8 + dx, 8 + dy, 1, 1, d > 4.3 ? STONE[1] : dx + dy < -4 ? STONE[3] : STONE[2]);
      }
    R(g, 7, 5, 2, 2, GOLD[0]);
    R(g, 7, 5, 1, 1, GOLD[2]);
    if (step > 0) R(g, step === 1 ? 4 : 10, step === 1 ? 4 : 5, 2, 1, CREAM);
    // The table, and a bough waiting on it.
    R(g, 0, 8, 16, 2, BARK[4]);
    R(g, 0, 8, 16, 1, GOLD[0]);
    R(g, 0, 10, 16, 1, BARK[1]);
    R(g, 1, 11, 2, 4, BARK[2]);
    R(g, 13, 11, 2, 4, BARK[2]);
    R(g, 3, 12, 10, 1, BARK[1]);
    R(g, 0, 6, 3, 2, BARK[3]);
    R(g, 0, 6, 1, 2, GOLD[0]);
    // Sawdust.
    R(g, 10, 14, 3, 1, "#cbb894");
    R(g, 11, 13, 1, 1, "#e9d8b8");
    fitted(g, grade, 0, 9, 16, 6, 12);
    ironClad(g, grade);
  });
}

function kiln(step: number, grade = 1): Sprite {
  return tile(19, (g) => {
    // The chimney behind, then a dome of fired brick on a stone foot.
    R(g, 10, 0, 4, 7, STONE[1]);
    R(g, 10, 0, 1, 7, STONE[2]);
    R(g, 9, 0, 6, 1, STONE[0]);
    g.drawImage(
      paint(16, 17, (x, y) => {
        const inside = y >= 10 ? x >= 1 && x <= 14 : Math.hypot((x + 0.5 - 8) / 7.2, (y + 0.5 - 10) / 7.4) < 1;
        if (!inside) return null;
        const row = Math.floor((y - 1) / 3);
        if ((y - 1) % 3 === 0 || (x + (row % 2) * 2) % 5 === 0) return CLAY[0];
        if (x + y < 9) return CLAY[3];
        return x + y < 14 ? CLAY[2] : CLAY[1];
      }),
      0,
      0,
    );
    R(g, 0, 17, 16, 2, STONE[1]);
    R(g, 0, 17, 16, 1, STONE[2]);
    arch(g, 4, 9, 8, 8, STONE[2]);
    fire(g, 5, 11, 6, 6, step);
    R(g, 5, 10, 6, 1, DARK);
    // The band hoops the dome over the arch; the plate is the arch's keystone.
    fitted(g, grade, 2, 6, 12, 6, 8);
    ironClad(g, grade, true);
  });
}

function press(step: number, grade = 1): Sprite {
  return tile(19, (g) => {
    const plate = 7 + step * 2;
    // Two posts, a beam across, and a screw that drives the plate down.
    R(g, 7, 3, 2, plate - 3, STONE[2]);
    for (let y = 4; y < plate; y += 2) R(g, 7, y, 2, 1, STONE[0]);
    R(g, 6, 0, 4, 2, STONE[1]);
    R(g, 5, 0, 6, 1, STONE[3]);
    R(g, 2, 3, 2, 14, BARK[2]);
    R(g, 2, 3, 1, 14, BARK[3]);
    R(g, 12, 3, 2, 14, BARK[2]);
    R(g, 13, 3, 1, 14, BARK[1]);
    R(g, 1, 2, 14, 2, BARK[3]);
    R(g, 1, 2, 14, 1, BARK[4]);
    R(g, 4, plate, 8, 2, BARK[4]);
    R(g, 4, plate + 1, 8, 1, BARK[1]);
    // The bowl, and the oil in it.
    R(g, 4, 13, 8, 3, CLAY[1]);
    R(g, 4, 13, 8, 1, GOLD[1]);
    R(g, 5, 13, 2, 1, GOLD[2]);
    R(g, 4, 15, 8, 1, CLAY[0]);
    if (step === 2) R(g, 9, 12, 1, 1, GOLD[2]);
    R(g, 0, 16, 16, 3, BARK[2]);
    R(g, 0, 16, 16, 1, BARK[3]);
    R(g, 0, 18, 16, 1, BARK[0]);
    fitted(g, grade, 0, 16, 16, 6, 2);
    ironClad(g, grade);
  });
}

// ---------- bench and workshop ----------

function bench(step: number, grade = 1): Sprite {
  return tile(16, (g) => {
    // The hammer on its post: raised, on its way, and struck.
    R(g, 11, 3, 2, 5, BARK[1]);
    R(g, 11, 3, 1, 5, BARK[3]);
    if (step === 0) {
      for (let k = 0; k < 5; k++) R(g, 11 - k, 3 - Math.round(k * 0.6), 1, 1, BARK[4]);
      R(g, 4, 0, 4, 3, STONE[2]);
      R(g, 4, 0, 4, 1, STONE[3]);
    } else if (step === 1) {
      R(g, 6, 3, 6, 1, BARK[4]);
      R(g, 3, 2, 4, 3, STONE[2]);
      R(g, 3, 2, 4, 1, STONE[3]);
    } else {
      for (let k = 0; k < 5; k++) R(g, 11 - k, 4 + Math.round(k * 0.5), 1, 1, BARK[4]);
      R(g, 4, 5, 4, 3, STONE[2]);
      R(g, 4, 5, 4, 1, STONE[3]);
      R(g, 2, 6, 1, 1, CREAM);
      R(g, 9, 5, 1, 1, GOLD[2]);
    }
    // The bench itself, with a vice at one end and a shelf under.
    R(g, 13, 5, 3, 3, STONE[1]);
    R(g, 13, 5, 3, 1, STONE[3]);
    R(g, 0, 8, 16, 2, BARK[4]);
    R(g, 0, 8, 16, 1, GOLD[0]);
    R(g, 0, 10, 16, 2, BARK[2]);
    R(g, 0, 11, 16, 1, BARK[1]);
    R(g, 1, 12, 2, 4, BARK[2]);
    R(g, 13, 12, 2, 4, BARK[2]);
    R(g, 3, 13, 10, 1, BARK[1]);
    R(g, 5, 12, 2, 1, GOLD[1]);
    fitted(g, grade, 0, 10, 16, 8, 13);
    ironClad(g, grade);
  });
}

function workshop(lit: boolean, step: number, grade = 1): Sprite {
  return tile(25, (g) => {
    R(g, 11, 0, 2, 5, STONE[0]);
    R(g, 11, 0, 1, 5, STONE[2]);
    planks(g, 1, 9, 14, 13, 41);
    R(g, 1, 9, 14, 2, BARK[0]);
    R(g, 1, 9, 1, 13, BARK[1]);
    R(g, 14, 9, 1, 13, BARK[1]);
    stones(g, 0, 21, 16, 4, 42);
    shingles(g, 0, 3, 16, 7, (r) => Math.round((7 - r) * 0.3), PURPLE, 43);
    R(g, 2, 2, 12, 1, BARK[1]);
    R(g, 0, 9, 16, 1, SKY[0]);
    // A window, lit while there is work in hand.
    R(g, 2, 12, 5, 6, BARK[0]);
    R(g, 3, 13, 3, 4, lit ? GOLD[1] : SKY[1]);
    if (lit) R(g, 3, 13, 3, 2, GOLD[2]);
    if (lit) R(g, 3, 13, 1, 1, CREAM);
    R(g, 4, 13, 1, 4, BARK[1]);
    // And the brass wheel that says it is working.
    ell(g, 11, 15.5, 4, 4, BARK[0]);
    gear(g, 11, 15, 2, 6, step / 2, GOLD[1], GOLD[0]);
    // The band runs along the wall's foot, over the stone; the plate is the window's lintel.
    fitted(g, grade, 1, 19, 14, 3, 11);
    ironClad(g, grade);
  });
}

// ---------- the Study ----------

/** The scholars' hat: plum, where a gatherer's is red, green, gold or dark iron by its grade and Pipwick's is blue. */
const SCHOLAR: Hat = [SKY[3], SKY[2], SKY[3]];
/** The spines on a shelf, by turns: muted, and no two alike side by side. */
const SPINES = [CLAY[1], WATER[1], PAPER[0], GREEN[2], SKY[3], CLAY[0], WATER[2], STONE[1]] as const;

/**
 * The Study: a case of books, a lectern under a hanging lamp, and a gnome scholar who reads there.
 * `state` 0 is unlit (the lamp out, the book shut, the scholar asleep on his feet's end), 1 lit with
 * nothing to study (the book shut, the scholar standing by), and 2 to 4 at work on a folio: the page
 * lying, lifted and turned, once for each folio studied.
 */
function study(state: number, grade = 1): Sprite {
  return tile(24, (g) => {
    const lit = state > 0;
    const open = state >= 2;
    // The case: a cornice, and three rows of books on two shelves.
    R(g, 1, 1, 14, 17, BARK[1]);
    R(g, 2, 2, 12, 15, BARK[0]);
    R(g, 0, 0, 16, 1, BARK[3]);
    R(g, 0, 1, 16, 1, BARK[2]);
    for (let row = 0; row < 3; row++) {
      const top = 2 + row * 5;
      if (row < 2) R(g, 2, top + 4, 12, 1, BARK[2]);
      for (let x = 2, n = row * 3; x < 14; n++) {
        // A book two pixels thick has a lit edge; here and there one is shorter than its neighbours.
        const wide = hash(n, row, 71) > 0.45 && x < 13 ? 2 : 1;
        const short = hash(n, row, 72) > 0.7 ? 1 : 0;
        const col = SPINES[(n * 3 + row * 5) % SPINES.length] ?? CLAY[1];
        R(g, x, top + short, wide, 4 - short, col);
        if (wide === 2) R(g, x, top + short, 1, 1, CREAM);
        x += wide;
      }
    }
    fitted(g, grade, 1, 6, 14, 6, 0);
    // The scholar, turned to the lectern: asleep with no light to read by, bent to the page at work.
    const pose = !lit ? 4 : open ? 1 : 0;
    g.drawImage(flipped(gnomePic(SCHOLAR, pose)), 5, 9);
    // The lectern: a post and a foot, and a sloping top with the book on it.
    R(g, 3, 17, 2, 6, BARK[2]);
    R(g, 3, 17, 1, 6, BARK[3]);
    R(g, 1, 22, 6, 2, BARK[1]);
    R(g, 1, 22, 6, 1, BARK[3]);
    R(g, 0, 15, 8, 2, BARK[4]);
    R(g, 0, 15, 8, 1, GOLD[0]);
    if (open) {
      // A folio lying open: two pages, and a third on its way over.
      R(g, 1, 13, 6, 2, PAPER[2]);
      R(g, 4, 13, 1, 2, PAPER[0]);
      R(g, 1, 14, 6, 1, PAPER[1]);
      if (state === 3) R(g, 5, 11, 1, 2, PAPER[2]);
      if (state === 4) R(g, 3, 11, 1, 2, PAPER[2]);
      // His hand is on the page while it turns.
      if (state >= 3) {
        R(g, 7, 13, 2, 1, WATER[1]);
        R(g, state === 3 ? 6 : 5, 12, 1, 1, "#e9d8b8");
      }
    } else {
      R(g, 2, 13, 5, 2, CLAY[1]);
      R(g, 2, 13, 5, 1, CLAY[2]);
      R(g, 2, 14, 5, 1, PAPER[0]);
    }
    // The lamp hangs over the book from the cornice.
    R(g, 3, 2, 1, 2, BARK[0]);
    lantern(g, 1, 4, lit ? GOLD[2] : STONE[0], lit ? CREAM : STONE[1]);
    ironClad(g, grade);
  });
}

// ---------- the cart stop ----------

/**
 * The cart stop: a short rail into a timbered hole. `cart` is where its cart is: 0 waiting empty at
 * the mouth, 1 there with a load, 2 rolling under with it, 3 gone under, 4 coming back up empty.
 */
function stop(cart: number): Sprite {
  return tile(20, (g) => {
    // The hole, and the rails running into it over their sleepers.
    R(g, 3, 4, 10, 10, DARK);
    for (const y of [10, 13, 16, 19]) {
      R(g, 3, y, 10, 1, y > 10 ? BARK[3] : BARK[1]);
      if (y > 10 && y < 19) R(g, 3, y + 1, 10, 1, BARK[0]);
    }
    for (const x of [5, 10]) {
      R(g, x, 6, 1, 14, STONE[2]);
      R(g, x, 6, 1, 5, STONE[0]);
    }
    if (cart !== 3) {
      const under = cart === 2 || cart === 4;
      const top = under ? 7 : 12;
      // In the hole it is in shadow.
      const wood = under ? BARK[1] : BARK[3];
      const iron = under ? STONE[0] : STONE[1];
      R(g, 4, top, 8, 5, wood);
      R(g, 4, top, 8, 1, iron);
      R(g, 4, top + 4, 8, 1, under ? BARK[0] : BARK[1]);
      R(g, 6, top + 1, 1, 3, under ? BARK[0] : BARK[2]);
      R(g, 9, top + 1, 1, 3, under ? BARK[0] : BARK[2]);
      R(g, 4, top + 5, 2, 2, iron);
      R(g, 10, top + 5, 2, 2, iron);
      if (!under) {
        R(g, 4, top + 5, 1, 1, STONE[3]);
        R(g, 10, top + 5, 1, 1, STONE[3]);
      }
      if (cart === 1 || cart === 2) {
        // Whatever it was handed, heaped over the rim.
        R(g, 5, top - 1, 6, 1, under ? BARK[2] : "#cbb894");
        R(g, 6, top - 2, 3, 1, under ? BARK[1] : "#e9d8b8");
        if (!under) R(g, 9, top - 1, 1, 1, GOLD[1]);
      }
    }
    // The timbers of the mouth stand over whatever passes under them.
    for (const x of [1, 13]) {
      R(g, x, 3, 2, 11, BARK[2]);
      R(g, x, 3, 1, 11, BARK[3]);
    }
    R(g, 0, 0, 16, 4, BARK[2]);
    R(g, 0, 0, 16, 1, BARK[4]);
    R(g, 0, 3, 16, 1, BARK[0]);
    R(g, 2, 1, 1, 1, STONE[2]);
    R(g, 13, 1, 1, 1, STONE[2]);
  });
}

// ---------- power ----------

function pylon(tall: boolean, level: number): Sprite {
  const h = tall ? 34 : 26;
  const { c, g } = makeCanvas(12, h);
  R(g, 2, h - 3, 5, 3, STONE[1]);
  R(g, 2, h - 3, 5, 1, STONE[3]);
  R(g, 3, 2, 3, h - 4, BARK[1]);
  R(g, 3, 2, 1, h - 4, BARK[3]);
  R(g, 2, 0, 5, 2, BARK[2]);
  R(g, 3, 0, 3, 1, GOLD[0]);
  R(g, 3, 4, 8, 2, BARK[1]);
  R(g, 3, 4, 8, 1, BARK[3]);
  for (let k = 0; k < 3; k++) R(g, 6 + k, 8 - k, 1, 1, BARK[1]);
  if (tall) {
    R(g, 0, 12, 6, 2, BARK[1]);
    R(g, 0, 12, 6, 1, BARK[3]);
  }
  const glass = level === 0 ? STONE[0] : level === 1 ? GOLD[0] : GOLD[2];
  const core = level === 0 ? STONE[1] : level === 1 ? GOLD[1] : CREAM;
  lantern(g, 7, 6, glass, core);
  return spr(c, 4, h);
}

/** A wooden wheel face-on; `step` is one of four turns of an eighth of a spoke. */
function wheelPic(step: number, rim: string, spoke: string, paddle: string, hub: string, r = 7.5): Canvas {
  const size = Math.ceil(r * 2 + 3);
  const mid = size / 2;
  return paint(size, size, (x, y) => {
    const dx = x + 0.5 - mid;
    const dy = y + 0.5 - mid;
    const d = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx) + (step * Math.PI) / 16;
    if (d < 1.6) return hub;
    if (d > r + 1.2) return null;
    if (d > r) return Math.cos(a * 8) > 0.55 ? paddle : null;
    if (d > r - 1.6) return dx + dy < 0 ? rim : spoke;
    return Math.abs(Math.sin(a * 4)) < 0.9 / d ? spoke : null;
  });
}

function wheel(step: number): Sprite {
  const { c, g } = makeCanvas(18, 20);
  // The frame it hangs in, then the wheel.
  R(g, 8, 8, 2, 12, BARK[1]);
  for (let k = 0; k < 9; k++) {
    R(g, 8 - Math.round(k * 0.6), 10 + k, 1, 1, BARK[1]);
    R(g, 9 + Math.round(k * 0.6), 10 + k, 1, 1, BARK[1]);
  }
  R(g, 2, 18, 14, 2, BARK[2]);
  R(g, 2, 18, 14, 1, BARK[3]);
  g.drawImage(wheelPic(step, BARK[4], BARK[2], BARK[1], GOLD[1]), 0, 0);
  return spr(c, 9, 20);
}

function boiler(step: number): Sprite {
  return tile(23, (g) => {
    // The stack behind, the copper in front of it, and the firebox under.
    R(g, 12, 0, 3, 16, STONE[0]);
    R(g, 12, 0, 1, 16, STONE[2]);
    R(g, 11, 0, 5, 2, STONE[1]);
    R(g, 11, 0, 5, 1, STONE[3]);
    R(g, 2, 5, 10, 11, CLAY[1]);
    R(g, 3, 4, 8, 1, CLAY[1]);
    R(g, 4, 3, 6, 1, CLAY[2]);
    R(g, 3, 4, 2, 11, CLAY[2]);
    R(g, 4, 5, 1, 9, CLAY[3]);
    R(g, 10, 5, 2, 11, CLAY[0]);
    R(g, 2, 7, 10, 1, GOLD[0]);
    R(g, 2, 13, 10, 1, GOLD[0]);
    R(g, 3, 7, 2, 1, GOLD[2]);
    R(g, 3, 13, 2, 1, GOLD[2]);
    // The gauge.
    R(g, 6, 9, 3, 3, BARK[0]);
    R(g, 7, 10, 1, 1, CREAM);
    R(g, 7 + (step > 0 ? 1 : -1), 9, 1, 1, step > 0 ? CLAY[2] : STONE[2]);
    stones(g, 0, 16, 16, 7, 51);
    R(g, 0, 16, 16, 1, STONE[3]);
    R(g, 3, 17, 7, 5, STONE[0]);
    fire(g, 4, 18, 5, 4, step);
  });
}

// ---------- carrying ----------

/** A stone hood over half a tile, with the dark of a tunnel under it; `side` is the side it stands on. */
function hood(side: number, grade = 1): Sprite {
  const { c, g } = makeCanvas(16, 18);
  // Seen from the south everything is a stone box; what changes is where its mouth is.
  const box = (x: number, y: number, w: number, h: number): void => {
    stones(g, x, y + 3, w, h - 3, 61 + side);
    R(g, x, y, w, 3, STONE[2]);
    R(g, x, y, w, 1, STONE[3]);
    R(g, x, y + 3, w, 1, STONE[0]);
  };
  if (side === 0) {
    box(8, 3, 8, 15);
    R(g, 8, 8, 3, 9, DARK);
    R(g, 8, 7, 3, 1, STONE[0]);
  } else if (side === 2) {
    box(0, 3, 8, 15);
    R(g, 5, 8, 3, 9, DARK);
    R(g, 5, 7, 3, 1, STONE[0]);
  } else if (side === 1) {
    // Going away from us and down: only the top of the hood shows, and the mouth is its near lip.
    box(1, 10, 14, 8);
    R(g, 3, 10, 10, 2, DARK);
  } else {
    // Coming towards us: the arch itself.
    box(1, 0, 14, 11);
    arch(g, 3, 2, 10, 9, STONE[3]);
    arch(g, 4, 3, 8, 8, DARK);
  }
  R(g, side === 0 ? 13 : 2, side === 1 ? 13 : 4, 2, 1, GREEN[3]);
  if (grade >= 2) {
    // A brass lip on the mouth: over it where the mouth is at a side, round it where it faces us.
    if (side === 0 || side === 2) {
      const x = side === 0 ? 8 : 4;
      R(g, x, 7, 4, 1, BRASS[1]);
      R(g, x, 7, 1, 1, BRASS[2]);
      R(g, side === 0 ? 11 : 4, 8, 1, 9, BRASS[0]);
    } else if (side === 1) {
      R(g, 2, 12, 12, 1, BRASS[1]);
      R(g, 2, 12, 2, 1, BRASS[2]);
      R(g, 2, 10, 1, 2, BRASS[0]);
      R(g, 13, 10, 1, 2, BRASS[0]);
    } else {
      arch(g, 3, 2, 10, 9, BRASS[1]);
      arch(g, 4, 3, 8, 8, DARK);
      R(g, 5, 2, 3, 1, BRASS[2]);
      R(g, 12, 5, 1, 6, BRASS[0]);
    }
  }
  ironClad(g, grade, true);
  starClad(g, grade);
  return spr(c, 8, 18);
}

/**
 * What marks a tile where belts meet, typed pointing east. A splitter has a brass arrowhead on each
 * of its three ways out. A joiner has a pale arrowhead on each of its three ways in, and one brass
 * arrowhead on its way out.
 */
const SPLITTER = [
  "......kyk.......",
  ".....kyyyk......",
  "....kyyyyyk.....",
  "....kkkkkkk.....",
  "...........kk...",
  "...........kyk..",
  "...........kyyk.",
  "...........kyyyk",
  "...........kyyk.",
  "...........kyk..",
  "...........kk...",
  "................",
  "....kkkkkkk.....",
  "....kyyyyyk.....",
  ".....kyyyk......",
  "......kyk.......",
];
const JOINER = [
  "....kccccck.....",
  ".....kccck......",
  "......kck.......",
  ".......k........",
  "kk.........kk...",
  "cck........kyk..",
  "ccck.......kyyk.",
  "cccck......kyyyk",
  "ccck.......kyyk.",
  "cck........kyk..",
  "kk.........kk...",
  "................",
  ".......k........",
  "......kck.......",
  ".....kccck......",
  "....kccccck.....",
];

/** A picture typed in rows, turned a quarter to the right. */
const quarter = (r: readonly string[]): string[] =>
  Array.from(r[0] ?? "", (_, y) => r.map((_row, x) => r[r.length - 1 - x]?.charAt(y) ?? ".").join(""));

/** A square picture typed pointing east, turned to point each way: east, south, west, north. */
function eachWay(rows: readonly string[]): Canvas[] {
  const south = quarter(rows);
  const west = quarter(south);
  return [rows, south, west, quarter(west)].map((r) => bitmap(r, PAL));
}

/** The rows of `SPLITTER` each of its arrowheads keeps to: the one ahead, the one to the left, the one to the right. */
const HEADS = [
  [4, 10],
  [0, 3],
  [12, 15],
] as const;

/** A splitter's vane: a small brass arrow showing which way the next thing will go. */
function vane(dir: number): Canvas {
  const rows = [
    ["k....", "yk...", "yyk..", "yk...", "k...."],
    ["kyyyk", ".kyk.", "..k..", ".....", "....."],
    ["....k", "...ky", "..kyy", "...ky", "....k"],
    [".....", ".....", "..k..", ".kyk.", "kyyyk"],
  ];
  return bitmap(rows[dir] ?? [], PAL);
}

/**
 * The pointer on a machine's way out, typed pointing east, as large as a splitter's arrowheads: bright
 * brass lit along its top edge and shaded along its foot, so that it shines against whatever it lies
 * on (belts, timber, brick). Lit, for a machine pointed at or picked, it is the brightest brass.
 */
const POINTER = ["k....", "kwk..", "kwyk.", "kyyyk", "kyok.", "kok..", "k...."];
const SHINE = { k: INK, w: GOLD[3], y: GOLD[2], o: GOLD[1] };
const SHONE = { k: INK, w: "#ffffff", y: GOLD[3], o: GOLD[2] };
function pointer(dir: number, lit: boolean): Canvas {
  return bitmap(Array.from({ length: dir }).reduce<readonly string[]>(quarter, POINTER), lit ? SHONE : SHINE);
}

function crate(big: boolean, open: boolean): Sprite {
  const w = big ? 14 : 12;
  const h = big ? 15 : 12;
  const { c, g } = makeCanvas(w, h + 4);
  const top = 4;
  const lid = big ? 4 : 3;
  R(g, 0, top, w, h, BARK[3]);
  R(g, 0, top, 1, h, BARK[1]);
  R(g, w - 1, top, 1, h, BARK[1]);
  R(g, 0, top + h - 1, w, 1, BARK[1]);
  for (let i = 1; i < h - lid - 1 && i < w - 1; i++) R(g, i, top + lid + i, 1, 1, BARK[1]);
  if (big) {
    R(g, 0, top + 7, w, 1, STONE[1]);
    R(g, 0, top + 11, w, 1, STONE[1]);
  }
  if (open) {
    // The lid stood up behind, and what is inside showing.
    R(g, 0, top, w, lid, BARK[0]);
    R(g, 1, 0, w - 2, 4, BARK[4]);
    R(g, 1, 0, w - 2, 1, GOLD[0]);
    R(g, 1, 3, w - 2, 1, BARK[1]);
    R(g, 2, top, 3, 2, "#cbb894");
    R(g, 6, top + 1, 3, 1, GOLD[1]);
    R(g, w - 4, top, 2, 2, STONE[2]);
  } else {
    R(g, 0, top, w, lid, BARK[4]);
    R(g, 0, top, w, 1, GOLD[0]);
    R(g, 0, top + lid, w, 1, BARK[1]);
    R(g, Math.floor(w / 2) - 1, top + lid - 1, 2, 3, GOLD[1]);
  }
  return spr(c, w / 2, h + 4);
}

// ---------- the depot, the gate and the fence ----------

/** Where things are on the depot's picture, for whatever is drawn onto it afresh each frame. */
export const DEPOT = {
  /** The middle of its doorway, at the sill. */
  door: { x: 26, y: 63 },
  /** The mouth of its chimney. */
  smoke: { x: 42, y: 1 },
  /** The board of standing orders on its wall: its corner, and the size of a note. */
  board: { x: 38, y: 42, w: 11, h: 8 },
  lamps: [
    { x: 15, y: 46 },
    { x: 36, y: 46 },
  ],
  flag: { x: 12, y: 8 },
  fly: { x: -3, y: 49 },
  wheelR: 5.5,
} as const;

/**
 * The depot: the back of the workshop that fronts onto the town. The same plank walls on a stone
 * foot, the same chimney and brass wheel, under the town's purple shingles, with a wide door
 * standing open and the light of the place coming out of it.
 */
function depot(): Sprite {
  const { c, g } = makeCanvas(52, 64);
  planks(g, 3, 38, 46, 20, 17);
  stones(g, 2, 56, 48, 8, 19);
  R(g, 3, 38, 46, 2, BARK[0]);
  for (const x of [2, 47]) {
    R(g, x, 38, 3, 20, BARK[1]);
    R(g, x, 38, 1, 20, BARK[3]);
  }
  // A lit window, and the frame of the order board.
  R(g, 6, 43, 7, 8, BARK[0]);
  R(g, 7, 44, 5, 6, GOLD[1]);
  R(g, 7, 44, 5, 3, GOLD[2]);
  R(g, 7, 44, 2, 1, CREAM);
  R(g, 9, 44, 1, 6, BARK[1]);
  R(g, 5, 51, 9, 1, STONE[3]);
  R(g, DEPOT.board.x - 1, DEPOT.board.y - 1, DEPOT.board.w + 2, DEPOT.board.h + 2, BARK[0]);
  R(g, DEPOT.board.x, DEPOT.board.y, DEPOT.board.w, DEPOT.board.h, BARK[4]);
  // Two small hatches at the foot of the wall, for belts that come in beside the door.
  for (const x of [5, 39]) {
    R(g, x, 53, 8, 11, STONE[0]);
    R(g, x + 1, 55, 6, 9, DARK);
    R(g, x - 1, 52, 10, 2, BARK[3]);
    R(g, x - 1, 52, 10, 1, BARK[4]);
  }
  // The door: an arch of pale stone, and inside it crates stacked in warm light.
  arch(g, 17, 40, 18, 24, STONE[2]);
  for (let i = 0; i < 4; i++) {
    R(g, 17, 46 + i * 5, 2, 1, STONE[0]);
    R(g, 33, 46 + i * 5, 2, 1, STONE[0]);
  }
  arch(g, 19, 42, 14, 22, "#3a1a1f");
  R(g, 19, 52, 14, 12, CLAY[0]);
  R(g, 19, 58, 14, 6, SKY[5]);
  R(g, 20, 61, 12, 3, GOLD[1]);
  R(g, 22, 63, 8, 1, GOLD[2]);
  for (const [x, y, s] of [
    [20, 51, 5],
    [27, 53, 5],
    [22, 46, 5],
    [28, 48, 4],
  ] as const) {
    R(g, x, y, s, s, BARK[3]);
    R(g, x, y, s, 1, GOLD[0]);
    R(g, x, y + s - 1, s, 1, BARK[1]);
    R(g, x + s - 1, y, 1, s, BARK[1]);
  }
  // The roof, its ridge, and the brass wheel of the Works on it.
  shingles(g, 0, 10, 52, 28, (r) => Math.round((28 - r) * 0.22), PURPLE, 5);
  R(g, 7, 7, 38, 3, BARK[1]);
  R(g, 7, 7, 38, 1, BARK[3]);
  R(g, 0, 37, 52, 1, SKY[0]);
  ell(g, 24, 23, 8, 8, BARK[0]);
  ell(g, 24, 23, 6.8, 6.8, BARK[2]);
  gear(g, 24, 23, 4, 8, 0, GOLD[1], GOLD[0]);
  // The chimney the town sees from the other side.
  stones(g, 38, 2, 8, 22, 23);
  R(g, 44, 2, 2, 22, STONE[0]);
  R(g, 37, 0, 10, 3, STONE[0]);
  R(g, 37, 0, 10, 1, STONE[2]);
  R(g, 39, 1, 6, 1, DARK);
  return spr(c, 26, 64);
}

function gate(): Sprite {
  const { c, g } = makeCanvas(26, 28);
  for (const x of [1, 21]) {
    R(g, x, 6, 4, 22, BARK[2]);
    R(g, x, 6, 1, 22, BARK[3]);
    R(g, x + 3, 6, 1, 22, BARK[1]);
    R(g, x - 1, 25, 6, 3, STONE[1]);
    R(g, x - 1, 25, 6, 1, STONE[3]);
  }
  R(g, 0, 6, 26, 3, BARK[1]);
  R(g, 0, 6, 26, 1, BARK[3]);
  shingles(g, 0, 1, 26, 5, (r) => Math.round((5 - r) * 0.6), PURPLE, 3);
  R(g, 4, 0, 18, 1, BARK[1]);
  // The Works' wheel on a hanging plate, and a lantern.
  R(g, 9, 9, 8, 6, BARK[1]);
  R(g, 10, 10, 6, 4, BARK[3]);
  R(g, 12, 11, 2, 2, GOLD[1]);
  R(g, 11, 11, 1, 2, GOLD[0]);
  R(g, 14, 11, 1, 2, GOLD[0]);
  lantern(g, 5, 9, GOLD[2], CREAM);
  return spr(c, 13, 28);
}

/** A stretch of post-and-rail fence one tile long: across the view, or running away down it. */
function fence(across: boolean): Sprite {
  if (across) {
    const { c, g } = makeCanvas(17, 10);
    R(g, 0, 4, 17, 1, BARK[3]);
    R(g, 0, 5, 17, 1, BARK[1]);
    R(g, 0, 7, 17, 1, BARK[3]);
    R(g, 0, 8, 17, 1, BARK[1]);
    R(g, 0, 1, 2, 9, BARK[2]);
    R(g, 0, 1, 1, 9, BARK[4]);
    R(g, 0, 0, 2, 1, BARK[4]);
    return { c, ax: 0, ay: 9 };
  }
  const { c, g } = makeCanvas(3, 25);
  R(g, 1, 5, 1, 20, BARK[2]);
  R(g, 2, 5, 1, 20, BARK[0]);
  R(g, 0, 1, 3, 9, BARK[0]);
  R(g, 0, 1, 2, 8, BARK[2]);
  R(g, 0, 1, 1, 8, BARK[3]);
  R(g, 0, 0, 2, 1, BARK[4]);
  return { c, ax: 1, ay: 9 };
}

/** A pennant for the roof while a second shift is on, in the green of the Leaf that paid for it. */
function flag(step: number): Sprite {
  const { c, g } = makeCanvas(12, 16);
  R(g, 1, 0, 1, 16, BARK[1]);
  R(g, 0, 0, 3, 1, GOLD[1]);
  const wave = step === 0 ? [0, 0, 1, 1, 0] : [1, 0, 0, 1, 1];
  for (let k = 0; k < 5; k++) {
    const len = 9 - k * 2;
    R(g, 2, 2 + k + (wave[k] ?? 0), Math.max(1, len), 1, k < 2 ? GREEN[4] : GREEN[3]);
  }
  R(g, 4, 3, 2, 1, "#c9ef9a");
  return spr(c, 1, 16);
}

/**
 * The flag a splitter wears on the way it puts first: a pennant in the dusk plum of the town's roofs
 * on a pole of light wood, typed flying east with its pole at the left; its spot is the pole's foot.
 * `FLAG_AT[side]` is where on a tile (from its top-left corner) the foot stands for each side (east,
 * south, west, north), in that side's arrowhead; on the west side the pennant flies west, the
 * picture turned over.
 */
const PENNANT = ["Npppp", "Nvvvp", "Nvvv.", "Nv...", "N....", "N....", "N...."];
export const FLAG_AT = [
  [13, 10],
  [8, 16],
  [3, 10],
  [8, 4],
] as const;
const pennant = (west: boolean): Sprite => {
  const east = bm(PENNANT, 0, PENNANT.length);
  return west ? mirror(east) : east;
};

// ---------- the set ----------

export interface Machines {
  /** gnome[hat][pose]. */
  gnome: Sprite[][];
  gnomeLeft: Sprite[][];
  /** waddle[hat][carrying ? 1 : 0][step]: a gnome walking, two steps, empty-handed or with his arms up. */
  waddle: Sprite[][][];
  /** The rake a gatherer of the second grade keeps stood beside him, and the same on his other side. */
  rake: Sprite;
  rakeLeft: Sprite;
  basket: Canvas;
  /** The wheelbarrow a gatherer of the third grade has in his basket's place, its handles to the left, and turned. */
  barrow: Canvas;
  barrowLeft: Canvas;
  /**
   * What has a grade is drawn in two looks, `[0]` as the first grade and `[1]` with the brass of the
   * second and third (`lookOf`). Each mill face, cold first and then the steps of its work:
   * saw[look][step].
   */
  saw: Sprite[][];
  kiln: Sprite[][];
  press: Sprite[][];
  bench: Sprite[][];
  /** workshop[look][lit ? 1 : 0][step]. */
  workshop: Sprite[][][];
  /** study[look][state]: unlit, lit with nothing to study, and the three steps of a page turned. */
  study: Sprite[][];
  /** stop[cart]: its cart waiting empty, waiting with a load, rolling under, gone, and coming back. */
  stop: Sprite[];
  /** pylon[tall ? 1 : 0][light: 0 out, 1 dim, 2 bright]. */
  pylon: Sprite[][];
  wheel: Sprite[];
  boiler: Sprite[];
  /** hood[look][side], with a fourth look for the fourth grade (`grade4.ts`). */
  hood: Sprite[][];
  /** splitter[dir] and joiner[dir]: what marks the tile, pointing each way. */
  splitter: Canvas[];
  joiner: Canvas[];
  /** heads[way][dir]: one arrowhead of a splitter pointing `dir`, by itself: the way ahead, to the left, to the right. */
  heads: Canvas[][];
  vane: Canvas[];
  /** pointer[dir], dim and bright. */
  pointer: Canvas[];
  pointerLit: Canvas[];
  /** crate[big ? 1 : 0][open ? 1 : 0]. */
  crate: Sprite[][];
  depot: Sprite;
  /** The depot's brass flywheel, for when the plan is bought. */
  fly: Canvas[];
  flag: Sprite[];
  /** pennant[side]: a splitter's flag on the way it puts first, standing on that side of its tile (`FLAG_AT`). */
  pennant: Sprite[];
  gate: Sprite;
  fenceAcross: Sprite;
  fenceDown: Sprite;
  /**
   * The mark every piece of the second grade wears in the top-left corner of its tile, the two of the
   * third and the three of the fourth: pips[0], pips[1] and pips[2]. A belt has the same mark as part of its tile (`belts.ts`); a
   * splitter, joiner or sorter has it laid over its arrowheads or its board.
   */
  pips: Canvas[];
  /** The same marks, each on a tile of its own and clear but for it: laid over many tiles in one go. */
  tilePips: Canvas[];
}

/**
 * Which of a graded piece's looks a grade is drawn in: wood, wood with brass, iron with brass, or for
 * a tunnel and a gatherer, the only kinds with a fourth grade that have looks, dark iron with lilac.
 */
export const lookOf = (grade: number): number => (grade >= 4 ? 3 : grade >= 3 ? 2 : grade >= 2 ? 1 : 0);
/** The three looks, as the grades they are drawn from. */
const LOOKS = [1, 2, 3] as const;
/**
 * The mark of a grade above the first, typed: one stud of muted brass with its dark edge for the
 * second, two side by side for the third, and a third under the first for the fourth (`STUDS_AT`). A
 * belt's tile and every other graded piece use the same.
 */
export const PIP = { rows: ["kkkk", "kyok", "kook", "kkkk"] } as const;
/** The mark of a grade as a small picture, or nothing for the first. */
function pips(count: number): Canvas {
  const at = STUDS_AT.slice(0, count);
  const { c, g } = makeCanvas(4 + Math.max(...at.map(([x]) => x)), 4 + Math.max(...at.map(([, y]) => y)));
  const one = bitmap(PIP.rows, PAL);
  for (const [x, y] of at) g.drawImage(one, x, y);
  return c;
}

const mirror = (s: Sprite): Sprite => ({ c: flipped(s.c), ax: s.c.width - s.ax, ay: s.ay });

export function makeMachines(): Machines {
  const poses = [0, 1, 2, 3, 4];
  const gnomes = HATS.map((hat) => poses.map((p) => gnome(hat, p)));
  return {
    gnome: gnomes,
    gnomeLeft: gnomes.map((row) => row.map(mirror)),
    waddle: HATS.map((hat) => [0, 3].map((pose) => [gnome(hat, pose, 1), gnome(hat, pose, 2)])),
    rake: spr(bitmap(RAKE, PAL), 3, RAKE.length),
    rakeLeft: mirror(spr(bitmap(RAKE, PAL), 3, RAKE.length)),
    basket: outlined(bitmap(BASKET, PAL), INK),
    barrow: outlined(bitmap(BARROW, PAL), INK),
    barrowLeft: flipped(outlined(bitmap(BARROW, PAL), INK)),
    saw: LOOKS.map((grade) => [0, 1, 2].map((s) => saw(s, grade))),
    kiln: LOOKS.map((grade) => [0, 1, 2, 3].map((s) => kiln(s, grade))),
    press: LOOKS.map((grade) => [0, 1, 2].map((s) => press(s, grade))),
    bench: LOOKS.map((grade) => [0, 1, 2].map((s) => bench(s, grade))),
    workshop: LOOKS.map((grade) => [false, true].map((lit) => [0, 1].map((s) => workshop(lit, s, grade)))),
    study: LOOKS.map((grade) => [0, 1, 2, 3, 4].map((state) => study(state, grade))),
    stop: [0, 1, 2, 3, 4].map(stop),
    pylon: [false, true].map((tall) => [0, 1, 2].map((l) => pylon(tall, l))),
    wheel: [0, 1, 2, 3].map(wheel),
    boiler: [0, 1, 2].map(boiler),
    hood: [...LOOKS, 4].map((grade) => [0, 1, 2, 3].map((side) => hood(side, grade))),
    splitter: eachWay(SPLITTER),
    joiner: eachWay(JOINER),
    heads: HEADS.map(([top, foot]) =>
      eachWay(SPLITTER.map((row, y) => (y >= top && y <= foot ? row : ".".repeat(16)))),
    ),
    vane: [0, 1, 2, 3].map(vane),
    pointer: [0, 1, 2, 3].map((d) => pointer(d, false)),
    pointerLit: [0, 1, 2, 3].map((d) => pointer(d, true)),
    crate: [false, true].map((big) => [false, true].map((open) => crate(big, open))),
    depot: depot(),
    fly: [0, 1, 2, 3].map((s) => outlined(wheelPic(s, GOLD[1], GOLD[0], GOLD[0], CREAM, DEPOT.wheelR), INK)),
    flag: [0, 1].map(flag),
    pennant: [0, 1, 2, 3].map((side) => pennant(side === 2)),
    gate: gate(),
    fenceAcross: fence(true),
    fenceDown: fence(false),
    pips: [1, 2, 3].map(pips),
    tilePips: [1, 2, 3].map((count) => {
      const { c, g } = makeCanvas(16, 16);
      g.drawImage(pips(count), 0, 0);
      return c;
    }),
  };
}
