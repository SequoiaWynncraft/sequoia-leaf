/**
 * The art bench: chosen drawings side by side, each repeated over 64 pixels so its seams and its
 * repeat can be judged, with the numbers a texture is held to.
 * `bun review/bench.ts <out.png> <scale> <name>...`; a name is a tile or a wide drawing (`bark_m`).
 */
import { deflateSync } from "node:zlib";

import { paintTile, TILE, tileNames } from "../src/art/tiles.ts";
import "../src/engine/blocks.ts";

const [out = "/tmp/grove-bench.png", scaleArg = "6", ...names] = process.argv.slice(2);
const scale = Number(scaleArg);
const all = tileNames();
const SPAN = 64;

/** A drawing as RGBA with its width in pixels. */
function drawing(name: string): { px: Uint8Array; size: number } {
  const parts = all.filter((n) => n.startsWith(`${name}@`));
  if (!parts.length) return { px: paintTile(name), size: TILE };
  const n = Math.round(Math.sqrt(parts.length));
  const size = n * TILE;
  const px = new Uint8Array(size * size * 4);
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const t = paintTile(`${name}@${col},${row}`);
      for (let y = 0; y < TILE; y++)
        px.set(t.subarray(y * TILE * 4, (y + 1) * TILE * 4), ((row * TILE + y) * size + col * TILE) * 4);
    }
  return { px, size };
}

function measure(px: Uint8Array, size: number): string {
  const key = new Int32Array(size * size);
  const lum = new Float32Array(size * size);
  const seen = new Set<number>();
  let sat = 0;
  for (let i = 0; i < size * size; i++) {
    const [r, g, b] = [px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!];
    key[i] = (r << 16) | (g << 8) | b;
    seen.add(key[i]!);
    lum[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    sat += (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(1, Math.max(r, g, b));
  }
  let lo = 1;
  let hi = 0;
  let alone = 0;
  let step = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      lo = Math.min(lo, lum[i]!);
      hi = Math.max(hi, lum[i]!);
      const near = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].map(([dx, dy]) => ((y + dy! + size) % size) * size + ((x + dx! + size) % size));
      if (near.every((j) => key[j] !== key[i])) alone++;
      step += Math.abs(lum[i]! - lum[near[0]!]!) + Math.abs(lum[i]! - lum[near[2]!]!);
    }
  const n = size * size;
  return `${seen.size} colours, light ${lo.toFixed(2)} to ${hi.toFixed(2)}, saturation ${(sat / n).toFixed(2)}, step ${(step / n / 2).toFixed(3)}, lone pixels ${((alone / n) * 100).toFixed(0)}%`;
}

const cell = SPAN * scale + 8;
const w = names.length * cell + 8;
const h = cell + 8 + SPAN + 8;
const img = new Uint8Array(w * h * 4);
for (let i = 0; i < w * h; i++) img.set([0x28, 0x28, 0x30, 255], i * 4);
names.forEach((name, n) => {
  const { px, size } = drawing(name);
  console.log(`${name.padEnd(16)} ${measure(px, size)}`);
  const ox = 8 + n * cell;
  const paste = (oy: number, k: number): void => {
    for (let y = 0; y < SPAN * k; y++)
      for (let x = 0; x < SPAN * k; x++) {
        const s = ((Math.floor(y / k) % size) * size + (Math.floor(x / k) % size)) * 4;
        if (px[s + 3]) img.set([px[s]!, px[s + 1]!, px[s + 2]!, 255], ((oy + y) * w + ox + x) * 4);
      }
  };
  paste(8, scale);
  paste(cell + 8, 1);
});

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const body = new Uint8Array(4 + data.length);
  body.set(new TextEncoder().encode(type));
  body.set(data, 4);
  const o = new Uint8Array(12 + data.length);
  const v = new DataView(o.buffer);
  v.setUint32(0, data.length);
  o.set(body, 4);
  v.setUint32(8 + data.length, Bun.hash.crc32(body));
  return o;
};
const raw = new Uint8Array(h * (w * 4 + 1));
for (let y = 0; y < h; y++) raw.set(img.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
const head = new Uint8Array(13);
new DataView(head.buffer).setUint32(0, w);
new DataView(head.buffer).setUint32(4, h);
head.set([8, 6, 0, 0, 0], 8);
await Bun.write(
  out,
  Buffer.concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]),
);
