/**
 * Small tools for hand-placed sprites: frames that know where their feet are, row edits for poses
 * that share most of their pixels, the confetti a happy spirit explodes into, and chalk digits.
 */

import { ix, R } from "../pixel/palette.ts";
import { fromRows, type Sprite, sprite } from "../pixel/raster.ts";
import { C } from "./palette-cast.ts";

/**
 * One frame of an animation. `ax, ay` is the pixel that stands on the ground point (the middle of the
 * feet), so frames of different sizes line up: draw at `(x - ax, y - ay)`. `ms` is how long it holds.
 */
export interface Frame {
  readonly sprite: Sprite;
  readonly ms: number;
  readonly ax: number;
  readonly ay: number;
}

export type Legend = Readonly<Record<string, number>>;

/** `fromRows`, refusing ragged rows: a short row would shift every pixel after it without a sound. */
export function art(rows: readonly string[], legend: Legend): Sprite {
  const w = rows[0]?.length ?? 0;
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`row ${y} is ${row.length} wide, not ${w}: ${row}`);
  });
  return fromRows(rows, legend);
}

/** A frame anchored at its bottom middle, raised `lift` pixels (a hop) if asked. */
export function frame(s: Sprite, ms: number, lift = 0, ax = Math.floor(s.w / 2)): Frame {
  return { sprite: s, ms, ax, ay: s.h - 1 + lift };
}

/** The frame showing at `ms` into a loop of frames. */
export function frameAt(frames: readonly Frame[], ms: number): Frame {
  const total = frames.reduce((sum, f) => sum + f.ms, 0);
  let u = ((ms % total) + total) % total;
  for (const f of frames) {
    if (u < f.ms) return f;
    u -= f.ms;
  }
  const last = frames[frames.length - 1];
  if (!last) throw new Error("no frames");
  return last;
}

/** Rows with some replaced, as the welcome sprites' `variant`: poses only list what changes. */
export function edit(rows: readonly string[], changes: Readonly<Record<number, string>>): string[] {
  return rows.map((row, y) => changes[y] ?? row);
}

/** Rows with characters swapped, for a blink or a recolour that moves no pixel. */
export function swap(rows: readonly string[], pairs: Readonly<Record<string, string>>): string[] {
  return rows.map((row) =>
    row
      .split("")
      .map((ch) => pairs[ch] ?? ch)
      .join(""),
  );
}

/** Rows shifted down by `n` (blank rows on top, the bottom ones dropped), for a squash or a dip. */
export function lower(rows: readonly string[], n: number): string[] {
  const w = Math.max(...rows.map((r) => r.length));
  return [...Array.from({ length: n }, () => ".".repeat(w)), ...rows.slice(0, rows.length - n)];
}

/** `top` laid over `base` at (x, y), in a sprite grown to hold both. Returns where `base` landed. */
export function over(base: Sprite, top: Sprite, x: number, y: number): { sprite: Sprite; bx: number; by: number } {
  const x0 = Math.min(0, x);
  const y0 = Math.min(0, y);
  const w = Math.max(base.w, x + top.w) - x0;
  const h = Math.max(base.h, y + top.h) - y0;
  const out = sprite(w, h);
  const put = (s: Sprite, ox: number, oy: number): void => {
    for (let sy = 0; sy < s.h; sy++) {
      for (let sx = 0; sx < s.w; sx++) {
        const v = s.data[sy * s.w + sx] ?? 0;
        if (!v) continue;
        const i = (oy + sy) * w + ox + sx;
        out.data[i] = v;
      }
    }
  };
  put(base, -x0, -y0);
  put(top, x - x0, y - y0);
  return { sprite: out, bx: -x0, by: -y0 };
}

/** `top` drawn behind `base` instead of over it. */
export function under(base: Sprite, top: Sprite, x: number, y: number): { sprite: Sprite; bx: number; by: number } {
  const laid = over(top, base, -x, -y);
  return { sprite: laid.sprite, bx: laid.bx - x, by: laid.by - y };
}

// ---------------------------------------------------------------------------------------------
// Confetti. Spirits "explode affectionately": a pomf of cloud and a fling of paper bits, hand-placed
// so no two bits sit evenly round the body. `+` marks the burst's centre and is not drawn.

const CONFETTI: Legend = {
  g: ix(C.GOLD, 6),
  G: ix(R.GLOW, 6),
  W: ix(R.GLOW, 7),
  r: ix(R.ROSE, 5),
  R: ix(R.ROSE, 3),
  t: ix(C.TEAL, 6),
  v: ix(C.VIOLET, 6),
  s: ix(C.SAGE, 6),
  c: ix(R.CREAM, 6),
  o: ix(R.CRAB, 6),
  p: ix(C.PEARL, 6),
  P: ix(C.PEARL, 7),
  q: ix(C.PEARL, 4),
};

/** The pop: a pomf of cloud at the sides, a starburst and bits flung up close. */
const POP = [
  "..............W............",
  ".......g......G......t.....",
  "...........r.......o.......",
  "....t....................v.",
  "........s...........g......",
  "..W........................",
  "...........................",
  ".............+.............",
  "...........................",
  "...........................",
  "pPp.....................pP.",
  "qpPp...................pPPq",
  ".qqp....................qq.",
];

/** The fling: bits wider and tumbling down, a few caught mid-turn as two-pixel strips. */
const FLING = [
  "............g................",
  "....r..............t.........",
  "........v......W.............",
  "gg..................rr.......",
  "..............+.............o",
  ".......c.....................",
  ".t..................s........",
  "........................g....",
  "..o..........................",
  "............................v",
  "r....g.......................",
  ".......................t.....",
];

const POP_SPRITE = fromRows(
  POP.map((r) => r.replace("+", ".")),
  CONFETTI,
);
const FLING_SPRITE = fromRows(
  FLING.map((r) => r.replace("+", ".")),
  CONFETTI,
);

function centre(rows: readonly string[]): { x: number; y: number } {
  const y = rows.findIndex((r) => r.includes("+"));
  return { x: rows[y]?.indexOf("+") ?? 0, y };
}

/**
 * A happy pose with the confetti burst laid over it, its centre at (`cx`, `cy`) in the pose. The
 * frame keeps the pose's ground point.
 */
export function explode(pose: Sprite, kind: "pop" | "fling", cx: number, cy: number, ms: number, lift = 0): Frame {
  const rows = kind === "pop" ? POP : FLING;
  const puff = kind === "pop" ? POP_SPRITE : FLING_SPRITE;
  const c = centre(rows);
  // The confetti goes behind the spirit so a bit never sits on its face.
  const laid = under(pose, puff, cx - c.x, cy - c.y);
  return { sprite: laid.sprite, ms, ax: laid.bx + Math.floor(pose.w / 2), ay: laid.by + pose.h - 1 + lift };
}

// ---------------------------------------------------------------------------------------------
// Chalk digits, 3 by 5, for the numbered crabs. `x` is a firm stroke, `y` a lighter one where the
// chalk skipped, so a number looks written, not stamped.

const DIGITS: readonly (readonly string[])[] = [
  ["xxy", "x.x", "x.x", "x.x", "yxx"],
  [".x.", "xx.", ".x.", ".x.", "xxy"],
  ["xxy", "..x", "yx.", "x..", "xxx"],
  ["xxy", "..x", ".xx", "..x", "yxx"],
  ["x.x", "x.x", "yxx", "..x", "..x"],
  ["xxx", "x..", "xxy", "..x", "xx."],
  [".xy", "x..", "xxy", "x.x", "yx."],
  ["xxx", "..x", ".y.", ".x.", ".x."],
  ["yx.", "x.x", ".x.", "x.x", ".xy"],
  [".xy", "x.x", "yxx", "..x", "xx."],
];

/** The rows of a chalked number, digits a pixel apart, in `firm` and `light` characters. */
export function chalk(n: number, firm = "x", light = "y"): string[] {
  const digits = String(Math.max(0, Math.floor(n)))
    .split("")
    .map((d) => DIGITS[Number(d)] ?? DIGITS[0] ?? []);
  return Array.from({ length: 5 }, (_, y) =>
    digits
      .map((d) => d[y] ?? "...")
      .join(".")
      .replaceAll("x", firm)
      .replaceAll("y", light),
  );
}

/** Writes `stamp` rows into `rows` at (x, y); "." in the stamp leaves the pixel below. */
export function stamp(rows: readonly string[], add: readonly string[], x: number, y: number): string[] {
  return rows.map((row, ry) => {
    const s = add[ry - y];
    if (s === undefined) return row;
    const chars = row.split("");
    s.split("").forEach((ch, i) => {
      if (ch !== "." && x + i >= 0) chars[x + i] = ch;
    });
    return chars.join("");
  });
}
