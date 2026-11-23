/**
 * Packed bytes, written and read: whole numbers as varints, and bytes as base64 text for a store
 * that keeps text.
 */

/** Bytes written one after another into a buffer that grows. */
export class Writer {
  private buf = new Uint8Array(1 << 12);
  length = 0;

  private room(k: number): void {
    if (this.length + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + k) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  byte(b: number): void {
    this.room(1);
    this.buf[this.length++] = b;
  }
  /** A whole number from 0 up to 2^53, seven bits a byte. */
  varint(v: number): void {
    this.room(8);
    while (v >= 0x80) {
      this.buf[this.length++] = (v % 0x80) | 0x80;
      v = Math.floor(v / 0x80);
    }
    this.buf[this.length++] = v;
  }
  bytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/** Bytes read one after another; reading past the end gives 0 and marks the reader `over`. */
export class Reader {
  private at = 0;
  over = false;
  private readonly buf: Uint8Array;
  constructor(buf: Uint8Array) {
    this.buf = buf;
  }
  get done(): boolean {
    return this.at >= this.buf.length;
  }
  byte(): number {
    const b = this.buf[this.at++];
    if (b === undefined) this.over = true;
    return b ?? 0;
  }
  varint(): number {
    let v = 0;
    let m = 1;
    for (let k = 0; k < 8; k++) {
      const b = this.byte();
      v += (b & 0x7f) * m;
      if (b < 0x80) return v;
      m *= 0x80;
    }
    this.over = true;
    return 0;
  }
}

const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const INDEX = new Map(ABC.split("").map((c, n) => [c, n]));

/** Bytes as base64 text. */
export function toBase64(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = ((b[i] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += ABC[(n >> 18) & 63] ?? "";
    out += ABC[(n >> 12) & 63] ?? "";
    out += i + 1 < b.length ? (ABC[(n >> 6) & 63] ?? "") : "=";
    out += i + 2 < b.length ? (ABC[n & 63] ?? "") : "=";
  }
  return out;
}

/** Base64 text as bytes, or null for text that is not base64. */
export function fromBase64(s: string): Uint8Array | null {
  if (s.length % 4 !== 0) return null;
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  for (let i = 0, o = 0; i < s.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const c = s[i + k] ?? "";
      const v = c === "=" && i + k >= s.length - pad ? 0 : INDEX.get(c);
      if (v === undefined) return null;
      n = (n << 6) | v;
    }
    for (let k = 2; k >= 0 && o < out.length; k--) out[o++] = (n >> (k * 8)) & 255;
  }
  return out;
}
