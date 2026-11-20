import { describe, expect, test } from "bun:test";

import { maskOf } from "../src/bundle/art.ts";
import { Compositor, lzw, parseGif, rgba } from "../src/bundle/gif.ts";
import { Loop } from "../src/bundle/loop.ts";
import { Picture } from "../src/bundle/picture.ts";
import { readPng } from "./png.ts";

/**
 * A real bundle loop (`glade/L01-v1-normal-dusk.gif`) and frames of it that ImageMagick composited
 * (`magick loop.gif -coalesce`), saved as PNG.
 */
const fixture = (name: string): Promise<Uint8Array> => Bun.file(new URL(`fixtures/${name}`, import.meta.url)).bytes();
const LOOP = "L01-v1-normal-dusk.gif";
const reference = async (frame: number): Promise<Uint32Array> =>
  readPng(await fixture(`L01-v1-normal-dusk-${String(frame).padStart(3, "0")}.png`)).pixels;

/** How many pixels of two frames differ. */
const differing = (a: Uint32Array, b: Uint32Array): number => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

describe("the GIF decoder", () => {
  test("reads a bundle loop's structure: 160 frames of 256x144 at 100 ms, each a changed rectangle", async () => {
    const gif = parseGif(await fixture(LOOP));
    expect(gif.width).toBe(256);
    expect(gif.height).toBe(144);
    expect(gif.frames).toHaveLength(160);
    expect(gif.frames.every((f) => f.delay === 100)).toBe(true);
    const [first, second] = gif.frames;
    expect(first).toMatchObject({ x: 0, y: 0, w: 256, h: 144, transparent: -1 });
    expect(second?.transparent).toBeGreaterThanOrEqual(0);
    expect(gif.frames.slice(1).every((f) => f.disposal === 1 && f.w * f.h < 256 * 144)).toBe(true);
  });

  test.each([0, 1, 90, 159])("composites frame %i exactly as ImageMagick does", async (frame) => {
    const comp = new Compositor(parseGif(await fixture(LOOP)));
    let mine: Uint32Array = new Uint32Array(0);
    for (let i = 0; i <= frame; i++) mine = comp.next();
    const theirs = await reference(frame);
    expect(mine).toHaveLength(theirs.length);
    expect(differing(mine, theirs)).toBe(0);
  });

  test("every composited frame is opaque, since frame 0 is complete", async () => {
    const comp = new Compositor(parseGif(await fixture(LOOP)));
    while (!comp.finished) {
      const f = comp.next();
      expect(f.every((p) => p >>> 24 === 255)).toBe(true);
    }
  });

  test("decompresses a hand-made LZW stream with a clear code and a repeated run", () => {
    const indices = [0, 1, 1, 1, 1, 0, 0, 0, 3, 2];
    const bytes = encode(indices, 2);
    expect([...lzw(2, bytes, indices.length)]).toEqual(indices);
  });

  test("leaves the rest of a frame at index 0 when its data ends early", () => {
    const bytes = encode([2, 2, 2, 2], 2).subarray(0, 1);
    const out = lzw(2, bytes, 4);
    expect(out).toHaveLength(4);
    expect(out[3]).toBe(0);
  });

  test("restores the background (disposal 2) and the previous canvas (disposal 3)", () => {
    // A 2x1 image: frame 0 paints red, frame 1 paints its left pixel green and is cleared after,
    // frame 2 paints the right pixel blue and is restored after, frame 3 paints nothing.
    const gif = bytesOf([
      { x: 0, y: 0, w: 2, h: 1, disposal: 1, indices: [0, 0] },
      { x: 0, y: 0, w: 1, h: 1, disposal: 2, indices: [1] },
      { x: 1, y: 0, w: 1, h: 1, disposal: 3, indices: [2] },
      { x: 0, y: 0, w: 1, h: 1, disposal: 1, indices: [3], transparent: 3 },
    ]);
    const comp = new Compositor(parseGif(gif));
    const red = rgba(255, 0, 0);
    const green = rgba(0, 255, 0);
    const blue = rgba(0, 0, 255);
    expect([...comp.next()]).toEqual([red, red]);
    expect([...comp.next()]).toEqual([green, red]);
    expect([...comp.next()]).toEqual([0, blue]);
    expect([...comp.next()]).toEqual([0, red]);
  });
});

describe("a lazily decoded loop", () => {
  test("shows its first frame before the rest are decoded", async () => {
    const loop = Loop.fromBytes(await fixture(LOOP));
    expect(loop.decoded).toBe(0);
    const first = loop.frame(0);
    expect(first).not.toBeNull();
    expect(loop.decoded).toBe(1);
  });

  test("settles for the latest ready frame when its budget runs out", async () => {
    const loop = Loop.fromBytes(await fixture(LOOP));
    let ticks = 0;
    // The clock passes the deadline after three frames.
    const f = loop.frame(120, 3, () => ++ticks);
    expect(loop.decoded).toBe(3);
    expect(f).toBe(loop.frame(2));
  });

  test("decodes ahead in idle time until the loop is complete, then matches the reference", async () => {
    const loop = Loop.fromBytes(await fixture(LOOP));
    expect(loop.ahead(Infinity, () => 0)).toBe(true);
    expect(loop.complete).toBe(true);
    const f = loop.frame(159);
    expect(f && differing(f, await reference(159))).toBe(0);
  });

  test("maps time to frames at the loop's own rate, wrapping", async () => {
    const loop = Loop.fromBytes(await fixture(LOOP));
    expect(loop.frameMs).toBe(100);
    expect(loop.indexAt(0)).toBe(0);
    expect(loop.indexAt(2650)).toBe(26);
    expect(loop.indexAt(16_000)).toBe(0);
    expect(loop.indexAt(16_050 + 1600)).toBe(16);
  });
});

// ---------------------------------------------------------------------------------------------
// A minimal GIF encoder for the hand-made cases: uncompressed LZW (a clear code before the table
// would grow), one global palette of red, green, blue and black.

function encode(indices: readonly number[], minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const size = minCodeSize + 1;
  const codes: number[] = [clear];
  // Emit a clear every few codes so the code size never grows.
  indices.forEach((v, i) => {
    if (i > 0 && i % ((1 << size) - clear - 2) === 0) codes.push(clear);
    codes.push(v);
  });
  codes.push(clear + 1);
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of codes) {
    acc |= c << bits;
    bits += size;
    while (bits >= 8) {
      out.push(acc & 255);
      acc >>= 8;
      bits -= 8;
    }
  }
  if (bits > 0) out.push(acc & 255);
  return Uint8Array.from(out);
}

interface Spec {
  x: number;
  y: number;
  w: number;
  h: number;
  disposal: number;
  indices: number[];
  transparent?: number;
}

function bytesOf(frames: Spec[]): Uint8Array {
  const out: number[] = [...new TextEncoder().encode("GIF89a"), 2, 0, 1, 0, 0x81, 0, 0];
  out.push(255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0);
  for (const f of frames) {
    const flags = (f.disposal << 2) | (f.transparent === undefined ? 0 : 1);
    out.push(0x21, 0xf9, 4, flags, 10, 0, f.transparent ?? 0, 0);
    out.push(0x2c, f.x, 0, f.y, 0, f.w, 0, f.h, 0, 0);
    const data = encode(f.indices, 2);
    out.push(2, data.length, ...data, 0);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}

describe("the compositor", () => {
  test("puts the near layer back in front of what is drawn over a frame", async () => {
    const loop = Loop.fromBytes(await fixture(LOOP));
    const frame = loop.frame(0);
    const near = maskOf({ w: 256, h: 144, data: readPng(await fixture("near-normal.png")).pixels });
    expect(frame).not.toBeNull();
    if (!frame) return;
    // The giant trunks at the edges are near; the clearing round the tree's foot is not.
    expect(near.bits[70 * 256 + 4]).toBe(1);
    expect(near.bits[126 * 256 + 128]).toBe(0);
    const pic = new Picture(256, 144);
    pic.begin(frame);
    const ink = rgba(255, 0, 255);
    for (let y = 0; y < 144; y++) for (let x = 0; x < 256; x++) pic.set(x, y, ink);
    pic.restore(near);
    let wrong = 0;
    for (let i = 0; i < 256 * 144; i++) if (pic.px[i] !== (near.bits[i] ? frame[i] : ink)) wrong++;
    expect(wrong).toBe(0);
  });

  test("copies a phone's crop, and knocks the picture for a reveal's impact", () => {
    const pic = new Picture(4, 2);
    pic.begin(Uint32Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
    const out = new Uint32Array(4);
    pic.blit(out, 2, 2, 1);
    expect([...out]).toEqual([2, 3, 6, 7]);
    pic.blit(out, 2, 2, 1, 1, 0);
    expect([...out]).toEqual([1, 2, 5, 6]);
  });
});
