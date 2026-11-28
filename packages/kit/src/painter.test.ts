/**
 * The painter (`painter.ts`) on a stand-in graphics card (`standin-gl.ts`), which writes down what it
 * is asked: the order boxes are drawn in and where a batch ends, pictures copied to the atlas once,
 * the atlas started again when full, layers, and the card taking everything back and returning.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { Painter } from "./painter.ts";
import { scope } from "./scope.ts";
import { FakeCard, standInCanvases } from "./standin-gl.ts";
import { must } from "./util.ts";

const card = new FakeCard();
const away = { take: (): void => undefined };
beforeAll(() => {
  away.take = standInCanvases(card);
});
afterAll(() => away.take());

/** A canvas of a size, as the art code makes one. */
function pic(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** A painter on a canvas of 200 by 100, with nothing drawn or copied written down yet. */
function open(): Painter {
  const p = must(Painter.open(pic(200, 100), scope()), "painter");
  card.clear();
  return p;
}

describe("the painter", () => {
  test("where the browser has no WebGL2 there is no painter", () => {
    card.has = false;
    expect(Painter.open(pic(10, 10), scope())).toBeNull();
    card.has = true;
  });

  test("a card that hands over a context and then will not compile or link the program is no card: no painter opens", () => {
    for (const refuses of ["compile", "link"] as const) {
      card.refuses = refuses;
      expect(Painter.open(pic(10, 10), scope())).toBeNull();
    }
    card.refuses = null;
    expect(Painter.open(pic(10, 10), scope())).not.toBeNull();
  });

  test("a card that comes back refusing the program stays lost: nothing is drawn again, and whoever asked is told", () => {
    for (const refuses of ["compile", "link"] as const) {
      const p = open();
      const a = pic(16, 16);
      const told = { restored: 0, broken: 0 };
      p.restored(() => void told.restored++);
      p.broken(() => void told.broken++);
      card.lose();
      card.refuses = refuses;
      card.restore();
      card.refuses = null;
      card.clear();
      expect([p.lost, p.begin(null), told.restored, told.broken]).toEqual([true, false, 0, 1]);
      p.pic(a, 0, 0);
      p.rect(0, 0, 4, 4, "#ffffff");
      p.end();
      expect([card.batches.length, card.copied.length]).toEqual([0, 0]);
    }
  });

  test("draws boxes in the order asked, in one batch while nothing but the boxes changes", () => {
    const p = open();
    const [a, b] = [pic(16, 16), pic(8, 24)];
    p.begin("#102030");
    p.pic(a, 10, 20);
    p.rect(0, 0, 5, 5, "#ff0000", 0.5);
    p.pic(b, 30, 40, 0.5);
    p.pic(a, 50, 60);
    p.end();
    expect(card.batches.length).toBe(1);
    const boxes = card.batches[0]?.boxes ?? [];
    expect(boxes.map((box) => [box.x, box.y, box.w, box.h])).toEqual([
      [10, 20, 16, 16],
      [0, 0, 5, 5],
      [30, 40, 8, 24],
      [50, 60, 16, 16],
    ]);
    // A flat colour is the atlas's white pixel, tinted with the colour multiplied by how solid it is.
    expect([boxes[1]?.sx, boxes[1]?.sy, boxes[1]?.sw, boxes[1]?.sh]).toEqual([0, 0, 1, 1]);
    expect(boxes[1]?.tint.map((v) => Math.round(v * 100) / 100)).toEqual([0.5, 0, 0, 0.5]);
    expect(boxes[2]?.tint.map((v) => Math.round(v * 100) / 100)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  test("copies a picture to the atlas once, and draws it from where it was copied", () => {
    const p = open();
    const a = pic(16, 16);
    p.begin(null);
    p.pic(a, 0, 0);
    p.pic(a, 20, 0);
    p.part(a, 4, 2, 8, 6, 40, 0);
    p.end();
    const copies = card.copied.filter((c) => c.pic === a);
    expect(copies.length).toBe(1);
    const at = must(copies[0], "copy");
    const boxes = card.batches.flatMap((b) => b.boxes);
    expect(boxes.map((box) => [box.sx, box.sy, box.sw, box.sh])).toEqual([
      [at.x, at.y, 16, 16],
      [at.x, at.y, 16, 16],
      [at.x + 4, at.y + 2, 8, 6],
    ]);
    // Not on the white pixel in the atlas's corner.
    expect(at.x + at.y).toBeGreaterThan(0);
  });

  test("ends a batch where the texture, the blending, the round mask or the picture drawn on changes, and nowhere else", () => {
    const p = open();
    const a = pic(16, 16);
    const sheet = p.sheet(64, 64);
    const layer = p.layer();
    p.begin(null);
    p.pic(a, 0, 0);
    p.from(sheet, 0, 0, 64, 64, 0, 0);
    p.pic(a, 1, 0);
    p.blend("add");
    p.pic(a, 2, 0);
    p.blend("add");
    p.pic(a, 3, 0);
    p.blend("over");
    p.disc(5, 5, 3);
    p.pic(a, 4, 0);
    p.disc();
    layer.begin(32, 32);
    p.pic(a, 5, 0);
    layer.end();
    p.from(layer, 0, 0, 32, 32, 6, 0);
    p.end();
    const atlas = must(
      card.copied.find((c) => c.pic === a),
      "copy",
    ).onto;
    expect(
      card.batches.map((b) => [
        b.from === atlas ? "atlas" : "other",
        b.onto === null,
        b.blend,
        b.boxes.map((x) => x.x),
      ]),
    ).toEqual([
      ["atlas", true, "ONE ONE_MINUS_SRC_ALPHA", [0]],
      ["other", true, "ONE ONE_MINUS_SRC_ALPHA", [0]],
      ["atlas", true, "ONE ONE_MINUS_SRC_ALPHA", [1]],
      ["atlas", true, "ONE ONE", [2, 3]],
      ["atlas", true, "ONE ONE_MINUS_SRC_ALPHA", [4]],
      ["atlas", false, "ONE ONE_MINUS_SRC_ALPHA", [5]],
      ["other", true, "ONE ONE_MINUS_SRC_ALPHA", [6]],
    ]);
    expect(card.batches[4]?.disc).toEqual([5, 5, 3]);
    expect(card.batches[5]?.disc).toEqual([0, 0, -1]);
    // The layer's picture is drawn from the texture that was drawn onto.
    const drawnOn = card.batches[5]?.onto ?? -1;
    expect(card.batches[6]?.from).toBe(drawnOn);
    // Let go of, its texture is given back; begun again, it has one of that size again.
    expect(card.textures.has(drawnOn)).toBe(true);
    layer.release();
    expect(card.textures.has(drawnOn)).toBe(false);
    card.clear();
    layer.begin(32, 16);
    p.pic(a, 0, 0);
    layer.end();
    const again = must(card.textures.get(card.batches[0]?.onto ?? -1), "the layer's texture");
    expect([again.w, again.h]).toEqual([32, 16]);
  });

  test("starts the atlas again, larger, when it is full: what was gathered is drawn first, and every picture is copied again when next drawn", () => {
    const p = open();
    const first = pic(600, 600);
    const second = pic(600, 600);
    p.begin(null);
    p.pic(first, 0, 0);
    expect(p.atlas).toEqual({ size: 1024, pictures: 2, turns: 0 });
    // No room beside the first on an atlas of 1,024: it starts again at 2,048.
    p.pic(second, 1, 0);
    expect(p.atlas).toEqual({ size: 2048, pictures: 2, turns: 1 });
    p.pic(first, 2, 0);
    p.end();
    // The first was drawn, from the old atlas, before that was let go of.
    expect(card.batches.map((b) => b.boxes.map((x) => x.x))).toEqual([[0], [1, 2]]);
    expect(card.batches[0]?.from).not.toBe(card.batches[1]?.from ?? -1);
    expect(card.copied.filter((c) => c.pic === first).length).toBe(2);
    const atlas = must(card.textures.get(card.batches[1]?.from ?? -1), "atlas");
    expect([atlas.w, atlas.h]).toEqual([2048, 2048]);
  });

  test("draws nothing while the card is lost, and when it returns makes everything again and tells who keeps sheets", () => {
    const p = open();
    const a = pic(16, 16);
    const sheet = p.sheet(64, 64);
    sheet.put(pic(64, 64), 0, 0);
    const told = { times: 0 };
    p.restored(() => void told.times++);
    p.begin(null);
    p.pic(a, 0, 0);
    p.end();
    const programs = card.programs;
    card.lose();
    card.clear();
    expect(p.lost).toBe(true);
    expect(p.begin(null)).toBe(false);
    p.pic(a, 0, 0);
    p.end();
    expect([card.batches.length, card.copied.length]).toEqual([0, 0]);
    card.restore();
    // Every painter on the card makes its program again: this one too.
    expect([p.lost, told.times, card.programs > programs]).toEqual([false, 1, true]);
    expect(p.begin(null)).toBe(true);
    p.pic(a, 0, 0);
    p.from(sheet, 0, 0, 64, 64, 0, 0);
    p.end();
    // The picture is copied to the new atlas, and the sheet has a texture again, empty until its owner paints it.
    expect(card.copied.filter((c) => c.pic === a).length).toBe(1);
    expect(card.batches.length).toBe(2);
    for (const b of card.batches) expect(card.textures.has(b.from)).toBe(true);
    const tex = must(card.textures.get(card.batches[1]?.from ?? -1), "sheet");
    expect([tex.w, tex.h]).toEqual([64, 64]);
  });
});
