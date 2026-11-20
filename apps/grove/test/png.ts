/**
 * A PNG reader for the tests: the reference frames ImageMagick wrote and the bundle's 1-bit masks,
 * decoded independently of the client's own decoders. Handles non-interlaced grey, RGB, palette
 * and RGBA images at the bit depths those use. Pixels come back as packed RGBA (`0xAABBGGRR`).
 */

import { inflateSync } from "node:zlib";

export interface Png {
  width: number;
  height: number;
  pixels: Uint32Array;
}

const pack = (r: number, g: number, b: number, a: number): number => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

export function readPng(bytes: Uint8Array): Png {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let type = 0;
  let plte: Uint8Array = new Uint8Array(0);
  let trns: Uint8Array = new Uint8Array(0);
  const idat: Uint8Array[] = [];
  while (at < bytes.length) {
    const len = view.getUint32(at);
    const kind = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (kind === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      depth = body[8] ?? 8;
      type = body[9] ?? 0;
      if (body[12]) throw new Error("png: interlaced images are not supported");
    } else if (kind === "PLTE") plte = body;
    else if (kind === "tRNS") trns = body;
    else if (kind === "IDAT") idat.push(body);
    else if (kind === "IEND") break;
    at += len + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const channels = type === 2 ? 3 : type === 6 ? 4 : type === 4 ? 2 : 1;
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((width * channels * depth) / 8);
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i] ?? 0;
      const a = i >= bpp ? (rows[dst + i - bpp] ?? 0) : 0;
      const b = y > 0 ? (rows[dst - stride + i] ?? 0) : 0;
      const c = y > 0 && i >= bpp ? (rows[dst - stride + i - bpp] ?? 0) : 0;
      let v = x;
      if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      rows[dst + i] = v & 255;
    }
  }
  const sample = (y: number, i: number): number => {
    if (depth === 8) return rows[y * stride + i] ?? 0;
    const bit = i * depth;
    const byte = rows[y * stride + (bit >> 3)] ?? 0;
    return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const pixels = new Uint32Array(width * height);
  const grey = (v: number): number => Math.round((v * 255) / ((1 << depth) - 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let px: number;
      if (type === 6) px = pack(sample(y, x * 4), sample(y, x * 4 + 1), sample(y, x * 4 + 2), sample(y, x * 4 + 3));
      else if (type === 2) px = pack(sample(y, x * 3), sample(y, x * 3 + 1), sample(y, x * 3 + 2), 255);
      else if (type === 3) {
        const k = sample(y, x);
        px = pack(plte[k * 3] ?? 0, plte[k * 3 + 1] ?? 0, plte[k * 3 + 2] ?? 0, trns[k] ?? 255);
      } else if (type === 0) {
        const g = grey(sample(y, x));
        px = pack(g, g, g, 255);
      } else throw new Error(`png: colour type ${type} is not supported`);
      pixels[y * width + x] = px;
    }
  }
  return { width, height, pixels };
}
