/**
 * Builds `src/art/pack.gen.ts` from the texture pack in `assets/pack` (see its LICENSE.md).
 *
 * A tile is a 16x16 PNG taken as it is. A few are grey in the pack because a block game tints them
 * by biome; they get the grove's one grass colour here. `bun run pack` after changing this file or
 * adding a PNG.
 */
import { readdirSync } from "node:fs";
import { inflateSync } from "node:zlib";

type RGB = readonly [number, number, number];
interface Spec {
  /** The pack file, without `.png`. */
  from: string;
  /** Multiplied into every pixel, as a block game tints grey grass and leaves. */
  tint?: RGB;
  /** Another pack file laid on top where it is opaque. */
  over?: string;
  overTint?: RGB;
  /** Painted first, under a file with clear pixels. */
  under?: (x: number, y: number) => RGB;
  /** Numbered variants of the file (`name1.png`, ...) become `<tile>1`, ... */
  variants?: boolean;
}

const GRASS: RGB = [94, 190, 107];
const warm = (x: number, y: number): RGB => {
  const h = ((x >> 1) * 7 + (y >> 1) * 13 + ((x >> 1) ^ (y >> 1)) * 5) % 10;
  return h < 3 ? [255, 233, 176] : h < 8 ? [245, 185, 94] : [212, 144, 69];
};

/** The pack's spruce needles are a grey-blue green; the grove's sequoias are a warmer forest green, near its grass. */
const LEAF: RGB = [180, 214, 140];

const SPECS: Record<string, Spec> = {
  grass_top: { from: "grass_block_top", tint: GRASS, variants: true },
  grass_side: { from: "grass_block_side", over: "grass_block_side_overlay", overTint: GRASS },
  dirt: { from: "dirt", variants: true },
  podzol_top: { from: "podzol_top" },
  podzol_side: { from: "podzol_side" },
  path: { from: "coarse_dirt" },
  moss: { from: "moss_block" },
  log: { from: "jungle_log", variants: true },
  log_top: { from: "jungle_log_top" },
  log_dark: { from: "spruce_log", variants: true },
  log_dark_top: { from: "spruce_log_top" },
  log_seat: { from: "oak_log", variants: true },
  log_seat_top: { from: "oak_log_top" },
  leaves: { from: "spruce_leaves", tint: LEAF, variants: true },
  leaves_lit: { from: "spruce_leaves", tint: [228, 250, 150], variants: true },
  leaves_dark: { from: "spruce_leaves", tint: [140, 180, 136], variants: true },
  planks: { from: "oak_planks", variants: true },
  planks_dark: { from: "spruce_planks", variants: true },
  cobble: { from: "cobblestone", variants: true },
  cobble_mossy: { from: "mossy_cobblestone", variants: true },
  stone_bricks: { from: "stone_bricks", variants: true },
  roof: { from: "deepslate_tiles", variants: true },
  bricks: { from: "bricks", variants: true },
  ladder: { from: "ladder" },
  window: { from: "glass", under: warm },
  barrel_side: { from: "barrel_side" },
  barrel_top: { from: "barrel_top" },
  barrel_bottom: { from: "barrel_bottom" },
  fern: { from: "fern", tint: GRASS, variants: true },
  grass: { from: "grass", tint: GRASS, variants: true },
  sapling: { from: "spruce_sapling" },
  mushroom_brown: { from: "brown_mushroom" },
  mushroom_red: { from: "red_mushroom" },
  dandelion: { from: "dandelion" },
  poppy: { from: "poppy" },
  cornflower: { from: "cornflower" },
  daisy: { from: "oxeye_daisy" },
  berry_bush: { from: "sweet_berry_bush_stage3" },
  wool_red: { from: "red_wool" },
  wool_purple: { from: "purple_wool" },
};

/** Reads an 8-bit PNG (grey, RGB, palette, with or without alpha) as RGBA rows; a taller image gives its top 16 rows. */
function decode(file: Uint8Array): Uint8Array {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let at = 8;
  let w = 0;
  let h = 0;
  let type = 0;
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
      type = body[9]!;
      if (body[8] !== 8 || body[12] !== 0) throw new Error("only 8-bit, non-interlaced PNGs");
    } else if (name === "PLTE") palette = body;
    else if (name === "tRNS") clear = body;
    else if (name === "IDAT") data.push(body);
    at += 12 + len;
  }
  const n = type === 0 || type === 3 ? 1 : type === 4 ? 2 : type === 2 ? 3 : 4;
  const raw = inflateSync(Buffer.concat(data));
  const line = w * n;
  const px = new Uint8Array(h * line);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (line + 1)]!;
    for (let i = 0; i < line; i++) {
      const v = raw[y * (line + 1) + 1 + i]!;
      const a = i >= n ? px[y * line + i - n]! : 0;
      const b = y ? px[(y - 1) * line + i]! : 0;
      const c = y && i >= n ? px[(y - 1) * line + i - n]! : 0;
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
  if (w !== 16 || h < 16) throw new Error(`a tile is 16 wide, not ${w}x${h}`);
  const out = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 256; i++) {
    const s = i * n;
    if (type === 3)
      out.set([palette[px[s]! * 3]!, palette[px[s]! * 3 + 1]!, palette[px[s]! * 3 + 2]!, clear[px[s]!] ?? 255], i * 4);
    else if (type === 0 || type === 4) out.set([px[s]!, px[s]!, px[s]!, type === 4 ? px[s + 1]! : 255], i * 4);
    else out.set([px[s]!, px[s + 1]!, px[s + 2]!, type === 6 ? px[s + 3]! : 255], i * 4);
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
  used.push(from);
  if (spec.under)
    for (let i = 0; i < 256; i++) if (px[i * 4 + 3]! < 128) px.set([...spec.under(i % 16, i >> 4), 255], i * 4);
  if (spec.over) {
    const top = tinted(await read(spec.over), spec.overTint);
    used.push(spec.over);
    for (let i = 0; i < 256; i++) if (top[i * 4 + 3]! >= 128) px.set(top.subarray(i * 4, i * 4 + 4), i * 4);
  }
  out.push(`  ${tile}: "${Buffer.from(px).toString("base64")}",`);
}
for (const [tile, spec] of Object.entries(SPECS)) {
  await build(tile, spec, spec.from);
  if (spec.variants)
    for (let k = 1; files.has(`${spec.from}${k}.png`); k++) await build(`${tile}${k}`, spec, `${spec.from}${k}`);
}
await Bun.write(
  `${import.meta.dir}/../src/art/pack.gen.ts`,
  `// Generated by tools/pack.ts from assets/pack. Do not edit.\n// Textures: Pixel Perfection by XSSheep and Nova_Wostra, CC BY-SA 4.0. See assets/pack/LICENSE.md.\n/** Each tile as base64 RGBA, 16 rows of 16 from the top. */\nexport const PACK: Record<string, string> = {\n${out.join("\n")}\n};\n`,
);
const unused = [...files].filter((f) => f.endsWith(".png") && !used.includes(f.slice(0, -4)));
console.log(
  `${out.length} tiles from ${new Set(used).size} files${unused.length ? `; unused: ${unused.join(" ")}` : ""}`,
);
