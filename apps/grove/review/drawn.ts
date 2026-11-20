/**
 * Checks the hand-drawn tiles in `src/art/drawn.ts` and writes them to a sheet, each repeated 3x3.
 * `bun review/drawn.ts [out.png] [name...]`: with names, also prints those tiles' numbers in full.
 * Exits 1 if any tile is malformed.
 */
import { deflateSync } from "node:zlib";

import { DRAWN } from "../src/art/drawn.ts";

const [out = "/tmp/grove-drawn.png", ...only] = process.argv.slice(2);
const S = 16;
let bad = 0;
const fail = (name: string, why: string): void => {
  console.log(`ERROR ${name}: ${why}`);
  bad++;
};
const lum = (hex: string): number =>
  (parseInt(hex.slice(1, 3), 16) * 0.2126 +
    parseInt(hex.slice(3, 5), 16) * 0.7152 +
    parseInt(hex.slice(5, 7), 16) * 0.0722) /
  255;

const names = Object.keys(DRAWN);
for (const name of names) {
  const d = DRAWN[name]!;
  if (d.rows.length !== S) fail(name, `${d.rows.length} rows, need ${S}`);
  d.rows.forEach((r, y) => {
    if (r.length !== S) fail(name, `row ${y} has ${r.length} letters, need ${S}`);
    for (const ch of r) if (ch !== "." && !d.key[ch]) fail(name, `row ${y} uses "${ch}", which is not in the key`);
  });
  for (const [k, hex] of Object.entries(d.key)) {
    if (k.length !== 1 || k === ".") fail(name, `key "${k}" must be one letter and not a dot`);
    if (!/^#[0-9a-f]{6}$/i.test(hex)) fail(name, `colour ${hex} for "${k}" is not #rrggbb`);
  }
  if (bad) continue;
  const at = (x: number, y: number): string => d.rows[(y + S) % S]![(x + S) % S]!;
  const count = new Map<string, number>();
  let clear = 0;
  let alone = 0;
  let inner = 0;
  let seam = 0;
  let innerN = 0;
  let seamN = 0;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const c = at(x, y);
      if (c === ".") {
        clear++;
        continue;
      }
      count.set(c, (count.get(c) ?? 0) + 1);
      if ([at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)].every((n) => n !== c)) alone++;
      for (const [nx, ny] of [
        [x + 1, y],
        [x, y + 1],
      ] as const) {
        const n = at(nx, ny);
        if (n === ".") continue;
        const step = Math.abs(lum(d.key[c]!) - lum(d.key[n]!));
        if (nx === S || ny === S) {
          seam += step;
          seamN++;
        } else {
          inner += step;
          innerN++;
        }
      }
    }
  const solid = S * S - clear;
  const lums = [...count.keys()].map((k) => lum(d.key[k]!));
  const unused = Object.keys(d.key).filter((k) => !count.has(k));
  const ratio = innerN && seamN && inner > 0 ? seam / seamN / (inner / innerN) : 1;
  const flags = [
    unused.length ? `unused key ${unused.join("")}` : "",
    clear === 0 && ratio > 1.6 ? `SEAM shows (edge steps ${ratio.toFixed(1)}x the inside)` : "",
    count.size > 10 ? "more than 10 colours" : "",
  ].filter(Boolean);
  console.log(
    `${name.padEnd(16)} ${String(count.size).padStart(2)} colours  light ${Math.min(...lums).toFixed(2)}-${Math.max(...lums).toFixed(2)}  ` +
      `lone ${String(Math.round((alone / solid) * 100)).padStart(2)}%  clear ${String(Math.round((clear / 256) * 100)).padStart(2)}%  seam ${ratio.toFixed(2)}` +
      (flags.length ? `  << ${flags.join("; ")}` : ""),
  );
  if (only.includes(name))
    console.log(
      [...count]
        .sort((a, b) => lum(d.key[a[0]]!) - lum(d.key[b[0]]!))
        .map(([k, n]) => `   ${k} ${d.key[k]} ${Math.round((n / solid) * 100)}%`)
        .join("\n"),
    );
}
console.log(bad ? `${bad} errors` : `${names.length} tiles, no errors`);
if (bad) process.exit(1);

// The sheet: every tile three times each way at 6x, on a mid grey, eight to a row.
const scale = 6;
const cell = S * 3 * scale + 10;
const cols = 8;
const w = cols * cell + 10;
const h = Math.max(1, Math.ceil(names.length / cols)) * cell + 10;
const img = new Uint8Array(w * h * 4);
for (let i = 0; i < w * h; i++) img.set([0x60, 0x58, 0x70, 255], i * 4);
names.forEach((name, n) => {
  const d = DRAWN[name]!;
  const ox = 10 + (n % cols) * cell;
  const oy = 10 + Math.floor(n / cols) * cell;
  for (let y = 0; y < S * 3 * scale; y++)
    for (let x = 0; x < S * 3 * scale; x++) {
      const ch = d.rows[Math.floor(y / scale) % S]![Math.floor(x / scale) % S]!;
      if (ch === ".") continue;
      const hex = d.key[ch]!;
      img.set(
        [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255],
        ((oy + y) * w + ox + x) * 4,
      );
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
console.log(`sheet: ${out} (tiles in order, ${cols} to a row)`);
