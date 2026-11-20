/**
 * A small GIF decoder for the art bundle's loops, with no dependencies, so it runs the same in the
 * browser and in `bun test`.
 *
 * The bundle's loops are encoded like the welcome loops: frame 0 complete, every later frame only
 * its changed rectangle, with unchanged pixels as the transparent index and disposal "keep", so a
 * frame is the previous one with the rectangle composited over it. The decoder handles the rest of
 * the format too (local palettes, interlacing, the other disposals), so any loop a tool writes
 * plays.
 *
 * `parseGif` only reads the structure and gathers each frame's compressed data, which is fast;
 * `Compositor` then decompresses and composites the frames one at a time, in order, into packed
 * RGBA (`0xAABBGGRR`, the byte order of `ImageData` on a little-endian machine), so a caller can
 * decode as much as it has time for.
 */

export interface GifFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Milliseconds this frame shows. */
  delay: number;
  /** 0 or 1: keep; 2: clear its rectangle to transparent; 3: restore what was under it. */
  disposal: number;
  /** The transparent palette index, or -1. */
  transparent: number;
  interlaced: boolean;
  /** Packed RGBA, from the frame's own table or the global one. */
  palette: Uint32Array;
  minCodeSize: number;
  /** The LZW data, its sub-blocks joined. */
  data: Uint8Array;
}

export interface Gif {
  width: number;
  height: number;
  frames: GifFrame[];
}

/** Packs a colour into `ImageData`'s byte order, read as a little-endian 32-bit word. */
export const rgba = (r: number, g: number, b: number, a = 255): number => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

function palette(bytes: Uint8Array, at: number, size: number): Uint32Array {
  const out = new Uint32Array(size);
  for (let i = 0; i < size; i++)
    out[i] = rgba(bytes[at + i * 3] ?? 0, bytes[at + i * 3 + 1] ?? 0, bytes[at + i * 3 + 2] ?? 0);
  return out;
}

/** Reads a GIF's structure. Throws on anything that is not a GIF. */
export function parseGif(bytes: Uint8Array): Gif {
  const byte = (i: number): number => {
    const v = bytes[i];
    if (v === undefined) throw new Error("gif: truncated");
    return v;
  };
  const word = (i: number): number => byte(i) | (byte(i + 1) << 8);
  const magic = String.fromCharCode(...bytes.subarray(0, 6));
  if (magic !== "GIF89a" && magic !== "GIF87a") throw new Error("gif: not a GIF");
  const width = word(6);
  const height = word(8);
  const flags = byte(10);
  let at = 13;
  let global: Uint32Array | null = null;
  if (flags & 0x80) {
    const size = 2 << (flags & 7);
    global = palette(bytes, at, size);
    at += size * 3;
  }
  const frames: GifFrame[] = [];
  let control = { delay: 0, disposal: 0, transparent: -1 };
  /** Joins the sub-blocks starting at `at`; returns them and where they end. */
  const blocks = (start: number): { data: Uint8Array; end: number } => {
    let total = 0;
    let i = start;
    for (let n = byte(i); n !== 0; n = byte(i)) {
      total += n;
      i += n + 1;
    }
    const data = new Uint8Array(total);
    let o = 0;
    i = start;
    for (let n = byte(i); n !== 0; n = byte(i)) {
      data.set(bytes.subarray(i + 1, i + 1 + n), o);
      o += n;
      i += n + 1;
    }
    return { data, end: i + 1 };
  };
  while (at < bytes.length) {
    const kind = byte(at);
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = byte(at + 1);
      const ext = blocks(at + 2);
      if (label === 0xf9 && ext.data.length >= 4) {
        const f = ext.data[0] ?? 0;
        control = {
          disposal: (f >> 2) & 7,
          delay: ((ext.data[1] ?? 0) | ((ext.data[2] ?? 0) << 8)) * 10,
          transparent: f & 1 ? (ext.data[3] ?? 0) : -1,
        };
      }
      at = ext.end;
      continue;
    }
    if (kind !== 0x2c) throw new Error(`gif: unexpected block 0x${kind.toString(16)}`);
    const x = word(at + 1);
    const y = word(at + 3);
    const w = word(at + 5);
    const h = word(at + 7);
    const f = byte(at + 9);
    at += 10;
    let table = global;
    if (f & 0x80) {
      const size = 2 << (f & 7);
      table = palette(bytes, at, size);
      at += size * 3;
    }
    if (!table) throw new Error("gif: a frame without a palette");
    const minCodeSize = byte(at);
    const image = blocks(at + 1);
    at = image.end;
    frames.push({
      x,
      y,
      w,
      h,
      ...control,
      interlaced: (f & 0x40) !== 0,
      palette: table,
      minCodeSize,
      data: image.data,
    });
    control = { delay: 0, disposal: 0, transparent: -1 };
  }
  return { width, height, frames };
}

const PREFIX = new Uint16Array(4096);
const SUFFIX = new Uint8Array(4096);
const STACK = new Uint8Array(4097);

/**
 * Decompresses one frame's LZW data into `count` palette indices. A stream that ends early leaves
 * the rest at 0, as browsers do.
 */
export function lzw(minCodeSize: number, data: Uint8Array, count: number, out = new Uint8Array(count)): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  for (let i = 0; i < clear; i++) {
    PREFIX[i] = 0;
    SUFFIX[i] = i;
  }
  let size = minCodeSize + 1;
  let mask = (1 << size) - 1;
  let next = clear + 2;
  let old = -1;
  let first = 0;
  let bits = 0;
  let datum = 0;
  let pos = 0;
  let op = 0;
  while (op < count) {
    while (bits < size) {
      if (pos >= data.length) return out;
      datum |= (data[pos++] ?? 0) << bits;
      bits += 8;
    }
    let code = datum & mask;
    datum >>>= size;
    bits -= size;
    if (code === clear) {
      size = minCodeSize + 1;
      mask = (1 << size) - 1;
      next = clear + 2;
      old = -1;
      continue;
    }
    if (code === end) break;
    if (old === -1) {
      if (code >= clear) break;
      out[op++] = code;
      old = code;
      first = code;
      continue;
    }
    const read = code;
    let sp = 0;
    if (code >= next) {
      if (code > next) break;
      STACK[sp++] = first;
      code = old;
    }
    while (code >= clear) {
      STACK[sp++] = SUFFIX[code] ?? 0;
      code = PREFIX[code] ?? 0;
    }
    first = SUFFIX[code] ?? 0;
    STACK[sp++] = first;
    if (next < 4096) {
      PREFIX[next] = old;
      SUFFIX[next] = first;
      next++;
      if ((next & mask) === 0 && next < 4096) {
        size++;
        mask = (1 << size) - 1;
      }
    }
    old = read;
    while (sp > 0 && op < count) out[op++] = STACK[--sp] ?? 0;
  }
  return out;
}

/** The row of the image that the `i`th stored row of an interlaced frame belongs to. */
function interlacedRows(h: number): Int32Array {
  const rows = new Int32Array(h);
  let i = 0;
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ] as const)
    for (let y = start; y < h; y += step) rows[i++] = y;
  return rows;
}

/**
 * Plays a GIF's frames in order onto a canvas of packed RGBA, as a GIF player does. `next()`
 * composites one more frame and returns a copy of the canvas: a ready-to-draw frame.
 */
export class Compositor {
  readonly gif: Gif;
  /** How many frames have been composited. */
  done = 0;
  private readonly canvas: Uint32Array;
  private saved: Uint32Array | null = null;
  private indices = new Uint8Array(0);

  constructor(gif: Gif) {
    this.gif = gif;
    this.canvas = new Uint32Array(gif.width * gif.height);
  }

  get finished(): boolean {
    return this.done >= this.gif.frames.length;
  }

  next(): Uint32Array {
    const { width: W, height: H, frames } = this.gif;
    const f = frames[this.done];
    if (!f) throw new Error("gif: no more frames");
    const before = frames[this.done - 1];
    if (before) this.dispose(before);
    if (f.disposal === 3) this.saved = this.canvas.slice();
    const n = f.w * f.h;
    if (this.indices.length < n) this.indices = new Uint8Array(n);
    const idx = lzw(f.minCodeSize, f.data, n, this.indices.fill(0, 0, n));
    const rows = f.interlaced ? interlacedRows(f.h) : null;
    const pal = f.palette;
    const tr = f.transparent;
    const x0 = Math.max(0, f.x);
    const x1 = Math.min(W, f.x + f.w);
    for (let r = 0; r < f.h; r++) {
      const y = f.y + (rows ? (rows[r] ?? r) : r);
      if (y < 0 || y >= H) continue;
      const src = r * f.w - f.x;
      const dst = y * W;
      for (let x = x0; x < x1; x++) {
        const k = idx[src + x] ?? 0;
        if (k !== tr) this.canvas[dst + x] = pal[k] ?? 0;
      }
    }
    this.done++;
    return this.canvas.slice();
  }

  private dispose(f: GifFrame): void {
    const W = this.gif.width;
    if (f.disposal === 2) {
      for (let y = Math.max(0, f.y); y < Math.min(this.gif.height, f.y + f.h); y++)
        this.canvas.fill(0, y * W + Math.max(0, f.x), y * W + Math.min(W, f.x + f.w));
    } else if (f.disposal === 3 && this.saved) {
      this.canvas.set(this.saved);
      this.saved = null;
    }
  }
}
