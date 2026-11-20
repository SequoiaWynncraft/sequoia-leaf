/** Writes every tile to one sheet, each shown 3x3 so its seams can be judged: `bun review/atlas.ts <out.png> [scale]`. */
import { deflateSync } from "node:zlib";

import { paintTile, TILE, TILE_NAMES } from "../src/art/tiles.ts";

const [out = "/tmp/grove-atlas.png", scaleArg = "4"] = process.argv.slice(2);
const scale = Number(scaleArg);
const cols = 6;
const cell = TILE * 3 * scale + 8;
const rowsN = Math.ceil(TILE_NAMES.length / cols);
const w = cols * cell + 8;
const h = rowsN * cell + 8;
const img = new Uint8Array(w * h * 4);
for (let i = 0; i < w * h; i++) img.set([0x5a, 0x29, 0x6e, 255], i * 4);
TILE_NAMES.forEach((name, n) => {
  const px = paintTile(name);
  const ox = 8 + (n % cols) * cell;
  const oy = 8 + Math.floor(n / cols) * cell;
  for (let y = 0; y < TILE * 3 * scale; y++)
    for (let x = 0; x < TILE * 3 * scale; x++) {
      const s = ((Math.floor(y / scale) % TILE) * TILE + (Math.floor(x / scale) % TILE)) * 4;
      if (px[s + 3]) img.set([px[s]!, px[s + 1]!, px[s + 2]!, 255], ((oy + y) * w + ox + x) * 4);
    }
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
const hv = new DataView(head.buffer);
hv.setUint32(0, w);
hv.setUint32(4, h);
head.set([8, 6, 0, 0, 0], 8);
await Bun.write(
  out,
  Buffer.concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]),
);
console.log(out, TILE_NAMES.join(" "));
