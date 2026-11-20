/**
 * Builds `src/art/pack.gen.ts` from the texture pack in `assets/pack` (see its CREDITS.md).
 *
 * A tile is a 32x32 PNG taken as it is. A few are made here from the pack's own: grey grass, fern
 * and spruce leaves are tinted, as a block game tints them by biome; the spruce also comes lighter
 * and darker; the window is the pack's glass over a warm glow. `bun run pack` after changing this
 * file or adding a PNG.
 */
import { readdirSync } from "node:fs";
import { inflateSync } from "node:zlib";

type RGB = readonly [number, number, number];
interface Spec {
  /** The pack file, without `.png`. */
  from: string;
  /** Multiplied into every pixel, as a block game tints grey grass and leaves. */
  tint?: RGB;
  /** Added to every pixel after the tint: the pack's spruce has no red in it at all, and a little warms it. */
  add?: RGB;
  /** Another pack file laid on top where it is opaque. */
  over?: string;
  overTint?: RGB;
  /** Painted first, under a file with clear pixels. */
  under?: (x: number, y: number) => RGB;
  /** Other drawings of the same thing; they become `<tile>1`, `<tile>2`, ... */
  more?: readonly string[];
}

/** A block game tints grey grass by its biome; the grove has one grass colour and one spruce. */
const GRASS: RGB = [121, 192, 90];
const SPRUCE: RGB = [97, 153, 97];
const warm = (x: number, y: number): RGB => {
  const h = ((x >> 2) * 7 + (y >> 2) * 13 + ((x >> 2) ^ (y >> 2)) * 5) % 10;
  return h < 3 ? [255, 233, 176] : h < 8 ? [245, 185, 94] : [212, 144, 69];
};

const SPECS: Record<string, Spec> = {
  grass_top: { from: "grass_block_top", tint: GRASS },
  grass_side: { from: "grass_block_side", over: "grass_block_side_overlay", overTint: GRASS },
  dirt: { from: "dirt" },
  podzol_top: { from: "podzol_top" },
  podzol_side: { from: "podzol_side" },
  path: { from: "coarse_dirt" },
  moss: { from: "moss_block" },
  log: { from: "spruce_log" },
  log_top: { from: "spruce_log_top" },
  log_dark: { from: "dark_oak_log" },
  log_dark_top: { from: "dark_oak_log_top" },
  log_seat: { from: "oak_log" },
  log_seat_top: { from: "oak_log_top" },
  leaves: { from: "spruce_leaves", tint: SPRUCE },
  leaves_lit: { from: "spruce_leaves", tint: [118, 176, 96] },
  leaves_dark: { from: "spruce_leaves", tint: [78, 128, 88] },
  planks: { from: "oak_planks" },
  planks_dark: { from: "spruce_planks" },
  roof: { from: "dark_oak_planks" },
  cobble: { from: "cobblestone" },
  cobble_mossy: { from: "mossy_cobblestone" },
  stone_bricks: { from: "stone_bricks" },
  bricks: { from: "bricks" },
  ladder: { from: "ladder" },
  window: { from: "glass", under: warm },
  barrel_side: { from: "barrel_side" },
  barrel_top: { from: "barrel_top" },
  barrel_bottom: { from: "barrel_bottom" },
  fern: { from: "fern", tint: GRASS },
  grass: { from: "short_grass", tint: GRASS },
  sapling: { from: "spruce_sapling" },
  mushroom_brown: { from: "brown_mushroom" },
  mushroom_red: { from: "red_mushroom" },
  dandelion: { from: "dandelion" },
  poppy: { from: "poppy" },
  cornflower: { from: "cornflower" },
  daisy: { from: "oxeye_daisy" },
  wool_red: { from: "red_wool" },
  wool_purple: { from: "purple_wool" },
};

const SIZE = 32;

/** Reads a PNG of up to 8 bits a channel (grey, RGB, palette, with or without alpha) as RGBA rows; a taller image gives its top tile. */
function decode(file: Uint8Array): Uint8Array {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let at = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  let depth = 8;
  let palette = new Uint8Array(0);
  let clear = new Uint8Array(0);
  const data: Uint8Array[] = [];
  while (at < file.length) {
    const len = view.getUint32(at);
    const name = String.fromCharCode(...file.subarray(at + 4, at + 8));
    const body = file.subarray(at + 8, at + 8 + len);
    if (name === "IHDR") {
      w = view.getUint32(at + 8);
      h = view.getUint32(at + 12);
      depth = body[8]!;
      type = body[9]!;
      if (depth > 8 || body[12] !== 0) throw new Error("only PNGs of up to 8 bits a channel, not interlaced");
    } else if (name === "PLTE") palette = body;
    else if (name === "tRNS") clear = body;
    else if (name === "IDAT") data.push(body);
    at += 12 + len;
  }
  if (w !== SIZE || h < SIZE) throw new Error(`a tile is ${SIZE} wide, not ${w}x${h}`);
  const n = type === 0 || type === 3 ? 1 : type === 4 ? 2 : type === 2 ? 3 : 4;
  const raw = inflateSync(Buffer.concat(data));
  const line = Math.ceil((w * n * depth) / 8);
  const step = Math.max(1, (n * depth) >> 3);
  const px = new Uint8Array(h * line);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (line + 1)]!;
    for (let i = 0; i < line; i++) {
      const v = raw[y * (line + 1) + 1 + i]!;
      const a = i >= step ? px[y * line + i - step]! : 0;
      const b = y ? px[(y - 1) * line + i]! : 0;
      const c = y && i >= step ? px[(y - 1) * line + i - step]! : 0;
      const p = a + b - c;
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
          ? a
          : Math.abs(p - b) <= Math.abs(p - c)
            ? b
            : c;
      px[y * line + i] =
        v + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth : 0);
    }
  }
  /** One sample: a whole byte, or a few bits of one. */
  const sample = (y: number, k: number): number => {
    if (depth === 8) return px[y * line + k]!;
    const bit = k * depth;
    return (px[y * line + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const full = (v: number): number => (depth === 8 ? v : Math.round((v * 255) / ((1 << depth) - 1)));
  const out = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const k = x * n;
      const o = (y * SIZE + x) * 4;
      if (type === 3) {
        const i = sample(y, k);
        out.set([palette[i * 3]!, palette[i * 3 + 1]!, palette[i * 3 + 2]!, clear[i] ?? 255], o);
      } else if (type === 0 || type === 4) {
        const g = full(sample(y, k));
        out.set([g, g, g, type === 4 ? full(sample(y, k + 1)) : 255], o);
      } else out.set([sample(y, k), sample(y, k + 1), sample(y, k + 2), type === 6 ? sample(y, k + 3) : 255], o);
    }
  return out;
}

const dir = `${import.meta.dir}/../assets/pack`;
const files = new Set(readdirSync(dir));
const read = async (name: string): Promise<Uint8Array> =>
  decode(new Uint8Array(await Bun.file(`${dir}/${name}.png`).arrayBuffer()));
const tinted = (px: Uint8Array, tint?: RGB): Uint8Array =>
  tint ? px.map((v, i) => (i % 4 === 3 ? v : Math.min(255, Math.round((v * tint[i % 4]!) / 255)))) : px;

const out: string[] = [];
const used: string[] = [];
async function build(tile: string, spec: Spec, from: string): Promise<void> {
  const px = tinted(await read(from), spec.tint);
  if (spec.add) for (let i = 0; i < px.length; i++) if (i % 4 !== 3) px[i] = Math.min(255, px[i]! + spec.add[i % 4]!);
  used.push(from);
  if (spec.under)
    for (let i = 0; i < SIZE * SIZE; i++)
      if (px[i * 4 + 3]! < 128) px.set([...spec.under(i % SIZE, Math.floor(i / SIZE)), 255], i * 4);
  if (spec.over) {
    const top = tinted(await read(spec.over), spec.overTint);
    used.push(spec.over);
    for (let i = 0; i < SIZE * SIZE; i++) if (top[i * 4 + 3]! >= 128) px.set(top.subarray(i * 4, i * 4 + 4), i * 4);
  }
  out.push(`  ${tile}: "${Buffer.from(px).toString("base64")}",`);
}
for (const [tile, spec] of Object.entries(SPECS)) {
  await build(tile, spec, spec.from);
  for (const [k, from] of (spec.more ?? []).entries()) await build(`${tile}${k + 1}`, spec, from);
}
await Bun.write(
  `${import.meta.dir}/../src/art/pack.gen.ts`,
  `// Generated by tools/pack.ts from assets/pack. Do not edit.\n// Textures: Faithful 32x by the Faithful team (https://faithfulpack.net), Faithful License v4. See assets/pack/CREDITS.md.\n/** Each tile as base64 RGBA, 32 rows of 32 from the top. */\nexport const PACK: Record<string, string> = {\n${out.join("\n")}\n};\n`,
);
const unused = [...files].filter((f) => f.endsWith(".png") && !used.includes(f.slice(0, -4)));
console.log(
  `${out.length} tiles from ${new Set(used).size} files${unused.length ? `; unused: ${unused.join(" ")}` : ""}`,
);
