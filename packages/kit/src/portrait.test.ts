import { describe, expect, test } from "bun:test";

import { CREAM, INK } from "./palette.ts";
import { rgb } from "./pix.ts";
import {
  CREASE,
  draw,
  type Drawn,
  figure,
  FRONT,
  HEAD_SHADE,
  mirrored,
  mix,
  paintFigure,
  POSES,
  readSkin,
  type SheetPixels,
  SIDE,
  SIDE_SHADE,
  TOP_LIGHT,
  UP,
} from "./portrait.ts";
import { fitName, gleam, GLEAM_LAP, roundFrame, smallWidth, twinkle } from "./pullart.ts";

/** Whether a sheet pixel belongs to the base layer of a 64x64 sheet (the outer layers are elsewhere). */
const isBase = (x: number, y: number): boolean =>
  (y < 16 && x < 32) || (y >= 16 && y < 32 && x < 56) || (y >= 48 && x >= 16 && x < 48);

interface Made {
  hat?: "clear" | "solid" | "some";
  slim?: boolean;
  tall?: number;
}

/** A sheet where every base pixel has a colour of its own (red and green say where it is), outer layers as asked. */
function sheet(o: Made = {}): SheetPixels {
  const tall = o.tall ?? 64;
  const data = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < tall; y++)
    for (let x = 0; x < 64; x++) {
      const hat = y < 16 && x >= 32;
      let on = isBase(x, y);
      if (hat) on = o.hat === "solid" || (o.hat === "some" && !(x === 63 && y === 15) && x >= 40 && x < 48 && y >= 8);
      if (o.slim && x >= 54 && x < 56 && y >= 20 && y < 32) on = false;
      if (!on) continue;
      const i = (y * 64 + x) * 4;
      data[i] = x * 4;
      data[i + 1] = y * 4;
      data[i + 2] = hat ? 200 : 100;
      data[i + 3] = 255;
    }
  return { data, tall };
}

const xy = (spot: number): [number, number] => [spot % 64, Math.floor(spot / 64)];
/** Widths of a line in the font: six pixels a letter regular, seven bold, as the font roughly is. */
const measure = (text: string, bold: boolean): number => text.length * (bold ? 7 : 6);
/** The colour the test sheet gives a base pixel. */
const sheetRgb = (spot: number): [number, number, number] => [xy(spot)[0] * 4, xy(spot)[1] * 4, 100];

/** The pixels of a drawing whose sheet pixel lies in a rectangle of the sheet, facing one way. */
function where(
  d: Drawn,
  look: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): { x: number; y: number; spot: number }[] {
  const out: { x: number; y: number; spot: number }[] = [];
  for (let y = 0; y < d.h; y++)
    for (let x = 0; x < d.w; x++) {
      const i = y * d.w + x;
      const spot = d.spot[i] ?? -1;
      if (spot < 0 || d.look[i] !== look) continue;
      const [px, py] = xy(spot);
      if (px >= sx && px < sx + sw && py >= sy && py < sy + sh) out.push({ x, y, spot });
    }
  return out;
}

function box(ps: { x: number; y: number }[]): { x0: number; y0: number; x1: number; y1: number; w: number; h: number } {
  const x0 = Math.min(...ps.map((p) => p.x));
  const x1 = Math.max(...ps.map((p) => p.x));
  const y0 = Math.min(...ps.map((p) => p.y));
  const y1 = Math.max(...ps.map((p) => p.y));
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const colourAt = (data: Uint8ClampedArray, w: number, x: number, y: number): number[] =>
  Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

describe("reading a sheet", () => {
  test("the hat layer is skipped when it is a solid block, and kept when any of it is clear", () => {
    expect(readSkin(sheet({ hat: "solid" })).hat).toBe(false);
    expect(readSkin(sheet({ hat: "some" })).hat).toBe(true);
    const d = draw(readSkin(sheet({ hat: "solid" })), 4, "stand");
    expect([...d.spot].filter((s) => s >= 0 && xy(s)[0] >= 32 && xy(s)[1] < 16)).toEqual([]);
  });

  test("arms are slim when the back strip of a four-wide arm is clear, and old sheets never are", () => {
    expect(readSkin(sheet({ slim: true })).slim).toBe(true);
    expect(readSkin(sheet()).slim).toBe(false);
    expect(readSkin(sheet({ tall: 32 })).slim).toBe(false);
  });
});

describe("the boxes", () => {
  const skin = readSkin(sheet());

  test("a head's front, side and top come from the right places on the sheet, and meet", () => {
    const s = 4;
    const d = draw(skin, s, "stand");
    const front = where(d, FRONT, 8, 8, 8, 8);
    const f = box(front);
    expect([f.w, f.h, front.length]).toEqual([8 * s, 8 * s, 64 * s * s]);
    for (const p of front)
      expect(xy(p.spot)).toEqual([8 + Math.floor((p.x - f.x0) / s), 8 + Math.floor((p.y - f.y0) / s)]);

    // The side: the figure's left (16..23 on the sheet), half as wide as the head is deep, its
    // first column against the front and rising one pixel for every two across.
    const side = where(d, SIDE, 16, 8, 8, 8);
    const sd = box(side);
    expect(sd.w).toBe(4 * s);
    expect(sd.x0).toBe(f.x1 + 1);
    for (let c = 0; c < sd.w; c++) {
      const col = side.filter((p) => p.x === sd.x0 + c);
      expect(Math.min(...col.map((p) => p.y))).toBe(f.y0 - Math.floor(c / 2));
      for (const p of col) expect(xy(p.spot)[0]).toBe(16 + Math.floor((c * 2) / s));
    }

    // The top: as tall as the side rises, its row nearest the front (sheet row 7) on the front.
    const top = where(d, UP, 8, 0, 8, 8);
    const tp = box(top);
    expect(tp.h).toBe(2 * s);
    expect(tp.y1).toBe(f.y0 - 1);
    expect(top.length).toBe(8 * s * 2 * s);
    for (const p of top.filter((q) => q.y === tp.y1)) expect(xy(p.spot)[1]).toBe(7);
    for (const p of top.filter((q) => q.y === tp.y0)) expect(xy(p.spot)[1]).toBe(0);
    // Each row of the top slides two across from the one under it.
    const startOf = (y: number): number => Math.min(...top.filter((q) => q.y === y).map((q) => q.x));
    for (let y = tp.y0; y < tp.y1; y++) expect(startOf(y) - startOf(y + 1)).toBe(2);
    expect(startOf(tp.y1)).toBe(f.x0 + 2);
  });

  test("the side is half as wide as the box is deep at every size", () => {
    for (let s = 1; s <= 8; s++) {
      const d = draw(skin, s, "stand");
      expect(box(where(d, SIDE, 16, 8, 8, 8)).w).toBe(4 * s);
      // The near arm is the figure's left arm: its left side is at 40..43, rows 52..63.
      expect(box(where(d, SIDE, 40, 52, 4, 12)).w).toBe(2 * s);
      // Every face front pixel is shown: a head front is whole at every size.
      expect(where(d, FRONT, 8, 8, 8, 8).length).toBe(64 * s * s);
    }
  });

  test("slim arms are three wide, others four", () => {
    for (const s of [2, 3, 5]) {
      expect(box(where(draw(readSkin(sheet({ slim: true })), s, "stand"), FRONT, 36, 52, 3, 12)).w).toBe(3 * s);
      expect(box(where(draw(skin, s, "stand"), FRONT, 36, 52, 4, 12)).w).toBe(4 * s);
    }
  });

  test("an old 64x32 sheet's left arm is its right arm mirrored", () => {
    const d = draw(readSkin(sheet({ tall: 32 })), 2, "stand");
    const arms = where(d, FRONT, 44, 20, 4, 12);
    const f = box(where(d, FRONT, 8, 8, 8, 8));
    const near = arms.filter((p) => p.x > f.x1);
    const nb = box(near);
    // Mirrored: its leftmost column shows the right arm's rightmost.
    for (const p of near.filter((q) => q.x === nb.x0)) expect(xy(p.spot)[0]).toBe(47);
    for (const p of near.filter((q) => q.x === nb.x1)) expect(xy(p.spot)[0]).toBe(44);
  });

  test("the hat stands one pixel proud from s 3, and lies flat below that", () => {
    const hatted = readSkin(sheet({ hat: "some" }));
    for (const s of [1, 2, 3, 5]) {
      const d = draw(hatted, s, "stand");
      const head = box(where(d, FRONT, 8, 8, 8, 8).concat(where(d, FRONT, 40, 8, 8, 8)));
      const hat = box(where(d, FRONT, 40, 8, 8, 8));
      const proud = s >= 3 ? 1 : 0;
      expect([hat.w, hat.h]).toEqual([8 * s + 2 * proud, 8 * s + 2 * proud]);
      expect(head.w).toBe(8 * s + 2 * proud);
    }
  });

  test("raised arms put their hands over the head; sitting puts the soles to the front; a bust has no legs", () => {
    for (const s of [2, 3, 5]) {
      const top = (d: Drawn, sx: number, sy: number, sw: number, sh: number): number =>
        Math.min(...[FRONT, UP, SIDE].flatMap((l) => where(d, l, sx, sy, sw, sh)).map((p) => p.y));
      const wave = draw(skin, s, "wave");
      expect(top(wave, 32, 48, 16, 16)).toBeLessThan(top(wave, 0, 0, 32, 16));
      const cheer = draw(skin, s, "cheer");
      expect(top(cheer, 40, 16, 16, 16)).toBeLessThan(top(cheer, 0, 0, 32, 16));
      // A raised hand's bottom is what faces up.
      expect(where(wave, UP, 40, 48, 4, 4).length).toBeGreaterThan(0);

      const stand = draw(skin, s, "stand");
      const sit = draw(skin, s, "sit");
      expect(sit.h).toBeLessThan(stand.h);
      // The soles (the legs' bottoms) face us; the fronts of the legs face up.
      expect(where(sit, FRONT, 8, 16, 4, 4).length).toBe(16 * s * s);
      expect(where(sit, UP, 4, 20, 4, 12).length).toBeGreaterThan(0);

      const bust = draw(skin, s, "bust");
      expect(where(bust, FRONT, 4, 20, 4, 12).length + where(bust, FRONT, 20, 52, 4, 12).length).toBe(0);
      // The body down to five rows under the shoulders.
      const rows = where(bust, FRONT, 20, 20, 8, 12).map((p) => xy(p.spot)[1]);
      expect(Math.max(...rows)).toBe(24);
    }
  });
});

describe("colouring", () => {
  const skin = readSkin(sheet());
  const ink = rgb(INK);
  const cream = rgb(CREAM);

  test("fronts as the sheet has them, tops lighter, sides darker, the head's shadow under it", () => {
    const s = 4;
    const d = draw(skin, s, "stand");
    const p = paintFigure(skin, d);
    const check = (px: { x: number; y: number; spot: number }, want: readonly number[]): void =>
      expect(colourAt(p.data, p.w, px.x, px.y)).toEqual([...want, 255]);
    for (const px of where(d, FRONT, 8, 8, 8, 8)) check(px, sheetRgb(px.spot));
    for (const px of where(d, UP, 8, 0, 8, 8)) check(px, mix(sheetRgb(px.spot), cream, TOP_LIGHT));
    for (const px of where(d, SIDE, 16, 8, 8, 8)) check(px, mix(sheetRgb(px.spot), ink, SIDE_SHADE));
    // The top two rows of the chest, where nothing else covers them.
    const chest = where(d, FRONT, 21, 20, 6, 12);
    const rows = (y: number): typeof chest => chest.filter((q) => xy(q.spot)[1] === y);
    expect(rows(21).length).toBeGreaterThan(0);
    for (const px of [...rows(20), ...rows(21)]) check(px, mix(sheetRgb(px.spot), ink, HEAD_SHADE));
    for (const px of rows(22)) check(px, sheetRgb(px.spot));
    // The top of the near shoulder: lit as a top, then shaded by the head.
    for (const px of where(d, UP, 36, 48, 4, 4))
      check(px, mix(mix(sheetRgb(px.spot), cream, TOP_LIGHT), ink, HEAD_SHADE));
  });

  test("where the far arm meets the body, the arm's last column is a crease", () => {
    const s = 3;
    const d = draw(skin, s, "stand");
    const p = paintFigure(skin, d);
    const arm = where(d, FRONT, 44, 20, 4, 12);
    const edge = box(arm).x1;
    const px = arm.find((q) => q.x === edge && xy(q.spot)[1] === 28);
    expect(px).toBeDefined();
    if (px)
      expect(colourAt(p.data, p.w, px.x, px.y)).toEqual([...mix([xy(px.spot)[0] * 4, 28 * 4, 100], ink, CREASE), 255]);
  });

  test("the edge is one ink pixel all round, and the picture is exactly the figure and its edge", () => {
    for (const pose of POSES)
      for (const s of [1, 2, 3, 5, 8]) {
        const d = draw(skin, s, pose);
        const p = paintFigure(skin, d);
        const inside = (x: number, y: number): boolean =>
          x >= 0 && y >= 0 && x < d.w && y < d.h && (d.spot[y * d.w + x] ?? -1) >= 0;
        let edge = 0;
        for (let y = 0; y < p.h; y++)
          for (let x = 0; x < p.w; x++) {
            if (inside(x, y)) continue;
            const c = colourAt(p.data, p.w, x, y);
            if (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1)) {
              expect(c).toEqual([...ink, 255]);
              edge++;
            } else expect(c[3]).toBe(0);
          }
        expect(edge).toBeGreaterThan(0);
        const all: { x: number; y: number }[] = [];
        for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) if (inside(x, y)) all.push({ x, y });
        expect(box(all)).toMatchObject({ x0: 1, y0: 1, x1: p.w - 2, y1: p.h - 2 });
      }
  });

  test("the rim of light falls only on pixels with nothing to their left or above", () => {
    const d = draw(skin, 4, "stand");
    const plain = paintFigure(skin, d);
    const lit = paintFigure(skin, d, { colour: "#ffd98a", amount: 0.35 });
    const inside = (x: number, y: number): boolean => (d.spot[y * d.w + x] ?? -1) >= 0;
    let rimmed = 0;
    for (let y = 1; y < d.h - 1; y++)
      for (let x = 1; x < d.w - 1; x++) {
        if (!inside(x, y)) continue;
        const was = colourAt(plain.data, plain.w, x, y);
        const now = colourAt(lit.data, lit.w, x, y);
        if (!inside(x - 1, y) || !inside(x, y - 1)) {
          expect(now).toEqual([...mix([was[0] ?? 0, was[1] ?? 0, was[2] ?? 0], rgb("#ffd98a"), 0.35), 255]);
          rimmed++;
        } else expect(now).toEqual(was);
      }
    expect(rimmed).toBeGreaterThan(0);
  });

  test("flip mirrors the finished picture", () => {
    const a = figure(skin, { s: 3, pose: "wave" });
    const b = figure(skin, { s: 3, pose: "wave", flip: true });
    expect(b.data).toEqual(mirrored(a).data);
    expect([b.w, b.h]).toEqual([a.w, a.h]);
  });
});

describe("cards", () => {
  test("the gleam runs once round the frame each lap, a bright head with a short tail behind it", () => {
    const n = 300;
    expect(gleam(0, 0, n)).toBe(2);
    expect(gleam(0, 0.5, n)).toBe(0);
    expect(gleam(GLEAM_LAP / 2, 0.5, n)).toBe(2);
    expect(gleam(GLEAM_LAP / 2, 0.5 - 6 / n, n)).toBe(1);
    expect(gleam(GLEAM_LAP / 2, 0.5 + 6 / n, n)).toBe(0);
    expect(gleam(GLEAM_LAP * 3 + 0.4, 0.2, n)).toBe(gleam(0.4, 0.2, n));
  });

  test("the way round the frame goes clockwise from the top left corner", () => {
    expect(roundFrame(0, 0, 0)).toBe(0);
    expect(roundFrame(63, 0, 0)).toBeCloseTo(63 / 300);
    expect(roundFrame(63, 87, 0)).toBeCloseTo(150 / 300);
    expect(roundFrame(0, 87, 0)).toBeCloseTo(213 / 300);
    expect(roundFrame(0, 1, 0)).toBeCloseTo(299 / 300);
  });

  test("stars twinkle between dark and bright, each in its own time", () => {
    const seen = Array.from({ length: 200 }, (_, i) => twinkle(i / 10, 3));
    expect(Math.min(...seen)).toBeLessThan(0.05);
    expect(Math.max(...seen)).toBeGreaterThan(0.95);
    expect(twinkle(1, 0)).not.toBe(twinkle(1, 1));
  });

  test("a name is kept whole: bold if it fits, else regular, else small capitals, and only then cut", () => {
    expect(fitName("Mossling", 59, measure)).toEqual({ text: "Mossling", how: "bold" });
    expect(fitName("Kestrelle", 59, measure)).toEqual({ text: "Kestrelle", how: "regular" });
    expect(fitName("Pebblesworth_7", 59, measure)).toEqual({ text: "Pebblesworth_7", how: "small" });
    const cut = fitName("xX_Sixteen_Names", 59, measure);
    expect(cut.how).toBe("small");
    expect(cut.text.endsWith(".")).toBe(true);
    expect(smallWidth(cut.text)).toBeLessThanOrEqual(59);
  });

  test("small capitals are three pixels a letter, a little wider for M, N and W", () => {
    expect(smallWidth("OWNER")).toBe(3 + 5 + 4 + 3 + 3 + 4);
    expect(smallWidth("captain")).toBe(3 * 6 + 4 + 6);
  });
});
